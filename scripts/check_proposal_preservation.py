#!/usr/bin/env python3
"""
Guard: a machine proposal is never overwritten by the human's answer (ADR 0059).

    ./scripts/check_proposal_preservation.py
    ./scripts/check_proposal_preservation.py --self-test

THE RULE THIS ENFORCES
----------------------
    A machine proposal shown to a human is written before the human answers,
    and the answer is APPENDED, never substituted.

WHY THIS IS A GUARD AND NOT A CONVENTION
----------------------------------------
Receiving is the only place in this product where a number is produced by a
person touching an object. Six machine-proposes / human-judges pairs exist on
that path and four of them destroyed the machine's half at the instant it became
a label (`.planning/06-pages/receiving.md` §14d). The cleanest instance:

    // A person confirmed it, so confidence is not a model's estimate any more.
    match_confidence: body?.orderLineId ? 1 : null,
    match_method:     body?.orderLineId ? "manual" : null,

That comment is CORRECT about live state and the write is still the defect. The
proposal and the confirmation were sharing two columns, so confirming a pairing
deleted the model's score — at the one moment the pair became a training
example, which is the one moment it can never be reconstructed. Nothing looks
wrong in the diff; nothing looks wrong in the row; the corpus is simply empty
of every case the model got right and a human agreed with.

That is precisely the shape a command can check and a reviewer cannot: the
violating line is short, plausible, well-commented, and identical in form to the
legitimate write six files away.

WHAT IT CHECKS
--------------
A PROTECTED column may only be written by a DECLARED writer.

  * Protected set = PROTECTED_COLUMNS below, plus anything matching
    `proposed_*`. The pattern is the point: the fix for the next instance of
    this defect will add a `proposed_something` column, and it must arrive
    already guarded rather than needing a guard edit to be protected.

  * A "write" is an assignment inside a Supabase mutation payload —
    `.insert({...})`, `.update({...})`, `.upsert({...})` — or a SQL
    `INSERT`/`UPDATE ... SET` in application code. Reads, type declarations,
    `.select(...)` strings, render code and test fixtures are not writes.

  * Declared writers are the explicit per-column ALLOWLIST below. Adding a
    writer is a deliberate edit to this file with a stated reason, which is the
    whole mechanism: the next person to write `match_confidence: 1` on a
    confirmation path has to say here, in writing, why that is not the defect
    this guard exists to catch.

WHAT IT DOES NOT CLAIM
----------------------
It does not prove the proposal columns are POPULATED, or that their values are
right. It proves that no code outside the declared writers can overwrite one.
Whether the corpus is any good is a question for the data, not for a linter.

Nor does it read `.planning`. A doc that claims the rule is adopted is not
evidence that it is.

NEVER VACUOUS
-------------
Exit 0 clean, 1 violation, **2 cannot check**. Exit 2 blocks in CI exactly like
exit 1. A guard that passes because it found nothing to look at is a green check
mark over an unexamined surface — which is the same failure mode as the defect
it guards: absence reported as health. Concretely, this exits 2 when the source
tree is missing, when zero write sites are found anywhere, when a declared
writer no longer writes the column it is declared for, or when a file cannot be
scrubbed.
"""

from __future__ import annotations

import argparse
import re
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Trees that can write to the database. `apps/web` is excluded deliberately: a
# browser has no database client, and including it would make every render of
# `doc.ties_out` look like a write.
SCAN_ROOTS = (
    Path("apps/api-gateway/src"),
    Path("services/agent-orchestrator"),
    Path("services/self-evolution"),
    Path("services/database"),
    Path("packages/database"),
)

SOURCE_SUFFIXES = (".ts", ".py")


# ---------------------------------------------------------------------------
# The protected set
# ---------------------------------------------------------------------------

