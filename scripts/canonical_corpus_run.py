#!/usr/bin/env python3
"""Run the canonical invariants over every document this database holds.

    ./scripts/canonical_corpus_run.py [--out datasets/canonical]

ADR 0104 D12 slice 1: "the canonical object, its invariants ... run as a test
suite over the documents already in `vendor-attachments` -- failures NAMED".
This is that runner.

READ-ONLY. It issues GET requests and nothing else; there is no INSERT, UPDATE
or DELETE anywhere in this file, and the service key is read from
apps/api-gateway/.env and never printed.

WHAT IT WILL FIND TODAY: NOTHING, AND THAT IS THE POINT
------------------------------------------------------
Measured 2026-09-03, before this script existed: `procurement_documents` holds
0 rows, `procurement_document_lines` holds 0 rows, and the `vendor-attachments`
bucket holds 0 objects. The product has never held a vendor document in this
database.

So the headline this script prints is NOT "0 failures". It is:

    0 documents read -- the corpus is empty; the invariants are proven on N
    labelled synthetic fixtures only

That distinction is the whole reason the script is written this way. A report
saying "0 failures" over an empty corpus is this repository's
absence-reported-as-health fault in its purest form: the run succeeded, nothing
was wrong, and nothing was looked at. An empty corpus is an ABSENCE OF EVIDENCE
and the report says so at the top, in those words.

The invariants' actual proof is the fixture suite in
apps/api-gateway/src/procurement/canonical/canonical-invariants.spec.ts, over
nine documents labelled SYNTHETIC in their own file. This runner is the standing
instrument that will name real failures the day the first vendor document
arrives through the receiving flow.

EXIT CODES
    0  ran, and the report was written (INCLUDING over an empty corpus -- an
       empty corpus is a finding, not an error)
    2  COULD NOT RUN: no credentials, an HTTP error, or the Node entry failed.
       Exit 2 is never a pass.
"""

from __future__ import annotations

import argparse
import json
import os
import ssl
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _ssl_context() -> ssl.SSLContext:
    """A verifying context that works on a stock macOS python3.

    python.org builds ship without the system trust store wired in, so
    urlopen raises CERTIFICATE_VERIFY_FAILED against Supabase. `certifi` is
    used when it is installed. Verification is NEVER disabled: an unverified
    read of a production database is not a read this script is willing to make.
    """
    try:
        import certifi  # noqa: PLC0415

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


ENV_FILE = ROOT / "apps" / "api-gateway" / ".env"
CLI = ROOT / "apps" / "api-gateway" / "src" / "procurement" / "canonical" / "cli.ts"
GATEWAY = ROOT / "apps" / "api-gateway"
BUCKET = "vendor-attachments"

# Kept in step with canonical-invariants.spec.ts. Named here so the report can
# say WHAT the invariants were proven on when the corpus is empty.
SYNTHETIC_FIXTURE_COUNT = 9


def read_env(path: Path) -> dict[str, str]:
    """Parse KEY=VALUE from a .env. Values are never logged."""
    if not path.exists():
        return {}
    out: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        out[key.strip()] = value.strip().strip('"').strip("'")
    return out


