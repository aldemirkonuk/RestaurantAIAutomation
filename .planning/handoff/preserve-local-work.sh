#!/usr/bin/env bash
# Preserve every uncommitted change in this clone AND in each of its git worktrees
# (Cursor's, the ChatGPT app's, Claude's — every tree `git worktree list` names) as a
# snapshot branch on origin, without touching any working tree, index, HEAD or
# branch. Safe while other sessions are still working in those trees: it reads the
# files, builds a commit from a temporary COPY of each tree's index, and pushes that
# commit to a new branch  wip/preserve-<stamp>/<parent>--<tree>-<path hash>.
# Nothing is merged; a session then classifies each snapshot against origin/main.
#
# Usage (from anywhere inside the clone):
#   bash preserve-local-work.sh                    dry run: lists what it would save
#   bash preserve-local-work.sh --push             saves and pushes
#   bash preserve-local-work.sh --only <path>      just that one tree (dry run)
#   bash preserve-local-work.sh --push --only <path>
# Resume after Ctrl+C, or after SLOW trees: re-run with the stamp the first run
# printed —  PRESERVE_STAMP=<stamp> bash preserve-local-work.sh --push  — trees
# already saved under that stamp are skipped.
#
# Per tree it stops reading after PRESERVE_TREE_SECONDS (default 120) and reports it
# as SLOW instead of blocking the other trees; re-run that one alone with a larger
# limit (the report prints the exact command). It always leaves out dependency and
# cache folders (node_modules, .venv, venv, __pycache__, .turbo, .next) and
# .gitignore'd files, keeps nested .claude/worktrees out of a parent's snapshot
# (they are visited as their own trees), and refuses a tree whose changes include a
# likely secret or a file over 50 MB.
# Written 2026-09-28, handoff §0f. v3 after the founder's Mac showed 235 trees, one
# of which blocked the run, and many sharing one folder name.
set -uo pipefail

PUSH=0; ONLY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --push) PUSH=1; shift ;;
    --only) [[ $# -ge 2 ]] || { echo "usage: --only <path>" >&2; exit 2; }; ONLY="$2"; shift 2 ;;
    *) echo "usage: bash $0 [--push] [--only <path>]" >&2; exit 2 ;;
  esac
done

root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "REFUSED: not inside a git clone" >&2; exit 2; }
git -C "$root" remote get-url origin >/dev/null 2>&1 || { echo "REFUSED: no 'origin' remote" >&2; exit 2; }

STAMP="${PRESERVE_STAMP:-$(date -u +%Y%m%dT%H%MZ)}"
[[ "$STAMP" =~ ^[0-9]{8}T[0-9]{4}Z$ ]] || { echo "REFUSED: PRESERVE_STAMP must look like 20260928T1605Z" >&2; exit 2; }
PREFIX="wip/preserve-$STAMP"
LIMIT="${PRESERVE_TREE_SECONDS:-120}"
[[ "$LIMIT" =~ ^[0-9]+$ && "$LIMIT" -gt 0 ]] || { echo "REFUSED: PRESERVE_TREE_SECONDS must be a positive whole number" >&2; exit 2; }
MAX_BYTES=${PRESERVE_MAX_BYTES:-$((50 * 1024 * 1024))}   # override only for its test
SECRET_RE='(^|/)(\.env([.].*)?|id_rsa[^/]*|[^/]*\.(pem|key|p12|keystore)|[^/]*credentials[^/]*\.json)$'
EXCLUDES=(':(exclude).claude/worktrees'
          ':(exclude,glob)**/node_modules/**' ':(exclude,glob)**/.venv/**' ':(exclude,glob)**/venv/**'
          ':(exclude,glob)**/__pycache__/**' ':(exclude,glob)**/.turbo/**' ':(exclude,glob)**/.next/**')

