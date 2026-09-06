#!/usr/bin/env python3
"""Turn a published price list into price sightings — and refuse the ones that lie.

    ./scripts/fetch_price_sightings.py --self-test          # parse the fixtures, no network
    ./scripts/fetch_price_sightings.py --source iowa        # DRY RUN: fetch, parse, print
    ./scripts/fetch_price_sightings.py --source oregon --offline
    ./scripts/fetch_price_sightings.py --source iowa --apply # REFUSED, and says why

This is a PROOF, not a pipeline. It writes nothing, ever, in this revision — see
"Why --apply is refused" below. What it proves is that two published lists can be
reduced to the sighting shape `vendor_price_observations` already stores, with the
provenance ADR 0117 requires, and that the rows which cannot be reduced honestly are
counted and named rather than defaulted into the register.

Sources implemented
-------------------
Both were fetched and measured on 2026-09-04; the registry
(`.planning/07-reference/price-sources.md`) carries the full evidence.

  iowa    Iowa Alcoholic Beverages Division, "Iowa Liquor Products" (dataset 1029).
          NDJSON, no key, CC BY 4.0. 13,762 rows, every one stamped
          `report_as_of = 2026-09-01`. Carries vendor, ml, pack, UPC and three prices.
  oregon  Oregon Liquor & Cannabis Commission, "OLCC Monthly Pricing" (Socrata
          vmf2-f83h). JSON, no key, attribution declared and NO licence declared.
          3,856 rows for `asofdate = 2026-09-01` out of 263,338 across all months.

THE FAULT THIS SCRIPT IS BUILT AROUND
-------------------------------------
On 2026-09-04 `https://www.ams.usda.gov/mnreports/bh_fv020.txt` returned **HTTP 200**
with a Boston terminal-market report dated **03-JAN-2024** — 975 days stale — and
said so only in prose inside its own body. A fetcher that treated 200 as freshness would
have written January-2024 produce prices as today's sightings, and every downstream
average would have been quietly wrong with no error anywhere.

So: a sighting is dated by the ISSUER, never by the fetch. `--max-age-days` compares the
issuer's own date field against today and REFUSES THE WHOLE RUN when it is older than the
source's cadence allows. A stale source produces an explicit refusal, never a quiet parse.

Rate limits honoured
--------------------
  oregon  `https://data.oregon.gov/robots.txt` (fetched 2026-09-04) sets
          `Crawl-delay: 1` for `User-agent: *`, and `/resource/` is not disallowed.
          Socrata's own documentation says unauthenticated requests share a per-IP pool
          and are throttled with a 429; an app token raises that to 1,000 requests per
          rolling hour. This script therefore sleeps >= 1.0s between pages, pages at
          $limit=1000 (four requests for one month), sends an identifying User-Agent, and
          uses an app token when SOCRATA_APP_TOKEN is set.
  iowa    One request for the whole file; the export is a 303 to a signed object-store
          URL. No crawl needed, so no crawl delay applies. Re-fetching more than once a
          day is pointless: `report_as_of` moves monthly.

Why --apply is refused
----------------------
Three blockers, all measured, none of them this script's to decide (ADR 0117):

  1. `vpo_source_type_check` admits only invoice | quote | api_catalog | website_scrape |
     chat | social | manual (`20260805154027_vendor_price_observations.sql:112-115`).
     A state's posted list is none of those. `api_catalog` means "vendor's own structured
     feed" and this is not one. Writing under that label is a lie in a trust-tier column
     the whole consensus rests on.
  2. `vendor_price_observations` has no column for the issuer, the state, or the
     issuance date as a timestamp (`effective_date` is a bare date and means the vendor's
     effective date, not the file's). Provenance would have to hide in `raw` jsonb, where
     nothing can index or constrain it.
  3. `restaurant_id` would have to be NULL, and
     `VendorComparisonService.belowTrailingAverage` reads
     `restaurant_id.is.null OR restaurant_id.eq.<tenant>`
     (`apps/api-gateway/src/vendor-intel/vendor-comparison.service.ts:341`). A NULL-tenant
     Iowa row is therefore visible in EVERY house's market box — a Michigan restaurant
     told that an Iowa state-store shelf price is a good deal. That is precisely the
     comparison the founder's index rule forbids.

Exit codes
----------
  0  parsed cleanly (dry run) or self-test passed
  1  the run was refused for a stated reason (stale issue date, no rows, --apply)
  2  could not check at all — the source shape changed, or a fixture is missing
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable

REPO = Path(__file__).resolve().parent.parent
FIXTURES = REPO / "scripts" / "fixtures" / "price-sources"

USER_AGENT = (
    "MudavymPriceSightings/0.1 (+https://mudavym.com/bot; "
    "public price-list reader; one request per source per day)"
)

# The engine's reference bottle. Kept identical to
# apps/api-gateway/src/analytics/engine/vendor-price-consensus.ts:106 on purpose: a
# second definition of the reference unit is a second answer to "what does this price
# mean", and the two would drift.
REFERENCE_VOLUME_ML = 750

# How far a bottle price times the pack may sit from the published case price before the
# row is treated as internally inconsistent. Iowa's own file contains a row where the two
# disagree by a factor of 31 (item 920301), so this is not hypothetical.
CASE_CONSISTENCY_TOLERANCE = 0.02


class CannotCheck(Exception):
    """The source's shape changed, or a fixture is missing. Never a pass."""


