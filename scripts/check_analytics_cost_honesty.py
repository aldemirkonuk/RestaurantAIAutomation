#!/usr/bin/env python3
"""
Guard: analytics never invents what a bottle cost, and never mislabels one.

    ./scripts/check_analytics_cost_honesty.py
    ./scripts/check_analytics_cost_honesty.py --self-test

WHY THIS IS A GUARD AND NOT A CONVENTION
----------------------------------------
Two files resolved unit cost with the same inline expression, copied from one
to the other:

    lot?.has_invoice_cost && lot?.wac
      ? lot.wac
      : Number(i.last_purchase_price) || (unitPrice ? unitPrice * 0.6 : 0);

The first branch is measured. The third was invented: `0.6` appears in no ADR,
no comment and no doc anywhere in the repo. And it was not the rare branch —
`restaurant_inventory.last_purchase_price` has no write site in this codebase
(every occurrence is a read) and is NULL on all 72 production rows, while
`inventory_lots` holds 2. The measured path covered ~2 rows; the invented one
covered ~70.

Then `getFinancialSummary` labelled the result

    inventoryValue: "on-hand qty × WAC (lot rollup)"

and `getMenuEngineering` labelled it

    margin: "unit_price − WAC (lot rollup)"

Those two strings are the reason this is a guard. A bare number can be spotted
in review. A `basis` label that names a source the value did not come from
*survives* review — it is the thing a reviewer checks the number against. ADR
0051 (locked 2026-09-01) is explicit: a surface shows live data or says it does
not know, and a confident wrong label is the worst form of the defect.

The expression existed twice because the second copy was written from the
first. A third copy is one `loadInventoryWith…` away, and nothing in the diff
would look wrong. That is precisely the shape a command can check.

THE TWO RULES
-------------
(A) NO MAGIC-NUMBER COST FALLBACK. In the analytics tree, a statement that
    produces or consumes a unit cost may not scale it by a bare numeric
    literal, and may not `||`/`??` a cost-column read into one. Cost comes from
    `resolveUnitCost()` in analytics/inventory-cost.ts, whose third answer is
    `null`. Relatedly, a file that derives a unit cost from the raw columns
    without going through that function has re-created the inline expression by
    definition, and fails too.

(B) NO BASIS STRING CLAIMS A SOURCE THE CODE DOES NOT USE. A `basis` entry
    whose key is about cost, value or margin may not be a plain string literal
    naming a cost source ("WAC", "lot rollup", "invoice", "last_purchase_price").
    Such an entry must be built at runtime from the rows it actually covered —
    `costBasisSentence(...)` or `COST_BASIS_LABEL[...]` — so the label cannot
    drift away from the number the way it already did twice.

WHAT THIS GUARD DOES NOT CLAIM
------------------------------
It does not prove the numbers are right. It proves that (1) no cost is
manufactured from a literal on this path and (2) no cost-shaped `basis` string
asserts a provenance without deriving it. Whether `resolveUnitCost`'s own
precedence is the right one is OPEN-DECISIONS OD-100 — a founder decision, not
a check. A green run here says nothing about that.

Nor does it read `apps/web`. A UI that renders `null` as "$0" is a separate
defect in a separate tree, and conflating the two would let a green run here be
read as a stronger claim than it is.

NEVER VACUOUS
-------------
Exit 0 pass, 1 violation, **2 cannot check**. Exit 2 blocks in CI exactly like
exit 1. A guard that quietly passes because its anchor moved is worse than no
guard: it is a green check mark over an unexamined surface, which is how the
`0.6` survived long enough to reach 70 of 72 production rows.
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

SCAN_ROOT = Path("apps/api-gateway/src/analytics")
COST_MODULE = SCAN_ROOT / "inventory-cost.ts"

# The shared module is this guard's anchor. If it loses any of these, the guard
# no longer knows where the single decision point is: exit 2, not a pass.
REQUIRED_EXPORTS = (
    "resolveUnitCost",
    "summarizeCostBasis",
    "costBasisSentence",
    "COST_BASIS_LABEL",
)

# Identifiers that ARE a unit cost, or a value derived directly from one.
COST_SINKS = (
    "unitCost",
    "unit_cost",
    "costPerBottle",
    "marginPerBottle",
    "inventoryValue",
    "holdingPerUnit",
)

# The raw columns a cost can be read from.
COST_SOURCES = ("last_purchase_price", "has_invoice_cost", "wac")

# Scaling a cost-bearing statement by a bare literal, or defaulting a cost
# column read into one. `* 1` is identity and is not a fabrication.
MAGIC_SCALE = re.compile(r"[*/]\s*(?!1\s*[;,)\]])\d+(?:\.\d+)?\b")
# The span between the cost read and the `||` may not cross a `,` or `:` —
# those end the expression, and without the restriction `wac, x, y: z || 0`
# matches an unrelated default three fields later.
MAGIC_DEFAULT = re.compile(
    r"(?:last_purchase_price|\bwac\b)[^;,:]{0,60}?(?:\|\||\?\?)\s*\d"
)

# `basis` keys whose value is a claim about where a cost came from.
COST_BASIS_KEY = re.compile(r"(cost|margin|inventoryvalue|wac|valuation)", re.I)

# Tokens that assert a provenance. A plain string containing one of these,
# under a cost-shaped key, is an unconditional source claim.
SOURCE_CLAIM = re.compile(
    r"(\bWAC\b|lot[ _-]?rollup|invoice|last_purchase_price|unit_cost|inventory_lots?)",
    re.I,
)

# Runtime-derived basis builders. A cost-shaped basis entry must use one.
DERIVED_BASIS = ("costBasisSentence(", "COST_BASIS_LABEL[")


class CannotCheck(Exception):
    """The guard's anchor is gone. Exit 2 — never a pass."""


