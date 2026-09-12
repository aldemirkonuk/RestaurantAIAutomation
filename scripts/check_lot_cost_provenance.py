#!/usr/bin/env python3
"""A price crossing into a lot must state its provenance (ADR 0079).

`apply_stock_movement` used to infer cost provenance from the mere presence of
a price:

    COALESCE(p_cost_provenance,
             CASE WHEN p_unit_cost IS NOT NULL THEN 'invoice' ELSE 'estimated' END)

so any caller passing a number without saying what KIND of number it was got
`'invoice'` for free. `markDelivered` passed the purchase order's own quoted
price that way, and the lot was stamped invoice-verified before anyone had read
a document. The RPC now raises instead of inferring. This is the static arm:
the RPC catches it at runtime on one row, this catches it at review time across
the whole repo, before it ships.

WHAT IS CHECKED
    1. Every `.rpc("apply_stock_movement", {...})` call site that passes
       `p_unit_cost` also passes `p_cost_provenance`.
    2. No `p_cost_provenance` is hard-coded to `'invoice'` on a path that has
       not read an invoice — enforced positively, by requiring every
       `"invoice"` provenance literal to sit at an allow-listed, justified
       location rather than by pattern-matching for suspicious ones.
    3. The migration that defines the RPC does not reintroduce the inference.

EXIT CODES
    0  checked, clean
    1  checked, violations found
    2  COULD NOT CHECK — the repo root is wrong, a file it must read is
       missing, or the scan examined zero call sites. Exit 2 is not a pass.

WHY 2 EXISTS, AND WHY THIS IS PYTHON
    `scripts/check_no_direct_stock_writes.sh` USED TO call
    `rg -n -P "$PATTERN" --type ts --type tsx ...`. `tsx` is not a ripgrep type
    (rg's `ts` type already covers *.ts, *.cts, *.mts and *.tsx), so rg exited 2
    with "unrecognized file type: tsx", `2>/dev/null || true` swallowed both the
    message and the status, `matches` came back empty, and the script printed
    "PASS -- no direct stock_live/shadow_stock writes outside the allowlist"
    having examined zero lines. Confirmed by running it on this tree, and that
    reading is why this file was written in Python with an exit 2 at all.

    It was repaired on 2026-09-02 by #243 and this PR jointly: the search is
    now `grep -rn -E` (present on ubuntu-latest and on a Mac, neither of which
    has ripgrep), the corpus is counted and asserted, and the search's exit
    status is inspected. So the sentence above is HISTORY, not a live defect —
    it is kept because deleting the reason a guard exists is how the next one
    gets written without it.

    That fault is the house fault: a checker that reports ABSENCE as HEALTH.
    This script therefore has no external tool to be wrong about, counts what it
    actually examined, and refuses to say "clean" from a scan that found
    nothing to scan.
"""

from __future__ import annotations

import argparse
import re
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

SCAN_ROOTS = ("apps/api-gateway/src", "apps/web/src", "apps/mobile/src", "services")
CODE_SUFFIXES = (".ts", ".tsx", ".py")

RPC_NAME = "apply_stock_movement"

# The migration whose body must not carry the inference again.
RPC_MIGRATION_GLOB = "supabase/migrations/*_lot_cost_truth.sql"
INFERENCE = re.compile(
    r"CASE\s+WHEN\s+p_unit_cost\s+IS\s+NOT\s+NULL\s+THEN\s+'invoice'", re.I
)

# --------------------------------------------------------------------------
# Allow-lists. Both are exact paths with a written reason, and both are
# ASSERTED TO STILL BE LIVE by --self-test, so an exemption cannot outlive the
# thing it was granted for.
# --------------------------------------------------------------------------

