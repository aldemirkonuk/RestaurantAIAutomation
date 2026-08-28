#!/usr/bin/env python3
"""
Guard: every OD id named in the planning corpus resolves to a row in the register.

WHY THIS EXISTS
---------------
On 2026-08-26 the design-foundation fork circulated as **OD-79** through 58
references across 52 files -- 47 page-note frontmatter comments, PAGES-MAP,
DESIGN-FOUNDATION, and a memory file. OD-79 is the *resolved* email-verification
decision (ADR 0023). Every one of those references pointed at a different,
closed decision, and the fork itself had no register row at all. It is filed as
OD-106 now.

`check_citation_pairing.py` did not catch it and could not: ADR 0025 Section 6 governs
citations that carry an id AND a `file:line`, and a bare `(OD-79)` in frontmatter
carries no locator, so it is not a citation under that rule. The two guards cover
different halves of the same failure:

    check_citation_pairing.py   an id + line that DISAGREE with each other
    this guard                  an id that names NOTHING

MERGES: A RETIRED ID IS NOT A DANGLING ID
-----------------------------------------
Added 2026-08-27, after this guard turned `main` red for a reason that was not a
defect. PR #132 merged two pairs of duplicate forks -- the same question filed
twice from two directions. OD-43 was absorbed into OD-26, OD-65 into OD-67, and
both retired rows were deleted from the register. Seven references to the retired
ids remained in `.planning/04-specs/REGISTER-AUDIT-2026-08-26.md`, a *dated
historical audit* that was correct on the day it was written and must stay as it
is. The guard read those as ids naming nothing.

They name something. The register says so, in the absorbing row's own body:

    | OD-26 | ... **Absorbs OD-43 (merged 2026-08-27)** -- the same fork filed
             again from the audit side; ... |

So the gap was in the guard, not the corpus: it knew an id could live in a row's
ID cell, and did not know an id could be *retired into* a row. It now reads the
absorbs declaration and resolves the retired id onto the absorbing row.

The alternatives, and why they lost:

  * Annotate the audit doc -- edit a dated historical record so a guard passes.
    That corrupts the one artifact whose value is being a snapshot of what was
    true on 2026-08-26. Rejected outright.
  * Exempt the audit doc via NAMESPACE_DOCS -- that set ships EMPTY and is
    shrink-only (see EXEMPTIONS). It would also silence every *future* dangling
    id in that file, which is the "machinery that structurally cannot report
    failure" shape this repo keeps finding.

THE ACCEPTED DECLARATION FORM, EXACTLY
--------------------------------------
    **Absorbs OD-43 (merged 2026-08-27)**

  * the literal word `Absorbs`, capital A
  * exactly one OD id
  * a parenthesised `(merged YYYY-MM-DD)` carrying an ISO date
  * the surrounding `**` is optional -- both real declarations bold it, but the
    bold is how it reads in the rendered table, not what makes it a declaration

Strict on purpose. Row bodies name other ids in ordinary prose all the time --
the OD-67 row says "OD-65's option set stands" one clause after declaring the
merge. A pattern that accepted any `OD-\\d+` inside a body, or `absorb` loosely
near an id, would let every id mentioned anywhere in the register resolve, and
this guard would quietly become a no-op that still prints PASS. `--self-test`
asserts that a bare prose mention does NOT resolve, precisely because that
regression would never announce itself.

Every resolution is PRINTED, with its reference count. A merge that silently
converted a failure into a pass would be the same defect wearing a fix's clothes.

WHAT THIS GUARD DOES NOT CATCH, said plainly
--------------------------------------------
An id that exists but means something else. OD-79 *existed*; it simply meant
email verification rather than design direction. Nothing mechanical here would
have flagged that, and pretending otherwise would be the exact
"machinery that structurally cannot report failure" shape this repo keeps
finding. What narrows that hole is the register row itself: a fork with a row
cannot silently borrow another fork's number, because filing the row is when the
collision surfaces. File the row first.

EXEMPTIONS
----------
None, and that is the point: the exemption set ships EMPTY. Two documents that
discuss fork-id namespaces (GLOSSARY, METRICS) looked like they would need one,
and did not -- their `OD-30 / OD-42` citations resolve to a real combined row.
Add a path here only when a document genuinely cites an id outside this register,
never to silence a real miss. Path-listed rather than pattern-matched, so adding
one shows up in a diff.

Exit codes:  0 pass  |  1 an id names nothing  |  2 cannot check
"""
import argparse
import io
import os
import re
import sys
from collections import Counter, defaultdict

