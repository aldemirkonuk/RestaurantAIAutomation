#!/usr/bin/env python3
"""Print nf_a.cost_per_completed_task from the live database.

Why this exists
---------------
P1 is not done because code merged. It is done "when a number exists that
nobody had to assemble by hand" (.planning/04-specs/P1-NF-A-INSTRUMENTATION.md
§6). `neural_footprint_event` shipped with no reader, so answering "what did
this agent's reasoning cost?" still meant hand-writing the §2 query into psql.
This script is the hand nobody has to be:

    python3 scripts/nf_readout.py

No arguments, no SQL from the caller. It selects from the two views created by
supabase/migrations/20260824153600_nf_a_readout.sql -- it does not reimplement
the §2 aggregate here, because a second copy of the headline metric is exactly
the "one fact, two homes" defect the corpus keeps paying for.

Honesty before completeness
---------------------------
The job of this readout is NOT to always produce a number. A cost-per-task
figure computed from three smoke-test rows must never be presentable as if it
came from three thousand production rows, so every number is printed with the
sample size and time window that produced it, and a below-threshold sample is
labelled INSUFFICIENT VOLUME in the headline rather than in a footnote.

`outcome_unknown` is printed in the headline for the same reason (§2): until
doneability is defined, the honest report includes how much of it we cannot yet
grade. `outcome` NULL means UNKNOWN, never success (ADR 0008 accepted-risk 1).

The --min-sample default of 30 is a PRESENTATION default chosen here, not a
decision anyone has locked; nothing in .planning/decisions/ sets a volume bar
for NF-A. Override it with --min-sample, and if the project ever needs a real
bar, that is an ADR, not a constant in this file.

Connection
----------
Uses SUPABASE_POOLER_URL -- the name already in .env, and the same name
scripts/check_db_reachable.sh names in its fix instructions. Do not introduce a
variant spelling: a previous session invented
SUPABASE_POOLER_CONNECTION_STRING alongside the existing variable and it cost a
full CI debugging cycle. Falls back to SUPABASE_DB_URL, and reads either from
the process environment first, then from .env.

Note the order differs deliberately from check_db_reachable.sh, which prefers
SUPABASE_DB_URL because it is diagnosing whatever DSN a job already chose. This
script is choosing, and the pooler is the IPv4-reachable one that helper exists
to recommend.

Usage
-----
    python3 scripts/nf_readout.py
    python3 scripts/nf_readout.py --min-sample 100
    python3 scripts/nf_readout.py --json
    python3 scripts/nf_readout.py --require-volume   # exit 1 if under threshold

Exit codes: 0 ok (including honestly-labelled low volume), 1 insufficient
volume under --require-volume, 2 database unreachable or views missing.
"""
from __future__ import annotations

import argparse
import decimal
import json
import os
import pathlib
import re
import subprocess
import sys
from typing import Any, Optional

import psycopg2

ROOT = pathlib.Path(__file__).resolve().parent.parent
REACHABILITY_HELPER = ROOT / "scripts" / "check_db_reachable.sh"

# Order matters: the pooler is IPv4-reachable, the direct host is IPv6-only.
DSN_VARS = ("SUPABASE_POOLER_URL", "SUPABASE_DB_URL")

EXIT_OK = 0
EXIT_INSUFFICIENT = 1
EXIT_UNREACHABLE = 2


def resolve_dsn() -> tuple[str, str]:
    """Return (dsn, source_variable_name). Never returns the value to a log."""
    for var in DSN_VARS:
        value = os.environ.get(var)
        if value:
            return value.strip(), var

    env_file = ROOT / ".env"
    if env_file.exists():
        lines = env_file.read_text().splitlines()
        for var in DSN_VARS:
            for line in lines:
                if line.startswith(f"{var}="):
                    value = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if value:
                        return value, f".env:{var}"

    print(
        "error: no database connection string found.\n"
        f"       Set SUPABASE_POOLER_URL (the name already used in .env) in the\n"
        f"       environment or in {env_file}.",
        file=sys.stderr,
    )
    raise SystemExit(EXIT_UNREACHABLE)


def safe_host(dsn: str) -> str:
    """Host between the last '@' and the following ':' or '/'. Never the DSN."""
    host = re.sub(r"[:/?].*$", "", re.sub(r"^[^@]*@", "", dsn))
    return host or "(unparseable host)"


