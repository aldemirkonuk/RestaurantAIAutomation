#!/usr/bin/env python3
"""Deploy to Production acts only on this repository's own pushes to main.

Founder, 2026-09-30, on #534, verbatim pick: "Sign off, add deploy fix
(Recommended)". deploy.yml's `workflow_run: branches: [main]` trigger also
matches a fork's pull request whose branch is named `main`; its stages check
out that run's head_sha and run its code beside ADMIN_API_KEY. The rule this
guard holds, read from the workflow text strictly (no YAML library: the CI
jobs that run it do not install one; so anything this reader could misread
is refused rather than guessed):

  1. The jobs: block holds only plain `  name:` job keys, full-line comments
     and lines indented four or more spaces. A quoted, flow-style, anchored or
     aliased key, a tab, a CR or a duplicate key fails.
  2. The job set is exactly EXPECTED_IF's, and each job's single job-level
     `if` equals, whitespace-normalised, the one EXPECTED_IF allows: each job a
     workflow_run can start requires this repository's own push; rollback-guide
     is dispatch-only; ci-gate has none. No job is a reusable-workflow call.
  3. ci-gate has one step named "The run is this repository's own push to
     main" whose `if` is exactly `github.event_name == 'workflow_run'`, reading
     the event and repository through env and exiting 1 unless they are
     'push' and this repository, with no earlier exit 0; ci-gate writes
     neither GITHUB_ENV nor GITHUB_OUTPUT.
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
    lines = job.split("\n")
    out = []
    for i, line in enumerate(lines):
        m = re.match(r"^    if:(.*)$", line)
        if not m:
            continue
        head = m.group(1).strip()
        if head in (">-", ">", "|", "|-"):
            val = []
            for nxt in lines[i + 1:]:
                if nxt.startswith("      ") and not nxt.strip().startswith("#"):
                    val.append(nxt.strip())
                elif nxt.strip().startswith("#") and nxt.startswith("      "):
                    val.append(nxt.strip())  # a comment line inside a folded scalar is TEXT to GitHub
                else:
                    break
            out.append(" ".join(val))
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
    gate = [s for s in _steps(gate_job) if s.startswith(f"name: {STEP}\n")]
    if len(gate) != 1:
        out.append(f"ci-gate: expected one step named {STEP!r}, found {len(gate)}")
    else:
        s = gate[0]
        ifs = re.findall(r"(?m)^        if:(.*)$", s)
        if [i.strip() for i in ifs] != ["github.event_name == 'workflow_run'"]:
            out.append(f"ci-gate refusal step: if is {ifs!r}, not exactly github.event_name == 'workflow_run'")
        for need in ("          RUN_EVENT: ${{ github.event.workflow_run.event }}\n",
                     "          RUN_REPO: ${{ github.event.workflow_run.head_repository.full_name }}\n",
                     "          THIS_REPO: ${{ github.repository }}\n",
                     '          if [ "$RUN_EVENT" = "push" ] && [ "$RUN_REPO" = "$THIS_REPO" ]; then\n'):
            if need not in s:
                out.append(f"ci-gate refusal step: missing {need.strip()!r}")
        tail = s.split("          fi\n", 1)[1] if "          fi\n" in s else ""
        if not re.search(r"(?m)^\s+exit 1\s*$", tail) or re.search(r"(?m)^\s+(exit 0|true|:)\s*$", tail):
            out.append("ci-gate refusal step: does not exit 1 after the check (or exits 0 first)")
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