# Columns that hold a MACHINE'S half of a machine-proposes/human-judges pair.
# Short and explicit on purpose — a long list would be a wish, and every entry
# here is a column that was actually being destroyed or is one edit away from it.
PROTECTED_COLUMNS = frozenset(
    {
        # The line matcher's own score and method. Overwritten with 1/"manual"
        # by the confirmation endpoint before ADR 0059 — the original defect.
        "match_confidence",
        "match_method",
        # The extraction's arithmetic self-check. It is the model grading
        # itself, and `editLine` legitimately recomputes it — which is exactly
        # why it needs a declared writer rather than an open door.
        "ties_out",
        "tie_out_delta",
        "computed_lines_total",
    }
)

# Anything a future fix names `proposed_*` is protected without editing this
# file. New instances of this defect get fixed by adding such a column, and the
# guard must cover them the day they land, not the day someone remembers.
PROTECTED_PREFIX = re.compile(r"^proposed_[a-z0-9_]+$")


def is_protected(column: str) -> bool:
    return column in PROTECTED_COLUMNS or bool(PROTECTED_PREFIX.match(column))


# ---------------------------------------------------------------------------
# The allowlist — who may write each protected column, and why
# ---------------------------------------------------------------------------
#
# Keyed by column, valued by the source paths permitted to write it. A path
# matches by prefix, so a directory may be declared, but every entry here is a
# single file on purpose: "this module may write it" is a much weaker claim than
# "this function may", and the weaker claim is how the defect returns.
#
# A `proposed_*` column is allowed wherever its live-state twin is allowed: the
# proposal is written by whoever proposes, which is the matcher.

_MATCHER = "apps/api-gateway/src/procurement/documents/document-intake.service.ts"
_DELIVERY = "apps/api-gateway/src/procurement/canonical/delivery.service.ts"
_POS_MATCHER = "apps/api-gateway/src/pos-hub/catalog-matcher.service.ts"
_DRIFT_AGENT = "services/agent-orchestrator/agents/drift_agent.py"

ALLOWLIST: dict[str, tuple[tuple[str, str], ...]] = {
    "match_confidence": (
        (
            _MATCHER,
            "The line matcher writing its own score at proposal time, and "
            "confirmLineMatch promoting a suggestion's score onto the line. "
            "Both are the machine's number; neither is a human answer "
            "substituted for one.",
        ),
    ),
    "match_method": (
        (
            _MATCHER,
            "As match_confidence. Note confirmLineMatch may write "
            "'manual' ONLY for a pairing no machine proposed — there is no "
            "proposal half to destroy in that case.",
        ),
        (
            _POS_MATCHER,
            "A different table (pos_catalog_match_proposals) that happens to "
            "share the column name. It is a proposal WRITER: the machine "
            "recording its own suggestion, which is the allowed role.",
        ),
        (
            _DRIFT_AGENT,
            "As catalog-matcher, from the Python side — queues "
            "pos_catalog_match_proposals rows with match_method='drift_agent'.",
        ),
    ),
    "ties_out": (
        (
            _MATCHER,
            "Written at intake from the extraction, and RECOMPUTED by editLine "
            "through the same applyTieOut rule. The recompute is required: an "
            "edited line must never leave a stale ties-out claim standing.",
        ),
    ),
    "tie_out_delta": ((_MATCHER, "As ties_out — same two writes."),),
    "computed_lines_total": ((_MATCHER, "As ties_out — same two writes."),),
    "proposed_confidence": (
        (_MATCHER, "The proposal half, written only where the proposal is made."),
    ),
    "proposed_method": (
        (_MATCHER, "The proposal half, written only where the proposal is made."),
    ),
    # `delivery_proposals.proposed_by` matches PROTECTED_PREFIX by NAME ONLY.
    # It is not a machine's proposal at all: ADR 0103 D7's `delivery_proposals`
    # is a table of POSITIONS EITHER SIDE PUT ON THE RECORD about a delivery — a
    # short ship the receiver claims, a credit the vendor offers — and
    # `proposed_by` is the person who filed one. There is no machine half for a
    # human answer to overwrite, and the row is append-only in practice: an
    # answer is a NEW row with `counters_proposal_id` pointing at the one it
    # answers, and an acceptance writes `status` / `responded_at` /
    # `responded_by` beside it, never over `proposed_by` or `proposed_at`.
    #
    # The guard is right to ask. This is the answer, in writing.
    "proposed_by": (
        (
            _DELIVERY,
            "ADR 0103 D7: `delivery_proposals.proposed_by` is the HUMAN who put "
            "a position on the record, not a machine's suggestion. The service "
            "writes it once at insert and never again — an answer is a new row "
            "(counters_proposal_id) and an acceptance writes responded_by "
            "beside it. Name collision with ADR 0059's proposed_* convention, "
            "not an instance of it.",
        ),
    ),
}

