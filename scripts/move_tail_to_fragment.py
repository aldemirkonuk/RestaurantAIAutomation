#!/usr/bin/env python3
"""Move an open branch's register tail appends into fragments (ADR 0238).

Run it ONCE on a branch that appended rows to the tail of
`.planning/decisions/CLAIMS.jsonl` and/or `## ` entries to the tail of
`.planning/v3.0-TECH-DEBT.md` before those two files were frozen. Check the
branch out, with a clean tree, then:

    scripts/move_tail_to_fragment.py [--main-ref origin/main] [--slug S]
                                     [--date YYYY-MM-DD] [--no-merge] [--skip-check]

What it does, in order:

  (a) finds the merge base of HEAD and --main-ref;
  (b) splits the branch's diff to each register by line position: lines added
      AFTER the merge base's last line are tail appends and move to
      `claims.d/<slug>.jsonl` / `tech-debt.d/<date>-<slug>.md`; edits inside the
      base's range are in-place legacy edits and stay where they are;
  (c) repoints the branch's own `CLAIMS.jsonl:<n>` / `v3.0-TECH-DEBT.md:<n>`
      citations of the moved lines (in the files the branch changed, and in the
      moved text itself) to the fragment path and line;
  (d) commits that, then merges --main-ref (no rebase, no force: the branch
      only gains commits). With the tail gone the registers carry in-place edits
      only, so main's own appends and its sentinel merge in without a conflict;
  (e) runs scripts/check_decision_claims.sh and fails unless it passes.

It REFUSES (exit 3, nothing written) and asks for a hand fix when a hunk mixes
in-place and tail lines, when an in-place edit changes a register's line count
(the frozen file cannot absorb it — move that text to a fragment by hand), or
when the tail of TECH-DEBT does not start with a `## ` heading. It never
pushes; it prints the push command when everything passed.

<slug> is the branch name lowercased, every character outside [a-z0-9.-]
turned into `-`, repeats collapsed; `-2`, `-3` is added when that fragment name
already exists on --main-ref or on the branch. See the READMEs in claims.d/
and tech-debt.d/.

EXITS: 0 moved (or nothing to move) · 2 usage / environment · 3 refused, needs
a hand fix · 4 the merge conflicted (aborted; the move commit is kept) · 5 the
claims check failed after the merge.
"""

import argparse
import datetime
import os
import re
import subprocess
import sys

CLAIMS = ".planning/decisions/CLAIMS.jsonl"
DEBT = ".planning/v3.0-TECH-DEBT.md"
CLAIMS_DIR = ".planning/decisions/claims.d"
DEBT_DIR = ".planning/tech-debt.d"
HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")
CITE = re.compile(r"(?<![\w.-])((?:[\w.-]+/)*)(CLAIMS\.jsonl|v3\.0-TECH-DEBT\.md):(\d+)(?:-(\d+))?")


class Refused(Exception):
    pass


