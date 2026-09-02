#!/usr/bin/env python3
"""
Guard: a figure from a capped query is a floor, and an unknown is not a zero.

    ./scripts/check_windowed_figures.py
    ./scripts/check_windowed_figures.py --self-test

WHY THIS IS A GUARD AND NOT A CONVENTION
----------------------------------------
Six figures on the rebuilt /receiving were server-side windows rendered as
totals, and there was not one `≥` on the page:

    RcStaffLane.tsx:181     `deliveries.length`, a 25-row page, printed as
                            "N out for delivery" — while the gateway had
                            returned the exact `total` and the hook threw it
                            away (useReceivingNextData.ts:94).
    RcManagerQueue.tsx:91   lane counts filtered from a `.limit(100)` list.
    RcManagerQueue.tsx:390  the at-risk total summed over the same list.
    RcManagerQueue.tsx:121  the uncounted strip, built behind `.limit(500)`.
    RcOwnerLedger.tsx       every recovery figure, behind `.limit(5000)` with
                            no `.order()`.

and two neighbouring shapes said "unknown" and "zero" with the same mark:

    RcManagerQueue.tsx:261  `dollarsAtRisk > 0 ? fmtMoneyWhole(…) : EM`
                            printed a MEASURED $0 as an em dash, on a row whose
                            next field printed a literal `0`. One row could read
                            "$— · 0 open claims".
    useReceivingNextData:250 `unverified: known ? … : []` — so the shrinkage
                            safety net rendered "nothing uncounted" exactly when
                            its query failed.

That is one rule wearing seven hats, which is the signature of something a
command should hold rather than a reviewer.

WHAT THIS GUARD CHECKS — AND WHAT IT EXPLICITLY DOES NOT
--------------------------------------------------------
The rule as stated in prose — "a value derived from a capped query must not
render as a total" — is NOT decidable by static analysis. The cap is a numeric
literal inside a Supabase query builder in a NestJS service; the value crosses
an HTTP boundary, is reshaped by a react-query `queryFn`, flows through a
`useMemo`, and is finally interpolated into JSX. Proving the link needs
interprocedural dataflow across two languages and a network hop. Any guard
claiming to do that would be lying, and a lying guard is worse than none.

So this is narrowed to five things that ARE mechanically checkable, each of
which is a real regression barrier for one of the defects above:

  W1  DECLARED WINDOW == ACTUAL CAP. The page keeps a `SERVER_WINDOWS` register
      whose entries each cite the gateway query that imposes them. Every
      declared number must still appear as a `.limit(N)` in the file it cites.
      This is the rot that matters most: change `.limit(100)` to `.limit(250)`
      server-side and the page's floor prose ("capped at 100 rows") becomes a
      confident falsehood that reads exactly like a measurement.

  W2  A DECLARED WINDOW IS ACTUALLY CONSUMED. Every key in the register must be
      referenced outside its own declaration, and any renderer that references
      the register must also use a floor marker (`GE`, `fmtIntFloor`,
      `fmtMoneyWholeFloor`). Deleting the `≥` while keeping the constant is the
      cheapest way to silently undo this work.

  W3  NO MEASURED ZERO FOLDED INTO AN UNKNOWN. The shape `x > 0 ? fmt(x) : EM`
      is forbidden in the page tree. It is the literal pre-fix expression, it is
      syntactic, and it has no legitimate use here: a real zero renders as the
      zero, an absent figure renders as the dash, and `num()` already separates
      them. The same rule forbids a view-model FIELD whose unanswered branch is
      `[]` — restricted to object properties on purpose, because a helper that
      parses local storage and returns `[]` for a malformed value is reporting
      "no pins", which is a measurement rather than a silenced query.

  W4  UNKNOWN-CAPABLE FIELDS KEEP THEIR `| null`. The three fields whose whole
      job is to express "the query did not answer" must stay nullable. Widening
      `UnverifiedDelivery[] | null` back to `UnverifiedDelivery[]` is what let
      a failed fetch render as "nothing uncounted".

  W5  A CAPPED FETCH MAY NOT DISCARD ITS OWN CARDINALITY. A `queryFn` that
      sends a `limit` must read `total` or `hasMore` from the response. This is
      the closest honest approximation of the stated rule that a command can
      hold: it does not prove the figure is floor-marked downstream, but it
      does prove the exact count was not thrown away at the door — which is the
      specific mistake that forced a page length to stand in for a total.

WHAT IT DOES NOT COVER, STATED PLAINLY
--------------------------------------
- It does not trace a value from a `.limit()` to a JSX node. See above.
- It does not verify that a floor marker is attached to the RIGHT figure. W2
  proves markers exist in a file that knows about windows; it cannot prove the
  `≥` sits on the windowed number rather than on a neighbouring one.
- It does not read the gateway's own rendering, or any other page. A second
  page repeating this defect is a second guard's job; conflating them would let
  a green run here be read as a stronger claim than it is.
- It cannot see a cap introduced by PostgREST defaults or by a database view.

SCOPE. `apps/web/src/pages/receiving/next` only, plus the gateway files the
register cites. Extending it to another page means adding that page's register.

NEVER VACUOUS
-------------
Exit 0 pass, 1 violation, **2 cannot check**. Exit 2 blocks in CI exactly like
exit 1. Every anchor this guard depends on — the register, the cited gateway
files, the `.limit(` calls inside them, the interfaces W4 reads — is verified to
exist before any rule is evaluated, because a guard that passes because its
anchor moved is a green check mark over an unexamined surface. That is how six
windowed figures shipped as totals in the first place.
"""

