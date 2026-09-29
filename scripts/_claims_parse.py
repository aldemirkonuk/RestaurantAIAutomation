#!/usr/bin/env python3
"""Parse .planning/decisions/CLAIMS.jsonl into the tab-separated PLAN the shell
runner reads one line at a time.

Helper for scripts/check_decision_claims.sh. Kept as its own file for the same
reason _od_collisions.py and _migration_versions.py are: the shell quoting
around a nested `python3 - <<'PY'` heredoc is exactly the sort of thing that
breaks silently, and a parser this load-bearing needs to be testable on its
own rather than only by running the whole guard against the real register.

Emits one PLAN row per line on stdout: `id\tstatus\tverify\tclaim`. The runner
splits stdin on lines and each line on tabs, so a value that contains either
byte is not a value this format can carry.

MULTI-LINE VERIFY IS REJECTED, NOT SILENTLY SPLIT — found 2026-09-22
-----------------------------------------------------------------------------
Found on the CLAIMS rows of the unmerged /team pay branch (PR #440,
origin/fix/team-pay-defects, whose own record is ADR 0215 on that branch — ADR
0215 is about /team pay, not about this parser, and is not on main yet).
A `verify` (or `claim`, `id`, `status`) string that JSON-decodes to a value
containing a real newline byte — written in the JSONL source as the ONE-
backslash escape `\n`, not the two-backslash literal `\\n` — broke the PLAN's
own framing. Each row is one physical output line; a field with an embedded
newline splits ONE row into several. The tail fragments carry no tabs, so
`IFS=$'\t' read -r id status verify claim` dumps the whole fragment into `id`
and leaves `status`/`verify`/`claim` empty — an empty `status` takes the "open"
branch, an empty `verify` runs `bash -c ""` which exits 0, and an open claim
that "holds" is reported STALE. Two real rows (ADR-0215-TEAM-AN-... and
ADR-0215-TEAM-A-PERSONS-...), each written as legitimate multi-line Python
source with embedded newlines, produced one bogus REGRESSED and roughly 35
bogus STALE fragments — not a crash, a plausible-looking wrong answer, on a
guard whose whole purpose is to be re-read as ground truth (CLAUDE.md §5b).

The existing worked-around convention — semicolon-join the verify command onto
one physical line — stays the required shape; this file is what enforces it,
the same way the MUZZLED check enforces "no `2>` redirect" instead of silently
tolerating it.

SEVERAL FILES, ONE OF THEM FROZEN — ADR 0238, 2026-09-29
-----------------------------------------------------------------------------
Almost every PR appended one row to the tail of CLAIMS.jsonl, so two open PRs
conflicted there as soon as one merged, and every conflict fix was a new head
and a new ADR 0090 audit. New claims now go in
`.planning/decisions/claims.d/<branch-slug>.jsonl`, one file per branch, and
CLAIMS.jsonl is frozen behind a final `{"_comment": "FROZEN ..."}` sentinel at
a pinned line count.

    _claims_parse.py [--frozen-lines N] [--fragments DIR] [PATH ...]

The first PATH is the frozen register (default CLAIMS.jsonl). `--frozen-lines`
checks it: its newline count must equal N and its last non-blank line must be
the sentinel, else FROZEN (exit 7). That covers a row after the sentinel, a row
inserted above it, and the sentinel itself deleted or overwritten.
`--fragments` lists DIR in Python (a shell glob stays literal when nothing
matches), sorted by name, and parses every `<slug>.jsonl` in it with exactly the
per-line rules the frozen file gets. Anything else in DIR except README.md — a
bad name, a `.json`, an upper-case name, a subdirectory — is FRAGMENT (exit 8),
and so is a fragment with zero claims: a file that checks nothing must not look
like one that checks something. Every stderr line names `<file>:<line>`.

When several apply, the worst wins: 3 > 5 > 6 > 7 > 8 > 4. "Zero claims" (4) is
the total across all files; only a fragment is held to a per-file rule.
"""

import json
import os
import re
import sys

FIELDS = ("id", "status", "verify", "claim")
FRAGMENT_NAME = re.compile(r"^[a-z0-9][a-z0-9.-]*\.jsonl$")
SENTINEL_PREFIX = "FROZEN"


