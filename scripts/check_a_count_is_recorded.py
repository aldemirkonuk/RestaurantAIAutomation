#!/usr/bin/env python3
"""
Guard: A COUNT MUST BE RECORDED WHETHER OR NOT IT CHANGED ANYTHING.

ADR 0078 — a count is a record in its own right. Restores INVENTORY_SOTA_PLAN
decision D14 ("count is truth; the perpetual ledger is the audit trail"), which
the shipped code contradicted with no supersession on file.

THE FAULT THIS RATCHETS
=======================
Until 2026-09-02 a physical count that AGREED with the books wrote nothing at
all. Two shipped constraints combined to make agreement physically unrecordable:

  * set_stock_absolute returns NULL without writing when the delta is zero
    (supabase/migrations/20260805131000_stock_race_and_pour_idempotency.sql:45)
  * inventory_transactions carries CHECK (quantity_change <> 0)

So the ledger could only ever hold counts that DISAGREED, and any variance rate
computed over `transaction_type = 'reconciliation'` rows was 1.0 BY CONSTRUCTION
— a property of the schema that reads exactly like a measurement of the
restaurant. `reconcileInventory` went further and returned HTTP 400 ("No
adjustment needed - counts match") to a manager who had counted correctly.

This is the `absence-reported-as-health` shape: the successful case leaves no
trace, so the trace contains only failures, and every aggregate over it is wrong
although no row in it is.

WHAT THIS GUARD CHECKS — THREE ARMS
===================================
A. NO COUNT IS COMMITTED THROUGH A PRIMITIVE THAT CANNOT RECORD AGREEMENT.
   Any `rpc("set_stock_absolute" | "apply_stock_movement", {...})` whose argument
   object sets `p_transaction_type` to "reconciliation" is a count going through
   a write that vanishes on a zero delta. Count paths must call
   `record_stock_count`.

B. THE SANCTIONED PRIMITIVE RECORDS UNCONDITIONALLY.
   Inside `record_stock_count`, the `INSERT INTO public.stock_counts` must appear
   BEFORE any branch on the delta. Below that branch it would fire only when the
   count disagreed — the pre-fix state exactly.

C. THE TABLE CAN HOLD AGREEMENT.
   `stock_counts` must not carry a CHECK forbidding a zero variance, which is the
   literal shape of `inventory_transactions`' `quantity_change <> 0` and half of
   how this fault was built the first time.

WHAT IT DOES **NOT** CHECK — read before trusting a PASS
=======================================================
* IT CANNOT PROVE A ROW LANDS IN POSTGRES. Every arm is static. Proving the
  INSERT executes needs a live database, which CI does not have. A PASS means
  "the shipped code has the shape the ADR claims", never "a count was recorded".
* A NEW COUNT PATH USING A DIFFERENT TRANSACTION-TYPE STRING SLIPS PAST ARM A.
  The arm keys on the literal "reconciliation" because that is what both count
  paths use today. A path inventing `transaction_type: "stocktake"` is unseen.
* A DIRECT `INSERT INTO inventory_transactions` FROM SERVICE CODE IS NOT SEEN.
  apply_stock_movement is the only ledger writer today; that is enforced by
  scripts/check_no_direct_stock_writes.sh and not re-litigated here.
* PYTHON IS SCANNED, BUT NOTHING IN IT COMMITS A COUNT TODAY.
  services/agent-orchestrator/core/database.py:984 calls apply_stock_movement
  with transaction types 'purchase'/'adjustment' — stock moves, not counts. The
  arm is armed over Python so a future count path there is caught; it currently
  has nothing to find, and that is stated rather than counted as evidence.

WHY THIS IS PYTHON AND NOT A ripgrep PIPELINE
=============================================
scripts/check_no_direct_stock_writes.sh:63 called `rg --type tsx`. There is no
ripgrep type named `tsx`; rg exits 2 with "unrecognized file type", the
`2>/dev/null || true` on that line swallowed it, `matches` came back empty, and
the script printed **PASS having examined zero lines**. Measured on this tree,
2026-09-02. (That script is fixed in the same commit as this one.)

An external search binary is a dependency whose failure looks exactly like
success. Reading the files here removes that failure mode entirely: a file that
cannot be read raises, and the corpus size is asserted before any count is
interpreted.

EXIT CODES
==========
  0  checked, and every arm held
  1  a violation — printed with file:line
  2  COULD NOT CHECK. Reserved and load-bearing: a guard whose corpus is empty
     returns the same answer as a guard that looked and found health.

Usage:  python3 scripts/check_a_count_is_recorded.py [--self-test]
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SCAN_DIRS = [
    "apps/api-gateway/src",
    "apps/web/src",
    "services/agent-orchestrator",
]
SUFFIXES = {".ts", ".tsx", ".py"}
TEST_MARKERS = (".spec.", ".test.", "/tests/", "/__tests__/")

MIGRATION_GLOB = "supabase/migrations/*_a_count_is_a_record.sql"

# A minimum the corpus must clear before any count over it is believed. Measured
# on 2026-09-02: 1,196 files. A tenth of that is not this repo.
MIN_CORPUS = 100

# Arm A. Walks from an rpc() call on one of the two vanishing-write primitives
# through its (bounded, non-greedy) argument object and requires
# p_transaction_type = "reconciliation" inside it. DOTALL because the argument
# object is always multi-line in this codebase.
VANISHING_COUNT = re.compile(
    r'rpc\(\s*\n?\s*["\'](?P<fn>set_stock_absolute|apply_stock_movement)["\']'
    r'(?:(?!\brpc\().){0,900}?'
    r'["\']?p_transaction_type["\']?\s*:\s*["\']reconciliation["\']',
    re.DOTALL,
)

SANCTIONED = re.compile(r'rpc\(\s*\n?\s*["\']record_stock_count["\']')

FUNC_START = re.compile(
    r"create\s+or\s+replace\s+function\s+public\.record_stock_count", re.I
)
COUNT_INSERT = re.compile(r"INSERT\s+INTO\s+public\.stock_counts", re.I)
DELTA_BRANCH = re.compile(r"^\s*IF\b.*\bv_delta\b", re.I | re.M)
ZERO_VARIANCE_CHECK = re.compile(
    r"check\s*\([^)]*variance[^)]*(?:<>|!=)\s*0", re.I
)


class CannotCheck(Exception):
    """The guard could not examine what it claims to examine."""


def collect(dirs: list[str]) -> list[Path]:
    """Every scannable, non-test source file under `dirs`.

    Raises CannotCheck rather than returning an empty list, because an empty
    corpus and a healthy corpus must never produce the same answer.
    """
    files: list[Path] = []
    roots_present = []
    for d in dirs:
        p = (ROOT / d) if not Path(d).is_absolute() else Path(d)
        if p.is_dir():
            roots_present.append(p)
    if not roots_present:
        raise CannotCheck(f"none of the scan roots exist: {dirs}")

    for root in roots_present:
        for f in root.rglob("*"):
            if not f.is_file() or f.suffix not in SUFFIXES:
                continue
            s = f.as_posix()
            if "node_modules" in s or any(m in s for m in TEST_MARKERS):
                continue
            files.append(f)
    return files


def read(f: Path) -> str:
    # No blanket `except: return ""`. A file that cannot be read is a hole in the
    # corpus, and a hole must not read as clean.
    return f.read_text(encoding="utf-8", errors="strict")


def arm_a(files: list[Path]) -> tuple[list[str], int]:
    """Returns (violations, number of sanctioned call sites)."""
    violations: list[str] = []
    sanctioned = 0
    for f in files:
        try:
            text = read(f)
        except (UnicodeDecodeError, OSError) as e:
            raise CannotCheck(f"unreadable file in corpus: {f} ({e})") from e
        sanctioned += len(SANCTIONED.findall(text))
        for m in VANISHING_COUNT.finditer(text):
            line = text[: m.start()].count("\n") + 1
            rel = f.relative_to(ROOT).as_posix()
            violations.append(f"{rel}:{line}: count committed via {m.group('fn')}")
    return violations, sanctioned


def arm_b() -> tuple[list[str], str]:
    """Returns (violations, a one-line note about what was measured)."""
    migs = sorted(ROOT.glob(MIGRATION_GLOB))
    if not migs:
        return (
            [
                f"no migration matching {MIGRATION_GLOB} — record_stock_count is the "
                "only primitive allowed to commit a count, and without it nothing "
                "records a count that agreed"
            ],
            "no migration",
        )
    mig = migs[0]
    sql = read(mig)
    start = FUNC_START.search(sql)
    if not start:
        return ([f"{mig.name} does not define record_stock_count"], "no function")

    body = sql[start.start():]
    ins = COUNT_INSERT.search(body)
    if not ins:
        return (
            [
                f"{mig.name}: record_stock_count never INSERTs into stock_counts — the "
                "count would exist only as a side effect of a movement, which is the "
                "pre-ADR 0078 state"
            ],
            "no insert",
        )
    branch = DELTA_BRANCH.search(body)
    if not branch:
        # Nothing can gate the insert. Report the absence explicitly instead of
        # letting it pass as if it had been checked.
        return ([], "no delta branch in the function; the INSERT cannot be gated")

    ins_line = body[: ins.start()].count("\n") + 1
    br_line = body[: branch.start()].count("\n") + 1
    if ins_line >= br_line:
        return (
            [
                f"{mig.name}: the stock_counts INSERT (function line {ins_line}) is at or "
                f"below the delta branch (line {br_line}). Below the branch the row is "
                "written only when the count DISAGREED — the exact state ADR 0078 removed"
            ],
            f"INSERT line {ins_line}, branch line {br_line}",
        )
    return ([], f"INSERT at function line {ins_line}, delta branch at {br_line}")


def arm_c() -> list[str]:
    migs = sorted(ROOT.glob(MIGRATION_GLOB))
    if not migs:
        return []  # arm B already reported the absence
    sql = read(migs[0])
    if ZERO_VARIANCE_CHECK.search(sql):
        return [
            f"{migs[0].name}: stock_counts carries a CHECK forbidding a zero variance — "
            "the exact shape of inventory_transactions' CHECK (quantity_change <> 0), "
            "which is half of how a count that agreed became unrepresentable"
        ]
    return []


def run() -> int:
    files = collect(SCAN_DIRS)
    if len(files) < MIN_CORPUS:
        raise CannotCheck(
            f"corpus is {len(files)} files (minimum {MIN_CORPUS}); that is not this repo"
        )

    a_viol, sanctioned = arm_a(files)
    if sanctioned == 0:
        # Zero count paths means the arm is asserting nothing about anything.
        raise CannotCheck(
            f"zero record_stock_count call sites across {len(files)} files — either every "
            "count path was removed, or this scan cannot see the tree"
        )
    b_viol, b_note = arm_b()
    c_viol = arm_c()

    failed = False
    if a_viol:
        failed = True
        print("FAIL (arm A) — a count is committed through a write that VANISHES on a zero delta:")
        for v in a_viol:
            print(f"  {v}")
        print()
        print("  set_stock_absolute returns NULL when the delta is 0 and inventory_transactions")
        print("  CHECKs quantity_change <> 0, so a count that agreed leaves no trace and the")
        print("  variance rate over these rows is 1.0 by construction.")
        print("  Fix: call record_stock_count (ADR 0078) — it records the count first and")
        print("  applies a movement only as a consequence of a non-zero difference.")
        print()
    if b_viol:
        failed = True
        print("FAIL (arm B) — the count primitive does not record unconditionally:")
        for v in b_viol:
            print(f"  {v}")
        print()
    if c_viol:
        failed = True
        print("FAIL (arm C) — the table cannot hold agreement:")
        for v in c_viol:
            print(f"  {v}")
        print()

    if failed:
        return 1

    print("PASS — a count is recorded whether or not it changed anything.")
    print(f"  corpus:      {len(files)} files under {', '.join(SCAN_DIRS)}")
    print(f"  count paths: {sanctioned} record_stock_count call site(s), 0 through a vanishing write")
    print(f"  primitive:   {b_note}")
    print("  static only: this proves the SHAPE of the shipped code, never that a row reached Postgres.")
    return 0


# ---------------------------------------------------------------------------
# --self-test
#
# Two halves, and both are required. Proving the guard reacts to a synthetic
# string proves only that the regex compiles. The half that actually matters —
# and the half `check_no_direct_stock_writes.sh` was missing when it printed PASS
# over zero lines — is proving the search REACHES THE REAL TREE.
# ---------------------------------------------------------------------------
def self_test() -> int:
    failures = 0

    print("self-test 1/5 — the corpus is the real tree, and the arms read it")
    try:
        files = collect(SCAN_DIRS)
    except CannotCheck as e:
        print(f"  FAIL — {e}")
        return 1
    print(f"  corpus: {len(files)} files")
    if len(files) < MIN_CORPUS:
        print(f"  FAIL — below the {MIN_CORPUS}-file floor; the guard is looking at nothing")
        failures += 1
    anchors = [
        f.relative_to(ROOT).as_posix()
        for f in files
        if SANCTIONED.search(read(f))
    ]
    if not anchors:
        print("  FAIL — arm A's own pattern finds ZERO real call sites in the real tree.")
        failures += 1
    else:
        print(f"  ok — arm A's pattern reads real files: {', '.join(anchors)}")

    print("self-test 2/5 — arm A fires on the PRE-FIX call shape")
    # Verbatim in shape from inventory.service.ts before ADR 0078.
    prefix_src = '''
    const { error: rpcErr } = await client.rpc("set_stock_absolute", {
      p_inventory_id: inventoryId,
      p_stock_state: stockState,
      p_target_qty: Math.round(Number(dto.countedQty)),
      p_transaction_type: "reconciliation",
      p_source: "mobile_count",
      p_idempotency_key: idempotencyKey,
    });
    '''
    if not VANISHING_COUNT.search(prefix_src):
        print("  FAIL — arm A did NOT flag the pre-fix call shape")
        failures += 1
    else:
        print("  ok — arm A flags it")

    print("self-test 3/5 — arm A does NOT fire on the post-fix call shape")
    postfix_src = '''
    const { data, error } = await client.rpc("record_stock_count", {
      p_inventory_id: inventoryId,
      p_counted_qty: 8,
      p_idempotency_key: idempotencyKey,
      p_transaction_type: "reconciliation",
      p_source: "mobile_count",
    });
    '''
    if VANISHING_COUNT.search(postfix_src):
        print("  FAIL — arm A flags the sanctioned primitive; it would block the fix")
        failures += 1
    else:
        print("  ok — the sanctioned primitive passes")

    print("self-test 4/5 — arm B's ordering test rejects the inverse ordering")
    migs = sorted(ROOT.glob(MIGRATION_GLOB))
    if not migs:
        print("  FAIL — no migration to test arm B against")
        failures += 1
    else:
        body = read(migs[0])[FUNC_START.search(read(migs[0])).start():]
        ins = COUNT_INSERT.search(body)
        br = DELTA_BRANCH.search(body)
        if not ins or not br:
            print("  FAIL — arm B's two anchors are not both present in the real migration")
            failures += 1
        else:
            ins_line = body[: ins.start()].count("\n") + 1
            br_line = body[: br.start()].count("\n") + 1
            # Build the inverse by swapping the two statements and re-running the
            # exact comparison the arm uses. Not a description of the failure —
            # the failure path executed.
            swapped = body.replace(
                ins.group(0), "@@INS@@", 1
            ).replace(br.group(0), ins.group(0), 1).replace("@@INS@@", br.group(0), 1)
            s_ins = COUNT_INSERT.search(swapped)
            s_br = DELTA_BRANCH.search(swapped)
            if not s_ins or not s_br:
                print("  FAIL — could not construct the inverse ordering")
                failures += 1
            else:
                s_ins_line = swapped[: s_ins.start()].count("\n") + 1
                s_br_line = swapped[: s_br.start()].count("\n") + 1
                if ins_line >= br_line:
                    print(f"  FAIL — the real migration already violates arm B ({ins_line} >= {br_line})")
                    failures += 1
                elif s_ins_line < s_br_line:
                    print("  FAIL — the swapped ordering still passes; the arm is inert")
                    failures += 1
                else:
                    print(
                        f"  ok — real: INSERT {ins_line} < branch {br_line}; "
                        f"swapped: INSERT {s_ins_line} >= branch {s_br_line} -> would FAIL"
                    )

    print("self-test 5/5 — an empty or missing corpus is CANNOT CHECK, not PASS")
    import tempfile

    # (a) a root that does not exist at all — collect() must refuse.
    try:
        collect(["/nonexistent/scan/root/for/self/test"])
        print("  FAIL — a missing scan root produced a corpus instead of raising")
        failures += 1
    except CannotCheck as e:
        print(f"  ok — missing root raises: {e}")

    # (b) a root that exists but is empty — the FLOOR must catch it. Run the real
    # entry point against it so the exit-2 path executes rather than being
    # described.
    with tempfile.TemporaryDirectory() as tmp:
        saved = list(SCAN_DIRS)
        SCAN_DIRS[:] = [tmp]
        try:
            run()
            print("  FAIL — an empty corpus reached a verdict instead of CANNOT CHECK")
            failures += 1
        except CannotCheck as e:
            print(f"  ok — empty corpus raises (-> exit 2): {e}")
        finally:
            SCAN_DIRS[:] = saved

    print()
    if failures:
        print(f"SELF-TEST FAILED ({failures})")
        return 1
    print("SELF-TEST PASSED — the guard reads the real tree AND fires on the real fault.")
    return 0


if __name__ == "__main__":
    try:
        if "--self-test" in sys.argv[1:]:
            sys.exit(self_test())
        sys.exit(run())
    except CannotCheck as exc:
        print(f"CANNOT CHECK — {exc}")
        print("  This is exit 2, never a pass: a guard with nothing to look at gives the")
        print("  same answer as a guard that looked and found health.")
        sys.exit(2)