from __future__ import annotations

import argparse
import re
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

PAGE_DIR = Path("apps/web/src/pages/receiving/next")
HOOKS = PAGE_DIR / "useReceivingNextData.ts"
GATEWAY_ROOT = Path("apps/api-gateway/src")

RENDERERS = [
    PAGE_DIR / "RcStaffLane.tsx",
    PAGE_DIR / "RcManagerQueue.tsx",
    PAGE_DIR / "RcOwnerLedger.tsx",
    PAGE_DIR / "RcOutboxRail.tsx",
]

FLOOR_MARKERS = ("GE", "fmtIntFloor", "fmtMoneyWholeFloor")

# interface -> field -> the union member that expresses "did not answer"
NULLABLE_CONTRACT = {
    "ManagerQueueData": ["unverified"],
    "OutboxData": ["queued"],
    "QueueItemVM": ["atRisk", "openClaimsFloor"],
}

# `x > 0 ? something : EM` — a measured zero rendered as an unknown.
ZERO_AS_UNKNOWN = re.compile(r">\s*0\s*\?[^\n]{0,120}?:\s*EM\b")

# `unverified: known ? … : [],` — a VIEW-MODEL FIELD whose unanswered branch is
# an empty list. Deliberately restricted to an object property: a local helper
# that parses storage and returns `[]` for a malformed value is answering
# "there are no pins", which is a measurement, not a silenced query.
EMPTY_AS_UNKNOWN = re.compile(
    r"^\s*[A-Za-z_$][\w$]*:\s*[^\n]*?\?[^\n?]*?:\s*\[\]\s*,?\s*$", re.MULTILINE
)


class CannotCheck(Exception):
    """An anchor this guard depends on is missing. Never a silent skip."""


@dataclass
class Report:
    drift: list[str] = field(default_factory=list)
    unconsumed: list[str] = field(default_factory=list)
    zero_as_unknown: list[str] = field(default_factory=list)
    lost_null: list[str] = field(default_factory=list)
    discarded_count: list[str] = field(default_factory=list)

    def violations(self) -> list[str]:
        return (
            self.drift
            + self.unconsumed
            + self.zero_as_unknown
            + self.lost_null
            + self.discarded_count
        )


def read(root: Path, rel: Path) -> str:
    p = root / rel
    if not p.is_file():
        raise CannotCheck(f"anchor file is missing: {rel}")
    return p.read_text(encoding="utf-8")