# --------------------------------------------------------------------------- shape


@dataclass
class Sighting:
    """One price, with everything needed to say where it came from and when.

    The field names are ADR 0117's provenance set, not the table's column names. They
    are deliberately NOT the table's names: three of them have nowhere to go in
    `vendor_price_observations` today, and naming them after columns that do not exist
    would hide that.
    """

    source_key: str          # 'iowa-liquor-products' — the registry row
    source_class: str        # 'posted_wholesale_list' | 'public_index' | ...
    issuer: str              # who published it: the agency, by name
    issuer_jurisdiction: str # 'US-IA' — the state whose price this is, and only that state's
    issued_at: str           # the ISSUER's own date, from the file. Never today's date.
    fetched_at: str          # when we read it
    source_url: str
    source_ref: str          # stable per-item key, for the dedup index
    attribution: str | None  # required text where the licence requires it

    product_name: str
    price_basis: str         # 'state_bottle_retail' — WHICH published number this is
    raw_price: float
    currency: str
    pack_size: int
    unit_volume_ml: int | None   # None, never 0
    normalized_unit_price: float | None
    normalization_note: str
    external_ids: dict[str, str] = field(default_factory=dict)
    extra: dict[str, Any] = field(default_factory=dict)

    def content_hash(self) -> str:
        """What makes a re-read NEW evidence rather than the same price again.

        Hashes the price-bearing fields only. A re-fetch of an unchanged list produces
        the same hash, and the partial unique index on (source_ref, content_hash)
        discards it — which is right, and which is also why a monthly list can never
        satisfy the market producer's 30-day / 3-earlier-sighting bar. See ADR 0117.
        """
        payload = json.dumps(
            [self.raw_price, self.currency, self.pack_size,
             self.unit_volume_ml, self.issued_at, self.price_basis],
            sort_keys=True,
        )
        return hashlib.sha256(payload.encode()).hexdigest()


@dataclass
class Refusal:
    reason: str
    detail: str
    row: dict[str, Any]