# Call sites that pass p_unit_cost with no p_cost_provenance.
MUTE_PRICE_ALLOWLIST = {
    # `p_unit_cost: dto.unitCost || null`. `unitCost` is an optional field on
    # CreateTransactionDto that no client in this repo sets (zero occurrences
    # across apps/web/src and apps/mobile/src), and production
    # inventory_transactions holds 4 rows from sources manual and order only,
    # so no live path reaches it. Owned by a concurrent inventory-ledger
    # rework; exempted by name rather than hidden by a pattern. Fixing it is
    # adding one `p_cost_provenance` key.
    "apps/api-gateway/src/inventory-ledger/inventory-ledger.service.ts",
}

# The only places allowed to assert `'invoice'`: a document was actually read.
INVOICE_PROVENANCE_ALLOWLIST = {
    # applyReceiptAdjustment. `computeMatch` returns effectiveUnitCost = null
    # unless an invoice quantity AND price were supplied by a human verifying
    # the delivery, so a non-null cost here means paper was read.
    "apps/api-gateway/src/procurement/procurement.service.ts",
}


class CouldNotCheck(Exception):
    """Raised when the scan cannot be trusted. Always exit 2."""


# --------------------------------------------------------------------------
# Scanning
# --------------------------------------------------------------------------


def code_files(root: Path) -> list[Path]:
    out: list[Path] = []
    for base in SCAN_ROOTS:
        d = root / base
        if not d.is_dir():
            continue
        for p in d.rglob("*"):
            if not p.is_file() or p.suffix not in CODE_SUFFIXES:
                continue
            parts = set(p.parts)
            if "node_modules" in parts or "dist" in parts or "__pycache__" in parts:
                continue
            out.append(p)
    return out


