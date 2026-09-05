#!/usr/bin/env python3
"""Guard: every key a client type declares exists on the gateway DTO it mirrors.

WHY THIS EXISTS
---------------
`apps/web/src/services/api/types.ts` `Order` declared `unitPrice` and
`totalPrice`. `GET /procurement/orders` has never sent either name -- the DTO's
are `finalPrice` and `totalCost` -- and TypeScript could not tell, because the
web type is hand-written prose about a JSON payload, not a type derived from
the server. Nothing connects the two files, so the declaration was free to be
wrong for as long as nobody compared them by hand.

The consequence is never a crash. `formatMoney(undefined)` returns `"$0"`;
`order.totalPrice || order.quantity * (order.unitPrice || 0)` is `0`;
`order.totalPrice ?? order.unitPrice * order.quantity` is `NaN`;
`typeof x.totalPrice === "number"` is false and the clause silently vanishes.
Absence reported as health, in all three of its classes, from ONE wrong word in
a type -- and every one of those readings type-checked.

This guard is the read-side counterpart of `check_read_columns_exist.py`:

    check_read_columns_exist    does the COLUMN this code names exist in the DB?
    this guard                  does the DTO KEY this type names exist on the server?

WHAT IT CHECKS, AND IN WHICH DIRECTION
--------------------------------------
For each pair in MIRRORS below: every property the CLIENT type declares must be
a property the GATEWAY DTO class declares. One direction only.

    client key not on the DTO  ->  FAIL. The client is asserting the server
                                   sends something it does not. That assertion
                                   is what compiles a wrong read.
    DTO key not on the client  ->  fine. A server may send more than a screen
                                   reads, and a client that has not caught up
                                   with a new field is behind, not wrong.

The second direction is deliberately NOT checked. Making it an error would
break every additive gateway change until every client caught up, which is the
kind of guard people delete.

THE MAPPING IS DECLARED, NEVER INFERRED
---------------------------------------
`Order` and `OrderResponseDto` do not share a name, and `ProcurementOrder` on
mobile mirrors the same DTO under a third name. A guard that paired types by
name would have found neither, reported zero mirrors, and exited 0 -- a green
check that had looked at nothing. So the table is written out by hand, and an
entry that no longer resolves exits 2 rather than quietly checking less.

WHAT IT CANNOT READ, AND SAYS SO
--------------------------------
* An index signature (`[key: string]: any`) makes a type declare EVERY key, so
  neither this guard nor `tsc` can catch a phantom read on it. A mirror with
  one must be listed in INDEX_SIGNATURE_ALLOWED with a reason, and the run
  prints the weakening out loud. A listed entry that no longer has one exits 1
  (delete the line) -- the same shrink-only ratchet the other guards use.
* Inheritance is resolved only within the DTO's own file. `extends` naming a
  class this parse cannot find -- including the mapped-type helpers
  (`PartialType`, `OmitType`, `IntersectionType`) -- exits 2.
* A key's TYPE is not compared, only its existence. `status: OrderStatus`
  declaring the lowercase UI vocabulary while the wire sends
  `ProcurementOrderStatus` in SCREAMING_SNAKE is a lie this guard cannot see;
  it is recorded in `.planning/v3.0-TECH-DEBT.md` instead.

EXITS
-----
    0  every declared client key exists on its DTO
    1  a client type declares a key its DTO does not (or a stale allowance)
    2  the guard could not look: a file, type, class or parse is missing
"""

from __future__ import annotations

import argparse
import importlib.util
import re
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class CannotCheck(Exception):
    """The guard cannot see what it claims to. Exit 2, never 0."""


# ---------------------------------------------------------------------------
# THE MAPPING TABLE. One row per client type that mirrors a gateway response
# DTO. Written by hand on purpose -- see the docstring. Adding a row is the
# whole cost of covering another payload.
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Mirror:
    label: str
    client_file: str
    client_type: str
    dto_file: str
    dto_class: str
    why: str


DTO = "apps/api-gateway/src/procurement/dto/procurement.dto.ts"

