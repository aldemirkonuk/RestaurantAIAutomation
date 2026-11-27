"""Two sibling PRs each add a line to scripts/sql_outside_migrations.txt; merging both must not conflict.

The repo's .gitattributes gives that file the union merge driver, and the guard
reads it as a set (order and repeats ignored). Each case builds a throwaway git
repo with the repo's real .gitattributes and the real inventory.

    pytest scripts/test_sql_outside_union_merge.py -q
"""

from __future__ import annotations

import pathlib
import shutil
import subprocess

REPO = pathlib.Path(__file__).resolve().parents[1]
INV = "scripts/sql_outside_migrations.txt"


def git(cwd, *a):
    return subprocess.run(
        ["git", "-c", "user.email=t@t", "-c", "user.name=t", *a],
        cwd=cwd, capture_output=True, text=True,
    )


def build(tmp, attributes: bool = True):
    (tmp / "scripts").mkdir()
    shutil.copy(REPO / INV, tmp / INV)
    if attributes:
        shutil.copy(REPO / ".gitattributes", tmp / ".gitattributes")
    git(tmp, "init", "-q", "-b", "main")
    git(tmp, "add", "-A")
    git(tmp, "commit", "-qm", "base")


def add_line(tmp, branch, line, at):
    git(tmp, "checkout", "-q", "-b", branch, "main")
    lines = (tmp / INV).read_text().splitlines()
    lines.insert(at, line)
    (tmp / INV).write_text("\n".join(lines) + "\n")
    git(tmp, "commit", "-qam", branch)


def recorded(tmp):
    return {l for l in (tmp / INV).read_text().splitlines() if l.strip() and not l.startswith("#")}


def test_the_repo_marks_the_inventory_for_union_merge():
    attrs = (REPO / ".gitattributes").read_text()
    assert f"{INV} merge=union" in attrs


def test_two_siblings_adding_at_the_same_spot_merge_without_conflict(tmp_path):
    build(tmp_path)
    add_line(tmp_path, "a", "supabase/tests/20270901000000_a_test.sql", 40)
    add_line(tmp_path, "b", "supabase/tests/20270901000001_b_test.sql", 40)
    git(tmp_path, "checkout", "-q", "a")
    merged = git(tmp_path, "merge", "-q", "--no-edit", "b")
    assert merged.returncode == 0, merged.stdout + merged.stderr
    got = recorded(tmp_path)
    assert {"supabase/tests/20270901000000_a_test.sql", "supabase/tests/20270901000001_b_test.sql"} <= got


def test_without_the_attribute_the_same_merge_conflicts(tmp_path):
    # The mutant: take the attribute away and the collision this rule exists for returns.
    build(tmp_path, attributes=False)
    add_line(tmp_path, "a", "supabase/tests/20270901000000_a_test.sql", 40)
    add_line(tmp_path, "b", "supabase/tests/20270901000001_b_test.sql", 40)
    git(tmp_path, "checkout", "-q", "a")
    assert git(tmp_path, "merge", "-q", "--no-edit", "b").returncode != 0
