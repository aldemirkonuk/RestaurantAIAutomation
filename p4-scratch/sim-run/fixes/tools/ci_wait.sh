#!/bin/bash
# ci_wait.sh <pr> <sha>: wait until every check on <sha> has finished, ignoring
# "PR Audit Gate" (it waits on the others and needs a PASS marker), then print
# a one-line tally. Read-only.
pr=$1; sha=$2; repo=aldemirkonuk/RestaurantAIAutomation
for i in $(seq 1 120); do
  out=$(gh pr view "$pr" --repo $repo --json headRefOid,statusCheckRollup 2>/dev/null) || { sleep 30; continue; }
  head=$(jq -r .headRefOid <<<"$out")
  [ "$head" != "$sha" ] && { echo "HEAD MOVED $head"; exit 2; }
  pend=$(jq '[.statusCheckRollup[] | select((.name // .context) != "PR Audit Gate") | select((.status // "COMPLETED") != "COMPLETED" or (.state // "") == "PENDING")] | length' <<<"$out")
  n=$(jq '.statusCheckRollup | length' <<<"$out")
  if [ "$pend" = 0 ] && [ "$n" -gt 5 ]; then
    jq -r '[.statusCheckRollup[] | select((.name // .context) != "PR Audit Gate") | (.conclusion // .state)] | group_by(.) | map("\(.[0])=\(length)") | join(",")' <<<"$out"
    jq -r '.statusCheckRollup[] | select((.name // .context) != "PR Audit Gate") | select(((.conclusion // .state) | test("FAIL|ERROR|CANCEL|TIMED")) ) | "  FAILED: \(.name // .context)"' <<<"$out"
    exit 0
  fi
  sleep 30
done
echo TIMEOUT; exit 1