# ---------------------------------------------------------------------------
# TypeScript scrubbing
# ---------------------------------------------------------------------------


def scrub(src: str) -> tuple[str, str]:
    """
    Return (code_only, strings_kept), both the same length as `src` so offsets
    and line numbers still map.

    `code_only`  — comments and string/template *content* blanked, but `${…}`
                   interiors inside templates preserved (they are real code).
    `strings_kept` — comments blanked, string content preserved.

    Hand-rolled because the alternative is a TypeScript parser, and a guard
    that needs `npm install` to run is a guard that gets skipped.
    """
    code = list(src)
    keep = list(src)
    i, n = 0, len(src)
    # None | '"' | "'" | '`' | '//' | '/*'
    state: str | None = None

    def blank(idx: int, both: bool) -> None:
        if src[idx] != "\n":
            code[idx] = " "
            if both:
                keep[idx] = " "

    while i < n:
        ch = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if state is None:
            if ch == "/" and nxt == "/":
                state = "//"
                blank(i, True)
                blank(i + 1, True)
                i += 2
                continue
            if ch == "/" and nxt == "*":
                state = "/*"
                blank(i, True)
                blank(i + 1, True)
                i += 2
                continue
            if ch in "\"'`":
                state = ch
                i += 1
                continue
            i += 1
            continue
        if state == "//":
            if ch == "\n":
                state = None
            else:
                blank(i, True)
            i += 1
            continue
        if state == "/*":
            if ch == "*" and nxt == "/":
                blank(i, True)
                blank(i + 1, True)
                state = None
                i += 2
                continue
            blank(i, True)
            i += 1
            continue
        # inside a string or template literal
        if ch == "\\":
            blank(i, False)
            if i + 1 < n:
                blank(i + 1, False)
            i += 2
            continue
        if state == "`" and ch == "$" and nxt == "{":
            # Leave the interpolation interior alone in BOTH outputs.
            depth = 1
            j = i + 2
            while j < n and depth > 0:
                if src[j] == "{":
                    depth += 1
                elif src[j] == "}":
                    depth -= 1
                j += 1
            i = j
            continue
        if ch == state:
            state = None
            i += 1
            continue
        blank(i, False)
        i += 1

    if state is not None:
        raise CannotCheck(
            f"unterminated {state!r} while scrubbing — the scrubber cannot "
            "read this file, so it cannot check it"
        )
    return "".join(code), "".join(keep)


