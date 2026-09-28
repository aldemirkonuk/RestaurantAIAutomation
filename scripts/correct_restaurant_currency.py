#!/usr/bin/env python3
"""Correct the three houses whose `restaurants.currency` says USD and should not.

THE FINDING
-----------
`restaurants.currency` is `USD` on all fourteen production houses — measured
2026-09-05 and recorded as ADR 0117 Q25. Three of those fourteen are not in a
dollar country:

    Chez Community     Fethiye, Mugla, Turkiye        -> TRY
    The Old House Pub  Antalya, Turkiye               -> TRY
    ADMIN 1            London, England, United Kingdom -> GBP

Nobody typed `USD` on any of them. The column carries
`DEFAULT 'USD'::character varying` (`supabase/migrations/`
`20260805000000_baseline_from_production.sql:3576`) and the only insert that
creates a house — `AuthService.registerRestaurant`, `apps/api-gateway/src/auth/`
`auth.service.ts:762-780` — names no `currency` key at all. So the default is the
writer, and there is no application code to fix here: this is a DATA correction,
which is why it is a script and not a code change. The shape fix (dropping the
default so an unstated currency reads as unstated) is
`supabase/migrations/20260905120000_a_house_names_its_money.sql`, and the
onboarding step that asks the question is on the sign-up form.

WHY A SCRIPT AND NOT A MIGRATION
--------------------------------
A migration auto-applies on merge. An UPDATE of live tenant rows must not ride a
merge: it needs the founder's word on the day, a dry run read out loud first, and
a person deciding that these three rows are the three. So: a script, dry by
default, refusing `--apply` unless `--i-have-the-founders-word` is passed with it.

WHAT IT WILL NOT DO
-------------------
  * It will not touch the other eleven houses. Ten of them are in the United
    States, where `USD` is right by accident rather than by statement, and
    `Sim Bistro`/`Sim Meyhouse` are simulator tenants. Whether a US house's `USD`
    should also be cleared so that a stored code means "somebody said so" is a
    decision the founder has not made; it is filed, not assumed.
  * It will not derive a currency from anything but the country/region already on
    the row, and only for a country in the table below. A row whose country it
    does not recognise is REPORTED, never guessed at.
  * It will not write a currency onto a row that already carries a non-USD one.
    That would overwrite somebody's answer with this file's opinion.

TWO MODES, AND THEY ARE DIFFERENT DECISIONS
-------------------------------------------
**CORRECT** (the default) fixes a row whose stored currency is WRONG for its
country. Three rows qualified and were corrected on the founder's word on
2026-09-05: ADMIN 1 to GBP, Chez Community and The Old House Pub to TRY.

**--clear-inherited** answers ADR 0117 Q30, founder 2026-09-05: *"Clear all
eleven to unrecorded; the onboarding step asks"*. It sets `currency = NULL` on
every house still carrying the value the dropped column default used to supply.
Those rows are not WRONG — ten are in the United States, where USD is right —
they are UNATTRIBUTABLE: a default is indistinguishable from an answer, which is
the definition of the fault, so no query can separate the two.

**This erases real answers along with the fabricated ones.** A manager who
genuinely chose USD loses that choice and is asked again. That is deliberate and
it is the only honest option available: keeping every fabricated answer in order
to save the few real ones leaves nothing downstream able to learn which is which.
Dropping is recoverable — the onboarding step asks, and the answer is then
provably somebody's. It is the same trade
`20260903170000_a_default_is_not_an_answer.sql` took for three other columns.

USAGE
-----
    python3 scripts/correct_restaurant_currency.py                  # dry run
    python3 scripts/correct_restaurant_currency.py --self-test      # no DB
    python3 scripts/correct_restaurant_currency.py --apply --i-have-the-founders-word

    python3 scripts/correct_restaurant_currency.py --clear-inherited
    python3 scripts/correct_restaurant_currency.py --clear-inherited --apply --i-have-the-founders-word

Environment (read from the nearest .env upward, then the process environment):
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

Exit codes: 0 the run did what it said; 1 a required input is missing or a
guard refused; 2 the run was partial (at least one intended write failed) — a
partial run is never reported as a clean one.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# WHY THIS TALKS TO PostgREST WITH THE STANDARD LIBRARY
# ---------------------------------------------------------------------------
# The obvious move is `from supabase import create_client`, which is what
# `scripts/backfill_restaurant_coordinates.py` does. Measured 2026-09-05 on this
# machine, that import is a TRAP for anything run from the repository root: the
# repo contains a directory called `supabase/`, so `import supabase` succeeds as
# an implicit namespace package and `import supabase; print("ok")` passes — while
# `from supabase import create_client` then fails with "cannot import name
# create_client from 'supabase' (unknown location)". The default `python3` here
# (3.9) does not have the package at all; only `python3.11` does. A script that
# reports "MISSING: the supabase package" when the package is present, and
# reports nothing at all when it is absent, is the wrong shape for a file whose
# whole job is to be trusted about production rows.
#
# Two REST calls do not need a client library. `urllib` is in every python3,
# cannot be shadowed by a sibling directory, and makes the exact request visible
# in this file.


class PostgrestError(RuntimeError):
    """A read or write that did not happen, with the server's own words."""