@dataclass
class RunResult:
    source_key: str
    fetched_at: str
    issued_at: str | None
    rows_read: int
    sightings: list[Sighting]
    refusals: list[Refusal]

    def tally(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for r in self.refusals:
            out[r.reason] = out.get(r.reason, 0) + 1
        return out


# ------------------------------------------------------------------- normalisation


def normalize_unit_price(
    price: float, pack: int, volume_ml: int | None
) -> tuple[float | None, str]:
    """Reduce to price per 750 ml bottle, or return None and say why.

    Mirrors `normalizeUnitPrice` in the analytics engine
    (apps/api-gateway/src/analytics/engine/vendor-price-consensus.ts:115). Returns None
    rather than guessing: an unconvertible row must leave the comparison, not enter it
    carrying a fabricated number.
    """
    if not (price >= 0):
        return None, "Price is not a number."
    if not (pack > 0):
        return None, "Pack size must be positive."

    per_unit = price / pack
    parts: list[str] = []
    if pack != 1:
        parts.append(f"/ {pack} per pack")

    adjusted = per_unit
    if volume_ml is not None and volume_ml > 0:
        adjusted = per_unit * (REFERENCE_VOLUME_ML / volume_ml)
        if volume_ml != REFERENCE_VOLUME_ML:
            parts.append(f"scaled {volume_ml}ml -> {REFERENCE_VOLUME_ML}ml")
    else:
        # Not a failure — but the reader must be told the number is per PACKAGE, not
        # per reference bottle, or a 3.5L bag-in-box ranks against a 750ml bottle as
        # though they were the same good.
        parts.append("no stated volume; per package, NOT per 750ml")

    return adjusted, ", ".join(parts) if parts else "Already per reference unit."


_SIZE_RE = re.compile(r"^\s*([0-9]+(?:\.[0-9]+)?)\s*(ML|L|LITER|LITRE)\s*$", re.I)


def parse_size_to_ml(size: str | None) -> int | None:
    """'750 ML' -> 750, '1.75 L' -> 1750, anything else -> None.

    None means "not stated", which is a fact. Zero would mean "a bottle of no volume",
    which is not, and eleven Iowa rows would otherwise assert exactly that.
    """
    if not size:
        return None
    m = _SIZE_RE.match(size)
    if not m:
        return None
    value = float(m.group(1))
    unit = m.group(2).upper()
    ml = value * 1000 if unit != "ML" else value
    ml_int = int(round(ml))
    return ml_int if ml_int > 0 else None


def _as_float(value: Any) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f  # reject NaN


def _as_int(value: Any) -> int | None:
    f = _as_float(value)
    return int(f) if f is not None else None


# --------------------------------------------------------------------------- iowa


IOWA_URL = "https://idh-be.iowa.gov/api/v1/datasets/1029/rows.json"
IOWA_ATTRIBUTION = (
    "Iowa Alcoholic Beverages Division / Alcohol Operations Bureau, "
    "'Iowa Liquor Products', CC BY 4.0"
)
IOWA_REQUIRED = {
    "item_no", "im_desc", "vendor_name", "bottle_volume_ml", "pack",
    "state_bottle_cost", "state_case_cost", "state_bottle_retail", "report_as_of",
}


def parse_iowa(rows: Iterable[dict[str, Any]], fetched_at: str) -> RunResult:
    rows = list(rows)
    if not rows:
        raise CannotCheck("Iowa: zero rows read — the export path or dataset id moved.")

    missing = IOWA_REQUIRED - set(rows[0])
    if missing:
        raise CannotCheck(
            f"Iowa: the row shape changed — missing {sorted(missing)}. "
            "Re-read the column list at "
            "https://idh-be.iowa.gov/api/v1/datasets/1029/columns.json before trusting "
            "any parse."
        )

    sightings: list[Sighting] = []
    refusals: list[Refusal] = []
    issued_dates = {r.get("report_as_of") for r in rows if r.get("report_as_of")}
    issued_at = sorted(issued_dates)[-1] if issued_dates else None
    seen: set[tuple[str, str]] = set()

    for r in rows:
        # The state's own date. If a row is stamped older than the file, it is not this
        # month's posting and must not be counted as one.
        if r.get("report_as_of") != issued_at:
            refusals.append(Refusal(
                "row_older_than_file",
                f"report_as_of={r.get('report_as_of')} but the file says {issued_at}",
                r))
            continue

        pack = _as_int(r.get("pack"))
        bottle = _as_float(r.get("state_bottle_retail"))
        case = _as_float(r.get("state_case_cost"))
        volume = _as_int(r.get("bottle_volume_ml"))

        if pack is None or pack <= 0:
            refusals.append(Refusal("bad_pack", f"pack={r.get('pack')!r}", r))
            continue
        if bottle is None or bottle <= 0:
            refusals.append(Refusal(
                "no_price", f"state_bottle_retail={r.get('state_bottle_retail')!r}", r))
            continue

        # Zero is not a volume. Eleven rows in the 2026-09-01 file say 0.
        if volume is not None and volume <= 0:
            volume = None

        # The file disagrees with itself sometimes. Item 920301 publishes a bottle cost
        # of 1250 against a case cost of 240 on a pack of 6. Whichever number is wrong,
        # the row cannot be believed, and believing it writes a $1,250 bottle.
        cost = _as_float(r.get("state_bottle_cost"))
        if cost is not None and case is not None and case > 0 and cost > 0:
            implied = cost * pack
            if abs(implied - case) / case > CASE_CONSISTENCY_TOLERANCE:
                refusals.append(Refusal(
                    "case_price_inconsistent",
                    f"state_bottle_cost {cost} x pack {pack} = {implied:.2f}, "
                    f"but state_case_cost = {case}",
                    r))
                continue

        # One item number, one sighting. 2,292 of the file's item numbers appear under
        # more than one category with the same price; those are the same sighting twice.
        key = (str(r["item_no"]), "state_bottle_retail")
        if key in seen:
            refusals.append(Refusal(
                "duplicate_item_no", f"item_no {r['item_no']} already seen", r))
            continue
        seen.add(key)

        unit_price, note = normalize_unit_price(bottle, pack, volume)
        sightings.append(Sighting(
            source_key="iowa-liquor-products",
            source_class="posted_wholesale_list",
            issuer="Iowa Alcoholic Beverages Division",
            issuer_jurisdiction="US-IA",
            issued_at=str(issued_at),
            fetched_at=fetched_at,
            source_url=IOWA_URL,
            source_ref=f"{IOWA_URL}#item={r['item_no']}",
            attribution=IOWA_ATTRIBUTION,
            product_name=str(r.get("im_desc") or "").strip(),
            # NAMED, not assumed. state_bottle_retail is what an Iowa Class E licensee
            # pays the state — cost x 1.50 at the median, which is Iowa's markup and
            # nobody else's. state_bottle_cost is what the STATE paid the supplier and is
            # not a price anyone can be quoted.
            price_basis="state_bottle_retail",
            raw_price=bottle,
            currency="USD",
            pack_size=pack,
            unit_volume_ml=volume,
            normalized_unit_price=unit_price,
            normalization_note=note,
            external_ids={
                k: str(r[k]) for k in ("item_no", "upc", "scc", "vendor_no")
                if r.get(k)
            },
            extra={
                # The supplier who sells to the STATE. Not a distributor this house can
                # buy from, and the registry says so.
                "supplier_name": r.get("vendor_name"),
                "category": r.get("category_name"),
                "proof": r.get("proof"),
                "state_bottle_cost": cost,
                "state_case_cost": case,
                "listed_on": r.get("list_on"),
            },
        ))

    return RunResult("iowa-liquor-products", fetched_at, issued_at,
                     len(rows), sightings, refusals)


# ------------------------------------------------------------------------- oregon


OREGON_URL = "https://data.oregon.gov/resource/vmf2-f83h.json"
OREGON_ATTRIBUTION = "Oregon Liquor & Cannabis Commission, 'OLCC Monthly Pricing'"
OREGON_CRAWL_DELAY_S = 1.0  # data.oregon.gov/robots.txt, User-agent: *
OREGON_REQUIRED = {
    "asofdate", "itemcode", "description", "size", "priceperunit",
    "unitspercase", "pricepercase",
}


def parse_oregon(rows: Iterable[dict[str, Any]], fetched_at: str) -> RunResult:
    rows = list(rows)
    if not rows:
        raise CannotCheck("Oregon: zero rows read — the dataset id or filter moved.")

    missing = OREGON_REQUIRED - set(rows[0])
    if missing:
        raise CannotCheck(
            f"Oregon: the row shape changed — missing {sorted(missing)}. "
            f"Re-read {OREGON_URL.replace('/resource/', '/api/views/')} first."
        )

    sightings: list[Sighting] = []
    refusals: list[Refusal] = []
    issued = {str(r.get("asofdate", ""))[:10] for r in rows if r.get("asofdate")}
    issued_at = sorted(issued)[-1] if issued else None
    seen: set[str] = set()

    for r in rows:
        stamp = str(r.get("asofdate", ""))[:10]
        if stamp != issued_at:
            refusals.append(Refusal(
                "row_older_than_file",
                f"asofdate={stamp} but the newest in this pull is {issued_at}", r))
            continue

        pack = _as_int(r.get("unitspercase"))
        bottle = _as_float(r.get("priceperunit"))
        volume = parse_size_to_ml(r.get("size"))

        if pack is None or pack <= 0:
            refusals.append(Refusal("bad_pack", f"unitspercase={r.get('unitspercase')!r}", r))
            continue
        if bottle is None or bottle <= 0:
            refusals.append(Refusal("no_price", f"priceperunit={r.get('priceperunit')!r}", r))
            continue

        case = _as_float(r.get("pricepercase"))
        if case is not None and case > 0:
            implied = bottle * pack
            if abs(implied - case) / case > CASE_CONSISTENCY_TOLERANCE:
                refusals.append(Refusal(
                    "case_price_inconsistent",
                    f"priceperunit {bottle} x {pack} = {implied:.2f} "
                    f"but pricepercase = {case}", r))
                continue

        code = str(r.get("itemcode", "")).strip()
        if not code:
            refusals.append(Refusal("no_item_code", "itemcode is blank", r))
            continue
        if code in seen:
            refusals.append(Refusal("duplicate_item_code", f"itemcode {code} seen", r))
            continue
        seen.add(code)

        unit_price, note = normalize_unit_price(bottle, pack, volume)
        if volume is None:
            note = f"{note}; size {r.get('size')!r} did not parse to a volume"

        sightings.append(Sighting(
            source_key="oregon-olcc-monthly-pricing",
            source_class="posted_wholesale_list",
            issuer="Oregon Liquor & Cannabis Commission",
            issuer_jurisdiction="US-OR",
            issued_at=str(issued_at),
            fetched_at=fetched_at,
            source_url=OREGON_URL,
            source_ref=f"{OREGON_URL}#itemcode={code}",
            attribution=OREGON_ATTRIBUTION,
            product_name=str(r.get("description") or "").strip(),
            # OLCC's posted shelf price. An Oregon on-premise licensee buys at this list
            # less a statutory discount, so this is NOT what a restaurant pays either.
            price_basis="priceperunit (OLCC posted shelf price)",
            raw_price=bottle,
            currency="USD",
            pack_size=pack,
            unit_volume_ml=volume,
            normalized_unit_price=unit_price,
            normalization_note=note,
            external_ids={
                k: str(r[k]).strip() for k in ("itemcode", "extendeditemcode")
                if r.get(k)
            },
            extra={
                "category": r.get("category"),
                "item_status": r.get("itemstatus"),
                "special_pricing": r.get("specialpricing"),
                "price_change": r.get("pricechange"),
                "country_of_origin": r.get("countryoforigin"),
                "price_per_case": case,
            },
        ))

    return RunResult("oregon-olcc-monthly-pricing", fetched_at, issued_at,
                     len(rows), sightings, refusals)


# --------------------------------------------------------------------------- fetch


def _get(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    })
    token = _env("SOCRATA_APP_TOKEN")
    # The HOST, not a substring: "data.oregon.gov" appears anywhere in
    # "https://evil.example/?x=data.oregon.gov", and the app token must not
    # travel to whatever that is.
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    if token and (host == "data.oregon.gov" or host.endswith(".data.oregon.gov")):
        req.add_header("X-App-Token", token)
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read()


