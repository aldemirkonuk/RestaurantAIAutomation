"""CLI: python3 -m scripts.simulate {run|wines|oracle}

Dry run is the DEFAULT, matching scripts/synth. `--apply` is required to open a
socket; without it the command builds and signs every payload and reports what it
would have sent, which makes the whole encoding path testable offline.

    python3 -m scripts.simulate run --archetype bistro --days 14
    python3 -m scripts.simulate run --archetype bistro --days 60 --restaurant <uuid> --apply
    python3 -m scripts.simulate wines --archetype bistro     # wine-detection hit rate
    python3 -m scripts.simulate oracle --archetype bistro --days 7
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Sequence

from scripts.simulate.bridge import Bridge, BridgeConfig
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
        ingress=args.ingress,
        apply=args.apply,
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

    bridge = Bridge(config)

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
    r.add_argument("--ingress", choices=("both", "analytics", "stock"), default="both")
    r.add_argument("--apply", action="store_true", help="Actually post (default: dry run)")
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
    return p


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
