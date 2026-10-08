#!/usr/bin/env bash
# lanecheck.sh <worktree>... — before pushing a lane head: the fast guards (each
# lane's own copy, which carries main's once main is merged in), the PR's file
# count against origin/main, and gate ownership by origin/main's classifier
# (never the checkout's), between merge-base(origin/main, HEAD) and HEAD.
# Rebuilt 2026-10-06 in the durable tools dir; the scratchpad copy died with /tmp.
set -u
REPO=/Users/aldemirkonuk/Projects/restaurant-ai-automation
GATE=$(mktemp -d)
git -C "$REPO" fetch --no-tags -q origin +refs/heads/main:refs/remotes/origin/main || { echo "CANNOT CHECK: fetch failed"; exit 2; }
git -C "$REPO" show refs/remotes/origin/main:scripts/pr_audit_gate.py > "$GATE/pr_audit_gate.py" || { echo "CANNOT CHECK: no gate"; exit 2; }
worst=0
for wt in "$@"; do
  head=$(git -C "$wt" rev-parse HEAD) || { echo "CANNOT CHECK: $wt"; worst=2; continue; }
  git -C "$wt" fetch --no-tags -q origin +refs/heads/main:refs/remotes/origin/main
  base=$(git -C "$wt" merge-base refs/remotes/origin/main HEAD)
  echo "== $wt $(git -C "$wt" branch --show-current) ${head:0:9} (merge-base ${base:0:9}, origin/main $(git -C "$wt" rev-parse --short refs/remotes/origin/main))"
  for g in check_migration_order check_migration_versions_unique check_od_ids_exist check_no_conflict_markers check_citation_pairing check_adr_numbers_unique; do
    out=$(cd "$wt" && env LC_ALL=C python3 "scripts/$g.py" 2>&1); rc=$?
    echo "  $g rc=$rc"; [ $rc -ne 0 ] && { printf '%s\n' "$out" | tail -5 | sed 's/^/    /'; worst=1; }
  done
  echo "  files=$(git -C "$wt" diff --name-only "$base" HEAD | wc -l | tr -d ' ')"
  own=$(python3 -I -c "import sys; sys.path.insert(0, '$GATE'); import pr_audit_gate as g; print(g.ownership_between('$wt', '$base', '$head'))" 2>&1); rc=$?
  echo "  ownership rc=$rc $own"; { [ $rc -ne 0 ] || [ "$own" != "[]" ]; } && worst=1
done
exit $worst