def get(url: str, key: str, *, prefer: str | None = None) -> tuple[object, dict[str, str]]:
    """One GET. A failure RAISES -- it never returns an empty list."""
    req = urllib.request.Request(url, method="GET")
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    if prefer:
        req.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(req, timeout=60, context=_ssl_context()) as resp:
            body = resp.read().decode("utf-8")
            headers = {k.lower(): v for k, v in resp.headers.items()}
            return (json.loads(body) if body else None), headers
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:400]
        raise RuntimeError(f"HTTP {exc.code} on {url.split('?')[0]}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"could not reach {url.split('?')[0]}: {exc.reason}") from exc


def count_rows(base: str, key: str, table: str) -> int:
    """Exact row count via the Content-Range header. Raises on failure."""
    url = f"{base}/rest/v1/{table}?select=id&limit=1"
    _, headers = get(url, key, prefer="count=exact")
    rng = headers.get("content-range", "")
    # "0-0/12" or "*/0"
    if "/" not in rng:
        raise RuntimeError(f"{table}: no Content-Range in the response ({rng!r})")
    total = rng.rsplit("/", 1)[1]
    if total == "*":
        raise RuntimeError(f"{table}: the server would not state an exact count")
    return int(total)


def _list_prefix(base: str, key: str, bucket: str, prefix: str) -> list[dict] | None:
    """One page of a storage listing under `prefix`, or None when it failed."""
    url = f"{base}/storage/v1/object/list/{bucket}"
    payload = json.dumps({"prefix": prefix, "limit": 1000, "offset": 0}).encode()
    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60, context=_ssl_context()) as resp:
            items = json.loads(resp.read().decode("utf-8") or "[]")
            return items if isinstance(items, list) else None
    except Exception:
        return None


def list_bucket_objects(
    base: str, key: str, bucket: str, max_depth: int = 6
) -> int | None:
    """Objects in a storage bucket, or None when the listing itself failed.

    None is returned rather than 0 on purpose: 'the bucket is empty' and 'we
    could not list the bucket' must not print the same number.

    RECURSIVE, AND THAT IS THE WHOLE POINT. Supabase's list API is a DIRECTORY
    listing: at the root it returns one FOLDER PLACEHOLDER per top-level prefix,
    not the files underneath. This function used to count that top-level page,
    so a bucket holding three PDFs under one restaurant folder reported
    "1 objects" -- and the 2026-09-04 corpus report published that number, which
    is what produced finding 8's premise that "either two uploads never
    persisted their bytes or the signed-URL step fails". Measured 2026-09-05
    with the service role: 5 documents, 5 objects, all five signable and
    fetchable; the top-level page still returns exactly 1 entry. A counter that
    reports a folder count as an object count is this repository's
    absence-as-health fault inside the measuring instrument itself.

    A folder is told from a file by `metadata`: real objects carry a metadata
    object (size, mimetype); placeholders carry `null`.
    """
    seen = 0
    stack: list[tuple[str, int]] = [("", 0)]
    failed = False
    while stack:
        prefix, depth = stack.pop()
        items = _list_prefix(base, key, bucket, prefix)
        if items is None:
            failed = True
            continue
        for item in items:
            name = item.get("name")
            if not name:
                continue
            full = f"{prefix}{name}"
            if item.get("metadata") is None:
                # A folder placeholder. Descend, unless we have gone too deep --
                # depth is bounded so a pathological bucket cannot hang the run.
                if depth < max_depth:
                    stack.append((f"{full}/", depth + 1))
            else:
                seen += 1
    # A listing that failed anywhere returns None rather than a partial count:
    # a number that silently omits a subtree is worse than no number.
    return None if failed else seen


def fetch_all(base: str, key: str, table: str, columns: str, page: int = 1000) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        url = (
            f"{base}/rest/v1/{table}"
            f"?select={urllib.parse.quote(columns)}"
            f"&limit={page}&offset={offset}&order=id.asc"
        )
        batch, _ = get(url, key)
        if not isinstance(batch, list):
            raise RuntimeError(f"{table}: expected a list, got {type(batch).__name__}")
        rows.extend(batch)
        if len(batch) < page:
            return rows
        offset += page


DOC_COLUMNS = (
    "id,restaurant_id,provider_id,doc_type,source_channel,doc_number,doc_date,"
    "references_doc_number,currency,subtotal,freight,fuel_surcharge,split_case_fee,"
    "delivery_fee,deposit_total,tax,other_charges,discount_total,total,"
    "computed_lines_total,tie_out_delta,ties_out,extraction_confidence,"
    "extraction_model,sha256,content_type,file_bytes,storage_path,status,created_at"
)
LINE_COLUMNS = (
    "id,document_id,line_no,vendor_sku,description,vintage,format_ml,qty,uom,"
    "pack_size,qty_bottles,free_goods_qty,unit_price,line_total,allowance,deposit,"
    "order_line_id,match_method,match_confidence"
)

