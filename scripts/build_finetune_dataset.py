#!/usr/bin/env python3
"""Build a fine-tuning-ready JSONL dataset for the wine-menu extraction task.

Takes a directory of restaurant menu PDFs, labels each one with a strong
"teacher" model, scores the label against a deterministic text-layer check, and
emits standard chat-format JSONL split into train/holdout.

    python3 scripts/build_finetune_dataset.py \
        --pdf-dir datasets/annotation_inbox/pdfs \
        --out datasets/finetune/menu_extraction \
        --teacher claude-opus-5 \
        --mode text

Availability note: Anthropic's first-party API does not expose a fine-tuning
endpoint. Claude fine-tuning is offered through Amazon Bedrock for selected
models, and the JSONL emitted here is in the shape those trainers expect. Even
where fine-tuning is not available the output is directly useful as:

  * a held-out **eval set** for prompt or model changes (use `holdout.jsonl`),
  * a **few-shot example** pool (filter to `confidence == "high"`),
  * a **distillation target** for evaluating a cheaper model against a stronger
    one's labels.

Teacher labels are NOT ground truth. Every record carries the verifier's
signals so you can filter before training — `--min-confidence high` keeps only
records where the extraction and the PDF's own text layer agree.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import random
import re
import sys
import time
from dataclasses import dataclass, field, asdict
from typing import Any

try:
    import anthropic
except ImportError:
    sys.exit("pip install anthropic")
try:
    import pdfplumber
except ImportError:
    sys.exit("pip install pdfplumber")


# ---------------------------------------------------------------------------
# The task definition. Keep this identical to production
# (apps/api-gateway/src/menus/parsers/scan-parser.service.ts) or the dataset
# teaches a task the app never asks for.
# ---------------------------------------------------------------------------

SYSTEM = (
    "You extract structured wine data from restaurant menus. "
    "You return only JSON, never prose."
)

INSTRUCTION = """Extract every wine on this menu.

Return one entry per distinct sellable wine. If a wine is offered both by the
glass and by the bottle, that is ONE entry with both prices filled in.
Skip beer, cocktails, spirits, and non-alcoholic items.

For each wine give:
  name         the wine's own name, WITHOUT the region or grape appended
  producer     the winery/estate; null if the menu prints no separable producer
  vintage      integer year, or null for non-vintage
  region       appellation or region, or null
  grape        grape variety or blend, or null
  price_glass  number or null
  price_bottle number or null