# Run a command under a time limit. perl's alarm survives exec, so the limit applies to
# git itself; exit 142 means it tripped. macOS ships /usr/bin/perl; without perl the
# command runs unlimited, and the script says so once.
if command -v perl >/dev/null 2>&1; then
  limited() { perl -e 'alarm shift @ARGV; exec @ARGV or die "exec: $!\n"' "$LIMIT" "$@"; }
else
  echo "note: no perl found — trees run without a time limit" >&2
  limited() { "$@"; }
fi

trees=$(git -C "$root" worktree list --porcelain | sed -n 's/^worktree //p')
if [[ -n "$ONLY" ]]; then
  want=$(cd "$ONLY" 2>/dev/null && pwd -P) || { echo "REFUSED: --only path not found: $ONLY" >&2; exit 2; }
  match=""
  while IFS= read -r t; do
    [[ -n "$t" ]] || continue
    [[ "$(cd "$t" 2>/dev/null && pwd -P)" == "$want" ]] && match="$t"
  done <<<"$trees"
  [[ -n "$match" ]] || { echo "REFUSED: $ONLY is not a worktree of this clone (see: git worktree list)" >&2; exit 2; }
  trees="$match"
fi
total=$(printf '%s\n' "$trees" | grep -c .)

existing=""
if [[ $PUSH -eq 1 ]]; then
  existing=$(git -C "$root" ls-remote --heads origin "refs/heads/$PREFIX/*") \
    || { echo "REFUSED: cannot reach origin (network/auth?)" >&2; exit 2; }
  existing=$(printf '%s\n' "$existing" | sed -n 's|.*refs/heads/||p')
fi
echo "Stamp $STAMP — checking $total tree(s), ${LIMIT}s limit each. Progress below; summary at the end." >&2

saved=0; clean=0; refused=0; slow=0; missing=0; already=0
report=""
slow_line() {
  slow=$((slow + 1))
  report+="SLOW      $1 — reading took over ${LIMIT}s, not saved. Re-run it alone:"$'\n'
  report+="            PRESERVE_STAMP=$STAMP PRESERVE_TREE_SECONDS=1800 bash $0 --push --only \"$1\""$'\n'
}
i=0
while IFS= read -r wt; do
  [[ -n "$wt" ]] || continue
  i=$((i + 1)); printf '  [%d/%d] %s\n' "$i" "$total" "$wt" >&2
  if [[ ! -d "$wt" ]]; then
    missing=$((missing + 1)); report+="MISSING   $wt (listed by git worktree, not on disk — 'git worktree prune' clears it)"$'\n'; continue
  fi

  # Unique per tree: tools reuse one folder name (Cursor: restaurant-ai-automation-<id>)
  parent=$(basename "$(dirname "$wt")"); base=$(basename "$wt")
  hash=$(printf '%s' "$wt" | git hash-object --stdin | cut -c1-7)
  name=$(printf '%s--%s' "$parent" "$base" | tr -c 'A-Za-z0-9._-' '-' | sed 's/-*$//' | cut -c1-80)-$hash
  ref="$PREFIX/$name"
  if [[ -n "$existing" ]] && printf '%s\n' "$existing" | grep -qxF "$ref"; then
    already=$((already + 1)); report+="already   $wt  ->  $ref"$'\n'; continue
  fi

  st=$(mktemp)
  limited git -C "$wt" status --porcelain --untracked-files=all -- . "${EXCLUDES[@]}" >"$st" 2>/dev/null; rc=$?
  if [[ $rc -eq 142 ]]; then rm -f "$st"; slow_line "$wt"; continue; fi
  if [[ $rc -ne 0 ]]; then rm -f "$st"; refused=$((refused+1)); report+="FAILED    $wt — git status failed (rc $rc)"$'\n'; continue; fi
  if [[ ! -s "$st" ]]; then rm -f "$st"; clean=$((clean + 1)); report+="clean     $wt"$'\n'; continue; fi
  rm -f "$st"

  head=$(git -C "$wt" rev-parse HEAD 2>/dev/null) || { refused=$((refused+1)); report+="FAILED    $wt — no HEAD"$'\n'; continue; }
  branch=$(git -C "$wt" symbolic-ref --short -q HEAD || echo "detached")
  # Start from a COPY of the tree's own index: its stat cache means `add -A` re-reads
  # only changed files. git replaces an index by atomic rename, so the copy is
  # consistent even while another session writes; the real index is only read.
  idx=$(mktemp)
  src_idx="$(git -C "$wt" rev-parse --absolute-git-dir)/index"
  if [[ -f "$src_idx" ]]; then cp "$src_idx" "$idx"; else rm -f "$idx"; GIT_INDEX_FILE="$idx" git -C "$wt" read-tree HEAD; fi
  GIT_INDEX_FILE="$idx" limited git -C "$wt" add -A -- . "${EXCLUDES[@]}" >/dev/null 2>&1; rc=$?
  if [[ $rc -eq 142 ]]; then rm -f "$idx" "$idx.lock"; slow_line "$wt"; continue; fi
  tree=$(GIT_INDEX_FILE="$idx" git -C "$wt" write-tree 2>/dev/null); rc=$?
  rm -f "$idx" "$idx.lock"
  [[ $rc -eq 0 && -n "$tree" ]] || { refused=$((refused+1)); report+="FAILED    $wt — could not build a tree"$'\n'; continue; }

  files=$(git -C "$wt" diff-tree -r --no-commit-id --name-only "$head" "$tree")
  if [[ -z "$files" ]]; then clean=$((clean + 1)); report+="clean     $wt (only excluded or ignored files differ)"$'\n'; continue; fi
  nfiles=$(printf '%s\n' "$files" | grep -c .)
  secrets=$(printf '%s\n' "$files" | grep -E "$SECRET_RE" || true)
  if [[ -n "$secrets" ]]; then
    refused=$((refused + 1))
    report+="REFUSED   $wt — likely secrets among its changes (nothing saved; move or .gitignore them, re-run):"$'\n'
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

  if [[ $PUSH -ne 1 ]]; then
    saved=$((saved + 1)); report+="would save $wt  ($nfiles files, on $branch @ ${head:0:9})  ->  $ref"$'\n'; continue
  fi
  msg="WIP preserve: uncommitted work in $base at $STAMP