REGISTER = ".planning/decisions/OPEN-DECISIONS.md"
ROOT = ".planning"

# Files that discuss fork-id NAMESPACES and cite ids outside the register on purpose.
# Path-listed rather than pattern-matched: adding one should show up in a diff.
NAMESPACE_DOCS: set[str] = set()

SKIP_DIR_PARTS = (".obsidian", "/archive")

# A table row: leading ID cell, then everything after it (the body).
ROW = re.compile(r"^\|([^|]*)\|(.*)$")

# The merge declaration. See "THE ACCEPTED DECLARATION FORM, EXACTLY" above --
# every part of this is load-bearing, and loosening any of it turns the guard off.
ABSORBS = re.compile(r"\*{0,2}Absorbs\s+OD-(\d+)\s+\(merged\s+(\d{4}-\d{2}-\d{2})\)")

OD_REF = re.compile(r"\bOD-(\d+)\b")


def ids_in_cell(cell: str) -> list[str]:
    """Every id an ID cell carries.

    One row can carry several. `| OD-30/42 |` is a real row -- the two forks were
    reconciled together and share one entry -- and `| OD-11a |` is another, where
    the suffix distinguishes a sub-decision. A parser that reads only the first
    plain id reports OD-42 as naming nothing, which is exactly the false positive
    that trains people to ignore this guard.

    Exported deliberately: `_od_collisions.py` needs the SAME answer to "which ids
    does this row own". Two files deriving that separately is how the two guards
    start disagreeing about the same register.
    """
    ids = ["OD-" + n for n in re.findall(r"OD-(\d+)", cell)]
    ids += ["OD-" + n for n in re.findall(r"(?<=/)(\d+)", cell)]
    return ids


def _read(path: str) -> str:
    """Read a file and close it. CodeQL flags `open(...).read()` as a leaked
    handle (`py/file-not-closed`) — CPython refcounting happens to close it, but
    a guard that lectures other files about being re-checkable should not rely
    on an implementation detail."""
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def parse_register(text: str) -> tuple[set[str], dict[str, tuple[str, str, int]]]:
    """Split the register into ids that OWN a row and ids RETIRED INTO one.

    Returns (rows, absorbed) where `absorbed` maps a retired id to
    (absorbing id, merge date, register line number).

    Asserted on directly by --self-test: the strictness of ABSORBS is the whole
    difference between this guard working and this guard printing PASS forever.
    """
    rows: set[str] = set()
    absorbed: dict[str, tuple[str, str, int]] = {}

    for lineno, line in enumerate(text.splitlines(), 1):
        m = ROW.match(line)
        if not m:
            continue
        cell, body = m.group(1), m.group(2)
        if "OD-" not in cell:
            continue
        ids = ids_in_cell(cell)
        if not ids:
            # `OD-` with no number behind it. Nothing to record, and the absorbs
            # lookup below needs a real absorbing id -- an IndexError here would
            # exit 1, which this guard's contract reserves for "an id names
            # nothing". A guard that misreports its own crash is worse than one
            # that fails.
            continue
        rows.update(ids)

        for am in ABSORBS.finditer(body):
            retired = "OD-" + am.group(1)
            # FIRST declaration wins, and a later one does not silently replace
            # it. `absorbed[x] = ...` made the answer depend on which absorbing
            # row happened to sit lower in the file, so a register with two rows
            # claiming one merge resolved every citation to whichever was later
            # -- chosen by line order, reported as fact. Detecting that case is
            # `_od_collisions.py`'s job (it fails the build); this only makes
            # sure the resolver's own answer is stable while it does.
            if retired not in absorbed:
                absorbed[retired] = (ids[0], am.group(2), lineno)

    return rows, absorbed