def report_unreachable(dsn: str, exc: Exception) -> None:
    """Delegate the diagnosis to check_db_reachable.sh rather than paraphrase it.

    That helper already turns "Network is unreachable" into one sentence naming
    the fix (IPv6-only host, use the Supavisor pooler). Re-typing its wording
    here would leave two copies to drift apart.
    """
    print(f"error: could not reach the database at {safe_host(dsn)}", file=sys.stderr)
    print(f"       {str(exc).strip().splitlines()[0] if str(exc).strip() else exc}", file=sys.stderr)
    if REACHABILITY_HELPER.exists():
        print(f"       running {REACHABILITY_HELPER.relative_to(ROOT)} for the diagnosis:", file=sys.stderr)
        env = dict(os.environ, SUPABASE_POOLER_URL=dsn)
        env.pop("SUPABASE_DB_URL", None)  # diagnose the DSN this script chose
        try:
            proc = subprocess.run(
                ["bash", str(REACHABILITY_HELPER)],
                env=env,
                capture_output=True,
                text=True,
                timeout=60,
            )
            for stream in (proc.stdout, proc.stderr):
                for line in stream.splitlines():
                    print(f"       {line}", file=sys.stderr)
        except Exception as helper_exc:  # helper missing bash/dig etc.
            print(f"       (helper could not run: {helper_exc})", file=sys.stderr)
    else:
        print(
            "       check_db_reachable.sh is missing; if the host resolves to IPv6\n"
            "       only, use the Supavisor session pooler and store it as\n"
            "       SUPABASE_POOLER_URL.",
            file=sys.stderr,
        )


def fmt_money(value: Optional[decimal.Decimal]) -> str:
    if value is None:
        return "-"
    rendered = f"{value:.6f}"
    if value > 0 and set(rendered) <= set("0."):
        return f"{value:.2e}"  # too small for 6dp; say so rather than print 0
    return rendered


def fmt_ts(value: Any) -> str:
    return "-" if value is None else value.strftime("%Y-%m-%dT%H:%M:%SZ")


def fmt_window(first: Any, last: Any) -> str:
    if first is None or last is None:
        return "no events, so no window"
    span = last - first
    hours = span.total_seconds() / 3600.0
    if hours < 1:
        shape = f"{span.total_seconds():.0f}s"
    elif hours < 48:
        shape = f"{hours:.1f}h"
    else:
        shape = f"{hours / 24:.1f}d"
    return f"{fmt_ts(first)} .. {fmt_ts(last)}  ({shape})"