Snapshot of the working tree of $wt (branch $branch, HEAD $head),
taken by .planning/handoff/preserve-local-work.sh without touching that
tree, its index, HEAD or branch. $nfiles files differ from HEAD.
Unreviewed. Classify against origin/main before using any of it."
  commit=$(git -C "$wt" commit-tree "$tree" -p "$head" -m "$msg") || { refused=$((refused+1)); report+="FAILED    $wt — commit-tree failed"$'\n'; continue; }
  if git -C "$wt" push -q origin "$commit:refs/heads/$ref" 2>/dev/null; then
    saved=$((saved + 1)); report+="SAVED     $wt  ($nfiles files, on $branch @ ${head:0:9})  ->  $ref  (${commit:0:9})"$'\n'
  else
    refused=$((refused + 1)); report+="FAILED    $wt — push of $ref failed (network/auth?); nothing lost, re-run with PRESERVE_STAMP=$STAMP"$'\n'
  fi
done <<<"$trees"

printf '%s' "$report"
if [[ $PUSH -eq 1 ]]; then
  echo "== stamp $STAMP: $saved saved, $already already saved, $clean clean, $slow slow (not saved), $refused refused/failed, $missing missing"
  [[ $saved -gt 0 || $already -gt 0 ]] && echo "Tell the session: preserved under $PREFIX/ — classify against origin/main."
  [[ $slow -gt 0 || $refused -gt 0 ]] && echo "Not everything is saved yet: run each SLOW line's command, and fix the REFUSED/FAILED ones."
else
  echo "== dry run, stamp $STAMP: $saved would be saved, $clean clean, $slow slow, $refused refused, $missing missing. Re-run with --push to save."
fi
[[ $refused -eq 0 && $slow -eq 0 ]]