# ── the register ─────────────────────────────────────────────────────────────

REGISTER_START = "export const SERVER_WINDOWS = {"
ENTRY = re.compile(r"^\s*([A-Z_]+):\s*(\d+),", re.MULTILINE)
CITE = re.compile(r"([A-Za-z0-9_.-]+\.ts):(\d+)")


def parse_register(src: str) -> list[tuple[str, int, str]]:
    """(key, cap, cited gateway file basename) for each declared window."""
    start = src.find(REGISTER_START)
    if start < 0:
        raise CannotCheck(
            f"`{REGISTER_START}` not found in {HOOKS} — the register this guard "
            "reads has been renamed or deleted."
        )
    end = src.find("} as const;", start)
    if end < 0:
        raise CannotCheck("SERVER_WINDOWS is not closed with `} as const;`")
    body = src[start + len(REGISTER_START) : end]

    out: list[tuple[str, int, str]] = []
    for m in ENTRY.finditer(body):
        key, cap = m.group(1), int(m.group(2))
        # The citation lives in the doc comment immediately above the entry.
        preceding = body[: m.start()]
        cites = CITE.findall(preceding)
        if not cites:
            raise CannotCheck(
                f"SERVER_WINDOWS.{key} declares a cap with no `<file>.ts:<line>` "
                "citation above it — the guard cannot tell which query imposes it."
            )
        out.append((key, cap, cites[-1][0]))

    if not out:
        raise CannotCheck(
            "SERVER_WINDOWS parsed to zero entries. Every rule below would pass "
            "vacuously, which is the exact failure this guard exists to prevent."
        )
    return out


def resolve_gateway(root: Path, basename: str) -> Path:
    hits = sorted((root / GATEWAY_ROOT).rglob(basename))
    if not hits:
        raise CannotCheck(
            f"cited gateway file `{basename}` does not exist under {GATEWAY_ROOT} — "
            "the citation is stale, so the declared cap cannot be verified."
        )
    return hits[0]


# ── W5: a capped fetch must keep its cardinality ─────────────────────────────


def query_bodies(src: str) -> list[str]:
    """Each `useQuery({ … })` argument, by brace matching."""
    bodies: list[str] = []
    for m in re.finditer(r"useQuery\(\s*\{", src):
        depth, i = 0, m.end() - 1
        while i < len(src):
            if src[i] == "{":
                depth += 1
            elif src[i] == "}":
                depth -= 1
                if depth == 0:
                    bodies.append(src[m.end() - 1 : i + 1])
                    break
            i += 1
    return bodies


