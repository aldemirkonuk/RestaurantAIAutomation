#!/usr/bin/env python3
"""Turn the Mudavym design pages on (or off) for named houses — the go-live flip.

WHAT A FLIP IS
--------------
Every rebuilt page sits behind `mudavym_design_<page>`, a boolean column on the
reserved `flag_name = 'restaurant_settings'` row of `restaurant_feature_flags`,
one row per house, UNIQUE (restaurant_id, flag_name). No row means every column
reads false (settings.service.ts `normalize()` falls back to the registry default,
which is false for every design flag). Production held ZERO such rows on
2026-09-06, so every house rendered legacy. ADR 0131 turns houses on one at a time.

WHY A SCRIPT AND NOT THE SETTINGS PAGE
--------------------------------------
The settings page can flip its own house — but the go-live flips houses the
founder is not signed into (the simulator houses have no founder account), and a
flip that is not on paper did not happen. This script does what the page's
`PATCH /settings/feature-flags` does, in the same order, with the same paper:

  1. read the row as it stands (for the audit diff — absent row = all false),
  2. upsert the row on (restaurant_id, flag_name) with only the requested columns,
  3. file ONE `feature_flag_changed` row in `system_audit_log` carrying only the
     columns that actually moved, actor = the person the founder names
     (`public.users.user_id`, never auth.users — the two tables are disjoint),
     exactly the shape settings-audit.service.ts:233-247 writes.

A flip with no audit row would be a change with no author, so the script refuses
to write the flags row when it cannot write the audit row (it writes the audit
row FIRST with the planned diff; if that fails nothing else is attempted).

WHAT IT REFUSES
---------------
  * `--apply` without `--i-have-the-founders-word` (dry run is the default).
  * A page whose column does not exist yet on production (the p4 columns land
    with the merge; before that, the request would 42703 — the script asks
    PostgREST for the columns first and names the missing ones).
  * A house id that does not resolve to exactly one restaurant row.
  * `--actor` that does not resolve to exactly one `public.users` row.

USAGE
-----
    python3 scripts/flip_mudavym_design_flags.py --house ALDEMIR --pages all          # dry run
    python3 scripts/flip_mudavym_design_flags.py --house 05b8c4a5-... --house a229f22b-... \
        --pages all --actor aldemirkonuk2004@gmail.com --apply --i-have-the-founders-word
    python3 scripts/flip_mudavym_design_flags.py --house ALDEMIR --pages inventory --off ...
    python3 scripts/flip_mudavym_design_flags.py --self-test                          # no DB

ENVIRONMENT
-----------
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (read from the nearest .env that has them)
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
from typing import Any, Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent

# The python.org 3.11 on this machine ships no CA bundle wired into ssl, so every
# https call fails with CERTIFICATE_VERIFY_FAILED (measured 2026-09-05 by
# correct_restaurant_currency.py, again 2026-09-06 here). certifi carries one;
# point ssl at it unless the operator already did.
try:  # pragma: no cover - environment, not logic
    import certifi  # type: ignore

    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
except ImportError:
    pass

FLAGS_TABLE = "restaurant_feature_flags"
SETTINGS_ROW_FLAG_NAME = "restaurant_settings"
AUDIT_TABLE = "system_audit_log"

# The nineteen pages of ADR 0044 + 0114, in MUDAVYM_PAGES order
# (apps/web/src/lib/mudavym/useMudavymDesign.ts). A slug not in this list is a
# typo, not a page; the script refuses it rather than inventing a column.
PAGES: tuple[str, ...] = (
    "dashboard",
    "orders",
    "receiving",
    "receiving_door",
    "providers",
    "communications",
    "team",
    "inventory",
    "receipts",
    "documents_reports",
    "reports",
    "notifications",
    "recommendations",
    "calendar",
    "settings",
    "profile",
    "cellar",
    "connections",
    "document",
)


def column_for(page: str) -> str:
    return f"mudavym_design_{page}"


# ---------------------------------------------------------------------------
# PostgREST with the standard library (see correct_restaurant_currency.py for
# why `import supabase` is a trap from this repo root).
# ---------------------------------------------------------------------------


class PostgrestError(RuntimeError):
    """A read or write that did not happen, with the server's own words."""


