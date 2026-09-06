#!/usr/bin/env python3
"""Remove the seeded demo house from production — classify and read out first.

THE HOUSE
---------
`Meyhouse Palo Alto`, id `550e8400-e29b-41d4-a716-446655440000`, created 2026-02-08 by
`scripts/seed_demo_user.py` / `seed_database.py`, members `demo@gmail.com` (owner),
`owner@meyhouse-pa.com` (owner), `manager@meyhouse-pa.com` (manager). Its rows are
fixture data that returns through the API wearing the same shape as measured data
(ADRs 0080 / 0088 established the procedure this file follows). The founder, 2026-09-06
(ADR 0131): "all demo data to be deleted, sims to be kept."

THE FINGERPRINT IS THE WHOLE TUPLE
----------------------------------
Not the name — a second `Meyhouse Palo Alto` (`18ef9102-…`, 0 members, created
2026-05-09) exists and is NOT this house. The script refuses unless id, name,
`created_at` date AND the exact member set all match what was measured.

WHAT A DELETE DOES HERE, MEASURED 2026-09-06 ON PRODUCTION (pg_constraint)
--------------------------------------------------------------------------
  * 74 tables reference `restaurants(id)` ON DELETE CASCADE — one DELETE on the
    house removes their rows (notifications 462, recommendation_impressions 227,
    pos_checks 66, restaurant_inventory 50, pos_unresolved_lines 39, events 23,
    calendar_events 12, restaurant_providers 8, restaurant_tables 8 …).
  * 4 SET NULL: `users.restaurant_id` (3), `contacts` (3), `decision_log` (2),
    `training_datasets` (0) — rows survive with the pointer cleared.
  * 7 NO ACTION: `system_audit_log` (5 rows — BLOCKS the delete until removed),
    `agent_activity_logs`, `event_dead_letters`, `event_replay_jobs`,
    `provider_performance_metrics`, `master_wine_library.provisional_for_restaurant_id`,
    `restaurants.parent_restaurant_id` — all 0 for this house except the audit log.
  * 11 tables carry a `restaurant_id` column with NO foreign key at all — a cascade
    would ORPHAN them, so this script deletes them explicitly, first:
    master_wine_library_submissions 190, inventory_alert_state 50,
    neural_footprint_event 11, analytics_insight_prefs 10, analytics_insights 10,
    restaurant_tables is keyed (above), analytics_goals 4, team_members 3,
    api_spend 2, recommendation_actions 1, inventory_events 1.
  The counts above are what was read that day; the dry run re-reads every one
  and prints the live number. A table that has grown is reported, not assumed.

WHAT IT WILL NOT DO
-------------------
  * It will not touch the shared library. The 190 submissions matched library rows
    (`matched_master_id`); those rows are the library's, not the demo's, and stay.
  * It will not delete `auth.users` — PostgREST does not expose that schema. The
    three member emails are printed for the founder to remove in the dashboard
    (or by a session running SQL on his word). The `public.users` rows are
    deleted only with `--delete-members`, and only if nothing else references them.
  * It will not run with `--apply` unless `--i-have-the-founders-word` AND
    `--e2e-account-is-not-this-house` are both passed: the nightly `e2e-prod`
    workflow signs in with the `E2E_TEST_EMAIL` secret, which no session can read;
    if that is `demo@gmail.com`, deleting the house turns the nightly gate red.
    The founder confirms the secret points elsewhere (a simulator member) first.
  * It will not delete the five `system_audit_log` rows unless `--include-audit-rows`
    is passed — an audit row is normally never deleted; the founder decides whether
    the demo house's trail is demo data.

USAGE
-----
    python3 scripts/delete_demo_house.py                       # dry run: classify + counts
    python3 scripts/delete_demo_house.py --self-test           # no DB
    python3 scripts/delete_demo_house.py --apply --i-have-the-founders-word \
        --e2e-account-is-not-this-house --include-audit-rows --delete-members

ENVIRONMENT
-----------
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
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

# See flip_mudavym_design_flags.py: this machine's python3.11 has no CA bundle
# wired into ssl; certifi's is used unless SSL_CERT_FILE is already set.
try:  # pragma: no cover - environment, not logic
    import certifi  # type: ignore

    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
except ImportError:
    pass

HOUSE_ID ="550e8400-e29b-41d4-a716-446655440000"
HOUSE_NAME = "Meyhouse Palo Alto"
HOUSE_CREATED_DATE = "2026-02-08"
HOUSE_MEMBERS = frozenset({"demo@gmail.com", "owner@meyhouse-pa.com", "manager@meyhouse-pa.com"})

# Measured 2026-09-06 (pg_constraint on production). The dry run re-counts each.
KEYLESS_TABLES: tuple[str, ...] = (
    "master_wine_library_submissions",
    "inventory_alert_state",
    "neural_footprint_event",
    "analytics_insight_prefs",
    "analytics_insights",
    "analytics_goals",
    "team_members",
    "api_spend",
    "recommendation_actions",
    "inventory_events",
    "shifts",
    "team_certifications",
    "coverage_templates",
    "restaurant_venue_profiles",
    "notification_deliveries",
    "provider_conversation_sessions",
    "vendor_deadlines",
    "restaurant_wine_roster",
    "menu_changes",
    "menu_price_versions",
    "pricing_analyses",
    "vendor_price_observations",
    "provider_knowledge",
    "pour_events",
    "provider_sentiment_history",
    "time_off_requests",
    "swap_requests",
    "server_sales",
    "team_settings",
    "profit_margins",
    "provider_promotions",
    "recommendation_digest_prefs",
    "photo_count_suggestions",
    "procurement_line_match_suggestions",
    "sender_reputation",
    "inventory_lots",
    "invoice_scans",
    "ux_signals",
    "ux_proposals",
    "ux_overrides",
    "ux_learnings",
    "mobile_devices",
    "schedules",
)
NO_ACTION_TABLES: tuple[str, ...] = (
    "system_audit_log",
    "agent_activity_logs",
    "event_dead_letters",
    "event_replay_jobs",
    "provider_performance_metrics",
)
SET_NULL_TABLES: tuple[str, ...] = ("users", "contacts", "decision_log", "training_datasets")
# The largest cascading tables, re-counted so the read-out says what goes.
CASCADE_SAMPLE: tuple[str, ...] = (
    "notifications",
    "recommendation_impressions",
    "pos_checks",
    "restaurant_inventory",
    "pos_unresolved_lines",
    "events",
    "calendar_events",
    "restaurant_providers",
    "restaurant_tables",
    "storage_locations",
    "user_restaurant_access",
    "restaurant_feature_flags",
    "notification_preferences",
    "user_onboarding_progress",
    "procurement_orders",
    "procurement_documents",
    "price_history",
)


class PostgrestError(RuntimeError):
    pass


def _request(base: str, key: str, path: str, *, method: str = "GET", params: dict[str, str] | None = None, prefer: str | None = None) -> tuple[Any, dict[str, str]]:
    url = f"{base.rstrip('/')}/rest/v1/{path}"
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json", "User-Agent": "Mudavym/delete-demo-house"}
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(url, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
            return (json.loads(raw) if raw.strip() else None), {k.lower(): v for k, v in resp.headers.items()}
    except urllib.error.HTTPError as exc:
        raise PostgrestError(f"{method} {path} -> HTTP {exc.code}: {exc.read().decode('utf-8', errors='replace')}") from exc
    except urllib.error.URLError as exc:
        raise PostgrestError(f"{method} {path} -> {exc.reason}") from exc


def count_rows(base: str, key: str, table: str, column: str, value: str) -> int | None:
    """Exact count via Content-Range; None when the table has no such column."""
    try:
        _, headers = _request(base, key, table, method="HEAD", params={"select": "*", column: f"eq.{value}", "limit": "1"}, prefer="count=exact")
    except PostgrestError as exc:
        if "42703" in str(exc) or "HTTP 400" in str(exc):
            return None
        raise
    cr = headers.get("content-range", "")
    total = cr.rsplit("/", 1)[-1] if "/" in cr else ""
    return int(total) if total.isdigit() else None


def load_dotenv_upward(start: Path, keys: tuple[str, ...]) -> None:
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
                k = k.strip(); v = v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
            return


def fingerprint_matches(house: dict[str, Any] | None, members: Iterable[str]) -> list[str]:
    """Every way the live house differs from the seeded one. Empty = it is the house."""
    problems: list[str] = []
    if house is None:
        return ["no restaurant row with that id"]
    if house.get("name") != HOUSE_NAME:
        problems.append(f"name is {house.get('name')!r}, expected {HOUSE_NAME!r}")
    if not str(house.get("created_at", "")).startswith(HOUSE_CREATED_DATE):
        problems.append(f"created_at is {house.get('created_at')!r}, expected {HOUSE_CREATED_DATE}")
    got = frozenset(members)
    if got != HOUSE_MEMBERS:
        problems.append(f"members are {sorted(got)}, expected {sorted(HOUSE_MEMBERS)}")
    return problems


def self_test() -> int:
    fails = []
    ok = {"name": HOUSE_NAME, "created_at": "2026-02-08 06:35:42.437368+00"}
    if fingerprint_matches(ok, HOUSE_MEMBERS):
        fails.append("the seeded tuple must match")
    if not fingerprint_matches({"name": HOUSE_NAME, "created_at": "2026-05-09"}, HOUSE_MEMBERS):
        fails.append("the second Meyhouse Palo Alto (2026-05-09) must be refused")
    if not fingerprint_matches(ok, HOUSE_MEMBERS | {"someone@else.com"}):
        fails.append("an extra member must be refused")
    if not fingerprint_matches(None, HOUSE_MEMBERS):
        fails.append("a missing row must be refused")
    if fails:
        for f in fails:
            print(f"SELF-TEST FAIL: {f}")
        return 1
    print("self-test: 4 checks pass, no database touched")
    return 0


def main(argv: Iterable[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--apply", action="store_true")
    p.add_argument("--i-have-the-founders-word", action="store_true")
    p.add_argument("--e2e-account-is-not-this-house", action="store_true", help="the founder confirmed E2E_TEST_EMAIL is not a member of this house")
    p.add_argument("--include-audit-rows", action="store_true", help="also delete the house's system_audit_log rows (the NO ACTION blocker)")
    p.add_argument("--delete-members", action="store_true", help="also delete the three public.users rows after the house")
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args(list(argv) if argv is not None else None)
    if args.self_test:
        return self_test()
    if args.apply and not (args.i_have_the_founders_word and args.e2e_account_is_not_this_house):
        print("REFUSED: --apply deletes a production house and needs BOTH --i-have-the-founders-word and --e2e-account-is-not-this-house beside it.")
        return 2
    if (args.i_have_the_founders_word or args.e2e_account_is_not_this_house) and not args.apply:
        print("REFUSED: those flags do nothing without --apply. Drop them and read the dry run.")
        return 2

    load_dotenv_upward(REPO_ROOT, ("SUPABASE_SERVICE_ROLE_KEY",))
    base, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base or not key:
        print("MISSING: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
        return 2

    rows, _ = _request(base, key, "restaurants", params={"select": "id,name,created_at", "id": f"eq.{HOUSE_ID}"})
    house = rows[0] if rows else None
    # Two reads, not an embed: PostgREST only embeds across a declared FK, and
    # `user_restaurant_access.user_id` is not declared against public.users in a
    # way the schema cache resolves (measured 2026-09-06: the embed came back empty
    # and the fingerprint refused a house that IS the seeded one).
    access, _ = _request(base, key, "user_restaurant_access", params={"select": "user_id,role", "restaurant_id": f"eq.{HOUSE_ID}"})
    member_ids = [a.get("user_id") for a in (access or []) if a.get("user_id")]
    members: list[str] = []
    if member_ids:
        urows, _ = _request(base, key, "users", params={"select": "user_id,email", "user_id": f"in.({','.join(member_ids)})"})
        by_id = {u["user_id"]: u.get("email") for u in (urows or [])}
        members = [by_id.get(uid) or f"<no public.users row for {uid}>" for uid in member_ids]
    problems = fingerprint_matches(house, [m for m in members if m])
    print(f"{'APPLY' if args.apply else 'DRY RUN'} — the seeded demo house {HOUSE_ID}")
    if problems:
        print("REFUSED: the live row is not the seeded tuple:")
        for pr in problems:
            print(f"  {pr}")
        return 3
    print(f"  fingerprint holds: {HOUSE_NAME}, created {HOUSE_CREATED_DATE}, members {sorted(HOUSE_MEMBERS)}")

    def block(title: str, tables: Iterable[str], column: str = "restaurant_id") -> dict[str, int]:
        out: dict[str, int] = {}
        print(f"\n  {title}")
        for t in tables:
            n = count_rows(base, key, t, column, HOUSE_ID)
            if n is None:
                print(f"    {t:40} (no such column or table — skipped)")
                continue
            out[t] = n
            if n:
                print(f"    {t:40} {n}")
        if not any(out.values()):
            print("    (0 rows)")
        return out

    keyless = block("Keyless tables (no FK; deleted explicitly, first):", KEYLESS_TABLES)
    noaction = block("NO ACTION tables (block the house delete while rows exist):", NO_ACTION_TABLES)
    setnull = block("SET NULL tables (rows survive, pointer cleared):", SET_NULL_TABLES)
    cascade = block("Cascading tables (removed by the house delete; the largest shown):", CASCADE_SAMPLE)

    blockers = {t: n for t, n in noaction.items() if n}
    print("\n  Members (public.users; auth.users must be removed by hand — PostgREST cannot):")
    for e, uid in zip(members, member_ids):
        print(f"    {e:32} {uid}")
    print("\n  Risks the founder must answer before --apply:")
    print("    1. E2E_TEST_EMAIL (GitHub secret, unreadable here) — if it is demo@gmail.com the nightly e2e-prod gate goes red; move it to a simulator member first.")
    print("    2. system_audit_log holds", noaction.get("system_audit_log", 0), "rows for this house — an audit row is normally never deleted; pass --include-audit-rows to treat the demo trail as demo data.")
    print("    3. The 190 library submissions matched shared library rows; those library rows STAY (they are not demo data).")

    if not args.apply:
        print("\nDry run. Nothing deleted.")
        return 0

    if blockers and not (args.include_audit_rows and set(blockers) <= {"system_audit_log"}):
        print(f"\nREFUSED: NO ACTION rows would block the delete: {blockers}. Pass --include-audit-rows if the only blocker is system_audit_log.")
        return 4

    def delete_where(table: str, column: str, value: str) -> None:
        _request(base, key, table, method="DELETE", params={column: f"eq.{value}"}, prefer="return=minimal")

    for t, n in keyless.items():
        if n:
            delete_where(t, "restaurant_id", HOUSE_ID); print(f"  deleted {n} from {t}")
    if args.include_audit_rows and noaction.get("system_audit_log"):
        delete_where("system_audit_log", "restaurant_id", HOUSE_ID); print(f"  deleted {noaction['system_audit_log']} from system_audit_log")
    delete_where("restaurants", "id", HOUSE_ID); print(f"  deleted the house row (cascade over {len(cascade)} sampled tables and the rest)")
    if args.delete_members:
        for e, uid in zip(members, member_ids):
            try:
                delete_where("users", "user_id", uid); print(f"  deleted public.users {e}")
            except PostgrestError as exc:
                print(f"  public.users {e} NOT deleted (referenced elsewhere): {exc}")
    left = count_rows(base, key, "restaurants", "id", HOUSE_ID)
    print(f"\nRe-read: restaurants rows with that id = {left}. auth.users for {sorted(HOUSE_MEMBERS)} still need the dashboard.")
    return 0 if left == 0 else 5


if __name__ == "__main__":
    sys.exit(main())
