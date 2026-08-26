#!/usr/bin/env bash
#
# Vercel "Ignore Build Step" — decides whether this commit can possibly change
# the web bundle.
#
# Contract (Vercel's, not ours): exit 1 = BUILD, exit 0 = SKIP.
# That is inverted from every other exit code in this repo, so it is stated
# here rather than left to be rediscovered.
#
# Why this exists. On 2026-08-26 the account hit its free-tier ceiling —
# "more than 100, code: api-deployments-free-per-day" — and every PR went red
# for a reason that had nothing to do with its code. Two genuine failures were
# merged past that day (a lint break and a broken E2E) because the red X had
# stopped meaning anything. A check that fails for reasons unrelated to the
# diff is worse than no check: it trains people to ignore the colour.
#
# The count was inflated almost entirely by commits that cannot affect the
# bundle — `.planning/` documentation, `supabase/migrations/`, gateway-only
# TypeScript. Those still deployed, twice each, because this repo is connected
# to two Vercel projects.
#
# `main` always builds: production is never worth being clever about.
set -uo pipefail

REF="${VERCEL_GIT_COMMIT_REF:-}"

if [ "$REF" = "main" ]; then
  echo "main -> build (production is never skipped)"
  exit 1
fi

# Everything the web bundle is actually built from. Deliberately generous:
# a needless build costs one deployment, a skipped one that mattered costs a
# broken preview nobody notices.
PATHS=(
  "apps/web"
  "packages/ui"
  "packages/database"
  "package.json"
  "pnpm-lock.yaml"
  "pnpm-workspace.yaml"
  "turbo.json"
  "vercel.json"
  "scripts/vercel_should_build.sh"
)

# No parent commit (first build of a branch, shallow clone) means we cannot
# tell what changed. Build — an unknown answer must not read as "skip".
if ! git rev-parse --verify HEAD^ >/dev/null 2>&1; then
  echo "no parent commit -> build (cannot tell what changed; failing open)"
  exit 1
fi

if git diff --quiet HEAD^ HEAD -- "${PATHS[@]}"; then
  echo "no web-affecting paths changed -> skip"
  exit 0
fi

echo "web-affecting paths changed -> build"
git diff --name-only HEAD^ HEAD -- "${PATHS[@]}" | head -20
exit 1
