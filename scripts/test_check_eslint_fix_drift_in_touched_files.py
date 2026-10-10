"""`scripts/check_eslint_fix_drift_in_touched_files.py` and the CI wiring F-925 earned.

The wiring cases read the repo's own ci.yml and package.json files: before the
fix, CI's ESLint step ran `pnpm run lint`, which reaches the gateway's
`eslint --fix`, so the step could rewrite drift and pass. The guard cases stub
ESLint and git, because this suite runs in the Python lint job, which has no
node_modules; the real ESLint is exercised by the guard's own `--self-test`
probe in the TypeScript job.

    pytest scripts/test_check_eslint_fix_drift_in_touched_files.py -q
"""

from __future__ import annotations

import json
import pathlib
import re
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from scripts import check_eslint_fix_drift_in_touched_files as guard  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]


def _steps() -> dict[str, str]:
    # Text, not yaml: the Python lint job that runs this suite has no PyYAML.
    ci = (REPO_ROOT / ".github/workflows/ci.yml").read_text()
    job = re.search(r"^  lint-typescript:\n(.*?)(?=^  [\w-]+:\n)", ci, re.M | re.S)
    assert job, "lint-typescript job not found in ci.yml"
    steps = re.findall(r"^      - name: (.+)\n(?:(?!      - ).*\n)*?        run: (.+)$", job.group(1), re.M)
    return {name.strip(): run for name, run in steps}


def _scripts(rel: str) -> dict[str, str]:
    return json.loads((REPO_ROOT / rel / "package.json").read_text()).get("scripts", {})


def _workspaces() -> list[str]:
    return [
        str(p.parent.relative_to(REPO_ROOT))
        for pattern in ("apps/*/package.json", "packages/*/package.json", "services/*/package.json")
        for p in sorted(REPO_ROOT.glob(pattern))
    ]


def test_ci_eslint_step_runs_the_non_fixing_check():
    assert _steps()["Run ESLint"].strip() == "pnpm run lint:check"
    assert _scripts(".")["lint:check"] == "turbo run lint:check"


def test_every_package_that_lints_has_a_check_that_never_fixes():
    linting = [w for w in _workspaces() if "lint" in _scripts(w)]
    assert "apps/api-gateway" in linting
    for w in linting:
        check = _scripts(w).get("lint:check")
        assert check, f"{w} lints but has no lint:check, so turbo would skip it in CI"
        assert "--fix" not in check, f"{w} lint:check rewrites files"


def test_ci_runs_the_drift_guard_against_a_base():
    run = _steps()["Changed gateway lines are already eslint --fix clean"]
    assert "check_eslint_fix_drift_in_touched_files.py --base" in run


def test_scope_mirrors_the_gateway_lint_glob():
    assert '"{src,apps,libs,test}/**/*.ts"' in _scripts("apps/api-gateway")["lint"]
    assert guard.in_lint_scope("apps/api-gateway/src/orders/orders.service.ts")
    assert guard.in_lint_scope("apps/api-gateway/test/app.e2e-spec.ts")
    assert not guard.in_lint_scope("apps/api-gateway/package.json")
    assert not guard.in_lint_scope("apps/api-gateway/scripts/x.ts")
    assert not guard.in_lint_scope("apps/web/src/main.ts")


def test_added_lines_reads_the_new_side_of_each_hunk():
    diff = (
        "diff --git a/apps/api-gateway/src/a.ts b/apps/api-gateway/src/a.ts\n"
        "--- a/apps/api-gateway/src/a.ts\n"
        "+++ b/apps/api-gateway/src/a.ts\n"
        "@@ -3 +3 @@ x\n-old\n+new\n"
        "@@ -9,0 +10,2 @@ y\n+one\n+two\n"
        "@@ -20,2 +22,0 @@ z\n-gone\n-gone\n"
        "diff --git a/apps/api-gateway/src/d.ts b/apps/api-gateway/src/d.ts\n"
        "--- a/apps/api-gateway/src/d.ts\n"
        "+++ b/apps/api-gateway/src/d.ts\n"
        "@@ -5 +4,0 @@\n-only a deletion\n"
    )
    # A pure deletion (`+n,0`) adds no line, so d.ts is not judged at all.
    assert guard.added_lines(diff) == {"apps/api-gateway/src/a.ts": {3, 10, 11}}


def _msg(line, fixable=True, end=None):
    m = {"ruleId": "prettier/prettier", "line": line, "message": f"m{line}"}
    if end:
        m["endLine"] = end
    if fixable:
        m["fix"] = {"range": [0, 0], "text": ""}
    return m


def test_drifting_counts_only_fixable_problems_on_changed_lines():
    results = [
        {
            "filePath": str(REPO_ROOT / guard.GATEWAY / "src/a.ts"),
            "messages": [_msg(3), _msg(4), _msg(5, fixable=False), _msg(8, end=10)],
        }
    ]
    found = guard.drifting(results, {"src/a.ts": {3, 5, 9}})
    # 3: fixable on a changed line. 4: legacy drift, untouched. 5: changed but
    # not fixable (lint:check owns it). 8-10: spans changed line 9.
    assert [(rel, line) for rel, line, _m, _f in found] == [("src/a.ts", 3), ("src/a.ts", 8)]


