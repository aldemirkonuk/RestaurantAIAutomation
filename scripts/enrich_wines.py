#!/usr/bin/env python3
"""
Stage 2 of the library backfill: enrich extracted wines with library features.

    python3 scripts/enrich_wines.py --in /tmp/corpus --out /tmp/enriched

A menu line gives you a name, a producer, a vintage and a price. The library
holds ~35 attributes per wine. This fills the gap from model knowledge, in
batches, at roughly a tenth of a cent per wine.

THE HONESTY PROBLEM, AND HOW IT IS HANDLED
------------------------------------------
Model knowledge is not a source. For Chateau Margaux the model genuinely knows
the wine; for a 200-case natural Friulano it does not, and asking anyway
produces a fluent, confident, invented tasting note. That failure is invisible
downstream unless it is recorded, and a library full of invented tannin levels
is worse than an empty one because nothing marks it as guessed.

So every wine is labelled by the model with how it arrived at the answer:

  known     recognises this specific producer + wine
  inferred  does not know this bottling, but grape/region/appellation imply
            the typical profile — a real inference, explicitly not a fact
  unknown   cannot say

That label drives field_confidences, review_status and library_tier, so a
consumer can always tell a recalled fact from a reasoned default. `inferred`
rows are exactly the population the web-research agent should verify, and they
are marked so it can find them.

Identity fields the MENU already stated (name, producer, vintage, prices) are
never overwritten by the model — those are observed, not inferred.
"""
from __future__ import annotations

import argparse
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

ROOT = pathlib.Path(__file__).resolve().parent.parent
SSL_CTX = ssl.create_default_context(cafile=certifi.where())
API = "https://api.anthropic.com/v1/messages"

# Controlled vocabularies. Free text here would make the columns unqueryable —
# "quite tannic" and "high" must not be two different values.
SCHEMA = """{
  "i": <input index>,
  "knowledge": "known" | "inferred" | "unknown",
  "primary_type": "red"|"white"|"rose"|"sparkling"|"dessert"|"fortified"|"orange",
  "grape_variety": "<primary grape(s), comma separated>",
  "country": "<country>",
  "region": "<major region>",
  "sub_region": "<sub-region or null>",
  "appellation": "<appellation/AVA/DOC or null>",
  "appellation_class": "<e.g. 'Barolo DOCG', 'Grand Cru' or null>",
  "body": "light"|"medium-light"|"medium"|"medium-full"|"full",
  "sweetness": "dry"|"off-dry"|"medium-sweet"|"sweet",
  "acidity": "low"|"medium-low"|"medium"|"medium-high"|"high",
  "tannins": "none"|"low"|"medium"|"medium-high"|"high",
  "texture": "crisp"|"silky"|"velvety"|"grippy"|"creamy"|"structured",
  "finish": "short"|"medium"|"long",
  "alcohol_pct": <number>,
  "alcohol_level": "low"|"medium-low"|"medium"|"medium-high"|"high",
  "primary_aromas": ["<fruit/floral, 2-4>"],
  "secondary_aromas": ["<winemaking: yeast, butter, vanilla, 0-3>"],
  "tertiary_aromas": ["<ageing: leather, tobacco, honey, 0-3>"],
  "aroma_complexity": "low"|"medium"|"high",
  "flavor_intensity": "delicate"|"moderate"|"pronounced",
  "flavor_profile": ["<2-4 descriptors>"],
  "quality_level": "entry"|"standard"|"premium"|"luxury"|"icon",
  "producer_tier": "emerging"|"established"|"renowned"|"cult",
  "reserve_status": <true|false>,
  "serving_temp_celsius": <number>,
  "glass_type": "<e.g. Bordeaux, Burgundy, Universal, Flute>",
  "decanting_recommended": <true|false>,
  "aging_potential_years": <number>,
  "farming": "conventional"|"sustainable"|"organic"|"biodynamic"|null,
  "aging_vessel": "<e.g. French oak, stainless steel, amphora>"|null
}"""

