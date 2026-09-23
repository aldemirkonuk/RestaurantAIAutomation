#!/usr/bin/env python3
"""Every field /ask shows carries a data class, and the restricted set is derived.

ADR 0145, 2026-09-21 amendment. The founder chose the option "Rules in code,
label rows": what a person may see on /ask is a rule in a table, never a model
behaviour. Sensitivity belongs to a FIELD, so:

  * each Reading in reading-catalogue.ts declares the fields it `shows`
    (`relation.column`, `relation.*` for a row count), plus the label its
    subject matches are listed by (SUBJECT_LABEL_FIELDS);
  * each shown field carries one class in reading-data-classes.ts FIELD_CLASS;
  * a Reading's roles are the ROLE_POLICY rows that see every class it shows.

Gating by hand, one Reading at a time, failed twice in three days
(`orders.late_deliveries` was a bypass of `orders.open`; `goals.targets` showed
revenue targets to staff). This guard is what makes the derivation stay true:

  1. UNTAGGED       a shown field with no FIELD_CLASS entry.
  2. UNDECLARED     a column the runner puts in a cell -- `s.field(..., "col")`,
                    `s.sum(..., "col")`, a `listing(...)` column, a unit read
                    from a row (`String(doc.currency)`, `hasUnit(...)` = uom) --
                    that the Reading's `shows` does not name; or a count
                    (`s.count`, `listing`) with no `relation.*` in `shows`.
  3. STALE          a FIELD_CLASS entry no Reading shows -- except a
                    `relation.*` tag of a relation some Reading reads (its
                    `shelves`), which classes that read's count in the trace.
  3b. UNTAGGED COUNT a relation some Reading reads with no `relation.*` tag.
                    Every read's row count reaches the Finding's source trace,
                    and the trace shows it only to a role that sees its class
                    (founder, 2026-09-21, round 6, "Hide by data type";
                    `withholdTraceCounts`); an untagged count is withheld from
                    everyone, so the guard makes the tag a stated decision.
  4. POLICY         a ROLE_POLICY row naming an unknown class or answer kind, a
                    share outside 0..1, or a fallback row that is not the least
                    privileged.
  5. RESTRICTED     with --expect-restricted a,b,c: the derived set of Readings
                    the fallback (staff) row does not receive must equal it.
                    CLAIMS.jsonl passes the derived set (eight since round 6).

A tag may name a ROW VIEW, `relation@view.column`: rows of one relation whose
class differs from the whole relation's (`procurement_orders@due_today`, the
day's open deliveries, versus the whole order book).

The runner also refuses at RUN time to mint a cell from an undeclared field
(`undeclared_field`, recording-session.ts); this guard is the static half, so a
new field fails CI before any test happens to exercise it.

Exit 0 pass, 1 a finding, 2 cannot check (a file or a shape this guard reads is
missing -- never reported as a pass). `--self-test` mutates in memory and
requires every mutation to be caught.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
READINGS = ROOT / "apps/api-gateway/src/ask-readings"
CLASSES_TS = READINGS / "reading-data-classes.ts"
CATALOGUE_TS = READINGS / "reading-catalogue.ts"
RUNNER_TS = READINGS / "reading-runner.ts"


class CannotCheck(Exception):
    pass


def _block(src: str, anchor: str, open_ch: str, close_ch: str) -> str:
    """The balanced block that starts at the first `open_ch` after `anchor`."""
    at = src.find(anchor)
    if at < 0:
        raise CannotCheck(f"anchor not found: {anchor}")
    start = src.find(open_ch, at + len(anchor))
    if start < 0:
        raise CannotCheck(f"no {open_ch} after {anchor}")
    depth = 0
    i = start
    in_str: str | None = None
    while i < len(src):
        ch = src[i]
        if in_str:
            if ch == "\\":
                i += 2
                continue
            if ch == in_str:
                in_str = None
        elif src.startswith("//", i):
            # A line comment ("the runner's clock") is not code: an apostrophe
            # in it must not open a string.
            nl = src.find("\n", i)
            i = len(src) if nl < 0 else nl
            continue
        elif src.startswith("/*", i):
            end = src.find("*/", i + 2)
            i = len(src) if end < 0 else end + 2
            continue
        elif ch in "\"'`":
            in_str = ch
        elif ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return src[start + 1 : i]
        i += 1
    raise CannotCheck(f"unbalanced block after {anchor}")


def _strings(text: str) -> list[str]:
    return re.findall(r'"([^"]*)"', text)


def parse_classes(src: str) -> dict:
    data_classes = _strings(_block(src, "export const DATA_CLASSES", "[", "]"))
    answer_kinds = _strings(_block(src, "export const ANSWER_KINDS", "[", "]"))
    field_block = _block(src, "export const FIELD_CLASS", "{", "}")
    field_class = dict(
        re.findall(
            r'"([a-z_]+(?:@[a-z_]+)?\.(?:[a-z_]+|\*))"\s*:\s*"([a-z_]+)"', field_block
        )
    )
    body_lines = [
        ln
        for ln in field_block.splitlines()
        if ln.strip() and not ln.strip().startswith("//")
    ]
    if len(field_class) != len(body_lines):
        raise CannotCheck(
            f"FIELD_CLASS has {len(body_lines)} entry lines but {len(field_class)} parse as "
            '"relation.column": "class" -- keep one entry per line'
        )
    policy_block = _block(src, "export const ROLE_POLICY:", "{", "}")
    rows = re.findall(
        r"(\w+):\s*\{\s*sees:\s*\[([^\]]*)\],\s*answers:\s*\[([^\]]*)\],\s*dailyAskBudgetShare:\s*([0-9.]+)\s*\}",
        policy_block,
    )
    row_lines = [
        ln
        for ln in policy_block.splitlines()
        if ln.strip() and not ln.strip().startswith("//")
    ]
    if not rows or len(rows) != len(row_lines):
        raise CannotCheck(
            "ROLE_POLICY rows do not parse -- keep one `role: { sees, answers, dailyAskBudgetShare }` per line"
        )
    policy = {
        r: {"sees": _strings(s), "answers": _strings(a), "share": float(sh)}
        for r, s, a, sh in rows
    }
    fb = re.search(r'export const ROLE_POLICY_FALLBACK:\s*\w+\s*=\s*"(\w+)"', src)
    if not fb:
        raise CannotCheck("ROLE_POLICY_FALLBACK not found")
    return {
        "data_classes": data_classes,
        "answer_kinds": answer_kinds,
        "field_class": field_class,
        "policy": policy,
        "fallback": fb.group(1),
    }


def parse_catalogue(src: str) -> dict[str, dict]:
    subject_block = _block(src, "export const SUBJECT_LABEL_FIELDS", "{", "}")
    subject_fields: dict[str, list[str]] = {}
    for key, body in re.findall(r"(\w+):\s*\[([^\]]*)\]", subject_block):
        subject_fields[key] = _strings(body)
    declared = _block(src, "const DECLARED: readonly DeclaredReading[] =", "[", "]")
    readings: dict[str, dict] = {}
    for line in declared.splitlines():
        if not line.strip().startswith("{ id:"):
            continue
        m = re.match(
            r'\s*\{ id: "([^"]+)".*?subject: "(\w+)".*?shelves: \[([^\]]*)\].*?shows: \[([^\]]*)\]',
            line,
        )
        if not m:
            raise CannotCheck(
                f"a catalogue entry has no parseable subject/shows: {line.strip()[:80]}"
            )
        rid, subject, shelves, shows = (
            m.group(1),
            m.group(2),
            _strings(m.group(3)),
            _strings(m.group(4)),
        )
        extra = [] if subject == "none" else subject_fields.get(subject)
        if extra is None:
            raise CannotCheck(
                f"{rid}: subject {subject} has no SUBJECT_LABEL_FIELDS entry"
            )
        readings[rid] = {
            "shows": list(dict.fromkeys(shows + extra)),
            "shelves": shelves,
        }
    if not readings:
        raise CannotCheck("no catalogue entries parsed")
    return readings


def _calls(text: str, name: str) -> list[str]:
    """The argument text of every `name(` call in `text` (balanced)."""
    out = []
    for m in re.finditer(re.escape(name) + r"\(", text):
        out.append(_block(text[m.start() :], name, "(", ")"))
    return out


def _unit_columns(args_after_field: str) -> set[str]:
    cols = set(re.findall(r"\b\w+!?\.(\w+)", args_after_field))
    if "hasUnit(" in args_after_field:
        cols.add("uom")
    return cols


def runner_shows(src: str) -> dict[str, dict]:
    """Per Reading id: the columns its case block puts in a cell, and whether it counts."""
    switch = _block(src, "switch (id)", "{", "}")
    labels = list(re.finditer(r'case "([^"]+)":', switch))
    if not labels:
        raise CannotCheck('no `case "...":` labels in the runner\'s switch')
    groups: list[tuple[list[str], int]] = []
    for i, m in enumerate(labels):
        between = switch[labels[i - 1].end() : m.start()] if i else None
        if groups and between is not None and between.strip() == "":
            groups[-1][0].append(m.group(1))
        else:
            groups.append(([m.group(1)], m.end()))
    result: dict[str, dict] = {}
    for gi, (ids, body_start) in enumerate(groups):
        next_start = None
        for m in labels:
            if m.start() > body_start and m.group(1) not in ids:
                next_start = m.start()
                break
        body = switch[
            body_start : next_start if next_start is not None else len(switch)
        ]
        cols: set[str] = set()
        counts = False
        # `[["col", "Title"], ...].map(([field, title]) => s.field(e, row, field, ...))`
        mapped: dict[str, set[str]] = {}
        for m in re.finditer(
            r'(\[\s*\[\s*"\w+"\s*,\s*"[^"\r\n]*"\s*\]'
            r'(?:\s*,\s*\[\s*"\w+"\s*,\s*"[^"\r\n]*"\s*\])*\s*\])'
            r'\.map\(\(\[\s*(\w+)\s*,',
            body,
        ):
            mapped.setdefault(m.group(2), set()).update(
                re.findall(r'\[\s*"(\w+)"\s*,', m.group(1))
            )
        # A unit taken from the item's ledger unit is shown wherever it is used.
        if "hasUnit(" in body:
            cols.add("uom")
        for args in _calls(body, "s.field"):
            parts = re.match(r"\s*([^,]+),\s*([^,]+),\s*(.*)", args, re.S)
            if not parts:
                raise CannotCheck(f"unparseable s.field call in {ids}: {args[:60]}")
            rest = parts.group(3)
            lit = re.match(r'"(\w+)"\s*,?(.*)', rest, re.S)
            if lit:
                cols.add(lit.group(1))
                cols |= _unit_columns(lit.group(2))
            elif rest.startswith("labelField("):
                cols |= {"display_name", "wine_name"}
                cols |= _unit_columns(rest[rest.find(")") + 1 :])
            elif (
                re.match(r"(\w+)\s*,", rest)
                and re.match(r"(\w+)", rest).group(1) in mapped
            ):
                ident = re.match(r"(\w+)", rest).group(1)
                cols |= mapped[ident]
                cols |= _unit_columns(rest[len(ident) :])
            else:
                raise CannotCheck(
                    f"s.field in {ids} names its column by an expression this guard cannot read: {rest[:60]}"
                )
        for args in _calls(body, "s.sum"):
            lit = re.match(r'\s*[^,]+,\s*"(\w+)"\s*,(.*)', args, re.S)
            if not lit:
                raise CannotCheck(
                    f"s.sum in {ids} names its column by an expression this guard cannot read: {args[:60]}"
                )
            cols.add(lit.group(1))
            cols |= _unit_columns(lit.group(2))
        if _calls(body, "s.count"):
            counts = True
        for args in _calls(body, "listing"):
            counts = True
            cols |= set(re.findall(r'\[\s*"(\w+)"\s*,\s*"[^"]*"\s*\]', args))
        for rid in ids:
            result[rid] = {"cols": cols, "counts": counts}
    return result


def check(
    classes_src: str,
    catalogue_src: str,
    runner_src: str,
    expect_restricted: list[str] | None,
) -> tuple[list[str], list[str]]:
    cls = parse_classes(classes_src)
    readings = parse_catalogue(catalogue_src)
    runner = runner_shows(runner_src)
    failures: list[str] = []
    field_class = cls["field_class"]

    if set(readings) != set(runner):
        failures.append(
            f"CATALOGUE/RUNNER MISMATCH: only in catalogue {sorted(set(readings) - set(runner))}, "
            f"only in runner {sorted(set(runner) - set(readings))}"
        )
    for f, c in field_class.items():
        if c not in cls["data_classes"]:
            failures.append(
                f"UNKNOWN CLASS: {f} is tagged {c!r}, not one of {cls['data_classes']}"
            )
    for rid, r in readings.items():
        for f in r["shows"]:
            if f not in field_class:
                failures.append(
                    f"UNTAGGED: {rid} shows {f}, which has no FIELD_CLASS entry"
                )
        shown_cols = {f.split(".", 1)[1] for f in r["shows"]}
        ran = runner.get(rid)
        if ran is None:
            continue
        for col in sorted(ran["cols"] - shown_cols):
            failures.append(
                f"UNDECLARED: the runner's {rid} case shows column {col!r}, which {rid}'s `shows` does not name"
            )
        if ran["counts"] and "*" not in shown_cols:
            failures.append(
                f"UNDECLARED: the runner's {rid} case shows a row count, and {rid}'s `shows` names no `relation.*`"
            )
    shown_anywhere = {f for r in readings.values() for f in r["shows"]}
    read_anywhere = {rel for r in readings.values() for rel in r["shelves"]}
    counted_reads = {f"{rel}.*" for rel in read_anywhere}
    for f in sorted(set(field_class) - shown_anywhere - counted_reads):
        failures.append(f"STALE: FIELD_CLASS tags {f}, which no Reading shows")
    for rel in sorted(read_anywhere):
        if f"{rel}.*" not in field_class:
            failures.append(
                f"UNTAGGED COUNT: a Reading reads {rel}, whose row count reaches the trace, and it has no `{rel}.*` tag"
            )

    policy = cls["policy"]
    fallback = policy.get(cls["fallback"])
    if fallback is None:
        failures.append(
            f"POLICY: the fallback row {cls['fallback']!r} is not a ROLE_POLICY row"
        )
    for role, row in policy.items():
        for c in row["sees"]:
            if c not in cls["data_classes"]:
                failures.append(f"POLICY: {role} sees unknown class {c!r}")
        for a in row["answers"]:
            if a not in cls["answer_kinds"]:
                failures.append(f"POLICY: {role} is given unknown answer kind {a!r}")
        if not 0 <= row["share"] <= 1:
            failures.append(
                f"POLICY: {role}'s dailyAskBudgetShare {row['share']} is outside 0..1"
            )
        if fallback is not None and (
            not set(fallback["sees"]) <= set(row["sees"])
            or not set(fallback["answers"]) <= set(row["answers"])
            or fallback["share"] > row["share"]
        ):
            failures.append(
                f"POLICY: the fallback row {cls['fallback']!r} is not the least privileged (compare {role})"
            )

    restricted: list[str] = []
    if fallback is not None:
        for rid, r in readings.items():
            classes = {field_class[f] for f in r["shows"] if f in field_class}
            if "reading" not in fallback["answers"] or not classes <= set(
                fallback["sees"]
            ):
                restricted.append(rid)
    restricted.sort()
    if expect_restricted is not None and restricted != sorted(expect_restricted):
        failures.append(
            f"RESTRICTED: derived {restricted}, expected {sorted(expect_restricted)}"
        )
    return failures, restricted


def run(expect_restricted: list[str] | None) -> int:
    try:
        srcs = [p.read_text() for p in (CLASSES_TS, CATALOGUE_TS, RUNNER_TS)]
        failures, restricted = check(*srcs, expect_restricted)
    except (OSError, CannotCheck) as e:
        print(f"CANNOT CHECK -- {e}")
        return 2
    if failures:
        print(
            "FAIL -- /ask shows a field whose class is not stated, or the derived gate moved:"
        )
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        f"PASS -- every field /ask shows carries a data class; restricted from the fallback row: {', '.join(restricted)}."
    )
    return 0


def self_test() -> int:
    try:
        base = [p.read_text() for p in (CLASSES_TS, CATALOGUE_TS, RUNNER_TS)]
    except OSError as e:
        print(f"CANNOT CHECK -- {e}")
        return 2
    eight = [
        "calendar.upcoming",
        "goals.targets",
        "orders.late_deliveries",
        "orders.open",
        "receipts.verified_line",
        "sales.check_activity",
        "sales.consumption",
        "vendors.active",
    ]
    failures, _ = check(*base, eight)
    if failures:
        print("SELF-TEST CANNOT RUN -- the real tree does not pass:", failures)
        return 1

    def mut(i: int, old: str, new: str) -> list[str]:
        srcs = list(base)
        if old not in srcs[i]:
            raise CannotCheck(f"self-test anchor missing: {old[:60]}")
        srcs[i] = srcs[i].replace(old, new, 1)
        return srcs

    cases = [
        (
            "an untagged shown field",
            mut(0, '  "analytics_goals.target_value": "money",\n', ""),
            "UNTAGGED",
        ),
        (
            "a stale tag",
            mut(
                0,
                '  "providers.name": "suppliers",\n',
                '  "providers.name": "suppliers",\n  "providers.phone": "people",\n',
            ),
            "STALE",
        ),
        (
            "a new column in a runner case",
            mut(
                2,
                'listing(resultEvidence, [["name", "Vendor"]], "vendors");',
                'listing(resultEvidence, [["name", "Vendor"], ["iban", "Account"]], "vendors");',
            ),
            "UNDECLARED",
        ),
        (
            "a unit read from an undeclared column",
            mut(
                2,
                '"Posted target", String(goal.metric_key)',
                '"Posted target", String(goal.currency)',
            ),
            "UNDECLARED",
        ),
        (
            "a Reading whose shows lost its count tag",
            mut(
                1,
                'shows: ["pos_checks.*", "pos_checks.covers"]',
                'shows: ["pos_checks.covers"]',
            ),
            "UNDECLARED",
        ),
        (
            "staff widened to see money",
            mut(
                0,
                'staff: { sees: ["stock", "receiving", "todays_deliveries"]',
                'staff: { sees: ["stock", "receiving", "todays_deliveries", "money"]',
            ),
            "RESTRICTED",
        ),
        (
            "every goal field retagged as stock (goals would open to staff)",
            [
                re.sub(
                    r'("analytics_goals\.[a-z_*]+"): "money"', r'\1: "stock"', base[0]
                ),
                base[1],
                base[2],
            ],
            "RESTRICTED",
        ),
        (
            "a fallback row that sees more than owner",
            mut(
                0,
                'staff: { sees: ["stock", "receiving", "todays_deliveries"]',
                'staff: { sees: ["stock", "receiving", "todays_deliveries", "gossip"]',
            ),
            "POLICY",
        ),
        (
            "staff given people data again (the calendar would open to them)",
            mut(
                0,
                'staff: { sees: ["stock", "receiving", "todays_deliveries"]',
                'staff: { sees: ["stock", "receiving", "todays_deliveries", "people"]',
            ),
            "RESTRICTED",
        ),
        (
            "the today split undone: the day's deliveries tagged suppliers again",
            mut(
                0,
                '"procurement_orders@due_today.status": "todays_deliveries"',
                '"procurement_orders@due_today.status": "suppliers"',
            ),
            "RESTRICTED",
        ),
        (
            "a read relation whose trace count lost its tag",
            mut(0, '  "restaurant_providers.*": "suppliers",\n', ""),
            "UNTAGGED COUNT",
        ),
        (
            "a view column the runner shows that the view does not declare",
            mut(
                2,
                '[["order_number", "Order"], ["status", "Recorded state"], ["expected_delivery_date", "Stated delivery date"]], "deliveries");',
                '[["order_number", "Order"], ["status", "Recorded state"], ["bottles_total", "Bottles"]], "deliveries");',
            ),
            "UNDECLARED",
        ),
        (
            "a share above the whole allowance",
            mut(
                0,
                "dailyAskBudgetShare: 1 },\n  staff",
                "dailyAskBudgetShare: 2 },\n  staff",
            ),
            "POLICY",
        ),
    ]
    missed = []
    for name, srcs, token in cases:
        try:
            got, _ = check(*srcs, eight)
        except CannotCheck as e:
            got = [f"CANNOT {e}"]
        hit = any(g.startswith(token) for g in got)
        print(f"  {'caught' if hit else 'MISSED'}: {name}")
        if not hit:
            missed.append(name)
    if missed:
        print(f"SELF-TEST FAIL -- {len(missed)} mutation(s) not caught")
        return 1
    print(f"SELF-TEST PASS -- {len(cases)} mutations, all caught")
    return 0


if __name__ == "__main__":
    args = sys.argv[1:]
    if args == ["--self-test"]:
        sys.exit(self_test())
    expect = None
    if args[:1] == ["--expect-restricted"] and len(args) == 2:
        expect = [x for x in args[1].split(",") if x]
    elif args:
        print(
            "usage: check_ask_field_classes.py [--expect-restricted a,b,c | --self-test]"
        )
        sys.exit(2)
    sys.exit(run(expect))
