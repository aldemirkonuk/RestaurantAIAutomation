#!/usr/bin/env bash
# Classify each wip/preserve-<stamp>/* snapshot branch against origin/main, file by
# file: IDENTICAL (same blob on main at that path), OLDER (an older version main's
# history already holds), RENAMED (same blob on main at another path), or UNIQUE (the
# content is nowhere on main — the only work that can still be lost). Read-only.
#
# Usage: bash classify-preserved.sh <stamp>            e.g. 20260928T1629Z
# Prints one summary line per snapshot, then every UNIQUE path under it.
# Caveat: on a shallow clone, "OLDER" can only be proven for history the clone has;
# a blob not found is reported UNIQUE (never the other way round), so a shallow clone
# can over-report UNIQUE, never under-report it.
set -uo pipefail
STAMP="${1:-}"
[[ "$STAMP" =~ ^[0-9]{8}T[0-9]{4}Z$ ]] || { echo "usage: bash $0 <stamp like 20260928T1629Z>" >&2; exit 2; }
git fetch -q origin main "refs/heads/wip/preserve-$STAMP/*:refs/remotes/origin/wip/preserve-$STAMP/*" \
  || { echo "REFUSED: fetch failed" >&2; exit 2; }
objs=$(mktemp); mainblobs=$(mktemp); trap 'rm -f "$objs" "$mainblobs"' EXIT
git rev-list --objects origin/main | cut -d' ' -f1 | sort -u > "$objs"
git ls-tree -r origin/main | awk '{print $3}' | sort -u > "$mainblobs"
for ref in $(git for-each-ref --format='%(refname:short)' "refs/remotes/origin/wip/preserve-$STAMP/"); do
  parent=$(git rev-parse "$ref^")
  same=0; older=0; renamed=0; uniq=0; deleted=0; ulist=""
  while IFS=$'\t' read -r meta path; do
    set -- $meta; blob=$4; status=$5
    if [[ "$status" == D* ]]; then deleted=$((deleted+1)); continue; fi
    onmain=$(git rev-parse -q --verify "origin/main:$path" 2>/dev/null || true)
    if [[ "$onmain" == "$blob" ]]; then same=$((same+1))
    elif grep -qx "$blob" "$mainblobs"; then renamed=$((renamed+1))
    elif grep -qx "$blob" "$objs"; then older=$((older+1))
    else uniq=$((uniq+1)); ulist+="    UNIQUE $path"$'\n'
    fi
  done < <(git diff --raw --no-abbrev "$parent" "$ref")
  onmain_base="no"; git merge-base --is-ancestor "$parent" origin/main 2>/dev/null && onmain_base="yes"
  printf '%s  base %s (on main: %s)  identical %d  older %d  renamed %d  deleted %d  UNIQUE %d\n' \
    "${ref#origin/wip/preserve-$STAMP/}" "${parent:0:9}" "$onmain_base" "$same" "$older" "$renamed" "$deleted" "$uniq"
  printf '%s' "$ulist"
done
