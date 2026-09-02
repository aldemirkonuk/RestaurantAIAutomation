#!/usr/bin/env bash
#
# Did the deploy audit RUN for this revision — and did it check the gateway?
#
# WHY THIS EXISTS
# ---------------
# `Deploy to Production` is `workflow_run`-gated on CI. When CI is red on main,
# the event still fires, every job's `if` evaluates false, and GitHub records the
# whole workflow as **skipped**. A skipped workflow is not a failure and is not a
# warning; in the Actions list it is a grey dash, and to anything reading the API
# it is `"conclusion": "skipped"` — which reads as *not applicable*, not as
# *this deploy was never verified*.
#
# Measured on 2026-09-02, over the last 30 runs of deploy.yml: **12 skipped**, a
# contiguous run of them covering every merge in that window. During that window
# the repository's own docs described the post-merge health audit as the thing
# that catches what CI cannot see. It had not run once.
#
# This is `absence-reported-as-health` applied to the deploy pipeline itself, and
# the fix has two halves. The first is in deploy.yml: `ci-gate` now always runs
# and FAILS when the CI run it was triggered by did not succeed, so the workflow
# is red rather than grey. That covers every future run.
#
# This script is the second half, and it answers the question the first half
# cannot: *for a given sha, is there a completed audit that actually checked the
# gateway?* It is the difference between "nothing complained" and "something
# confirmed" — and it works retrospectively, on shas that merged before any of
# this existed.
#
# WHAT IT CHECKS
# --------------
# Not the workflow's conclusion. A workflow-level `success` is compatible with
# every real stage having been skipped, which is exactly how this failed before.
# It looks at the JOB: `Stage 2 — API Gateway` must have concluded `success`.
#
# EXIT CODES
#   0  AUDITED       a completed run for this sha checked the gateway and passed
#   1  NOT AUDITED   no run, skipped, failed, or the gateway stage did not pass
#   2  CANNOT CHECK  no gh, not authenticated, or the API did not answer
#
# Exit 2 blocks like exit 1. A guard that passes because it could not run is
# worse than no guard.
#
# USAGE
#   scripts/check_deploy_audit_ran.sh                 # origin/main's tip
#   scripts/check_deploy_audit_ran.sh <sha>
#
set -uo pipefail

WORKFLOW="deploy.yml"
STAGE_JOB="Stage 2 — API Gateway"

cd "$(dirname "$0")/.." || { echo "FAIL — cannot reach repo root"; exit 2; }

SHA="${1:-}"
if [ -z "$SHA" ]; then
  SHA="$(git rev-parse origin/main 2>/dev/null)" || {
    echo "FAIL — no sha given and origin/main could not be resolved. (exit 2)"
    exit 2
  }
  echo "No sha given — using origin/main: $SHA"
fi

case "$SHA" in
  *[!0-9a-fA-F]* | "")
    echo "FAIL — '$SHA' is not a hexadecimal sha. (exit 2)"
    exit 2
    ;;
esac
if [ "${#SHA}" -lt 40 ]; then
  # The API matches head_sha exactly, so an abbreviation silently finds nothing —
  # which would look identical to "the audit never ran".
  FULL="$(git rev-parse "$SHA" 2>/dev/null)" || {
    echo "FAIL — '$SHA' is abbreviated and cannot be expanded here; the GitHub"
    echo "       API matches head_sha exactly, so a short sha would find nothing"
    echo "       and that is indistinguishable from 'never audited'. (exit 2)"
    exit 2
  }
  SHA="$FULL"
fi

command -v gh >/dev/null 2>&1 || {
  echo "FAIL — gh is not installed, so this cannot be checked. (exit 2)"
  exit 2
}
gh auth status >/dev/null 2>&1 || {
  echo "FAIL — gh is not authenticated, so this cannot be checked. (exit 2)"
  exit 2
}

echo "== Deploy audit for $SHA"

RUNS_JSON="$(
  gh api "repos/{owner}/{repo}/actions/workflows/${WORKFLOW}/runs?head_sha=${SHA}&per_page=50" 2>/dev/null
)"
if [ -z "$RUNS_JSON" ]; then
  echo "FAIL — the GitHub API did not answer for workflow ${WORKFLOW}. (exit 2)"
  exit 2