# A `proposed_*` column with no ALLOWLIST entry is not silently open: it falls
# through to DEFAULT_PROPOSED_WRITERS, so a new proposal column is protected the
# moment it exists rather than the moment someone edits this file.
DEFAULT_PROPOSED_WRITERS: tuple[tuple[str, str], ...] = (
    (_MATCHER, "Default writer for an undeclared proposed_* column."),
)


def allowed_writers(column: str) -> tuple[tuple[str, str], ...]:
    if column in ALLOWLIST:
        return ALLOWLIST[column]
    if PROTECTED_PREFIX.match(column):
        return DEFAULT_PROPOSED_WRITERS
    return ()


def is_allowed(column: str, rel_path: str) -> bool:
    return any(rel_path.startswith(p) for p, _ in allowed_writers(column))


# The guard's anchors. If a declared writer stops writing the column it is
# declared for, the allowlist has rotted and any verdict from it is a guess.
# Exit 2, never a pass.
ANCHORS: tuple[tuple[str, str], ...] = (
    (_MATCHER, "match_confidence"),
    (_MATCHER, "ties_out"),
    (_MATCHER, "proposed_confidence"),
)


class CannotCheck(Exception):
    """The guard could not verify what it claims to. Exit 2 — never a pass."""


# ---------------------------------------------------------------------------
# Source scrubbing — comments and string CONTENT out, structure kept
# ---------------------------------------------------------------------------


def scrub(src: str, python: bool) -> tuple[str, str]:
    """
    Return (code_only, strings_kept), both the same length as `src` so offsets
    and line numbers still map.

    `code_only`    — comments AND string content blanked.
    `strings_kept` — comments blanked, string content preserved.

    Both are needed, and the pair is what makes the check precise:

      * Mutation payloads are located in `code_only`, so
        `.select("id, match_method")` cannot be mistaken for a write and a
        brace inside a string cannot throw off the span arithmetic.

      * Keys are read from `strings_kept`, because Python writes them quoted:
        `.update({'match_confidence': 1})` has no unquoted key at all, and
        blanking string content makes that write invisible — a guard blind to
        every Python writer in the repo while reporting a clean pass.

      * A key found in `strings_kept` counts only if its `:` is still present at
        the same offset in `code_only`. A real key's colon is punctuation and
        survives; a colon inside a string VALUE (`notes: "qty: 4"`) is blanked.
        That one comparison separates the two without parsing either language.

    Hand-rolled rather than using a parser, because a guard that needs
    `npm install` to run is a guard that gets skipped.
    """
    code = list(src)
    keep = list(src)
    i, n = 0, len(src)
    state: str | None = None

    def blank(idx: int, both: bool = True) -> None:
        if src[idx] != "\n":
            code[idx] = " "
            if both:
                keep[idx] = " "

    while i < n:
        ch = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        nxt2 = src[i + 2 : i + 3]
        if state is None:
            if python and ch == "#":
                state = "#"
                blank(i)
                i += 1
                continue
            if not python and ch == "/" and nxt == "/":
                state = "//"
                blank(i)
                blank(i + 1)
                i += 2
                continue
            if not python and ch == "/" and nxt == "*":
                state = "/*"
                blank(i)
                blank(i + 1)
                i += 2
                continue
            if python and ch in "\"'" and nxt == ch and nxt2 == ch:
                state = ch * 3
                i += 3
                continue
            if ch in "\"'" or (not python and ch == "`"):
                state = ch
                i += 1
                continue
            i += 1
            continue
        if state in ("//", "#"):
            if ch == "\n":
                state = None
            else:
                blank(i)
            i += 1
            continue
        if state == "/*":
            if ch == "*" and nxt == "/":
                blank(i)
                blank(i + 1)
                state = None
                i += 2
                continue
            blank(i)
            i += 1
            continue
        if len(state) == 3:
            if src[i : i + 3] == state:
                state = None
                i += 3
                continue
            blank(i)
            i += 1
            continue
        # single-quoted string / template literal
        if ch == "\\":
            blank(i, both=False)
            if i + 1 < n:
                blank(i + 1, both=False)
            i += 2
            continue
        if state == "`" and ch == "$" and nxt == "{":
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
        # An unterminated single-quoted string cannot span a newline: that is an
        # apostrophe in prose the comment-blanker did not reach, not a string.
        if ch == "\n" and state in ("'", '"'):
            state = None
            i += 1
            continue
        blank(i, both=False)
        i += 1

    if state is not None and len(state) == 3:
        raise CannotCheck(
            f"unterminated {state!r} while scrubbing — the scrubber cannot read "
            "this file, so it cannot check it"
        )
    return "".join(code), "".join(keep)


