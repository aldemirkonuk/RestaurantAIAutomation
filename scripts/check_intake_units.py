#!/usr/bin/env python3
"""The intake path admits mass, and its quantities are not integer-only.

WHY THIS GUARD EXISTS
---------------------
A receiver could not record a delivery of flour. Not awkwardly -- at all, and
for two independent reasons stacked on top of each other:

  1. `procurement_document_lines.uom` was CHECK-constrained to
     {bottle, case, keg, pack, split_case, each, liter}. No mass unit exists in
     that set, so a 25 kg sack had NO EXPRESSIBLE UNIT anywhere in the system.
     The same seven-value vocabulary was repeated across FIVE constraints and
     duplicated again in two TypeScript files -- seven copies of one list, which
     is why widening it by hand was never going to stay widened.

  2. `@IsInt()` on the intake quantity DTOs answered 4.5 with a 400 before it
     reached a `numeric(12,3)` column that stores it perfectly well.

Fixing both once is worth little: the failure mode is REGROWTH. A new intake DTO
written next month reaches for `@IsInt()` because every neighbouring field has
it, and a new unit column gets the beverage list pasted into its CHECK because
that is what the file above it says. So this guard makes both impossible to
reintroduce without a red build.

WHAT IT ENFORCES
----------------
  A. ONE VOCABULARY. The unit list must be IDENTICAL in all three places that
     define it:
       * apps/api-gateway/src/procurement/documents/document-types.ts  (UOMS)
       * apps/web/src/lib/units.ts                                     (UOMS)
       * the newest migration that writes an intake unit CHECK constraint
     Drift between them is the defect this guard is named after, and it is
     invisible at runtime until a receiver is standing at a door.

  B. THE VOCABULARY CONTAINS MASS AND VOLUME. A vocabulary that is internally
     consistent and still beverage-only passes rule A perfectly. That is exactly
     the state the system was in, so consistency alone is not the property worth
     checking -- REPRESENTABILITY is. At least one mass unit and one volume unit
     must be present.

  C. NO INTEGER-ONLY VALIDATOR ON AN INTAKE QUANTITY. `@IsInt()` may not decorate
     a field whose name marks it as a quantity, on the DTO files that feed the
     intake tables. Pack sizes, page numbers, capacities and priorities are
     counts and keep their integers -- the rule is about quantities, and the
     exceptions are listed by name with a reason rather than pattern-matched
     loosely.

WHAT IT DOES NOT COVER, STATED RATHER THAN IMPLIED
--------------------------------------------------
  * Whether a stated unit is the CORRECT one. `uom: 'kg'` on a case of wine is
    invisible here; only a test at a real quantity catches that.
  * The ledger side (`inventory_lots`, `inventory_transactions`,
    `restaurant_inventory`). ADR 0070 owns those and deliberately keeps them
    integer. Checking them here would fight a locked decision.
  * DTOs outside the intake path. The rule is right more widely; the sweep that
    would make it true more widely is a different change, and a guard that fails
    on dozens of pre-existing fields gets deleted rather than obeyed.
  * Front-end `step` attributes. They are checked by the unit test in
    apps/web/src/lib/units.ts's consumers, not here -- a Python parse of JSX
    attributes split across lines is exactly the same-line-grep mistake that
    produced the wrong "68 of 69" count in the first place.

EXIT CODES
----------
  0  the vocabulary is one vocabulary, it can express mass, and no intake
     quantity is integer-only
  1  one of those is false -- the message names the file and the fix
  2  CANNOT CHECK: a file this guard reads is missing, unparseable, or contains
     none of the thing it claims to check. Never silently passes.

Exit 2 matters more than it looks. A guard that reports "nothing wrong" because
it found nothing to look at is the fault this whole repo is named after
(`memory/absence-reported-as-health`), and it is the specific way a guard rots:
the file gets renamed, the regex stops matching, and the check goes green
forever.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

GATEWAY_UOMS = REPO / "apps/api-gateway/src/procurement/documents/document-types.ts"
WEB_UOMS = REPO / "apps/web/src/lib/units.ts"
MIGRATIONS = REPO / "supabase/migrations"

# Units that prove the vocabulary can express a physical measurement rather than
# a count of containers. Checked by DIMENSION, not by exact spelling, so a future
# decision to use `mg` instead of `g` does not fail this guard for the wrong
# reason.
MASS_UNITS = {"mg", "g", "kg"}
VOLUME_UNITS = {"ml", "cl", "liter", "litre", "l"}

# DTO files on the intake path -- the ones whose fields become rows in
# procurement_document_lines, procurement_receipt_events, procurement_orders,
# procurement_order_items or recurring_orders.
INTAKE_DTOS = [
    "apps/api-gateway/src/procurement/dto/procurement.dto.ts",
    "apps/api-gateway/src/procurement/dto/recurring-order.dto.ts",
    "apps/api-gateway/src/providers/dto/retroactive-order.dto.ts",
]

# A field is a QUANTITY when its name says so.
#
# The boundary after the word is `$`, `_`, or a capital -- NOT `\b`, which does
# not fire between "quantity" and "Received" (both word characters) and so let
# `quantityReceived` through unnoticed on the first run of this guard.
QUANTITY_NAME = re.compile(r"(?:^|[a-z_])(?:quantity|qty)(?:$|_|[A-Z])", re.IGNORECASE)

# Fields that carry a quantity-ish name but are genuinely counts, each with the
# reason it is not a measurement. Listed by name so that adding a real quantity
# cannot hide behind a pattern.
COUNT_EXCEPTIONS: dict[str, str] = {
    "bottlesPerUnit": "a pack size: how many bottles are in one case. A fractional pack is a data-entry error, and integer is what catches it.",
    "bottles_per_unit": "as bottlesPerUnit, snake_case on the recurring-order DTO.",
    "packSize": "as bottlesPerUnit.",
    "pack_size": "as bottlesPerUnit.",
}

# ---------------------------------------------------------------------------
# DEFERRED, NOT EXEMPT.
#
# These fields SHOULD take @IsIntakeQuantity() and do not yet, for one reason
# that is not a judgement about the field: PR #233 (`fix/verify-receipt-unit-safety`)
# is rewriting every one of them RIGHT NOW, renaming them to declare their unit
# (`invoiceQuantity` -> `invoiceQuantityInInvoiceUom` and siblings). Editing the
# same lines from two branches produces a conflict on all eight and buys nothing:
# whichever lands second rewrites the other's work anyway.
#
# WHY THIS LIST CANNOT QUIETLY BECOME PERMANENT
#
# An exception list with "temporary" in a comment is permanent. This one expires
# mechanically: the guard FAILS if a deferred field is no longer found carrying
# @IsInt(). That is precisely what happens when #233 lands and renames them --
# the old names stop matching, this list goes stale, and the build goes red until
# someone applies @IsIntakeQuantity() to the NEW names and empties this dict.
#
# So the deferral survives exactly as long as the collision does.
# ---------------------------------------------------------------------------
DEFERRED_PENDING_PR_233: dict[str, str] = {
    "invoiceQuantity": "renamed by PR #233 to invoiceQuantityInInvoiceUom",
    "shippedQuantity": "renamed by PR #233 to shippedQuantityInShippedUom",
    "freeGoodsQuantity": "renamed by PR #233",
    "acceptedQuantity": "renamed by PR #233",
    "rejectedQuantity": "renamed by PR #233",
    "prefilledInvoiceQuantity": "renamed by PR #233",
    "prefilledShippedQuantity": "renamed by PR #233",
    "prefilledFreeGoodsQuantity": "renamed by PR #233",
    "quantityReceived": "renamed by PR #233 to quantityReceivedInOrderUom",
}

# Decorators that pin a field to whole numbers.
INT_DECORATOR = re.compile(r"@IsInt\s*\(")


class CannotCheck(Exception):
    """Raised when the guard cannot establish the property either way."""


def rel(path: Path) -> str:
    """Repo-relative name for a message, tolerating a path outside the repo.

    `--self-test` feeds this temp files deliberately, and a guard that crashes
    while proving it still works is worse than one that never proved it.
    """
    try:
        return str(path.relative_to(REPO))
    except ValueError:
        return str(path)


def read(path: Path) -> str:
    if not path.exists():
        raise CannotCheck(f"{rel(path)} does not exist")
    text = path.read_text(encoding="utf-8")
    if not text.strip():
        raise CannotCheck(f"{rel(path)} is empty")
    return text


def parse_ts_uoms(path: Path) -> list[str]:
    """Pull the `UOMS = [...] as const` list out of a TypeScript file."""
    text = read(path)
    m = re.search(
        r"export\s+const\s+UOMS\s*=\s*\[(?P<body>.*?)\]\s*as\s+const",
        text,
        re.DOTALL,
    )
    if m:
        units = re.findall(r"['\"]([a-z_]+)['\"]", m.group("body"))
        if units:
            return units

    # The web copy composes UOMS by spreading two named lists
    # (`[...COUNT_UOMS, ...MEASURED_UOMS]`), so the direct match above finds a
    # list with no string literals in it. Fall through to the parts rather than
    # treating that as unreadable -- but still refuse if neither shape yields
    # anything, because an empty vocabulary must never read as a passing check.
    parts: list[str] = []
    for name in ("COUNT_UOMS", "MEASURED_UOMS"):
        sub = re.search(
            rf"export\s+const\s+{name}\s*=\s*\[(?P<body>.*?)\]\s*as\s+const",
            text,
            re.DOTALL,
        )
        if sub:
            parts.extend(re.findall(r"['\"]([a-z_]+)['\"]", sub.group("body")))
    if parts:
        return parts

    raise CannotCheck(
        f"{rel(path)} declares no readable unit list "
        "(neither `UOMS = [...]` with literals nor COUNT_UOMS/MEASURED_UOMS)"
    )


def parse_migration_uoms() -> tuple[list[str], str]:
    """The unit vocabulary from the newest migration that constrains one.

    Returns (units, filename). Reads the LATEST such migration because a CHECK is
    replaced wholesale by each migration that touches it, so the newest one is
    the shape the database actually ends up in.
    """
    if not MIGRATIONS.is_dir():
        raise CannotCheck("supabase/migrations is not a directory")

    pattern = re.compile(
        r"(?:uom|unit_type|counted_uom)::text\s*=\s*any\s*\(\s*array\s*\[(?P<body>.*?)\]",
        re.DOTALL | re.IGNORECASE,
    )
    newest: tuple[str, list[str]] | None = None
    for path in sorted(MIGRATIONS.glob("*.sql")):
        text = path.read_text(encoding="utf-8", errors="replace")
        found = pattern.findall(text)
        if not found:
            continue
        units = re.findall(r"'([a-z_]+)'", found[-1])
        if units:
            newest = (path.name, units)

    if newest is None:
        raise CannotCheck(
            "no migration declares a uom/unit_type CHECK constraint this guard can read -- "
            "either the pattern changed or the constraints were dropped"
        )
    return newest[1], newest[0]


def field_names_with_int(path: Path) -> list[tuple[int, str]]:
    """(line, fieldName) for every `@IsInt()`-decorated property in the file."""
    text = read(path)
    lines = text.splitlines()
    if not INT_DECORATOR.search(text) and "@IsIntakeQuantity" not in text:
        raise CannotCheck(
            f"{rel(path)} contains neither @IsInt nor @IsIntakeQuantity -- "
            "this guard is reading the wrong file, or the DTO shape changed"
        )

    hits: list[tuple[int, str]] = []
    for i, line in enumerate(lines):
        if not INT_DECORATOR.search(line):
            continue
        # Walk forward to the first property declaration.
        for j in range(i, min(i + 12, len(lines))):
            prop = re.match(r"\s*([A-Za-z_][A-Za-z0-9_]*)\s*[?!]?\s*:", lines[j])
            if prop and not lines[j].lstrip().startswith("@"):
                hits.append((j + 1, prop.group(1)))
                break
    return hits


def main() -> int:
    failures: list[str] = []

    # ---- A. one vocabulary -------------------------------------------------
    gateway = parse_ts_uoms(GATEWAY_UOMS)
    web = parse_ts_uoms(WEB_UOMS)
    migration, migration_name = parse_migration_uoms()

    sets = {
        "apps/api-gateway/.../document-types.ts": sorted(set(gateway)),
        "apps/web/src/lib/units.ts": sorted(set(web)),
        f"supabase/migrations/{migration_name}": sorted(set(migration)),
    }
    distinct = {tuple(v) for v in sets.values()}
    if len(distinct) != 1:
        detail = "\n".join(f"    {k}: {', '.join(v)}" for k, v in sets.items())
        failures.append(
            "The intake unit vocabulary differs between its definitions:\n"
            f"{detail}\n"
            "    Fix: make all three identical. A unit that exists in the code but not the\n"
            "    CHECK is a 23514 in production; one in the CHECK but not the code is a unit\n"
            "    no screen can offer."
        )

    # ---- B. it can express a measurement -----------------------------------
    vocabulary = set(gateway)
    if not vocabulary & MASS_UNITS:
        failures.append(
            f"The intake unit vocabulary has NO MASS UNIT: {', '.join(sorted(vocabulary))}.\n"
            "    A delivery of flour has no expressible unit, which is the defect ADR 0071\n"
            "    repaired. Add g/kg to UOMS, to apps/web/src/lib/units.ts, and to the CHECK\n"
            "    constraint in a new migration."
        )
    if not vocabulary & VOLUME_UNITS:
        failures.append(
            f"The intake unit vocabulary has NO VOLUME UNIT: {', '.join(sorted(vocabulary))}.\n"
            "    Add ml/liter in all three places."
        )

    # ---- C. no integer-only intake quantity --------------------------------
    seen_deferred: set[str] = set()
    for rel in INTAKE_DTOS:
        path = REPO / rel
        for line_no, field in field_names_with_int(path):
            if not QUANTITY_NAME.search(field):
                continue
            if field in COUNT_EXCEPTIONS:
                continue
            if field in DEFERRED_PENDING_PR_233:
                seen_deferred.add(field)
                continue
            failures.append(
                f"{rel}:{line_no} -- `{field}` is an intake quantity pinned to whole numbers by @IsInt().\n"
                "    4.5 kg of flour is refused with a 400 before it reaches a numeric(12,3)\n"
                "    column that stores it exactly. Use @IsIntakeQuantity() instead, which\n"
                "    allows three decimal places and leaves the whole-number rule for count\n"
                "    units to resolveOrderUnits, where the unit is actually known.\n"
                f"    If `{field}` really is a count, add it to COUNT_EXCEPTIONS in this file\n"
                "    with the reason."
            )

    # ---- C2. the deferral expires on its own -------------------------------
    stale = sorted(set(DEFERRED_PENDING_PR_233) - seen_deferred)
    if stale:
        failures.append(
            "These fields are listed as DEFERRED_PENDING_PR_233 but no longer carry @IsInt():\n"
            + "".join(f"      {f} -- {DEFERRED_PENDING_PR_233[f]}\n" for f in stale)
            + "    That means the collision this deferral was waiting on has resolved. Apply\n"
            "    @IsIntakeQuantity() to whatever those fields are now called and delete them\n"
            "    from DEFERRED_PENDING_PR_233. A deferral that outlives its reason is just an\n"
            "    exemption nobody chose."
        )

    if failures:
        print("Intake unit check FAILED.\n", file=sys.stderr)
        for f in failures:
            print(f"  - {f}\n", file=sys.stderr)
        return 1

    print(
        f"Intake units OK: {len(vocabulary)} units, consistent across "
        f"document-types.ts, apps/web/src/lib/units.ts and {migration_name}; "
        f"mass and volume both expressible; no @IsInt() on an intake quantity."
    )
    if seen_deferred:
        print(
            f"  ({len(seen_deferred)} field(s) deferred pending PR #233: "
            f"{', '.join(sorted(seen_deferred))}. This is DEBT, not a pass -- the guard "
            "fails once those fields are renamed.)"
        )
    return 0


def self_test() -> int:
    """Prove the guard still fires on the shapes it exists to catch.

    Runs the three rules against reconstructed PRE-FIX inputs. Without this, a
    refactor that quietly stopped matching anything would leave the guard green
    forever and nothing would notice -- which is the exact failure the guard is
    written against, turned on the guard itself.
    """
    import tempfile

    checks: list[tuple[str, bool]] = []

    # B: a beverage-only vocabulary must be caught.
    beverage_only = {"bottle", "case", "keg", "pack", "split_case", "each", "liter"}
    checks.append(("beverage-only vocabulary has no mass unit", not (beverage_only & MASS_UNITS)))
    checks.append(
        ("the fixed vocabulary DOES have one", bool(set(parse_ts_uoms(GATEWAY_UOMS)) & MASS_UNITS))
    )

    # C: `@IsInt() quantity` must be recognised as an intake quantity.
    for name in ("quantity", "quantityReceived", "invoiceQuantity", "counted_qty"):
        checks.append(
            (f"`{name}` reads as a quantity", bool(QUANTITY_NAME.search(name)))
        )
    for name in ("bottlesPerUnit", "packSize", "page", "limit", "priorityLevel"):
        checks.append(
            (f"`{name}` does NOT read as a quantity", not QUANTITY_NAME.search(name))
        )

    # The @IsInt extractor must actually find a decorated field.
    with tempfile.TemporaryDirectory() as tmp:
        sample = Path(tmp) / "sample.dto.ts"
        sample.write_text(
            "export class D {\n"
            "  @ApiProperty()\n"
            "  @IsInt()\n"
            "  @Min(1)\n"
            "  quantity: number;\n"
            "}\n",
            encoding="utf-8",
        )
        found = [f for _, f in field_names_with_int(sample)]
        checks.append(("the @IsInt extractor finds a decorated quantity", found == ["quantity"]))

    # CANNOT-CHECK must raise rather than return an empty pass.
    with tempfile.TemporaryDirectory() as tmp:
        empty = Path(tmp) / "empty.ts"
        empty.write_text("// no units here\n", encoding="utf-8")
        try:
            parse_ts_uoms(empty)
            checks.append(("a file with no unit list raises CannotCheck", False))
        except CannotCheck:
            checks.append(("a file with no unit list raises CannotCheck", True))

    failed = [name for name, passed in checks if not passed]
    for name, passed in checks:
        print(f"  {'ok  ' if passed else 'FAIL'}  {name}")
    if failed:
        print(
            f"\nSelf-test FAILED: {len(failed)} check(s). The guard no longer detects what it "
            "claims to, so a green run from it means nothing.",
            file=sys.stderr,
        )
        return 1
    print(f"\nSelf-test passed: {len(checks)} checks.")
    return 0


if __name__ == "__main__":
    try:
        if "--self-test" in sys.argv:
            sys.exit(self_test())
        sys.exit(main())
    except CannotCheck as exc:
        print(
            f"Intake unit check CANNOT CHECK: {exc}.\n"
            "  Exiting 2 rather than 0. A check that cannot see the thing it checks has not\n"
            "  passed -- it has failed to run, and reporting that as health is the fault this\n"
            "  guard exists to prevent.",
            file=sys.stderr,
        )
        sys.exit(2)