fi

# Ordered worst-to-best so a later good run supersedes an earlier bad one, and
# so "no run at all" and "a run that verified nothing" stay distinguishable.
SUMMARY="$(
  printf '%s' "$RUNS_JSON" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except ValueError:
    print("CANNOT_CHECK\tthe API response was not JSON")
    sys.exit(0)
runs = data.get("workflow_runs")
if runs is None:
    print("CANNOT_CHECK\tthe API response had no workflow_runs key")
    sys.exit(0)
if not runs:
    print("NEVER_RAN\tno Deploy to Production run exists for this sha")
    sys.exit(0)
for r in runs:
    print("RUN\t%s\t%s\t%s\t%s" % (r.get("id"), r.get("status"), r.get("conclusion"), r.get("html_url")))
'
)"

if printf '%s' "$SUMMARY" | grep -q '^CANNOT_CHECK'; then
  echo "FAIL — $(printf '%s' "$SUMMARY" | cut -f2). (exit 2)"
  exit 2
fi
if printf '%s' "$SUMMARY" | grep -q '^NEVER_RAN'; then
  echo "NOT AUDITED — no Deploy to Production run exists for this sha."
  echo
  echo "  That is not 'nothing to report'. It means this revision was merged and"
  echo "  deployed, and nothing ever checked that production came up on it."
  echo "(exit 1)"
  exit 1
fi

AUDITED=0
BEST="none"
while IFS=$'\t' read -r _tag id status conclusion url; do
  [ "$_tag" = "RUN" ] || continue
  echo "  run $id: $status/$conclusion  $url"
  if [ "$status" != "completed" ]; then
    [ "$BEST" = "none" ] && BEST="in_progress"
    continue
  fi
  if [ "$conclusion" = "skipped" ]; then
    BEST="skipped"
    continue
  fi
  JOBS="$(gh api "repos/{owner}/{repo}/actions/runs/${id}/jobs?per_page=100" 2>/dev/null)"
  if [ -z "$JOBS" ]; then
    echo "FAIL — could not read the jobs of run $id. (exit 2)"
    exit 2
  fi
  STAGE="$(
    printf '%s' "$JOBS" | STAGE_JOB="$STAGE_JOB" python3 -c '
import json, os, sys
want = os.environ["STAGE_JOB"]
try:
    jobs = json.load(sys.stdin).get("jobs", [])
except ValueError:
    print("unreadable"); sys.exit(0)
for j in jobs:
    if j.get("name") == want:
        print(j.get("conclusion") or "none")
        sys.exit(0)
print("absent")
'
  )"
  echo "      \"$STAGE_JOB\" -> $STAGE"
  case "$STAGE" in
    success) AUDITED=1; BEST="audited" ;;
    skipped) [ "$BEST" = "audited" ] || BEST="stage_skipped" ;;
    absent)  [ "$BEST" = "audited" ] || BEST="stage_absent" ;;
    *)       [ "$BEST" = "audited" ] || BEST="stage_failed" ;;
  esac
done <<< "$SUMMARY"

if [ "$AUDITED" -eq 1 ]; then
  echo
  echo "AUDITED — a completed run checked the gateway for this sha and passed."
  exit 0
fi

echo
case "$BEST" in
  skipped)
    echo "NOT AUDITED — the run for this sha was SKIPPED (CI was not green when it"
    echo "  fired). GitHub records that as 'skipped', which reads as 'not"
    echo "  applicable'. It is not: production was deployed and never verified."
    ;;
  in_progress)
    echo "NOT AUDITED YET — a run for this sha is still in progress."
    ;;
  stage_skipped|stage_absent)
    echo "NOT AUDITED — a run exists but the \"$STAGE_JOB\" stage did not run, so"
    echo "  the gateway was never checked. A workflow-level 'success' here means"
    echo "  only that nothing failed, which is the fault this script exists for."
    ;;
  *)
    echo "NOT AUDITED — the \"$STAGE_JOB\" stage did not pass for this sha."
    ;;
esac
echo "(exit 1)"
exit 1
