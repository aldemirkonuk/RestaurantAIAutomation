#!/usr/bin/env python3
"""Move an open branch's new register entries into fragments (ADR 0238).

Run it ONCE on a branch that added rows to `.planning/decisions/CLAIMS.jsonl`
and/or `## ` entries to `.planning/v3.0-TECH-DEBT.md` before those two files
were frozen. Check the branch out, with a clean tree, then:

    scripts/move_tail_to_fragment.py [--main-ref origin/main] [--slug S]
                                     [--date YYYY-MM-DD] [--no-merge] [--skip-check]

What it does, in order:

  (a) finds the merge base of HEAD and --main-ref;
  (b) splits the branch's diff to each register by hunk. A pure insertion is a
      NEW ENTRY and moves to `claims.d/<slug>.jsonl` / `tech-debt.d/<date>-<slug>.md`
      when it is whole: for CLAIMS, every inserted non-blank line is a claim row
      (rows are order-independent, so where it was inserted does not matter —
      a row a past hand conflict fix put mid-file moves too); for TECH-DEBT, the
      block starts with a `## ` heading and is followed in the base by another
      `## ` heading or the end of the file (a whole section, not a paragraph
      spliced into a legacy entry). A hunk that replaces N lines with N lines is
      an in-place legacy edit and stays where it is;
  (c) repoints `CLAIMS.jsonl:<n>` / `v3.0-TECH-DEBT.md:<n>` citations, only on
      lines the branch itself added (and in the moved text): a citation of a
      moved line goes to the fragment path and line; a citation of a line below
      a moved block drops by the lines moved above it, back to the numbering
      main has;
  (d) commits that, then merges --main-ref (no rebase, no force: the branch
      only gains commits). With the new entries gone the registers carry
      in-place edits only, so main's appends and its sentinel merge in clean;
  (e) runs scripts/check_decision_claims.sh and fails unless it passes.

It REFUSES (exit 3, nothing written) and asks for a hand fix whenever a hunk
is neither: an insertion that is not a whole entry, or an edit that changes the
line count inside the frozen range (a "**Fix.**" paragraph added to a legacy
TECH-DEBT entry, a deleted row). The frozen file cannot absorb those; move the
text into a fragment by hand. It never pushes; it prints the push command when
everything passed.

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
import json
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
    return re.sub(r"-{2,}", "-", s).strip("-.")


def show(ref: str, path: str) -> "str | None":
    r = subprocess.run(["git", "show", f"{ref}:{path}"], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def exists(ref: str, path: str) -> bool:
    return subprocess.run(["git", "cat-file", "-e", f"{ref}:{path}"], capture_output=True).returncode == 0


def hunks(base: str, path: str):
    diff = git("diff", "-U0", "--no-color", "--no-ext-diff", base, "HEAD", "--", path)
    for line in diff.splitlines():
        m = HUNK.match(line)
        if m:
            yield (int(m.group(1)), int(m.group(2) or "1"), int(m.group(3)), int(m.group(4) or "1"))


def is_claim_row(line: str) -> bool:
    try:
        o = json.loads(line)
    except ValueError:
        return False
    return isinstance(o, dict) and "id" in o


def split_register(base: str, path: str, kind: str):
    """(kept HEAD lines, fragment lines, {HEAD line -> fragment line}, moved HEAD
    line numbers) for one register, or None if the branch did not add to it.
    Raises Refused for any hunk that is neither a whole new entry nor an
    in-place, count-keeping edit."""
    b_text, h_text = show(base, path), show("HEAD", path)
    if b_text is None or h_text is None or b_text == h_text:
        return None
    b_lines = b_text.splitlines(keepends=True)
    h_lines = h_text.splitlines(keepends=True)
    nb = len(b_lines)
    blocks = []  # (first HEAD line, count)
    for a, bc, c, dc in hunks(base, path):
        if bc == dc:
            continue  # in place; stays
        if bc != 0:
            raise Refused(
                f"{path}: the hunk at base line {a} replaces {bc} line(s) with {dc}, which changes "
                "the line count inside the frozen range. Move that text into a fragment by hand "
                "(a TECH-DEBT closing note cites the legacy entry as v3.0-TECH-DEBT.md:<line>)."
            )
        block = h_lines[c - 1 : c - 1 + dc]
        body = [ln for ln in block if ln.strip()]
        if kind == "claims":
            bad = [ln for ln in body if not is_claim_row(ln)]
            if bad or not body:
                raise Refused(f"{path}: the insertion after base line {a} is not whole claim rows: {bad[:1]}")
        else:
            nxt = next((ln for ln in b_lines[a:] if ln.strip()), None)
            if not body or not body[0].startswith("## ") or (nxt is not None and not nxt.startswith("## ")):
                raise Refused(
                    f"{path}: the insertion after base line {a} is not a whole `## ` section (it "
                    "continues a legacy entry, which changes the frozen line count). Move it by hand."
                )
        blocks.append((c, dc))
    if not blocks:
        return None
    moved_lines = {n for c, dc in blocks for n in range(c, c + dc)}
    kept = [ln for n, ln in enumerate(h_lines, 1) if n not in moved_lines]
    if len(kept) != nb:
        raise Refused(f"{path}: {len(kept)} lines would remain, expected {nb}; split it by hand.")
    frag, fmap = [], {}
    for c, dc in blocks:
        block = list(range(c, c + dc))
        while block and not h_lines[block[0] - 1].strip():
            block.pop(0)
        while block and not h_lines[block[-1] - 1].strip():
            block.pop()
        if kind == "debt" and frag:
            frag.append("\n")
        for n in block:
            ln = h_lines[n - 1]
            if kind == "claims" and not ln.strip():
                continue
            frag.append(ln if ln.endswith("\n") else ln + "\n")
            fmap[n] = len(frag)
    return kept, frag, fmap, sorted(moved_lines)


def free_name(main_ref: str, directory: str, stem: str, ext: str) -> str:
    n = 1
    while True:
        p = f"{directory}/{stem}{'' if n == 1 else f'-{n}'}{ext}"
        if not (exists(main_ref, p) or exists("HEAD", p) or os.path.exists(p)):
            return p
        n += 1


def repoint_line(line: str, moves: dict, log: list, where: str) -> str:
    """moves: register basename -> (fragment path relative to the register's
    directory, {HEAD line -> fragment line}, sorted moved HEAD lines)."""

    def sub(m: "re.Match") -> str:
        prefix, name, lo, hi = m.group(1), m.group(2), int(m.group(3)), m.group(4)
        if name not in moves:
            return m.group(0)
        frag_rel, fmap, moved = moves[name]
        ends = [lo] + ([int(hi)] if hi else [])
        if all(n in fmap for n in ends):
            out = f"{prefix}{frag_rel}:" + "-".join(str(fmap[n]) for n in ends)
        elif any(n in moved for n in ends):
            raise Refused(f"{where}: {m.group(0)} straddles a moved block or cites a blank moved line; fix by hand")
        else:
            shifted = [n - sum(1 for k in moved if k < n) for n in ends]
            if shifted == ends:
                return m.group(0)
            out = f"{prefix}{name}:" + "-".join(map(str, shifted))
        log.append(f"{where}: {m.group(0)} -> {out}")
        return out

    return CITE.sub(sub, line)


def added_lines(base: str, path: str) -> set:
    out = set()
    for _a, _bc, c, dc in hunks(base, path):
        out.update(range(c, c + dc))
    return out


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
        if branch == "HEAD" and not args.slug:
            print("detached HEAD: pass --slug", file=sys.stderr)
            return 2
        slug = slugify(args.slug or branch)
        if not slug:
            print("the branch name gives an empty slug: pass --slug", file=sys.stderr)
            return 2
        base = git("merge-base", "HEAD", args.main_ref).strip()

        writes, moves, log = {}, {}, []
        for path, kind, directory, stem, ext in (
            (CLAIMS, "claims", CLAIMS_DIR, slug, ".jsonl"),
            (DEBT, "debt", DEBT_DIR, f"{args.date}-{slug}", ".md"),
        ):
            got = split_register(base, path, kind)
            if not got:
                continue
            kept, frag_lines, fmap, moved = got
            frag = free_name(args.main_ref, directory, stem, ext)
            writes[path] = "".join(kept)
            writes[frag] = frag_lines
            moves[os.path.basename(path)] = (os.path.relpath(frag, os.path.dirname(path)), fmap, moved)
        if not moves:
            print("nothing to move: this branch adds no entry to either register")
            return 0

        # (c) citations: every line of the moved text, and the lines the branch added elsewhere.
        for p, val in list(writes.items()):
            if isinstance(val, list):
                writes[p] = "".join(repoint_line(ln, moves, log, p) for ln in val)
        for p in git("diff", "--name-only", "--diff-filter=AM", base, "HEAD").splitlines():
            if p in (CLAIMS, DEBT) or not os.path.isfile(p):
                continue
            try:
                with open(p, encoding="utf-8") as fh:
                    lines = fh.read().splitlines(keepends=True)
            except UnicodeDecodeError:
                continue
            mine = added_lines(base, p)
            new = [repoint_line(ln, moves, log, f"{p}:{n}") if n in mine else ln for n, ln in enumerate(lines, 1)]
            if new != lines:
                writes[p] = "".join(new)
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
    for k, (frag_rel, fmap, moved) in moves.items():
        print(f"moved {len(moved)} line(s) of {k} -> {frag_rel} ({len(fmap)} line(s) in the fragment)")
    for line in log:
        print(f"repointed {line}")
    git("add", "--", *writes.keys())
    git(
        "commit", "-q", "-m",
        "chore(registers): move this branch's new register entries into fragments (ADR 0238)\n\n"
        "CLAIMS.jsonl and v3.0-TECH-DEBT.md are frozen on main; new entries live in\n"
        "claims.d/ and tech-debt.d/. This moves the entries this branch added since its\n"
        f"merge base ({base[:9]}) into fragments, leaves in-place edits where they are,\n"
        f"and repoints {len(log)} citation(s). Done by scripts/move_tail_to_fragment.py.\n",
    )
    print("committed the move")

    if args.no_merge:
        print(f"--no-merge: now merge {args.main_ref} yourself, then run scripts/check_decision_claims.sh")
        return 0
    r = subprocess.run(["git", "merge", "--no-edit", args.main_ref], capture_output=True, text=True)
    if r.returncode != 0:
        conflicted = git("diff", "--name-only", "--diff-filter=U", check=False).split()
        subprocess.run(["git", "merge", "--abort"], capture_output=True)
        print(f"merging {args.main_ref} conflicted on: {', '.join(conflicted) or '(see git)'}; aborted.",
              file=sys.stderr)
        print("The move commit is kept. Resolve those by hand.", file=sys.stderr)
        return 4
    print(f"merged {args.main_ref} cleanly")
    if args.skip_check:
        print("--skip-check: the claims check was NOT run; say so in the PR")
        return 0
    r = subprocess.run(["bash", "scripts/check_decision_claims.sh"], capture_output=True, text=True)
    print("\n".join(ln for ln in r.stdout.splitlines() if ln.startswith(("== Decision claims", "PASS", "FAIL"))))
    if r.returncode != 0:
        print(r.stdout[-3000:], file=sys.stderr)
        print("the claims check failed after the move; do not push until it passes", file=sys.stderr)
        return 5
    print(f"all checks pass; push with: git push origin {branch}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