def postgrest(
    base_url: str,
    key: str,
    path: str,
    *,
    method: str = "GET",
    params: dict[str, str] | None = None,
    body: Any = None,
    prefer: str | None = None,
) -> Any:
    url = f"{base_url.rstrip('/')}/rest/v1/{path}"
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "User-Agent": "Mudavym/flip-mudavym-design-flags",
    }
    if prefer:
        headers["Prefer"] = prefer
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw.strip() else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise PostgrestError(f"{method} {path} -> HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise PostgrestError(f"{method} {path} -> {exc.reason}") from exc


def load_dotenv_upward(start: Path, keys: tuple[str, ...]) -> None:
    """Populate os.environ from the nearest .env that mentions any of `keys`."""
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
                k, _, v = line.partition("=")
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
            return


# ---------------------------------------------------------------------------
# The decision, as pure functions the self-test can exercise
# ---------------------------------------------------------------------------


def parse_pages(spec: str) -> list[str]:
    """`all` or a comma list of slugs; refuses anything not in PAGES."""
    if spec.strip().lower() == "all":
        return list(PAGES)
    out: list[str] = []
    unknown: list[str] = []
    for raw in spec.split(","):
        s = raw.strip().lower().replace("-", "_")
        if not s:
            continue
        if s in PAGES:
            if s not in out:
                out.append(s)
        else:
            unknown.append(raw.strip())
    if unknown:
        raise ValueError(f"not a Mudavym page: {', '.join(unknown)}. Known: {', '.join(PAGES)}")
    if not out:
        raise ValueError("no pages named")
    return out


def plan_change(
    current: dict[str, Any] | None, pages: Iterable[str], enabled: bool
) -> tuple[dict[str, bool], dict[str, dict[str, Any]]]:
    """Return (patch, fields) — the columns to write and the audit diff.

    `current` is the existing row or None. A column already at the requested
    value is still written (idempotent upsert) but does NOT appear in `fields`,
    because an unchanged field is not a change (settings.service.ts:141-147).
    """
    patch: dict[str, bool] = {}
    fields: dict[str, dict[str, Any]] = {}
    for page in pages:
        col = column_for(page)
        before = None
        if current is not None:
            v = current.get(col)
            before = v if isinstance(v, bool) else False
        else:
            before = False
        patch[col] = enabled
        if before != enabled:
            fields[col] = {"from": before, "to": enabled}
    return patch, fields


def self_test() -> int:
    failures: list[str] = []

    def check(cond: bool, msg: str) -> None:
        if not cond:
            failures.append(msg)

    check(parse_pages("all") == list(PAGES), "all -> every page in order")
    check(parse_pages("inventory, Receiving-Door") == ["inventory", "receiving_door"], "slug normalisation")
    try:
        parse_pages("inventory,menu")
        check(False, "unknown slug must be refused")
    except ValueError:
        pass
    patch, fields = plan_change(None, ["dashboard", "orders"], True)
    check(patch == {"mudavym_design_dashboard": True, "mudavym_design_orders": True}, "patch on no row")
    check(set(fields) == {"mudavym_design_dashboard", "mudavym_design_orders"}, "no row = every column moved")
    patch, fields = plan_change({"mudavym_design_dashboard": True, "mudavym_design_orders": None}, ["dashboard", "orders"], True)
    check(patch["mudavym_design_dashboard"] is True, "idempotent write kept in patch")
    check("mudavym_design_dashboard" not in fields, "unchanged column not in the audit diff")
    check(fields.get("mudavym_design_orders") == {"from": False, "to": True}, "NULL reads as false before")
    patch, fields = plan_change({"mudavym_design_dashboard": True}, ["dashboard"], False)
    check(fields == {"mudavym_design_dashboard": {"from": True, "to": False}}, "--off diff")
    if failures:
        for f in failures:
            print(f"SELF-TEST FAIL: {f}")
        return 1
    print("self-test: 9 checks pass, no database touched")
    return 0


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


def resolve_house(base: str, key: str, ident: str) -> dict[str, Any]:
    if len(ident) == 36 and ident.count("-") == 4:
        rows = postgrest(base, key, "restaurants", params={"select": "id,name,created_at", "id": f"eq.{ident}"})
    else:
        rows = postgrest(base, key, "restaurants", params={"select": "id,name,created_at", "name": f"eq.{ident}"})
    if not isinstance(rows, list) or len(rows) != 1:
        n = len(rows) if isinstance(rows, list) else "?"
        raise SystemExit(f"REFUSED: house '{ident}' resolves to {n} restaurant rows, not one. Use the id.")
    return rows[0]


def resolve_actor(base: str, key: str, email: str) -> dict[str, Any]:
    rows = postgrest(base, key, "users", params={"select": "user_id,email", "email": f"eq.{email}"})
    if not isinstance(rows, list) or len(rows) != 1:
        raise SystemExit(f"REFUSED: actor '{email}' resolves to {len(rows) if isinstance(rows, list) else '?'} public.users rows, not one.")
    return rows[0]


def existing_columns(base: str, key: str) -> set[str]:
    """Which mudavym_design_* columns production actually has (OpenAPI root)."""
    spec = postgrest(base, key, "", params={})
    props = (((spec or {}).get("definitions") or {}).get(FLAGS_TABLE) or {}).get("properties") or {}
    return {c for c in props if c.startswith("mudavym_design_")}


def read_row(base: str, key: str, restaurant_id: str, columns: list[str]) -> dict[str, Any] | None:
    rows = postgrest(
        base,
        key,
        FLAGS_TABLE,
        params={
            "select": ",".join(["id", "restaurant_id", "flag_name", *columns]),
            "restaurant_id": f"eq.{restaurant_id}",
            "flag_name": f"eq.{SETTINGS_ROW_FLAG_NAME}",
        },
    )
    if not rows:
        return None
    if len(rows) > 1:
        raise SystemExit(f"REFUSED: {len(rows)} settings rows for {restaurant_id}; the UNIQUE constraint should make this impossible.")
    return rows[0]


# ---------------------------------------------------------------------------
# Writes — audit first, then the row
# ---------------------------------------------------------------------------


def write_audit(base: str, key: str, restaurant_id: str, actor_id: str, fields: dict[str, Any], reason: str) -> None:
    postgrest(
        base,
        key,
        AUDIT_TABLE,
        method="POST",
        body={
            "actor_type": "user",
            "actor_id": actor_id,
            "action": "feature_flag_changed",
            "entity_type": "restaurant_feature_flag",
            "entity_id": restaurant_id,
            "changes": {"register": "features", "subject": ", ".join(fields), "fields": fields},
            "restaurant_id": restaurant_id,
            "reason": reason,
        },
        prefer="return=minimal",
    )


def write_row(base: str, key: str, restaurant_id: str, patch: dict[str, bool]) -> dict[str, Any]:
    rows = postgrest(
        base,
        key,
        FLAGS_TABLE,
        method="POST",
        params={"on_conflict": "restaurant_id,flag_name"},
        body={"restaurant_id": restaurant_id, "flag_name": SETTINGS_ROW_FLAG_NAME, **patch},
        prefer="resolution=merge-duplicates,return=representation",
    )
    if not isinstance(rows, list) or len(rows) != 1:
        raise PostgrestError(f"upsert returned {rows!r}")
    return rows[0]


# ---------------------------------------------------------------------------


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--house", action="append", default=[], help="restaurant id or exact name; repeatable")
    parser.add_argument("--pages", default="all", help="'all' or comma list of page slugs")
    parser.add_argument("--off", action="store_true", help="turn the pages OFF instead of on")
    parser.add_argument("--actor", default="aldemirkonuk2004@gmail.com", help="public.users email written as the audit actor")
    parser.add_argument("--reason", default="ADR 0131 go-live flip, on the founder's word in session", help="reason column on the audit row")
    parser.add_argument("--apply", action="store_true", help="write. Refused without --i-have-the-founders-word")
    parser.add_argument("--i-have-the-founders-word", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.self_test:
        return self_test()
    if args.apply and not args.i_have_the_founders_word:
        print("REFUSED: --apply writes live tenant rows and needs --i-have-the-founders-word beside it.")
        return 2
    if args.i_have_the_founders_word and not args.apply:
        print("REFUSED: --i-have-the-founders-word on its own does nothing. Pass --apply with it, or drop it and read the dry run.")
        return 2
    if not args.house:
        print("REFUSED: name at least one --house.")
        return 2
    try:
        pages = parse_pages(args.pages)
    except ValueError as exc:
        print(f"REFUSED: {exc}")
        return 2
    enabled = not args.off

    load_dotenv_upward(REPO_ROOT, ("SUPABASE_SERVICE_ROLE_KEY",))
    base = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    missing = [n for n, v in (("SUPABASE_URL", base), ("SUPABASE_SERVICE_ROLE_KEY", key)) if not v]
    if missing:
        print(f"MISSING: {', '.join(missing)} — set them or put them in .env / apps/api-gateway/.env")
        return 2
    assert base and key

    columns = [column_for(p) for p in pages]
    have = existing_columns(base, key)
    absent = [c for c in columns if c not in have]
    if absent:
        print("REFUSED: production does not have these columns yet (the migration has not applied):")
        for c in absent:
            print(f"  {c}")
        print("Merge the branch that adds them first, then re-run.")
        return 3

    actor = resolve_actor(base, key, args.actor)
    houses = [resolve_house(base, key, h) for h in args.house]
    mode = "APPLY" if args.apply else "DRY RUN"
    print(f"{mode} — {len(houses)} house(s), {len(pages)} page(s) -> {'ON' if enabled else 'OFF'}; actor {actor['email']} ({actor['user_id']})")

    plans = []
    for h in houses:
        current = read_row(base, key, h["id"], columns)
        patch, fields = plan_change(current, pages, enabled)
        plans.append((h, current, patch, fields))
        state = "no row (all false)" if current is None else "row exists"
        moved = ", ".join(f"{k[len('mudavym_design_'):]}: {v['from']}->{v['to']}" for k, v in fields.items()) or "nothing moves"
        print(f"\n  {h['name']}  {h['id']}  [{state}]")
        print(f"    would write {len(patch)} column(s); audit diff: {moved}")

    if not args.apply:
        print("\nDry run. Nothing written. Re-run with --apply --i-have-the-founders-word to write.")
        return 0

    written = 0
    for h, _current, patch, fields in plans:
        if not fields:
            print(f"\n  {h['name']}: nothing moves — no audit row, no write.")
            continue
        try:
            write_audit(base, key, h["id"], actor["user_id"], fields, args.reason)
        except PostgrestError as exc:
            print(f"\n  {h['name']}: the audit row did NOT write; the flags row was NOT touched. {exc}")
            return 4
        try:
            row = write_row(base, key, h["id"], patch)
        except PostgrestError as exc:
            print(f"\n  {h['name']}: the audit row is filed but the flags row did NOT write — the paper is ahead of the fact. Re-run to converge. {exc}")
            return 5
        after = {k: row.get(k) for k in patch}
        if any(after[k] is not v for k, v in patch.items()):
            print(f"\n  {h['name']}: read-back disagrees with the write: {after}")
            return 6
        written += 1
        print(f"\n  {h['name']}: written and read back — {', '.join(k[len('mudavym_design_'):] for k in patch)} = {'true' if enabled else 'false'}")

    print(f"\nDone: {written} house(s) written, {len(plans) - written} unchanged.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