MIRRORS: tuple[Mirror, ...] = (
    Mirror(
        label="web Order",
        client_file="apps/web/src/services/api/types.ts",
        client_type="Order",
        dto_file=DTO,
        dto_class="OrderResponseDto",
        why=(
            "The shape every /procurement/orders response is read as: the list "
            "route, /orders/pending, /orders/history and /orders/:id all return "
            "OrderResponseDto. This pairing is the one that was wrong."
        ),
    ),
    Mirror(
        label="mobile ProcurementOrder",
        client_file="apps/mobile/src/api/types.ts",
        client_type="ProcurementOrder",
        dto_file=DTO,
        dto_class="OrderResponseDto",
        why=(
            "The same DTO under a third name: apps/mobile/src/api/queries.ts "
            "types /procurement/orders/pending and /procurement/orders/:id with "
            "it. Its keys were measured correct on 2026-09-05; the row exists so "
            "the next one is caught, not because it was broken."
        ),
    ),
)


# ---------------------------------------------------------------------------
# INDEX_SIGNATURE_ALLOWED -- the shrink-only list of mirrors whose client type
# carries `[key: string]: any` and is therefore only PARTLY checkable.
#
# NOT approved. Recorded so the guard can be green on arrival while saying, in
# its own output, exactly how far it can see on that row.
# ---------------------------------------------------------------------------
INDEX_SIGNATURE_ALLOWED: dict[str, str] = {}


# ---------------------------------------------------------------------------
# The shared comment stripper, loaded BY PATH so there is one of it in the repo
# (the idiom check_read_columns_exist.py uses). SystemExit is caught: a stray
# module-level exit over there is a BaseException, and letting it through would
# end THIS guard with that file's status -- possibly 0, which reads as "checked
# and clean" when nothing was checked at all.
# ---------------------------------------------------------------------------
def load_strip_comments(root: Path):
    path = root / "scripts" / "check_order_capture_contract.py"
    if not path.is_file():
        raise CannotCheck(f"{path} is missing; the shared comment stripper is gone")
    try:
        spec = importlib.util.spec_from_file_location("_occ_shared_dto", path)
        if spec is None or spec.loader is None:
            raise CannotCheck(f"{path} could not be loaded as a module")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except BaseException as e:  # noqa: BLE001 - SystemExit is the point
        raise CannotCheck(f"{path} would not import: {e!r}") from e
    fn = getattr(mod, "strip_comments", None)
    if not callable(fn):
        raise CannotCheck(f"{path} no longer exports strip_comments(); the reuse contract broke")
    probe = fn("a // b\n/* c */ d\n")
    if "b" in probe or "c" in probe or "d" not in probe:
        raise CannotCheck(
            f"{path} strip_comments() no longer blanks comments "
            f"(probe returned {probe!r}); the parse below would read prose as code"
        )
    return fn


# ---------------------------------------------------------------------------
# Parsing. Both halves want the same thing: the property names declared at the
# TOP level of one braced body. Nested object types (`recurrence?: { … }`) and
# method bodies are at depth > 0 and are not properties of the outer shape.
# ---------------------------------------------------------------------------
PROP_RE = re.compile(
    r"""^\s*
        (?:readonly\s+|public\s+|declare\s+|static\s+)*   # modifiers
        (?P<name>[A-Za-z_$][A-Za-z0-9_$]*)                # the key
        \s*[?!]?\s*:                                      # optional marker, colon
    """,
    re.VERBOSE,
)
INDEX_SIG_RE = re.compile(r"^\s*\[\s*[A-Za-z_$][A-Za-z0-9_$]*\s*:\s*(?:string|number)\s*\]\s*:")


