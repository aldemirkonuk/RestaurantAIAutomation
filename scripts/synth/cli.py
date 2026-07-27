"""CLI: python3 -m scripts.synth {refresh|generate|teardown} (D-14..D-16).

Default is dry-run. Cloud mutations require explicit ``--apply``.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Sequence

from scripts.synth.recipes import UnknownArchetypeError, list_archetypes
from scripts.synth.seed import apply_seed
from scripts.synth.snapshots import refresh_snapshot
from scripts.synth.teardown import (
    WriteSetTeardownCoverageError,
    assert_teardown_coverage,
    refuse_multi_archetype_apply_unless_ready,
    teardown_sim,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="scripts.synth",
        description="Synthetic restaurant factory (refresh | generate | teardown)",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    refresh = sub.add_parser("refresh", help="Re-crawl/extract and update frozen snapshots")
    refresh.add_argument(
        "--archetype",
        default="all",
        help="Archetype id or 'all' (default: all)",
    )
    refresh.add_argument(
        "--apply",
        action="store_true",
        default=False,
        help="Perform network refresh (default: dry-run / no mutate)",
    )

    generate = sub.add_parser("generate", help="Build seed plan / apply cloud seed")
    generate.add_argument(
        "--archetype",
        default="all",
        help="Archetype id or 'all' (default: all)",
    )
    generate.add_argument(
        "--apply",
        action="store_true",
        default=False,
        help="Mutate cloud (default: dry-run)",
    )

    teardown = sub.add_parser("teardown", help="Tear down sim-* tenants")
    teardown.add_argument(
        "--apply",
        action="store_true",
        default=False,
        help="Perform deletes (default: dry-run plan)",
    )
    return parser


def _resolve_archetypes(spec: str) -> list[str]:
    known = list_archetypes()
    if spec == "all":
        return list(known)
    if spec not in known:
        raise UnknownArchetypeError(spec)
    return [spec]


def _cmd_refresh(args: argparse.Namespace) -> int:
    try:
        ids = _resolve_archetypes(args.archetype)
    except UnknownArchetypeError as exc:
        print(f"error: unknown archetype: {exc}", file=sys.stderr)
        return 2

    if not args.apply:
        print(
            json.dumps(
                {
                    "command": "refresh",
                    "dry_run": True,
                    "apply": False,
                    "archetypes": ids,
                    "note": "pass --apply to re-crawl/update snapshots",
                },
                indent=2,
            )
        )
        return 0

    results = []
    for aid in ids:
        snap = refresh_snapshot(aid, use_crawler=True)
        results.append(
            {
                "archetype_id": aid,
                "item_count": len(snap.get("items") or []),
                "menu_quality": snap.get("menu_quality"),
            }
        )
    print(json.dumps({"command": "refresh", "apply": True, "results": results}, indent=2))
    return 0


def _cmd_generate(args: argparse.Namespace) -> int:
    try:
        ids = _resolve_archetypes(args.archetype)
    except UnknownArchetypeError as exc:
        print(f"error: unknown archetype: {exc}", file=sys.stderr)
        return 2

    if args.apply:
        try:
            refuse_multi_archetype_apply_unless_ready(
                archetypes=ids,
                apply=True,
                coverage_assert=assert_teardown_coverage,
            )
        except WriteSetTeardownCoverageError as exc:
            print(f"error: write-set gate failed: {exc}", file=sys.stderr)
            return 1

    plans: list[dict[str, Any]] = []
    for aid in ids:
        plan = apply_seed(aid, apply=bool(args.apply))
        plans.append(
            {
                "archetype_id": plan.get("archetype_id", aid),
                "slug": plan.get("slug"),
                "sku_count": plan.get("sku_count"),
                "dry_run": plan.get("dry_run", not args.apply),
                "apply": plan.get("apply", bool(args.apply)),
                "tables": plan.get("tables"),
            }
        )
    print(
        json.dumps(
            {
                "command": "generate",
                "dry_run": not bool(args.apply),
                "apply": bool(args.apply),
                "archetype_count": len(plans),
                "plans": plans,
            },
            indent=2,
        )
    )
    return 0


def _cmd_teardown(args: argparse.Namespace) -> int:
    result = teardown_sim(apply=bool(args.apply))
    print(json.dumps({"command": "teardown", **result}, indent=2, default=str))
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    if args.command == "refresh":
        return _cmd_refresh(args)
    if args.command == "generate":
        return _cmd_generate(args)
    if args.command == "teardown":
        return _cmd_teardown(args)
    parser.print_help()
    return 2


__all__ = ["build_parser", "main", "apply_seed", "list_archetypes", "teardown_sim", "refresh_snapshot", "assert_teardown_coverage"]
