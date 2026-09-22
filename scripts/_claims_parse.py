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

MULTI-LINE VERIFY IS REJECTED, NOT SILENTLY SPLIT — found 2026-09-2x (ADR 0215,
lane team3, wt-labor)
-----------------------------------------------------------------------------
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
"""

import json
import re
import sys

FIELDS = ("id", "status", "verify", "claim")


def parse(path: str) -> int:
    bad = False
    muzzled = False
    multiline = False
    rows = []
    with open(path, encoding="utf-8") as fh:
        for n, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except Exception as e:
                print(f"MALFORMED\t{n}\t{e}", file=sys.stderr)
                bad = True
                continue
            if "_comment" in o:
                continue
            missing = [k for k in FIELDS + ("verified",) if k not in o]
            if missing:
                print(
                    f"MALFORMED\t{n}\t{o.get('id', '?')} missing {missing}",
                    file=sys.stderr,
                )
                bad = True
                continue
            if o["status"] not in ("open", "resolved"):
                print(
                    f"MALFORMED\t{n}\t{o['id']} status must be open|resolved, "
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
                    f"MULTILINE\t{n}\t{o['id']} field(s) {bad_fields} contain an "
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
                    f"MUZZLED\t{n}\t{o['id']} redirects stderr: {o['verify']}",
                    file=sys.stderr,
                )
                muzzled = True
                continue
            rows.append("\t".join([o["id"], o["status"], o["verify"], o["claim"]]))
    if bad:
        return 3
    if muzzled:
        return 5
    if multiline:
        return 6
    if not rows:
        print("EMPTY", file=sys.stderr)
        return 4
    print("\n".join(rows))
    return 0


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else ".planning/decisions/CLAIMS.jsonl"
    try:
        return parse(path)
    except OSError as e:
        print(f"cannot read {path}: {e}", file=sys.stderr)
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

    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(self_test())
    sys.exit(main())