def statements(code_only: str) -> list[tuple[int, str]]:
    """Split scrubbed code into `;`-terminated statements with a start line."""
    out: list[tuple[int, str]] = []
    line = 1
    buf: list[str] = []
    start = 1
    for ch in code_only:
        if ch == "\n":
            line += 1
        if ch == ";":
            text = "".join(buf).strip()
            if text:
                out.append((start, re.sub(r"\s+", " ", text)))
            buf = []
            start = line
            continue
        if not buf and ch.isspace():
            start = line
            continue
        buf.append(ch)
    tail = "".join(buf).strip()
    if tail:
        out.append((start, re.sub(r"\s+", " ", tail)))
    return out


# ---------------------------------------------------------------------------
# Findings
# ---------------------------------------------------------------------------


@dataclass
class Report:
    files: list[str] = field(default_factory=list)
    magic: list[str] = field(default_factory=list)
    unrouted: list[str] = field(default_factory=list)
    lying_basis: list[str] = field(default_factory=list)
    basis_blocks: int = 0
    cost_basis_entries: int = 0
    derived_basis_entries: int = 0


def ts_files(root: Path) -> list[Path]:
    return sorted(
        p
        for p in root.rglob("*.ts")
        if not p.name.endswith(".spec.ts") and not p.name.endswith(".d.ts")
    )


def check_magic(rel: str, code_only: str, report: Report) -> None:
    for line, stmt in statements(code_only):
        if not any(tok in stmt for tok in COST_SINKS + COST_SOURCES):
            continue
        hit = MAGIC_SCALE.search(stmt) or MAGIC_DEFAULT.search(stmt)
        if hit:
            snippet = stmt if len(stmt) <= 160 else stmt[:157] + "..."
            report.magic.append(f"{rel}:{line}  [{hit.group(0).strip()}]  {snippet}")


def check_routing(rel: str, code_only: str, report: Report) -> None:
    """A file that derives a unit cost from raw columns must use the resolver."""
    if rel == str(COST_MODULE):
        return
    reads_source = any(
        tok in code_only for tok in ("last_purchase_price", "has_invoice_cost")
    )
    assigns_cost = re.search(
        r"\b(?:unitCost|unit_cost|costPerBottle|marginPerBottle)\b\s*[:=][^=]",
        code_only,
    )
    if reads_source and assigns_cost and "resolveUnitCost" not in code_only:
        report.unrouted.append(
            f"{rel}  derives a unit cost from the raw columns without resolveUnitCost()"
        )


def basis_entries(strings_kept: str) -> list[tuple[int, str, str]]:
    """Yield (line, key, raw_value) for every entry of every `basis: {…}`."""
    out: list[tuple[int, str, str]] = []
    for m in re.finditer(r"\bbasis\s*:\s*\{", strings_kept):
        depth = 1
        j = m.end()
        while j < len(strings_kept) and depth > 0:
            if strings_kept[j] == "{":
                depth += 1
            elif strings_kept[j] == "}":
                depth -= 1
            j += 1
        body = strings_kept[m.end() : j - 1]
        base_line = strings_kept.count("\n", 0, m.end()) + 1
        # Entries are `key: <value>` up to a comma at depth 0.
        depth = 0
        cur: list[str] = []
        chunks: list[tuple[int, str]] = []
        chunk_line = base_line
        line = base_line
        for ch in body:
            if ch == "\n":
                line += 1
            if ch in "{[(":
                depth += 1
            elif ch in "}])":
                depth -= 1
            if ch == "," and depth == 0:
                text = "".join(cur).strip()
                if text:
                    chunks.append((chunk_line, text))
                cur = []
                chunk_line = line
                continue
            if not cur and ch.isspace():
                chunk_line = line
                continue
            cur.append(ch)
        tail = "".join(cur).strip()
        if tail:
            chunks.append((chunk_line, tail))
        for cline, text in chunks:
            key, sep, value = text.partition(":")
            if not sep:
                continue
            out.append((cline, key.strip(), value.strip()))
    return out