def pct(part: int, whole: int) -> str:
    return "-" if not whole else f"{100.0 * part / whole:.1f}%"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Print nf_a.cost_per_completed_task with its sample size and window.",
    )
    parser.add_argument(
        "--min-sample",
        type=int,
        default=30,
        metavar="N",
        help="below this many agent events the readout is labelled INSUFFICIENT "
        "VOLUME (default: 30; a presentation default, not a locked decision)",
    )
    parser.add_argument(
        "--require-volume",
        action="store_true",
        help="exit non-zero when the sample is below --min-sample, for CI gating",
    )
    parser.add_argument("--json", action="store_true", help="emit JSON instead of a table")
    args = parser.parse_args()

    dsn, dsn_source = resolve_dsn()

    try:
        conn = psycopg2.connect(dsn, connect_timeout=15)
    except psycopg2.OperationalError as exc:
        report_unreachable(dsn, exc)
        return EXIT_UNREACHABLE

    conn.autocommit = True
    try:
        cur = conn.cursor()
        try:
            cur.execute("select * from public.nf_a_readout_provenance")
            prov_cols = [d[0] for d in cur.description]
            prov = dict(zip(prov_cols, cur.fetchone()))

            cur.execute("select * from public.nf_a_cost_per_completed_task")
            rows = cur.fetchall()
        except psycopg2.errors.UndefinedTable as exc:
            print(
                "error: the NF-A readout views are missing from this database.\n"
                f"       {str(exc).strip().splitlines()[0]}\n"
                "       Apply supabase/migrations/20260824153600_nf_a_readout.sql.",
                file=sys.stderr,
            )
            return EXIT_UNREACHABLE
    finally:
        conn.close()

    events = prov["events"]
    insufficient = events < args.min_sample

    if args.json:
        payload = {
            "metric": "nf_a.cost_per_completed_task",
            "source_view": "public.nf_a_cost_per_completed_task",
            "database_host": safe_host(dsn),
            "dsn_source": dsn_source,
            "sufficient_volume": not insufficient,
            "min_sample": args.min_sample,
            # avg() ignores NULL cost_usd: when this is true, avg_cost is the mean
            # over costed events only and tasks * avg_cost overstates cost.
            "avg_cost_over_costed_events_only": prov["events_with_cost"] < events,
            "provenance": {
                "events": events,
                "events_with_cost": prov["events_with_cost"],
                "outcome_unknown": prov["outcome_unknown"],
                "agents": prov["agents"],
                "task_types": prov["task_types"],
                "restaurants": prov["restaurants"],
                "cost": None if prov["cost"] is None else float(prov["cost"]),
                "first_event_at": None if prov["first_event_at"] is None else prov["first_event_at"].isoformat(),
                "last_event_at": None if prov["last_event_at"] is None else prov["last_event_at"].isoformat(),
            },
            "rows": [
                {
                    "agent": agent,
                    "task_type": task_type,
                    "tasks": tasks,
                    "cost": None if cost is None else float(cost),
                    "avg_cost": None if avg_cost is None else float(avg_cost),
                    "outcome_unknown": outcome_unknown,
                    "below_min_sample": tasks < args.min_sample,
                }
                for agent, task_type, tasks, cost, avg_cost, outcome_unknown in rows
            ],
        }
        print(json.dumps(payload, indent=2))
        return EXIT_INSUFFICIENT if (insufficient and args.require_volume) else EXIT_OK

    print("nf_a.cost_per_completed_task")
    print(f"  source  : public.nf_a_cost_per_completed_task on {safe_host(dsn)} (dsn from {dsn_source})")
    print(f"  window  : {fmt_window(prov['first_event_at'], prov['last_event_at'])}")
    print(
        f"  sample  : {events} agent events | {prov['events_with_cost']} carry a cost "
        f"| {prov['agents']} agents | {prov['task_types']} task types "
        f"| {prov['restaurants']} restaurants"
    )
    print(
        f"  ungraded: {prov['outcome_unknown']} of {events} events have outcome NULL "
        f"({pct(prov['outcome_unknown'], events)}) -- NULL means UNKNOWN, never success"
    )
    print(f"  total   : {fmt_money(prov['cost'])} USD")
    if prov["events_with_cost"] < events:
        uncosted = events - prov["events_with_cost"]
        print(
            f"  caveat  : {uncosted} of {events} events carry no cost_usd at all. avg() ignores"
        )
        print(
            "            NULLs, so avg_cost below is the mean over COSTED events, not over"
        )
        print(
            "            'tasks'. tasks * avg_cost overstates cost -- use cost_usd for totals."
        )
    print()

    if events == 0:
        print("  NO DATA. The ledger is empty: nothing has emitted an agent footprint yet.")
        print("  There is no cost-per-task number to report, and inventing one would be")
        print("  the exact failure P1 §6 is written against.")
        return EXIT_INSUFFICIENT if args.require_volume else EXIT_OK

    if insufficient:
        bar = "*" * 78
        print(bar)
        print(f"  INSUFFICIENT VOLUME -- {events} events is below the threshold of {args.min_sample}.")
        print("  The numbers below are real, but they are a smoke test, not a production")
        print("  cost-per-task figure. Do not quote them as one, and do not feed them to a")
        print("  loop that assumes production volume.")
        print(bar)
        print()

    headers = ("agent", "task_type", "tasks", "cost_usd", "avg_cost", "outcome_unknown", "note")
    table = []
    for agent, task_type, tasks, cost, avg_cost, outcome_unknown in rows:
        table.append(
            (
                str(agent),
                "(null)" if task_type is None else str(task_type),
                str(tasks),
                fmt_money(cost),
                fmt_money(avg_cost),
                f"{outcome_unknown} ({pct(outcome_unknown, tasks)})",
                "low-n" if tasks < args.min_sample else "",
            )
        )

    widths = [max(len(h), *(len(r[i]) for r in table)) for i, h in enumerate(headers)]
    print("  " + "  ".join(h.ljust(widths[i]) for i, h in enumerate(headers)).rstrip())
    print("  " + "  ".join("-" * w for w in widths))
    for row in table:
        print("  " + "  ".join(row[i].ljust(widths[i]) for i in range(len(headers))).rstrip())
    print()
    print(f"  {len(table)} agent/task_type pairs. 'low-n' marks a pair with fewer than")
    print(f"  {args.min_sample} tasks -- its avg_cost is not a stable estimate.")

    return EXIT_INSUFFICIENT if (insufficient and args.require_volume) else EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
