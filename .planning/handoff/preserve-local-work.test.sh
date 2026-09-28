#!/usr/bin/env bash
# Test for preserve-local-work.sh on a throwaway repo (bare remote + clone + worktrees).
# Asserts: dry run pushes nothing; --push saves each dirty tree to its own branch with
# exactly its working-tree content (modified, staged, deleted, untracked; .gitignore'd
# files and nested .claude/worktrees left out); a clean tree is skipped; a tree holding
# a likely secret is refused; and NO working tree, index, HEAD or branch changes.
# Run: bash .planning/handoff/preserve-local-work.test.sh   (exit 0 = all pass)
set -u
S="$(cd "$(dirname "$0")" && pwd)/preserve-local-work.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok() { pass=$((pass+1)); echo "ok   $1"; }
no() { fail=$((fail+1)); echo "FAIL $1"; }
g() { git -c user.email=t@t -c user.name=t "$@"; }

git init -q --bare "$T/remote.git"
g clone -q "$T/remote.git" "$T/clone" 2>/dev/null
cd "$T/clone"
printf 'node_modules/\n.env\n' > .gitignore
echo a > a.txt; echo b > b.txt; echo c > c.txt; mkdir -p src; echo s > src/s.ts
g add -A && g commit -qm base && g push -q origin HEAD:main 2>/dev/null
g branch -q feat/x
g worktree add -q "$T/wt-feat" feat/x
g worktree add -q "$T/wt-clean" -b feat/clean
g worktree add -q "$T/wt-secret" -b feat/secret
mkdir -p .claude/worktrees
g worktree add -q .claude/worktrees/nested -b feat/nested

# main clone: modified, staged, deleted, untracked, ignored
echo a2 > a.txt
echo b2 > b.txt; g add b.txt
rm c.txt
echo new > src/new.ts
mkdir -p node_modules && echo junk > node_modules/x.js
echo SECRET=1 > .env
# nested worktree has its own change (must NOT leak into the clone's snapshot)
echo n > .claude/worktrees/nested/nested-only.txt
# feature worktree
echo f > "$T/wt-feat/feat-only.txt"
# secret worktree: a non-ignored key file
echo k > "$T/wt-secret/deploy.pem"

snap() {  # fingerprint every tree: status, index hash, HEAD, branches
  for d in "$T/clone" "$T/wt-feat" "$T/wt-clean" "$T/wt-secret" "$T/clone/.claude/worktrees/nested"; do
    echo "== $d"; git -C "$d" status --porcelain --untracked-files=all
    git hash-object --no-filters "$(git -C "$d" rev-parse --absolute-git-dir)/index"
    git -C "$d" rev-parse HEAD; git -C "$d" symbolic-ref -q HEAD
  done; git -C "$T/clone" branch --list | sort
}
before=$(snap)

out=$(cd "$T/clone" && bash "$S" 2>&1); rc=$?
[[ -z "$(git --git-dir="$T/remote.git" for-each-ref refs/heads/wip)" ]] && ok "dry run pushes nothing" || no "dry run pushed"
grep -q "would save $T/clone " <<<"$out" && grep -q "would save $T/wt-feat " <<<"$out" && ok "dry run lists the dirty trees" || { no "dry run listing"; echo "$out"; }
[[ $rc -ne 0 ]] && grep -q "REFUSED   $T/wt-secret" <<<"$out" && grep -q "deploy.pem" <<<"$out" && ok "secret tree refused (and exit non-zero)" || { no "secret refusal"; echo "$out"; }

out=$(cd "$T/wt-feat" && bash "$S" --push 2>&1)
after=$(snap)
[[ "$before" == "$after" ]] && ok "no working tree, index, HEAD or branch changed" || { no "local state changed"; diff <(echo "$before") <(echo "$after"); }