# ---------------------------------------------------------------------------
# Finding writes
# ---------------------------------------------------------------------------

# `.insert(`, `.update(`, `.upsert(` — the Supabase mutation verbs. `.select(`
# and `.eq(` are deliberately absent: those are reads and filters.
MUTATION_CALL = re.compile(r"\.\s*(insert|update|upsert)\s*\(")

# A SQL statement in a string that survived scrubbing only in Python's
# non-f-string form is already blanked; this catches SQL built as code, e.g.
# psycopg `cur.execute("update ... set match_confidence = %s")` is blanked, but
# an ORM-ish `set_(match_confidence=...)` is code. Kept narrow on purpose.
SQL_SET = re.compile(r"\b(?:update|set)\b[^;]{0,400}", re.I)

# `key: value` or `key = value` (Python kwargs) at the start of an entry.
ASSIGN_KEY = re.compile(r"""(?:^|[{,(\s])["']?([a-z_][a-z0-9_]*)["']?\s*[:=](?!=)""")


def balanced_span(text: str, open_at: int) -> int:
    """Index just past the ')' matching the '(' at `open_at`."""
    depth = 0
    j = open_at
    n = len(text)
    while j < n:
        if text[j] in "([{":
            depth += 1
        elif text[j] in ")]}":
            depth -= 1
            if depth == 0:
                return j + 1
        j += 1
    return n


def write_sites(code: str, keep: str) -> list[tuple[int, str]]:
    """
    Every (line, column_name) written inside a mutation payload.

    Spans come from `code` (strings blanked, so a brace or a `.select(...)`
    inside a string cannot mislead); keys are read from `keep` at the same
    offsets, so Python's quoted dict keys are visible. A key counts only when its
    colon is punctuation in `code` too — see `scrub`.

    The payload may be an inline object literal or a variable; when it is a
    variable, the object it was built from is found by name in the same file.
    `catalog-matcher.service.ts` builds `const row = {...}` and passes `row`,
    which is a common shape and must not be invisible.
    """
    found: list[tuple[int, str]] = []
    seen_spans: set[tuple[int, int]] = set()

    for m in MUTATION_CALL.finditer(code):
        open_at = code.index("(", m.start())
        end = balanced_span(code, open_at)
        start = open_at

        # A bare identifier payload: `.update(row)` / `.insert(rows)`.
        bare = re.fullmatch(r"\(\s*([A-Za-z_$][\w$]*)\s*[,)].*", code[start:end], re.S)
        if bare:
            name = bare.group(1)
            decl = re.search(
                rf"\b(?:const|let|var)\s+{re.escape(name)}\s*(?::[^=]+)?=\s*\{{",
                code,
            )
            if decl:
                start = code.index("{", decl.start())
                end = balanced_span(code, start)

        span = (start, end)
        if span in seen_spans:
            continue
        seen_spans.add(span)

        payload = keep[start:end]
        base_line = code.count("\n", 0, start) + 1

        for a in ASSIGN_KEY.finditer(payload):
            # The `:`/`=` that made this look like a key. If it is blanked in
            # `code`, it lived inside a string value and this is not a key.
            sep = payload.find(":", a.end(1))
            eq = payload.find("=", a.end(1))
            if sep < 0 or (0 <= eq < sep):
                sep = eq
            if sep < 0 or code[start + sep] not in ":=":
                continue
            line = base_line + payload.count("\n", 0, a.start(1))
            found.append((line, a.group(1)))

    return found


