#!/usr/bin/env python3
"""Deploy to Production acts only on this repository's own pushes to main.

Founder, 2026-09-30, on #534, verbatim pick: "Sign off, add deploy fix
(Recommended)". deploy.yml's `workflow_run: branches: [main]` trigger also
matches a fork's pull request whose branch is named `main`; its stages check
out that run's head_sha and run its code beside ADMIN_API_KEY. The rule this
guard holds, read from the workflow text with comments stripped (no YAML
library: the CI jobs that run it do not install one):

  1. Every job except `ci-gate` declares a job-level `if:`. A job with no `if`
     would run on any trigger.
  2. Every job except `ci-gate` and `rollback-guide` names `workflow_run` in
     its `if` ONLY inside the own-push group
     (github.event_name == 'workflow_run' && event == 'push' && head_repository
     == github.repository), and carries that group. `rollback-guide` must not
     mention workflow_run at all.
  3. `ci-gate` has no job-level `if`, and a step named "The run is this
     repository's own push to main" whose `if` is exactly
     `github.event_name == 'workflow_run'`, with no `continue-on-error`,
     reading the event and repository through env and exiting 1 otherwise.
  4. No job or step in the file sets `continue-on-error`.

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
EXEMPT_IF = {"ci-gate"}
NO_WORKFLOW_RUN = {"rollback-guide"}


def _strip_comments(text: str) -> str:
    out = []
    for line in text.split("\n"):
        if line.lstrip().startswith("#"):
            continue
        out.append(re.sub(r"\s+#\s.*$", "", line) if "${{" not in line and "'" not in line else line)
    return "\n".join(out)


def _jobs(text: str) -> dict[str, str]:
    if "\njobs:\n" not in text:
        raise ValueError("no top-level jobs: key")
    body = text.split("\njobs:\n", 1)[1]
    parts = re.split(r"(?m)^  ([A-Za-z0-9_-]+):\n", body)
    return {parts[i]: parts[i + 1] for i in range(1, len(parts) - 1, 2)}


def _job_if(job: str) -> str | None:
    lines = job.split("\n")
    for i, line in enumerate(lines):
        m = re.match(r"^    if:\s*(.*)$", line)
        if not m:
            continue
        val = [m.group(1)]
        for nxt in lines[i + 1:]:
            if re.match(r"^      \S", nxt) or re.match(r"^\s{7,}\S", nxt):
                val.append(nxt.strip())
            else:
                break
        return " ".join(v for v in val if v not in (">-", ">", "|", "|-")).strip()
    return None


def _steps(job: str) -> list[str]:
    if "\n    steps:\n" not in job:
        return []
    body = job.split("\n    steps:\n", 1)[1]
    return [s for s in re.split(r"(?m)^      - ", body)[1:]]


def problems(text: str) -> list[str]:
    text = _strip_comments(text)
    out: list[str] = []
    jobs = _jobs(text)
    if "ci-gate" not in jobs:
        return ["no ci-gate job"]
    if "continue-on-error" in text:
        out.append("continue-on-error appears in deploy.yml")
    for name, job in jobs.items():
        cond = _job_if(job)
        if name in EXEMPT_IF:
            if cond is not None:
                out.append(f"{name}: carries a job-level if (it must always run and fail red)")
            continue
        if cond is None:
            out.append(f"{name}: no job-level if, so it runs on any trigger")
            continue
        if name in NO_WORKFLOW_RUN:
            if "workflow_run" in cond:
                out.append(f"{name}: its if can be satisfied by a workflow_run")
            continue
        if OWN not in cond:
            out.append(f"{name}: its if lacks the own-push group")
        elif "workflow_run" in cond.replace(OWN, ""):
            out.append(f"{name}: its if names workflow_run outside the own-push group")
    gate = [s for s in _steps(jobs["ci-gate"]) if s.startswith(f'name: {STEP}') or s.startswith(f'name: "{STEP}"')]
    if len(gate) != 1:
        out.append(f"ci-gate: expected one step named {STEP!r}, found {len(gate)}")
    else:
        s = gate[0]
        ifs = re.findall(r"(?m)^        if:\s*(.*)$", s)
        if ifs != ["github.event_name == 'workflow_run'"]:
            out.append(f"ci-gate refusal step: if is {ifs!r}, not exactly github.event_name == 'workflow_run'")
        for need in ("RUN_EVENT: ${{ github.event.workflow_run.event }}",
                     "RUN_REPO: ${{ github.event.workflow_run.head_repository.full_name }}",
                     "THIS_REPO: ${{ github.repository }}",
                     'if [ "$RUN_EVENT" = "push" ] && [ "$RUN_REPO" = "$THIS_REPO" ]; then'):
            if need not in s:
                out.append(f"ci-gate refusal step: missing {need!r}")
        tail = s.split("fi\n", 1)[1] if "fi\n" in s else ""
        if not re.search(r"(?m)^\s+exit 1\s*$", tail) or re.search(r"(?m)^\s+(exit 0|true|:)\s*$", tail):
            out.append("ci-gate refusal step: does not exit 1 after the check (or exits 0 first)")
    return out


def _self_test() -> int:
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
    }
    failed = []
    for name, (old, new) in muts.items():
        if base.count(old) < 1:
            failed.append(f"{name}: no-op (target text not found)")
            continue
        if not problems(base.replace(old, new, 1)):
            failed.append(f"{name}: survived")
    if failed:
        print("SELF-TEST FAILED:\n  " + "\n  ".join(failed))
        return 1
    print(f"SELF-TEST OK -- {len(muts)} planted breaks, each caught")
    return 0


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        return _self_test()
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