def parse_file(path: str, rows: list) -> set:
    """Append one file's claims to `rows`; return the problem kinds found
    ("bad", "muzzled", "multiline"). Every message names `path:line`."""
    bad = False
    muzzled = False
    multiline = False
    with open(path, encoding="utf-8") as fh:
        for n, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except Exception as e:
                print(f"MALFORMED\t{path}:{n}\t{e}", file=sys.stderr)
                bad = True
                continue
            # Every value below is used as a str. A row that is not an object, or a
            # hand-typed unquoted number (`"id": 215`), used to raise TypeError out
            # of this function — python exit 1, which the shell runner did not
            # catch, so the whole guard printed PASS over zero claims. Now a
            # wrong type is MALFORMED like any other unparseable row.
            if not isinstance(o, dict):
                print(f"MALFORMED\t{path}:{n}\tnot a JSON object: {line[:80]}", file=sys.stderr)
                bad = True
                continue
            if "_comment" in o:
                continue
            missing = [k for k in FIELDS + ("verified",) if k not in o]
            if missing:
                print(
                    f"MALFORMED\t{path}:{n}\t{o.get('id', '?')} missing {missing}",
                    file=sys.stderr,
                )
                bad = True
                continue
            not_str = [k for k in FIELDS if not isinstance(o[k], str)]
            if not_str:
                print(
                    f"MALFORMED\t{path}:{n}\t{o.get('id')!r} field(s) {not_str} must be "
                    "JSON strings (quote them)",
                    file=sys.stderr,
                )
                bad = True
                continue
            # The runner splits on tabs with bash `read`, and tab is IFS
            # whitespace there: an EMPTY field collapses into its neighbour and
            # shifts every later field one slot left. An empty `verify` would
            # also run `bash -c ""`, which exits 0 and "holds" for free.
            empty = [k for k in ("id", "verify") if not o[k].strip()]
            if empty:
                print(
                    f"MALFORMED\t{path}:{n}\t{o['id']!r} field(s) {empty} are empty",
                    file=sys.stderr,
                )
                bad = True
                continue
            if o["status"] not in ("open", "resolved"):
                print(
                    f"MALFORMED\t{path}:{n}\t{o['id']} status must be open|resolved, "
                    f"got {o['status']!r}",
                    file=sys.stderr,
                )
                bad = True
                continue
            # A raw newline or tab in any framed field corrupts the PLAN's own
            # line/tab structure below — see the module docstring. Caught here,
            # before that happens, rather than left to be discovered as a
            # plausible-looking wrong verdict downstream.
            bad_fields = [
                k for k in FIELDS if ("\n" in o[k] or "\t" in o[k])
            ]
            if bad_fields:
                print(
                    f"MULTILINE\t{path}:{n}\t{o['id']} field(s) {bad_fields} contain an "
                    "embedded newline or tab — join a multi-line verify command "
                    "onto one physical line (e.g. semicolon-separated Python "
                    "statements) before it can be framed as one PLAN row",
                    file=sys.stderr,
                )
                multiline = True
                continue
            # Strict mode reads stderr to tell "ran and disagreed" from "never
            # ran". A claim that redirects its own stderr blinds that, and the
            # ONE broken claim found when this was measured did exactly that.
            if re.search(r"2\s*>", o["verify"]):
                print(
                    f"MUZZLED\t{path}:{n}\t{o['id']} redirects stderr: {o['verify']}",
                    file=sys.stderr,
                )
                muzzled = True
                continue
            rows.append("\t".join([o["id"], o["status"], o["verify"], o["claim"]]))
    return {k for k, v in (("bad", bad), ("muzzled", muzzled), ("multiline", multiline)) if v}


def frozen_ok(path: str, frozen_lines: int) -> bool:
    """The pin: newline count == frozen_lines, and the last non-blank line is
    the sentinel. Counting newlines matches `wc -l`, which the ADR's own claim
    uses. A row appended with no trailing newline keeps that count, but it is
    then the last non-blank line, so the sentinel half catches it."""
    with open(path, encoding="utf-8") as fh:
        data = fh.read()
    ok = True
    count = data.count("\n")
    if count != frozen_lines:
        print(
            f"FROZEN\t{path}\thas {count} lines; it is frozen at {frozen_lines} "
            "(ADR 0238). No line may be added to or removed from it. A new "
            "claim goes in .planning/decisions/claims.d/<branch-slug>.jsonl; a "
            "legacy row may still be edited in place if it stays one line.",
            file=sys.stderr,
        )
        ok = False
    lines = data.split("\n")
    last_n = max((i for i, ln in enumerate(lines, 1) if ln.strip()), default=0)
    try:
        o = json.loads(lines[last_n - 1]) if last_n else None
    except ValueError:
        o = None
    if not (
        isinstance(o, dict)
        and set(o) == {"_comment"}
        and isinstance(o["_comment"], str)
        and o["_comment"].startswith(SENTINEL_PREFIX)
    ):
        print(
            f"FROZEN\t{path}:{last_n}\tthe last non-blank line is not the FROZEN "
            'sentinel ({"_comment": "FROZEN ..."}). Nothing may follow it; a new '
            "claim goes in .planning/decisions/claims.d/<branch-slug>.jsonl.",
            file=sys.stderr,
        )
        ok = False
    return ok