def git(*args: str, check: bool = True) -> str:
    r = subprocess.run(["git", *args], capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {r.stderr.strip()}")
    return r.stdout


def slugify(branch: str) -> str:
    s = re.sub(r"[^a-z0-9.-]+", "-", branch.lower())
    s = re.sub(r"-{2,}", "-", s).strip("-.")
    return s


def show(ref: str, path: str) -> "str | None":
    r = subprocess.run(["git", "show", f"{ref}:{path}"], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def exists(ref: str, path: str) -> bool:
    return subprocess.run(["git", "cat-file", "-e", f"{ref}:{path}"], capture_output=True).returncode == 0


def split_register(base: str, path: str) -> "tuple[list, list] | None":
    """(kept lines of HEAD, tail lines) for one register, or None if the branch
    did not change it. Raises Refused for anything that is not a clean split."""
    b_text = show(base, path)
    h_text = show("HEAD", path)
    if b_text is None or h_text is None or b_text == h_text:
        return None
    b_lines = b_text.splitlines(keepends=True)
    h_lines = h_text.splitlines(keepends=True)
    nb = len(b_lines)
    tail = []
    diff = git("diff", "-U0", "--no-color", "--no-ext-diff", base, "HEAD", "--", path)
    for line in diff.splitlines():
        m = HUNK.match(line)
        if not m:
            continue
        a, bcount = int(m.group(1)), int(m.group(2) or "1")
        c, dcount = int(m.group(3)), int(m.group(4) or "1")
        if bcount == 0 and a == nb:
            tail = h_lines[c - 1 : c - 1 + dcount]
            continue
        if bcount != dcount:
            raise Refused(
                f"{path}: the hunk at base line {a} ({bcount} -> {dcount} lines) changes the "
                "line count inside the frozen range. Move that text into a fragment by hand "
                "(a TECH-DEBT closing note cites the legacy entry as v3.0-TECH-DEBT.md:<line>)."
            )
        if a + bcount - 1 >= nb and bcount > 0 and dcount > bcount:
            raise Refused(f"{path}: the hunk at base line {a} edits the last line AND appends; split it by hand.")
    kept = h_lines[:nb]
    if len(h_lines) != nb + len(tail):
        raise Refused(f"{path}: HEAD has {len(h_lines)} lines, expected {nb} + {len(tail)} tail; split it by hand.")
    return kept, tail


def trim(lines: list) -> "tuple[list, int]":
    """Strip leading and trailing blank lines; return (lines, leading stripped)."""
    lead = 0
    while lead < len(lines) and not lines[lead].strip():
        lead += 1
    end = len(lines)
    while end > lead and not lines[end - 1].strip():
        end -= 1
    body = lines[lead:end]
    if body and not body[-1].endswith("\n"):
        body[-1] += "\n"
    return body, lead


def free_name(main_ref: str, directory: str, stem: str, ext: str) -> str:
    n = 1
    while True:
        name = f"{stem}{'' if n == 1 else f'-{n}'}{ext}"
        p = f"{directory}/{name}"
        if not (exists(main_ref, p) or exists("HEAD", p) or os.path.exists(p)):
            return p
        n += 1


def repoint(text: str, moves: dict, log: list, where: str) -> str:
    """moves: register basename -> (base line count, leading stripped, fragment
    path relative to the register's own directory, moved line count)."""

    def sub(m: "re.Match") -> str:
        prefix, name, lo, hi = m.group(1), m.group(2), int(m.group(3)), m.group(4)
        if name not in moves:
            return m.group(0)
        nb, lead, frag_rel, count = moves[name]
        if lo <= nb:
            return m.group(0)

        def new(n: int) -> int:
            k = n - nb - lead
            if not 1 <= k <= count:
                raise Refused(f"{where}: cites {name}:{n}, which is a blank line or outside the moved tail")
            return k

        out = f"{prefix}{frag_rel}:{new(lo)}" + (f"-{new(int(hi))}" if hi else "")
        log.append(f"{where}: {m.group(0)} -> {out}")
        return out

    return CITE.sub(sub, text)


def main(argv: list) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--main-ref", default="origin/main")
    ap.add_argument("--slug")
    ap.add_argument("--date", default=datetime.date.today().isoformat())
    ap.add_argument("--no-merge", action="store_true", help="move and commit, do not merge main")
    ap.add_argument("--skip-check", action="store_true", help="do not run the claims check (say so in the PR)")
    args = ap.parse_args(argv)
    try:
        datetime.date.fromisoformat(args.date)
    except ValueError:
        print(f"--date must be YYYY-MM-DD, got {args.date!r}", file=sys.stderr)
        return 2

    try:
        os.chdir(git("rev-parse", "--show-toplevel").strip())
        if git("status", "--porcelain", "--untracked-files=no").strip():
            print("the working tree has changes; commit or set them aside first", file=sys.stderr)
            return 2
        branch = git("rev-parse", "--abbrev-ref", "HEAD").strip()
        slug = slugify(args.slug or branch)
        if not slug or branch == "HEAD" and not args.slug:
            print("detached HEAD: pass --slug", file=sys.stderr)
            return 2
        base = git("merge-base", "HEAD", args.main_ref).strip()

        claims = split_register(base, CLAIMS)
        debt = split_register(base, DEBT)
        writes, moves, log = {}, {}, []
        if claims and claims[1]:
            body, lead = trim(claims[1])
            if not any(ln.strip() and '"_comment"' not in ln for ln in body):
                raise Refused(f"{CLAIMS}: the branch's tail holds no claim rows, only comments or blanks")
            frag = free_name(args.main_ref, CLAIMS_DIR, slug, ".jsonl")
            writes[CLAIMS] = "".join(claims[0])
            writes[frag] = body
            moves["CLAIMS.jsonl"] = (len(claims[0]), lead, os.path.relpath(frag, os.path.dirname(CLAIMS)), len(body))
        if debt and debt[1]:
            body, lead = trim(debt[1])
            if not body or not body[0].startswith("## "):
                raise Refused(
                    f"{DEBT}: the branch's tail does not start with a `## ` heading, so it continues "
                    "the last legacy entry; that is an in-place edit that changes the line count. "
                    "Move it into a fragment by hand."
                )
            frag = free_name(args.main_ref, DEBT_DIR, f"{args.date}-{slug}", ".md")
            writes[DEBT] = "".join(debt[0])
            writes[frag] = body
            moves["v3.0-TECH-DEBT.md"] = (len(debt[0]), lead, os.path.relpath(frag, os.path.dirname(DEBT)), len(body))
        if not moves:
            print("nothing to move: this branch appends to neither register's tail")
            return 0

        # (c) repoint citations: in the moved text, and in the files the branch changed.
        for path, val in list(writes.items()):
            if isinstance(val, list):
                writes[path] = repoint("".join(val), moves, log, path)
        changed = [p for p in git("diff", "--name-only", base, "HEAD").splitlines() if p not in (CLAIMS, DEBT)]
        for p in changed:
            if not os.path.isfile(p):
                continue
            try:
                with open(p, encoding="utf-8") as fh:
                    old = fh.read()
            except UnicodeDecodeError:
                continue
            new = repoint(old, moves, log, p)
            if new != old:
                writes[p] = new
    except Refused as e:
        print(f"REFUSED — {e}", file=sys.stderr)
        return 3
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 2

    for p, text in writes.items():
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(text)
    moved = {k: v[3] for k, v in moves.items()}
    claim_rows = sum(1 for ln in writes.get(next((p for p in writes if p.startswith(CLAIMS_DIR)), ""), "").splitlines()
                     if ln.strip() and '"_comment"' not in ln)
    for k, v in moves.items():
        print(f"moved {v[3]} line(s) of {k}'s tail -> {v[2]}")
    for line in log:
        print(f"repointed {line}")
    git("add", "--", *writes.keys())
    msg = (
        "chore(registers): move this branch's register tail into fragments (ADR 0238)\n\n"
        "CLAIMS.jsonl and v3.0-TECH-DEBT.md are frozen on main; new entries live in\n"
        "claims.d/ and tech-debt.d/. This moves the lines this branch appended after its\n"
        f"merge base ({base[:9]}) into fragments, leaves in-place edits where they are,\n"
        f"and repoints {len(log)} citation(s) of the moved lines. Done by\n"
        "scripts/move_tail_to_fragment.py.\n"
    )
    git("commit", "-q", "-m", msg)
    print(f"committed the move; {claim_rows} claim row(s) now in claims.d/, lines moved: {moved}")

    if args.no_merge:
        print(f"--no-merge: now merge {args.main_ref} yourself, then run scripts/check_decision_claims.sh")
        return 0
    r = subprocess.run(["git", "merge", "--no-edit", args.main_ref], capture_output=True, text=True)
    if r.returncode != 0:
        conflicted = git("diff", "--name-only", "--diff-filter=U", check=False).split()
        subprocess.run(["git", "merge", "--abort"], capture_output=True)
        print(f"merging {args.main_ref} conflicted on: {', '.join(conflicted) or '(see git)'}; aborted.", file=sys.stderr)
        print("The move commit is kept. Resolve those by hand; the registers should no longer be among them.",
              file=sys.stderr)
        return 4
    print(f"merged {args.main_ref} cleanly")
    if args.skip_check:
        print("--skip-check: the claims check was NOT run; say so in the PR")
        return 0
    r = subprocess.run(["bash", "scripts/check_decision_claims.sh"], capture_output=True, text=True)
    summary = [ln for ln in r.stdout.splitlines() if ln.startswith(("== Decision claims", "PASS", "FAIL"))]
    print("\n".join(summary))
    if r.returncode != 0:
        print(r.stdout[-3000:], file=sys.stderr)
        print("the claims check failed after the move; do not push until it passes", file=sys.stderr)
        return 5
    print(f"all checks pass; push with: git push origin {branch}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
