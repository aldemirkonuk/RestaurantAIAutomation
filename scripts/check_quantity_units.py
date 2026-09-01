#!/usr/bin/env python3
"""A quantity crossing the client/server boundary must declare its unit.

WHY THIS GUARD EXISTS
---------------------
`DoorReceiptDto.rejectedQty` had no unit anywhere — not in the field name, not
in its type, not in the column it was written to, not in a sibling field. The
door sent it in BOXES alongside `countedQty` + `countedUom`; the gateway
converted `countedQty` to bottles through `toBottles(uom, packSize)` and then
computed `countedBottles - rejectedQty`, subtracting boxes from bottles.

  * three refused boxes at pack 12 booked 33 bottles of LIVE STOCK for wine
    that was turned away at the door and never entered the building;
  * one broken box out of fourteen booked 167 instead of 156;
  * the event row stored `counted_qty_bottles` (bottles) beside `rejected_qty`
    (boxes) with nothing recording that they disagreed.

It survived because the only gateway test covering that path passed
`countedUom: "bottle"`, where the derived pack size is 1 and `toBottles` is the
identity — so the converted and unconverted expressions are the same number.
The test did not fail because it COULD not fail.

The instance is one field. The CLASS is "a quantity crossed a serialization
boundary with its unit stated only in a comment", and a comment is not carried
by JSON. So the rule this guard enforces is:

  every `*Qty*` / `*Quantity*` field on a procurement or receiving DTO must
  DECLARE its unit — in its own name, or in a declared sibling field on the
  same DTO — or be listed as a known exception with a reason.

WHAT THIS COVERS, AND WHAT IT HONESTLY DOES NOT
-----------------------------------------------
COVERS:
  * DTO classes in `apps/api-gateway/src/procurement/**` (including
    `dto/` and the controllers that declare DTOs inline). A field is a DTO field
    when it carries a `class-validator` or `@nestjs/swagger` decorator — that is
    what makes it part of the wire contract rather than an internal property.
  * The matching request interfaces on the web client
    (`apps/web/src/services/api/receiving.ts`), which are the other end of the
    same wire.
  * A sibling unit field only vouches for a quantity SHARING ITS PREFIX.
    `countedUom` declares `countedQty` and nothing else — the looser reading
    ("this DTO has a unit field somewhere") is exactly the one that let
    `rejectedQty` look accompanied when it was not.
  * A deprecated alias is exempt only while the properly-declared field it
    aliases still stands beside it. Otherwise the exemption would let the exact
    pre-fix declaration back in under its own name.

DOES NOT COVER, and cannot:
  * whether a declared unit is the CORRECT one. `rejectedQtyInCountedUom` named
    honestly but populated with bottles is invisible here; only a test at a
    real pack size catches that, which is why this change ships those too.
  * quantities that never appear in a DTO — internal service variables, SQL
    expressions, RPC arguments. Naming every local `qty` would be noise, and
    the boundary is where the unit is actually lost.
  * DTOs outside procurement/receiving. The rule is right everywhere; the sweep
    that would make it true everywhere else is a different change, and a guard
    that fails on 200 pre-existing fields gets deleted rather than obeyed.
  * plain `.ts` interfaces on the gateway that are not decorated. NestJS
    validates the decorated class, so that is the contract this reads.

This narrowing is stated rather than silent, per the absence-is-not-health rule.

EXIT CODES
----------
  0  every quantity field in scope declares its unit
  1  a field does not — the message names the file, the field and both ways out
  2  CANNOT CHECK: a root this guard reads is missing, or contains no DTO at
     all, or the known-exception list has gone stale. Never silently passes.

`--self-test` proves the exit-code invariants against synthetic trees, including
that the check FIRES on the exact pre-fix declaration (`rejectedQty?: number;`
with `@IsNumber()`) and does NOT fire on the fixed one.
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# The two ends of one wire. Both are in scope precisely because the defect was a
# disagreement BETWEEN them: the client meant boxes, the server read bottles.
GATEWAY_ROOTS = ("apps/api-gateway/src/procurement",)
WEB_WIRE_FILES = ("apps/web/src/services/api/receiving.ts",)

# A field whose name contains one of these is a quantity. `packSize` is not: it
# is a ratio between units, not a quantity in one.
#
# No word boundary: these names are camelCase, so `countedQty` has no boundary
# before the `Q`. The first draft used `(?<![a-z])` and matched NOTHING, which
# the vacuity check in `gather` caught as exit 2 rather than letting it pass.
QUANTITY_NAME = re.compile(r"(qty|quantity)", re.I)

# `countedQty` -> prefix "counted". The prefix is what a sibling unit field has
# to share for it to be describing THIS quantity.
QUANTITY_SPLIT = re.compile(r"^(?P<prefix>.*?)(?:qty|quantity)(?P<suffix>.*)$", re.I)

# Units this repo actually uses, from ORDER_UNIT_TYPES / procurement_document_lines_uom_check.
UNIT_WORDS = (
    "bottle",
    "bottles",
    "case",
    "cases",
    "box",
    "boxes",
    "keg",
    "kegs",
    "pack",
    "packs",
    "splitcase",
    "split_case",
    "each",
    "liter",
    "liters",
    "litre",
    "ml",
    "gram",
    "grams",
    "kg",
    "unit",
    "units",
)

# "in the unit that field says" — the other legitimate way to declare, used when
# a row carries two quantities that must share one unit. Case matters: the form
# is `rejectedQtyInCountedUom`, with a capital `I`.
UNIT_REFERENCE = re.compile(r"[Ii]n[A-Z][A-Za-z]*(Uom|UnitType|Unit)$")

# A decorator that makes a property part of the wire contract.
WIRE_DECORATOR = re.compile(
    r"@(Is[A-Za-z0-9]+|Min|Max|Type|Transform|ApiProperty|ApiPropertyOptional)\b"
)

# A property declaration: `name?: type;` / `name!: type;` / `name: type`.
FIELD_DECL = re.compile(
    r"^[ \t]{2,}(?P<name>[A-Za-z_][A-Za-z0-9_]*)[ \t]*[?!]?[ \t]*:[ \t]*(?P<type>[^;=\n]+)",
    re.M,
)


class CannotCheck(Exception):
    """The guard cannot see what it claims to. Exit 2, never 0."""


# ---------------------------------------------------------------------------
# Known exceptions. SHRINK-ONLY.
# ---------------------------------------------------------------------------
# Each entry is (file suffix, field name, needs_declared_twin, reason). An entry
# that no longer matches anything is itself a FINDING: a stale exemption silently
# widens what the guard permits, which is how a list like this becomes a hole.
# Adding to it requires a reason that survives the question "in what unit?" —
# "it does not have one" is a valid answer; "it is obvious" is not.
#
# `needs_declared_twin` closes the hole an exemption would otherwise open. The
# defect's own field name is `rejectedQty`, and exempting that literal name would
# mean reverting to the exact pre-fix declaration passes. So an alias exemption
# holds ONLY while a properly-declared field with the same prefix stands beside
# it: `rejectedQty` is excused because `rejectedQtyInCountedUom` is there. Delete
# the declared one and the alias stops being an alias — it is the bug again, and
# the guard says so.
KNOWN_EXCEPTIONS: tuple[tuple[str, str, bool, str], ...] = (
    (
        "procurement/receiving.controller.ts",
        "rejectedQty",
        True,
        "DEPRECATED alias, kept ONLY so a receipt queued by the pre-fix client "
        "still books its refusal; interpreted in countedUom by the service. "
        "Delete this entry and the field together once no phone can hold one.",
    ),
    (
        "services/api/receiving.ts",
        "rejectedQty",
        True,
        "The same deprecated alias on the client type. Nothing sends it; it is "
        "typed so an outbox entry written by the old client still parses.",
    ),
    # ---------------------------------------------------------------------
    # PRE-EXISTING DEBT — found by this guard on its first run, NOT endorsed.
    # ---------------------------------------------------------------------
    # Six fields on `dto/procurement.dto.ts` carry the identical defect: a
    # quantity with no unit in its name, no unit sibling on its DTO, and — like
    # `rejectedQty` — a unit stated only in prose. They are listed rather than
    # fixed because every one of them is read by `procurement.service.ts`, which
    # three unmerged branches own; renaming them here would collide with all
    # three. They are the same wound, awaiting a change that can touch that file.
    #
    # `verifyReceipt`'s four in particular are compared against each other and
    # against `procurement_orders.quantity` — the same shape as the door's
    # `countedBottles - rejectedQty`, one conversion away from the same bug.
    (
        "dto/procurement.dto.ts",
        "quantityReceived",
        False,
        "PRE-EXISTING. Written to procurement_orders.quantity_received, which the "
        "door writes in BOTTLES and markDelivered writes in ORDER UNITS. Fixing "
        "the name means touching procurement.service.ts.",
    ),
    (
        "dto/procurement.dto.ts",
        "invoiceQuantity",
        False,
        "PRE-EXISTING. verifyReceipt's four-way match. Read by procurement.service.ts.",
    ),
    (
        "dto/procurement.dto.ts",
        "shippedQuantity",
        False,
        "PRE-EXISTING. verifyReceipt's four-way match. Read by procurement.service.ts.",
    ),
    (
        "dto/procurement.dto.ts",
        "freeGoodsQuantity",
        False,
        "PRE-EXISTING. verifyReceipt's four-way match. Read by procurement.service.ts.",
    ),
    (
        "dto/procurement.dto.ts",
        "acceptedQuantity",
        False,
        "PRE-EXISTING. verifyReceipt's four-way match. Read by procurement.service.ts.",
    ),
    (
        "dto/procurement.dto.ts",
        "rejectedQuantity",
        False,
        "PRE-EXISTING, and the closest sibling of the bug this guard exists for: "
        "the same word, the same missing unit, on the desk-stage receipt. Read by "
        "procurement.service.ts.",
    ),
)


def read(root: Path, rel: str) -> str:
    p = root / rel
    if not p.is_file():
        raise CannotCheck(f"{rel} not found under {root}")
    try:
        return p.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:  # pragma: no cover - defensive
        raise CannotCheck(f"{rel} is unreadable: {e}") from e


def strip_comments(src: str) -> str:
    """Blank out comments, preserving line numbers and string literals.

    A state machine rather than a regex, for the reason
    `check_order_capture_contract.py` learned the hard way: this very file's
    prose names `rejectedQty` at length, and a guard that fires on the sentence
    explaining the bug makes the bug undocumentable. Comments must not COUNT as
    a declaration either — "// in boxes" is exactly the declaration that failed.
    """
    out: list[str] = []
    i, n = 0, len(src)
    quote: str | None = None
    while i < n:
        c = src[i]
        if quote:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(src[i + 1])
                i += 2
                continue
            if c == quote:
                quote = None
            i += 1
            continue
        if c in "\"'`":
            quote = c
            out.append(c)
            i += 1
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            while i < n and src[i] != "\n":
                out.append(" ")
                i += 1
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            while i < n and not (src[i] == "*" and i + 1 < n and src[i + 1] == "/"):
                out.append("\n" if src[i] == "\n" else " ")
                i += 1
            out.append("  ")
            i += 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def declares_a_unit(name: str, type_text: str, siblings: set[str]) -> bool:
    """Does this field say what unit its number is in?

    Three accepted forms, and the third is where the precision matters:

      1. the unit in the NAME — `countedQtyBottles`, `quantityInCases`;
      2. a reference to another field that carries it —
         `rejectedQtyInCountedUom`;
      3. a sibling unit field SHARING THIS FIELD'S PREFIX — `countedQty` is
         declared by `countedUom`, and `quantity` by `unitType`.

    Form 3 is deliberately prefix-matched rather than "is there any unit field
    on this DTO". That looser rule is what a reviewer's eye applied, and it is
    exactly wrong: `DoorReceiptDto` carried `countedUom`, so `rejectedQty`
    looked accompanied — but `countedUom` describes `countedQty`. The prefix is
    what says which quantity a unit belongs to.
    """
    if UNIT_REFERENCE.search(name):
        return True
    lowered = re.sub(r"[^a-z]", "", name.lower())
    for u in UNIT_WORDS:
        flat = u.replace("_", "")
        if flat and flat in lowered:
            return True
    # `qty: number; uom: 'case' | 'bottle'` style — the unit is in the type.
    for u in UNIT_WORDS:
        if re.search(rf"['\"]{re.escape(u)}['\"]", type_text):
            return True

    m = QUANTITY_SPLIT.match(name)
    prefix = (m.group("prefix") if m else "").lower()
    for sib in siblings:
        s = sib.lower()
        for tail in ("uom", "unittype", "unit_type", "unit"):
            if s == f"{prefix}{tail}":
                return True
    return False


def sibling_unit_fields(src: str) -> set[str]:
    """Field names on this file that carry a unit, e.g. `countedUom`."""
    return {
        m.group("name")
        for m in FIELD_DECL.finditer(src)
        if re.search(r"(uom|unitType|unit_type|unit)$", m.group("name"), re.I)
    }


DECL_START = re.compile(
    r"^\s*(?:export\s+)?(?:abstract\s+)?(?:class|interface|type)\s+[A-Za-z_]", re.M
)


def split_declarations(src: str) -> list[tuple[int, str]]:
    """(start line, text) per class/interface/type block.

    Sibling units are matched WITHIN a declaration, not across a file. A file
    holding twelve DTOs would otherwise let one class's `countedUom` vouch for
    another class's `countedQty`, which is the same too-loose reading that let
    `rejectedQty` look accompanied.
    """
    lines = src.splitlines()
    starts = [i for i, l in enumerate(lines) if DECL_START.match(l)]
    if not starts:
        return [(1, src)]
    blocks: list[tuple[int, str]] = []
    if starts[0] > 0:
        blocks.append((1, "\n".join(lines[: starts[0]])))
    for a, b in zip(starts, [*starts[1:], len(lines)]):
        blocks.append((a + 1, "\n".join(lines[a:b])))
    return blocks


def scan_source(rel: str, raw: str, require_decorator: bool) -> list[str]:
    """Findings for one file."""
    src = strip_comments(raw)
    findings: list[str] = []
    for offset, block in split_declarations(src):
        findings.extend(
            scan_block(rel, block, offset - 1, require_decorator)
        )
    return findings


def scan_block(
    rel: str, src: str, line_offset: int, require_decorator: bool
) -> list[str]:
    lines = src.splitlines()
    findings: list[str] = []
    units_here = sibling_unit_fields(src)
    all_names = {m.group("name") for m in FIELD_DECL.finditer(src)}

    for n, line in enumerate(lines, 1):
        m = FIELD_DECL.match(line)
        if not m:
            continue
        name, type_text = m.group("name"), m.group("type")
        if not QUANTITY_NAME.search(name):
            continue
        if "(" in line.split(":", 1)[0]:  # a method, not a property
            continue

        if require_decorator:
            # Only wire fields. Look back over the decorator block above.
            window = "\n".join(lines[max(0, n - 12) : n - 1])
            if not WIRE_DECORATOR.search(window):
                continue

        if declares_a_unit(name, type_text, units_here):
            continue

        exempt = next(
            (
                e
                for e in KNOWN_EXCEPTIONS
                if rel.endswith(e[0]) and name == e[1]
            ),
            None,
        )
        if exempt is not None:
            if not exempt[2]:
                continue
            # An alias is only an alias while the declared field it aliases is
            # still there. Without that twin, this IS the pre-fix declaration.
            twin = any(
                other != name
                and other.startswith(name)
                and declares_a_unit(other, "", units_here)
                for other in all_names
            )
            if twin:
                continue
            n += line_offset
            findings.append(
                f"{rel}:{n} `{name}` is exempted as a DEPRECATED ALIAS, but the "
                f"declared field it aliases is gone — nothing here starts with "
                f"`{name}` and states a unit. An alias with no twin is not an alias, "
                f"it is the original defect: a quantity crossing the wire with its "
                f"unit stated only in prose. Restore the declared field, or delete "
                f"both it and the KNOWN_EXCEPTIONS entry."
            )
            continue

        n += line_offset
        findings.append(
            f"{rel}:{n} `{name}` is a quantity that does not say what unit it is in "
            f"(siblings here that do carry a unit: "
            f"{', '.join(sorted(units_here)) or 'none'}). "
            f"Put the unit in the NAME — `{name}Bottles`, or `{name}InCountedUom` when it "
            f"must match another field — or add it to KNOWN_EXCEPTIONS with a reason. "
            f"A comment is not a declaration: JSON does not carry comments, which is how "
            f"`rejectedQty` came to book 33 bottles of live stock for a refused delivery."
        )
    return findings


def gather(root: Path) -> list[tuple[str, str, bool]]:
    """(relpath, source, require_decorator) for everything in scope."""
    out: list[tuple[str, str, bool]] = []
    for rel_dir in GATEWAY_ROOTS:
        base = root / rel_dir
        if not base.is_dir():
            raise CannotCheck(f"{rel_dir} is not a directory under {root}")
        for p in sorted(base.rglob("*.ts")):
            if p.name.endswith(".spec.ts"):
                continue
            try:
                out.append((str(p.relative_to(root)), p.read_text(encoding="utf-8"), True))
            except (OSError, UnicodeDecodeError) as e:  # pragma: no cover
                raise CannotCheck(f"{p} is unreadable: {e}") from e
    for rel in WEB_WIRE_FILES:
        out.append((rel, read(root, rel), False))

    # NEVER VACUOUS. If nothing in scope declares a quantity field at all, the
    # anchors have moved and this guard is checking nothing.
    if not any(
        QUANTITY_NAME.search(m.group("name"))
        for _, src, _ in out
        for m in FIELD_DECL.finditer(strip_comments(src))
    ):
        raise CannotCheck(
            "no field matching *Qty*/*Quantity* was found anywhere in scope — "
            "the roots moved or the declaration shape changed, so this guard is "
            "checking nothing"
        )
    return out


def run(root: Path) -> tuple[int, list[str]]:
    sources = gather(root)
    findings: list[str] = []
    for rel, raw, require_decorator in sources:
        findings.extend(scan_source(rel, raw, require_decorator))

    # Shrink-only, honestly: an exception that matches nothing is a hole.
    for suffix, field, _twin, _reason in KNOWN_EXCEPTIONS:
        present = any(
            rel.endswith(suffix)
            and re.search(rf"^\s{{2,}}{re.escape(field)}\s*[?!]?\s*:", strip_comments(raw), re.M)
            for rel, raw, _ in sources
        )
        if not present:
            findings.append(
                f"KNOWN_EXCEPTIONS lists {suffix}::{field}, which no longer exists. "
                f"Delete the entry — an exemption that outlives what it excuses is a "
                f"hole, not a record."
            )
    return (1 if findings else 0), findings


def main() -> int:
    try:
        code, findings = run(ROOT)
    except CannotCheck as e:
        print(f"CANNOT CHECK -- {e}")
        return 2
    if findings:
        print(f"FAIL -- {len(findings)} quantity field(s) with no declared unit:")
        for f in findings:
            print(f"  - {f}")
        return 1
    print(
        "PASS -- every procurement/receiving DTO quantity declares its unit, in its "
        "name or in a named sibling. (Scope: gateway procurement DTOs + the web "
        "receiving wire types; this does NOT verify that a declared unit is the "
        "right one — the pack-12 tests do that.)"
    )
    return 0


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------
CLEAN_CONTROLLER = """
import { IsNumber, IsString, Min } from "class-validator";