def body_of(src: str, header_re: re.Pattern[str], what: str, where: str) -> tuple[str, str]:
    """Return (body, header_text) for the first `header_re` match, brace-matched.

    `src` must already have had comments blanked: a brace inside a doc comment
    would otherwise close the body early and the parse would silently see half
    the properties.
    """
    m = header_re.search(src)
    if not m:
        raise CannotCheck(f"{what} was not found in {where}")
    open_at = src.find("{", m.end() - 1)
    if open_at == -1:
        raise CannotCheck(f"{what} in {where} has no body")
    depth = 0
    for i in range(open_at, len(src)):
        c = src[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return src[open_at + 1 : i], m.group(0)
    raise CannotCheck(f"{what} in {where} has an unbalanced body; the parse cannot be trusted")


def top_level_props(body: str) -> tuple[set[str], bool]:
    """Property names declared at depth 0 of a braced body, and whether it has
    an index signature."""
    names: set[str] = set()
    has_index = False
    depth = 0
    for raw in body.splitlines():
        if depth == 0:
            if INDEX_SIG_RE.match(raw):
                has_index = True
            else:
                m = PROP_RE.match(raw)
                if m:
                    names.add(m.group("name"))
        depth += raw.count("{") + raw.count("(") + raw.count("[")
        depth -= raw.count("}") + raw.count(")") + raw.count("]")
        if depth < 0:
            depth = 0
    return names, has_index


def read(root: Path, rel: str, strip) -> str:
    path = root / rel
    if not path.is_file():
        raise CannotCheck(f"{rel} is missing; the mapping table names a file that is gone")
    src = path.read_text(encoding="utf-8", errors="replace")
    if not src.strip():
        raise CannotCheck(f"{rel} is empty")
    return strip(src)


def client_keys(root: Path, m: Mirror, strip) -> tuple[set[str], bool]:
    src = read(root, m.client_file, strip)
    header = re.compile(
        r"(?:export\s+)?(?:interface|type)\s+" + re.escape(m.client_type) + r"\b[^{;]*\{"
    )
    body, _ = body_of(src, header, f"type {m.client_type}", m.client_file)
    names, has_index = top_level_props(body)
    if not names:
        raise CannotCheck(
            f"{m.client_file}: {m.client_type} parsed to ZERO properties; "
            "the parse is broken, not the type"
        )
    return names, has_index


def dto_keys(root: Path, m: Mirror, strip) -> set[str]:
    src = read(root, m.dto_file, strip)
    names: set[str] = set()
    seen: list[str] = []
    want = m.dto_class
    while True:
        if want in seen:
            raise CannotCheck(f"{m.dto_file}: {' -> '.join(seen)} -> {want} is an extends cycle")
        seen.append(want)
        header = re.compile(r"(?:export\s+)?(?:abstract\s+)?class\s+" + re.escape(want) + r"\b[^{]*\{")
        body, head = body_of(src, header, f"class {want}", m.dto_file)
        got, has_index = top_level_props(body)
        if has_index:
            raise CannotCheck(
                f"{m.dto_file}: class {want} has an index signature, so it declares "
                "every key and this guard would pass anything"
            )
        names |= got
        ext = re.search(r"\bextends\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(\(|<|\{)", head)
        if not ext:
            break
        parent, opener = ext.group(1), ext.group(2)
        if opener == "(":
            raise CannotCheck(
                f"{m.dto_file}: class {want} extends {parent}(...), a mapped-type helper "
                "this parse cannot resolve; the key set would be incomplete"
            )
        want = parent
    if not names:
        raise CannotCheck(
            f"{m.dto_file}: {m.dto_class} parsed to ZERO properties; "
            "the parse is broken, not the DTO"
        )
    return names


# ---------------------------------------------------------------------------
def main(root: Path = ROOT) -> int:
    try:
        strip = load_strip_comments(root)
        if not MIRRORS:
            raise CannotCheck("MIRRORS is empty; this guard would check nothing and exit 0")
        rows = []
        for m in MIRRORS:
            ck, has_index = client_keys(root, m, strip)
            dk = dto_keys(root, m, strip)
            rows.append((m, ck, dk, has_index))
    except CannotCheck as e:
        print("== web/mobile types name only keys the gateway DTO declares")
        print(f"   CANNOT CHECK -- {e}")
        return 2

    failures: list[str] = []
    stale = set(INDEX_SIGNATURE_ALLOWED) - {m.label for m in MIRRORS}
    for label in sorted(stale):
        failures.append(
            f"INDEX_SIGNATURE_ALLOWED names {label!r}, which is not in MIRRORS -- delete the line"
        )

    print("== web/mobile types name only keys the gateway DTO declares")
    for m, ck, dk, has_index in rows:
        phantom = sorted(ck - dk)
        if has_index and m.label not in INDEX_SIGNATURE_ALLOWED:
            failures.append(
                f"{m.client_file}: {m.client_type} has an index signature "
                "([key: string]: …), so it declares every key and neither this "
                "guard nor tsc can catch a phantom read. Remove it, or add the "
                "mirror to INDEX_SIGNATURE_ALLOWED with the reason."
            )
        if not has_index and m.label in INDEX_SIGNATURE_ALLOWED:
            failures.append(
                f"INDEX_SIGNATURE_ALLOWED still lists {m.label!r}, but "
                f"{m.client_type} no longer has an index signature -- delete the line"
            )
        for key in phantom:
            failures.append(
                f"{m.client_file}: {m.client_type}.{key} is not declared by "
                f"{m.dto_class} ({m.dto_file}). The route does not send it; every "
                "read of it is undefined."
            )
        note = "  [index signature: only declared keys are checked]" if has_index else ""
        print(
            f"   {m.label}: {len(ck)} declared keys against {m.dto_class}'s "
            f"{len(dk)} -- {'OK' if not phantom else str(len(phantom)) + ' PHANTOM'}{note}"
        )

    if failures:
        for f in failures:
            print(f"   FAIL -- {f}")
        return 1
    print(f"PASS -- {len(rows)} mirror(s), no client key the gateway does not declare")
    return 0


# ---------------------------------------------------------------------------
# --self-test: the failure path and the exit-2 path must each have executed.
# ---------------------------------------------------------------------------
GOOD_DTO = '''\
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/** A doc comment naming a phantomFromProse: string that is NOT a property. */
export class OrderResponseDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional()
  finalPrice?: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  priceUom?: string | null;

  @ApiProperty()
  recurrence: { frequency: string; nested: number };
}
'''

GOOD_CLIENT = """\
export interface Order {
  id: string;
  finalPrice?: number;
  priceUom?: string | null;
  recurrence: { frequency: string; nested: number };
}
"""


def self_test() -> int:
    import shutil
    import tempfile

    failures: list[str] = []
    real_mirrors = MIRRORS
    real_allowed = dict(INDEX_SIGNATURE_ALLOWED)
    CLIENT = "apps/web/src/services/api/types.ts"
    DTO_REL = "apps/api-gateway/src/procurement/dto/procurement.dto.ts"

    def build(tmp: Path, client: str = GOOD_CLIENT, dto: str = GOOD_DTO) -> Path:
        r = tmp / "tree"
        (r / "scripts").mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / "scripts" / "check_order_capture_contract.py", r / "scripts")
        for rel, text in ((CLIENT, client), (DTO_REL, dto)):
            p = r / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8")
        return r

    def run(name: str, want: int, client: str = GOOD_CLIENT, dto: str = GOOD_DTO,
            mirrors=None, allowed=None) -> None:
        with tempfile.TemporaryDirectory() as td:
            r = build(Path(td), client, dto)
            globals()["MIRRORS"] = mirrors if mirrors is not None else (real_mirrors[0],)
            globals()["INDEX_SIGNATURE_ALLOWED"] = {} if allowed is None else allowed
            got = main(r)
        if got != want:
            failures.append(f"{name}: expected exit {want}, got {got}")

    try:
        run("a client naming only real DTO keys", 0)
        run(
            "a phantom key (the unitPrice defect)",
            1,
            client=GOOD_CLIENT.replace("  id: string;", "  id: string;\n  unitPrice: number;"),
        )
        run(
            "a key that appears only in the DTO's prose",
            1,
            client=GOOD_CLIENT.replace("  id: string;", "  id: string;\n  phantomFromProse: string;"),
        )
        run(
            "a key nested inside another key's object type is not a top-level DTO key",
            1,
            client=GOOD_CLIENT.replace("  id: string;", "  id: string;\n  nested: number;"),
        )
        run(
            "the DTO sending MORE than the client reads is fine",
            0,
            dto=GOOD_DTO.replace("  id: string;", "  id: string;\n\n  @ApiPropertyOptional()\n  brandNewField?: string;"),
        )
        run(
            "a client index signature is refused",
            1,
            client=GOOD_CLIENT.replace("  id: string;", "  id: string;\n  [key: string]: unknown;"),
        )
        run(
            "...and is tolerated only when the table says so, out loud",
            0,
            client=GOOD_CLIENT.replace("  id: string;", "  id: string;\n  [key: string]: unknown;"),
            allowed={real_mirrors[0].label: "measured 2026-09-05"},
        )
        run(
            "an allowance for a type that no longer has one is stale, and fails",
            1,
            allowed={real_mirrors[0].label: "measured 2026-09-05"},
        )
        run(
            "an allowance naming no mirror at all fails",
            1,
            allowed={"a mirror that was deleted": "stale"},
        )
        run("an empty mapping table exits 2, never 0", 2, mirrors=())
        run("a missing client type exits 2", 2, client="export interface Renamed { id: string; }\n")
        run("a missing DTO class exits 2", 2, dto="export class Renamed {}\n")
        run("a DTO class that parses to zero properties exits 2", 2, dto="export class OrderResponseDto {}\n")
        run("an empty client file exits 2", 2, client="")
        run(
            "a DTO extending a mapped-type helper exits 2 rather than under-reading",
            2,
            dto=GOOD_DTO.replace(
                "export class OrderResponseDto {",
                "export class OrderResponseDto extends PartialType(BaseDto) {",
            ),
        )
        run(
            "a DTO with an index signature exits 2 -- it would pass anything",
            2,
            dto=GOOD_DTO.replace("  id: string;", "  id: string;\n  [key: string]: unknown;"),
        )
        # The shared parse going blind must be exit 2, not a silent 0.
        with tempfile.TemporaryDirectory() as td:
            r = build(Path(td))
            (r / "scripts" / "check_order_capture_contract.py").unlink()
            globals()["MIRRORS"] = (real_mirrors[0],)
            globals()["INDEX_SIGNATURE_ALLOWED"] = {}
            if main(r) != 2:
                failures.append("a missing shared comment stripper: expected exit 2")
        with tempfile.TemporaryDirectory() as td:
            r = build(Path(td))
            (r / "scripts" / "check_order_capture_contract.py").write_text(
                "def strip_comments(s):\n    return s\n", encoding="utf-8"
            )
            globals()["MIRRORS"] = (real_mirrors[0],)
            globals()["INDEX_SIGNATURE_ALLOWED"] = {}
            if main(r) != 2:
                failures.append("a stripper that stops stripping: expected exit 2")
    finally:
        globals()["MIRRORS"] = real_mirrors
        globals()["INDEX_SIGNATURE_ALLOWED"] = real_allowed

    print("== --self-test: web reads gateway DTO keys")
    if failures:
        for f in failures:
            print(f"   FAIL -- {f}")
        return 1
    print("   a client naming only real DTO keys exits 0")
    print("   a phantom key -- the unitPrice/totalPrice defect -- exits 1")
    print("   a name that appears only in the DTO's PROSE is not a key")
    print("   a name nested inside another key's object type is not a key either")
    print("   a DTO that sends MORE than the client reads is not an error")
    print("   an index signature on the client is refused unless the table says so")
    print("   a stale index-signature allowance exits 1 (shrink-only)")
    print("   an empty mapping table exits 2, never a green run that looked at nothing")
    print("   a missing type, class, body or file exits 2")
    print("   a mapped-type extends or a DTO index signature exits 2")
    print("   a missing or broken shared comment stripper exits 2")
    print("PASS")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-test", action="store_true", help="prove the failure path fires")
    ap.add_argument("--root", default=None, help="check a tree other than this repo")
    args = ap.parse_args()
    if args.self_test:
        sys.exit(self_test())
    sys.exit(main(Path(args.root).resolve() if args.root else ROOT))