def run(root: Path) -> Report:
    rep = Report()
    hooks_src = read(root, HOOKS)
    renderer_src = {r: read(root, r) for r in RENDERERS}

    windows = parse_register(hooks_src)

    # ── W1 — declared cap still matches the query that imposes it ────────────
    for key, cap, basename in windows:
        gateway = resolve_gateway(root, basename)
        text = gateway.read_text(encoding="utf-8")
        if ".limit(" not in text:
            raise CannotCheck(
                f"`{basename}` holds no `.limit(` at all, so SERVER_WINDOWS.{key} "
                "cannot be verified against it. The anchor moved — fix the citation, "
                "do not delete the entry."
            )
        if f".limit({cap})" not in text:
            found = sorted(set(re.findall(r"\.limit\((\d+)\)", text)))
            rep.drift.append(
                f"[window drift] SERVER_WINDOWS.{key} declares {cap} but {basename} "
                f"has no `.limit({cap})` (it has: {', '.join(found) or 'none'}). "
                "The page's floor prose now names a cap the server does not use."
            )

    # ── W2 — the register is consumed, and its consumers mark floors ─────────
    all_page = hooks_src + "".join(renderer_src.values())
    for key, _cap, _basename in windows:
        uses = len(re.findall(rf"SERVER_WINDOWS\.{key}\b", all_page))
        if uses == 0:
            rep.unconsumed.append(
                f"[unconsumed window] SERVER_WINDOWS.{key} is declared but never "
                "referenced. A cap nobody reads cannot be marking any figure."
            )
    for rel, src in renderer_src.items():
        if "SERVER_WINDOWS" in src and not any(mk in src for mk in FLOOR_MARKERS):
            rep.unconsumed.append(
                f"[no floor marker] {rel} knows about SERVER_WINDOWS but uses none of "
                f"{', '.join(FLOOR_MARKERS)}. ADR 0051 clause 2: a windowed count "
                "renders as a floor."
            )

    # ── W3 — a measured zero is not an unknown ───────────────────────────────
    for rel, src in list(renderer_src.items()) + [(HOOKS, hooks_src)]:
        for m in ZERO_AS_UNKNOWN.finditer(src):
            line = src[: m.start()].count("\n") + 1
            rep.zero_as_unknown.append(
                f"[zero as unknown] {rel}:{line} — `{m.group(0).strip()}` renders a "
                "MEASURED zero as the unknown dash. ADR 0051 clause 1: the two must "
                "be distinguishable. Use num() to get null-or-number and format that."
            )
    for m in EMPTY_AS_UNKNOWN.finditer(hooks_src):
        line = hooks_src[: m.start()].count("\n") + 1
        rep.zero_as_unknown.append(
            f"[empty as unknown] {HOOKS}:{line} — a conditional falls back to `[]`. "
            "In this file an unanswered query must be null, or a failed fetch renders "
            "as an empty list and a safety net goes silent when it is needed most."
        )

    # ── W4 — the unknown-capable fields keep their null ──────────────────────
    for iface, fields in NULLABLE_CONTRACT.items():
        m = re.search(rf"interface {iface}[^{{]*\{{(.*?)\n\}}", hooks_src, re.S)
        if not m:
            raise CannotCheck(
                f"interface {iface} not found in {HOOKS} — W4 has no contract to check."
            )
        body = m.group(1)
        for fname in fields:
            fm = re.search(rf"^\s*{fname}\s*:\s*([^;]+);", body, re.M)
            if not fm:
                raise CannotCheck(
                    f"{iface}.{fname} not found — the field W4 guards was renamed or "
                    "removed. Update the contract deliberately, do not drop the check."
                )
            if "null" not in fm.group(1):
                rep.lost_null.append(
                    f"[unknown lost] {iface}.{fname} is `{fm.group(1).strip()}` with no "
                    "`| null`. This field's job is to say the query did not answer; "
                    "without null it can only say 'empty', which is a measurement."
                )

    # ── W5 — a capped fetch keeps its own cardinality ────────────────────────
    for body in query_bodies(hooks_src):
        if "queryFn" not in body:
            continue
        if not re.search(r"\blimit\b", body):
            continue
        if not re.search(r"\btotal\b", body) and not re.search(r"\bhasMore\b", body):
            key = re.search(r"queryKey:\s*\[\s*'([^']+)'", body)
            name = key.group(1) if key else "an unnamed query"
            rep.discarded_count.append(
                f"[cardinality discarded] the `{name}` query sends a `limit` but reads "
                "neither `total` nor `hasMore` from the response. The exact count is "
                "sitting in the payload; without it the page can only render a page "
                "length, which is a window dressed as a total."
            )

    return rep


def verdict(rep: Report) -> str:
    return "clean" if not rep.violations() else "violation"


# ── self-test ────────────────────────────────────────────────────────────────

