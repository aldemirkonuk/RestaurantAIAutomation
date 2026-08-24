#!/usr/bin/env bash
#
# Gateway boot guard — does the NestJS dependency graph actually resolve?
#
# WHY THIS EXISTS
# ---------------
# On 2026-08-24 the api-gateway crash-looped in production on the P1 merge commit:
#
#   Nest can't resolve dependencies of the JwtAuthGuard (Reflector, ?).
#   TokenBlacklistService at index [1] is not available in the PosHubModule context.
#
# `tsc --noEmit` was clean and 780 jest tests passed. Neither can see this: jest
# builds small testing modules with the providers it needs, and tsc does not model
# Nest's runtime injector at all. The only thing that catches it is constructing the
# real AppModule graph — which is what this does.
#
# It is a *boot* check, not a smoke test: it builds the application context and
# closes it immediately. No port is bound and no request is served.
#
# The env below is placeholder, never real. Some providers read config at
# construction time — DatabaseService throws "Supabase configuration missing" in
# onModuleInit — so the graph needs values *present*, not values that work. The
# Supabase URL points at `.invalid`, a reserved TLD that cannot resolve: if a
# module ever tries to reach it during boot, the check fails, and a boot-time
# network call is exactly the kind of thing this should refuse to let through.
#
# NEVER VACUOUS: every way of not-actually-checking exits non-zero. A guard that
# passes because it could not run is worse than no guard.
#
set -uo pipefail

GATEWAY="apps/api-gateway"
ENTRY="dist/app.module.js"

cd "$(dirname "$0")/.." || { echo "FAIL — cannot reach repo root"; exit 2; }

[ -d "$GATEWAY" ] || { echo "FAIL — $GATEWAY not found; this guard is pointed at nothing"; exit 2; }
cd "$GATEWAY" || exit 2

echo "== Building $GATEWAY"
if ! npx nest build >/tmp/gateway-boot-build.log 2>&1; then
  echo "FAIL — build failed; the boot graph could not be checked"
  tail -20 /tmp/gateway-boot-build.log
  exit 2
fi

[ -f "$ENTRY" ] || { echo "FAIL — $ENTRY missing after a successful build; entry path changed?"; exit 2; }

# The runner must live INSIDE the gateway package: node resolves `@nestjs/core`
# from the requiring file's directory, so a runner in /tmp fails with "Cannot find
# module '@nestjs/core'" — a failure of the guard, not of the app. Caught by running
# it; the first version of this script did exactly that.
RUNNER="$PWD/.gateway-boot-check.cjs"
trap 'rm -f "$RUNNER"' EXIT
cat > "$RUNNER" <<'JS'
// Resolve the real AppModule injector, then tear it down. Any unresolved
// provider, circular import, or missing module import throws here.
(async () => {
  const { NestFactory } = require("@nestjs/core");
  const { AppModule } = require(process.argv[2]);
  try {
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: ["error"],
      abortOnError: false,
    });
    await app.close();
    console.log("BOOT_OK");
    process.exit(0);
  } catch (e) {
    // One line, not a 40-frame Nest stack: the first line names the module and
    // the provider, which is the whole diagnosis.
    const msg = e && e.message ? String(e.message).split("\n")[0] : String(e);
    console.log("BOOT_FAIL: " + msg);
    process.exit(1);
  }
})();
JS

echo "== Resolving the AppModule dependency graph"
OUT="$(
  env NODE_ENV=test \
      JWT_SECRET="boot-check-only-not-a-real-secret-0123456789" \
      SUPABASE_URL="https://boot-check.invalid" \
      SUPABASE_SERVICE_ROLE_KEY="boot-check-only-not-a-real-key" \
      SUPABASE_ANON_KEY="boot-check-only-not-a-real-key" \
      node "$RUNNER" "$PWD/$ENTRY" 2>&1
)"
STATUS=$?

if [ "$STATUS" -eq 0 ] && printf '%s' "$OUT" | grep -q '^BOOT_OK$'; then
  echo "PASS — the gateway dependency graph resolves; the app can boot."
  exit 0
fi

echo "FAIL — the gateway cannot boot. This crash-loops in production."
printf '%s\n' "$OUT" | grep -E '^BOOT_FAIL:|Nest can.t resolve|Potential solutions' | head -5
printf '%s\n' "$OUT" | head -25
echo
echo "Most common cause: a controller uses @UseGuards(JwtAuthGuard) but its module"
echo "does not import AuthModule. AuthModule is not @Global(), and a guard resolves"
echo "in the context of the module that declares the controller — so the missing"
echo "import kills the whole app, not just that route."
exit 1