def postgrest(
    base_url: str,
    key: str,
    path: str,
    *,
    method: str = "GET",
    params: dict[str, str] | None = None,
    body: dict[str, Any] | None = None,
    prefer: str | None = None,
) -> Any:
    url = f"{base_url.rstrip('/')}/rest/v1/{path}"
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "User-Agent": "Mudavym/correct-restaurant-currency",
    }
    if prefer:
        headers["Prefer"] = prefer
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:400]
        raise PostgrestError(f"HTTP {exc.code} on {method} {path}: {detail}") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise PostgrestError(f"{type(exc).__name__} on {method} {path}: {exc}") from exc
    if not raw.strip():
        return []
    return json.loads(raw)

# ---------------------------------------------------------------------------
# The evidence: place -> ISO 4217.
# ---------------------------------------------------------------------------
# Deliberately tiny. This is not a world currency table — it is the set of
# countries the fourteen production houses actually sit in, plus the spellings
# Google Places has served into `restaurants.country` (measured on the live rows,
# 2026-09-05: "United States", "united States", "USA", "US", "United Kingdom",
# and "Türkiye" with the u-umlaut, which is what Google returns today — the
# sign-up form's own COUNTRY_ISO table still spells it "Turkey" and therefore
# misses it, `apps/web/src/components/ui/PlacesAutocomplete.tsx:76`). Keys here
# are diacritic-folded and lower-cased by `normalise_country`, so both spellings
# land on the same row. The onboarding step's full table lives in
# `apps/web/src/lib/currency.ts` and carries the same source and date; this file
# holds only what it needs to justify THESE rows, so that a reader can check the
# whole argument without leaving the file.
#
# Source: ISO 4217 alpha-3, as published by SIX Financial Information for ISO
# (the maintenance agency), list A1. Read 2026-09-05. TRY is Turkiye's code since
# the 2005 redenomination; GBP is the United Kingdom's.
COUNTRY_TO_CURRENCY: dict[str, str] = {
    "tr": "TRY",
    "turkiye": "TRY",
    "turkey": "TRY",
    "gb": "GBP",
    "uk": "GBP",
    "united kingdom": "GBP",
    "great britain": "GBP",
    "us": "USD",
    "usa": "USD",
    "united states": "USD",
    "united states of america": "USD",
}

# What the column says today, and the thing this script exists because of.
COLUMN_DEFAULT = "USD"
COLUMN_DEFAULT_CITATION = (
    "supabase/migrations/20260805000000_baseline_from_production.sql:3576 "
    "-- currency character varying(3) DEFAULT 'USD'::character varying"
)
SIGNUP_INSERT_CITATION = (
    "apps/api-gateway/src/auth/auth.service.ts:762-780 "
    "-- AuthService.registerRestaurant's restaurants insert names no currency key"
)

# The columns read for the whole-tuple print. Every column on the row would
# include `pos_credentials`, which is a secret; the report names what it omits
# rather than printing it.
TUPLE_COLUMNS = (
    "id, name, slug, parent_restaurant_id, group_name, email, phone, address, "
    "timezone, currency, pos_system, buffer_window_minutes, default_threshold_min, "
    "is_active, subscription_tier, created_at, updated_at, deleted_at, "
    "default_pour_ml, measurement_unit, city, organization_id, chain_id, country, "
    "cuisine_type, state_province, postal_code, neighborhood, threshold_configured"
)
OMITTED_COLUMNS = ("pos_credentials", "calendar_ical_token")

# ---------------------------------------------------------------------------
# The foreign keys that reference `restaurants`.
# ---------------------------------------------------------------------------
# Measured on production 2026-09-05 with:
#
#   select con.conname, src.relname, con.confkey
#     from pg_constraint con
#     join pg_class tgt on tgt.oid = con.confrelid
#     join pg_class src on src.oid = con.conrelid
#    where con.contype = 'f' and tgt.relname = 'restaurants';
#
# 83 constraints, and EVERY ONE of them references `restaurants(id)`. Not one
# references `currency`. So the UPDATE below touches no key, cascades nothing and
# orphans nothing.
#
# That number is a measurement of one day, so the script does not rest on it: the
# static sweep in `referencing_columns_from_migrations` re-derives the referenced
# column from the migration corpus on every run, offline, and REFUSES if it finds
# a foreign key pointing at any column of `restaurants` other than `id`. An
# assertion that can only be checked by the person who wrote it is not a check.
MEASURED_FK_COUNT = 83
MEASURED_FK_DATE = "2026-09-05"