# Migration 20260904120000 (ADR 0104 slice 2). Asked for separately so a database
# that has not applied it yet is told apart from a document that printed no price
# base: PostgREST answers an unknown column with 42703, and the retry below
# records WHICH of the two the report is describing.
DOC_COLUMNS_NEW = ",printed"
LINE_COLUMNS_NEW = ",price_base_qty,price_base_uom,printed"


def fetch_all_tolerating_schema_lag(
    base: str, key: str, table: str, columns: str, extra: str
) -> tuple[list[dict], bool]:
    """Rows, plus whether the new columns had to be dropped to read them.

    A schema lag is a FINDING, not a silent fallback: without the flag the
    report cannot tell "the paper printed no price base" from "this database
    cannot hold one yet", which is the same absence-as-health confusion the
    headline rule exists to prevent.
    """
    try:
        return fetch_all(base, key, table, columns + extra), False
    except RuntimeError as exc:
        if "42703" not in str(exc) and "does not exist" not in str(exc):
            raise
        return fetch_all(base, key, table, columns), True


def run_cli(corpus: list[dict]) -> dict:
    """Run the TYPESCRIPT invariants. A crash is exit 2, never an empty result."""
    proc = subprocess.run(
        ["npx", "ts-node", "-T", str(CLI)],
        input=json.dumps(corpus),
        capture_output=True,
        text=True,
        cwd=str(GATEWAY),
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"the canonical CLI failed (exit {proc.returncode}): {proc.stderr.strip()[:600]}"
        )
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"the canonical CLI produced no JSON: {exc}") from exc