@dataclass
class Report:
    files: list[str] = field(default_factory=list)
    write_sites: int = 0
    protected_writes: list[str] = field(default_factory=list)
    violations: list[str] = field(default_factory=list)
    anchors_hit: set[tuple[str, str]] = field(default_factory=set)


def source_files(root: Path) -> list[Path]:
    out: list[Path] = []
    for scan in SCAN_ROOTS:
        base = root / scan
        if not base.is_dir():
            continue
        for suffix in SOURCE_SUFFIXES:
            out.extend(
                p
                for p in base.rglob(f"*{suffix}")
                if "node_modules" not in p.parts
                and "__pycache__" not in p.parts
                and not p.name.endswith(".d.ts")
                # Tests assert on payloads and would read as writes. They also
                # cannot regress production behaviour on their own.
                and not p.name.endswith(".spec.ts")
                and not p.name.endswith(".test.ts")
                and not p.name.startswith("test_")
            )
    return sorted(out)


def run(root: Path) -> Report:
    files = source_files(root)
    if not files:
        raise CannotCheck(
            "no source files found under "
            + ", ".join(str(s) for s in SCAN_ROOTS)
            + " — nothing was scanned, so a pass would mean nothing"
        )

    report = Report()
    for path in files:
        rel = str(path.relative_to(root))
        report.files.append(rel)
        try:
            code, keep = scrub(
                path.read_text(encoding="utf-8", errors="replace"),
                python=path.suffix == ".py",
            )
        except CannotCheck as exc:
            raise CannotCheck(f"{rel}: {exc}") from exc

        sites = write_sites(code, keep)
        report.write_sites += len(sites)
        for line, column in sites:
            if not is_protected(column):
                continue
            report.protected_writes.append(f"{rel}:{line}  {column}")
            report.anchors_hit.add((rel, column))
            if not is_allowed(column, rel):
                writers = allowed_writers(column)
                declared = (
                    "\n".join(f"        - {p}" for p, _ in writers)
                    if writers
                    else "        (none declared)"
                )
                report.violations.append(
                    f"{rel}:{line}\n"
                    f"      writes the protected column `{column}`.\n"
                    f"      Declared writers:\n{declared}"
                )

    if report.write_sites == 0:
        raise CannotCheck(
            "scanned "
            f"{len(report.files)} file(s) and found ZERO database write sites. "
            "The mutation pattern has rotted (a client change, a new query "
            "builder), so nothing was actually checked"
        )

    return report


def missing_anchors(report: Report) -> list[str]:
    return [
        f"{path} no longer writes `{column}`"
        for path, column in ANCHORS
        if (path, column) not in report.anchors_hit
    ]


# ---------------------------------------------------------------------------
# Self-test — the guard must fire on the shape it exists to catch
# ---------------------------------------------------------------------------

# The literal pre-fix write from documents.controller.ts:241-246.
PREFIX_CONFIRMATION = """\
export class DocumentsController {
  async linkLine(documentId: string, lineId: string, body: any, user: any) {
    const { data, error } = await this.db
      .getClient()
      .from("procurement_document_lines")
      .update({
        order_line_id: body?.orderLineId ?? null,
        // A person confirmed it, so confidence is not a model's estimate any more.
        match_confidence: body?.orderLineId ? 1 : null,
        match_method: body?.orderLineId ? "manual" : null,
      })
      .eq("id", lineId)
      .select("id, order_line_id, match_method")
      .maybeSingle();
    return data;
  }
}
"""

