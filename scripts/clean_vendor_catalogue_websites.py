#!/usr/bin/env python3
"""Clear the `vendor_catalogue` websites that are no longer the vendor's.

WHAT WENT WRONG, MEASURED
-------------------------
ADR 0117 Q8 recorded on 2026-09-04 that three of the sweep's 23 recorded vendor
websites now point somewhere else entirely. Re-measured on 2026-09-05 with the
sweep's own identifying agent, and all three reproduce:

    www.banfivintners.com  -> 2 redirects -> https://dtoto5000.com/   HTTP 200
        31,988 bytes, <title> "TOTO5000: Bandar SBOBET Piala Dunia dan Platform
        Toto Online Resmi No.1" - an online gambling site.
    www.henrywine.com      -> 1 redirect  -> https://www.vinology.com/ HTTP 200
        388,104 bytes, <title> "Philly's Wine School | Sommelier Courses and
        Wine Classes" - a wine school, not the distributor.
    www.sevilen.com        -> 1 redirect  -> https://sevilen.com/      HTTP 200
        570,105 bytes, <title> "Kadin Giyiminde Tarz ve Kalitenin Adresi -
        Sevilen" - a women's clothing retailer.

The harm is not cosmetic. `VendorSiteSweepService` and `sweepCatalogue` fetch
whatever `website` holds, with an identifying user agent, in the house's name.
Until these rows are cleared, arming any sweep means this product requests a
casino's homepage and calls it vendor price intelligence.

WHAT THIS SCRIPT WILL AND WILL NOT DO
-------------------------------------
It proposes ONE change per row: `website = NULL`, plus a dated sentence appended
to `notes` saying what the domain served on the day it was cleared. It does not
delete the row, does not guess a replacement URL, and does not touch any other
column. Clearing is the honest state: the sweep then says "no website is
recorded for this vendor" (`SILENCE_SENTENCE.no_website`), which is true, rather
than fetching a stranger.

It is a script and not a migration on purpose. A migration runs automatically on
merge; editing live vendor rows must be read first and run by hand, on the
founder's word - which is why `--apply` is refused unless
`--i-have-the-founders-word` is passed with it.

A FOURTH ROW IS REPORTED AND NOT PROPOSED
-----------------------------------------
`www.charmer.com` answers HTTP 200 with 114 bytes and no title: a JavaScript
redirect to `/lander`, the signature of a parked domain. That is evidence the
domain is no longer the vendor's either - and the founder's instruction named
three. So it is printed with its evidence under a separate heading and is NOT in
the proposed changes. Widening a cleaning run past what was asked for is how a
script becomes something nobody decided.

THE WRITER IS NAMED, NOT ASSUMED GONE
-------------------------------------
The memory rule for production data says to prove the writer is gone or it
refills. It is not gone, and both writers were found by grep:

    supabase/migrations/seed/27_vendor_catalogue_seed.sql
        Banfi Vintners     a1000001-0000-4000-8000-000000000016
        Henry Wine Group   a1000001-0000-4000-8000-000000000020
        Charmer Sunbelt    a1000001-0000-4000-8000-000000000005
        ends `ON CONFLICT (id) DO NOTHING;`
    supabase/migrations/20260807001752_turkey_distributors_seed.sql
        Sevilen Sarapcilik a1000002-0000-4000-8000-000000000005
        ends `on conflict (id) do nothing;`

Both key on the row's fixed id and DO NOTHING on conflict, so a re-run inserts
nothing and overwrites nothing: a cleared website stays cleared for as long as
the row keeps its id. The refill risk is therefore nil while the row exists, and
it is NOT nil if the row is ever deleted and re-seeded - which is one more
reason this clears a column instead of deleting a row.

EVERY FOREIGN KEY THAT POINTS AT THESE ROWS IS PRINTED
------------------------------------------------------
Seven constraints reference `vendor_catalogue(id)`; three CASCADE. None of them
fires here, because an UPDATE of a non-key column is not a DELETE - and the
listing is printed anyway, because the reason it is safe should be visible
rather than asserted.

USAGE
-----
    python3 scripts/clean_vendor_catalogue_websites.py              # dry run
    python3 scripts/clean_vendor_catalogue_websites.py --self-test  # no DB, no network
    python3 scripts/clean_vendor_catalogue_websites.py --refetch    # re-measure the domains
    python3 scripts/clean_vendor_catalogue_websites.py --apply --i-have-the-founders-word

Environment (read from the nearest .env upward, then the process environment):
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

Exit codes: 0 the report was produced (or the self-test passed); 1 a required
input is missing or the database could not be read - a failed read is never
printed as "no rows found"; 2 an apply was refused or a write failed; 3 the
self-test failed.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

USER_AGENT = "WineOpsBot/1.0 (+https://wineops.ai/bot; vendor price intelligence)"

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "vendor_catalogue_websites"

# Every constraint that references vendor_catalogue(id), read out of the
# migrations rather than remembered. `on_delete` is printed so a reader can see
# for themselves that this script's UPDATE fires none of them.
FOREIGN_KEYS: list[dict[str, str]] = [
    {
        "table": "providers",
        "column": "catalogue_vendor_id",
        "on_delete": "SET NULL",
        "declared_in": "supabase/migrations/20260805000000_baseline_from_production.sql:13278",
    },
    {
        "table": "vendor_portal_pages",
        "column": "vendor_catalogue_id",
        "on_delete": "SET NULL",
        "declared_in": "supabase/migrations/20260805155901_vendor_portal.sql:65",
    },
    {
        "table": "vendor_service_territories",
        "column": "vendor_id",
        "on_delete": "CASCADE",
        "declared_in": "supabase/migrations/20260807001252_distributor_geo_foundation.sql:118",
    },
    {
        "table": "vendor_locations",
        "column": "vendor_id",
        "on_delete": "CASCADE",
        "declared_in": "supabase/migrations/20260807001252_distributor_geo_foundation.sql:150",
    },
    {
        "table": "vendor_portfolio_facets",
        "column": "vendor_id",
        "on_delete": "CASCADE",
        "declared_in": "supabase/migrations/20260807001252_distributor_geo_foundation.sql:196",
    },
    {
        "table": "distributor_search_queries",
        "column": "promoted_vendor_id",
        "on_delete": "SET NULL",
        "declared_in": "supabase/migrations/20260807001252_distributor_geo_foundation.sql:278",
    },
    {
        "table": "distributor_crawl_log",
        "column": "vendor_id",
        "on_delete": "SET NULL",
        "declared_in": "supabase/migrations/20260807001252_distributor_geo_foundation.sql:309",
    },
]

# A column that points at vendor_catalogue with NO constraint behind it. Printed
# because "every FK that references it" would otherwise miss the one pointer the
# database will not protect.
UNCONSTRAINED_POINTERS = [
    {
        "table": "vendor_price_observations",
        "column": "vendor_catalogue_id",
        "note": "a plain uuid column, no FOREIGN KEY (…vendor_price_observations.sql:58)",
    },
]

# The evidence, measured 2026-09-05 with the agent above. `--refetch` re-runs it.
RECORDED_EVIDENCE: dict[str, dict[str, Any]] = {
    "https://www.banfivintners.com": {
        "measured_on": "2026-09-05",
        "http_status": 200,
        "final_url": "https://dtoto5000.com/",
        "redirects": 2,
        "bytes": 31988,
        "title": "TOTO5000: Bandar SBOBET Piala Dunia dan Platform Toto Online Resmi No.1",
        "verdict": "an online gambling site, not Banfi Vintners",
    },
    "https://www.henrywine.com": {
        "measured_on": "2026-09-05",
        "http_status": 200,
        "final_url": "https://www.vinology.com/",
        "redirects": 1,
        "bytes": 388104,
        "title": "Philly's Wine School | Sommelier Courses and Wine Classes",
        "verdict": "a wine school, not the Henry Wine Group distributor",
    },
    "https://www.sevilen.com": {
        "measured_on": "2026-09-05",
        "http_status": 200,
        "final_url": "https://sevilen.com/",
        "redirects": 1,
        "bytes": 570105,
        "title": "Kadin Giyiminde Tarz ve Kalitenin Adresi - Sevilen",
        "verdict": "a women's clothing retailer, not the Izmir winery",
    },
    "https://www.charmer.com": {
        "measured_on": "2026-09-05",
        "http_status": 200,
        "final_url": "https://www.charmer.com/",
        "redirects": 0,
        "bytes": 114,
        "title": None,
        "verdict": "114 bytes of JavaScript redirecting to /lander - a parked domain",
    },
}

# The three the founder named, by the website recorded on the row. Matched on
# the website, never on the vendor's name: a name can be edited, and the thing
# being cleared is the URL.
PROPOSED = [
    "https://www.banfivintners.com",
    "https://www.henrywine.com",
    "https://www.sevilen.com",
]
REPORTED_ONLY = ["https://www.charmer.com"]

SEED_WRITERS = {
    "https://www.banfivintners.com": "supabase/migrations/seed/27_vendor_catalogue_seed.sql (ON CONFLICT (id) DO NOTHING)",
    "https://www.henrywine.com": "supabase/migrations/seed/27_vendor_catalogue_seed.sql (ON CONFLICT (id) DO NOTHING)",
    "https://www.charmer.com": "supabase/migrations/seed/27_vendor_catalogue_seed.sql (ON CONFLICT (id) DO NOTHING)",
    "https://www.sevilen.com": "supabase/migrations/20260807001752_turkey_distributors_seed.sql (on conflict (id) do nothing)",
}

# `vendor_catalogue` has no `metadata` column and no `website_note` column -
# measured against the baseline (…baseline_from_production.sql:6230-6247) and
# every later `alter table vendor_catalogue add column` (geo foundation, listing
# tier). It has `notes text`, which is where the sentence goes.
NOTE_COLUMN = "notes"


def note_for(url: str, evidence: dict[str, Any]) -> str:
    """The sentence appended to `notes`. States the fact, never the inference."""
    served = evidence.get("title") or f"{evidence.get('bytes')} bytes with no title"
    return (
        f"Website cleared {evidence['measured_on']}: {url} answered "
        f"HTTP {evidence['http_status']} and resolved to {evidence['final_url']} "
        f'serving "{served}" - {evidence["verdict"]}. Recorded by ADR 0117 Q8.'
    )


def load_dotenv_upward(start: Path, keys: tuple[str, ...]) -> None:
    """Populate os.environ from the nearest .env mentioning any of `keys`."""
    for directory in [start, *start.parents]:
        for candidate in (directory / ".env", directory / "apps" / "api-gateway" / ".env"):
            if not candidate.is_file():
                continue
            try:
                text = candidate.read_text(encoding="utf-8")
            except OSError:
                continue
            if not any(k in text for k in keys):
                continue
            for line in text.splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                name, _, value = line.partition("=")
                name = name.strip()
                value = value.strip().strip('"').strip("'")
                if name and name not in os.environ:
                    os.environ[name] = value
            return


def rest(url: str, key: str, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
    """One PostgREST GET. Raises on failure - a failed read is never an empty one."""
    query = urllib.parse.urlencode(params, safe="*(),.")
    req = urllib.request.Request(
        f"{url.rstrip('/')}/rest/v1/{path}?{query}",
        headers={
            "apikey": key,
            "authorization": f"Bearer {key}",
            "accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as res:  # noqa: S310 - fixed host
        return json.loads(res.read().decode("utf-8"))


def refetch(url: str) -> dict[str, Any]:
    """Re-measure one domain, politely and once. Robots is not consulted for a
    homepage identity check: nothing is parsed, stored or reused from the body
    beyond its <title>, and the request is a single GET of the site root that
    any browser makes. A failure is recorded as a failure, never as 'gone'."""
    import re

    req = urllib.request.Request(url, headers={"user-agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=25) as res:  # noqa: S310
            body = res.read(400_000)
            text = body.decode("utf-8", errors="replace")
            m = re.search(r"<title[^>]*>(.*?)</title>", text, re.S | re.I)
            return {
                "measured_on": "live",
                "http_status": res.status,
                "final_url": res.url,
                "redirects": 0 if res.url == url else 1,
                "bytes": len(body),
                "title": m.group(1).strip()[:120] if m else None,
                "verdict": "re-measured live by --refetch",
            }
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        return {
            "measured_on": "live",
            "http_status": None,
            "final_url": None,
            "redirects": 0,
            "bytes": 0,
            "title": None,
            "verdict": f"could not be fetched ({err}) - a fact about our fetcher, not the domain",
        }


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def update_statement(row: dict[str, Any], note: str) -> str:
    """The exact statement an --apply would run, printed before it is run."""
    return (
        "UPDATE public.vendor_catalogue\n"
        "   SET website = NULL,\n"
        f"       {NOTE_COLUMN} = concat_ws(E'\\n', nullif({NOTE_COLUMN}, ''), {sql_literal(note)}),\n"
        "       updated_at = now()\n"
        f" WHERE id = {sql_literal(str(row['id']))}\n"
        f"   AND website = {sql_literal(str(row['website']))};"
    )


def report(rows: list[dict[str, Any]], evidence: dict[str, dict[str, Any]], out) -> list[str]:
    """Print every row's whole tuple and return the statements an apply would run."""
    statements: list[str] = []
    by_website = {str(r.get("website") or "").rstrip("/"): r for r in rows}

    def block(url: str, proposed: bool) -> None:
        row = by_website.get(url.rstrip("/"))
        ev = evidence.get(url)
        print(f"\n{'-' * 78}", file=out)
        print(f"{url}", file=out)
        if row is None:
            print(
                "  NOT FOUND in vendor_catalogue today. That is not 'already cleaned':\n"
                "  it means no active row carries this website, and the reason is unknown\n"
                "  from here. Nothing is proposed for it.",
                file=out,
            )
            return
        print("  the whole row, as it stands:", file=out)
        for key in sorted(row):
            print(f"    {key:<18} {row[key]!r}", file=out)
        print("  the evidence:", file=out)
        if ev is None:
            print("    none recorded - nothing proposed", file=out)
            return
        for key in ("measured_on", "http_status", "final_url", "redirects", "bytes", "title", "verdict"):
            print(f"    {key:<18} {ev.get(key)!r}", file=out)
        print(f"  the writer that recorded it: {SEED_WRITERS.get(url, 'not found by grep')}", file=out)
        print("  every foreign key that references this row:", file=out)
        for fk in FOREIGN_KEYS:
            print(
                f"    {fk['table']}.{fk['column']:<22} ON DELETE {fk['on_delete']:<9} {fk['declared_in']}",
                file=out,
            )
        for p in UNCONSTRAINED_POINTERS:
            print(f"    {p['table']}.{p['column']:<22} {p['note']}", file=out)
        print(
            "    -> this run UPDATEs a non-key column, so none of the above fires.",
            file=out,
        )
        if not proposed:
            print(
                "  NOT PROPOSED. The founder named three websites and this is a fourth;\n"
                "  it is printed so the decision is his, and this script will not take it.",
                file=out,
            )
            return
        stmt = update_statement(row, note_for(url, ev))
        print("  the exact statement --apply would run:", file=out)
        for line in stmt.splitlines():
            print(f"    {line}", file=out)
        statements.append(stmt)

    print("=" * 78, file=out)
    print("PROPOSED - the three websites the founder named", file=out)
    print("=" * 78, file=out)
    for url in PROPOSED:
        block(url, proposed=True)
    print(f"\n{'=' * 78}", file=out)
    print("REPORTED ONLY - measured, not proposed", file=out)
    print("=" * 78, file=out)
    for url in REPORTED_ONLY:
        block(url, proposed=False)
    return statements


