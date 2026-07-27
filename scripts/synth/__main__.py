"""Entry point: python -m scripts.synth

Full CLI (refresh|generate|teardown) lands in plan 37-03.
"""

from __future__ import annotations

import argparse
import sys


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="scripts.synth",
        description="Synthetic restaurant factory (CLI lands in 37-03)",
    )
    parser.add_argument(
        "command",
        nargs="?",
        default=None,
        help="refresh|generate|teardown (not yet implemented)",
    )
    args = parser.parse_args(argv)
    if args.command:
        print(
            f"synth CLI command '{args.command}' lands in 37-03 — stub only",
            file=sys.stderr,
        )
        return 2
    print("synth CLI lands in 37-03")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
