#!/usr/bin/env bash
# Merge ONE ADR 0090-audited PR into main, then watch CI and the production deploy
# for the merge commit. Written 2026-09-28 (handoff §0f) after the pasted runbook
# failed in zsh: an interactive zsh reads `N=<pr number>` as a redirect and `#` as a
# command, and with N empty every `gh pr` call fell back to the current branch.
#
# Usage:  bash merge-audited-pr.sh <pr-number>                 # needs a PASS marker
#         bash merge-audited-pr.sh <pr-number> --gate-owned    # a PR that changes a
#                                                              # gate-owned path (#490):
#                                                              # no marker can exist.
#                                                              # Refused for any PR whose
#                                                              # diff touches none.
# Works from any directory: every call names the repo with -R.
# Refuses (exit 2) rather than guesses: no number, closed/draft/unmergeable PR,
# required checks not all passing, no trusted PASS marker for the exact head SHA,
# a BLOCK marker for that SHA, or a confirmation that does not match.
set -uo pipefail

R="aldemirkonuk/RestaurantAIAutomation"
N="${1:-}"
N="${N#\#}"
MODE="${2:-}"

die() { printf 'REFUSED: %s\n' "$*" >&2; exit 2; }

[[ "$N" =~ ^[0-9]+$ ]] || die "usage: bash $0 <pr-number> [--gate-owned]"
[[ -z "$MODE" || "$MODE" == "--gate-owned" ]] || die "unknown option '$MODE'"
command -v gh >/dev/null 2>&1 || die "gh is not installed"

line=$(gh pr view "$N" -R "$R" \
  --json state,isDraft,headRefOid,mergeable,mergeStateStatus,title \
  --jq '[.state, (.isDraft|tostring), .headRefOid, .mergeable, .mergeStateStatus, .title] | join("\u001f")') \
  || die "could not read PR #$N"
IFS=$'\x1f' read -r STATE DRAFT SHA MERGEABLE MSTATE TITLE <<<"$line"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "could not read PR #$N's head SHA (got '$SHA')"

printf 'PR #%s  %s\n  head %s  state %s  draft %s  mergeable %s  merge-state %s\n' \
  "$N" "$TITLE" "$SHA" "$STATE" "$DRAFT" "$MERGEABLE" "$MSTATE"

[[ "$STATE" == "OPEN" ]]        || die "PR is $STATE, not OPEN"
[[ "$DRAFT" == "false" ]]       || die "PR is a draft"
[[ "$MERGEABLE" == "MERGEABLE" ]] || die "PR is $MERGEABLE (conflicts?) — ask a session to merge main in and re-audit"
[[ "$MSTATE" == "CLEAN" ]]      || die "merge state is $MSTATE, not CLEAN (BEHIND: merge main in and re-audit; BLOCKED/UNSTABLE: see checks)"

echo "== required checks"
gh pr checks "$N" -R "$R" --required
rc=$?
case $rc in
  0) ;;
  8) die "required checks are still pending (gh pr checks exit 8) — wait and re-run" ;;
  *) die "required checks are not all passing, or none were reported (gh pr checks exit $rc)" ;;
esac

