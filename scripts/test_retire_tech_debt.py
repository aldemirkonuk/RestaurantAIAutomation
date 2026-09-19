"""Tests for scripts/retire_tech_debt.py (ADR 0166).

Everything here is synthetic: a throwaway git repo built in tmp_path, and a
made-up items/marks export shaped like the artifact's two collections are
*believed* to be shaped (the live artifact could not be read for ADR 0166 --
see that ADR and the module docstring). None of this touches the real repo's
.planning/decisions/ files.

    python3 -m pytest scripts/test_retire_tech_debt.py -q
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from scripts.retire_tech_debt import (
    CannotCheck,
    RefusedError,
    apply_claims,
    apply_open_decisions,
    assert_no_unmarked,
    build_plan,
    classify_path,
    load_items,
    load_marks,
    load_verify_map,
    main,
    next_open_decision_number,
    render_claims_jsonl,
    render_open_decisions_md,
    scan_citations,
    _claim_id,
    _md_cell,
    _owning_adr_from_destination,
)

OPEN_DECISIONS_FIXTURE = """# Open Decisions — the founder queue

## Open

| ID | Question | Why it matters now | What unblocks it |
|---|---|---|---|
| OD-1 | **First fork** | matters a lot | a founder sentence |
| OD-3 | **Second fork** | matters too | another sentence |

## Resolved

