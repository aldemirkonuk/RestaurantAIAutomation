#!/usr/bin/env python3
"""Deploy to Production acts only on this repository's own pushes to main.

Founder, 2026-09-30, on #534, verbatim pick: "Sign off, add deploy fix
(Recommended)". deploy.yml's `workflow_run: branches: [main]` trigger also
matches a fork's pull request whose branch is named `main`; its stages check
out that run's head_sha and run its code beside ADMIN_API_KEY. The rule this
guard holds, read from the workflow text strictly (no YAML library: the CI
jobs that run it do not install one). Shapes it does not recognise are
refused where it can tell; its self-test lists every evasion found so far:

  1. The jobs: block holds only plain `  name:` job keys, full-line comments
     and lines indented four or more spaces. A quoted, flow-style, anchored or
     aliased key, a tab, a CR or a duplicate key fails.
  2. The job set is exactly EXPECTED_IF's, and each job's single job-level
     `if` equals, whitespace-normalised, the one EXPECTED_IF allows: each job a
     workflow_run can start requires this repository's own push; rollback-guide
     is dispatch-only; ci-gate has none. No job is a reusable-workflow call.
  3. ci-gate has exactly one step named "The run is this repository's own
     push to main", equal to REFUSAL_STEP line for line (blank and comment
     lines dropped); ci-gate writes neither GITHUB_ENV nor GITHUB_OUTPUT.
  3b. The on: block equals ON_BLOCK (no added trigger, same workflow_run
     filter), and the file sets no defaults:.
  4. No line of deploy.yml sets `continue-on-error`.

What it cannot hold: GitHub's own evaluation (workflow_run runs main's copy of
the file), and any YAML form this reader refuses but GitHub would also reject.

Exit 0 holds, 1 broken, 2 cannot read. `--self-test` plants each break.
Owned by scripts/test_pr_audit_gate.py
(test_deploy_runs_only_on_this_repositorys_own_pushes), which runs it.
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEPLOY = ROOT / ".github" / "workflows" / "deploy.yml"
OWN = ("(github.event_name == 'workflow_run' && github.event.workflow_run.event == 'push' "
       "&& github.event.workflow_run.head_repository.full_name == github.repository)")
STEP = "The run is this repository's own push to main"


ON_BLOCK = """  workflow_run:
    workflows: ["CI"]
    types: [completed]
    branches: [main]
  workflow_dispatch:
    inputs:
      mode:
        description: "deploy-audit (post-push health check) or rollback-guide (print revert steps)"
        type: choice
        options:
          - deploy-audit
          - rollback-guide
        default: deploy-audit
      rollback_target_sha:
        description: "Git SHA to roll back to (rollback-guide mode only)"
        type: string
        default: \"\"