PROMPT = f"""You are a master sommelier building a reference wine database.

For each wine below, return its attributes as JSON. One object per wine, same
order, in a JSON array. Use EXACTLY this shape and only these enum values:

{SCHEMA}

The `knowledge` field is the most important one and must be honest:
- "known"    — you recognise this specific producer and this specific wine.
- "inferred" — you do NOT know this particular bottling, but the grape, region
               and appellation let you give the typical profile for that style.
- "unknown"  — you cannot even infer a style. Set the attribute fields to null.

Do not guess a producer's farming practices, aging vessel or awards unless
`knowledge` is "known" — use null. An invented specific is far worse than a
null, because it cannot be distinguished from a real one later.

`farming` and `aging_vessel` are the fields most often unknown. Prefer null.

Return ONLY the JSON array, no prose.

Wines:
"""


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


def load_env() -> dict:
    env = dict(os.environ)
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                env.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    return env


def describe(w: dict) -> str:
    bits = [w.get("producer") or "", w.get("name") or ""]
    if w.get("vintage"):
        bits.append(str(w["vintage"]))
    for f in ("region", "grape_variety", "category"):
        if w.get(f):
            bits.append(str(w[f]))
    return " | ".join(b for b in bits if b)


class Enricher:
    def __init__(self, key: str, model: str):
        self.key, self.model = key, model
        self.calls = self.in_tok = self.out_tok = 0

    def call(self, wines: list[dict]) -> list[dict]:
        listing = "\n".join(f"{i}. {describe(w)}" for i, w in enumerate(wines))
        payload = json.dumps({
            "model": self.model,
            "max_tokens": 16000,
            "messages": [{"role": "user", "content": PROMPT + listing}],
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
                    print(f"    enrich HTTP {e.code}: {detail}", flush=True)
                    return []
                time.sleep(5 * (attempt + 1))
            except Exception as e:
                if attempt == 4:
                    print(f"    enrich failed: {e}", flush=True)
                    return []
                time.sleep(5 * (attempt + 1))
        u = data.get("usage", {})
        self.calls += 1
        self.in_tok += u.get("input_tokens", 0)
        self.out_tok += u.get("output_tokens", 0)
        text = response_text(data)
        cleaned = re.sub(r"```(?:json)?\n?", "", text).strip()
        try:
            parsed = json.loads(cleaned)
            return parsed if isinstance(parsed, list) else []
        except Exception:
            # Same salvage rationale as extraction: a cut-off array still holds
            # complete objects, and losing 20 wines to one truncation is waste.
            out, depth, start, in_str, esc = [], 0, -1, False, False
            for i, ch in enumerate(cleaned):
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = not in_str
                elif not in_str:
                    if ch == "{":
                        if depth == 0:
                            start = i
                        depth += 1
                    elif ch == "}":
                        depth -= 1
                        if depth == 0 and start != -1:
                            try:
                                out.append(json.loads(cleaned[start:i + 1]))
                            except Exception:
                                pass
                            start = -1
            return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", default="/tmp/corpus")
    ap.add_argument("--out", default="/tmp/enriched")
    ap.add_argument("--model", default="claude-haiku-4-5")
    ap.add_argument("--batch", type=int, default=20)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--limit", type=int, help="only enrich the first N wines (for trials)")
    ap.add_argument("--no-resume", action="store_true",
                    help="re-enrich everything, ignoring existing output")
    args = ap.parse_args()

    env = load_env()
    key = env.get("ANTHROPIC_API_KEY")
    if not key:
        raise SystemExit("ANTHROPIC_API_KEY not set")

    inp, out = pathlib.Path(args.inp), pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    # De-duplicate across menus before spending anything: the same wine on two
    # lists is one library row and must not be enriched twice.
    seen, wines = {}, []
    for f in sorted(inp.glob("*.json")):
        if f.name == "manifest.json":
            continue
        doc = json.loads(f.read_text())
        for w in doc["wines"]:
            key_t = tuple(
                re.sub(r"[^a-z0-9]+", " ", str(w.get(x) or "").lower()).strip()
                for x in ("producer", "name", "vintage")
            )
            if key_t in seen:
                seen[key_t]["menus"].append(doc["menu"])
                continue
            rec = {**w, "menus": [doc["menu"]]}
            seen[key_t] = rec
            wines.append(rec)

    if args.limit:
        wines = wines[: args.limit]

    # Resume. A long run can die part-way — the first full pass lost 105 of 225
    # batches to an exhausted API credit balance — and re-enriching wines that
    # already succeeded is money spent to overwrite identical data. Keyed on the
    # same (producer, name, vintage) triple used for de-duplication.
    previous: dict = {}
    prior_file = out / "enriched.json"
    if prior_file.exists() and not args.no_resume:
        for rec in json.loads(prior_file.read_text()):
            if rec.get("enrichment"):
                x = rec["extracted"]
                previous[tuple(
                    re.sub(r"[^a-z0-9]+", " ", str(x.get(f) or "").lower()).strip()
                    for f in ("producer", "name", "vintage")
                )] = rec["enrichment"]

    def wine_key(w):
        return tuple(
            re.sub(r"[^a-z0-9]+", " ", str(w.get(f) or "").lower()).strip()
            for f in ("producer", "name", "vintage")
        )

    todo = [w for w in wines if wine_key(w) not in previous]
    print(f"{len(wines)} distinct wine(s); {len(previous)} already enriched, "
          f"{len(todo)} to do with {args.model}\n", flush=True)

    en = Enricher(key, args.model)
    batches = [todo[i:i + args.batch] for i in range(0, len(todo), args.batch)]
    results: dict[int, dict] = {}

    def work(bi: int, batch: list[dict]):
        got = en.call(batch)
        by_i = {g["i"]: g for g in got if isinstance(g.get("i"), int)}
        return bi, [by_i.get(j) for j in range(len(batch))]

    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(work, bi, b): bi for bi, b in enumerate(batches)}
        for fut in as_completed(futs):
            bi, got = fut.result()
            for j, g in enumerate(got):
                results[bi * args.batch + j] = g
            done += 1
            if done % 10 == 0 or done == len(batches):
                print(f"  {done}/{len(batches)} batches", flush=True)

    fresh = {}
    for idx, w in enumerate(todo):
        if results.get(idx):
            fresh[wine_key(w)] = results[idx]

    merged, counts = [], {"known": 0, "inferred": 0, "unknown": 0, "missing": 0}
    for w in wines:
        e = fresh.get(wine_key(w)) or previous.get(wine_key(w))
        k = (e or {}).get("knowledge")
        counts[k if k in counts else "missing"] += 1
        merged.append({"extracted": w, "enrichment": e})

    (out / "enriched.json").write_text(json.dumps(merged, ensure_ascii=False, indent=1))
    cost = en.in_tok * 1e-6 + en.out_tok * 5e-6
    if "sonnet" in args.model:
        cost = en.in_tok * 3e-6 + en.out_tok * 15e-6
    (out / "manifest.json").write_text(json.dumps({
        "model": args.model, "wines": len(wines), "calls": en.calls,
        "input_tokens": en.in_tok, "output_tokens": en.out_tok,
        "cost_usd": round(cost, 4), "knowledge": counts,
    }, indent=1))

    print(f"\n{len(wines)} wines: " + "  ".join(f"{k}={v}" for k, v in counts.items()))
    print(f"{en.calls} calls, {en.in_tok:,} in / {en.out_tok:,} out, ${cost:.2f}")
    if counts["missing"]:
        print(f"\n*** {counts['missing']} wine(s) have NO enrichment — the run did not "
              f"complete. Re-run the same command to resume; finished wines are "
              f"not re-charged. ***")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
