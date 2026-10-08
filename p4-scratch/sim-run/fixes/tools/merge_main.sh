#!/usr/bin/env bash
# Merge origin/main into a lane worktree. Only README index-row conflicts are auto-resolved
# (keep both sides, rows sorted by ADR number inside the hunk); any other conflict aborts.
set -u
wt="$1"; cd "$wt" || exit 2
[ -z "$(git status --porcelain)" ] || { echo "DIRTY $wt"; exit 2; }
git fetch -q origin main
git merge-base --is-ancestor origin/main HEAD && { echo "UP-TO-DATE $(git rev-parse --short HEAD)"; exit 0; }
if git merge --no-edit -q origin/main >/dev/null 2>&1; then echo "MERGED $(git rev-parse --short HEAD)"; exit 0; fi
bad=$(git diff --name-only --diff-filter=U | grep -v -x -e '.planning/decisions/README.md' -e 'scripts/sql_outside_migrations.txt')
if [ -n "$bad" ]; then echo "CONFLICT (manual): $bad"; git merge --abort; exit 3; fi
python3 - <<'PY'
import re
p='.planning/decisions/README.md'; s=open(p).read()
def fix(m):
    rows=[r for r in (m.group(1)+m.group(2)).splitlines(True) if r.strip()]
    if not all(r.startswith('| [') for r in rows): raise SystemExit('non-row conflict')
    return ''.join(sorted(rows,key=lambda r: re.match(r'\| \[(\d+)',r).group(1)))
s2=re.sub(r'<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> origin/main\n',fix,s,flags=re.S)
assert '<<<<<<<' not in s2 and '>>>>>>>' not in s2
open(p,'w').write(s2)
PY
[ $? -eq 0 ] || { echo "CONFLICT (README non-row)"; git merge --abort; exit 3; }
if git diff --name-only --diff-filter=U | grep -qx 'scripts/sql_outside_migrations.txt'; then
python3 - <<'PY2'
import re
p='scripts/sql_outside_migrations.txt'; s=open(p).read()
def fix(m):
    rows=[r for r in (m.group(1)+m.group(2)).splitlines(True) if r.strip()]
    if not all(r.startswith('supabase/') for r in rows): raise SystemExit('non-path conflict')
    return ''.join(sorted(set(rows)))
s2=re.sub(r'<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> origin/main\n',fix,s,flags=re.S)
assert '<<<<<<<' not in s2 and '>>>>>>>' not in s2
open(p,'w').write(s2)
PY2
[ $? -eq 0 ] || { echo "CONFLICT (sql list non-path)"; git merge --abort; exit 3; }
git add scripts/sql_outside_migrations.txt
fi
git add .planning/decisions/README.md && git commit -q --no-edit && echo "MERGED+README $(git rev-parse --short HEAD)"