# The fixed shape: appends, and never touches the match columns.
FIXED_CONFIRMATION = """\
export class DocumentsController {
  async linkLine(documentId: string, lineId: string, body: any, user: any) {
    const { data } = await this.db
      .getClient()
      .from("procurement_document_lines")
      .update({
        order_line_id: body?.orderLineId ?? null,
        confirmed_by: user.userId,
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", lineId)
      .select("id, order_line_id, match_method, proposed_method")
      .maybeSingle();
    return data;
  }
}
"""

# A stand-in for the declared writer, so the anchors are satisfied and a
# violation case fails for the RIGHT reason rather than exiting 2.
ALLOWED_WRITER = """\
export class DocumentIntakeService {
  async matchDocumentLines(documentId: string, restaurantId: string) {
    for (const m of result.applied) {
      await this.db
        .getClient()
        .from("procurement_document_lines")
        .update({
          order_line_id: m.orderLineId,
          match_confidence: m.confidence,
          match_method: m.method,
          proposed_confidence: m.confidence,
          proposed_method: m.method,
        })
        .eq("id", m.documentLineId);
    }
    await this.db
      .getClient()
      .from("procurement_documents")
      .update({
        computed_lines_total: recomputed.computedLinesTotal,
        tie_out_delta: recomputed.tieOutDelta,
        ties_out: recomputed.tiesOut,
      })
      .eq("id", documentId);
  }
}
"""


def _scaffold(tmp: Path) -> Path:
    d = tmp / "apps/api-gateway/src/procurement/documents"
    d.mkdir(parents=True)
    (tmp / _MATCHER).write_text(ALLOWED_WRITER)
    return d