def _env(name: str) -> str | None:
    import os
    return os.environ.get(name) or None


def fetch_iowa() -> list[dict[str, Any]]:
    body = _get(IOWA_URL)
    return [json.loads(l) for l in body.decode("utf-8").splitlines() if l.strip()]


def fetch_oregon(as_of: str | None = None) -> list[dict[str, Any]]:
    """Page the newest posting at $limit=1000, sleeping the robots.txt crawl delay."""
    if as_of is None:
        newest = json.loads(_get(
            f"{OREGON_URL}?$select=asofdate&$order=asofdate%20desc&$limit=1"))
        if not newest:
            raise CannotCheck("Oregon: could not read the newest asofdate.")
        as_of = str(newest[0]["asofdate"])[:10]
        time.sleep(OREGON_CRAWL_DELAY_S)

    out: list[dict[str, Any]] = []
    offset = 0
    while True:
        url = (f"{OREGON_URL}?$where=asofdate%3D%27{as_of}%27"
               f"&$limit=1000&$offset={offset}")
        page = json.loads(_get(url))
        out.extend(page)
        if len(page) < 1000:
            break
        offset += 1000
        time.sleep(OREGON_CRAWL_DELAY_S)  # robots.txt: Crawl-delay: 1
    return out


def load_fixture(name: str) -> list[dict[str, Any]]:
    path = FIXTURES / name
    if not path.exists():
        raise CannotCheck(f"fixture missing: {path}")
    text = path.read_text()
    if path.suffix == ".ndjson":
        return [json.loads(l) for l in text.splitlines() if l.strip()]
    return json.loads(text)