def scan_corpus(known: set[str]) -> tuple[int, dict[str, list[str]], Counter]:
    """Walk the corpus. Return (documents scanned, ids naming nothing, hits per id)."""
    missing: dict[str, list[str]] = defaultdict(list)
    hits: Counter = Counter()
    scanned = 0

    for dirpath, _dirnames, filenames in os.walk(ROOT):
        if any(part in dirpath for part in SKIP_DIR_PARTS):
            continue
        for name in filenames:
            if not name.endswith(".md"):
                continue
            path = os.path.join(dirpath, name)
            if os.path.abspath(path) == os.path.abspath(REGISTER):
                continue
            if path in NAMESPACE_DOCS:
                continue
            scanned += 1
            with open(path, encoding="utf-8", errors="ignore") as fh:
                for lineno, line in enumerate(fh, 1):
                    for m in OD_REF.finditer(line):
                        oid = "OD-" + m.group(1)
                        hits[oid] += 1
                        if oid not in known:
                            missing[oid].append(f"{path}:{lineno}")

    return scanned, missing, hits


def near_miss(reg_text: str, oid: str) -> str:
    """A hint for an id that IS in the register but resolves to no row.

    Without this, a merge declaration with a typo (`(merged yesterday)`) reads as
    an ordinary dangling id and the author has no way to see why -- the guard
    would be right and useless at the same time.
    """
    for lineno, line in enumerate(reg_text.splitlines(), 1):
        if re.search(rf"\b{re.escape(oid)}\b", line):
            return (
                f"      NOTE — {oid} appears at {REGISTER}:{lineno} but not in a row's ID\n"
                f"             cell and not as `**Absorbs {oid} (merged YYYY-MM-DD)**`."
            )
    return ""


def main() -> int:
    if not os.path.exists(REGISTER):
        print(f"CANNOT CHECK — {REGISTER} not found (run from the repo root)")
        return 2

    with open(REGISTER, encoding="utf-8") as fh:
        reg = fh.read()
    rows, absorbed = parse_register(reg)
    if not rows:
        print(f"CANNOT CHECK — no `| OD-NNN |` rows parsed out of {REGISTER}")
        return 2

    # An id cannot both own a row and be retired into another one: a reference to
    # it would resolve two ways. Whichever half is stale, the register is wrong.
    contradictions = sorted(absorbed.keys() & rows, key=lambda s: int(s.split("-")[1]))

    known = rows | set(absorbed)
    scanned, missing, hits = scan_corpus(known)

    print(
        f"== OD ids: {scanned} documents scanned against {len(rows)} register rows"
        + (f" (+{len(absorbed)} retired into a row)" if absorbed else "")
    )

    if absorbed:
        print(f"\n== MERGES ({len(absorbed)} retired id(s) resolve through an absorbs declaration)")
        for oid in sorted(absorbed, key=lambda s: int(s.split("-")[1])):
            into, when, lineno = absorbed[oid]
            n = hits[oid]
            print(
                f"   {oid} → {into} (absorbed {when}) — {REGISTER}:{lineno}"
                f" — {n} reference(s) in the corpus"
            )

    if contradictions:
        print(f"\n== RESOLVES TWO WAYS ({len(contradictions)} id(s))")
        for oid in contradictions:
            into, when, lineno = absorbed[oid]
            print(f"   {oid} — owns a row AND is declared absorbed into {into} at {REGISTER}:{lineno}")
        print(
            "\nFAIL — an id cannot both own a row and be retired into another one.\n"
            "   A reference to it resolves two ways. Delete the retired row, or\n"
            "   delete the absorbs declaration — whichever half is the stale one."
        )
        return 1

    if not missing:
        print("PASS — every OD id named in the corpus resolves to a row.")
        return 0

    total = sum(len(v) for v in missing.values())
    print(f"\n== NAMES NOTHING ({len(missing)} id(s), {total} reference(s))")
    for oid in sorted(missing, key=lambda s: int(s.split("-")[1])):
        print(f"   {oid} — no row in {REGISTER}")
        for ref in missing[oid][:6]:
            print(f"      {ref}")
        if len(missing[oid]) > 6:
            print(f"      … and {len(missing[oid]) - 6} more")
        hint = near_miss(reg, oid)
        if hint:
            print(hint)
    print(
        "\nFAIL — an OD id in the corpus names no register row.\n"
        "   Either the fork was never filed (file it, then cite the number you were\n"
        "   given), or the id was renumbered and the reference was left behind.\n"
        "   If the fork was MERGED into another, say so in the absorbing row:\n"
        "   `**Absorbs OD-43 (merged 2026-08-27)**` — do not edit the citing\n"
        "   document, and never exempt it.\n"
        "   Do NOT borrow a number that is already taken: that is how the\n"
        "   design-foundation fork spent a day pointing at email verification."
    )
    return 1