def self_test() -> int:
    failures: list[str] = []

    def case(name: str, write, expect: str) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            d = _scaffold(tmp)
            write(tmp, d)
            try:
                rep = run(tmp)
            except CannotCheck as exc:
                got, detail = "cannot-check", str(exc)
            else:
                gaps = missing_anchors(rep)
                if gaps:
                    got, detail = "cannot-check", "; ".join(gaps)
                elif rep.violations:
                    got, detail = "violation", rep.violations[0].splitlines()[0]
                else:
                    got, detail = "clean", ""
            ok = got == expect
            print(f"   {'ok  ' if ok else 'FAIL'}  {name}: expected {expect}, got {got}")
            if detail and not ok:
                print(f"           {detail[:160]}")
            if not ok:
                failures.append(name)

    print("== SELF-TEST — the guard must fire on the pre-fix shape\n")

    case(
        "the exact pre-fix confirmation write (documents.controller.ts:244-245)",
        lambda tmp, d: (d / "documents.controller.ts").write_text(PREFIX_CONFIRMATION),
        "violation",
    )
    case(
        "the fixed confirmation passes",
        lambda tmp, d: (d / "documents.controller.ts").write_text(FIXED_CONFIRMATION),
        "clean",
    )
    case(
        "a .select() naming a protected column is a READ, not a write",
        lambda tmp, d: (d / "reader.service.ts").write_text(
            'const { data } = await db.from("procurement_document_lines")\n'
            '  .select("id, match_confidence, match_method, ties_out")\n'
            '  .eq("id", lineId);\n'
        ),
        "clean",
    )
    case(
        "a comment quoting the defect is not the defect",
        lambda tmp, d: (d / "note.service.ts").write_text(
            "// This used to write match_confidence: 1, match_method: \"manual\".\n"
            "/* update({ ties_out: true }) was the old shape. */\n"
            "export const x = 1;\n"
        ),
        "clean",
    )
    case(
        "an UNDECLARED proposed_* column is protected without editing this file",
        lambda tmp, d: (d / "rogue.service.ts").write_text(
            'await db.from("t").update({ proposed_shipped_qty: 1 }).eq("id", i);\n'
        ),
        "violation",
    )
    case(
        "a payload passed by variable is still a write",
        lambda tmp, d: (d / "indirect.service.ts").write_text(
            "const row = {\n"
            "  external_item_id: item.id,\n"
            "  match_method: method,\n"
            "};\n"
            'await db.from("t").update(row).eq("id", existing.id);\n'
        ),
        "violation",
    )
    case(
        "a Python writer outside the allowlist is caught too",
        lambda tmp, d: (
            (tmp / "services/agent-orchestrator/agents").mkdir(parents=True),
            (tmp / "services/agent-orchestrator/agents/rogue.py").write_text(
                "client.table('t').update({\n"
                "    'match_confidence': 1,\n"
                "}).eq('id', row_id).execute()\n"
            ),
        ),
        "violation",
    )
    case(
        "an empty tree is CANNOT CHECK, not a pass",
        lambda tmp, d: (tmp / _MATCHER).write_text("export const nothing = 1;\n"),
        "cannot-check",
    )
    case(
        "a declared writer that stopped writing its column is CANNOT CHECK",
        lambda tmp, d: (
            (tmp / _MATCHER).write_text(
                'await db.from("t").update({ ties_out: true, '
                "computed_lines_total: 1, tie_out_delta: 0, "
                "proposed_confidence: 0.5 }).eq(\"id\", i);\n"
            ),
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
    print("SELF-TEST PASSED — the guard fires on the pre-fix write, stays quiet on")
    print("   the fixed one and on reads/comments, covers an undeclared proposed_*")
    print("   column, and reports cannot-check rather than passing when it is blind.")
    return 0


# ---------------------------------------------------------------------------


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument(
        "--list",
        action="store_true",
        help="print every protected-column write the guard found, then exit 0",
    )
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test()

    def cannot_check(reason: str) -> int:
        print("CANNOT CHECK — this guard could not verify what it claims to.")
        print(f"   {reason}")
        print(
            "\n   Exit 2 blocks exactly like a violation, on purpose. A guard that\n"
            "   passes because its anchor moved reports ABSENCE as HEALTH, which is\n"
            "   the same failure as the defect it guards: the proposal was gone and\n"
            "   every row still looked fine."
        )
        return 2

    try:
        report = run(REPO_ROOT)
    except CannotCheck as exc:
        return cannot_check(str(exc))

    if args.list:
        for line in report.protected_writes:
            print(line)
        return 0

    if report.violations:
        print(f"== PROPOSAL OVERWRITTEN ({len(report.violations)})")
        for v in report.violations:
            print(f"   {v}")
        print(
            "\nFAIL — a machine's proposal is being written by something that is not\n"
            "   the thing that proposed it.\n"
            "\n"
            "   ADR 0059: a machine proposal shown to a human is written BEFORE the\n"
            "   human answers, and the answer is APPENDED, never substituted.\n"
            "\n"
            "   If this write is the human's answer: give the answer its own\n"
            "   columns (confirmed_by / confirmed_at, or a proposed_* twin) and\n"
            "   leave the machine's half alone. The pre-fix defect was one line —\n"
            "   `match_confidence: 1` on confirmation — and it deleted the model's\n"
            "   score at the exact instant the pair became a label, which is the\n"
            "   one moment it can never be reconstructed afterwards.\n"
            "\n"
            "   If this write really is a PROPOSAL (a machine recording its own\n"
            "   suggestion), add the file to ALLOWLIST in this script with the\n"
            "   reason it is one. That edit is the point: it is deliberate, it is\n"
            "   reviewable, and it is a sentence someone has to be willing to write."
        )
        return 1

    gaps = missing_anchors(report)
    if gaps:
        return cannot_check(
            "a declared writer no longer writes the column it is declared for, so "
            "the allowlist has rotted and any verdict from it is a guess:\n     "
            + "\n     ".join(gaps)
        )

    print(
        f"PASS — {len(report.files)} source file(s), {report.write_sites} database\n"
        f"   write site(s) scanned. {len(report.protected_writes)} write(s) touch a\n"
        f"   protected column and every one is a declared writer:\n"
    )
    for line in report.protected_writes:
        print(f"   {line}")
    print(
        f"\n   Protected: {', '.join(sorted(PROTECTED_COLUMNS))}, and any proposed_*."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