SOURCES = {
    "iowa": {
        "fixture": "iowa-liquor-products-2026-09-01.sample.ndjson",
        "fetch": fetch_iowa,
        "parse": parse_iowa,
        # Monthly file. Two months without a new report_as_of means the publication
        # stopped, or we are reading a cached copy, and either way the numbers are not
        # today's.
        "max_age_days": 62,
    },
    "oregon": {
        "fixture": "oregon-olcc-pricing-2026-09-01.sample.json",
        "fetch": fetch_oregon,
        "parse": parse_oregon,
        "max_age_days": 62,
    },
}


# ---------------------------------------------------------------------- reporting


def staleness_days(issued_at: str | None, today: date) -> int | None:
    if not issued_at:
        return None
    try:
        d = datetime.strptime(issued_at[:10], "%Y-%m-%d").date()
    except ValueError:
        return None
    return (today - d).days


def report(result: RunResult, max_age_days: int, today: date, limit: int = 5) -> int:
    print(f"\nsource        {result.source_key}")
    print(f"fetched_at    {result.fetched_at}")
    print(f"issued_at     {result.issued_at}   (the ISSUER's date, not ours)")

    age = staleness_days(result.issued_at, today)
    if age is None:
        print("\nREFUSED: the file carries no issue date this parser could read. A sighting "
              "without an issuer's date is not a sighting (ADR 0117).")
        return 1
    print(f"age           {age} days (refuse above {max_age_days})")
    if age > max_age_days:
        print(f"\nREFUSED: the newest posting is {age} days old, past the {max_age_days}-day "
              "cadence this source is allowed. Nothing is parsed as current.\n"
              "This is the bh_fv020.txt fault: a 200 OK is not freshness.")
        return 1

    print(f"rows read     {result.rows_read}")
    print(f"sightings     {len(result.sightings)}")
    print(f"refused       {len(result.refusals)}")
    for reason, n in sorted(result.tally().items(), key=lambda kv: -kv[1]):
        print(f"                {n:>6}  {reason}")

    if not result.sightings:
        print("\nREFUSED: nothing survived the checks. An empty parse is reported as empty, "
              "never as success.")
        return 1

    print(f"\nWOULD WRITE (first {limit} of {len(result.sightings)}):")
    for s in result.sightings[:limit]:
        unit = ("—" if s.normalized_unit_price is None
                else f"{s.normalized_unit_price:.2f}")
        vol = "—" if s.unit_volume_ml is None else f"{s.unit_volume_ml}ml"
        print(f"  {s.product_name[:44]:<44} {s.currency} {s.raw_price:>9.2f} "
              f"x{s.pack_size:<4} {vol:>8}  ->{unit:>9}/750ml")
        print(f"    basis={s.price_basis}  issuer={s.issuer} [{s.issuer_jurisdiction}]")
        print(f"    hash={s.content_hash()[:16]}  ref={s.source_ref}")
        print(f"    norm: {s.normalization_note}")

    if result.refusals:
        print(f"\nREFUSED ROWS (first {limit} of {len(result.refusals)}):")
        for r in result.refusals[:limit]:
            print(f"  [{r.reason}] {r.detail}")

    print("\nDRY RUN — nothing was written. See 'Why --apply is refused' in this file's "
          "header for the three blockers ADR 0117 must clear first.")
    return 0