# ---------------------------------------------------------------------------
# --self-test
#
# Every invariant below fails SILENTLY if it regresses. A loosened ABSORBS pattern
# does not crash and does not turn CI red -- it makes every id mentioned anywhere in
# the register resolve, so the guard keeps printing PASS while checking nothing. That
# is the exact defect this repo keeps finding, so it is asserted rather than trusted.
#
# It runs against a synthetic register, so it needs no repository state and cannot be
# made to pass by the corpus happening to be clean today.
# ---------------------------------------------------------------------------
def self_test() -> int:
    import tempfile

    global REGISTER, ROOT
    real_register, real_root = REGISTER, ROOT
    failures: list[str] = []

    def build(tmp: str, body_extra: str = "", extra_rows: tuple[str, ...] = ()) -> str:
        """Synthetic register + corpus doc. Returns the corpus doc path."""
        # `global` does not reach into a nested function from the enclosing one, and
        # without this the repoint below is a local no-op -- the self-test then runs
        # against the REAL corpus and every invariant passes for the wrong reason.
        global REGISTER, ROOT
        planning = os.path.join(tmp, ".planning")
        decisions = os.path.join(planning, "decisions")
        os.makedirs(decisions, exist_ok=True)
        rows = [
            "# Open Decisions",
            "",
            "| ID | Question | Why | Shape |",
            "|---|---|---|---|",
            "| OD-26 | Ratchet question. **Absorbs OD-43 (merged 2026-08-27)** — the same "
            "fork filed again. " + body_extra + " | because | founder call |",
            "| OD-30/42 | A combined row. | because | founder call |",
        ]
        rows += list(extra_rows)
        reg = os.path.join(decisions, "OPEN-DECISIONS.md")
        with open(reg, "w", encoding="utf-8") as fh:
            fh.write("\n".join(rows) + "\n")
        REGISTER, ROOT = reg, planning
        return os.path.join(planning, "audit.md")

    def run(doc_text: str, doc_path: str) -> tuple[int, str]:
        with open(doc_path, "w", encoding="utf-8") as fh:
            fh.write(doc_text)
        buf = io.StringIO()
        real_stdout, sys.stdout = sys.stdout, buf
        try:
            code = main()
        finally:
            sys.stdout = real_stdout
        return code, buf.getvalue()

    # -- 1. an absorbs declaration resolves the retired id -------------------------
    with tempfile.TemporaryDirectory() as d:
        doc = build(d)
        _rows, absorbed = parse_register(_read(REGISTER))
        if absorbed.get("OD-43", (None,))[0] != "OD-26":
            failures.append("`**Absorbs OD-43 (merged 2026-08-27)**` did not resolve to OD-26")
        code, out = run("The audit found OD-43 duplicated OD-26.\n", doc)
        if code != 0:
            failures.append(f"a reference to an absorbed id failed the guard (exit {code})")
        if "OD-43 → OD-26" not in out:
            failures.append("the resolution was applied but NOT printed — a silent pass")
        if "1 reference(s)" not in out:
            failures.append("the resolution printed no reference count")

    # -- 2. a bare prose mention must NOT resolve an id ----------------------------
    #    The over-broad case. If this stops failing, the guard is a no-op.
    with tempfile.TemporaryDirectory() as d:
        doc = build(d, body_extra="OD-44's option set still stands, and OD-44 was absorbed.")
        _rows, absorbed = parse_register(_read(REGISTER))
        if "OD-44" in absorbed:
            failures.append("a bare prose mention of OD-44 in a row body RESOLVED it")
        code, out = run("The audit found OD-44.\n", doc)
        if code != 1:
            failures.append(f"a prose-only id did not fail the guard (exit {code})")
        if "NOTE — OD-44 appears at" not in out:
            failures.append("a prose-only id failed with no near-miss hint")

    # -- 3. a near-miss declaration must NOT resolve -------------------------------
    with tempfile.TemporaryDirectory() as d:
        doc = build(d, body_extra="Absorbs OD-45 (merged yesterday).")
        _rows, absorbed = parse_register(_read(REGISTER))
        if "OD-45" in absorbed:
            failures.append("`(merged yesterday)` was accepted as a merge date")
        code, _out = run("The audit found OD-45.\n", doc)
        if code != 1:
            failures.append(f"a malformed absorbs declaration did not fail (exit {code})")

    # -- 4. a genuinely dangling id still fails ------------------------------------
    with tempfile.TemporaryDirectory() as d:
        doc = build(d)
        code, out = run("A stray OD-999 that exists nowhere.\n", doc)
        if code != 1:
            failures.append(f"a dangling id did not fail the guard (exit {code})")
        if "NAMES NOTHING" not in out or "OD-999" not in out:
            failures.append("a dangling id failed without being named in the output")
        if "NOTE — OD-999" in out:
            failures.append("an id absent from the register got a near-miss hint anyway")

    # -- 5. combined rows still resolve both halves --------------------------------
    with tempfile.TemporaryDirectory() as d:
        doc = build(d)
        code, _out = run("See OD-30 and OD-42.\n", doc)
        if code != 0:
            failures.append(f"a `| OD-30/42 |` combined row stopped resolving (exit {code})")

    # -- 6. an id that owns a row AND is absorbed must fail ------------------------
    with tempfile.TemporaryDirectory() as d:
        doc = build(d, extra_rows=("| OD-43 | The row that was supposed to be gone. | x | y |",))
        code, out = run("The audit found OD-43.\n", doc)
        if code != 1:
            failures.append(f"an id owning a row AND absorbed elsewhere passed (exit {code})")
        if "RESOLVES TWO WAYS" not in out:
            failures.append("the two-ways contradiction failed without being reported")

    # -- 7. a register that cannot be read exits 2, not 0 or 1 ---------------------
    with tempfile.TemporaryDirectory() as d:
        build(d)
        REGISTER = os.path.join(d, "nope.md")
        buf = io.StringIO()
        real_stdout, sys.stdout = sys.stdout, buf
        try:
            code = main()
        finally:
            sys.stdout = real_stdout
        if code != 2:
            failures.append(f"a missing register exited {code}, not 2")

    with tempfile.TemporaryDirectory() as d:
        ROOT = d
        REGISTER = os.path.join(d, "empty.md")
        with open(REGISTER, "w", encoding="utf-8") as fh:
            fh.write("# no rows here\n")
        buf = io.StringIO()
        real_stdout, sys.stdout = sys.stdout, buf
        try:
            code = main()
        finally:
            sys.stdout = real_stdout
        if code != 2:
            failures.append(f"a register with no parseable rows exited {code}, not 2")

    REGISTER, ROOT = real_register, real_root

    print("== --self-test: 7 invariants")
    if failures:
        for f in failures:
            print(f"   FAIL — {f}")
        return 1
    print("   an absorbs declaration resolves the retired id, and the resolution is PRINTED")
    print("   a bare prose mention of an id in a row body does NOT resolve it")
    print("   a malformed `(merged …)` clause does NOT resolve it, and hints why")
    print("   a genuinely dangling id still fails and is named")
    print("   `| OD-30/42 |` combined rows still resolve both halves")
    print("   an id that owns a row AND is absorbed elsewhere fails as a contradiction")
    print("   a register that cannot be read exits 2, never 0")
    print("PASS")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Every OD id in the corpus resolves to a register row.")
    ap.add_argument(
        "--self-test",
        action="store_true",
        help="prove the resolution invariants against a synthetic register, then exit",
    )
    args = ap.parse_args()
    sys.exit(self_test() if args.self_test else main())