def check_basis(rel: str, strings_kept: str, report: Report) -> None:
    report.basis_blocks += len(re.findall(r"\bbasis\s*:\s*\{", strings_kept))
    for line, key, value in basis_entries(strings_kept):
        if not COST_BASIS_KEY.search(key):
            continue
        report.cost_basis_entries += 1
        if any(tok in value for tok in DERIVED_BASIS):
            report.derived_basis_entries += 1
            continue
        claim = SOURCE_CLAIM.search(value)
        if claim:
            report.lying_basis.append(
                f"{rel}:{line}  {key}: {value[:120]}"
                f"\n      names {claim.group(0)!r} unconditionally, without deriving it"
            )


def run(root: Path) -> Report:
    scan = root / SCAN_ROOT
    if not scan.is_dir():
        raise CannotCheck(f"{SCAN_ROOT} does not exist — the analytics tree moved")

    module = root / COST_MODULE
    if not module.is_file():
        raise CannotCheck(
            f"{COST_MODULE} is gone — this guard's whole claim is that cost is "
            "resolved in exactly one place, and it can no longer find that place"
        )
    module_src = module.read_text(encoding="utf-8")
    missing = [e for e in REQUIRED_EXPORTS if e not in module_src]
    if missing:
        raise CannotCheck(
            f"{COST_MODULE} no longer exports {', '.join(missing)} — the guard's "
            "anchor was renamed or gutted; repoint it rather than deleting it"
        )

    files = ts_files(scan)
    if not files:
        raise CannotCheck(f"no .ts files under {SCAN_ROOT} — nothing was scanned")

    report = Report()
    for path in files:
        rel = str(path.relative_to(root))
        report.files.append(rel)
        src = path.read_text(encoding="utf-8")
        try:
            code_only, strings_kept = scrub(src)
        except CannotCheck as exc:
            raise CannotCheck(f"{rel}: {exc}") from exc
        check_magic(rel, code_only, report)
        check_routing(rel, code_only, report)
        check_basis(rel, strings_kept, report)

    if report.basis_blocks == 0:
        raise CannotCheck(
            "no `basis: {…}` block found anywhere in the analytics tree. Either "
            "the honesty-label convention was dropped or the pattern rotted; "
            "both mean rule (B) checked nothing"
        )
    if report.cost_basis_entries == 0:
        raise CannotCheck(
            "found `basis` blocks but no cost-shaped entry in any of them. The "
            "two endpoints that lied both had one, so rule (B) matching nothing "
            "means the key names changed, not that the problem went away"
        )
    # NB the "is any label actually derived?" vacuity check lives in
    # `verdict()`, AFTER violations — a tree with hardcoded cost labels must
    # report those as the failure (exit 1), not hide them behind an exit 2.
    return report


VACUOUS_BASIS = (
    "no cost-shaped `basis` entry is built from costBasisSentence() or "
    "COST_BASIS_LABEL[]. Every cost label is hand-written, so rule (B) has no "
    "derived label to compare against and cannot tell an audited one from an "
    "invented one"
)


def verdict(report: Report) -> str:
    """`magic` | `unrouted` | `lying-basis` | `cannot-check` | `clean`."""
    if report.magic:
        return "magic"
    if report.unrouted:
        return "unrouted"
    if report.lying_basis:
        return "lying-basis"
    if report.derived_basis_entries == 0:
        return "cannot-check"
    return "clean"


# ---------------------------------------------------------------------------
# Self-test — the guard must fire on the shape it exists to catch
# ---------------------------------------------------------------------------

PREFIX_COST = """\
import { Injectable } from "@nestjs/common";
@Injectable()
export class Fixture {
  private async loadInventory(restaurantId: string) {
    return inventory.map((i: any) => {
      const lot = rollup.get(i.id);
      const unitPrice = Number(i.menu_price_current) || 0;
      const wac =
        lot?.has_invoice_cost && lot?.wac
          ? lot.wac
          : Number(i.last_purchase_price) || (unitPrice ? unitPrice * 0.6 : 0);
      return { unitCost: wac, unitPrice };
    });
  }
}
"""