| ID | Question | Outcome | Date |
|---|---|---|---|
| OD-2 | **Already answered** | Done | 2026-01-01 |
"""

EXISTING_CLAIMS_ROW = {
    "id": "DEBT-EXISTING",
    "status": "resolved",
    "claim": "already here",
    "verify": "true",
}


def _init_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    (repo / ".planning" / "decisions").mkdir(parents=True)
    (repo / ".planning" / "06-pages").mkdir(parents=True)
    (repo / ".planning" / "01-org").mkdir(parents=True)
    (repo / "apps" / "web" / "src").mkdir(parents=True)
    (repo / "scripts").mkdir(parents=True)

    (repo / ".planning" / "decisions" / "OPEN-DECISIONS.md").write_text(OPEN_DECISIONS_FIXTURE)
    (repo / ".planning" / "decisions" / "CLAIMS.jsonl").write_text(json.dumps(EXISTING_CLAIMS_ROW) + "\n")
    (repo / "CLAUDE.md").write_text("Check `.planning/v3.0-TECH-DEBT.md` before claiming something is broken.\n")
    (repo / "apps" / "web" / "src" / "foo.ts").write_text("// see v3.0-TECH-DEBT.md 44.1a for context\n")
    (repo / ".planning" / "06-pages" / "wines.md").write_text("wines.md:12 -> v3.0-TECH-DEBT.md:543-549\n")
    (repo / ".planning" / "01-org" / "boilerplate.md").write_text("...the live defect register, v3.0-TECH-DEBT.md...\n")
    (repo / "scripts" / "check_definer_functions_closed.py").write_text('"""Filed OPEN in v3.0-TECH-DEBT.md."""\n')
    (repo / ".planning" / "v3.0-TECH-DEBT.md").write_text("## 44.1a\nself-reference: v3.0-TECH-DEBT.md\n")

    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.email", "a@b.com"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "test"], cwd=repo, check=True)
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    return repo


def _write_json(path: Path, data) -> Path:
    path.write_text(json.dumps(data))
    return path


ITEM_TEMPLATE = {
    "remove-me": {"key": "remove-me", "group": "remove_done", "title": "Fixed already", "plain": "was fixed", "recommendation": "REMOVE"},
    "work-checkable": {"key": "work-checkable", "group": "security_money", "title": "Open definer", "plain": "still live", "evidence": "grep found it", "destination": "revoke the grant"},
    "work-uncheckable": {"key": "work-uncheckable", "group": "fix_broken", "title": "No harness", "plain": "no evals", "destination": "fold into ADR 0159's own text"},
    "decide-me": {"key": "decide-me", "group": "decide", "title": "Pick a lane", "plain": "founder call", "destination": "OPEN-DECISIONS.md"},
    "move-roadmap": {"key": "move-roadmap", "group": "move_future", "title": "Bigger feature", "plain": "not built", "destination": "ROADMAP.md as carried-forward scope"},
    "move-claude": {"key": "move-claude", "group": "move_rules", "title": "Adopt a rule", "plain": "now automatic", "destination": "CLAUDE.md as a standing convention"},
    "move-adr": {"key": "move-adr", "group": "move_rules", "title": "Fold into ADR", "plain": "already narrated", "destination": "fold into ADR 0162's own text"},
    "move-mystery": {"key": "move-mystery", "group": "move_rules", "title": "Unclear target", "plain": "??", "destination": "somewhere, unspecified"},
    "unmarked-item": {"key": "unmarked-item", "group": "decide", "title": "Nobody looked at this", "plain": "?"},
}

ALL_ITEMS = list(ITEM_TEMPLATE.values())

MARKS_NESTED = {
    "remove_done": {"d": {"remove-me": {"v": "remove", "n": ""}}},
    "security_money": {"d": {"work-checkable": {"v": "work", "n": "do it"}}},
    "fix_broken": {"d": {"work-uncheckable": {"v": "work", "n": ""}}},
    "decide": {"d": {"decide-me": {"v": "decide", "n": "think about it"}}},
    "move_future": {"d": {"move-roadmap": {"v": "move", "n": ""}}},
    "move_rules": {
        "d": {
            "move-claude": {"v": "move", "n": ""},
            "move-adr": {"v": "move", "n": ""},
            "move-mystery": {"v": "move", "n": ""},
        }
    },
    # "unmarked-item" deliberately absent
}

VERIFY_MAP = {"work-checkable": "grep -q revoked migration.sql"}

# build_plan() takes the *normalised* (flat) shape load_marks() produces, not the
# raw nested export -- flatten once here so plan-building tests stay independent
# of load_marks's own correctness (which TestLoadMarks covers separately).
MARKS_FLAT = {k: v for group in MARKS_NESTED.values() for k, v in group["d"].items()}


# ---------------------------------------------------------------------------
# load_items / load_marks / load_verify_map
# ---------------------------------------------------------------------------


class TestLoadItems:
    def test_accepts_bare_list(self, tmp_path):
        p = _write_json(tmp_path / "items.json", [{"key": "a", "group": "decide"}])
        assert load_items(p) == [{"key": "a", "group": "decide"}]

    def test_accepts_items_wrapper(self, tmp_path):
        p = _write_json(tmp_path / "items.json", {"items": [{"key": "a", "group": "decide"}]})
        assert load_items(p)[0]["key"] == "a"

    def test_id_falls_back_for_key(self, tmp_path):
        p = _write_json(tmp_path / "items.json", [{"id": "a", "group": "decide"}])
        assert load_items(p)[0]["key"] == "a"

    def test_accepts_items_keyed_by_doc_id(self, tmp_path):
        # The marking page's real export shape: the items collection keyed by doc id.
        p = _write_json(tmp_path / "items.json", {"items": {"2433.2": {"group": "fix_broken"}}})
        assert load_items(p) == [{"key": "2433.2", "group": "fix_broken"}]

    def test_rejects_keyed_items_with_non_object_values(self, tmp_path):
        p = _write_json(tmp_path / "items.json", {"items": {"a": "decide"}})
        with pytest.raises(CannotCheck):
            load_items(p)

    @pytest.mark.parametrize("bad", [
        [{"group": "decide"}],           # no key
        [{"key": "a"}],                  # no group
        [{"key": "a", "group": "x"}, {"key": "a", "group": "y"}],  # duplicate
        [],                               # empty
        "not a list",
    ])
    def test_rejects(self, tmp_path, bad):
        p = _write_json(tmp_path / "items.json", bad)
        with pytest.raises(CannotCheck):
            load_items(p)

    def test_unreadable_file(self, tmp_path):
        with pytest.raises(CannotCheck):
            load_items(tmp_path / "missing.json")

    def test_bad_json(self, tmp_path):
        p = tmp_path / "items.json"
        p.write_text("{not json")
        with pytest.raises(CannotCheck):
            load_items(p)


class TestLoadMarks:
    def test_nested_shape(self, tmp_path):
        p = _write_json(tmp_path / "marks.json", {"g": {"d": {"k": {"v": "remove", "n": ""}}}})
        assert load_marks(p) == {"k": {"v": "remove", "n": ""}}

    def test_flat_shape(self, tmp_path):
        p = _write_json(tmp_path / "marks.json", {"k": {"v": "work", "n": "x"}})
        assert load_marks(p) == {"k": {"v": "work", "n": "x"}}

    def test_invalid_verdict(self, tmp_path):
        p = _write_json(tmp_path / "marks.json", {"k": {"v": "maybe"}})
        with pytest.raises(CannotCheck):
            load_marks(p)

    def test_empty_refused(self, tmp_path):
        p = _write_json(tmp_path / "marks.json", {})
        with pytest.raises(CannotCheck):
            load_marks(p)

    def test_duplicate_key_across_groups_refused(self, tmp_path):
        p = _write_json(
            tmp_path / "marks.json",
            {"g1": {"d": {"k": {"v": "remove"}}}, "g2": {"d": {"k": {"v": "work"}}}},
        )
        with pytest.raises(CannotCheck):
            load_marks(p)


class TestLoadVerifyMap:
    def test_none_is_empty(self):
        assert load_verify_map(None) == {}

    def test_valid(self, tmp_path):
        p = _write_json(tmp_path / "vm.json", {"k": "grep -q x file"})
        assert load_verify_map(p) == {"k": "grep -q x file"}

    def test_rejects_non_string_values(self, tmp_path):
        p = _write_json(tmp_path / "vm.json", {"k": 5})
        with pytest.raises(CannotCheck):
            load_verify_map(p)


# ---------------------------------------------------------------------------
# small units
# ---------------------------------------------------------------------------


def test_claim_id():
    assert _claim_id("44.1a") == "DEBT-44.1A"
    assert _claim_id("offline-storage-swallow") == "DEBT-OFFLINE-STORAGE-SWALLOW"


def test_owning_adr_from_destination():
    assert _owning_adr_from_destination("fold into ADR 0162's own text") == "0162"
    assert _owning_adr_from_destination("amendment to ADR 159") == "0159"
    assert _owning_adr_from_destination("ROADMAP.md") is None
    assert _owning_adr_from_destination(None) is None


def test_md_cell_escapes_pipes_and_collapses_whitespace():
    assert _md_cell("a | b\nc   d") == "a \\| b c d"


# ---------------------------------------------------------------------------
# build_plan
# ---------------------------------------------------------------------------


class TestBuildPlan:
    def _plan(self):
        return build_plan(ALL_ITEMS, MARKS_FLAT, VERIFY_MAP, next_od_number=500)

    def test_remove_bucket(self):
        plan = self._plan()
        assert [r["key"] for r in plan.removed] == ["remove-me"]

    def test_work_with_verify_goes_to_claims(self):
        plan = self._plan()
        assert len(plan.claims_rows) == 1
        row = plan.claims_rows[0]
        assert row["id"] == "DEBT-WORK-CHECKABLE"
        assert row["status"] == "open"
        assert row["verify"] == VERIFY_MAP["work-checkable"]
        assert "Open definer" in row["claim"]
        assert "Founder note: do it" in row["claim"]

    def test_work_without_verify_goes_to_adr_open_items(self):
        plan = self._plan()
        assert "0159" in plan.adr_open_items
        keys = [r["key"] for r in plan.adr_open_items["0159"]]
        assert "work-uncheckable" in keys

    def test_decide_gets_sequential_od_ids_from_the_given_start(self):
        plan = self._plan()
        assert len(plan.open_decision_rows) == 1
        assert plan.open_decision_rows[0]["id"] == "OD-500"
        assert plan.open_decision_rows[0]["source_key"] == "decide-me"

    def test_move_roadmap(self):
        plan = self._plan()
        assert [r["key"] for r in plan.move_to_roadmap_futures] == ["move-roadmap"]

    def test_move_claude_conventions(self):
        plan = self._plan()
        assert [r["key"] for r in plan.move_to_claude_conventions] == ["move-claude"]

    def test_move_to_adr(self):
        plan = self._plan()
        assert "0162" in plan.adr_open_items
        keys = [r["key"] for r in plan.adr_open_items["0162"]]
        assert "move-adr" in keys

    def test_move_unclassified(self):
        plan = self._plan()
        assert [r["key"] for r in plan.move_unclassified] == ["move-mystery"]

    def test_unmarked_item_is_isolated_not_silently_dropped_or_guessed(self):
        plan = self._plan()
        assert [it["key"] for it in plan.unmarked] == ["unmarked-item"]
        # and it must not leak into any other bucket:
        all_other_keys = (
            {r["key"] for r in plan.removed}
            | {r["id"] for r in plan.claims_rows}
            | {r["key"] for v in plan.adr_open_items.values() for r in v}
            | {r["source_key"] for r in plan.open_decision_rows}
            | {r["key"] for r in plan.move_to_roadmap_futures}
            | {r["key"] for r in plan.move_to_claude_conventions}
            | {r["key"] for r in plan.move_unclassified}
        )
        assert "unmarked-item" not in all_other_keys

    def test_never_fabricates_a_verify_command(self):
        # work-uncheckable has no entry in VERIFY_MAP; it must never reach claims_rows.
        plan = self._plan()
        assert all(r["id"] != "DEBT-WORK-UNCHECKABLE" for r in plan.claims_rows)


# ---------------------------------------------------------------------------
# next_open_decision_number
# ---------------------------------------------------------------------------


class TestNextOpenDecisionNumber:
    def test_measures_max_across_open_and_resolved(self, tmp_path):
        repo = _init_repo(tmp_path)
        # fixture has OD-1, OD-3 (Open) and OD-2 (Resolved) -> next is 4
        assert next_open_decision_number(repo) == 4

    def test_missing_file_is_cannot_check(self, tmp_path):
        (tmp_path / ".planning" / "decisions").mkdir(parents=True)
        with pytest.raises(CannotCheck):
            next_open_decision_number(tmp_path)

    def test_zero_ids_is_never_vacuous(self, tmp_path):
        d = tmp_path / ".planning" / "decisions"
        d.mkdir(parents=True)
        (d / "OPEN-DECISIONS.md").write_text("# nothing here\n")
        with pytest.raises(CannotCheck):
            next_open_decision_number(tmp_path)


# ---------------------------------------------------------------------------
# classify_path
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path,expected_class",
    [
        ("CLAUDE.md", "gate-owned"),
        (".planning/decisions/README.md", "gate-owned"),
        (".planning/decisions/OPEN-DECISIONS.md", "open-decisions-link"),
        (".planning/decisions/CLAIMS.jsonl", "claims-prose"),
        (".planning/decisions/0162-managers-grant-manager-or-staff-on-both-doors.md", "adr-historical"),
        ("apps/web/src/foo.ts", "source-comment"),
        ("apps/api-gateway/coverage/index.html", "generated-coverage"),
        ("scripts/check_definer_functions_closed.py", "script-docstring"),
        (".github/workflows/e2e-prod.yml", "workflow-comment"),
        (".planning/06-pages/wines.md", "page-dossier-citation"),
        (".planning/08-softwares/inventory.md", "page-dossier-citation"),
        (".planning/01-org/anything.md", "historical-corpus"),
        ("supabase/migrations/x.sql", "sql-comment"),
        (".planning/PROJECT.md", "entry-point-doc"),
        (".planning/07-reference/INDEX.md", "reference-index"),
        (".planning/07-reference/UX_PATHS_CATALOG.md", "reference-doc"),
        (".planning/04-specs/ECOSYSTEM-PLAN.md", "reference-doc"),
        (".planning/00-index/cards.json", "generated-index"),
        ("some/other/path.md", "unclassified"),
    ],
)
def test_classify_path(path, expected_class):
    cls, replacement = classify_path(path)
    assert cls == expected_class
    assert replacement  # never an empty suggestion


# ---------------------------------------------------------------------------
# scan_citations
# ---------------------------------------------------------------------------


class TestScanCitations:
    def test_finds_and_classifies_every_seeded_citation(self, tmp_path):
        repo = _init_repo(tmp_path)
        citations = scan_citations(repo)
        by_file = {c["file"]: c for c in citations}
        assert "CLAUDE.md" in by_file
        assert by_file["CLAUDE.md"]["class"] == "gate-owned"
        assert "apps/web/src/foo.ts" in by_file
        assert by_file["apps/web/src/foo.ts"]["class"] == "source-comment"
        assert ".planning/06-pages/wines.md" in by_file
        assert "scripts/check_definer_functions_closed.py" in by_file

    def test_register_never_cites_itself(self, tmp_path):
        repo = _init_repo(tmp_path)
        citations = scan_citations(repo)
        assert all(c["file"] != ".planning/v3.0-TECH-DEBT.md" for c in citations)

    def test_no_hits_is_not_an_error(self, tmp_path):
        repo = tmp_path / "empty"
        repo.mkdir()
        subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
        (repo / "readme.md").write_text("nothing to see here\n")
        subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
        assert scan_citations(repo) == []

    def test_not_a_git_repo_is_cannot_check(self, tmp_path):
        not_repo = tmp_path / "not_a_repo"
        not_repo.mkdir()
        with pytest.raises(CannotCheck):
            scan_citations(not_repo)


# ---------------------------------------------------------------------------
# rendering
# ---------------------------------------------------------------------------


def test_render_claims_jsonl_roundtrips():
    rows = [{"id": "DEBT-X", "status": "open", "claim": "c", "verify": "true"}]
    text = render_claims_jsonl(rows)
    assert json.loads(text.strip()) == rows[0]


def test_render_claims_jsonl_empty():
    assert render_claims_jsonl([]) == ""


def test_render_open_decisions_md_format_matches_table():
    rows = [{"id": "OD-9", "question": "Q?", "why_it_matters": "it matters", "unblocks": "a sentence"}]
    text = render_open_decisions_md(rows)
    assert text.strip() == "| OD-9 | **Q?** | it matters | a sentence |"


# ---------------------------------------------------------------------------
# apply_claims / apply_open_decisions / assert_no_unmarked
# ---------------------------------------------------------------------------


class TestApplyClaims:
    def test_appends(self, tmp_path):
        repo = _init_repo(tmp_path)
        n = apply_claims(repo, [{"id": "DEBT-NEW", "status": "open", "claim": "c", "verify": "true"}])
        assert n == 1
        lines = (repo / ".planning/decisions/CLAIMS.jsonl").read_text().strip().splitlines()
        assert len(lines) == 2
        assert json.loads(lines[-1])["id"] == "DEBT-NEW"

    def test_refuses_collision_with_existing(self, tmp_path):
        repo = _init_repo(tmp_path)
        with pytest.raises(RefusedError):
            apply_claims(repo, [{"id": "DEBT-EXISTING", "status": "open", "claim": "c", "verify": "true"}])

    def test_refuses_collision_within_batch(self, tmp_path):
        repo = _init_repo(tmp_path)
        rows = [
            {"id": "DEBT-DUP", "status": "open", "claim": "c1", "verify": "true"},
            {"id": "DEBT-DUP", "status": "open", "claim": "c2", "verify": "false"},
        ]
        with pytest.raises(RefusedError):
            apply_claims(repo, rows)

    def test_empty_rows_is_a_noop(self, tmp_path):
        repo = _init_repo(tmp_path)
        before = (repo / ".planning/decisions/CLAIMS.jsonl").read_text()
        assert apply_claims(repo, []) == 0
        assert (repo / ".planning/decisions/CLAIMS.jsonl").read_text() == before

    def test_malformed_existing_row_is_cannot_check(self, tmp_path):
        repo = _init_repo(tmp_path)
        (repo / ".planning/decisions/CLAIMS.jsonl").write_text("not json\n")
        with pytest.raises(CannotCheck):
            apply_claims(repo, [{"id": "DEBT-NEW", "status": "open", "claim": "c", "verify": "true"}])


class TestApplyOpenDecisions:
    def test_inserts_before_resolved_and_preserves_rest(self, tmp_path):
        repo = _init_repo(tmp_path)
        path = repo / ".planning/decisions/OPEN-DECISIONS.md"
        before = path.read_text()
        rows = [{"id": "OD-4", "question": "New fork", "why_it_matters": "why", "unblocks": "how"}]
        n = apply_open_decisions(repo, rows)
        assert n == 1
        after = path.read_text()
        assert "| OD-4 | **New fork** | why | how |" in after
        assert after.index("OD-4") < after.index("## Resolved")
        # everything that existed before is still present, byte for byte
        assert "| OD-1 | **First fork**" in after
        assert "| OD-2 | **Already answered**" in after
        assert before.split("## Resolved")[1] == after.split("## Resolved")[1]

    def test_refuses_missing_resolved_heading(self, tmp_path):
        repo = _init_repo(tmp_path)
        path = repo / ".planning/decisions/OPEN-DECISIONS.md"
        path.write_text("# Open Decisions\n\n## Open\n\nno resolved heading here\n")
        with pytest.raises(CannotCheck):
            apply_open_decisions(repo, [{"id": "OD-9", "question": "q", "why_it_matters": "w", "unblocks": "u"}])

    def test_refuses_id_collision(self, tmp_path):
        repo = _init_repo(tmp_path)
        with pytest.raises(RefusedError):
            apply_open_decisions(repo, [{"id": "OD-1", "question": "dup", "why_it_matters": "w", "unblocks": "u"}])

    def test_empty_rows_is_a_noop(self, tmp_path):
        repo = _init_repo(tmp_path)
        before = (repo / ".planning/decisions/OPEN-DECISIONS.md").read_text()
        assert apply_open_decisions(repo, []) == 0
        assert (repo / ".planning/decisions/OPEN-DECISIONS.md").read_text() == before


class TestAssertNoUnmarked:
    def test_passes_when_empty(self):
        plan = build_plan(ALL_ITEMS, MARKS_FLAT, VERIFY_MAP, next_od_number=1)
        with pytest.raises(RefusedError):
            assert_no_unmarked(plan)  # ALL_ITEMS includes the deliberately-unmarked one

    def test_passes_when_everything_marked(self):
        items = [it for it in ALL_ITEMS if it["key"] != "unmarked-item"]
        plan = build_plan(items, MARKS_FLAT, VERIFY_MAP, next_od_number=1)
        assert_no_unmarked(plan)  # must not raise


# ---------------------------------------------------------------------------
# end-to-end via main()
# ---------------------------------------------------------------------------


class TestMainEndToEnd:
    def _write_fixtures(self, tmp_path):
        items_path = _write_json(tmp_path / "items.json", ALL_ITEMS)
        marks_path = _write_json(tmp_path / "marks.json", MARKS_NESTED)
        verify_path = _write_json(tmp_path / "verify.json", VERIFY_MAP)
        return items_path, marks_path, verify_path

    def test_dry_run_exits_zero_and_writes_every_output_file(self, tmp_path):
        repo = _init_repo(tmp_path)
        items_path, marks_path, verify_path = self._write_fixtures(tmp_path)
        out_dir = tmp_path / "out"
        rc = main(
            [
                "--items", str(items_path),
                "--marks", str(marks_path),
                "--verify-map", str(verify_path),
                "--repo-root", str(repo),
                "--out", str(out_dir),
            ]
        )
        assert rc == 0
        expected = {
            "claims_draft.jsonl", "open_decisions_draft.md", "adr_open_items.json",
            "move_relocations.json", "citations.json", "unmarked.json", "removed.json", "summary.md",
        }
        assert expected <= {p.name for p in out_dir.iterdir()}
        unmarked = json.loads((out_dir / "unmarked.json").read_text())
        assert unmarked == [{"key": "unmarked-item", "group": "decide"}]
        # dry run must NOT touch the real repo files
        assert "DEBT-WORK-CHECKABLE" not in (repo / ".planning/decisions/CLAIMS.jsonl").read_text()

    def test_apply_refuses_while_unmarked_items_remain(self, tmp_path):
        repo = _init_repo(tmp_path)
        items_path, marks_path, verify_path = self._write_fixtures(tmp_path)
        rc = main(
            [
                "--items", str(items_path),
                "--marks", str(marks_path),
                "--verify-map", str(verify_path),
                "--repo-root", str(repo),
                "--out", str(tmp_path / "out"),
                "--apply",
            ]
        )
        assert rc == 1
        assert "DEBT-WORK-CHECKABLE" not in (repo / ".planning/decisions/CLAIMS.jsonl").read_text()

    def test_apply_writes_claims_and_open_decisions_once_everything_is_marked(self, tmp_path):
        repo = _init_repo(tmp_path)
        items = [it for it in ALL_ITEMS if it["key"] != "unmarked-item"]
        items_path = _write_json(tmp_path / "items.json", items)
        marks_path = _write_json(tmp_path / "marks.json", MARKS_NESTED)
        verify_path = _write_json(tmp_path / "verify.json", VERIFY_MAP)
        rc = main(
            [
                "--items", str(items_path),
                "--marks", str(marks_path),
                "--verify-map", str(verify_path),
                "--repo-root", str(repo),
                "--out", str(tmp_path / "out"),
                "--apply",
            ]
        )
        assert rc == 0
        claims_text = (repo / ".planning/decisions/CLAIMS.jsonl").read_text()
        assert "DEBT-WORK-CHECKABLE" in claims_text
        od_text = (repo / ".planning/decisions/OPEN-DECISIONS.md").read_text()
        assert "OD-4" in od_text  # next-free after OD-1/2/3 in the fixture

    def test_cannot_check_maps_to_exit_2(self, tmp_path):
        repo = _init_repo(tmp_path)
        rc = main(
            [
                "--items", str(tmp_path / "does-not-exist.json"),
                "--marks", str(tmp_path / "does-not-exist.json"),
                "--repo-root", str(repo),
                "--out", str(tmp_path / "out"),
            ]
        )
        assert rc == 2