refs=$(git --git-dir="$T/remote.git" for-each-ref --format='%(refname:short)' refs/heads/wip)
clone_ref=$(grep -E -- '--clone-[0-9a-f]{7}$' <<<"$refs"); feat_ref=$(grep -E -- '--wt-feat-[0-9a-f]{7}$' <<<"$refs"); nest_ref=$(grep -E -- 'worktrees--nested-[0-9a-f]{7}$' <<<"$refs")
[[ -n "$clone_ref" && -n "$feat_ref" && -n "$nest_ref" ]] && ok "pushed a branch per dirty tree (clone, wt-feat, nested)" || { no "branches pushed: $refs"; echo "$out"; }
grep -qE -- '--wt-(clean|secret)-' <<<"$refs" && no "clean or secret tree was pushed" || ok "clean and secret trees not pushed"
grep -q "clean     $T/wt-clean" <<<"$out" && ok "clean tree reported clean" || no "clean tree report"

R="$T/remote.git"
cf() { git --git-dir="$R" show "$1:$2" 2>/dev/null; }
[[ "$(cf "$clone_ref" a.txt)" == "a2" ]] && ok "unstaged edit captured" || no "unstaged edit"
[[ "$(cf "$clone_ref" b.txt)" == "b2" ]] && ok "staged edit captured" || no "staged edit"
! git --git-dir="$R" cat-file -e "$clone_ref:c.txt" 2>/dev/null && ok "deletion captured" || no "deletion"
[[ "$(cf "$clone_ref" src/new.ts)" == "new" ]] && ok "untracked file captured" || no "untracked"
! git --git-dir="$R" cat-file -e "$clone_ref:.env" 2>/dev/null && ! git --git-dir="$R" cat-file -e "$clone_ref:node_modules/x.js" 2>/dev/null && ok "gitignored files left out" || no "ignored files leaked"
! git --git-dir="$R" ls-tree -r --name-only "$clone_ref" | grep -q '^.claude/worktrees' && ok "nested worktree not folded into the clone's snapshot" || no "nested worktree leaked"
[[ "$(cf "$nest_ref" nested-only.txt)" == "n" ]] && ok "nested worktree saved on its own branch" || no "nested snapshot"
[[ "$(cf "$feat_ref" feat-only.txt)" == "f" ]] && ! git --git-dir="$R" cat-file -e "$feat_ref:src/new.ts" 2>/dev/null && ok "worktree snapshot holds only its own tree" || no "wt-feat content"
base=$(git -C "$T/clone" rev-parse HEAD)
[[ "$(git --git-dir="$R" rev-parse "$clone_ref^")" == "$base" ]] && ok "snapshot's parent is the tree's HEAD" || no "parent"
git --git-dir="$R" for-each-ref refs/heads/main | grep -q . && [[ "$(git --git-dir="$R" rev-parse main)" == "$base" ]] && ok "main on the remote untouched" || no "remote main moved"

# a file over the size limit is refused, and nothing of that tree is pushed
g -C "$T/clone" worktree add -q "$T/wt-big" -b feat/big
head -c 4096 /dev/zero > "$T/wt-big/blob.bin"
out=$(cd "$T/clone" && PRESERVE_MAX_BYTES=1024 bash "$S" --push 2>&1)
grep -q "REFUSED   $T/wt-big — files over" <<<"$out" && grep -q "blob.bin" <<<"$out" \
  && ! git --git-dir="$R" for-each-ref --format='%(refname:short)' refs/heads/wip | grep -qE -- '--wt-big-' \
  && ok "file over the limit refused, tree not pushed" || { no "size refusal"; echo "$out"; }

# progress goes to stderr as each tree is visited (no silent wait on a large clone)
err=$(cd "$T/clone" && bash "$S" 2>&1 >/dev/null)
grep -q "checking .* tree(s)" <<<"$err" && grep -q "\[1/" <<<"$err" && ok "progress printed per tree" || { no "progress"; echo "$err"; }

# --- v3 cases -------------------------------------------------------------------
refs_now() { git --git-dir="$R" for-each-ref --format='%(refname:short)' refs/heads/wip; }
rm -f "$T/wt-big/blob.bin"