PREFIX_BASIS = """\
export class Fixture2 {
  async getFinancialSummary() {
    return {
      basis: {
        cogs: "delivered procurement_orders (trailing 365d)",
        inventoryValue: "on-hand qty × WAC (lot rollup)",
      },
    };
  }
}
"""

CLEAN_FIXTURE = """\
import { costBasisSentence, resolveUnitCost } from "./inventory-cost";
export class Clean {
  async load() {
    const { unitCost, costBasis } = resolveUnitCost(i, lot);
    const holdingPerUnit = unitCost == null ? null : unitCost * this.HOLDING_RATE;
    const inventoryValue = unitCost == null ? null : qty * unitCost;
    return {
      basis: {
        // Historical note: this used to read "on-hand qty × WAC (lot rollup)".
        inventoryValue: `on-hand qty × unit cost — ${costBasisSentence(cov)}`,
      },
      inventoryValue,
      holdingPerUnit,
      costBasis,
    };
  }
}
"""


def _scaffold(tmp: Path) -> Path:
    scan = tmp / SCAN_ROOT
    scan.mkdir(parents=True)
    shutil.copyfile(REPO_ROOT / COST_MODULE, tmp / COST_MODULE)
    return scan


def self_test() -> int:
    failures: list[str] = []

    def case(name: str, write, expect: str) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            scan = _scaffold(tmp)
            write(tmp, scan)
            try:
                rep = run(tmp)
            except CannotCheck as exc:
                got = "cannot-check"
                detail = str(exc)
            else:
                got = verdict(rep)
                detail = "; ".join(rep.magic + rep.unrouted + rep.lying_basis)
                if got == "cannot-check":
                    detail = VACUOUS_BASIS
            ok = got == expect
            print(
                f"   {'ok  ' if ok else 'FAIL'}  {name}: expected {expect}, got {got}"
            )
            if detail and (not ok or got != "clean"):
                print(f"           {detail.splitlines()[0][:150]}")
            if not ok:
                failures.append(name)

    print("== SELF-TEST — the guard must fire on the pre-fix shapes\n")

    # Every case ships the clean file too, so rule (B) always has a derived
    # basis to compare against — otherwise a violation case would exit 2 for
    # the wrong reason and look like it fired when it had not.
    def with_clean(name: str, body: str, expect: str) -> None:
        case(
            name,
            lambda tmp, scan: (
                (scan / "subject.service.ts").write_text(body),
                (scan / "clean.service.ts").write_text(CLEAN_FIXTURE),
            ),
            expect,
        )

    with_clean("the exact pre-fix cost expression", PREFIX_COST, "magic")
    with_clean("the pre-fix basis string", PREFIX_BASIS, "lying-basis")
    with_clean(
        "an inline cost derivation that skips resolveUnitCost",
        "export const x = () => {\n"
        "  const unitCost = row.last_purchase_price ?? lotWac;\n"
        "  return unitCost;\n"
        "};\n",
        "unrouted",
    )
    with_clean("the fixed shape passes", "export const y = 1;\n", "clean")
    with_clean(
        "a mention of 0.6 in a comment is not a violation",
        "// The third branch used to be `unitPrice * 0.6` on unitCost.\n"
        '/* inventoryValue: "on-hand qty × WAC (lot rollup)" was the old label. */\n'
        "export const z = 1;\n",
        "clean",
    )
    case(
        "the anchor module going missing is CANNOT CHECK, not a pass",
        lambda tmp, scan: (
            (tmp / COST_MODULE).unlink(),
            (scan / "f.service.ts").write_text(CLEAN_FIXTURE),
        ),
        "cannot-check",
    )
    case(
        "gutting resolveUnitCost out of the anchor is CANNOT CHECK",
        lambda tmp, scan: (
            (tmp / COST_MODULE).write_text("export const nothing = 1;\n"),
            (scan / "g.service.ts").write_text(CLEAN_FIXTURE),
        ),
        "cannot-check",
    )
    case(
        "a basis that stopped deriving its cost label is CANNOT CHECK",
        lambda tmp, scan: (
            (scan / "i.service.ts").write_text(
                'export const k = { basis: { velocity: "units/day", '
                'inventoryValue: "on-hand qty times unit cost" } };\n'
            ),
        ),
        "cannot-check",
    )
    case(
        "an analytics tree with no basis block at all is CANNOT CHECK",
        lambda tmp, scan: (
            (scan / "h.service.ts").write_text("export const x = 1;\n"),
        ),
        "cannot-check",
    )

    print()
    if failures:
        print(f"SELF-TEST FAILED — {len(failures)} case(s): {', '.join(failures)}")
        print(
            "   A guard that cannot demonstrate it fires is a green check mark\n"
            "   over an unexamined surface. Fix the guard before trusting a pass."
        )
        return 1
    print("SELF-TEST PASSED — the guard fires on every pre-fix shape, stays quiet")
    print("   on the fixed one, and reports cannot-check rather than passing when")
    print("   its anchor is gone.")
    return 0


