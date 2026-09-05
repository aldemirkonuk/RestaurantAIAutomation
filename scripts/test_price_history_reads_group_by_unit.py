"""`scripts/check_price_history_reads_group_by_unit.py` — the guard ADR 0119 Q4 earned.

Every case is a shape the guard must judge, written as a throwaway tree rather
than against the repo, so the suite never depends on `apps/` staying still. Two
cases DO read the repo: one asserts the shipped tree passes with ZERO readers
counted, the other plants a non-compliant read into a temporary copy and asserts
the guard fails and names it. Nothing is ever planted into the worktree.

    pytest scripts/test_price_history_reads_group_by_unit.py -q
"""

from __future__ import annotations

import pathlib
import shutil
import subprocess
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from scripts.check_price_history_reads_group_by_unit import (  # noqa: E402
    CannotCheck,
    READ_ROOTS,
    SVC,
    _fixture,
    run,
    self_test,
)

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
GUARD = REPO_ROOT / "scripts" / "check_price_history_reads_group_by_unit.py"


def _tree(tmp_path: pathlib.Path, body: str | None = None) -> pathlib.Path:
    root = _fixture(tmp_path)
    if body is not None:
        (root / SVC).write_text(body, encoding="utf-8")
    return root


WRITER = (
    "export class PricesService {\n"
    "  async record(row) {\n"
    '    await this.db.supabase.from("price_history").insert(row);\n'
    "  }\n"
    "}\n"
)


def _with(extra: str) -> str:
    return WRITER.replace("  async record(row) {", extra + "  async record(row) {")


# --------------------------------------------------------------------------
# The rule
# --------------------------------------------------------------------------

def test_zero_readers_passes_and_is_counted(tmp_path):
    code, findings, counts = run(_tree(tmp_path))
    assert code == 0 and findings == []
    assert counts["reads"] == 0, "zero readers must be COUNTED, not assumed"
    assert counts["mentions"] > 0, "a tree with no mention of the table is vacuous"


def test_a_read_filtering_on_unit_passes(tmp_path):
    root = _tree(
        tmp_path,
        _with(
            "  async perBottle(id) {\n"
            '    return this.db.supabase.from("price_history")\n'
            '      .select("price, unit").eq("inventory_id", id).eq("unit", "bottle");\n'
            "  }\n"
        ),
    )
    code, findings, counts = run(root)
    assert code == 0, findings
    assert (counts["reads"], counts["compliant"]) == (1, 1)


def test_a_read_using_in_unit_passes(tmp_path):
    root = _tree(
        tmp_path,
        _with(
            "  async cases(id) {\n"
            '    return this.db.supabase.from("price_history")\n'
            '      .select("price").in("unit", ["case", "split_case"]);\n'
            "  }\n"
        ),
    )
    assert run(root)[0] == 0


def test_an_aggregation_keyed_by_unit_passes(tmp_path):
    root = _tree(
        tmp_path,
        _with(
            "  async byUnit(id) {\n"
            '    const { data } = await this.db.supabase.from("price_history")\n'
            '      .select("price, unit").eq("inventory_id", id);\n'
            "    return (data || []).reduce((acc, r) => {\n"
            "      acc[r.unit] = (acc[r.unit] || 0) + r.price;\n"
            "      return acc;\n"
            "    }, {});\n"
            "  }\n"
        ),
    )
    assert run(root)[0] == 0


def test_a_read_stating_no_unit_fails_and_names_the_line(tmp_path):
    root = _tree(
        tmp_path,
        _with(
            "  async average(id) {\n"
            '    return this.db.supabase.from("price_history")\n'
            '      .select("price").eq("inventory_id", id);\n'
            "  }\n"
        ),
    )
    code, findings, _ = run(root)
    assert code == 1
    assert len(findings) == 1
    assert SVC in findings[0] and "without stating a unit" in findings[0]


def test_the_same_defect_inside_a_comment_does_not_fire(tmp_path):
    root = _tree(
        tmp_path,
        _with('  // from("price_history").select("price") was read here once\n'),
    )
    assert run(root)[0] == 0