FK_PATTERN = re.compile(
    r"REFERENCES\s+(?:public\.)?restaurants\s*\(\s*([a-z_]+)\s*\)",
    re.IGNORECASE,
)


def referencing_columns_from_migrations(migrations_dir: Path) -> dict[str, int]:
    """Every column of `restaurants` that some foreign key points at, counted.

    Read from the migration corpus rather than from the live catalogue, so the
    check runs offline and on the tree being reported.
    """
    found: dict[str, int] = {}
    if not migrations_dir.is_dir():
        return found
    for path in sorted(migrations_dir.glob("*.sql")):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        for column in FK_PATTERN.findall(text):
            key = column.lower()
            found[key] = found.get(key, 0) + 1
    return found


# ---------------------------------------------------------------------------
# environment
# ---------------------------------------------------------------------------


def load_dotenv_upward(start: Path, keys: tuple[str, ...]) -> None:
    """Populate os.environ from the nearest .env that mentions any of `keys`.

    Existing process environment always wins.
    """
    for directory in [start, *start.parents]:
        for name in (".env", "apps/api-gateway/.env"):
            candidate = directory / name
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
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
            return


# ---------------------------------------------------------------------------
# the decision, as a pure function so the self-test can exercise it
# ---------------------------------------------------------------------------


def normalise_country(raw: str | None) -> str:
    """Lower-case and strip diacritics, so one country is one key.

    `Türkiye` and `Turkiye` are the same country written two ways, and the live
    rows hold the first. Folding here rather than adding both spellings to the
    table means the next accented country name works without an edit — and it
    means the table's keys stay readable ASCII.
    """
    import unicodedata

    text = (raw or "").strip().lower()
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def classify(row: dict[str, Any]) -> tuple[str, str | None, str]:
    """What this row is, what it should carry, and why — in one sentence.

    Returns `(verdict, target_currency, reason)`. `verdict` is one of
    `correct`, `already-stated`, `unrecognised-country`, `no-country`,
    `already-right`.
    """
    stored = (row.get("currency") or "").strip().upper()
    country_raw = row.get("country")
    country = normalise_country(country_raw)

    if not country:
        return (
            "no-country",
            None,
            "the row records no country, so nothing on it says what money this "
            "house takes. Asking is the only honest way to fill it.",
        )

    target = COUNTRY_TO_CURRENCY.get(country)
    if target is None:
        return (
            "unrecognised-country",
            None,
            f"country {country_raw!r} is not in this file's table. It is not "
            "guessed at; add it here with its ISO 4217 code and its source, or "
            "let the onboarding step ask.",
        )

    if stored and stored != COLUMN_DEFAULT:
        return (
            "already-stated",
            target,
            f"the row already carries {stored!r}, which is not the column "
            "default, so somebody stated it. This script does not overwrite an "
            "answer with its own opinion.",
        )

    if target == COLUMN_DEFAULT:
        return (
            "already-right",
            target,
            f"country {country_raw!r} prices in {target}, which is what the row "
            "carries. The value is right; whether anybody STATED it is a "
            "different question and is not settled by this script.",
        )

    return (
        "correct",
        target,
        f"country {country_raw!r} prices in {target}; the row carries "
        f"{stored or 'NULL'!r}, which is the column default and not an answer.",
    )