CLEAN_HOOKS = """
export const SERVER_WINDOWS = {
  /** receiving.service.ts:375 — the queue's own rows. */
  QUEUE_ITEMS: 100,
} as const;

export interface QueueItemVM {
  atRisk: number | null;
  openClaimsFloor: number | null;
}

export interface ManagerQueueData {
  unverified: UnverifiedDelivery[] | null;
}

export interface OutboxData {
  queued: QueuedReceiptVM[] | null;
}

export function useThing() {
  const q = useQuery({
    queryKey: ['receiving-next-open-orders', rid],
    queryFn: async () => {
      const { data } = await apiClient.get('/procurement/orders', { params: { limit: 25 } });
      return { orders: data?.orders ?? [], total: num(data?.total), hasMore: data?.hasMore === true };
    },
  });
  const itemsAtFloor = items.length >= SERVER_WINDOWS.QUEUE_ITEMS;
  return { itemsAtFloor };
}
"""

CLEAN_RENDERER = """
import { GE, fmtIntFloor, fmtMoneyWholeFloor } from './rc-format';
import { SERVER_WINDOWS } from './useReceivingNextData';
export function R() {
  return <span title={`cap ${SERVER_WINDOWS.QUEUE_ITEMS}`}>{fmtIntFloor(n, atFloor)}{GE}</span>;
}
"""

CLEAN_GATEWAY = """
export class ReceivingService {
  async managerQueue() {
    return this.db.from("x").select("*").limit(100);
  }
}
"""


def _scaffold(tmp: Path) -> None:
    (tmp / PAGE_DIR).mkdir(parents=True, exist_ok=True)
    (tmp / GATEWAY_ROOT / "procurement").mkdir(parents=True, exist_ok=True)
    (tmp / HOOKS).write_text(CLEAN_HOOKS, encoding="utf-8")
    for r in RENDERERS:
        (tmp / r).write_text(CLEAN_RENDERER, encoding="utf-8")
    (tmp / GATEWAY_ROOT / "procurement" / "receiving.service.ts").write_text(
        CLEAN_GATEWAY, encoding="utf-8"
    )