"""
# The refusal step, verbatim (blank lines and full-line comments dropped).
REFUSAL_STEP = """- name: The run is this repository's own push to main
        if: github.event_name == 'workflow_run'
        env:
          RUN_EVENT: ${{ github.event.workflow_run.event }}
          RUN_REPO: ${{ github.event.workflow_run.head_repository.full_name }}
          THIS_REPO: ${{ github.repository }}
        run: |
          if [ "$RUN_EVENT" = "push" ] && [ "$RUN_REPO" = "$THIS_REPO" ]; then
            echo "CI run is a push to $THIS_REPO; proceeding"
            exit 0
          fi
          echo "::error::Refusing: the CI run that triggered this was event '$RUN_EVENT' from '$RUN_REPO', not a push to '$THIS_REPO'. No stage runs its code."
          exit 1"""
DISPATCH = "(github.event_name == 'workflow_dispatch' && inputs.mode == 'deploy-audit')"
# The only job-level `if` each job may carry, whitespace-normalised. A job not
# named here fails: adding one means adding its `if` to this gate-owned table.
EXPECTED_IF = {
    "ci-gate": None,
    "verify-orchestrator": f"{OWN} || {DISPATCH}",
    "verify-api-gateway": f"{OWN} || {DISPATCH}",
    "verify-frontend": f"{OWN} || {DISPATCH}",
    "deploy-audit": f"always() && needs.ci-gate.result == 'success' && ({OWN} || {DISPATCH})",
    "rollback-guide": "github.event_name == 'workflow_dispatch' && inputs.mode == 'rollback-guide'",
}
JOB_KEY = re.compile(r"^  ([a-z][a-z0-9-]*):$")


def _norm(v: str) -> str:
    return re.sub(r"\s+", " ", v).replace("( ", "(").replace(" )", ")").strip()


def _jobs(text: str) -> tuple[dict[str, str], list[str]]:
    """Split the jobs: block strictly. Anything that is not a full-line
    comment, a plain `  name:` key, or a line indented four or more spaces is
    refused -- a quoted, flow-style, anchored or aliased job key, a tab, a
    stray indent -- because this splitter could not see a job written that way."""
    errs: list[str] = []
    if "\r" in text or "\t" in text:
        errs.append("deploy.yml carries a CR or a tab")
    if text.count("\njobs:\n") != 1:
        return {}, errs + ["expected exactly one top-level `jobs:` line"]
    body = text.split("\njobs:\n", 1)[1]
    jobs: dict[str, list[str]] = {}
    cur = None
    for n, line in enumerate(body.split("\n"), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            if cur:
                jobs[cur].append(line)
            continue
        m = JOB_KEY.match(line)
        if m:
            cur = m.group(1)
            if cur in jobs:
                errs.append(f"job {cur!r} is declared twice")
            jobs[cur] = []
            continue
        if line.startswith("    ") and cur:
            jobs[cur].append(line)
            continue
        errs.append(f"jobs: line {n} is neither a plain job key nor inside a job: {line[:60]!r}")
    return {k: "\n".join(v) for k, v in jobs.items()}, errs


def _job_ifs(job: str) -> list[str]:
    """Every job-level `if` key (plain, quoted or spaced: `if:`, `"if":`,
    `if :`), with a block scalar read the way YAML reads it: blank lines are
    part of the scalar, and it ends only at a non-blank line indented less
    than six spaces."""
    lines = job.split("\n")
    out = []
    for i, line in enumerate(lines):
        m = re.match(r"""^    (["']?)if\1\s*:(.*)$""", line)
        if not m:
            continue
        head = m.group(2).strip()
        if re.fullmatch(r"[>|][+-]?\d?|[>|]\d?[+-]?", head):
            val = []
            for nxt in lines[i + 1:]:
                if not nxt.strip() or nxt.startswith("      "):
                    val.append(nxt.strip())
                else:
                    break
            out.append(" ".join(v for v in val if v))
        else:
            out.append(head)
    return out


def _steps(job: str) -> list[str]:
    if "\n    steps:\n" not in "\n" + job:
        return []
    body = ("\n" + job).split("\n    steps:\n", 1)[1]
    return [s for s in re.split(r"(?m)^      - ", body)[1:]]


def _code(text: str) -> str:
    return "\n".join(l for l in text.split("\n") if not l.lstrip().startswith("#"))


def problems(text: str) -> list[str]:
    jobs, out = _jobs(text)
    if not jobs:
        return out or ["no jobs read"]
    if set(jobs) != set(EXPECTED_IF):
        out.append(f"job set is {sorted(jobs)}, expected {sorted(EXPECTED_IF)} (a new job needs its `if` in EXPECTED_IF)")
    if "continue-on-error" in _code(text):
        out.append("continue-on-error appears in deploy.yml")
    for name, job in jobs.items():
        code = _code(job)
        if re.search(r"(?m)^    uses:", code):
            out.append(f"{name}: is a reusable-workflow call")
        ifs = _job_ifs(job)
        want = EXPECTED_IF.get(name, "<unknown job>")
        if want is None:
            if ifs:
                out.append(f"{name}: carries a job-level if (it must always run and fail red)")
            continue
        if len(ifs) != 1:
            out.append(f"{name}: has {len(ifs)} job-level if lines, expected exactly 1")
            continue
        if _norm(ifs[0]) != _norm(want):
            out.append(f"{name}: its if is {_norm(ifs[0])!r}, not the one allowed")
    gate_job = jobs.get("ci-gate", "")
    if "GITHUB_ENV" in gate_job or "GITHUB_OUTPUT" in gate_job:
        out.append("ci-gate writes GITHUB_ENV or GITHUB_OUTPUT (a later step's values could be overridden)")
    on_block = text.split("\non:\n", 1)[1].split("\n\n", 1)[0] if "\non:\n" in text else ""
    if _code(on_block).strip("\n") != ON_BLOCK.strip("\n"):
        out.append("the on: block differs from the one allowed (a new trigger, or a changed workflow_run filter)")
    if re.search(r"(?m)^\s*defaults\s*:", _code(text)):
        out.append("deploy.yml sets defaults: (a run shell or directory override)")
    gate = [s for s in _steps(gate_job) if s.startswith(f"name: {STEP}\n")]
    if len(gate) != 1:
        out.append(f"ci-gate: expected one step named {STEP!r}, found {len(gate)}")
    else:
        body = "- " + gate[0].rstrip("\n")
        body = "\n".join(l.rstrip() for l in body.split("\n") if l.strip())
        if body != REFUSAL_STEP.strip("\n"):
            out.append("ci-gate refusal step differs from the one allowed, byte for byte (any added line, a changed if, env or run)")
    return out


def _self_test(verbose: bool = False) -> int:
    base = DEPLOY.read_text()
    if problems(base):
        print("SELF-TEST CANNOT RUN: the real deploy.yml does not hold:", problems(base))
        return 2
    step_if = "      - name: " + STEP + "\n        if: github.event_name == 'workflow_run'\n"
    muts = {
        "refusal step if: false": (step_if, step_if.replace("github.event_name == 'workflow_run'", "false")),
        "refusal step continue-on-error": (step_if, step_if + "        continue-on-error: true\n"),
        "refusal step if on push": (step_if, step_if.replace("'workflow_run'", "'push'")),
        "refusal exits 0": ("          echo \"::error::Refusing", "          exit 0\n          echo \"::error::Refusing"),
        "repo comparison dropped": (' && [ "$RUN_REPO" = "$THIS_REPO" ]', ""),
        "Stage 3 condition only in a comment": (
            "  verify-frontend:\n    name: \"Stage 3 — Frontend Build\"\n    runs-on: ubuntu-latest\n    needs: [verify-api-gateway]\n    if: >-\n      " + OWN,
            "  verify-frontend:\n    name: \"Stage 3 — Frontend Build\"\n    runs-on: ubuntu-latest\n    needs: [verify-api-gateway]\n    if: >-\n      # " + OWN + "\n      github.event_name == 'workflow_run'"),
        "a new always() job": ("\n  rollback-guide:\n", "\n  sneak:\n    runs-on: ubuntu-latest\n    if: always()\n    steps:\n      - run: pnpm install\n\n  rollback-guide:\n"),
        "a new job with no if": ("\n  rollback-guide:\n", "\n  sneak:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm install\n\n  rollback-guide:\n"),
        "push condition dropped from Stage 2": (
            "    needs: [verify-orchestrator]\n    if: >-\n      " + OWN,
            "    needs: [verify-orchestrator]\n    if: >-\n      " + OWN.replace(" && github.event.workflow_run.event == 'push'", "")),
        "ci-gate given a job-level if": ("  ci-gate:\n    name: CI Gate\n", "  ci-gate:\n    name: CI Gate\n    if: github.event_name != 'workflow_run'\n"),
        # round-2 planner's B1-B9 on the first strict version (2026-09-30):
        "B1 own group || always()": (
            "    needs: [verify-orchestrator]\n    if: >-\n      " + OWN,
            "    needs: [verify-orchestrator]\n    if: >-\n      " + OWN + " || failure() || always()"),
        "B2 one-line if with the group in a comment": (
            "    needs: [verify-orchestrator]\n    if: >-\n      " + OWN + "\n      || " + DISPATCH,
            "    needs: [verify-orchestrator]\n    if: always() # " + OWN + " || " + DISPATCH),
        "B3 quoted job key": ("\n  rollback-guide:\n", "\n  \"sneak\":\n    runs-on: ubuntu-latest\n    if: always()\n    steps:\n      - run: pnpm install\n\n  rollback-guide:\n"),
        "B4 job key with a trailing space": ("\n  rollback-guide:\n", "\n  sneak: \n    runs-on: ubuntu-latest\n    if: always()\n    steps:\n      - run: pnpm install\n\n  rollback-guide:\n"),
        "B5 flow-style job": ("\n  rollback-guide:\n", "\n  sneak: {runs-on: ubuntu-latest, if: always(), steps: [{run: pnpm install}]}\n\n  rollback-guide:\n"),
        "B6 hidden if inside a multi-line name": (
            "  verify-frontend:\n    name: \"Stage 3 — Frontend Build\"\n",
            "  verify-frontend:\n    name: \"Stage 3 — Frontend Build\n    if: x\"\n    if: always()\n"),
        "B7 own group || not-dispatch": (
            "    needs: [verify-orchestrator]\n    if: >-\n      " + OWN,
            "    needs: [verify-orchestrator]\n    if: >-\n      " + OWN + " || github.event_name != 'workflow_dispatch'"),
        "B9 job alias": ("\n  rollback-guide:\n", "\n  sneak: *s\n\n  rollback-guide:\n"),
        "duplicate ci-gate": ("\n  rollback-guide:\n", "\n  ci-gate:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n\n  rollback-guide:\n"),
        "reusable-workflow stage": ("    needs: [verify-api-gateway]\n", "    needs: [verify-api-gateway]\n    uses: ./.github/workflows/other.yml\n"),
        "ci-gate writes GITHUB_ENV": ('          if [ "$CONCLUSION" = "success" ]; then\n', '          echo "RUN_EVENT=push" >> "$GITHUB_ENV"\n          if [ "$CONCLUSION" = "success" ]; then\n'),
        "a tab": ("\n  rollback-guide:\n", "\n\t\n  rollback-guide:\n"),
        # round-2 adversarial reviewer (2026-09-30):
        "blank line then || always() in a folded if": (
            "    needs: [verify-api-gateway]\n    if: >-\n      " + OWN + "\n      || " + DISPATCH + "\n",
            "    needs: [verify-api-gateway]\n    if: >-\n      " + OWN + "\n      || " + DISPATCH + "\n\n      || always()\n"),
        "blank line then || always() in a literal if": (
            "    needs: [verify-api-gateway]\n    if: >-\n      " + OWN + "\n      || " + DISPATCH + "\n",
            "    needs: [verify-api-gateway]\n    if: |-\n      " + OWN + "\n      || " + DISPATCH + "\n\n      || always()\n"),
        "quoted if key on ci-gate": ("  ci-gate:\n    name: CI Gate\n", "  ci-gate:\n    name: CI Gate\n    \"if\": false\n"),
        "spaced if key on ci-gate": ("  ci-gate:\n    name: CI Gate\n", "  ci-gate:\n    name: CI Gate\n    if : false\n"),
        "exit 0 before the check": ('        run: |\n          if [ "$RUN_EVENT" = "push" ]', '        run: |\n          exit 0\n          if [ "$RUN_EVENT" = "push" ]'),
        "RUN_EVENT reassigned before the check": ('        run: |\n          if [ "$RUN_EVENT" = "push" ]', '        run: |\n          RUN_EVENT=push\n          if [ "$RUN_EVENT" = "push" ]'),
        "defaults run shell": ("\njobs:\n", "\ndefaults:\n  run:\n    shell: bash\n\njobs:\n"),
        "a pull_request_target trigger": ("\non:\n", "\non:\n  pull_request_target:\n"),
    }
    failed = []
    for name, (old, new) in muts.items():
        if base.count(old) < 1:
            failed.append(f"{name}: no-op (target text not found)")
            continue
        found = problems(base.replace(old, new, 1))
        if not found:
            failed.append(f"{name}: survived")
        elif verbose:
            print(f"  {name}: {found[0]}")
    if failed:
        print("SELF-TEST FAILED:\n  " + "\n  ".join(failed))
        return 1
    print(f"SELF-TEST OK -- {len(muts)} planted breaks, each caught")
    return 0


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        return _self_test("--verbose" in argv)
    try:
        text = DEPLOY.read_text()
        found = problems(text)
    except (OSError, ValueError) as exc:
        print(f"CANNOT CHECK: {exc}")
        return 2
    if found:
        print("FAIL -- deploy.yml can act on a run that is not this repository's own push:\n  " + "\n  ".join(found))
        return 1
    print("PASS -- every deploy.yml job a workflow_run can start requires this repository's own push to main.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