export class DoorReceiptDto {
  @IsNumber()
  @Min(0)
  countedQty!: number;

  @IsString()
  countedUom!: string;

  @IsNumber()
  @Min(0)
  rejectedQtyInCountedUom?: number;

  @IsNumber()
  @Min(0)
  expectedQtyInCountedUom?: number;

  // A deprecated alias, exempted by name in KNOWN_EXCEPTIONS.
  @IsNumber()
  @Min(0)
  rejectedQty?: number;
}
"""

CLEAN_WEB = """
export interface DoorReceiptRequest {
  countedQty: number
  countedUom?: string
  rejectedQtyInCountedUom?: number
  rejectedQty?: number
}
"""


def _fixture(tmp: Path) -> Path:
    root = tmp / "tree"
    (root / GATEWAY_ROOTS[0] / "dto").mkdir(parents=True)
    (root / "apps/web/src/services/api").mkdir(parents=True)
    (root / GATEWAY_ROOTS[0] / "receiving.controller.ts").write_text(
        CLEAN_CONTROLLER, encoding="utf-8"
    )
    (root / WEB_WIRE_FILES[0]).write_text(CLEAN_WEB, encoding="utf-8")

    # The pre-existing debt is PART of the clean fixture, for the same reason the
    # capture guard's grandfathered FKs are part of its: the shrink-only rule is
    # only honest if an entry matching nothing is a finding, so a compliant tree
    # has to actually contain what the list excuses. Generated from the list, so
    # editing the list keeps the self-test truthful rather than stale.
    debt = "".join(
        f"  @IsNumber()\n  {field}?: number;\n\n"
        for suffix, field, _twin, _reason in KNOWN_EXCEPTIONS
        if suffix.endswith("dto/procurement.dto.ts")
    )
    (root / GATEWAY_ROOTS[0] / "dto" / "procurement.dto.ts").write_text(
        'import { IsNumber } from "class-validator";\n\n'
        "export class LegacyReceiptDto {\n" + debt + "}\n",
        encoding="utf-8",
    )
    return root


def self_test() -> int:
    failures: list[str] = []

    def expect(label: str, got: int, want: int) -> None:
        if got != want:
            failures.append(f"{label}: exit {got}, expected {want}")

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        root = _fixture(tmp)
        ctrl = root / GATEWAY_ROOTS[0] / "receiving.controller.ts"
        web = root / WEB_WIRE_FILES[0]

        code, findings = run(root)
        expect("clean tree", code, 0)
        if findings:
            failures.append(f"clean tree reported: {findings}")

        # THE DEFECT, restored exactly: the field that shipped, with no unit
        # anywhere except a comment. Named something the exception list does not
        # cover, so this is the class and not the grandfathered instance.
        ctrl.write_text(
            CLEAN_CONTROLLER.replace(
                "  rejectedQtyInCountedUom?: number;",
                "  rejectedQtyInCountedUom?: number;\n\n"
                "  // Units visibly damaged and refused. (in boxes)\n"
                "  @IsNumber()\n  damagedQty?: number;",
            ),
            encoding="utf-8",
        )
        code, findings = run(root)
        expect("unitless quantity on a DTO", code, 1)
        if not any("damagedQty" in f for f in findings):
            failures.append(f"the unitless field was not named: {findings}")

        # A COMMENT IS NOT A DECLARATION. The same field with the unit spelled
        # out in prose above it must still fail — prose does not cross JSON.
        ctrl.write_text(
            CLEAN_CONTROLLER.replace(
                "  rejectedQtyInCountedUom?: number;",
                "  rejectedQtyInCountedUom?: number;\n\n"
                "  /** In BOXES, the same unit as countedQty. */\n"
                "  @IsNumber()\n  damagedQty?: number;",
            ),
            encoding="utf-8",
        )
        expect("unit stated only in a comment", run(root)[0], 1)

        # The two accepted declarations both pass.
        for label, decl in (
            ("unit in the name", "  damagedQtyBottles?: number;"),
            ("unit by reference", "  damagedQtyInCountedUom?: number;"),
        ):
            ctrl.write_text(
                CLEAN_CONTROLLER.replace(
                    "  rejectedQtyInCountedUom?: number;",
                    f"  rejectedQtyInCountedUom?: number;\n\n  @IsNumber()\n{decl}",
                ),
                encoding="utf-8",
            )
            code, findings = run(root)
            expect(label, code, 0)
            if findings:
                failures.append(f"{label} flagged: {findings}")
        ctrl.write_text(CLEAN_CONTROLLER, encoding="utf-8")

        # An undecorated internal property on a gateway file is NOT a wire field.
        # Flagging every local interface would make this guard noise and it would
        # be deleted rather than obeyed — so the narrowing is tested, not assumed.
        (root / GATEWAY_ROOTS[0] / "internal.ts").write_text(
            "interface Row {\n  someQty: number;\n}\n", encoding="utf-8"
        )
        code, findings = run(root)
        expect("undecorated internal property", code, 0)
        if findings:
            failures.append(f"internal property flagged: {findings}")
        (root / GATEWAY_ROOTS[0] / "internal.ts").unlink()

        # `packSize` is a ratio, not a quantity, and must not be dragged in.
        ctrl.write_text(
            CLEAN_CONTROLLER.replace(
                "  countedUom!: string;",
                "  countedUom!: string;\n\n  @IsNumber()\n  packSize?: number;",
            ),
            encoding="utf-8",
        )
        code, findings = run(root)
        expect("packSize is not a quantity", code, 0)
        if findings:
            failures.append(f"packSize flagged: {findings}")
        ctrl.write_text(CLEAN_CONTROLLER, encoding="utf-8")

        # The web end of the wire is checked too — that is where the units
        # actually disagreed.
        web.write_text(
            CLEAN_WEB.replace(
                "  rejectedQtyInCountedUom?: number",
                "  rejectedQtyInCountedUom?: number\n  damagedQuantity?: number",
            ),
            encoding="utf-8",
        )
        code, findings = run(root)
        expect("unitless quantity on the web wire type", code, 1)
        if not any("damagedQuantity" in f for f in findings):
            failures.append(f"the web field was not named: {findings}")
        web.write_text(CLEAN_WEB, encoding="utf-8")

        # Shrink-only: an exemption matching nothing is itself a finding.
        ctrl.write_text(
            "\n".join(
                l for l in CLEAN_CONTROLLER.splitlines() if "rejectedQty?" not in l
            ),
            encoding="utf-8",
        )
        code, findings = run(root)
        expect("stale exception entry", code, 1)
        if not any("outlives what it excuses" in f for f in findings):
            failures.append(f"stale exception not reported: {findings}")
        ctrl.write_text(CLEAN_CONTROLLER, encoding="utf-8")

        # An exempted alias with NO declared twin is the pre-fix declaration
        # again, and the exemption must not cover it.
        ctrl.write_text(
            CLEAN_CONTROLLER.replace(
                "  rejectedQtyInCountedUom?: number;\n", ""
            ),
            encoding="utf-8",
        )
        code, findings = run(root)
        expect("deprecated alias with no declared twin", code, 1)
        if not any("not an alias" in f for f in findings):
            failures.append(f"the orphaned alias was not reported: {findings}")
        ctrl.write_text(CLEAN_CONTROLLER, encoding="utf-8")

        # CANNOT CHECK, not PASS: every way this guard can go blind.
        def blind(label: str, mutate) -> None:
            blind_root = _fixture(Path(tempfile.mkdtemp(dir=td)))
            mutate(blind_root)
            try:
                run(blind_root)
            except CannotCheck:
                return
            failures.append(f"{label}: did not raise CannotCheck")

        blind(
            "gateway procurement root gone",
            lambda r: shutil.rmtree(r / GATEWAY_ROOTS[0]),
        )
        blind("web wire file gone", lambda r: (r / WEB_WIRE_FILES[0]).unlink())
        blind(
            "nothing in scope declares a quantity at all",
            lambda r: (
                [
                    p.write_text("export class Empty {}\n", encoding="utf-8")
                    for p in (r / GATEWAY_ROOTS[0]).rglob("*.ts")
                ],
                (r / WEB_WIRE_FILES[0]).write_text(
                    "export interface Empty {}\n", encoding="utf-8"
                ),
            ),
        )

    print("== --self-test: quantity units")
    if failures:
        for f in failures:
            print(f"   FAIL -- {f}")
        return 1
    print("   a compliant tree exits 0")
    print("   a *Qty* DTO field with no unit anywhere exits 1")
    print("   the same field with the unit ONLY in a comment still exits 1")
    print("   `damagedQtyBottles` (unit in the name) exits 0")
    print("   `damagedQtyInCountedUom` (unit by reference) exits 0")
    print("   an undecorated internal property is out of scope and exits 0")
    print("   `packSize` is a ratio, not a quantity, and exits 0")
    print("   the web request type is checked too, and exits 1 when it drifts")
    print("   a KNOWN_EXCEPTIONS entry that matches nothing exits 1")
    print("   an exempted alias whose declared twin is gone exits 1")
    print("   a missing root, or a scope with no quantity field at all, exits 2")
    print("PASS")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(
        description=(
            "A quantity crossing the client/server boundary must declare its unit."
        )
    )
    ap.add_argument(
        "--self-test",
        action="store_true",
        help="prove the exit-code invariants against synthetic trees, then exit",
    )
    args = ap.parse_args()
    sys.exit(self_test() if args.self_test else main())
