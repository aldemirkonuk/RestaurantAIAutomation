#!/usr/bin/env bash
# Preserve every uncommitted change in this clone AND in each of its git worktrees
# as a snapshot branch on origin — without touching any working tree, index, HEAD
# or branch. Safe to run while other sessions are still working in those trees: it
# reads the files, builds a commit from a temporary index, and pushes that commit
# to a new branch `wip/preserve-<UTC stamp>/<worktree name>`. Nothing is merged.
#
# Written 2026-09-28 (handoff §0f) so no session's local work is left behind. A
# session then classifies each snapshot against origin/main (identical / superseded
# by main / unique) and folds the unique part into a proper PR.
#
# Usage (from anywhere inside the clone):
#   bash preserve-local-work.sh          dry run: lists what it would save, pushes nothing
#   bash preserve-local-work.sh --push   saves and pushes
#
# Refuses a worktree (and says why) when its changes include a likely secret
# (.env*, *.pem, *.key, *.p12, id_rsa*, *credentials*.json, *.keystore) or a file
# over 50 MB. Skips `.claude/worktrees/` inside a tree: those are worktrees of their
# own and are visited separately. Honours .gitignore (node_modules etc. stay out).
set -uo pipefail

MODE="${1:-}"
[[ -z "$MODE" || "$MODE" == "--push" ]] || { echo "usage: bash $0 [--push]" >&2; exit 2; }

root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "REFUSED: not inside a git clone" >&2; exit 2; }
git -C "$root" remote get-url origin >/dev/null 2>&1 || { echo "REFUSED: no 'origin' remote" >&2; exit 2; }

STAMP=$(date -u +%Y%m%dT%H%MZ)
PREFIX="wip/preserve-$STAMP"
SECRET_RE='(^|/)(\.env([.].*)?|id_rsa[^/]*|[^/]*\.(pem|key|p12|keystore)|[^/]*credentials[^/]*\.json)$'
MAX_BYTES=${PRESERVE_MAX_BYTES:-$((50 * 1024 * 1024))}   # override only for its test

saved=0; clean=0; refused=0; missing=0
report=""

trees=$(git -C "$root" worktree list --porcelain | sed -n 's/^worktree //p')
total=$(printf '%s\n' "$trees" | grep -c .)
echo "Checking $total tree(s) — the clone and each git worktree. Progress below; the summary prints at the end." >&2
i=0
while IFS= read -r wt; do
  [[ -n "$wt" ]] || continue
  i=$((i + 1)); printf '  [%d/%d] %s\n' "$i" "$total" "$wt" >&2
  if [[ ! -d "$wt" ]]; then
    missing=$((missing + 1)); report+="MISSING   $wt (listed by git worktree, not on disk — 'git worktree prune' clears it)"$'\n'; continue
  fi
  changes=$(git -C "$wt" status --porcelain --untracked-files=all -- . ':(exclude).claude/worktrees' 2>/dev/null)
  if [[ -z "$changes" ]]; then
    clean=$((clean + 1)); report+="clean     $wt"$'\n'; continue
  fi

  head=$(git -C "$wt" rev-parse HEAD)
  branch=$(git -C "$wt" symbolic-ref --short -q HEAD || echo "detached")
  # Start from a COPY of the tree's own index: its stat cache lets `add -A` re-read
  # only the files that changed (a fresh read-tree index made git re-hash every file
  # in every tree, which looked like a hang on a large clone). The copy is ours; the
  # real index is only read. git replaces an index by atomic rename, so the copy is
  # consistent even while another session is writing.
  idx=$(mktemp)
  src_idx="$(git -C "$wt" rev-parse --absolute-git-dir)/index"
  if [[ -f "$src_idx" ]]; then cp "$src_idx" "$idx"; else rm -f "$idx"; GIT_INDEX_FILE="$idx" git -C "$wt" read-tree HEAD; fi
  GIT_INDEX_FILE="$idx" git -C "$wt" add -A -- . ':(exclude).claude/worktrees' 2>/dev/null
  tree=$(GIT_INDEX_FILE="$idx" git -C "$wt" write-tree)
  rm -f "$idx"

  files=$(git -C "$wt" diff-tree -r --no-commit-id --name-only "$head" "$tree")
  nfiles=$(printf '%s\n' "$files" | grep -c .)
  secrets=$(printf '%s\n' "$files" | grep -E "$SECRET_RE" || true)
  if [[ -n "$secrets" ]]; then
    refused=$((refused + 1))
    report+="REFUSED   $wt — likely secrets among its changes (commit nothing; move or .gitignore them, re-run):"$'\n'
    report+=$(printf '%s\n' "$secrets" | sed 's/^/            /')$'\n'
    continue
  fi
  big=""
  while read -r _ _ _ sha _ path; do
    [[ "$sha" =~ ^0+$ ]] && continue
    size=$(git -C "$wt" cat-file -s "$sha" 2>/dev/null || echo 0)
    (( size > MAX_BYTES )) && big+="            $path ($size bytes)"$'\n'
  done < <(git -C "$wt" diff-tree -r --no-commit-id "$head" "$tree")
  if [[ -n "$big" ]]; then
    refused=$((refused + 1)); report+="REFUSED   $wt — files over 50 MB:"$'\n'"$big"; continue
  fi

  name=$(basename "$wt" | tr -c 'A-Za-z0-9._-' '-' | sed 's/-*$//')
  ref="$PREFIX/$name"
  if [[ "$MODE" != "--push" ]]; then
    saved=$((saved + 1)); report+="would save $wt  ($nfiles files, on $branch @ ${head:0:9})  ->  $ref"$'\n'; continue
  fi
  msg="WIP preserve: uncommitted work in $(basename "$wt") at $STAMP

Snapshot of the working tree of $wt (branch $branch, HEAD $head),
taken by .planning/handoff/preserve-local-work.sh without touching that
tree, its index, HEAD or branch. $nfiles files differ from HEAD.
Unreviewed. Classify against origin/main before using any of it."
  commit=$(git -C "$wt" commit-tree "$tree" -p "$head" -m "$msg") || { refused=$((refused+1)); report+="FAILED    $wt — commit-tree failed"$'\n'; continue; }
  if git -C "$wt" push -q origin "$commit:refs/heads/$ref"; then
    saved=$((saved + 1)); report+="SAVED     $wt  ($nfiles files, on $branch @ ${head:0:9})  ->  $ref  (${commit:0:9})"$'\n'
  else
    refused=$((refused + 1)); report+="FAILED    $wt — push of $ref failed (network/auth?) — nothing lost, re-run"$'\n'
  fi
done <<<"$trees"

printf '%s' "$report"
if [[ "$MODE" == "--push" ]]; then
  echo "== $saved saved, $clean clean, $refused refused/failed, $missing missing"
  [[ $saved -gt 0 ]] && echo "Tell the session: preserved under $PREFIX/ — classify against origin/main."
else
  echo "== dry run: $saved would be saved, $clean clean, $refused refused, $missing missing. Re-run with --push to save."
fi
[[ $refused -eq 0 ]]