def classify_for_clearing(row: dict[str, Any]) -> tuple[str, str]:
    """Whether this row's currency is UNATTRIBUTABLE, and why — in one sentence.

    `clear` means the stored value is exactly what the dropped column default
    used to supply, so nothing can tell a chosen `USD` from an inherited one.
    Everything else is left alone, and the reason says which kind of "alone".
    """
    stored = (row.get("currency") or "").strip().upper()

    if not stored:
        return (
            "already-unrecorded",
            "the row already carries NULL, so the question is already open and "
            "the onboarding step will ask it.",
        )

    if stored != COLUMN_DEFAULT:
        return (
            "stated",
            f"the row carries {stored!r}, which the column default never "
            f"supplied. Somebody or something put it there deliberately — the "
            "three corrections of 2026-09-05 are exactly these rows — and this "
            "mode does not erase an answer it can attribute.",
        )

    # THE TWO MODES ARE DISJOINT, AND THE CORRECTION WINS.
    #
    # A row carrying the default in a country whose currency this file KNOWS is
    # claimed by the correction mode, and clearing it here would throw away
    # evidence the row itself carries: blanking a Fethiye house teaches nobody
    # anything, while writing TRY records what its own address already says. So
    # this rung defers rather than competing, and the self-test asserts that no
    # row is ever claimed by both — otherwise running the two modes in the other
    # order would leave a different register.
    correction_verdict, correction_target, _why = classify(row)
    if correction_verdict == "correct":
        return (
            "correct-first",
            f"the row carries the default, but its country "
            f"{row.get('country')!r} names {correction_target}. That is a better "
            "answer than NULL and it is on the row already: correct it with the "
            "default mode, and this mode leaves it alone.",
        )

    return (
        "clear",
        f"the row carries {stored!r}, which is precisely the value "
        f"`restaurants.currency DEFAULT '{COLUMN_DEFAULT}'` supplied to every "
        "house at creation. Nothing on the row, and no query anywhere, can tell "
        "that apart from a manager who chose it. Cleared to NULL so the "
        "onboarding step can ask, and so a stored code afterwards means "
        "somebody said so.",
    )


def clear_statement(row_id: str) -> str:
    """The statement `--clear-inherited` sends, written as SQL.

    Guarded by the value it expects to replace, for the same reason the
    correction is: a house that answers between the dry run and the apply keeps
    its answer, and the statement updates 0 rows.

    `updated_at` is not in the SET list and moves anyway — the table carries
    `update_restaurants_updated_at BEFORE UPDATE ... EXECUTE FUNCTION
    update_updated_at_column()`.
    """
    return (
        "update public.restaurants\n"
        "   set currency = NULL\n"
        f" where id = '{row_id}'\n"
        f"   and currency = '{COLUMN_DEFAULT}';"
    )


def update_statement(row_id: str, currency: str) -> str:
    """The statement this script sends, written as SQL.

    `updated_at` is deliberately NOT in the SET list. It moves anyway: the table
    carries `update_restaurants_updated_at BEFORE UPDATE ... EXECUTE FUNCTION
    update_updated_at_column()` (read from the live catalogue 2026-09-05). Naming
    it here would be this file claiming a write the trigger makes.
    """
    return (
        "update public.restaurants\n"
        f"   set currency = '{currency}'\n"
        f" where id = '{row_id}'\n"
        f"   and currency = '{COLUMN_DEFAULT}';"
    )


# ---------------------------------------------------------------------------
# the self-test
# ---------------------------------------------------------------------------