if [[ "$MODE" == "--gate-owned" ]]; then
  files=$(gh pr diff "$N" -R "$R" --name-only) || die "could not read the diff"
  owned=""
  while IFS= read -r f; do
    case "$f" in
      scripts/pr_audit_gate.py|scripts/hooks/require_pr_audit.py|\
      .github/workflows/pr-audit-gate.yml|.github/workflows/ci.yml|.github/workflows/deploy.yml|\
      .claude/agents/pr-merge-*.md|.claude/skills/pr-audit-gate/*|.claude/settings.json|\
      CLAUDE.md|.planning/decisions/0050-*.md|.planning/decisions/0090-*.md|\
      .planning/decisions/README.md|supabase/migration-order-exceptions.txt)
        owned="$owned  $f"$'\n' ;;
    esac
  done <<<"$files"
  [[ -n "$owned" ]] || die "--gate-owned refused: PR #$N changes no gate-owned path, so it needs a PASS marker"
  echo "== gate-owned PR: no audit marker can exist by design. Gate-owned paths it changes:"
  printf '%s' "$owned"
  echo "Read the full diff first:  gh pr diff $N -R $R"
else
  echo "== audit markers from trusted authors"
  markers=$(gh pr view "$N" -R "$R" --json comments --jq \
    ".comments[] | select(.author.login == \"aldemirkonuk\" or .author.login == \"github-actions\" or .author.login == \"github-actions[bot]\")
      | (.body | sub(\"^\\\\s+\"; \"\")) | select(test(\"^<!--\\\\s*pr-audit-gate:\")) | split(\"\\n\")[0]") \
    || die "could not read PR comments"
  printf '%s\n' "${markers:-  (none)}"
  re='^<!--[[:space:]]*pr-audit-gate:[[:space:]]*pr=([0-9]+)[[:space:]]+sha=([0-9a-f]{7,40})[[:space:]]+verdict=(PASS|BLOCK)[[:space:]]*-->'
  pass=0
  while IFS= read -r m; do
    [[ "$m" =~ $re ]] || continue
    mpr="${BASH_REMATCH[1]}"; msha="${BASH_REMATCH[2]}"; mv="${BASH_REMATCH[3]}"
    [[ "$mpr" == "$N" && "$SHA" == "$msha"* ]] || continue
    [[ "$mv" == "BLOCK" ]] && die "a BLOCK marker names this exact head SHA"
    pass=1
  done <<<"$markers"
  [[ $pass -eq 1 ]] || die "no trusted PASS marker names head $SHA — the PR needs /pr-audit-gate at this SHA"
fi

printf 'Type the PR number (%s) to squash-merge it at %s: ' "$N" "${SHA:0:9}"
read -r ans
[[ "$ans" == "$N" ]] || die "confirmation did not match"

gh pr merge "$N" -R "$R" --squash --match-head-commit "$SHA" --subject "$TITLE (#$N)" || die "merge refused by GitHub (head moved? re-audit, never force)"

MERGE=$(gh pr view "$N" -R "$R" --json mergeCommit --jq '.mergeCommit.oid // empty')
[[ -n "$MERGE" ]] || die "merged, but could not read the merge commit — check main by hand"
echo "== merged as $MERGE"

# CI starts on the push; Deploy to Production starts only after CI completes
# (deploy.yml: workflow_run on "CI"). Both are looked up by the merge commit,
# never "the latest run", which right after a merge is the previous one.
wait_for_run() {  # $1 workflow name, $2 max seconds
  local id="" waited=0
  while [[ -z "$id" && $waited -lt $2 ]]; do
    id=$(gh run list -R "$R" --workflow "$1" --commit "$MERGE" --limit 1 \
         --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null)
    [[ -n "$id" ]] || { sleep 10; waited=$((waited + 10)); }
  done
  printf '%s' "$id"
}

echo "== waiting for CI on $MERGE"
CI_ID=$(wait_for_run "CI" 300)
[[ -n "$CI_ID" ]] || die "no CI run appeared for $MERGE within 5 minutes"
gh run watch "$CI_ID" -R "$R" --exit-status || die "CI failed on $MERGE (run $CI_ID)"

echo "== waiting for Deploy to Production on $MERGE"
DEP_ID=$(wait_for_run "Deploy to Production" 600)
[[ -n "$DEP_ID" ]] || die "no Deploy to Production run appeared for $MERGE within 10 minutes"
gh run watch "$DEP_ID" -R "$R" --exit-status || die "Deploy to Production failed on $MERGE (run $DEP_ID)"

echo "DONE: #$N merged as $MERGE; CI run $CI_ID and deploy run $DEP_ID succeeded."