def list_fragments(d: str) -> "tuple[list, bool]":
    """Every `<slug>.jsonl` in d, sorted by name, and whether anything else
    (other than README.md) is there. Raises OSError if d cannot be listed —
    a missing claims.d/ is a cannot-check, not zero fragments."""
    paths, stray = [], False
    for name in sorted(os.listdir(d)):
        p = os.path.join(d, name)
        if name == "README.md" and os.path.isfile(p):
            continue
        if os.path.isdir(p):
            print(
                f"FRAGMENT\t{p}\tis a subdirectory; claims.d/ is flat, one "
                "<branch-slug>.jsonl per branch",
                file=sys.stderr,
            )
            stray = True
        elif not FRAGMENT_NAME.match(name) or not os.path.isfile(p):
            print(
                f"FRAGMENT\t{p}\tis not read: a claims fragment is named "
                f"<branch-slug>.jsonl matching {FRAGMENT_NAME.pattern} (README.md "
                "is the only other file allowed). Rename it: a file this guard "
                "skips is a claim nobody checks.",
                file=sys.stderr,
            )
            stray = True
        else:
            paths.append(p)
    return paths, stray


def run(paths: list, fragments_dir: "str | None" = None, frozen_lines: "int | None" = None) -> int:
    problems: set = set()
    rows: list = []
    frozen_bad = frozen_lines is not None and not frozen_ok(paths[0], frozen_lines)
    fragment_bad = False
    for p in paths:
        problems |= parse_file(p, rows)
    if fragments_dir is not None:
        frags, fragment_bad = list_fragments(fragments_dir)
        for p in frags:
            before = len(rows)
            found = parse_file(p, rows)
            problems |= found
            if len(rows) == before and not found:
                print(
                    f"FRAGMENT\t{p}\tholds zero claims (only blank or _comment "
                    "lines). Delete it, or put in it the claim it was meant to hold.",
                    file=sys.stderr,
                )
                fragment_bad = True
    if "bad" in problems:
        return 3
    if "muzzled" in problems:
        return 5
    if "multiline" in problems:
        return 6
    if frozen_bad:
        return 7
    if fragment_bad:
        return 8
    if not rows:
        print("EMPTY", file=sys.stderr)
        return 4
    print("\n".join(rows))
    return 0


def parse(path: str) -> int:
    """One file, no pin and no fragments: the pre-ADR-0238 behaviour."""
    return run([path])


def main(argv: list) -> int:
    frozen_lines = None
    fragments_dir = None
    paths = []
    args = iter(argv)
    for a in args:
        if a == "--frozen-lines":
            v = next(args, "")
            if not v.isdigit() or int(v) < 1:
                print(f"--frozen-lines needs a positive integer, got {v!r}", file=sys.stderr)
                return 2
            frozen_lines = int(v)
        elif a == "--fragments":
            fragments_dir = next(args, "")
            if not fragments_dir:
                print("--fragments needs a directory", file=sys.stderr)
                return 2
        elif a.startswith("--"):
            print(f"unknown option {a}", file=sys.stderr)
            return 2
        else:
            paths.append(a)
    if not paths:
        paths = [".planning/decisions/CLAIMS.jsonl"]
    try:
        return run(paths, fragments_dir, frozen_lines)
    except OSError as e:
        print(f"cannot read {e.filename or paths[0]}: {e}", file=sys.stderr)
        return 2