def test_apply_fixes_counts_utf16_units_and_skips_overlaps():
    text = "\ufeffconst s = '\U0001F377';  const t={a:1}\r\n"
    # Offsets as ESLint gives them: after the BOM, the wine glass is 2 units.
    i = text.index("{a:1}")  # -1 for the BOM, +1 for the surrogate pair
    fixes = [
        {"range": [i + 1, i + 1], "text": " "},
        {"range": [i + 4, i + 4], "text": " "},
        {"range": [i + 2, i + 5], "text": "OVERLAP"},
    ]
    out = guard.apply_fixes(text, fixes)
    assert out.startswith("\ufeff") and out.endswith("\r\n")
    assert "const t={ a:1 }" in out and "OVERLAP" not in out


def _stub(monkeypatch, changed, drift, probe_sees=True):
    """`changed`: {rel: lines}. `drift`: {rel: lines with a fixable problem}."""

    def run_eslint(args, stdin=None):
        if stdin is not None:
            sees = stdin == guard.PROBE_DRIFTING and probe_sees
            return [{"filePath": "<text>", "messages": [_msg(1)] if sees else []}]
        return [
            {"filePath": str(REPO_ROOT / guard.GATEWAY / a), "messages": [_msg(n) for n in sorted(drift.get(a, ()))]}
            for a in args
        ]

    monkeypatch.setattr(guard, "_run_eslint", run_eslint)
    monkeypatch.setattr(guard, "touched", lambda base: changed)


def test_seeded_drift_on_a_changed_line_fails(monkeypatch, capsys):
    _stub(monkeypatch, {"src/a.ts": {1, 2}, "src/b.ts": {7}}, {"src/b.ts": {7}})
    assert guard.main("origin/main") == 1
    out = capsys.readouterr().out
    assert "file=apps/api-gateway/src/b.ts,line=7" in out
    assert "src/a.ts" not in out


def test_legacy_drift_in_a_touched_file_passes(monkeypatch):
    # F-960: the file drifts on lines the change never touched.
    _stub(monkeypatch, {"src/a.ts": {40}}, {"src/a.ts": {3, 90}})
    assert guard.main("origin/main") == 0


def test_clean_changed_lines_pass(monkeypatch):
    _stub(monkeypatch, {"src/a.ts": {1}}, {})
    assert guard.main("origin/main") == 0


def test_nothing_changed_passes(monkeypatch):
    _stub(monkeypatch, {}, {})
    assert guard.main("origin/main") == 0


def test_blind_eslint_is_cannot_check_not_pass(monkeypatch):
    _stub(monkeypatch, {"src/a.ts": {1}}, {}, probe_sees=False)
    assert guard.main("origin/main") == 2


def _git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


def test_touched_reads_changed_lines_from_git(monkeypatch, tmp_path):
    """Real git: an edit, an insertion, a pure deletion and an out-of-scope file."""
    _git(tmp_path, "init", "-q", "-b", "main")
    _git(tmp_path, "config", "user.email", "t@t")
    _git(tmp_path, "config", "user.name", "t")
    src = tmp_path / guard.GATEWAY / "src"
    src.mkdir(parents=True)
    (src / "a.ts").write_text("".join(f"line{n}\n" for n in range(1, 11)))
    (src / "d.ts").write_text("keep\ndrop\nkeep\n")
    (tmp_path / guard.GATEWAY / "x.json").write_text("{}\n")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-q", "-m", "base")
    _git(tmp_path, "checkout", "-q", "-b", "pr")
    (src / "a.ts").write_text("line1\nEDITED\n" + "".join(f"line{n}\n" for n in range(3, 11)) + "ADDED\n")
    (src / "d.ts").write_text("keep\nkeep\n")
    (tmp_path / guard.GATEWAY / "x.json").write_text('{"a": 1}\n')
    _git(tmp_path, "commit", "-qam", "pr")
    monkeypatch.setattr(guard, "REPO_ROOT", tmp_path)
    assert guard.touched("main") == {"src/a.ts": {2, 11}}
    # An uncommitted edit counts too: ESLint reads the working tree, so the
    # line numbers must come from it (a `--fix` run is uncommitted).
    (src / "a.ts").write_text("NEW TOP\n" + (src / "a.ts").read_text())
    assert guard.touched("main") == {"src/a.ts": {1, 3, 12}}


def test_fix_mode_changes_only_reported_problems(monkeypatch, tmp_path):
    rel = "src/a.ts"
    path = tmp_path / guard.GATEWAY / rel
    path.parent.mkdir(parents=True)
    path.write_text("a={x:1}\nb={y:2}\n")
    monkeypatch.setattr(guard, "REPO_ROOT", tmp_path)

    def run_eslint(args, stdin=None):
        if stdin is not None:
            return [{"filePath": "<text>", "messages": [_msg(1)] if stdin == guard.PROBE_DRIFTING else []}]
        legacy = {"ruleId": "prettier/prettier", "line": 1, "message": "", "fix": {"range": [2, 3], "text": "{ "}}
        mine = {"ruleId": "prettier/prettier", "line": 2, "message": "", "fix": {"range": [10, 11], "text": "{ "}}
        return [{"filePath": str(path), "messages": [legacy, mine]}]

    monkeypatch.setattr(guard, "_run_eslint", run_eslint)
    monkeypatch.setattr(guard, "touched", lambda base: {rel: {2}})
    assert guard.main("origin/main", fix=True) == 0
    assert path.read_text() == "a={x:1}\nb={ y:2}\n"