def self_test() -> int:
    """Exercise the decision and the guards without touching a database."""
    failures: list[str] = []

    def check(name: str, got: Any, want: Any) -> None:
        if got != want:
            failures.append(f"{name}: got {got!r}, want {want!r}")

    turkish = {"id": "a", "name": "Chez", "country": "Türkiye", "currency": "USD"}
    british = {"id": "b", "name": "Admin", "country": "United Kingdom", "currency": "USD"}
    american = {"id": "c", "name": "Yaren", "country": "United States", "currency": "USD"}
    weird_case = {"id": "d", "name": "Yaren2", "country": "united States", "currency": "USD"}
    stated = {"id": "e", "name": "Stated", "country": "Türkiye", "currency": "EUR"}
    unknown = {"id": "f", "name": "Unknown", "country": "Ruritania", "currency": "USD"}
    blank = {"id": "g", "name": "Blank", "country": None, "currency": "USD"}

    check("turkish verdict", classify(turkish)[0], "correct")
    check("turkish target", classify(turkish)[1], "TRY")
    check("british verdict", classify(british)[0], "correct")
    check("british target", classify(british)[1], "GBP")
    # A US house is NOT touched: the value is right and this script has no
    # opinion about whether it was stated.
    check("american verdict", classify(american)[0], "already-right")
    check("case-folded country", classify(weird_case)[0], "already-right")
    # An answer somebody gave is never overwritten, even by the "right" code.
    check("stated verdict", classify(stated)[0], "already-stated")
    check("unknown country", classify(unknown)[0], "unrecognised-country")
    check("no country", classify(blank)[0], "no-country")

    # The UPDATE is guarded by the value it expects to replace, so a row somebody
    # answered between the dry run and the apply is not clobbered.
    stmt = update_statement("11111111-2222-3333-4444-555555555555", "TRY")
    if "and currency = 'USD'" not in stmt:
        failures.append("update_statement lost its optimistic guard")
    if "updated_at" in stmt:
        failures.append(
            "update_statement names updated_at, which this script does not "
            "write — the table's BEFORE UPDATE trigger does"
        )

    # ---- --clear-inherited ------------------------------------------------
    # The three rows corrected on 2026-09-05 must now be UNTOUCHABLE by the
    # clearing mode: they carry a code the default never supplied, so they are
    # attributable and must survive.
    corrected_gb = {"id": "h", "name": "ADMIN 1", "country": "United Kingdom", "currency": "GBP"}
    corrected_tr = {"id": "i", "name": "Chez", "country": "Türkiye", "currency": "TRY"}
    inherited_us = {"id": "j", "name": "YARDOM", "country": "United States", "currency": "USD"}
    inherited_nowhere = {"id": "k", "name": "Meyhouse", "country": None, "currency": "USD"}
    already_null = {"id": "l", "name": "Fresh", "country": "United States", "currency": None}
    lowercase_usd = {"id": "m", "name": "Odd", "country": "United States", "currency": "usd"}

    check("corrected GBP is left alone", classify_for_clearing(corrected_gb)[0], "stated")
    check("corrected TRY is left alone", classify_for_clearing(corrected_tr)[0], "stated")
    check("inherited US is cleared", classify_for_clearing(inherited_us)[0], "clear")
    # A house with no country is cleared too: nothing on it says what money it
    # takes, and the value it carries is the default's.
    check("countryless is cleared", classify_for_clearing(inherited_nowhere)[0], "clear")
    check("already NULL is left alone", classify_for_clearing(already_null)[0],
          "already-unrecorded")
    # Case is folded before comparison, or a stray 'usd' would survive a sweep
    # whose whole purpose is to leave nothing behind that means the default.
    check("lowercase usd is cleared", classify_for_clearing(lowercase_usd)[0], "clear")

    clear_stmt = clear_statement("99999999-8888-4777-8666-555555555555")
    if "set currency = NULL" not in clear_stmt:
        failures.append("clear_statement does not set NULL")
    if "and currency = 'USD'" not in clear_stmt:
        failures.append("clear_statement lost its optimistic guard")
    if "updated_at" in clear_stmt:
        failures.append(
            "clear_statement names updated_at, which the trigger writes, not this "
            "script"
        )

    # The two modes must never both claim the same row. A row the correction
    # mode would change is a row the clearing mode must leave alone, and the
    # other way round — otherwise running them in either order gives a different
    # register.
    # A row that is WRONG and inherited belongs to the correction mode, which
    # has a better answer than NULL for it.
    check("wrong-and-inherited defers", classify_for_clearing(turkish)[0], "correct-first")

    for row in (turkish, british, american, weird_case, stated, unknown, blank,
                corrected_gb, corrected_tr, inherited_us, inherited_nowhere,
                already_null, lowercase_usd):
        corrects = classify(row)[0] == "correct"
        clears = classify_for_clearing(row)[0] == "clear"
        if corrects and clears:
            failures.append(
                f"{row['name']!r} would be claimed by BOTH modes; the order of "
                "the two runs would change the result"
            )

    # The static FK sweep must find the constraints and must find them all on
    # `id`. If it finds nothing at all, the pattern has rotted and the check is
    # vacuous — which is a failure, not a pass.
    columns = referencing_columns_from_migrations(REPO_ROOT / "supabase" / "migrations")
    if not columns:
        failures.append(
            "the FK sweep matched nothing in supabase/migrations — the pattern "
            "has rotted and the 'no key is touched' claim is unchecked"
        )
    else:
        strangers = {c: n for c, n in columns.items() if c != "id"}
        if strangers:
            failures.append(
                f"foreign keys reference restaurants columns other than id: {strangers}"
            )

    # Every code in the table is a well-formed ISO 4217 alpha-3.
    for country, code in COUNTRY_TO_CURRENCY.items():
        if not re.fullmatch(r"[A-Z]{3}", code):
            failures.append(f"{country} -> {code!r} is not an ISO 4217 alpha-3 code")

    if failures:
        print("SELF-TEST FAILED")
        for line in failures:
            print(f"  - {line}")
        return 1
    print(f"SELF-TEST PASSED ({len(COUNTRY_TO_CURRENCY)} country spellings, "
          f"{sum(columns.values())} foreign keys swept all on `id`, both modes "
          f"disjoint on 13 rows)")
    return 0


# ---------------------------------------------------------------------------
# the run
# ---------------------------------------------------------------------------


def print_tuple(row: dict[str, Any]) -> None:
    width = max(len(k) for k in row)
    for key in sorted(row):
        print(f"      {key.ljust(width)} = {row[key]!r}")