def self_test() -> int:
    failures: list[str] = []

    def case(name: str, mutate, expect: str) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _scaffold(tmp)
            mutate(tmp)
            try:
                rep = run(tmp)
            except CannotCheck as exc:
                got, detail = "cannot-check", str(exc)
            else:
                got, detail = verdict(rep), "; ".join(rep.violations())
            ok = got == expect
            print(f"   {'ok  ' if ok else 'FAIL'}  {name}: expected {expect}, got {got}")
            if detail and (not ok or got != "clean"):
                print(f"           {detail.splitlines()[0][:150]}")
            if not ok:
                failures.append(name)

    print("== SELF-TEST — the guard must fire on the shapes it exists to catch\n")

    case("clean tree passes", lambda _: None, "clean")

    case(
        "W1 the server cap moved and the register did not",
        lambda t: (t / GATEWAY_ROOT / "procurement" / "receiving.service.ts").write_text(
            CLEAN_GATEWAY.replace("limit(100)", "limit(250)"), encoding="utf-8"
        ),
        "violation",
    )
    case(
        "W2 the floor markers were deleted from a renderer",
        lambda t: (t / RENDERERS[1]).write_text(
            "import { SERVER_WINDOWS } from './useReceivingNextData';\n"
            "export function R() { return <span>{n}</span>; }\n",
            encoding="utf-8",
        ),
        "violation",
    )
    def orphan_the_window(t: Path) -> None:
        # The constant survives; every reader of it is replaced by a literal —
        # which is how a cap stops governing anything while still looking cited.
        (t / HOOKS).write_text(
            CLEAN_HOOKS.replace("SERVER_WINDOWS.QUEUE_ITEMS", "999"), encoding="utf-8"
        )
        for r in RENDERERS:
            (t / r).write_text(
                CLEAN_RENDERER.replace("SERVER_WINDOWS.QUEUE_ITEMS", "999").replace(
                    "import { SERVER_WINDOWS } from './useReceivingNextData';\n", ""
                ),
                encoding="utf-8",
            )

    case("W2 a declared window nobody reads", orphan_the_window, "violation")
    case(
        "W3 a measured zero rendered as the unknown dash",
        lambda t: (t / RENDERERS[1]).write_text(
            CLEAN_RENDERER.replace(
                "{fmtIntFloor(n, atFloor)}",
                "{item.dollarsAtRisk > 0 ? fmtMoneyWhole(item.dollarsAtRisk) : EM}",
            ),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W3 a view-model field whose unanswered branch is an empty list",
        lambda t: (t / HOOKS).write_text(
            CLEAN_HOOKS.replace(
                "  return { itemsAtFloor };",
                "  return {\n    unverified: known ? q.data!.unverified ?? [] : [],\n"
                "    itemsAtFloor,\n  };",
            ),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W3 does NOT fire on a storage parser that returns [] for a bad value",
        lambda t: (t / HOOKS).write_text(
            CLEAN_HOOKS.replace(
                "  const itemsAtFloor",
                "  const pins = Array.isArray(arr) ? (arr as Pin[]) : [];\n  const itemsAtFloor",
            ),
            encoding="utf-8",
        ),
        "clean",
    )
    case(
        "W4 the unknown state widened away",
        lambda t: (t / HOOKS).write_text(
            CLEAN_HOOKS.replace(
                "unverified: UnverifiedDelivery[] | null;", "unverified: UnverifiedDelivery[];"
            ),
            encoding="utf-8",
        ),
        "violation",
    )
    case(
        "W5 a capped fetch that discards total and hasMore",
        lambda t: (t / HOOKS).write_text(
            CLEAN_HOOKS.replace(
                "return { orders: data?.orders ?? [], total: num(data?.total), hasMore: data?.hasMore === true };",
                "return data?.orders ?? [];",
            ),
            encoding="utf-8",
        ),
        "violation",
    )

    print("\n-- and CANNOT CHECK must not read as a pass --\n")
    case(
        "the register was deleted",
        lambda t: (t / HOOKS).write_text("export const nothing = 1;\n", encoding="utf-8"),
        "cannot-check",
    )
    case(
        "the cited gateway file is gone",
        lambda t: (t / GATEWAY_ROOT / "procurement" / "receiving.service.ts").unlink(),
        "cannot-check",
    )
    case(
        "the cited file lost every .limit()",
        lambda t: (t / GATEWAY_ROOT / "procurement" / "receiving.service.ts").write_text(
            "export class ReceivingService {}\n", encoding="utf-8"
        ),
        "cannot-check",
    )
    case(
        "a guarded field was renamed",
        lambda t: (t / HOOKS).write_text(
            CLEAN_HOOKS.replace("unverified:", "uncounted:"), encoding="utf-8"
        ),
        "cannot-check",
    )
    case(
        "a renderer is missing",
        lambda t: (t / RENDERERS[2]).unlink(),
        "cannot-check",
    )

    print()
    if failures:
        print(f"SELF-TEST FAILED — {len(failures)} case(s): {', '.join(failures)}")
        return 1
    print("SELF-TEST PASSED — the guard fires on every shape above.")
    return 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Windowed figures render as floors.")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test()

    try:
        rep = run(REPO_ROOT)
    except CannotCheck as exc:
        print("CANNOT CHECK — this guard could not verify what it claims to.")
        print(f"   {exc}")
        print(
            "\n   Exit 2 blocks exactly like a violation, on purpose. Six windowed\n"
            "   figures shipped as totals on one page; a guard that passes because\n"
            "   its anchor moved would have been a green tick over all six."
        )
        return 2

    if rep.violations():
        print("WINDOWED FIGURES — violations found:\n")
        for v in rep.violations():
            print(f"  {v}\n")
        print(f"{len(rep.violations())} violation(s). See ADR 0051 clauses 1 and 2.")
        return 1

    print("Windowed figures: clean.")
    print("  Checked: declared caps match the queries they cite; every declared")
    print("  window is consumed and its renderers carry floor markers; no measured")
    print("  zero is folded into an unknown; the unknown-capable fields keep their")
    print("  null; no capped fetch discards its own total/hasMore.")
    print("  NOT checked: dataflow from a .limit() to a JSX node — undecidable here.")
    print("  See this file's header for the full boundary.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