# ---------------------------------------------------------------------- self-test


def self_test() -> int:
    """Parse both fixtures and assert every refusal the real files actually contain."""
    failures: list[str] = []

    def expect(label: str, got: Any, want: Any) -> None:
        if got != want:
            failures.append(f"{label}: got {got!r}, want {want!r}")

    fetched = "1970-01-01T00:00:00Z"

    # --- Iowa -------------------------------------------------------------
    iowa = parse_iowa(load_fixture(SOURCES["iowa"]["fixture"]), fetched)
    expect("iowa rows read", iowa.rows_read, 24)
    expect("iowa issued_at", iowa.issued_at, "2026-09-01")
    tally = iowa.tally()
    # Three rows fail the case-price cross-check, and all three are real:
    #   920301  state_bottle_cost 1250 x pack 6 = 7500 against a case cost of 240
    #   986503  6.56 x 12 = 78.72 against a case cost of 164.28
    #   810000  an "Ingredient" bulk listing: pack 1, cost 9.50, case cost 114.00
    # Measured over the whole 13,762-row file: 29 rows fail this way.
    expect("iowa case_price_inconsistent", tally.get("case_price_inconsistent"), 3)
    # item_no 100026 appears under two categories in the real file. Over the whole
    # file: 2,308 such repeats, collapsing 13,762 rows to 11,425 sightings.
    expect("iowa duplicate_item_no", tally.get("duplicate_item_no"), 1)
    expect("iowa sightings", len(iowa.sightings), 20)

    # Every one of the eleven `bottle_volume_ml = 0` rows in the real file is an
    # "Ingredient" bulk listing whose pack is also wrong, so all eleven are refused by
    # the case cross-check before the volume ever matters. Assert the refusal, not an
    # admission that does not happen.
    zero_vol_refusals = [r for r in iowa.refusals
                         if r.row.get("item_no") == "810000"]
    expect("iowa volumeless row is refused", len(zero_vol_refusals), 1)
    expect("iowa volumeless row's reason",
           zero_vol_refusals[0].reason, "case_price_inconsistent")

    # And a volumeless price, in isolation, must never claim to be per 750ml.
    vol_none_price, vol_none_note = normalize_unit_price(30.0, 3, None)
    expect("volumeless price is per package", vol_none_price, 10.0)
    if "NOT per 750ml" not in vol_none_note:
        failures.append("a volumeless row must say its price is per package")
    expect("zero volume is treated as unstated, not as a volume",
           normalize_unit_price(30.0, 3, 0)[0], 10.0)

    # 3.5L bag-in-box, pack 3, retail 45.00 -> 45/3 = 15.00 per 3500ml
    #                                       -> 15 * (750/3500) = 3.214...
    bib = [s for s in iowa.sightings if s.external_ids.get("item_no") == "100015"]
    expect("iowa bag-in-box present", len(bib), 1)
    if bib and abs((bib[0].normalized_unit_price or 0) - 3.2142857) > 1e-5:
        failures.append(
            f"iowa 3.5L normalisation: got {bib[0].normalized_unit_price}, want 3.2142857")

    # The basis is named, and it is the licensee price, not the state's cost.
    if iowa.sightings and iowa.sightings[0].price_basis != "state_bottle_retail":
        failures.append("iowa: price_basis must name which published number this is")
    if any(not s.attribution for s in iowa.sightings):
        failures.append("iowa: CC BY 4.0 requires attribution on EVERY sighting")
    if any(s.issuer_jurisdiction != "US-IA" for s in iowa.sightings):
        failures.append("iowa: every sighting must name the one state it is a price in")

    # --- Oregon -----------------------------------------------------------
    ore = parse_oregon(load_fixture(SOURCES["oregon"]["fixture"]), fetched)
    expect("oregon rows read", ore.rows_read, 12)
    expect("oregon issued_at", ore.issued_at, "2026-09-01")
    expect("oregon sightings", len(ore.sightings), 12)
    expect("oregon refusals", len(ore.refusals), 0)

    # '1.75 L' must become 1750, and OLD CROW 19.95 / 6 * (750/1750) = 1.425
    crow = [s for s in ore.sightings if s.external_ids.get("itemcode") == "0152H"]
    expect("oregon 1.75L row present", len(crow), 1)
    if crow:
        expect("oregon 1.75L -> ml", crow[0].unit_volume_ml, 1750)
        if abs((crow[0].normalized_unit_price or 0) - 1.425) > 1e-9:
            failures.append(
                f"oregon 1.75L normalisation: got {crow[0].normalized_unit_price}, want 1.425")

    # A row whose optional 'age' key Socrata omitted must still parse.
    ancient = [s for s in ore.sightings if s.external_ids.get("itemcode") == "0155H"]
    expect("oregon row with omitted optional field", len(ancient), 1)

    # --- units and refusals, in isolation ---------------------------------
    expect("parse '750 ML'", parse_size_to_ml("750 ML"), 750)
    expect("parse '1.75 L'", parse_size_to_ml("1.75 L"), 1750)
    expect("parse '' -> None", parse_size_to_ml(""), None)
    expect("parse 'Bag in box' -> None", parse_size_to_ml("Bag in box"), None)
    expect("parse '0 ML' -> None", parse_size_to_ml("0 ML"), None)
    expect("pack 0 refuses", normalize_unit_price(10.0, 0, 750)[0], None)

    # --- the staleness gate, which is the point of the whole script --------
    today = date(2026, 9, 4)
    expect("fresh file passes", staleness_days("2026-09-01", today), 3)
    # bh_fv020.txt on 2026-09-04 served a report dated 03-JAN-2024.
    expect("the USDA stale case", staleness_days("2024-01-03", today), 975)
    print("--- expected output of the staleness gate, exercised deliberately ---")
    stale = RunResult("stale-source-under-test", fetched, "2024-01-03",
                      1, list(iowa.sightings[:1]), [])
    if report(stale, max_age_days=62, today=today) != 1:
        failures.append("a 975-day-old posting must be REFUSED, not parsed")
    # A file with no readable issue date is refused too — not parsed as fresh.
    undated = RunResult("undated-source-under-test", fetched, None, 1, [], [])
    if report(undated, max_age_days=62, today=today) != 1:
        failures.append("a posting with no issue date must be REFUSED")
    print("--- end of expected output ---")

    # --- content hash: same price twice is not new evidence ----------------
    a = iowa.sightings[0]
    b = parse_iowa(load_fixture(SOURCES["iowa"]["fixture"]), "2999-01-01T00:00:00Z").sightings[0]
    expect("re-read of an unchanged price hashes the same",
           a.content_hash(), b.content_hash())

    if failures:
        print("SELF-TEST FAILED")
        for f in failures:
            print(f"  - {f}")
        return 1
    # Counted, never asserted from memory: a summary line that drifts from the run is
    # the same fault as a price that drifts from its source.
    rows_n = iowa.rows_read + ore.rows_read
    seen_n = len(iowa.sightings) + len(ore.sightings)
    ref_n = len(iowa.refusals) + len(ore.refusals)
    print(f"SELF-TEST PASSED — 2 fixtures, {rows_n} rows, {seen_n} sightings, "
          f"{ref_n} refusals; the staleness gate refuses the measured 975-day USDA "
          "case and an undated file.")
    return 0