# ---------------------------------------------------------------------------
# Self-test. Run in CI beside _od_collisions.py's.
# ---------------------------------------------------------------------------
def self_test() -> int:
    import os
    import tempfile

    ok = True

    def check(label: str, jsonl: str, want_code: int, want_stderr: str = "", want_stdout: str = "") -> None:
        nonlocal ok
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "CLAIMS.jsonl")
            with open(p, "w", encoding="utf-8") as fh:
                fh.write(jsonl)
            import contextlib
            import io

            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = parse(p)
        good = code == want_code
        if want_stderr:
            good = good and want_stderr in err.getvalue()
        if want_stdout:
            good = good and want_stdout in out.getvalue()
        print(f"   {'ok  ' if good else 'FAIL'} {label}")
        if not good:
            ok = False
            print(
                f"        wanted code={want_code} stderr~{want_stderr!r} "
                f"stdout~{want_stdout!r}, got code={code} "
                f"stderr={err.getvalue()!r} stdout={out.getvalue()!r}"
            )

    def row(**kw):
        base = {
            "id": "OD-1",
            "status": "resolved",
            "claim": "a thing",
            "verify": "true",
            "verified": "2026-01-01",
        }
        base.update(kw)
        return json.dumps(base) + "\n"

    check("a clean single-line claim parses to one row", row(), 0, want_stdout="OD-1\tresolved\ttrue\ta thing")
    check("malformed JSON fails loud", "{not json\n", 3, "MALFORMED")
    check("a missing field fails loud", '{"id":"OD-1","status":"resolved","claim":"x","verify":"true"}\n', 3, "MALFORMED")
    check("a bad status fails loud", row(status="maybe"), 3, "MALFORMED")
    check("a muzzled stderr redirect fails loud", row(verify="true 2>/dev/null"), 5, "MUZZLED")
    check("empty file fails loud", "", 4, "EMPTY")
    # The actual defect: a verify string JSON-decodes to a value with a real
    # embedded newline (JSON source used the one-backslash \n escape).
    check(
        "an embedded newline in verify is rejected, not silently split",
        row(verify="import sys\nsys.exit(0)"),
        6,
        "MULTILINE",
    )
    check(
        "an embedded newline in claim is rejected too",
        row(claim="line one\nline two"),
        6,
        "MULTILINE",
    )
    # The semicolon-joined workaround this file is meant to keep valid.
    check(
        "a semicolon-joined one-liner is accepted",
        row(verify="import sys; sys.exit(0)"),
        0,
        want_stdout="import sys; sys.exit(0)",
    )
    # A value containing the literal TWO characters backslash-then-n (what a
    # JSON source's `\\n` escape decodes to) is not a newline byte and must
    # NOT be flagged — only a real embedded newline (JSON source `\n`, one
    # backslash) is the hazard.
    check(
        "a literal backslash-n (not a real newline) is not flagged",
        row(verify="echo 'a\\nb'"),
        0,
    )

    # A hand-typed unquoted number used to raise TypeError (exit 1), which the
    # shell runner did not catch: PASS over zero claims.
    check("an unquoted numeric id fails loud, not a crash", row(id=215), 3, "MALFORMED")
    check("a non-string verify fails loud", row(verify=["true"]), 3, "MALFORMED")
    check("a JSON line that is not an object fails loud", "[1, 2]\n", 3, "MALFORMED")
    check("an empty verify fails loud (bash -c '' exits 0)", row(verify="  "), 3, "MALFORMED")
    check("an empty id fails loud", row(id=""), 3, "MALFORMED")

    # ADR 0238 — several files, the first frozen behind a sentinel.
    sentinel = json.dumps({"_comment": "FROZEN 2026-01-01 (self-test)"}) + "\n"
    frozen = row() + sentinel

    def tree(label, claims, frags, want_code, want_stderr="", want_stdout="", pin="auto", absent=False):
        """frags: {name: text}; a text of None makes a subdirectory."""
        nonlocal ok
        import contextlib
        import io

        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "CLAIMS.jsonl")
            with open(p, "w", encoding="utf-8") as fh:
                fh.write(claims)
            fd = os.path.join(d, "claims.d")
            if not absent:
                os.mkdir(fd)
            for name, text in frags.items():
                q = os.path.join(fd, name)
                if text is None:
                    os.mkdir(q)
                else:
                    with open(q, "w", encoding="utf-8") as fh:
                        fh.write(text)
            n = frozen.count("\n") if pin == "auto" else pin
            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = main(["--frozen-lines", str(n), "--fragments", fd, p])
        good = code == want_code
        if want_stderr:
            good = good and want_stderr in err.getvalue()
        if want_stdout:
            good = good and want_stdout in out.getvalue()
        print(f"   {'ok  ' if good else 'FAIL'} {label}")
        if not good:
            ok = False
            print(
                f"        wanted code={want_code} stderr~{want_stderr!r} "
                f"stdout~{want_stdout!r}, got code={code} "
                f"stderr={err.getvalue()!r} stdout={out.getvalue()!r}"
            )

    readme = {"README.md": "# claims.d\n"}
    frag = {"feat-x.jsonl": row(id="OD-2"), **readme}
    tree("frozen file + one fragment: both rows emitted, frozen file first", frozen, frag, 0,
         want_stdout="OD-1\tresolved\ttrue\ta thing\nOD-2\tresolved")
    tree("fragments are read in sorted name order",
         frozen, {"b-x.jsonl": row(id="OD-B"), "a-x.jsonl": row(id="OD-A")}, 0,
         want_stdout="OD-A\tresolved\ttrue\ta thing\nOD-B")
    tree("README.md alone in claims.d is fine (zero fragments)", frozen, readme, 0)
    tree("a row after the sentinel is FROZEN", frozen + row(id="OD-9"), frag, 7, "FROZEN")
    tree("a row inserted above the sentinel is FROZEN", row() + row(id="OD-9") + sentinel, frag, 7,
         "has 3 lines; it is frozen at 2")
    tree("a row appended with no trailing newline (count kept) is FROZEN", frozen + row(id="OD-9").rstrip("\n"),
         frag, 7, "not the FROZEN sentinel")
    tree("the sentinel overwritten by a row (count kept) is FROZEN", row() + row(id="OD-9"), frag, 7,
         "not the FROZEN sentinel")
    tree("a sentinel whose text does not start FROZEN is not a sentinel",
         row() + json.dumps({"_comment": "frozen, honest"}) + "\n", frag, 7, "not the FROZEN sentinel")
    tree("a malformed fragment is MALFORMED and names its file:line",
         frozen, {"feat-x.jsonl": row(id="OD-2") + "{not json\n"}, 3, "feat-x.jsonl:2")
    tree("MUZZLED applies inside a fragment", frozen, {"feat-x.jsonl": row(verify="true 2>&1")}, 5, "MUZZLED")
    tree("MULTILINE applies inside a fragment", frozen, {"feat-x.jsonl": row(verify="a\nb")}, 6, "MULTILINE")
    tree("an upper-case fragment name is FRAGMENT", frozen, {"Feat-X.jsonl": row()}, 8, "Feat-X.jsonl")
    tree("a .json in claims.d is FRAGMENT", frozen, {"feat-x.json": row()}, 8, "feat-x.json")
    tree("a name starting with a dot or dash is FRAGMENT", frozen, {".x.jsonl": row(), "-x.jsonl": row()}, 8,
         "-x.jsonl")
    tree("a subdirectory in claims.d is FRAGMENT", frozen, {"sub": None}, 8, "subdirectory")
    tree("a fragment of only a _comment is FRAGMENT", frozen,
         {"feat-x.jsonl": json.dumps({"_comment": "x"}) + "\n\n"}, 8, "zero claims")
    tree("a zero-byte fragment is FRAGMENT", frozen, {"feat-x.jsonl": ""}, 8, "zero claims")
    tree("MALFORMED outranks FROZEN (3 > 7)", frozen + "{bad\n", {}, 3, "MALFORMED")
    tree("FROZEN outranks FRAGMENT (7 > 8)", frozen + row(), {"X.jsonl": row()}, 7, "FRAGMENT")
    tree("zero claims is the TOTAL: an empty frozen file and one fragment pass",
         sentinel, {"feat-x.jsonl": row()}, 0, pin=1)
    tree("zero claims in total still fails", sentinel, readme, 4, "EMPTY", pin=1)
    tree("a missing claims.d is cannot-read (2), not zero fragments", frozen, {}, 2, "cannot read", absent=True)
    for bad_pin in (["--frozen-lines", "x"], ["--frozen-lines", "0"], ["--frozen-lines"], ["--nope"]):
        import contextlib
        import io

        with contextlib.redirect_stderr(io.StringIO()):
            code = main(bad_pin + [os.devnull])
        good = code == 2
        print(f"   {'ok  ' if good else 'FAIL'} a bad option {bad_pin} is exit 2, not a run without the pin")
        ok = ok and good

    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(self_test())
    sys.exit(main(sys.argv[1:]))