Respond with ONLY a JSON object of the form {"wines": [...]}. No prose."""

SCHEMA = {
    "type": "object",
    "properties": {
        "wines": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "producer": {"type": ["string", "null"]},
                    "vintage": {"type": ["integer", "null"]},
                    "region": {"type": ["string", "null"]},
                    "grape": {"type": ["string", "null"]},
                    "price_glass": {"type": ["number", "null"]},
                    "price_bottle": {"type": ["number", "null"]},
                },
                "required": [
                    "name", "producer", "vintage", "region",
                    "grape", "price_glass", "price_bottle",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["wines"],
    "additionalProperties": False,
}

PRICE_RE = re.compile(r"(?<!\d)(\d{2,4})(?:\.\d{2})?(?!\d)")
WORD_RE = re.compile(r"[A-Za-z]{3,}")


# ---------------------------------------------------------------------------
# Deterministic verifier — the same signal the production pipeline should gate
# on. Bands, not floors: a beverage menu legitimately reads low because priced
# cocktail lines inflate the denominator.
# ---------------------------------------------------------------------------

COVERAGE_OK = (0.75, 1.60)
MAX_NULL_PRICE_RATIO = 0.05
MIN_PRODUCER_RATIO = 0.90
MAX_NAME_WORDS = 6.0


@dataclass
class Verdict:
    confidence: str = "high"
    flags: list[str] = field(default_factory=list)

    def fail(self, flag: str, hard: bool = False) -> None:
        self.flags.append(flag)
        if hard:
            self.confidence = "reject"
        elif self.confidence != "reject":
            self.confidence = "low"


def read_text_layer(path: str) -> tuple[str, int, int]:
    """Return (full text, page count, plausible priced-line count)."""
    chunks: list[str] = []
    priced = 0
    pages = 0
    with pdfplumber.open(path) as pdf:
        pages = len(pdf.pages)
        for page in pdf.pages:
            text = page.extract_text() or ""
            chunks.append(text)
            for line in text.split("\n"):
                s = line.strip()
                if len(s) < 8:
                    continue
                nums = [int(m) for m in PRICE_RE.findall(s)]
                if any(14 <= n <= 2000 for n in nums) and len(WORD_RE.findall(s)) >= 2:
                    priced += 1
    return "\n".join(chunks), pages, priced


def verify(wines: list[dict], priced_lines: int, has_text: bool,
           truncated: bool) -> Verdict:
    v = Verdict()
    if truncated:
        v.fail("truncated_response", hard=True)
    if not wines:
        v.fail("no_wines_extracted", hard=True)
        return v

    if not has_text:
        # Scanned PDF — no independent signal to check against.
        v.fail("no_text_layer_for_verification")
    elif priced_lines:
        ratio = len(wines) / priced_lines
        if not (COVERAGE_OK[0] <= ratio <= COVERAGE_OK[1]):
            v.fail(f"coverage_out_of_band:{ratio:.2f}")

    nulls = sum(1 for w in wines
                if w.get("price_glass") is None and w.get("price_bottle") is None)
    if nulls / len(wines) > MAX_NULL_PRICE_RATIO:
        v.fail(f"unpriced_wines:{nulls}/{len(wines)}")

    producers = sum(1 for w in wines if w.get("producer"))
    if producers / len(wines) < MIN_PRODUCER_RATIO:
        v.fail(f"missing_producers:{len(wines) - producers}/{len(wines)}")

    keys = [(str(w.get("producer") or "").lower().strip(),
             str(w.get("name") or "").lower().strip(),
             w.get("vintage")) for w in wines]
    dupes = len(keys) - len(set(keys))
    if dupes:
        v.fail(f"duplicate_entries:{dupes}")

    # Haiku's measured failure mode: region/grape stuffed into `name`.
    avg_words = sum(len(str(w.get("name") or "").split()) for w in wines) / len(wines)
    if avg_words > MAX_NAME_WORDS:
        v.fail(f"name_field_bloated:{avg_words:.1f}_words")

    return v


# ---------------------------------------------------------------------------
# Labeling
# ---------------------------------------------------------------------------

def label(client, model: str, pdf_b64: str, effort: str | None,
          retries: int = 3) -> tuple[list[dict], bool, dict]:
    """Return (wines, truncated, usage). Retries transient failures."""
    body = {
        "model": model,
        "max_tokens": 16000,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "document", "source": {
                    "type": "base64", "media_type": "application/pdf", "data": pdf_b64}},
                {"type": "text", "text": INSTRUCTION},
            ],
        }],
        "system": SYSTEM,
    }
    extra: dict[str, Any] = {
        "output_config": {"format": {"type": "json_schema", "schema": SCHEMA}}
    }
    if effort:
        extra["output_config"]["effort"] = effort

    last = None
    for attempt in range(retries):
        try:
            resp = client.messages.create(**body, extra_body=extra)
            break
        except Exception as e:  # noqa: BLE001 — surface after retries
            last = e
            msg = str(e)
            if "output_config" in msg or "effort" in msg or "json_schema" in msg:
                extra = {}
                continue
            time.sleep(2 ** attempt)
    else:
        raise RuntimeError(f"labeling failed after {retries} attempts: {last}")

    text = "".join(b.text for b in resp.content if b.type == "text")
    truncated = getattr(resp, "stop_reason", None) == "max_tokens"
    try:
        wines = json.loads(text)["wines"]
    except Exception:
        m = re.search(r"\{.*\}", text, re.S)
        wines = json.loads(m.group(0))["wines"] if m else []

    u = resp.usage
    usage = {
        "input_tokens": u.input_tokens,
        "output_tokens": u.output_tokens,
    }
    return wines, truncated, usage


def build_record(pdf_path: str, wines: list[dict], meta: dict, mode: str,
                 menu_text: str, pdf_b64: str) -> dict:
    """One chat-format training record."""
    if mode == "vision":
        user_content: Any = [
            {"type": "document", "source": {
                "type": "base64", "media_type": "application/pdf", "data": pdf_b64}},
            {"type": "text", "text": INSTRUCTION},
        ]
    else:
        user_content = f"{INSTRUCTION}\n\n--- MENU ---\n{menu_text}"

    return {
        "system": SYSTEM,
        "messages": [
            {"role": "user", "content": user_content},
            {"role": "assistant",
             "content": json.dumps({"wines": wines}, ensure_ascii=False)},
        ],
        "meta": meta,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pdf-dir", default="datasets/annotation_inbox/pdfs")
    ap.add_argument("--out", default="datasets/finetune/menu_extraction",
                    help="output prefix; writes <prefix>.train.jsonl, .holdout.jsonl, .report.json")
    ap.add_argument("--teacher", default="claude-opus-5")
    ap.add_argument("--effort", default="low",
                    help="effort for the teacher; ignored on models without it")
    ap.add_argument("--mode", choices=["text", "vision"], default="text",
                    help="text = menu text layer as input (small, cheap to train); "
                         "vision = embed the PDF as base64 (large)")
    ap.add_argument("--min-confidence", choices=["high", "low", "all"], default="high",
                    help="minimum verifier confidence to include in train split")
    ap.add_argument("--holdout", type=float, default=0.2)
    ap.add_argument("--limit", type=int, default=0, help="0 = all PDFs")
    ap.add_argument("--seed", type=int, default=17)
    ap.add_argument("--dry-run", action="store_true",
                    help="verify + report without calling the API")
    args = ap.parse_args()

    pdfs = sorted(
        os.path.join(args.pdf_dir, f)
        for f in os.listdir(args.pdf_dir)
        if f.lower().endswith(".pdf")
    )
    if args.limit:
        pdfs = pdfs[: args.limit]
    if not pdfs:
        sys.exit(f"no PDFs under {args.pdf_dir}")

    client = None if args.dry_run else anthropic.Anthropic()
    records: list[dict] = []
    report: dict[str, Any] = {
        "teacher": args.teacher, "mode": args.mode,
        "pdfs": len(pdfs), "files": [], "totals": {},
    }
    tot_in = tot_out = 0

    for i, path in enumerate(pdfs, 1):
        name = os.path.basename(path)
        try:
            menu_text, pages, priced = read_text_layer(path)
        except Exception as e:  # noqa: BLE001
            print(f"[{i}/{len(pdfs)}] {name}: text layer failed ({e})", flush=True)
            continue

        raw = open(path, "rb").read()
        sha = hashlib.sha256(raw).hexdigest()[:16]
        has_text = len(menu_text.strip()) > 200

        if args.dry_run:
            print(f"[{i}/{len(pdfs)}] {name}: {pages}p, {priced} priced lines, "
                  f"text_layer={'yes' if has_text else 'NO (scanned)'}", flush=True)
            report["files"].append(
                {"file": name, "pages": pages, "priced_lines": priced,
                 "has_text_layer": has_text, "sha256": sha})
            continue

        pdf_b64 = base64.standard_b64encode(raw).decode()
        try:
            wines, truncated, usage = label(client, args.teacher, pdf_b64, args.effort)
        except Exception as e:  # noqa: BLE001
            print(f"[{i}/{len(pdfs)}] {name}: LABEL FAILED — {e}", flush=True)
            report["files"].append({"file": name, "error": str(e)[:200]})
            continue

        tot_in += usage["input_tokens"]
        tot_out += usage["output_tokens"]
        v = verify(wines, priced, has_text, truncated)
        meta = {
            "source_pdf": name,
            "sha256": sha,
            "pages": pages,
            "teacher_model": args.teacher,
            "extracted_wines": len(wines),
            "text_layer_priced_lines": priced,
            "coverage_ratio": round(len(wines) / priced, 3) if priced else None,
            "has_text_layer": has_text,
            "confidence": v.confidence,
            "flags": v.flags,
            "usage": usage,
        }
        report["files"].append(meta)
        print(f"[{i}/{len(pdfs)}] {name}: {len(wines)} wines, {pages}p, "
              f"{v.confidence}{' ' + ','.join(v.flags) if v.flags else ''}", flush=True)

        if v.confidence == "reject":
            continue
        records.append(build_record(path, wines, meta, args.mode, menu_text, pdf_b64))

    if args.dry_run:
        os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
        json.dump(report, open(f"{args.out}.report.json", "w"), indent=1)
        print(f"\ndry run — wrote {args.out}.report.json")
        return 0

    wanted = {"high": {"high"}, "low": {"high", "low"},
              "all": {"high", "low"}}[args.min_confidence]
    kept = [r for r in records if r["meta"]["confidence"] in wanted]
    dropped = len(records) - len(kept)

    random.Random(args.seed).shuffle(kept)
    n_hold = max(1, int(len(kept) * args.holdout)) if len(kept) > 1 else 0
    holdout, train = kept[:n_hold], kept[n_hold:]

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    for split, rows in (("train", train), ("holdout", holdout)):
        p = f"{args.out}.{split}.jsonl"
        with open(p, "w") as fh:
            for r in rows:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
        size = os.path.getsize(p) / 1024 / 1024
        wines = sum(r["meta"]["extracted_wines"] for r in rows)
        print(f"{split:8} {len(rows):3} menus, {wines:5} wines, {size:6.2f} MB  {p}")

    report["totals"] = {
        "labeled": len(records), "kept": len(kept), "dropped_by_confidence": dropped,
        "train": len(train), "holdout": len(holdout),
        "input_tokens": tot_in, "output_tokens": tot_out,
    }
    json.dump(report, open(f"{args.out}.report.json", "w"), indent=1)
    print(f"\ndropped {dropped} record(s) below --min-confidence {args.min_confidence}")
    print(f"report: {args.out}.report.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