def intake_statistics(docs: list[dict]) -> dict:
    """The shape statistics ADR 0104 D6's intake gate will need."""
    sha_present = sum(1 for d in docs if d.get("sha256"))
    sha_counts = Counter(d["sha256"] for d in docs if d.get("sha256"))
    duplicates = {sha: n for sha, n in sha_counts.items() if n > 1}
    sizes = [d["file_bytes"] for d in docs if isinstance(d.get("file_bytes"), int)]
    return {
        "documents": len(docs),
        "sha256_present": sha_present,
        "sha256_present_share": round(sha_present / len(docs), 4) if docs else None,
        "duplicate_sha256_groups": len(duplicates),
        "duplicate_sha256_documents": sum(duplicates.values()),
        "content_types": dict(Counter(d.get("content_type") or "(none)" for d in docs)),
        "source_channels": dict(Counter(d.get("source_channel") or "(none)" for d in docs)),
        "doc_types": dict(Counter(d.get("doc_type") or "(none)" for d in docs)),
        "statuses": dict(Counter(d.get("status") or "(none)" for d in docs)),
        "bytes_min": min(sizes) if sizes else None,
        "bytes_median": sorted(sizes)[len(sizes) // 2] if sizes else None,
        "bytes_max": max(sizes) if sizes else None,
        # Page count is NOT derivable from these columns -- it needs the object
        # itself. Stated as absent rather than defaulted to 1.
        "page_count": "not recorded in procurement_documents; needs the stored object",
    }


EMPTY_HEADLINE = (
    "0 documents read — the corpus is empty; the invariants are proven on "
    f"{SYNTHETIC_FIXTURE_COUNT} labelled synthetic fixtures only"
)


def write_report(out_dir: Path, today: str, payload: dict) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / f"corpus-run-{today}.json"
    md_path = out_dir / f"CORPUS-RUN-{today}.md"
    json_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")

    docs_read = payload["documents_read"]
    headline = payload["headline"]
    lines: list[str] = [
        f"# Canonical corpus run — {today}",
        "",
        f"**{headline}**",
        "",
        f"- Source: `{payload['project_ref']}` (read-only; nothing was written)",
        f"- `procurement_documents`: {payload['counts']['procurement_documents']} rows",
        f"- `procurement_document_lines`: {payload['counts']['procurement_document_lines']} rows",
        f"- `{BUCKET}` bucket: {payload['counts']['vendor_attachments_objects']} objects",
        "",
    ]

    if payload.get("price_base_columns_missing"):
        lines += [
            "> **Schema lag, named.** This database has not applied migration",
            "> `20260904120000`, so `price_base_qty`, `price_base_uom` and the",
            "> `printed` literals could not be read. Every BT-149/BT-150 and every",
            "> `as printed` below is absent BECAUSE IT COULD NOT BE STORED — not",
            "> because the document printed none. The two are different findings and",
            "> this run is the first kind.",
            "",
        ]

    if docs_read == 0:
        lines += [
            "## What this run proves, and what it does not",
            "",
            "It proves the runner works and that the database holds no vendor",
            "document. It proves NOTHING about the invariants: they were not",
            "exercised, because there was nothing to exercise them on.",
            "",
            "**This is not a pass.** A report saying “0 failures” over an empty",
            "corpus reports absence as health. The invariants' evidence is the",
            f"fixture suite — {SYNTHETIC_FIXTURE_COUNT} documents labelled SYNTHETIC in",
            "`apps/api-gateway/src/procurement/canonical/__fixtures__/synthetic-documents.ts`,",
            "asserted in `canonical-invariants.spec.ts`. Real evidence begins the day",
            "the first vendor document arrives through the receiving flow; this runner",
            "is the standing instrument that will name its failures.",
            "",
            "No corpus was invented and none was seeded.",
            "",
            "The runner's own ability to NAME a failure is proven separately, by",
            "`./scripts/canonical_corpus_run.py --self-test`, which pushes two",
            "synthetic documents — one that ties out, one that does not — through the",
            "same TypeScript invariants and asserts that exactly the broken one is",
            "named. Measured 2026-09-03: 2 documents read, 2 named failures, both on",
            "`synthetic-does-not-tie` (`line_net_amount` expected 528 found 428;",
            "`document_lines_total` expected 428 found 660). Without that check, an",
            "empty report would be indistinguishable from a runner that names nothing.",
            "",
        ]
    else:
        summary = payload["per_invariant"]
        lines += [
            "## Per-invariant results",
            "",
            "| invariant | rule | holds | fails | untestable |",
            "| --- | --- | ---: | ---: | ---: |",
        ]
        for inv, counts in sorted(summary.items()):
            lines.append(
                f"| `{inv}` | {counts.get('rule') or '—'} | {counts['holds']} "
                f"| {counts['fails']} | {counts['untestable']} |"
            )
        lines += [
            "",
            "`untestable` is counted separately on purpose: a document that states",
            "no total did not pass the tie-out, it was never testable.",
            "",
            "## Named failures",
            "",
        ]
        failures = payload["named_failures"]
        if not failures:
            lines.append("None. Every checkable rule held on every document read.")
        else:
            lines += ["| document | invariant | expected | found | why |", "| --- | --- | --- | --- | --- |"]
            for f in failures[:200]:
                lines.append(
                    f"| `{f['document_id']}` | `{f['invariant']}` | {f['expected']} "
                    f"| {f['found']} | {f['explanation']} |"
                )
            if len(failures) > 200:
                lines.append(f"| … | … | … | … | {len(failures) - 200} more in the JSON |")
        lines.append("")

    stats = payload["intake_statistics"]
    lines += [
        "## Intake shape (ADR 0104 D6 will set its thresholds on this)",
        "",
        f"- sha256 present on {stats['sha256_present']} of {stats['documents']} documents",
        f"- duplicate sha256: {stats['duplicate_sha256_groups']} group(s), "
        f"{stats['duplicate_sha256_documents']} document(s) — the ADR 0104 S2 dedupe cases",
        f"- content types: {stats['content_types'] or '—'}",
        f"- source channels: {stats['source_channels'] or '—'}",
        f"- bytes: min {stats['bytes_min']}, median {stats['bytes_median']}, max {stats['bytes_max']}",
        f"- page count: {stats['page_count']}",
        "",
        f"Machine-readable: `{json_path.relative_to(ROOT)}`",
        "",
    ]
    md_path.write_text("\n".join(lines))
    return json_path, md_path


# A two-document synthetic corpus in the shape PostgREST returns: one that ties
# out and one that does not. It exists so `--self-test` can prove the runner can
# NAME a failure -- which the real corpus, being empty, cannot prove at all.
# Every value here is invented.
SELF_TEST_CORPUS = [
    {
        "document": {
            "id": "synthetic-ties-out",
            "restaurant_id": "synthetic-restaurant",
            "doc_type": "invoice",
            "source_channel": "email",
            "currency": "USD",
            "subtotal": "660.00",
            "freight": "48.00",
            "total": "708.00",
            "extraction_confidence": "0.910",
        },
        "lines": [
            {
                "line_no": 1, "qty": "24", "uom": "bottle", "pack_size": 1,
                "qty_bottles": "24", "free_goods_qty": "0",
                "unit_price": "22.0000", "line_total": "528.00",
            },
            {
                "line_no": 2, "qty": "6", "uom": "bottle", "pack_size": 1,
                "qty_bottles": "6", "free_goods_qty": "0",
                "unit_price": "22.0000", "line_total": "132.00",
            },
        ],
    },
    {
        "document": {
            "id": "synthetic-does-not-tie",
            "restaurant_id": "synthetic-restaurant",
            "doc_type": "invoice",
            "source_channel": "photo",
            "currency": "USD",
            "subtotal": "660.00",
            "total": "660.00",
            "extraction_confidence": "0.410",
        },
        "lines": [
            {
                "line_no": 1, "qty": "24", "uom": "bottle", "pack_size": 1,
                "qty_bottles": "24", "free_goods_qty": "0",
                "unit_price": "22.0000", "line_total": "428.00",
            },
        ],
    },
]


def self_test() -> int:
    """Prove the runner names a failure when one exists. Touches no database."""
    try:
        out = run_cli(SELF_TEST_CORPUS)
    except RuntimeError as exc:
        print(f"SELF-TEST CANNOT RUN: {exc}", file=sys.stderr)
        return 2
    failures = out["named_failures"]
    named = {f["document_id"] for f in failures}
    if out["documents_read"] != 2:
        print(f"SELF-TEST FAILED: read {out['documents_read']} of 2", file=sys.stderr)
        return 2
    if "synthetic-does-not-tie" not in named:
        print(
            "SELF-TEST FAILED: the document that does not tie was not named. "
            "The runner would report a broken corpus as clean.",
            file=sys.stderr,
        )
        return 2
    if "synthetic-ties-out" in named:
        print("SELF-TEST FAILED: a document that ties out was named as failing", file=sys.stderr)
        return 2
    print(f"self-test ok — 2 documents read, {len(failures)} named failure(s), all on the broken one:")
    for f in failures:
        print(f"  {f['document_id']} · {f['invariant']} · expected {f['expected']}, found {f['found']}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "datasets" / "canonical"))
    ap.add_argument(
        "--self-test",
        action="store_true",
        help="run the invariants over a synthetic corpus with one broken document, "
        "to prove the runner can name a failure. Reads no database, writes no report.",
    )
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    env = read_env(ENV_FILE)
    base = os.environ.get("SUPABASE_URL") or env.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or env.get(
        "SUPABASE_SERVICE_ROLE_KEY"
    )
    if not base or not key:
        print(
            "CANNOT RUN: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not found "
            f"(looked in the environment and {ENV_FILE}).",
            file=sys.stderr,
        )
        return 2
    base = base.rstrip("/")
    project_ref = urllib.parse.urlparse(base).hostname or "unknown"

    try:
        doc_count = count_rows(base, key, "procurement_documents")
        line_count = count_rows(base, key, "procurement_document_lines")
        objects = list_bucket_objects(base, key, BUCKET)
        print(
            f"counted: procurement_documents={doc_count}, "
            f"procurement_document_lines={line_count}, "
            f"{BUCKET} objects={'could not list' if objects is None else objects}"
        )

        documents, doc_lag = (
            fetch_all_tolerating_schema_lag(
                base, key, "procurement_documents", DOC_COLUMNS, DOC_COLUMNS_NEW
            )
            if doc_count
            else ([], False)
        )
        lines_rows, line_lag = (
            fetch_all_tolerating_schema_lag(
                base, key, "procurement_document_lines", LINE_COLUMNS, LINE_COLUMNS_NEW
            )
            if line_count
            else ([], False)
        )
        schema_lag = doc_lag or line_lag
    except RuntimeError as exc:
        # A failed read is a failed read. It never becomes an empty corpus.
        print(f"CANNOT RUN: {exc}", file=sys.stderr)
        return 2

    by_doc: dict[str, list[dict]] = {}
    for row in lines_rows:
        by_doc.setdefault(row["document_id"], []).append(row)
    for rows in by_doc.values():
        rows.sort(key=lambda r: r.get("line_no") or 0)

    corpus = [{"document": d, "lines": by_doc.get(d["id"], [])} for d in documents]

    if corpus:
        try:
            cli_out = run_cli(corpus)
        except RuntimeError as exc:
            print(f"CANNOT RUN: {exc}", file=sys.stderr)
            return 2
        # "0 failures" is NOT the headline when nothing could be tested.
        #
        # Measured 2026-09-04: three real documents were read and the headline
        # said "0 named invariant failure(s)" -- while ELEVEN of the fourteen
        # invariants were untestable on every one of them, because extraction
        # had failed and there were no lines to check. That reads as a clean
        # run and is the absence-as-health fault this script's own docstring
        # exists to refuse. The untestable share now rides in the headline.
        per_inv = cli_out["per_invariant"]
        all_untestable = sum(
            1
            for c in per_inv.values()
            if c.get("holds", 0) == 0 and c.get("fails", 0) == 0 and c.get("untestable", 0)
        )
        lines_read = sum(len(e["lines"]) for e in corpus)
        headline = (
            f"{cli_out['documents_read']} documents read; "
            f"{len(cli_out['named_failures'])} named invariant failure(s); "
            f"{all_untestable} of {len(per_inv)} invariants UNTESTABLE on every "
            f"document ({lines_read} lines extracted in total)"
        )
    else:
        cli_out = {"documents_read": 0, "per_invariant": {}, "named_failures": [], "documents": []}
        headline = EMPTY_HEADLINE

    today = date.today().isoformat()
    payload = {
        "run_date": today,
        "project_ref": project_ref,
        "headline": headline,
        "corpus_is_empty": not corpus,
        "synthetic_fixture_count": SYNTHETIC_FIXTURE_COUNT,
        "counts": {
            "procurement_documents": doc_count,
            "procurement_document_lines": line_count,
            "vendor_attachments_objects": (
                "could not list" if objects is None else objects
            ),
        },
        "documents_read": cli_out["documents_read"],
        "per_invariant": cli_out["per_invariant"],
        "named_failures": cli_out["named_failures"],
        "documents": cli_out["documents"],
        "intake_statistics": intake_statistics(documents),
        # True = this database predates migration 20260904120000, so every
        # BT-149/BT-150 and every printed literal in this report is absent
        # BECAUSE IT COULD NOT BE STORED. Never conflate that with a document
        # that printed no price base.
        "price_base_columns_missing": schema_lag,
        "wrote_to_database": False,
    }

    json_path, md_path = write_report(Path(args.out), today, payload)
    print(headline)
    print(f"wrote {json_path.relative_to(ROOT)} and {md_path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
