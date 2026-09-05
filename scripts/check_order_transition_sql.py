#!/usr/bin/env python3
"""Guard: the order transition table has ONE definition, in two languages.

WHY THIS EXISTS
---------------
ADR 0125 gave `procurement_orders.status` a transition table in TypeScript
(`apps/api-gateway/src/procurement/order-transitions.ts`) and, on the founder's
call of 2026-09-05, the same table as a `BEFORE UPDATE OF status` trigger
(`supabase/migrations/20260905230000_an_order_changes_state_by_the_table.sql`)
so that writers which never touch the gateway -- `procurement_agent.py` writes
terminal statuses straight to Supabase with the service key -- are held to it
too.

Two copies of a rule is how a rule stops being one. The failure is not
theoretical and it is asymmetric in the worst direction: an edge added to the
.ts to unblock a build leaves the DATABASE still refusing it, so the service
reports a legal move and the write fails underneath it with a different
sentence, in production, where no TypeScript runs.

`order-transition-sql.spec.ts` asserts the same equality from inside the
TypeScript, by rendering the arrays and matching them. This guard is the
INDEPENDENT half: it parses both files itself, in Python, comparing sets rather
than text. A bug in the renderer can make the spec agree with itself; it cannot
make this agree with it.

WHAT IT CHECKS
--------------
  1. Every edge in `ORDER_TRANSITIONS` appears in the migration's `edges` array.
  2. Every edge in the migration's array appears in `ORDER_TRANSITIONS`.
  3. The migration's `vocabulary` array is exactly the table's key set.
  4. The trigger is BEFORE UPDATE **OF status** -- not AFTER, which cannot
     refuse, and not unqualified, which would fire on every column.

NEVER VACUOUS
-------------
Every "found nothing" path is exit 2, not a pass:
  * either file missing                                  -> 2
  * the .ts table parses to fewer than MIN_STATES states -> 2
  * the .ts table parses to fewer than MIN_EDGES edges   -> 2
  * the migration's `edges` array is absent or empty     -> 2
  * the migration's `vocabulary` array is absent         -> 2
A guard that goes green because it found nothing to compare is the exact shape
of the defect it was written to catch.

  ./scripts/check_order_transition_sql.py
  ./scripts/check_order_transition_sql.py --self-test

Exit 0 = pass.  Exit 1 = the two definitions disagree.  Exit 2 = could not check.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TS = ROOT / "apps" / "api-gateway" / "src" / "procurement" / "order-transitions.ts"
SQL = (
    ROOT
    / "supabase"
    / "migrations"
    / "20260905230000_an_order_changes_state_by_the_table.sql"
)

# The table had 12 states and 40 edges when this guard landed. A parse that
# returns a handful means the pattern rotted, not that the table shrank.
MIN_STATES = 10
MIN_EDGES = 25


def die(code: int, *lines: str) -> int:
    for line in lines:
        print(line)
    return code


def parse_ts(text: str) -> tuple[dict[str, list[str]], str | None]:
    """`ORDER_TRANSITIONS` as {FROM: [TO, ...]}, or a reason it could not be read."""
    block = re.search(
        r"export const ORDER_TRANSITIONS[^=]*=\s*\{(.*?)\n\};",
        text,
        re.S,
    )
    if not block:
        return {}, "ORDER_TRANSITIONS was not found in the .ts"

    table: dict[str, list[str]] = {}
    # `[ProcurementOrderStatus.X]: [ ... ],` -- comments inside are stripped
    # first, because the table's rows carry long prose that names other states
    # (a guard that reads prose as code passes confidently for the wrong reason).
    body = re.sub(r"//[^\n]*", "", block.group(1))
    for m in re.finditer(
        r"\[ProcurementOrderStatus\.([A-Z_]+)\]\s*:\s*\[(.*?)\]",
        body,
        re.S,
    ):
        frm = m.group(1)
        table[frm] = re.findall(r"ProcurementOrderStatus\.([A-Z_]+)", m.group(2))
    if not table:
        return {}, "ORDER_TRANSITIONS was found but no rows parsed out of it"
    return table, None


def parse_sql_array(text: str, name: str) -> list[str]:
    m = re.search(rf"{name} text\[\] := ARRAY\[(.*?)\];", text, re.S)
    if not m:
        return []
    return re.findall(r"'([A-Z_>]+)'", m.group(1))


def check(ts_text: str, sql_text: str) -> tuple[int, list[str]]:
    out: list[str] = []
    table, why = parse_ts(ts_text)
    if why:
        return 2, [f"== Order transition table: CANNOT CHECK -- {why}"]
    if len(table) < MIN_STATES:
        return 2, [
            f"== Order transition table: CANNOT CHECK -- parsed {len(table)} state(s) "
            f"from the .ts, fewer than the floor of {MIN_STATES}. The parser is broken."
        ]

    ts_edges = {f"{frm}>{to}" for frm, tos in table.items() for to in tos}
    if len(ts_edges) < MIN_EDGES:
        return 2, [
            f"== Order transition table: CANNOT CHECK -- parsed {len(ts_edges)} edge(s) "
            f"from the .ts, fewer than the floor of {MIN_EDGES}."
        ]

    sql_edges = set(parse_sql_array(sql_text, "edges"))
    if not sql_edges:
        return 2, [
            "== Order transition table: CANNOT CHECK -- the migration's `edges` "
            "ARRAY is absent or empty."
        ]
    sql_vocab = set(parse_sql_array(sql_text, "vocabulary"))
    if not sql_vocab:
        return 2, [
            "== Order transition table: CANNOT CHECK -- the migration's "
            "`vocabulary` ARRAY is absent or empty."
        ]

    failed = False
    only_ts = sorted(ts_edges - sql_edges)
    only_sql = sorted(sql_edges - ts_edges)
    if only_ts:
        failed = True
        out.append(
            "   IN THE TYPESCRIPT, NOT IN THE DATABASE -- the service would allow "
            "these and the write would fail underneath it:"
        )
        out += [f"     {e}" for e in only_ts]
    if only_sql:
        failed = True
        out.append(
            "   IN THE DATABASE, NOT IN THE TYPESCRIPT -- the service would refuse "
            "these before the database got a chance to allow them:"
        )
        out += [f"     {e}" for e in only_sql]

    ts_vocab = set(table.keys())
    if ts_vocab != sql_vocab:
        failed = True
        out.append(
            f"   VOCABULARY DISAGREES -- only in .ts: {sorted(ts_vocab - sql_vocab)}; "
            f"only in SQL: {sorted(sql_vocab - ts_vocab)}"
        )

    if not re.search(r"BEFORE UPDATE OF status ON public\.procurement_orders", sql_text):
        failed = True
        out.append(
            "   THE TRIGGER IS NOT `BEFORE UPDATE OF status` -- AFTER cannot refuse "
            "a write, and an unqualified UPDATE fires on every column."
        )

    head = (
        f"== Order transition table: {len(ts_edges)} edge(s) in the .ts, "
        f"{len(sql_edges)} in the migration, {len(ts_vocab)} state(s)"
    )
    if failed:
        return 1, [head] + out + [
            "FAIL (exit 1) -- the two definitions of the transition table disagree.",
            "   The .ts is the source: regenerate the migration's arrays with",
            "   `renderOrderTransitionSqlArrays()` (order-transitions.ts).",
        ]
    return 0, [head, "PASS -- one table, two languages, no drift."]


def self_test() -> int:
    """Prove the guard bites, against a deliberately drifted pair."""
    ts = TS.read_text() if TS.exists() else ""
    sql = SQL.read_text() if SQL.exists() else ""
    if not ts or not sql:
        print("SELF-TEST: CANNOT RUN -- a source file is missing.")
        return 2
    code, _ = check(ts, sql)
    if code != 0:
        print(f"SELF-TEST FAILED: the real pair should pass, got exit {code}.")
        return 1
    drifted = sql.replace("'PENDING>CANCELLED',\n", "", 1)
    code, _ = check(ts, drifted)
    if code != 1:
        print(f"SELF-TEST FAILED: removing an SQL edge should exit 1, got {code}.")
        return 1
    code, _ = check(ts, sql.replace("BEFORE UPDATE OF status", "AFTER UPDATE OF status"))
    if code != 1:
        print(f"SELF-TEST FAILED: an AFTER trigger should exit 1, got {code}.")
        return 1
    code, _ = check("export const ORDER_TRANSITIONS = {\n};", sql)
    if code != 2:
        print(f"SELF-TEST FAILED: an unparsable table should exit 2, got {code}.")
        return 1
    print("SELF-TEST PASSED: the guard bites on a dropped edge, an AFTER trigger, "
          "and an unreadable table.")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    if not TS.exists():
        return die(2, f"== Order transition table: CANNOT CHECK -- {TS} is missing.")
    if not SQL.exists():
        return die(
            2,
            f"== Order transition table: CANNOT CHECK -- {SQL} is missing.",
            "   The TypeScript table is enforced in the database by that migration;",
            "   without it there is nothing to compare and the trigger does not exist.",
        )
    code, lines = check(TS.read_text(), SQL.read_text())
    return die(code, *lines)


if __name__ == "__main__":
    sys.exit(main())
