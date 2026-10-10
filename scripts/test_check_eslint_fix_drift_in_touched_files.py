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
    run = _steps()["Touched gateway files are already eslint --fix clean"]
    assert "check_eslint_fix_drift_in_touched_files.py --base" in run


def test_scope_mirrors_the_gateway_lint_glob():
    assert '"{src,apps,libs,test}/**/*.ts"' in _scripts("apps/api-gateway")["lint"]
    assert guard.in_lint_scope("apps/api-gateway/src/orders/orders.service.ts")
    assert guard.in_lint_scope("apps/api-gateway/test/app.e2e-spec.ts")
    assert not guard.in_lint_scope("apps/api-gateway/package.json")
    assert not guard.in_lint_scope("apps/api-gateway/scripts/x.ts")
    assert not guard.in_lint_scope("apps/web/src/main.ts")


def test_drifting_reads_the_output_key_only():
    results = [
        {"filePath": "/r/a.ts", "messages": [], "output": "fixed"},
        {"filePath": "/r/b.ts", "messages": [{"ruleId": "no-unused-vars"}]},
    ]
    assert guard.drifting(results) == ["/r/a.ts"]


def _stub(monkeypatch, files, drift, probe_sees=True):
    def run_eslint(args, stdin=None):
        if stdin is not None:
            changed = stdin == guard.PROBE_DRIFTING and probe_sees
            return [{"filePath": "<text>", **({"output": "x"} if changed else {})}]
        return [
            {"filePath": str(REPO_ROOT / guard.GATEWAY / a), **({"output": "x"} if a in drift else {})}
            for a in args
        ]

    monkeypatch.setattr(guard, "_run_eslint", run_eslint)
    monkeypatch.setattr(guard, "touched", lambda base: files)


def test_seeded_drift_in_a_touched_file_fails(monkeypatch, capsys):
    _stub(monkeypatch, ["apps/api-gateway/src/a.ts", "apps/api-gateway/src/b.ts"], {"src/b.ts"})
    assert guard.main("origin/main") == 1
    assert "apps/api-gateway/src/b.ts" in capsys.readouterr().out


def test_clean_touched_files_pass(monkeypatch):
    _stub(monkeypatch, ["apps/api-gateway/src/a.ts"], set())
    assert guard.main("origin/main") == 0


def test_nothing_touched_passes(monkeypatch):
    _stub(monkeypatch, [], set())
    assert guard.main("origin/main") == 0


def test_blind_eslint_is_cannot_check_not_pass(monkeypatch):
    _stub(monkeypatch, ["apps/api-gateway/src/a.ts"], set(), probe_sees=False)
    assert guard.main("origin/main") == 2