# two trees sharing one folder name (as Cursor's do) get distinct branches
mkdir -p "$T/p1" "$T/p2"
g -C "$T/clone" worktree add -q "$T/p1/same" -b feat/same1
g -C "$T/clone" worktree add -q "$T/p2/same" -b feat/same2
echo one > "$T/p1/same/one.txt"; echo two > "$T/p2/same/two.txt"
# dependency/cache folders are left out even with no .gitignore rule for them
mkdir -p "$T/p1/same/.venv/lib" "$T/p1/same/pkg/__pycache__" "$T/p1/same/apps/w/.next"
echo v > "$T/p1/same/.venv/lib/x.py"; echo c > "$T/p1/same/pkg/__pycache__/y.pyc"; echo n > "$T/p1/same/apps/w/.next/z"
out=$(cd "$T/clone" && PRESERVE_STAMP=20260928T0001Z bash "$S" --push 2>&1)
r1=$(refs_now | grep -E -- 'p1--same-[0-9a-f]{7}$'); r2=$(refs_now | grep -E -- 'p2--same-[0-9a-f]{7}$')
[[ -n "$r1" && -n "$r2" && "$r1" != "$r2" ]] && [[ "$(cf "$r1" one.txt)" == "one" && "$(cf "$r2" two.txt)" == "two" ]] \
  && ok "same folder name in two places -> two distinct branches, each its own content" || { no "name collision"; echo "$out"; refs_now; }
! git --git-dir="$R" ls-tree -r --name-only "$r1" | grep -qE '(^|/)(\.venv|__pycache__|\.next)/' \
  && ok "dependency and cache folders left out without a .gitignore rule" || no "cache folders leaked"

# resume: the same stamp again pushes nothing new and reports "already"
before_refs=$(refs_now)
out=$(cd "$T/clone" && PRESERVE_STAMP=20260928T0001Z bash "$S" --push 2>&1)
[[ "$(refs_now)" == "$before_refs" ]] && grep -q "^already   $T/p1/same" <<<"$out" && grep -q "already saved" <<<"$out" \
  && ok "re-run with the same stamp skips trees already saved" || { no "resume"; echo "$out"; }

# a slow tree is reported SLOW within the limit; the others are still saved
REAL_GIT=$(command -v git)
mkdir -p "$T/slowbin"
cat > "$T/slowbin/git" <<SHIM
#!/usr/bin/env bash
if [[ " \$* " == *" -C $T/p2/same add "* ]]; then sleep 6; fi
exec "$REAL_GIT" "\$@"
SHIM
chmod +x "$T/slowbin/git"
echo more > "$T/p1/same/more.txt"; echo more > "$T/p2/same/more.txt"
start=$(date +%s)
out=$(cd "$T/clone" && PATH="$T/slowbin:$PATH" PRESERVE_STAMP=20260928T0002Z PRESERVE_TREE_SECONDS=1 bash "$S" --push 2>&1); rc=$?
took=$(( $(date +%s) - start ))
grep -q "^SLOW      $T/p2/same" <<<"$out" && [[ $rc -ne 0 ]] && refs_now | grep -qE -- '0002Z/p1--same-' && ! refs_now | grep -qE -- '0002Z/p2--same-' && [[ $took -lt 6 ]] \
  && ok "slow tree reported SLOW in ${took}s, not saved, the rest saved, exit non-zero" || { no "slow tree (took ${took}s, rc $rc)"; echo "$out"; }
# the command printed for it saves it
cmd=$(grep -A1 "^SLOW      $T/p2/same" <<<"$out" | tail -1 | sed 's/^ *//')
( cd "$T/clone" && eval "$cmd" >/dev/null 2>&1 )
refs_now | grep -qE -- '0002Z/p2--same-' && ok "the printed re-run command saves the slow tree" || { no "slow re-run"; echo "$cmd"; }

# --only limits the run to one tree
out=$(cd "$T/clone" && bash "$S" --only "$T/p1/same" 2>&1)
grep -q "checking 1 tree(s)" <<<"$out" && grep -q "would save $T/p1/same " <<<"$out" && ! grep -q "$T/p2/same" <<<"$out" \
  && ok "--only runs just that tree" || { no "--only"; echo "$out"; }
out=$(cd "$T/clone" && bash "$S" --only /nonexistent 2>&1); rc=$?
[[ $rc -eq 2 ]] && grep -q "not found" <<<"$out" && ok "--only a missing path refused" || no "--only missing"

echo "== $pass passed, $fail failed"
[[ $fail -eq 0 ]]
