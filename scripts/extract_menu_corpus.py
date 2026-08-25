#!/usr/bin/env python3
"""
Stage 1 of the library backfill: extract every wine from every menu PDF.

    python3 scripts/extract_menu_corpus.py --pdf-dir datasets/annotation_inbox/pdfs \
                                           --out /tmp/corpus

Mirrors ScanParserService rather than reimplementing it: the prompt is READ OUT
of scan-parser.service.ts so this cannot drift from what production sends, and
the split behaviour follows the same rules —

  * pre-split PDFs over 12 pages into 10-page chunks
  * on stop_reason == max_tokens, re-split into 6-page chunks and retry
  * recurse to 2-page chunks, bounded at depth 3
  * never return fewer wines than a shallower pass already proved extractable
  * salvage complete objects from a truncated JSON array

Writes one JSON file per menu plus a manifest, so stage 2 (enrichment) and
stage 3 (load) can be re-run without paying for extraction again.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import pathlib
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

import certifi

# pypdf is the modern name; PyPDF2 3.x exposes the identical PdfReader/PdfWriter
# API. Accept either rather than adding a dependency for a one-off backfill.
try:
    from pypdf import PdfReader, PdfWriter
except ImportError:  # pragma: no cover
    from PyPDF2 import PdfReader, PdfWriter

ROOT = pathlib.Path(__file__).resolve().parent.parent
SSL_CTX = ssl.create_default_context(cafile=certifi.where())
API = "https://api.anthropic.com/v1/messages"
MODEL = "claude-haiku-4-5"
MAX_TOKENS = 16000
MAX_SPLIT_DEPTH = 3


def load_env() -> dict:
    env = dict(os.environ)
    envfile = ROOT / ".env"
    if envfile.exists():
        for line in envfile.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                env.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    return env


def load_prompt() -> str:
    """Read the live extraction prompt out of the service.

    Duplicating the prompt here would let this backfill drift from production
    silently, and then the library would hold wines shaped differently from
    every wine imported afterwards.
    """
    src = (
        ROOT / "apps/api-gateway/src/menus/parsers/scan-parser.service.ts"
    ).read_text()
    body = src.split("const WINE_EXTRACTION_PROMPT =", 1)[1].split(";\n", 1)[0]
    parts = [
        (m.group(1) if m.group(1) is not None else m.group(2))
        for m in re.finditer(r'"((?:[^"\\]|\\.)*)"|\'((?:[^\'\\]|\\.)*)\'', body)
    ]
    prompt = "".join(p.replace('\\"', '"').replace("\\'", "'") for p in parts)
    if "raw_text" in prompt or "do NOT repeat the producer" not in prompt:
        raise SystemExit("extraction prompt in scan-parser.service.ts is not the expected one")
    return prompt


def salvage(text: str) -> list:
    """Mirror of ScanParserService.salvageTruncatedArray."""
    cleaned = re.sub(r"```(?:json)?\n?", "", text).strip()
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, list):
            return [i for i in parsed if isinstance(i.get("name"), str) and i["name"]]
    except Exception:
        pass
    start = cleaned.find("[")
    if start == -1:
        return []
    out, depth, obj_start, in_str, esc = [], 0, -1, False, False
    for i in range(start + 1, len(cleaned)):
        ch = cleaned[i]
        if esc:
            esc = False
        elif ch == "\\":
            esc = True
        elif ch == '"':
            in_str = not in_str
        elif not in_str:
            if ch == "{":
                if depth == 0:
                    obj_start = i
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0 and obj_start != -1:
                    try:
                        o = json.loads(cleaned[obj_start : i + 1])
                        if isinstance(o.get("name"), str) and o["name"]:
                            out.append(o)
                    except Exception:
                        pass
                    obj_start = -1
    return out


def response_text(data: dict) -> str:
    """Concatenate the text blocks of a response.

    Not `content[0].text`: models that reason before answering put a `thinking`
    block first, and indexing position 0 then raises KeyError — which this
    script swallowed as "the model returned nothing", making a working model
    look like a failing one. Selecting by block type is correct for every model.
    """
    return "".join(
        b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"
    )


class Extractor:
    def __init__(self, api_key: str, prompt: str):
        self.key = api_key
        self.prompt = prompt
        self.calls = 0
        self.in_tokens = 0
        self.out_tokens = 0

    def call(self, b64: str) -> dict:
        payload = json.dumps({
            "model": MODEL,
            "max_tokens": MAX_TOKENS,
            "messages": [{"role": "user", "content": [
                {"type": "document", "source": {
                    "type": "base64", "media_type": "application/pdf", "data": b64}},
                {"type": "text", "text": self.prompt}]}],
        }).encode()
        req = urllib.request.Request(API, data=payload, headers={
            "x-api-key": self.key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        })
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=600, context=SSL_CTX) as r:
                    data = json.loads(r.read())
                break
            except urllib.error.HTTPError as e:
                detail = e.read()[:200].decode(errors="replace")
                if e.code not in (429, 500, 502, 503, 529) or attempt == 4:
                    return {"error": f"HTTP {e.code}: {detail}", "items": [], "truncated": False}
                time.sleep(5 * (attempt + 1))
            except Exception as e:
                if attempt == 4:
                    return {"error": f"{type(e).__name__}: {e}", "items": [], "truncated": False}
                time.sleep(5 * (attempt + 1))
        usage = data.get("usage", {})
        self.calls += 1
        self.in_tokens += usage.get("input_tokens", 0)
        self.out_tokens += usage.get("output_tokens", 0)
        return {
            "items": salvage(response_text(data)),
            "truncated": data.get("stop_reason") == "max_tokens",
        }


def split_pdf(raw: bytes, pages_per_chunk: int) -> list[bytes]:
    import io

    reader = PdfReader(io.BytesIO(raw))
    n = len(reader.pages)
    if n <= 1:
        return [raw]
    chunks = []
    for start in range(0, n, pages_per_chunk):
        writer = PdfWriter()
        for p in range(start, min(start + pages_per_chunk, n)):
            writer.add_page(reader.pages[p])
        buf = io.BytesIO()
        writer.write(buf)
        chunks.append(buf.getvalue())
    return chunks


def dedupe(items: list) -> list:
    """Drop repeats across chunk seams, as ScanParserService.dedupe does."""
    seen, out = set(), []
    for it in items:
        key = tuple(
            re.sub(r"[^a-z0-9]+", " ", str(it.get(f) or "").lower()).strip()
            for f in ("producer", "name", "vintage")
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out


def extract_pdf(ex: Extractor, raw: bytes, page_count: int, depth: int = 0) -> list:
    if depth == 0 and page_count > 12:
        chunks = split_pdf(raw, 10)
        if len(chunks) > 1:
            return extract_chunks(ex, chunks, depth + 1)

    res = ex.call(base64.b64encode(raw).decode())
    if res.get("error"):
        print(f"      call failed: {res['error']}", flush=True)
    if not res["truncated"] or depth >= MAX_SPLIT_DEPTH:
        return res["items"]

    chunks = split_pdf(raw, 6 if depth == 0 else 2)
    if len(chunks) <= 1:
        return res["items"]
    deeper = extract_chunks(ex, chunks, depth + 1)
    # Never regress below what a shallower pass already proved extractable.
    return deeper if len(deeper) >= len(res["items"]) else res["items"]


def extract_chunks(ex: Extractor, chunks: list[bytes], depth: int) -> list:
    import io

    all_items = []
    for chunk in chunks:
        pages = len(PdfReader(io.BytesIO(chunk)).pages)
        all_items.extend(extract_pdf(ex, chunk, pages, depth))
    return dedupe(all_items)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf-dir", default="datasets/annotation_inbox/pdfs")
    ap.add_argument("--out", default="/tmp/corpus")
    ap.add_argument("--workers", type=int, default=4,
                    help="menus extracted in parallel; each may itself make several calls")
    ap.add_argument("--only", nargs="*", help="limit to these filenames")
    args = ap.parse_args()

    env = load_env()
    key = env.get("ANTHROPIC_API_KEY")
    if not key:
        raise SystemExit("ANTHROPIC_API_KEY not set")

    pdf_dir = (ROOT / args.pdf_dir) if not os.path.isabs(args.pdf_dir) else pathlib.Path(args.pdf_dir)
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    pdfs = sorted(pdf_dir.glob("*.pdf"))
    if args.only:
        pdfs = [p for p in pdfs if p.name in set(args.only)]

    prompt = load_prompt()
    ex = Extractor(key, prompt)
    print(f"{len(pdfs)} menu(s); prompt {len(prompt)} chars\n", flush=True)

    def work(path: pathlib.Path):
        dest = out / f"{path.stem}.json"
        if dest.exists():
            return path.name, json.loads(dest.read_text())["wine_count"], True
        raw = path.read_bytes()
        pages = len(PdfReader(str(path)).pages)
        t0 = time.time()
        items = dedupe(extract_pdf(ex, raw, pages))
        dest.write_text(json.dumps({
            "menu": path.name,
            "pages": pages,
            "wine_count": len(items),
            "seconds": round(time.time() - t0, 1),
            "wines": items,
        }, ensure_ascii=False, indent=1))
        return path.name, len(items), False

    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(work, p): p for p in pdfs}
        for fut in as_completed(futures):
            try:
                name, count, cached = fut.result()
                results.append((name, count))
                print(f"  {'[cached]' if cached else '[  done]'} {name[:52]:<54} {count:>5} wines",
                      flush=True)
            except Exception as e:
                print(f"  [FAILED] {futures[fut].name}: {e}", flush=True)

    total = sum(c for _, c in results)
    cost = ex.in_tokens * 1e-6 + ex.out_tokens * 5e-6
    (out / "manifest.json").write_text(json.dumps({
        "menus": len(results), "wines": total,
        "api_calls": ex.calls,
        "input_tokens": ex.in_tokens, "output_tokens": ex.out_tokens,
        "cost_usd": round(cost, 4),
    }, indent=1))
    print(f"\n{total} wines from {len(results)} menu(s)")
    print(f"{ex.calls} API call(s), {ex.in_tokens:,} in / {ex.out_tokens:,} out, ${cost:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