def print_foreign_keys(section: int) -> bool:
    """Section N of either mode: what references `restaurants`, and what moves.

    Returns False when the static sweep finds a foreign key pointing at a column
    other than `id` — at which point "this UPDATE touches no key" has stopped
    being true by inspection and the caller must write nothing.
    """
    print(f"{section}. EVERY FOREIGN KEY THAT REFERENCES `restaurants`, AND WHAT THE")
    print("   UPDATE TOUCHES")
    columns = referencing_columns_from_migrations(REPO_ROOT / "supabase" / "migrations")
    total = sum(columns.values())
    print(f"   Static sweep of supabase/migrations on this tree: {total} foreign")
    print("   key declarations pointing at `restaurants`, by referenced column:")
    for column, count in sorted(columns.items()):
        print(f"     restaurants({column}) <- {count} declaration(s)")
    strangers = {c: n for c, n in columns.items() if c != "id"}
    if strangers:
        print()
        print("   REFUSED: a foreign key references a column other than `id`:")
        print(f"     {strangers}")
        print("   The claim 'this UPDATE touches no key' is no longer true by")
        print("   inspection. Nothing was written.")
        return False
    print()
    print(f"   Live catalogue, measured {MEASURED_FK_DATE}: {MEASURED_FK_COUNT}")
    print("   constraints, every one of them on `restaurants(id)`.")
    print("   `currency` is referenced by NO foreign key, carries no unique index")
    print("   and is in no primary key, so this UPDATE cascades nothing, orphans")
    print("   nothing and cannot change any row's identity.")
    print("   One column moves that the statement does not name: `updated_at`,")
    print("   set by the table's own BEFORE UPDATE trigger")
    print("   `update_restaurants_updated_at` -> `update_updated_at_column()`")
    print("   (read from the live catalogue 2026-09-05). Said here so the apply")
    print("   log and the row afterwards agree.")
    print()
    return True