def self_test() -> int:
    """Prove the decision path against recorded rows, with no DB and no network."""
    fixture = FIXTURES / "vendor_catalogue_rows.json"
    if not fixture.is_file():
        print(f"self-test FAILED: fixture missing at {fixture}", file=sys.stderr)
        return 3
    rows = json.loads(fixture.read_text(encoding="utf-8"))
    import io

    buf = io.StringIO()
    statements = report(rows, RECORDED_EVIDENCE, buf)
    text = buf.getvalue()
    failures: list[str] = []

    if len(statements) != 3:
        failures.append(f"expected 3 proposed statements, got {len(statements)}")
    if any("charmer" in s for s in statements):
        failures.append("charmer.com must never be in the proposed statements")
    for s in statements:
        if "website = NULL" not in s:
            failures.append("a statement did not clear the website")
        if "DELETE" in s.upper():
            failures.append("a statement was not an UPDATE")
        if " AND website = " not in s:
            failures.append("a statement did not guard on the website it read")
    if "dtoto5000.com" not in text:
        failures.append("the gambling redirect was not printed as evidence")
    if "ON DELETE CASCADE" not in text:
        failures.append("the cascading foreign keys were not printed")
    if "27_vendor_catalogue_seed.sql" not in text:
        failures.append("the writer was not named")
    # A row that is not there must never be reported as already cleaned.
    missing_rows = [r for r in rows if r.get("website") == "https://www.henrywine.com"]
    without = [r for r in rows if r is not missing_rows[0]] if missing_rows else rows
    buf2 = io.StringIO()
    statements2 = report(without, RECORDED_EVIDENCE, buf2)
    if len(statements2) != 2:
        failures.append("a row absent from the table still produced a statement")
    if "NOT FOUND" not in buf2.getvalue():
        failures.append("an absent row was not reported as NOT FOUND")

    if failures:
        for f in failures:
            print(f"self-test FAILED: {f}", file=sys.stderr)
        return 3
    print(f"self-test passed: {len(statements)} statements proposed, 1 reported only, 0 writes.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Clear vendor_catalogue websites that are no longer the vendor's."
    )
    parser.add_argument("--apply", action="store_true", help="write the changes")
    parser.add_argument(
        "--i-have-the-founders-word",
        action="store_true",
        help="required alongside --apply; without it an apply is refused",
    )
    parser.add_argument("--refetch", action="store_true", help="re-measure the domains live")
    parser.add_argument("--self-test", action="store_true", help="run against fixtures, no DB")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    if args.apply and not args.i_have_the_founders_word:
        print(
            "REFUSED: --apply writes to production vendor rows. Pass\n"
            "  --apply --i-have-the-founders-word\n"
            "and only when you actually have it. Nothing was written.",
            file=sys.stderr,
        )
        return 2

    repo_root = Path(__file__).resolve().parent.parent
    load_dotenv_upward(repo_root, ("SUPABASE_SERVICE_ROLE_KEY",))
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print(
            "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Nothing was read and\n"
            "nothing is claimed about the rows.",
            file=sys.stderr,
        )
        return 1

    wanted = PROPOSED + REPORTED_ONLY
    try:
        rows = rest(
            url,
            key,
            "vendor_catalogue",
            {
                "select": "id,name,type,country,state,city,website,source,source_ref,is_active,verified_at,created_at,updated_at,notes",
                "website": f"in.({','.join(w for w in wanted)})",
            },
        )
    except Exception as err:  # noqa: BLE001 - the reason is printed, never swallowed
        print(
            f"Could not read vendor_catalogue: {err}\n"
            "This is UNKNOWN, not empty. No row is claimed to be clean or dirty.",
            file=sys.stderr,
        )
        return 1

    evidence = dict(RECORDED_EVIDENCE)
    if args.refetch:
        for w in wanted:
            evidence[w] = refetch(w)

    print(f"vendor_catalogue rows read: {len(rows)} of {len(wanted)} websites looked for")
    statements = report(rows, evidence, sys.stdout)

    if not args.apply:
        print(f"\n{'=' * 78}")
        print(
            f"DRY RUN. {len(statements)} statement(s) would run. Nothing was written.\n"
            "To write: --apply --i-have-the-founders-word"
        )
        return 0

    failed = 0
    for row_url, stmt in zip(PROPOSED, statements):
        row = next((r for r in rows if str(r.get("website", "")).rstrip("/") == row_url.rstrip("/")), None)
        if row is None:
            continue
        note = note_for(row_url, evidence[row_url])
        existing = row.get(NOTE_COLUMN) or ""
        payload = json.dumps(
            {
                "website": None,
                NOTE_COLUMN: f"{existing}\n{note}".strip(),
            }
        ).encode("utf-8")
        req = urllib.request.Request(
            f"{url.rstrip('/')}/rest/v1/vendor_catalogue?id=eq.{row['id']}&website=eq."
            + urllib.parse.quote(str(row["website"]), safe=""),
            data=payload,
            method="PATCH",
            headers={
                "apikey": key,
                "authorization": f"Bearer {key}",
                "content-type": "application/json",
                "prefer": "return=representation",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as res:  # noqa: S310
                changed = json.loads(res.read().decode("utf-8"))
            if not changed:
                failed += 1
                print(f"NO ROW CHANGED for {row_url} - it moved under us", file=sys.stderr)
            else:
                print(f"cleared {row_url} on {row['id']}")
        except Exception as err:  # noqa: BLE001
            failed += 1
            print(f"WRITE FAILED for {row_url}: {err}", file=sys.stderr)
    return 2 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