def rpc_call_bodies(text: str, name: str) -> list[tuple[int, str]]:
    """Every `"<name>"` ... `{ ... }` argument object, brace-matched.

    Brace matching rather than a regex so a nested object, an array or a
    template literal cannot truncate the block and hide a key that is present.
    """
    out: list[tuple[int, str]] = []
    for m in re.finditer(rf'["\']{re.escape(name)}["\']', text):
        open_i = text.find("{", m.end())
        if open_i == -1:
            continue
        depth = 0
        close_i = -1
        for i in range(open_i, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    close_i = i
                    break
        if close_i == -1:
            continue
        line = text.count("\n", 0, m.start()) + 1
        out.append((line, text[open_i : close_i + 1]))
    return out


class Report:
    def __init__(self) -> None:
        self.files_scanned = 0
        self.calls_seen = 0
        self.calls_with_price = 0
        self.mute: list[str] = []
        self.mute_exempted: list[str] = []
        self.invoice_claims: list[str] = []
        self.invoice_exempted: list[str] = []
        self.inference: list[str] = []


def scan(root: Path) -> Report:
    r = Report()
    files = code_files(root)
    if not files:
        raise CouldNotCheck(
            f"no source files found under {root} — expected roots: {', '.join(SCAN_ROOTS)}"
        )

    for path in files:
        rel = path.relative_to(root).as_posix()
        if rel.endswith((".spec.ts", ".test.ts")) or "/tests/" in rel:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            raise CouldNotCheck(f"could not read {rel}: {exc}") from exc
        r.files_scanned += 1

        if RPC_NAME not in text:
            continue

        for line, body in rpc_call_bodies(text, RPC_NAME):
            r.calls_seen += 1
            if not re.search(r"\bp_unit_cost\b\s*:", body):
                continue
            r.calls_with_price += 1
            if not re.search(r"\bp_cost_provenance\b\s*:", body):
                where = f"{rel}:{line}"
                (r.mute_exempted if rel in MUTE_PRICE_ALLOWLIST else r.mute).append(where)

        for m in re.finditer(
            r"\bp_cost_provenance\b\s*:[^,\n]*?[\"']invoice[\"']", text
        ):
            line = text.count("\n", 0, m.start()) + 1
            where = f"{rel}:{line}"
            target = (
                r.invoice_exempted
                if rel in INVOICE_PROVENANCE_ALLOWLIST
                else r.invoice_claims
            )
            target.append(where)

    # The RPC must not re-acquire the inference it was stripped of.
    migrations = sorted(root.glob(RPC_MIGRATION_GLOB))
    if not migrations:
        raise CouldNotCheck(
            f"no migration matching {RPC_MIGRATION_GLOB} — the RPC definition this "
            "guard checks is missing, so nothing here can be verified"
        )
    for mig in migrations:
        text = mig.read_text(encoding="utf-8")
        body = text[text.find("LANGUAGE plpgsql") :] if "LANGUAGE plpgsql" in text else text
        for m in INFERENCE.finditer(body):
            line = body.count("\n", 0, m.start()) + text[: text.find("LANGUAGE plpgsql")].count("\n") + 1
            r.inference.append(f"{mig.relative_to(root).as_posix()}:{line}")

    if r.calls_seen == 0:
        raise CouldNotCheck(
            f"scanned {r.files_scanned} file(s) and found zero `{RPC_NAME}` call "
            "sites. The repo has several; finding none means the scan is broken, "
            "not that the tree is clean."
        )
    return r


# --------------------------------------------------------------------------
# Self-test
# --------------------------------------------------------------------------


def self_test() -> int:
    """Prove the guard both (a) detects a violation and (b) sees the real tree.

    (b) is the half that matters and the half the shell guard skipped. A
    matcher that works perfectly on a fixture proves nothing if it is pointed
    at nothing in production use.
    """
    failures: list[str] = []

    # (a) DETECTION — a synthetic tree containing exactly one mute price.
    with tempfile.TemporaryDirectory() as tmp:
        fake = Path(tmp)
        src = fake / "apps/api-gateway/src/procurement"
        src.mkdir(parents=True)
        (src / "bad.ts").write_text(
            'await db.rpc("apply_stock_movement", {\n'
            "  p_inventory_id: id,\n"
            "  p_delta: 6,\n"
            "  p_unit_cost: row.final_price,\n"
            "  p_metadata: { nested: { deep: true } },\n"
            "});\n",
            encoding="utf-8",
        )
        mig = fake / "supabase/migrations"
        mig.mkdir(parents=True)
        (mig / "20260902150000_lot_cost_truth.sql").write_text(
            "CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN END; $$;\n",
            encoding="utf-8",
        )
        try:
            rep = scan(fake)
        except CouldNotCheck as exc:
            failures.append(f"detection: scan refused a valid fixture: {exc}")
        else:
            if rep.mute != ["apps/api-gateway/src/procurement/bad.ts:1"]:
                failures.append(f"detection: expected 1 mute price, got {rep.mute}")
            if rep.calls_with_price != 1:
                failures.append(
                    f"detection: brace matcher lost the nested object "
                    f"(calls_with_price={rep.calls_with_price})"
                )

    # (a2) The inference must be detectable if it comes back.
    with tempfile.TemporaryDirectory() as tmp:
        fake = Path(tmp)
        src = fake / "apps/api-gateway/src/x"
        src.mkdir(parents=True)
        (src / "ok.ts").write_text(
            'db.rpc("apply_stock_movement", { p_unit_cost: c, p_cost_provenance: p });\n',
            encoding="utf-8",
        )
        mig = fake / "supabase/migrations"
        mig.mkdir(parents=True)
        (mig / "20260902150000_lot_cost_truth.sql").write_text(
            "CREATE FUNCTION f() RETURNS uuid LANGUAGE plpgsql AS $$\nBEGIN\n"
            "  v := COALESCE(p_cost_provenance,\n"
            "       CASE WHEN p_unit_cost IS NOT NULL THEN 'invoice' ELSE 'estimated' END);\n"
            "END; $$;\n",
            encoding="utf-8",
        )
        rep = scan(fake)
        if not rep.inference:
            failures.append("detection: the reintroduced 'invoice' inference was not caught")
        if rep.mute:
            failures.append(f"detection: false positive on a compliant call: {rep.mute}")

    # (b) NOT VACUOUS — an empty tree must exit 2, never 0.
    with tempfile.TemporaryDirectory() as tmp:
        try:
            scan(Path(tmp))
        except CouldNotCheck:
            pass
        else:
            failures.append("vacuity: an empty tree was reported as clean instead of exit 2")

    # (b2) THE REAL TREE — the guard must actually reach this repo's call sites.
    try:
        real = scan(REPO)
    except CouldNotCheck as exc:
        failures.append(f"real tree: could not check: {exc}")
    else:
        if real.files_scanned < 100:
            failures.append(
                f"real tree: only {real.files_scanned} file(s) scanned — the walk is not "
                "reaching the codebase"
            )
        if real.calls_seen < 6:
            failures.append(
                f"real tree: only {real.calls_seen} {RPC_NAME} call site(s) found; "
                "this repo has at least 6"
            )
        if real.calls_with_price < 3:
            failures.append(
                f"real tree: only {real.calls_with_price} call site(s) pass a price; "
                "expected at least 3 (inventory.service.ts x3)"
            )
        # Every allow-list entry must still be a real, live exemption.
        if not real.mute_exempted:
            failures.append(
                "allowlist: MUTE_PRICE_ALLOWLIST names a call site that no longer "
                "passes a mute price. Delete the entry."
            )
        if not real.invoice_exempted:
            failures.append(
                "allowlist: INVOICE_PROVENANCE_ALLOWLIST names a file that no longer "
                "asserts 'invoice'. Delete the entry."
            )

    if failures:
        print("SELF-TEST FAILED:")
        for f in failures:
            print(f"  - {f}")
        return 1

    print(
        "SELF-TEST PASSED — the guard detects a mute price, detects a reintroduced "
        "inference, refuses an empty tree with exit 2, and demonstrably reaches this "
        f"repo ({real.files_scanned} files, {real.calls_seen} {RPC_NAME} call sites, "
        f"{real.calls_with_price} of them carrying a price)."
    )
    return 0


# --------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--self-test",
        action="store_true",
        help="prove the guard detects violations AND sees the real tree",
    )
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    try:
        r = scan(REPO)
    except CouldNotCheck as exc:
        print(f"COULD NOT CHECK: {exc}")
        print("Exit 2. This is not a pass.")
        return 2

    bad = bool(r.mute or r.invoice_claims or r.inference)

    if r.mute:
        print("FAIL: a price crosses into a lot without stating its provenance:")
        for w in r.mute:
            print(f"  {w}")
        print(
            "\nFix: add `p_cost_provenance` — 'invoice' (a document was read), "
            "'manual' (a person typed it), 'estimated' (nobody has verified it) "
            "or 'sample' (it was free). apply_stock_movement now raises rather "
            "than defaulting to 'invoice'.\n"
        )

    if r.invoice_claims:
        print("FAIL: 'invoice' provenance asserted outside an invoice-reading path:")
        for w in r.invoice_claims:
            print(f"  {w}")
        print(
            "\n'invoice' means a human compared a vendor document against the "
            "delivery. A quoted or expected price is 'estimated'. If this path "
            "really does read an invoice, add it to "
            "INVOICE_PROVENANCE_ALLOWLIST with the reason.\n"
        )

    if r.inference:
        print("FAIL: apply_stock_movement infers 'invoice' from a price again:")
        for w in r.inference:
            print(f"  {w}")
        print("\nThis is the original defect. See ADR 0079.\n")

    coverage = (
        f"{r.files_scanned} file(s) scanned, {r.calls_seen} {RPC_NAME} call site(s), "
        f"{r.calls_with_price} carrying a price"
    )
    exempt = (
        f"; {len(r.mute_exempted)} mute-price exemption(s): "
        + ", ".join(r.mute_exempted)
        if r.mute_exempted
        else ""
    )

    if bad:
        print(f"Coverage: {coverage}{exempt}.")
        return 1

    print(f"PASS — every price crossing into a lot states its provenance. {coverage}{exempt}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