# --------------------------------------------------------------------------- main


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Parse a published price list into price sightings. Writes nothing.")
    ap.add_argument("--source", choices=sorted(SOURCES), help="which published list")
    ap.add_argument("--offline", action="store_true",
                    help="parse the recorded fixture instead of fetching")
    ap.add_argument("--apply", action="store_true",
                    help="write the sightings (REFUSED — see this file's header)")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--max-age-days", type=int, default=None,
                    help="override the source's cadence bound")
    ap.add_argument("--limit", type=int, default=5, help="how many rows to print")
    args = ap.parse_args()

    if args.self_test:
        try:
            return self_test()
        except CannotCheck as exc:
            print(f"CANNOT CHECK: {exc}")
            return 2

    if args.apply:
        print(
            "REFUSED: --apply is not implemented, deliberately.\n\n"
            "  1. vpo_source_type_check admits no value meaning 'a state's posted list'\n"
            "     (20260805154027_vendor_price_observations.sql:112-115). api_catalog\n"
            "     means 'the vendor's own structured feed' and this is not one.\n"
            "  2. The table has no column for the issuer, the jurisdiction, or the\n"
            "     issuance timestamp. Provenance would hide in raw jsonb.\n"
            "  3. restaurant_id would be NULL, and belowTrailingAverage reads\n"
            "     `restaurant_id.is.null OR restaurant_id.eq.<tenant>`\n"
            "     (vendor-comparison.service.ts:341) — so an Iowa shelf price would\n"
            "     appear in EVERY house's market box. That is the comparison the\n"
            "     founder's index rule forbids.\n\n"
            "ADR 0117 has to clear all three before a writer is honest. Run without\n"
            "--apply to see exactly what it would write.")
        return 1

    if not args.source:
        ap.error("--source is required (or use --self-test)")

    spec = SOURCES[args.source]
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    try:
        if args.offline:
            rows = load_fixture(spec["fixture"])
            print(f"OFFLINE — parsing the recorded fixture {spec['fixture']}. "
                  "These are real bytes from a real fetch (see PROVENANCE.md), but they "
                  "are NOT today's posting.")
        else:
            rows = spec["fetch"]()
        result = spec["parse"](rows, fetched_at)
    except CannotCheck as exc:
        print(f"CANNOT CHECK: {exc}")
        return 2
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
        # Not a pass, and not "the source has no data". Say which.
        print(f"CANNOT CHECK: the fetch failed ({exc}). This says nothing about whether "
              "the source has prices — only that we could not read it. Retry, or run "
              "--offline against the fixture.")
        return 2

    max_age = args.max_age_days if args.max_age_days is not None else spec["max_age_days"]
    return report(result, max_age, date.today(), args.limit)


if __name__ == "__main__":
    sys.exit(main())