# ---------------------------------------------------------------------------


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test()

    def cannot_check(reason: str) -> int:
        print("CANNOT CHECK — this guard could not verify what it claims to.")
        print(f"   {reason}")
        print(
            "\n   Exit 2 blocks exactly like a violation, on purpose. A guard that\n"
            "   passes because its anchor moved is worse than no guard: the 0.6\n"
            "   fabrication reached 70 of 72 production rows under a green CI."
        )
        return 2

    try:
        report = run(REPO_ROOT)
    except CannotCheck as exc:
        return cannot_check(str(exc))

    if report.magic:
        print(f"== MAGIC-NUMBER COST ({len(report.magic)})")
        for line in report.magic:
            print(f"   {line}")
    if report.unrouted:
        print(f"\n== COST DERIVED OUTSIDE THE RESOLVER ({len(report.unrouted)})")
        for line in report.unrouted:
            print(f"   {line}")
    if report.lying_basis:
        print(
            f"\n== BASIS CLAIMS A SOURCE IT DOES NOT DERIVE ({len(report.lying_basis)})"
        )
        for line in report.lying_basis:
            print(f"   {line}")

    if report.magic or report.unrouted or report.lying_basis:
        print(
            "\nFAIL — analytics is stating a cost it did not measure, or labelling\n"
            "   one it did not use.\n"
            "\n"
            "   ADR 0051: a surface shows live data or says it does not know.\n"
            "   Unknown is null, never a fabricated number and never zero.\n"
            "\n"
            "   MAGIC-NUMBER COST: delete the literal. If there is no invoiced\n"
            "   cost and no recorded purchase price, the cost is unknown — return\n"
            f"   null from {COST_MODULE}\n"
            "   and let the caller propagate it. Do not substitute another guess;\n"
            "   `0.6` was a guess and it valued 70 of 72 production rows.\n"
            "\n"
            "   OUTSIDE THE RESOLVER: the inline expression existed twice because\n"
            "   the second copy was written from the first. Call resolveUnitCost()\n"
            "   instead of writing a third.\n"
            "\n"
            "   LYING BASIS: build the label from the rows it covered —\n"
            "   costBasisSentence(coverage) or COST_BASIS_LABEL[row.costBasis].\n"
            "   A hardcoded 'WAC (lot rollup)' is the exact string that made the\n"
            "   fabricated number look audited.\n"
            "\n"
            "   Which price SHOULD value inventory is OPEN-DECISIONS OD-100 and is\n"
            "   the founder's call. This guard is about not answering it silently."
        )
        return 1

    if report.derived_basis_entries == 0:
        return cannot_check(VACUOUS_BASIS)

    print(
        f"PASS — {len(report.files)} analytics file(s): no cost is scaled from a\n"
        f"   bare literal, every unit cost routes through resolveUnitCost(), and\n"
        f"   all {report.cost_basis_entries} cost-shaped `basis` entrie(s) across\n"
        f"   {report.basis_blocks} basis block(s) either derive their label from\n"
        f"   the rows they covered ({report.derived_basis_entries}) or make no\n"
        "   source claim at all."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