def run_clear_inherited(
    rows: list[dict[str, Any]],
    args: argparse.Namespace,
    supabase_url: str,
    supabase_key: str,
) -> int:
    """ADR 0117 Q30: clear every currency that is only the old column default.

    Sections are numbered from 2 so a reader can line this report up against the
    correction mode's: 0 and 1 are identical in both, and 4 is literally the same
    function.
    """
    buckets: dict[str, list[tuple[dict[str, Any], str]]] = {}
    for row in rows:
        verdict, reason = classify_for_clearing(row)
        buckets.setdefault(verdict, []).append((row, reason))

    for verdict in ("clear", "correct-first", "stated", "already-unrecorded"):
        print(f"   {verdict:<22} {len(buckets.get(verdict, []))}")
    print()

    to_clear = buckets.get("clear", [])

    # ---- 2 -------------------------------------------------------------
    print("2. THE ROWS THAT CHANGE, WHOLE")
    print("   Every one of these is being cleared because its value CANNOT BE")
    print("   ATTRIBUTED, not because it is wrong. Ten of them are American and")
    print(f"   {COLUMN_DEFAULT} is very probably right for them. It is erased anyway: a")
    print("   default is indistinguishable from an answer, so keeping these to")
    print("   save the few real ones leaves nothing downstream able to learn")
    print("   which is which. The onboarding step asks, and the next value is")
    print("   provably somebody's.")
    print()
    if not to_clear:
        print("   None. No house still carries the old column default.")
        print()
    for row, reason in to_clear:
        print(f"   {row['name']} ({row['id']})")
        print(f"     currency {row.get('currency')!r} -> NULL (not recorded)")
        print(f"     because: {reason}")
        print("     the whole row as it stands today:")
        print_tuple(row)
        print()

    # ---- 3 -------------------------------------------------------------
    print("3. WHAT IS NOT TOUCHED, NAMED ROW BY ROW")
    if not any(buckets.get(v) for v in ("correct-first", "stated", "already-unrecorded")):
        print("   Nothing. Every house on the register carries the old default.")
    for verdict in ("correct-first", "stated", "already-unrecorded"):
        for row, reason in buckets.get(verdict, []):
            print(f"   [{verdict}] {row['name']} ({row['id']})")
            print(f"       {reason}")
    print()

    # ---- 4 -------------------------------------------------------------
    if not print_foreign_keys(4):
        return 1

    # ---- 5 -------------------------------------------------------------
    print("5. THE EXACT STATEMENTS")
    if not to_clear:
        print("   None.")
    for row, _reason in to_clear:
        print()
        for line in clear_statement(row["id"]).splitlines():
            print(f"   {line}")
    print()
    print("   NULL is already legal here: `restaurants.currency` is")
    print("   `character varying(3)` with `is_nullable = YES`, read from the live")
    print("   catalogue 2026-09-05, and it has been nullable since the production")
    print("   baseline. No migration is needed for this write, and")
    print("   `20260905120000_a_house_names_its_money.sql` — which drops the")
    print("   default and adds `check (currency is null or currency ~")
    print("   '^[A-Z]{3}$')` — admits NULL explicitly, so applying it after this")
    print("   run cannot reject a row this run created.")
    print()
    print(f"   The `and currency = '{COLUMN_DEFAULT}'` clause is not decoration: a house")
    print("   that answers the onboarding question between this dry run and the")
    print("   apply keeps its answer, and the statement updates 0 rows.")
    print()

    if not args.apply:
        print("=" * 78)
        print("DRY RUN. Nothing was written. To write, and only on the founder's")
        print("word:")
        print("  python3 scripts/correct_restaurant_currency.py --clear-inherited "
              "--apply --i-have-the-founders-word")
        print("=" * 78)
        return 0

    # ---- 6 -------------------------------------------------------------
    print("6. WRITING")
    failures = 0
    written = 0
    for row, _reason in to_clear:
        try:
            returned = postgrest(
                supabase_url,
                supabase_key,
                "restaurants",
                method="PATCH",
                params={
                    "id": f"eq.{row['id']}",
                    "currency": f"eq.{COLUMN_DEFAULT}",
                    "select": "id,name,currency",
                },
                body={"currency": None},
                prefer="return=representation",
            )
        except PostgrestError as exc:
            failures += 1
            print(f"   FAILED  {row['name']} ({row['id']}) — {exc}")
            continue
        touched = len(returned or [])
        if touched == 1:
            written += 1
            print(f"   CLEARED {row['name']} ({row['id']}) -> NULL")
        elif touched == 0:
            failures += 1
            print(
                f"   MISSED  {row['name']} ({row['id']}) — 0 rows matched. The "
                "row no longer carries the column default; somebody answered it "
                "in between. Read it before deciding anything."
            )
        else:
            failures += 1
            print(
                f"   STRANGE {row['name']} ({row['id']}) — {touched} rows "
                "matched a primary-key predicate. Stop and look."
            )
    print()
    print(f"   {written} cleared, {failures} not.")
    if failures:
        print("   PARTIAL RUN. Exit 2 — this is not a clean run and is not")
        print("   reported as one.")
        return 2
    return 0


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="write the corrections. Refused unless --i-have-the-founders-word "
        "is passed with it.",
    )
    parser.add_argument(
        "--i-have-the-founders-word",
        dest="founders_word",
        action="store_true",
        help="the second half of the write gate. One flag can be typed by "
        "accident; two, one of which is a sentence about a person, cannot.",
    )
    parser.add_argument(
        "--clear-inherited",
        dest="clear_inherited",
        action="store_true",
        help="ADR 0117 Q30: set currency = NULL on every house still carrying "
        "the value the dropped column default supplied, so the onboarding step "
        "can ask. Erases genuine USD answers too; that is the decision.",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="exercise the decision and the guards; touches no database.",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.self_test:
        return self_test()

    if args.apply and not args.founders_word:
        print(
            "REFUSED: --apply writes to fourteen live tenant rows' worth of "
            "table and needs --i-have-the-founders-word beside it.\n"
            "Nothing was read and nothing was written."
        )
        return 1
    if args.founders_word and not args.apply:
        print(
            "REFUSED: --i-have-the-founders-word on its own does nothing. Pass "
            "--apply with it, or drop it and read the dry run."
        )
        return 1

    load_dotenv_upward(REPO_ROOT, ("SUPABASE_SERVICE_ROLE_KEY",))
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    missing = [
        name
        for name, value in (
            ("SUPABASE_URL", supabase_url),
            ("SUPABASE_SERVICE_ROLE_KEY", supabase_key),
        )
        if not value
    ]
    if missing:
        print(f"MISSING: {', '.join(missing)} — cannot read the register.")
        return 1

    mode = "APPLY" if args.apply else "DRY RUN"
    print("=" * 78)
    print(f"correct_restaurant_currency.py — {mode}")
    print("=" * 78)
    print()

    # ---- 0. The writer that set USD --------------------------------------
    print("0. THE WRITER THAT SET USD")
    print("   It is the column default, not application code:")
    print(f"     {COLUMN_DEFAULT_CITATION}")
    print("   The only insert that creates a house names no currency key:")
    print(f"     {SIGNUP_INSERT_CITATION}")
    print("   So every house has carried USD since it was created, whether or")
    print("   not anybody was ever asked. Correcting three rows does not stop")
    print("   the fifteenth house from arriving with the same fabricated answer;")
    print("   dropping the default does, and that is the migration named in the")
    print("   docstring, not this script.")
    print()

    try:
        rows: list[dict[str, Any]] = postgrest(
            supabase_url,
            supabase_key,
            "restaurants",
            params={"select": TUPLE_COLUMNS, "order": "created_at.asc"},
        )
    except PostgrestError as exc:
        # A failed read is never reported as an empty one.
        print(f"COULD NOT READ the register: {exc}")
        print("Nothing was written. This is not 'no houses need correcting'.")
        return 1
    print(f"1. THE REGISTER: {len(rows)} houses read.")
    print(f"   Columns omitted from the tuple print, deliberately: "
          f"{', '.join(OMITTED_COLUMNS)} (secrets).")
    print()

    if args.clear_inherited:
        return run_clear_inherited(rows, args, supabase_url, supabase_key)

    buckets: dict[str, list[tuple[dict[str, Any], str | None, str]]] = {}
    for row in rows:
        verdict, target, reason = classify(row)
        buckets.setdefault(verdict, []).append((row, target, reason))

    for verdict in ("correct", "already-stated", "already-right",
                    "unrecognised-country", "no-country"):
        members = buckets.get(verdict, [])
        print(f"   {verdict:<22} {len(members)}")
    print()

    to_correct = buckets.get("correct", [])

    # ---- 2. The whole tuple of each row that changes ---------------------
    print("2. THE ROWS THAT CHANGE, WHOLE")
    if not to_correct:
        print("   None. Nothing on this register carries the column default in a")
        print("   country whose currency this file can name.")
    for row, target, reason in to_correct:
        print(f"   {row['name']} ({row['id']})")
        print(f"     currency {row.get('currency')!r} -> {target!r}")
        print(f"     because: {reason}")
        print("     the whole row as it stands today:")
        print_tuple(row)
        print()

    # ---- 3. Everything not touched, and why ------------------------------
    print("3. WHAT IS NOT TOUCHED, NAMED ROW BY ROW")
    for verdict in ("already-right", "already-stated", "unrecognised-country",
                    "no-country"):
        for row, _target, reason in buckets.get(verdict, []):
            print(f"   [{verdict}] {row['name']} ({row['id']})")
            print(f"       {reason}")
    print()

    # ---- 4. The foreign keys --------------------------------------------
    if not print_foreign_keys(4):
        return 1

    # ---- 5. The statements ----------------------------------------------
    print("5. THE EXACT STATEMENTS")
    if not to_correct:
        print("   None.")
    for row, target, _reason in to_correct:
        print()
        for line in update_statement(row["id"], str(target)).splitlines():
            print(f"   {line}")
    print()
    print("   The `and currency = 'USD'` clause is not decoration: if somebody")
    print("   answers the onboarding question between this dry run and the apply,")
    print("   their answer stands and the statement updates 0 rows.")
    print()

    if not args.apply:
        print("=" * 78)
        print("DRY RUN. Nothing was written. To write, and only on the founder's")
        print("word:")
        print("  python3 scripts/correct_restaurant_currency.py --apply "
              "--i-have-the-founders-word")
        print("=" * 78)
        return 0

    # ---- 6. The write ----------------------------------------------------
    print("6. WRITING")
    failures = 0
    written = 0
    for row, target, _reason in to_correct:
        try:
            returned = postgrest(
                supabase_url,
                supabase_key,
                "restaurants",
                method="PATCH",
                params={
                    "id": f"eq.{row['id']}",
                    "currency": f"eq.{COLUMN_DEFAULT}",
                    "select": "id,name,currency",
                },
                body={"currency": target},
                prefer="return=representation",
            )
        except PostgrestError as exc:
            failures += 1
            print(f"   FAILED  {row['name']} ({row['id']}) — {exc}")
            continue
        touched = len(returned or [])
        if touched == 1:
            written += 1
            print(f"   WROTE   {row['name']} ({row['id']}) -> {target}")
        elif touched == 0:
            failures += 1
            print(
                f"   MISSED  {row['name']} ({row['id']}) — 0 rows matched. The "
                "row no longer carries the column default; somebody answered it "
                "in between. Read it before deciding anything."
            )
        else:
            failures += 1
            print(
                f"   STRANGE {row['name']} ({row['id']}) — {touched} rows "
                "matched a primary-key predicate. Stop and look."
            )
    print()
    print(f"   {written} written, {failures} not.")
    if failures:
        print("   PARTIAL RUN. Exit 2 — this is not a clean run and is not")
        print("   reported as one.")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