def test_a_write_is_not_a_read(tmp_path):
    code, findings, counts = run(_tree(tmp_path))
    assert code == 0 and counts["reads"] == 0


# --------------------------------------------------------------------------
# Raw SQL
# --------------------------------------------------------------------------

def test_raw_sql_without_unit_fails(tmp_path):
    root = _tree(
        tmp_path,
        _with(
            "  async sqlBad() {\n"
            '    return this.db.query("select avg(price) from price_history where inventory_id = $1");\n'
            "  }\n"
        ),
    )
    code, findings, counts = run(root)
    assert code == 1
    assert counts["sql_reads"] == 1
    assert "raw SQL" in findings[0]


def test_raw_sql_grouping_by_unit_passes(tmp_path):
    root = _tree(
        tmp_path,
        _with(
            "  async sqlGood() {\n"
            '    return this.db.query("select unit, avg(price) from price_history group by unit");\n'
            "  }\n"
        ),
    )
    assert run(root)[0] == 0


# --------------------------------------------------------------------------
# It refuses rather than guessing
# --------------------------------------------------------------------------

def test_an_unfollowable_aggregation_is_cannot_check(tmp_path):
    root = _tree(
        tmp_path,
        _with(
            "  async average(id) {\n"
            '    const { data } = await this.db.supabase.from("price_history")\n'
            '      .select("price").eq("inventory_id", id);\n'
            "    const key = this.pick();\n"
            "    return (data || []).reduce((a, r) => a + r.price, 0);\n"
            "  }\n"
        ),
    )
    with pytest.raises(CannotCheck) as e:
        run(root)
    assert "cannot see the grouping key" in str(e.value)


def test_a_missing_read_root_is_cannot_check(tmp_path):
    root = _tree(tmp_path)
    shutil.rmtree(root / READ_ROOTS[0])
    with pytest.raises(CannotCheck):
        run(root)


def test_the_table_name_vanishing_is_cannot_check(tmp_path):
    root = _tree(tmp_path, "export class PricesService {}\n")
    with pytest.raises(CannotCheck) as e:
        run(root)
    assert "appears nowhere" in str(e.value)


def test_a_missing_comment_stripper_is_cannot_check(tmp_path):
    root = _tree(tmp_path)
    (root / "scripts" / "check_read_columns_exist.py").unlink()
    with pytest.raises(CannotCheck):
        run(root)


# --------------------------------------------------------------------------
# The repo itself
# --------------------------------------------------------------------------

def test_the_self_test_passes():
    assert self_test() == 0


def test_the_shipped_tree_passes_with_zero_readers():
    proc = subprocess.run(
        [sys.executable, str(GUARD)], cwd=REPO_ROOT, capture_output=True, text=True
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "0 readers today" in proc.stdout, proc.stdout


def test_a_planted_read_in_a_copy_of_the_tree_fails(tmp_path):
    """The guard is proved on the real tree, in a COPY. Never plant in place."""
    copy = tmp_path / "tree"
    for rel in ("scripts", "apps/api-gateway/src", "apps/web/src", "apps/mobile",
                "services/agent-orchestrator"):
        src = REPO_ROOT / rel
        shutil.copytree(
            src,
            copy / rel,
            ignore=shutil.ignore_patterns("node_modules", "dist", "__pycache__",
                                          ".venv", "venv", "build"),
            symlinks=False,
            ignore_dangling_symlinks=True,
        )
    planted = copy / "apps/api-gateway/src/procurement/planted-price-read.ts"
    planted.write_text(
        "export class PlantedPriceRead {\n"
        "  async averagePaid(inventoryId: string) {\n"
        '    const { data } = await this.db.supabase.from("price_history")\n'
        '      .select("price, observed_at").eq("inventory_id", inventoryId);\n'
        "    return data;\n"
        "  }\n"
        "}\n",
        encoding="utf-8",
    )
    code, findings, _ = run(copy)
    assert code == 1
    assert any("planted-price-read.ts" in f for f in findings), findings
