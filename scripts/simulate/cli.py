"""CLI: python3 -m scripts.simulate {run|wines|mappings|oracle|scenario}

Dry run is the DEFAULT, matching scripts/synth. `--apply` is required to open a
socket; without it the command builds and signs every payload and reports what it
would have sent, which makes the whole encoding path testable offline.

    python3 -m scripts.simulate run --archetype bistro --days 14
    python3 -m scripts.simulate run --archetype bistro --days 60 --restaurant <uuid> --apply
    python3 -m scripts.simulate wines --archetype bistro     # wine-detection hit rate
    python3 -m scripts.simulate oracle --archetype bistro --days 7

    # ADR 0093 — one day of named situations, with the expectation it must produce
    python3 -m scripts.simulate scenario --list
    python3 -m scripts.simulate scenario --archetype bistro --scenario random --seed 7
    python3 -m scripts.simulate scenario --archetype bistro --scenario opening_minute \
        --date 2026-09-02 --out /tmp/expected.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Sequence

from scripts.simulate.bridge import (
    Bridge,
    BridgeConfig,
    RemoteTargetRefusedError,
    UnsignedApplyRefusedError,
)
from scripts.simulate.detection import detection_report
from scripts.simulate.mappings import build_mappings
from scripts.simulate.payloads import idempotency_key
from scripts.simulate.service import (
    WineList,
    covers_for,
    generate_service,
    wine_units_poured,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
MENUS_DIR = REPO_ROOT / "datasets" / "sim" / "menus"
ARCHETYPES_DIR = REPO_ROOT / "datasets" / "sim" / "archetypes"


def _load_wines(archetype: str) -> list[dict[str, Any]]:
    path = MENUS_DIR / f"{archetype}.json"
    if not path.exists():
        raise SystemExit(
            f"No menu snapshot for '{archetype}' at {path}. Available: "
            f"{sorted(p.stem for p in MENUS_DIR.glob('*.json'))}"
        )
    return json.loads(path.read_text())["items"]


def _base_covers(archetype: str, override: int | None) -> int:
    if override:
        return override
    # Read the archetype's own sales_volume rather than hardcoding, so the
    # simulator and the seeded tenant describe the same restaurant.
    recipe = ARCHETYPES_DIR / f"{archetype}.json"
    volume = "medium"
    if recipe.exists():
        volume = (
            json.loads(recipe.read_text()).get("defaults", {}).get("sales_volume")
            or "medium"
        )
    return {"low": 45, "medium": 80, "high": 140}.get(volume, 80)


def cmd_run(args: argparse.Namespace) -> int:
    wines_raw = _load_wines(args.archetype)
    wine_list = WineList.from_snapshot(wines_raw)
    base_covers = _base_covers(args.archetype, args.covers_per_night)

    config = BridgeConfig(
        restaurant_id=args.restaurant or "00000000-0000-0000-0000-000000000000",
        restaurant_guid=args.restaurant_guid or f"sim-guid-{args.archetype}",
        analytics_base=args.analytics_base,
        stock_base=args.stock_base,
        toast_secret=args.toast_secret or os.environ.get("TOAST_WEBHOOK_SECRET", ""),
        pos_hub_secret=args.pos_hub_secret or os.environ.get("POS_HUB_WEBHOOK_SECRET", ""),
        ingress=args.ingress,
        apply=args.apply,
        allow_remote=args.allow_remote,
    )
    if config.apply and not args.restaurant:
        raise SystemExit(
            "--apply requires --restaurant <uuid>. Posting simulated service into an "
            "unspecified tenant is exactly the leakage this refuses to risk."
        )

    if config.apply:
        # Refuse to write anything we cannot take back. Posting through the hub
        # upserts `pos_checks`, and rows that teardown does not cover survive
        # forever and blend simulated service into a tenant's real analytics.
        # scripts/synth owns the gate; borrowing it here keeps one source of truth
        # rather than a second, drifting opinion about what is removable.
        from scripts.synth.teardown import assert_teardown_coverage
        from scripts.synth.write_set import SYNTH_WRITE_SET

        assert_teardown_coverage()
        if "pos_checks" not in SYNTH_WRITE_SET:
            raise SystemExit(
                "Refusing --apply: 'pos_checks' is not in scripts/synth SYNTH_WRITE_SET, "
                "so simulated service could not be torn down. Add it to the write-set, "
                "DELETE_ORDER and TEARDOWN_HANDLERS first."
            )

    try:
        bridge = Bridge(config)
    except (RemoteTargetRefusedError, UnsignedApplyRefusedError) as exc:
        raise SystemExit(str(exc))

    if args.seed_mappings:
        # Before any check. resolveWine runs at ingest time, so a mapping that
        # lands after a check does not reclassify it retroactively.
        rows = build_mappings(wine_list)
        result = bridge.seed_mappings(rows)
        print(
            f"pos_item_mappings: {len(rows)} rows "
            f"({sum(1 for r in rows if r['is_wine'])} wine, "
            f"{sum(1 for r in rows if not r['is_wine'])} food) -> "
            f"{'posted ' + str(result.posted) if config.apply else 'dry run'}"
            + (f", {result.failed} failed" if result.failed else "")
        )
        for err in result.errors[:3]:
            print(f"  {err}")

    start = date.today() - timedelta(days=args.days)
    sold_out: set[str] = set()
    total_checks = 0
    total_wine_units: dict[str, float] = {}
    keys: set[str] = set()

    for offset in range(args.days):
        day = start + timedelta(days=offset)
        checks = list(
            generate_service(
                day,
                wines=wine_list,
                base_covers=base_covers,
                seed=args.seed,
                sold_out=sold_out,
            )
        )
        for check in checks:
            keys.add(idempotency_key(check))
            bridge.send(check)
        total_checks += len(checks)

        poured = wine_units_poured(checks)
        for sig, units in poured.items():
            total_wine_units[sig] = round(total_wine_units.get(sig, 0.0) + units, 3)

        if args.verbose:
            print(
                f"  {day.isoformat()}  covers={covers_for(day, base_covers=base_covers, seed=args.seed):3d}"
                f"  checks={len(checks):3d}  wines touched={len(poured):3d}"
            )

    summary = bridge.summary()
    print(json.dumps(summary, indent=2))

    # A collapsed key set means every check after the first would be discarded as
    # a duplicate — the failure this simulator is most likely to hide.
    print(
        f"\n{total_checks} checks over {args.days} days · "
        f"{len(keys)} distinct idempotency keys · "
        f"{len(total_wine_units)} distinct wines poured"
    )
    if len(keys) != total_checks:
        print(
            f"  WARNING: {total_checks - len(keys)} checks share an idempotency key. "
            "Ingress B would silently discard them."
        )
        return 1

    if not config.apply:
        print("\nDry run — nothing was sent. Re-run with --apply to post.")
    return 0


def cmd_wines(args: argparse.Namespace) -> int:
    """Report whether generated item names actually resolve as wine.

    The hub's fallback is a keyword heuristic. If our generated names miss it, the
    stock path sees no wine and the whole run proves nothing — so the hit rate is
    a precondition, not a curiosity.
    """
    wine_list = WineList.from_snapshot(_load_wines(args.archetype))
    report = detection_report(
        wine_list,
        base_covers=_base_covers(args.archetype, args.covers_per_night),
        seed=args.seed,
        days=args.days,
    )
    print(
        f"archetype {args.archetype}: {report['wine_items']} wine line items over "
        f"{args.days} days"
    )
    print(
        f"  keyword-heuristic hit rate: {report['hit_rate']:.1%} "
        f"({report['hits']}/{report['wine_items']})"
    )
    print(f"  false positives on food:    {report['food_false_positives']}")
    if report["misses"]:
        print("  sample misses (would need a pos_item_mappings row):")
        for name in report["misses"][:12]:
            print(f"    - {name}")
    return 0


def cmd_mappings(args: argparse.Namespace) -> int:
    """Show the mapping rows that would be seeded, and what they buy."""
    wine_list = WineList.from_snapshot(_load_wines(args.archetype))
    rows = build_mappings(wine_list)
    wine_rows = [r for r in rows if r["is_wine"]]
    print(f"archetype {args.archetype}: {len(rows)} mapping rows")
    print(f"  wine: {len(wine_rows)}  (bottle + by-the-glass presentations)")
    print(f"  food: {len(rows) - len(wine_rows)}  (explicit is_wine=false locks)")
    print("\nsample:")
    for row in rows[:6]:
        print(f"  {'WINE' if row['is_wine'] else 'food'}  {row['item_name'][:52]:52s} {row['category']}")
    print(
        "\nWithout these the keyword fallback resolves ~35% of wine names "
        "(python3 -m scripts.simulate wines)."
    )
    return 0


def cmd_oracle(args: argparse.Namespace) -> int:
    """Print the depletion the run SHOULD produce, for asserting against."""
    wine_list = WineList.from_snapshot(_load_wines(args.archetype))
    base_covers = _base_covers(args.archetype, args.covers_per_night)
    start = date.today() - timedelta(days=args.days)
    totals: dict[str, float] = {}
    for offset in range(args.days):
        day = start + timedelta(days=offset)
        checks = list(
            generate_service(
                day, wines=wine_list, base_covers=base_covers, seed=args.seed
            )
        )
        for sig, units in wine_units_poured(checks).items():
            totals[sig] = round(totals.get(sig, 0.0) + units, 3)
    by_wine = {
        (w.get("signature_hash") or ""): f"{w.get('producer') or ''} {w.get('wine_name')}".strip()
        for w in wine_list.bottles + wine_list.btg
    }
    print(json.dumps(
        {
            "archetype": args.archetype,
            "days": args.days,
            "seed": args.seed,
            "note": "bottle-equivalents; a glass counts as 0.2 bottles",
            "depletion": sorted(
                (
                    {"signature_hash": sig, "wine": by_wine.get(sig, "?"), "bottles": units}
                    for sig, units in totals.items()
                ),
                key=lambda r: -r["bottles"],
            )[: args.top],
        },
        indent=2,
    ))
    return 0


# ===========================================================================
# scenario — ADR 0093
#
# `run` posts N days of generic traffic and reports what it sent. `scenario`
# posts ONE day of NAMED situations and records what the product must produce,
# so that a verifier can later say pass / fail / unverifiable per check rather
# than "no errors were printed". The two share the bridge, the menu snapshot and
# the mappings; they do not share a notion of time — every instant here comes
# from the venue's own operating hours.
# ===========================================================================

FIXTURE_HOURS = REPO_ROOT / "datasets" / "sim" / "fixtures" / "operating-hours-cases.json"


def _resolve_hours_for_dry_run(archetype: str) -> tuple[dict, str | None, str]:
    """(operating_hours, timezone, source) for a dry run, or refuse.

    Precedence, most authoritative first:

      1. the archetype's own `restaurant.operating_hours`
      2. `datasets/sim/fixtures/operating-hours-cases.json` `hours.<archetype>` —
         the fixture both hour implementations already run in lockstep

    There is no third rung. A venue whose hours are in neither is a venue whose
    hours are UNKNOWN, and the command says so instead of picking a plausible
    day: "12:00-23:00 because most bistros do" would put every timestamp in the
    run — and therefore every out-of-hours verdict — on a number nobody chose
    (ADR 0020).
    """
    from scripts.synth.recipes import load_recipe

    profile = load_recipe(archetype)
    restaurant = profile.restaurant or {}
    tz = restaurant.get("timezone")
    hours = restaurant.get("operating_hours")
    if isinstance(hours, dict) and hours:
        return hours, tz, "archetype"

    if FIXTURE_HOURS.exists():
        fixture = json.loads(FIXTURE_HOURS.read_text()).get("hours") or {}
        if archetype in fixture:
            return (
                fixture[archetype],
                tz,
                f"fixture:datasets/sim/fixtures/operating-hours-cases.json#hours.{archetype}",
            )

    raise SystemExit(
        f"venue hours unknown for archetype '{archetype}' — no "
        f"`restaurant.operating_hours` in datasets/sim/archetypes/{archetype}.json "
        f"and no `hours.{archetype}` in "
        "datasets/sim/fixtures/operating-hours-cases.json. Set the hours first; "
        "this command will not guess them (ADR 0020)."
    )


def _hhmm(instant, tz_name: str) -> str:
    from zoneinfo import ZoneInfo

    return instant.astimezone(ZoneInfo(tz_name)).strftime("%H:%M")


def cmd_scenario(args: argparse.Namespace) -> int:
    """Replay a named day into the product and record what it must produce.

    Dry run is the default and opens no socket: it resolves the hours, builds the
    day, derives the expectation and prints it. `--apply` is the only path that
    posts, and it refuses on anything it cannot establish honestly — no
    credentials, no hours, no restaurant, no opening stock.
    """
    from datetime import datetime as _datetime
    from zoneinfo import ZoneInfo

    from scripts.simulate import scenarios as scn
    from scripts.simulate.hours import WEEKDAYS, OperatingHoursError
    from scripts.simulate.scenario_apply import (
        ScenarioApplyError,
        fetch_inventory,
        fetch_operating_hours,
        login,
    )
    from scripts.synth.ids import sim_restaurant_id
    from scripts.synth.seed import sim_inventory_id

    if args.list:
        print("scenarios (python3 -m scripts.simulate scenario --scenario <id>)\n")
        for definition in scn.LIBRARY:
            flag = "   [decides the run's date]" if definition.changes_date else ""
            print(f"  {definition.id:24s} {definition.title}{flag}")
            print(f"  {'':24s} {definition.story}")
        print(f"\n  {scn.RANDOM_ID:24s} A seeded composition (the default)")
        print(f"  {'':24s} service + 2-5 of: {', '.join(scn.RANDOM_POOL)}")
        return 0

    if args.scenario not in scn.SCENARIO_IDS:
        raise SystemExit(
            f"Unknown scenario {args.scenario!r}. Known: {', '.join(scn.SCENARIO_IDS)}"
        )

    wine_list = WineList.from_snapshot(_load_wines(args.archetype))
    mapping_rows = build_mappings(wine_list)
    base_covers = _base_covers(args.archetype, args.covers_per_night)
    restaurant_id = args.restaurant or sim_restaurant_id(args.archetype)

    if args.apply and not args.restaurant:
        raise SystemExit(
            "--apply requires --restaurant <uuid>. A dry run may derive it from the "
            "archetype; posting a day of service into a tenant nobody named must not "
            "be derivable."
        )

    bearer = ""
    hours = None
    timezone_name = None

    if args.apply:
        email = os.environ.get("SIM_OWNER_EMAIL", "")
        password = os.environ.get("SIM_OWNER_PASSWORD", "")
        if not email or not password:
            raise SystemExit(
                "--apply refused: SIM_OWNER_EMAIL and SIM_OWNER_PASSWORD must both be "
                "set. Every write in this run goes through the product's own API, and "
                "those routes are behind JwtAuthGuard — without a session the tables "
                "and the mappings would 401, and the run would then measure the "
                "keyword heuristic instead of the pipeline."
            )
        try:
            bearer = login(args.analytics_base, email, password)
            hours, timezone_name = fetch_operating_hours(
                args.analytics_base, restaurant_id, bearer
            )
        except ScenarioApplyError as exc:
            raise SystemExit(str(exc))
        if not hours:
            raise SystemExit(
                "venue hours unknown — set them first. "
                f"GET /restaurants/{restaurant_id}/operating-hours returned a null "
                "operatingHours, and every instant in this run is derived from it. "
                "Assuming a day would make the out-of-hours verdict a statement about "
                "the assumption rather than about the venue (ADR 0020)."
            )
        hours_source = "product_api"
        if not timezone_name:
            from scripts.synth.recipes import load_recipe

            timezone_name = (load_recipe(args.archetype).restaurant or {}).get("timezone")
            hours_source = "product_api (timezone from the archetype: the API returned null)"
    else:
        hours, timezone_name, hours_source = _resolve_hours_for_dry_run(args.archetype)

    if not timezone_name:
        raise SystemExit(
            f"timezone unknown for '{args.archetype}' — operating hours are local "
            "times and cannot be placed on the clock without one."
        )

    if args.date:
        requested = _datetime.strptime(args.date, "%Y-%m-%d").date()
    else:
        requested = _datetime.now(ZoneInfo(timezone_name)).date()
    try:
        service_date, date_reason = scn.resolve_service_date(args.scenario, hours, requested)
    except OperatingHoursError as exc:
        raise SystemExit(f"operating_hours is not a valid shape: {exc}")

    # -- inventory snapshot (read-only) ------------------------------------
    if args.apply:
        supabase_url = os.environ.get("SUPABASE_URL", "")
        service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        if not supabase_url or not service_key:
            raise SystemExit(
                "--apply refused: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are "
                "needed to read the tenant's opening stock and to record the run. "
                "Without the opening stock, every depletion figure in the expectation "
                "would be arithmetic over a guess."
            )
        signature_by_id = {
            sim_inventory_id(args.archetype, wine["signature_hash"]): wine["signature_hash"]
            for wine in (wine_list.bottles + wine_list.btg)
            if wine.get("signature_hash")
        }
        try:
            rows = fetch_inventory(supabase_url, service_key, restaurant_id)
        except ScenarioApplyError as exc:
            raise SystemExit(str(exc))
        inventory = scn.inventory_from_rest_rows(rows, signature_by_inventory_id=signature_by_id)
        inventory_source = "restaurant_inventory"
        if not inventory:
            raise SystemExit(
                f"restaurant_inventory returned {len(rows)} row(s) for {restaurant_id}, "
                "none of which is a wine from this archetype's menu snapshot. Seed the "
                "tenant first — an expectation over zero inventory rows would pass by "
                "having nothing to check."
            )
    else:
        inventory = scn.build_inventory_from_archetype(
            args.archetype, _load_wines(args.archetype)
        )
        inventory_source = "archetype"

    try:
        ctx = scn.ScenarioContext(
            archetype_id=args.archetype,
            wine_list=wine_list,
            operating_hours=hours,
            timezone=timezone_name,
            service_date=service_date,
            seed=args.seed,
            inventory=inventory,
            mappings=mapping_rows,
            base_covers=base_covers,
            hours_source=hours_source,
            inventory_source=inventory_source,
        )
        expectation, outcomes = scn.build_expectation(ctx, args.scenario)
    except (OperatingHoursError, scn.ScenarioBuildError) as exc:
        raise SystemExit(str(exc))

    expected = expectation.to_json()
    params = scn.run_params(ctx, args.scenario)
    params["service_date_reason"] = date_reason
    params["restaurant_id_source"] = "argument" if args.restaurant else "derived"

    _print_scenario_summary(ctx, expected, params, outcomes, WEEKDAYS, verbose=args.verbose)

    if args.out:
        Path(args.out).write_text(json.dumps(expected, indent=2, sort_keys=True))
        print(f"\nexpectation -> {args.out}")

    if not args.apply:
        print("\nDry run — nothing sent, nothing written, no socket opened.")
        print("Re-run with --apply (and SIM_OWNER_EMAIL / SIM_OWNER_PASSWORD) to post.")
        return 0

    return _apply_scenario(args, ctx, expectation, expected, params, bearer, restaurant_id)


def _print_scenario_summary(ctx, expected, params, outcomes, weekdays, *, verbose: bool) -> None:
    print(
        f"{expected['archetype_id']}  scenario={expected['scenario']}  "
        f"seed={expected['seed']}\n"
        f"{expected['service_date']} ({weekdays[ctx.service_date.weekday()]}) in "
        f"{expected['timezone']}   hours: {params['hours_source']}   "
        f"inventory: {params['inventory_source']}"
    )
    windows = ", ".join(
        f"{_hhmm(start, ctx.timezone)}-{_hhmm(end, ctx.timezone)}" for start, end in ctx.windows
    )
    print(f"open: {windows or 'CLOSED all day'}\n")

    for definition, outcome in outcomes:
        print(f"  {definition.id} — {definition.title}")
        print(f"    {definition.story}")
        if outcome.unverifiable:
            print(f"    UNVERIFIABLE: {outcome.unverifiable}")
        shown = outcome.checks if verbose else outcome.checks[:6]
        for check in shown:
            marks = []
            if not check.posted:
                marks.append("NOT SENT")
            if check.voided:
                marks.append("voided (2 posts)")
            elif check.post_count > 1:
                marks.append(f"posted x{check.post_count}")
            if check.outside_hours:
                marks.append("OUTSIDE HOURS")
            suffix = ("   [" + ", ".join(marks) + "]") if marks else ""
            print(
                f"    {_hhmm(check.opened_at, ctx.timezone)}"
                f"-{_hhmm(check.closed_at, ctx.timezone)} local  "
                f"table {check.table_label:>3s}  {check.covers} cover(s)  "
                f"{len(check.lines)} line(s)  ${check.total:.2f}{suffix}"
            )
            if verbose:
                for line in check.lines:
                    print(
                        f"        {line.line_no}: {line.name[:44]:44s} x{line.qty}"
                        f"  -> {line.expect}"
                    )
        if len(outcome.checks) > len(shown):
            print(f"    showing {len(shown)} of {len(outcome.checks)} checks (--verbose for all)")
        print()

    depletion = expected["depletion"]
    print(f"  expected depletion ({len(depletion)} wine(s))")
    for row in sorted(depletion, key=lambda r: (-r["bottles"], r["wine_name"]))[:12]:
        bound = (
            "  (floor: a pour may find a bottle already open)"
            if row.get("stock_live_is_upper_bound")
            else ""
        )
        print(
            f"    {row['wine_name'][:34]:34s} {row['opening_stock_live']:3d} -> "
            f"{row['expected_stock_live']:3d}   {row['bottles']} bottle(s), "
            f"{row['pour_ml']:.0f}ml poured{bound}"
        )
    if len(depletion) > 12:
        print(f"    showing 12 of {len(depletion)} wines (--out writes them all)")

    low = expected["low_stock"]
    print(f"\n  expected low-stock crossings ({len(low)})")
    for row in low:
        print(
            f"    {row['wine_name'][:34]:34s} {row['expected_stock_live']} "
            f"< threshold {row['threshold_min']}"
        )
    unresolved = expected["unresolved"]
    print(
        f"\n  expected pos_unresolved_lines: {unresolved['count']} "
        f"{unresolved['by_reason'] or ''}"
    )
    print(f"  expected outside-hours checks: {expected['outside_hours_count']}")
    totals = expected["totals"]
    print(
        f"  totals: {totals['checks']} checks ({totals['posted_checks']} posted), "
        f"{totals['wine_lines']} wine + {totals['food_lines']} food lines, "
        f"${totals['revenue']:.2f}"
    )


def _apply_scenario(args, ctx, expectation, expected, params, bearer, restaurant_id) -> int:
    """Post the day, then record the expectation. Order is load-bearing at every step."""
    from datetime import datetime as _datetime
    from datetime import timezone as _timezone

    from scripts.simulate.scenario_apply import ScenarioApplyError, persist_run, upsert_tables

    # Refuse to write anything teardown cannot take back — the same gate cmd_run
    # borrows from scripts/synth rather than holding a second opinion about it.
    from scripts.synth.teardown import assert_teardown_coverage
    from scripts.synth.write_set import SYNTH_WRITE_SET

    assert_teardown_coverage()
    if "pos_checks" not in SYNTH_WRITE_SET:
        raise SystemExit(
            "Refusing --apply: 'pos_checks' is not in scripts/synth SYNTH_WRITE_SET, "
            "so a replayed day could not be torn down."
        )
    if "sim_scenario_runs" not in SYNTH_WRITE_SET:
        # A warning, not a refusal: the table is the harness's own bookkeeping and
        # its migration lands with ADR 0093. Said out loud so it is not
        # rediscovered later as an orphaned table nobody can delete.
        print(
            "WARNING: 'sim_scenario_runs' is not in SYNTH_WRITE_SET — this run's "
            "bookkeeping row will not be removed by scripts/synth teardown."
        )

    config = BridgeConfig(
        restaurant_id=restaurant_id,
        restaurant_guid=args.restaurant_guid or f"sim-guid-{args.archetype}",
        analytics_base=args.analytics_base,
        pos_hub_secret=args.pos_hub_secret or os.environ.get("POS_HUB_WEBHOOK_SECRET", ""),
        bearer=bearer,
        # ONE door. The expectation is written against the signed generic
        # webhook; posting the same day to the Toast ingress as well would
        # deplete a second time through a path this expectation does not model.
        ingress="analytics",
        apply=True,
        allow_remote=args.allow_remote,
    )
    try:
        bridge = Bridge(config)
    except (RemoteTargetRefusedError, UnsignedApplyRefusedError) as exc:
        raise SystemExit(str(exc))

    failures: list[str] = []

    # 1. Tables, before any check: the hub resolves `tableRef` at ingest, so a
    #    table that arrives later does not retroactively attach to the check.
    try:
        seeded = upsert_tables(args.analytics_base, restaurant_id, bearer, expected["tables"])
        print(f"\ntables upserted: {seeded}")
    except ScenarioApplyError as exc:
        failures.append(f"tables: {exc}")
        print(f"\ntables FAILED: {exc}")

    # 2. Mappings, likewise before any check — and carrying inventory ids, or
    #    every wine line queues as unmapped and nothing depletes.
    inventory_by_signature = {sig: row.id for sig, row in ctx.inventory.items()}
    result = bridge.seed_mappings(
        build_mappings(ctx.wine_list), inventory_by_signature=inventory_by_signature
    )
    print(
        f"pos_item_mappings: posted {result.posted}, failed {result.failed}, "
        f"throttled {result.throttled}"
    )
    for err in result.errors[:3]:
        print(f"  {err}")
    if result.failed:
        failures.append(f"mappings: {result.failed} row(s) failed")

    # 3. The day itself, in opened_at order. A duplicate posts twice; a void
    #    posts the close and then the void; a dropped check posts nothing.
    ordered = sorted(
        expectation.checks, key=lambda c: (c.opened_at, c.external_check_id)
    )
    sent = 0
    for planned in ordered:
        for payload in planned.posts():
            before_ok = bridge.analytics.posted
            before_bad = bridge.analytics.failed
            bridge.send_analytics(payload)
            sent += 1
            if bridge.analytics.failed > before_bad:
                detail = bridge.analytics.errors[-1] if bridge.analytics.errors else "rejected"
                failures.append(
                    f"check {planned.external_check_id} ({planned.scenario}): {detail}"
                )
            elif bridge.analytics.posted == before_ok:
                failures.append(
                    f"check {planned.external_check_id}: neither accepted nor rejected"
                )
    print(
        f"checks: {sent} post(s) for {len(ordered)} planned check(s) — "
        f"{bridge.analytics.posted} accepted, {bridge.analytics.failed} rejected"
    )

    # 4. The run's own row, written last so `posted_at` is a fact rather than an
    #    intention. This is the only write in the harness that does not go
    #    through the product API — see scenario_apply.persist_run.
    params = {**params, "post_failures": failures}
    row = {
        "restaurant_id": restaurant_id,
        "archetype_id": args.archetype,
        "scenario": args.scenario,
        "seed": args.seed,
        "service_date": expected["service_date"],
        "timezone": expected["timezone"],
        "operating_hours": expected["operating_hours"],
        "params": params,
        "expected": expected,
        "posted_at": _datetime.now(_timezone.utc).isoformat(),
    }
    try:
        saved = persist_run(
            os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"], row
        )
        print(f"sim_scenario_runs: {saved.get('id')}")
    except ScenarioApplyError as exc:
        print(f"sim_scenario_runs FAILED: {exc}")
        failures.append(f"persist: {exc}")

    if failures:
        print(f"\n{len(failures)} failure(s) in this run:")
        for failure in failures[:10]:
            print(f"  {failure}")
        if len(failures) > 10:
            print(f"  ... and {len(failures) - 10} more")
        return 1
    print("\nRun complete. Verify it with the SimPOS verifier for this run id.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="scripts.simulate",
        description="Simulated service posted through the real POS ingresses",
    )
    sub = p.add_subparsers(dest="command", required=True)

    def common(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--archetype", default="bistro")
        sp.add_argument("--days", type=int, default=14)
        sp.add_argument("--covers-per-night", type=int, default=None)
        sp.add_argument("--seed", type=int, default=20260729)

    r = sub.add_parser("run", help="Generate service and post it through both ingresses")
    common(r)
    r.add_argument("--restaurant", default=None, help="Our restaurant UUID (required with --apply)")
    r.add_argument("--restaurant-guid", default=None, help="The POS's own restaurant id")
    r.add_argument("--analytics-base", default="http://localhost:3001")
    r.add_argument("--stock-base", default="http://localhost:8000")
    r.add_argument("--toast-secret", default=None, help="Defaults to $TOAST_WEBHOOK_SECRET")
    r.add_argument(
        "--pos-hub-secret",
        default=None,
        help="HMAC key for X-Pos-Hub-Signature on the analytics/depletion ingress. Defaults to $POS_HUB_WEBHOOK_SECRET",
    )
    r.add_argument("--ingress", choices=("both", "analytics", "stock"), default="both")
    r.add_argument("--apply", action="store_true", help="Actually post (default: dry run)")
    r.add_argument(
        "--allow-remote",
        action="store_true",
        help=(
            "Required to --apply against a non-localhost --analytics-base/--stock-base. "
            "See BridgeConfig.assert_targets_are_safe for why this exists (2026-08-05 "
            "incident: a downstream process silently fell back to production credentials "
            "when its local config file went missing)."
        ),
    )
    r.add_argument(
        "--seed-mappings",
        action="store_true",
        help=(
            "Upsert pos_item_mappings from the menu snapshot first. Without this the "
            "hub falls back to a keyword scan that resolves only ~35%% of real wine "
            "names, so most wine sales land as food."
        ),
    )
    r.add_argument("--verbose", action="store_true")
    r.set_defaults(func=cmd_run)

    w = sub.add_parser("wines", help="Wine-detection hit rate for generated item names")
    common(w)
    w.set_defaults(func=cmd_wines)

    m = sub.add_parser("mappings", help="Preview the pos_item_mappings rows")
    common(m)
    m.set_defaults(func=cmd_mappings)

    o = sub.add_parser("oracle", help="Expected depletion in bottle-equivalents")
    common(o)
    o.add_argument("--top", type=int, default=25)
    o.set_defaults(func=cmd_oracle)

    # ADR 0093. `--days` is deliberately absent: a scenario is ONE service date,
    # placed inside that day's operating hours, because the expectation it
    # produces is compared against that day's rows.
    s = sub.add_parser(
        "scenario",
        help="Replay one day of named situations and record what it must produce",
    )
    s.add_argument("--archetype", default="bistro")
    s.add_argument("--covers-per-night", type=int, default=None)
    s.add_argument("--seed", type=int, default=7)
    s.add_argument(
        "--scenario",
        default="random",
        help="A scenario id, or 'random' (the default) for a seeded composition",
    )
    s.add_argument("--list", action="store_true", help="Print the library and exit")
    s.add_argument(
        "--date",
        default=None,
        help="Local service date YYYY-MM-DD (default: today in the venue's timezone)",
    )
    s.add_argument(
        "--restaurant",
        default=None,
        help="Our restaurant UUID (required with --apply; a dry run derives it)",
    )
    s.add_argument("--restaurant-guid", default=None, help="The POS's own restaurant id")
    s.add_argument("--analytics-base", default="http://localhost:4000")
    s.add_argument(
        "--pos-hub-secret",
        default=None,
        help="HMAC key for X-Pos-Hub-Signature. Defaults to $POS_HUB_WEBHOOK_SECRET",
    )
    s.add_argument("--apply", action="store_true", help="Actually post (default: dry run)")
    s.add_argument(
        "--allow-remote",
        action="store_true",
        help="Required to --apply against a non-localhost --analytics-base",
    )
    s.add_argument("--verbose", action="store_true", help="Every check, every line")
    s.add_argument("--out", default=None, help="Write the expectation JSON to this file")
    s.set_defaults(func=cmd_scenario)
    return p


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
