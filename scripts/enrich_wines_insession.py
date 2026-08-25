#!/usr/bin/env python3
"""Stage 2 of the library backfill, run by the agent instead of the API (A10).

WHY THIS EXISTS
---------------
`scripts/enrich_wines.py` pays api.anthropic.com per wine. On 2026-08-18 that
balance ran out mid-backfill with 1,448 wine-classified entries still
unenriched, and buying credits is not something an agent may do. The knowledge
being bought, though, is the same knowledge the agent already has: this script
lets a Claude Code session BE the model, so the remaining backfill costs
nothing beyond the session itself.

It is a harness, not a second enricher. Everything that defines the output --
the schema, the controlled vocabularies, the prompt, the (producer, name,
vintage) key, the honesty contract around `knowledge` -- is imported from
enrich_wines.py rather than restated. A second, drifting copy of that
vocabulary is the "one fact, two homes" defect the beverage plan closes
everywhere else (arch §4.1); it would be absurd to introduce one here.

WHAT IS STRICTER THAN THE API PATH, DELIBERATELY
------------------------------------------------
The API prompt *asks* the model to be honest: null the attributes when
`knowledge` is "unknown", and never guess `farming` or `aging_vessel` unless
`knowledge` is "known". Asking is not a guarantee. This path ENFORCES both
mechanically at merge time -- the same reasoning that made the sensory columns
`GENERATED ALWAYS AS` instead of a trigger (arch §4.1, register A12): a rule no
writer can forget beats a rule every writer is asked to remember. Rows enriched
this way are therefore never *less* honest than API-enriched rows, and the
`enrichment_source` marker below makes the two populations separable if that
difference ever needs auditing.

SAFETY, GIVEN WHAT ALREADY WENT WRONG HERE
------------------------------------------
On 2026-08-17 a filtered `--out` truncated enriched.json from 4,499 entries to
3 and destroyed ~$4.35 of paid enrichment (recovered from git). This script
therefore never rewrites the corpus from a work set. It merges in place, and
before replacing the file it asserts that:

  * the entry count is unchanged,
  * no record that was already enriched changed in any byte,
  * no enriched record became unenriched.

Any violation aborts before the write. The write itself is atomic
(tempfile + os.replace) so an interrupted run cannot leave a half-written
corpus.

Batches are keyed by an explicit `ref` into a frozen queue AND echo the wine's
name, which merge re-checks. An off-by-one in a hand-written batch would
otherwise staple one bottle's tasting note onto a different bottle -- a false
merge of enrichment, the exact failure class arch §3.9 prices at ~100:1.

USAGE
-----
    python3 scripts/enrich_wines_insession.py plan          # freeze the queue
    python3 scripts/enrich_wines_insession.py next --size 25 # emit a batch
    ... agent writes the JSON array ...
    python3 scripts/enrich_wines_insession.py merge --file batch.json
    python3 scripts/enrich_wines_insession.py status

`plan` needs the database only to reuse `wine_classify_beverage_kind()` for
the wine/non-wine split (same call as build_wine_only_enrichment_input.py, same
reason: the classifier has one home). `next`, `merge` and `status` are offline.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import pathlib
import re
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENRICHED = ROOT / "datasets/menu_corpus/enriched/enriched.json"
QUEUE = ROOT / "datasets/menu_corpus/enriched/insession_queue.json"

# enrich_wines.py is a script, not a package module; load it by path so the
# schema, prompt and describe() have exactly one home.
_spec = importlib.util.spec_from_file_location(
    "enrich_wines", ROOT / "scripts/enrich_wines.py")
enrich_wines = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(enrich_wines)

SOURCE_MARKER = "in_session"

# Fields the loader reads out of each enrichment (load_enriched_wines.blocks()
# plus the identity/serving fields), by type. Anything not listed is rejected,
# so a typo'd key cannot slip into the corpus as a silently-ignored no-op.
LIST_FIELDS = {"primary_aromas", "secondary_aromas", "tertiary_aromas",
               "flavor_profile"}
NUM_FIELDS = {"alcohol_pct", "serving_temp_celsius", "aging_potential_years"}
BOOL_FIELDS = {"reserve_status", "decanting_recommended"}
TEXT_FIELDS = {"grape_variety", "country", "region", "sub_region",
               "appellation", "appellation_class", "glass_type",
               "aging_vessel"}

# Every attribute field -- i.e. everything except the index and the honesty
# label. `knowledge: "unknown"` nulls all of these.
ATTRIBUTE_FIELDS: set[str] = set()


def parse_enums(schema: str) -> dict[str, set]:
    """Read the controlled vocabularies straight out of enrich_wines.SCHEMA.

    Deriving them beats restating them: if a vocabulary ever gains a value,
    the API path and this path gain it together or this script fails loudly,
    and there is no third place to update.
    """
    enums: dict[str, set] = {}
    for line in schema.splitlines():
        m = re.match(r'^\s*"(\w+)":\s*(.+?)\s*$', line)
        if not m:
            continue
        key, rhs = m.group(1), m.group(2).rstrip(",").strip()
        tokens = [t.strip() for t in rhs.split("|")]
        values = set()
        for t in tokens:
            if t == "null":
                values.add(None)
            elif len(t) > 1 and t[0] == '"' and t[-1] == '"' and t[1] != "<":
                values.add(t[1:-1])
            else:
                values = None
                break
        if values:
            enums[key] = values
    return enums


ENUMS = parse_enums(enrich_wines.SCHEMA)
ATTRIBUTE_FIELDS = (set(ENUMS) | LIST_FIELDS | NUM_FIELDS | BOOL_FIELDS
                    | TEXT_FIELDS) - {"knowledge"}
ALLOWED_FIELDS = ATTRIBUTE_FIELDS | {"knowledge", "i"}

# The parse is only trustworthy if it actually found the vocabularies. Assert
# rather than silently validate nothing -- a validator that passes everything
# is worse than no validator, because it reads as a guarantee.
_REQUIRED_ENUMS = {"knowledge", "primary_type", "body", "sweetness", "acidity",
                   "tannins", "texture", "finish", "alcohol_level",
                   "aroma_complexity", "flavor_intensity", "quality_level",
                   "producer_tier", "farming"}
_missing = _REQUIRED_ENUMS - set(ENUMS)
if _missing:
    raise SystemExit(
        f"enrich_wines.SCHEMA no longer parses as expected; missing enums: "
        f"{sorted(_missing)}. Fix parse_enums() rather than hardcoding values.")


def wine_key(w: dict) -> tuple:
    """The (producer, name, vintage) triple, identical to enrich_wines.py."""
    return tuple(
        re.sub(r"[^a-z0-9]+", " ", str(w.get(f) or "").lower()).strip()
        for f in ("producer", "name", "vintage")
    )


def load_corpus() -> list[dict]:
    return json.loads(ENRICHED.read_text())


def write_corpus(records: list[dict]) -> None:
    """Atomic replace: an interrupted write must not leave a partial corpus."""
    ENRICHED.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(ENRICHED.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(records, fh, ensure_ascii=False, indent=1)
        os.replace(tmp, ENRICHED)
    except BaseException:
        pathlib.Path(tmp).unlink(missing_ok=True)
        raise


# ---------------------------------------------------------------- plan


def cmd_plan(args) -> int:
    """Freeze the work queue: wine-classified entries with no enrichment.

    Frozen because `ref` values in emitted batches must stay meaningful across
    invocations; a queue recomputed per call would renumber itself as entries
    are enriched, and a batch written against the old numbering would merge
    onto the wrong wines.
    """
    import psycopg2

    dsn = os.environ.get("SUPABASE_DB_URL")
    if not dsn:
        dsn = next(
            line.split("=", 1)[1].strip()
            for line in (ROOT / ".env").read_text().splitlines()
            if line.startswith("SUPABASE_DB_URL=")
        )
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    cur = conn.cursor()

    docs = load_corpus()
    unenriched = [d for d in docs if d.get("enrichment") is None]

    categories = sorted({(d.get("extracted", {}).get("category") or "").strip()
                         for d in unenriched})
    kind: dict[str, str] = {}
    for category in categories:
        cur.execute("SELECT kind FROM wine_classify_beverage_kind(NULL, %s)",
                    (category,))
        kind[category] = cur.fetchone()[0]

    queue = []
    skipped: dict[str, int] = {}
    for d in unenriched:
        x = d.get("extracted", {})
        k = kind.get((x.get("category") or "").strip(), "unknown")
        if k != "wine":
            skipped[k] = skipped.get(k, 0) + 1
            continue
        queue.append({
            "ref": len(queue),
            "key": list(wine_key(x)),
            "name": x.get("name"),
            "producer": x.get("producer"),
            "describe": enrich_wines.describe(x),
        })

    QUEUE.write_text(json.dumps(
        {"total": len(queue), "items": queue}, ensure_ascii=False, indent=1))
    print(f"corpus: {len(docs)} entries, {len(unenriched)} unenriched")
    print(f"queued (wine-classified): {len(queue)}")
    print(f"skipped as non-wine (now in beverages/cocktails): {skipped}")
    print(f"\nwrote {QUEUE.relative_to(ROOT)}")
    return 0


def load_queue() -> list[dict]:
    if not QUEUE.exists():
        raise SystemExit("no queue; run `plan` first")
    return json.loads(QUEUE.read_text())["items"]


def enriched_keys() -> set:
    return {wine_key(d["extracted"]) for d in load_corpus()
            if d.get("enrichment") is not None}


# ---------------------------------------------------------------- next


def cmd_next(args) -> int:
    """Emit the next N still-unenriched queue items, in prompt form."""
    done = enriched_keys()
    todo = [q for q in load_queue() if tuple(q["key"]) not in done]
    batch = todo[args.skip: args.skip + args.size]
    if not batch:
        print("nothing left to enrich")
        return 0

    print(f"# {len(todo)} remaining; emitting {len(batch)}\n")
    print(enrich_wines.PROMPT.replace(
        '"i": <input index>', '"i": <ref, exactly as given>'))
    for q in batch:
        print(f'{q["ref"]}. {q["describe"]}')
    print("\n# Echo `name` verbatim in each object alongside `i`; merge "
          "rejects the batch if any name does not match its ref.")
    if args.out:
        pathlib.Path(args.out).write_text(json.dumps(batch, ensure_ascii=False,
                                                     indent=1))
        print(f"\n# refs written to {args.out}")
    return 0


# ---------------------------------------------------------------- merge


def validate(rec: dict, queue_item: dict) -> list[str]:
    errs = []
    unknown = set(rec) - ALLOWED_FIELDS - {"name"}
    if unknown:
        errs.append(f"unknown field(s): {sorted(unknown)}")
    if rec.get("name") is not None and rec["name"] != queue_item["name"]:
        errs.append(f"name mismatch: ref {queue_item['ref']} is "
                    f"{queue_item['name']!r}, batch says {rec['name']!r}")
    k = rec.get("knowledge")
    if k not in ENUMS["knowledge"]:
        errs.append(f"knowledge={k!r} not in {sorted(ENUMS['knowledge'])}")
    for f, allowed in ENUMS.items():
        if f == "knowledge" or f not in rec:
            continue
        if rec[f] not in allowed:
            errs.append(f"{f}={rec[f]!r} not in "
                        f"{sorted(v for v in allowed if v is not None)}")
    for f in LIST_FIELDS & set(rec):
        v = rec[f]
        if v is not None and not (isinstance(v, list)
                                  and all(isinstance(s, str) for s in v)):
            errs.append(f"{f} must be a list of strings or null, got {v!r}")
    for f in NUM_FIELDS & set(rec):
        v = rec[f]
        if v is not None and not isinstance(v, (int, float)):
            errs.append(f"{f} must be a number or null, got {v!r}")
    for f in BOOL_FIELDS & set(rec):
        if not isinstance(rec[f], bool):
            errs.append(f"{f} must be true/false, got {rec[f]!r}")
    for f in TEXT_FIELDS & set(rec):
        v = rec[f]
        if v is not None and not isinstance(v, str):
            errs.append(f"{f} must be a string or null, got {v!r}")
    return errs


def apply_honesty_contract(rec: dict) -> list[str]:
    """Enforce what the API prompt can only request. Returns what it changed."""
    changed = []
    if rec.get("knowledge") == "unknown":
        for f in ATTRIBUTE_FIELDS & set(rec):
            if rec[f] not in (None, [], False):
                rec[f] = None
                changed.append(f"unknown -> nulled {f}")
    if rec.get("knowledge") != "known":
        for f in ("farming", "aging_vessel"):
            if rec.get(f) is not None:
                rec[f] = None
                changed.append(f"not known -> nulled {f}")
    return changed


def cmd_merge(args) -> int:
    payload = json.loads(pathlib.Path(args.file).read_text())
    if not isinstance(payload, list):
        raise SystemExit("batch file must be a JSON array")

    queue = {q["ref"]: q for q in load_queue()}
    corpus = load_corpus()
    by_key: dict[tuple, list[int]] = {}
    for idx, d in enumerate(corpus):
        by_key.setdefault(wine_key(d["extracted"]), []).append(idx)

    before_count = len(corpus)
    before_enriched = {
        wine_key(d["extracted"]): json.dumps(d, sort_keys=True,
                                             ensure_ascii=False)
        for d in corpus if d.get("enrichment") is not None
    }

    errors, staged, skipped, normalized = [], [], 0, 0
    for n, rec in enumerate(payload):
        ref = rec.get("i")
        if ref not in queue:
            errors.append(f"[{n}] i={ref!r} is not a queue ref")
            continue
        q = queue[ref]
        errs = validate(rec, q)
        if errs:
            errors.extend(f"[ref {ref}] {e}" for e in errs)
            continue
        key = tuple(q["key"])
        if key not in by_key:
            errors.append(f"[ref {ref}] key {key} not present in corpus")
            continue
        if all(corpus[i].get("enrichment") is not None for i in by_key[key]):
            skipped += 1
            continue
        clean = {k: v for k, v in rec.items() if k in ALLOWED_FIELDS}
        if apply_honesty_contract(clean):
            normalized += 1
        staged.append((key, clean))

    if errors:
        print(f"REJECTED — {len(errors)} problem(s), nothing written:\n")
        for e in errors[:40]:
            print(f"  {e}")
        if len(errors) > 40:
            print(f"  ... and {len(errors) - 40} more")
        return 1

    for key, clean in staged:
        for i in by_key[key]:
            if corpus[i].get("enrichment") is None:
                corpus[i]["enrichment"] = clean
                corpus[i]["enrichment_source"] = SOURCE_MARKER

    # Invariants. Any failure aborts before the corpus is touched.
    after_enriched = {
        wine_key(d["extracted"]): json.dumps(d, sort_keys=True,
                                             ensure_ascii=False)
        for d in corpus if d.get("enrichment") is not None
    }
    problems = []
    if len(corpus) != before_count:
        problems.append(f"entry count changed {before_count} -> {len(corpus)}")
    for key, blob in before_enriched.items():
        if key not in after_enriched:
            problems.append(f"previously-enriched row lost: {key}")
        elif after_enriched[key] != blob:
            problems.append(f"previously-enriched row modified: {key}")
    if problems:
        print("ABORTED — invariant violation, corpus not written:\n")
        for p in problems[:20]:
            print(f"  {p}")
        return 1

    write_corpus(corpus)
    print(f"merged {len(staged)} wine(s)"
          + (f", {skipped} already enriched (skipped)" if skipped else "")
          + (f", {normalized} normalized by the honesty contract"
             if normalized else ""))
    print(f"corpus: {len(corpus)} entries, "
          f"{len(after_enriched)} enriched, "
          f"{len(corpus) - len(after_enriched)} unenriched")
    return 0


# ---------------------------------------------------------------- status


def cmd_status(args) -> int:
    corpus = load_corpus()
    done = {wine_key(d["extracted"]) for d in corpus
            if d.get("enrichment") is not None}
    in_session = sum(1 for d in corpus
                     if d.get("enrichment_source") == SOURCE_MARKER)
    print(f"corpus       {len(corpus)} entries")
    print(f"enriched     {len(done)} ({in_session} in-session, "
          f"{len(done) - in_session} via API)")
    print(f"unenriched   {len(corpus) - len(done)}")
    if QUEUE.exists():
        queue = load_queue()
        left = [q for q in queue if tuple(q["key"]) not in done]
        print(f"\nA10 queue    {len(queue)} wine-classified, "
              f"{len(queue) - len(left)} done, {len(left)} to go")
    else:
        print("\nA10 queue    not built yet — run `plan`")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("plan", help="freeze the wine-only work queue")
    p.set_defaults(fn=cmd_plan)

    p = sub.add_parser("next", help="emit the next N unenriched wines")
    p.add_argument("--size", type=int, default=25)
    p.add_argument("--skip", type=int, default=0)
    p.add_argument("--out", help="also write the batch's refs to this file")
    p.set_defaults(fn=cmd_next)

    p = sub.add_parser("merge", help="validate and merge a completed batch")
    p.add_argument("--file", required=True)
    p.set_defaults(fn=cmd_merge)

    p = sub.add_parser("status", help="how much is left")
    p.set_defaults(fn=cmd_status)

    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
