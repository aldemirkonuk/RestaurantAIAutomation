#!/usr/bin/env bash
# Guard: a model call site can never skip the spend ledger (P1 §5 item 4).
#
# WHY THIS EXISTS
# ---------------
# P1 defect D3: the entire NestJS gateway writes nothing to the ledger. Seven raw
# `fetch("https://api.anthropic.com/v1/messages")` call sites, zero of which reach
# `api_spend` — `grep -c api_spend apps/api-gateway/src` returns 0. Every gateway
# model call, including `claude-opus-4-8` in the consultants path, is invisible.
# The Python runtime is better but not clean: `SpendLogger` exists and 7 files use
# it, while 11 others call a provider and log nothing.
#
# That hole did not appear in one commit. It appeared because each new call site
# was written by copying the previous one, and the previous one did not log either.
# Fixing the 18 sites without this guard fixes today and loses again in a month:
# P1 §5.4 says "without this, D3 recurs". So this is the ratchet — a NEW unlogged
# call site fails the build, and the known-unlogged set can only shrink.
#
#   ./scripts/check_model_calls_logged.sh
#
# Exit 0 = every call site is accounted for.  Exit 1 = a violation.
# Exit 2 = the guard could not check what it claims to check (see NEVER VACUOUS).
#
# NEVER VACUOUS
# -------------
# schema-parity.yml's own comment makes the point that a check which passes because
# it found nothing to look at is worse than no check, because it buys confidence it
# has not earned. So every "found nothing" path here is a FAILURE, not a pass:
#   * the gateway wrapper directory is missing  -> exit 2, not "nothing to enforce"
#   * zero gateway provider references found    -> exit 2, the pattern has rotted
#   * zero Python call sites found              -> exit 2, same
#   * spend_logger.py has moved or been renamed -> exit 2, same
#   * a debt entry below is now clean           -> exit 1, prune it (ratchet)
# The last one matters as much as the first: a debt list nobody prunes stops being
# a record of debt and becomes a list of files the guard has quietly stopped reading.
#
# WHY A GREP AND NOT A LINT RULE
# ------------------------------
# Same reasoning as check_no_direct_stock_writes.sh: the thing being enforced is
# "this HTTP call was paid for and nobody wrote it down", which no type checker can
# see. A hand-rolled `fetch()` to a provider URL type-checks perfectly.
#
# Detection is a two-signal AND — a file must both reference a provider AND contain
# an invocation — which is what keeps the false positives out without an allowlist
# entry for each. It is why `services/plivo_client.py` (`self.client.messages.create`
# is Plivo SMS, no provider import) and `services/model_clients.py` (builds clients,
# invokes nothing) are silent here rather than permanently exempted.
#
# Portable to macOS and Linux CI: POSIX `find` + `grep -E` only. No ripgrep, no
# GNU-only flags, no `getent`-class builtins that differ across the two.
#
# TESTING THIS GUARD
# ------------------
# It takes its repo root from its own location (`dirname $0/..`), so the way to
# exercise it against a fixture tree is to copy it into `<fixture>/scripts/` and run
# it there. There is deliberately no root-override env var: a guard with a documented
# "point me somewhere else" switch is a guard with a documented way to neuter it.

set -euo pipefail

cd "$(dirname "$0")/.."

fail=0

# ---------------------------------------------------------------------------
# Patterns
# ---------------------------------------------------------------------------

# A gateway file that talks to a model provider over raw HTTP.
GATEWAY_PROVIDER_RE='api\.anthropic\.com|generativelanguage\.googleapis'

# ...must pull the call through the shared wrapper. Matched on the import
# specifier rather than an exported symbol name, so the wrapper is free to
# rename its exports without silently disarming this guard.
GATEWAY_WRAPPER_RE='(from|import|require)[^;]*model-client'

# Python: signal 1 — the file has a provider client in scope.
PY_PROVIDER_RE='import anthropic|from anthropic|AsyncAnthropic|from google import genai|google\.generativeai|api\.anthropic\.com|generativelanguage\.googleapis|get_haiku_client|get_gemini_client'
# Python: signal 2 — the file actually invokes one.
PY_INVOKE_RE='\.messages\.create\(|\.messages\.stream\(|generate_content'
# Python: the ledger.
PY_LOGGED_RE='spend_logger|SpendLogger|log_spend'

GATEWAY_SRC="apps/api-gateway/src"
GATEWAY_WRAPPER_DIR="apps/api-gateway/src/common/model-client"
PY_SRC="services/agent-orchestrator"
PY_LEDGER="services/agent-orchestrator/services/spend_logger.py"

# ---------------------------------------------------------------------------
# Allowlist — files that reference a provider but do NOT call one.
#
# This list is for "the signal fired and the file is genuinely innocent", never
# for "this call site is not logged yet" — unlogged call sites go in the debt
# ratchet further down, which is loud and shrink-only. Keep them apart: merging
# them turns a temporary exemption into a permanent one by filing it in the
# wrong drawer.
#
# Each entry is a path prefix, and each needs a comment saying why.
# ---------------------------------------------------------------------------
GATEWAY_ALLOWLIST=(
  # The wrapper itself. It is the one place in the gateway that is SUPPOSED to
  # name a provider URL — the whole point of P1 §5.3 is that the URL, the retry
  # and the timeout live here once instead of seven times.
  "apps/api-gateway/src/common/model-client/"
)

PY_ALLOWLIST=(
  # (empty) The two-signal AND already excludes the client factory
  # (services/model_clients.py — constructs clients, invokes none) and the Plivo
  # SMS client (services/plivo_client.py — `.messages.create()` is Plivo's API,
  # not Anthropic's). Neither needs an exemption, so neither gets one: an
  # allowlist entry that is not doing any work is a place for a real violation
  # to hide later.
)

# ---------------------------------------------------------------------------
# Debt ratchet — Python call sites that predate P1 and do not log.
#
# These are NOT approved. They are the 11 files that were already unlogged when
# this guard was written, recorded here so the guard can be green-on-arrival and
# therefore actually block the 12th. P1 §5.4 scopes the requirement to a *new*
# call site for exactly this reason.
#
# The list is shrink-only and the guard enforces that in both directions:
#   * a file here that now logs  -> FAIL, delete the line
#   * a new file that does not   -> FAIL, log it
# So the only way to touch this list is to make it shorter.
# ---------------------------------------------------------------------------
PY_UNLOGGED_DEBT=(
  # EMPTY, and that is the goal state: every Python model call site reaches the
  # ledger. All 11 original entries were closed during the P1 build (2026-08-24).
  # Keep the "" placeholder so the array is defined under `set -u` on bash 3.2;
  # it is filtered out below and never matches a real path.
  ""
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# in_list <needle> <haystack...> — exact match.
in_list() {
  local needle="$1"; shift
  local item
  for item in "$@"; do
    [[ "$needle" == "$item" ]] && return 0
  done
  return 1
}

# has_prefix <path> <prefix...> — allowlist entries are path prefixes.
has_prefix() {
  local path="$1"; shift
  local pre
  for pre in "$@"; do
    [[ "$path" == "$pre"* ]] && return 0
  done
  return 1
}

# cannot_check <line...> — record that a section could not be evaluated.
#
# Deliberately does NOT exit. The two runtimes fail independently, and while the
# gateway wrapper is still being built the gateway section is blocked every run —
# exiting there would silently disable the Python section, which is the half that
# can block a new unlogged call site today. A blocked section is reported, the
# other section still runs, and the exit code at the bottom is 2.
BLOCKED=0
cannot_check() {
  BLOCKED=1
  echo
  echo "   BLOCKED: this section cannot check what it claims to check."
  printf '     %s\n' "$@"
}

# ===========================================================================
# 1. GATEWAY — every provider reference must route through the wrapper
# ===========================================================================

check_gateway() {
echo "== Gateway (apps/api-gateway/src)"

if [[ ! -d "$GATEWAY_SRC" ]]; then
  cannot_check \
    "Expected the gateway source tree at '$GATEWAY_SRC' — it is not there." \
    "The app moved, or this script is being run from the wrong root."
  return 0
fi

# The wrapper is P1 §5.3 and is the thing every call site is measured against.
# If it is absent there is nothing to route through, and reporting PASS would
# mean reporting that seven unlogged call sites are fine.
wrapper_files=0
if [[ -d "$GATEWAY_WRAPPER_DIR" ]]; then
  wrapper_files="$(find "$GATEWAY_WRAPPER_DIR" -type f -name '*.ts' | wc -l | tr -d ' ')"
fi
if [[ "$wrapper_files" -eq 0 ]]; then
  cannot_check \
    "The shared model client does not exist yet: '$GATEWAY_WRAPPER_DIR' is" \
    "missing or contains no .ts files." \
    "" \
    "That is P1 §5 item 3 — 'one shared helper the 7 call sites route through'," \
    "which also consolidates the hand-rolled retry/timeout (Architecture Review" \
    "AR-3: 1 of 7 retries, 3 of 7 have no timeout, the other 4 disagree)." \
    "" \
    "Until it lands, this guard has no target to compare call sites against, so" \
    "it fails rather than passing everything."
  return 0
fi

gateway_hits=()
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  grep -Eq "$GATEWAY_PROVIDER_RE" "$f" 2>/dev/null && gateway_hits+=("$f")
done < <(find "$GATEWAY_SRC" -type f \( -name '*.ts' -o -name '*.tsx' \) \
           ! -name '*.spec.ts' ! -name '*.test.ts' | sort)

# Zero hits means the URL constants moved somewhere this pattern no longer sees
# — not that the gateway stopped calling models.
if [[ ${#gateway_hits[@]} -eq 0 ]]; then
  cannot_check \
    "No file under '$GATEWAY_SRC' references a model provider at all." \
    "P1 §1 recorded 7 such call sites. Either they all now go through a client" \
    "library this pattern does not match, or the pattern has rotted:" \
    "  $GATEWAY_PROVIDER_RE"
  return 0
fi

gateway_offenders=()
gateway_ok=0
gateway_exempt=0
for f in "${gateway_hits[@]}"; do
  if has_prefix "$f" "${GATEWAY_ALLOWLIST[@]}"; then
    gateway_exempt=$((gateway_exempt + 1))
    continue
  fi
  if grep -Eq "$GATEWAY_WRAPPER_RE" "$f" 2>/dev/null; then
    gateway_ok=$((gateway_ok + 1))
  else
    gateway_offenders+=("$f")
  fi
done

echo "   ${#gateway_hits[@]} file(s) reference a provider: $gateway_ok route through the wrapper, $gateway_exempt allowlisted, ${#gateway_offenders[@]} unrouted"

if [[ ${#gateway_offenders[@]} -gt 0 ]]; then
  fail=1
  echo
  echo "FAIL: gateway model call site does not route through the P1 emitter:"
  printf '   %s\n' "${gateway_offenders[@]}"
  echo
  echo "   -> Replace the raw fetch with the shared client in"
  echo "      $GATEWAY_WRAPPER_DIR. It emits the neural_footprint_event row"
  echo "      (subject_type='agent', cost_usd, input_tokens, output_tokens,"
  echo "      correlation_id) that makes nf_a.cost_per_completed_task a query"
  echo "      instead of a manual reconstruction."
  echo "   -> If the file names a provider without calling one (a doc comment, a"
  echo "      health probe), add it to GATEWAY_ALLOWLIST at the top of this"
  echo "      script with a comment saying which, so the exemption is reviewable."
fi
}

# ===========================================================================
# 2. PYTHON — every model call site must reach SpendLogger
# ===========================================================================

check_python() {
echo "== Python ($PY_SRC)"

if [[ ! -d "$PY_SRC" ]]; then
  cannot_check "Expected the orchestrator source tree at '$PY_SRC' — it is not there."
  return 0
fi

# If the ledger module is renamed, PY_LOGGED_RE keeps matching stale references
# and the guard keeps saying PASS about a logger that no longer exists.
if [[ ! -f "$PY_LEDGER" ]]; then
  cannot_check \
    "The spend ledger is not at '$PY_LEDGER'." \
    "This guard asserts call sites 'reach SpendLogger' by matching:" \
    "  $PY_LOGGED_RE" \
    "If the module moved, those matches are stale text and prove nothing. Point" \
    "PY_LEDGER and PY_LOGGED_RE at the new home."
  return 0
fi

py_callsites=()
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  grep -Eq "$PY_PROVIDER_RE" "$f" 2>/dev/null || continue   # signal 1
  grep -Eq "$PY_INVOKE_RE"   "$f" 2>/dev/null || continue   # signal 2
  py_callsites+=("$f")
done < <(find "$PY_SRC" -type f -name '*.py' \
           ! -path "$PY_SRC/venv/*" \
           ! -path "$PY_SRC/tests/*" \
           ! -path '*/__pycache__/*' | sort)

if [[ ${#py_callsites[@]} -eq 0 ]]; then
  cannot_check \
    "No model call site found under '$PY_SRC' (excluding venv/ and tests/)." \
    "There were 18 when this guard was written. Either the agents moved, or one" \
    "of the two detection signals has rotted:" \
    "  provider: $PY_PROVIDER_RE" \
    "  invoke  : $PY_INVOKE_RE"
  return 0
fi

py_logged=0
py_new_offenders=()
py_debt_present=()
for f in "${py_callsites[@]}"; do
  if has_prefix "$f" "${PY_ALLOWLIST[@]+"${PY_ALLOWLIST[@]}"}"; then
    continue
  fi
  if grep -Eq "$PY_LOGGED_RE" "$f" 2>/dev/null; then
    py_logged=$((py_logged + 1))
    # A file listed as debt that now logs must leave the list — see the ratchet
    # note above.
    if in_list "$f" "${PY_UNLOGGED_DEBT[@]}"; then
      fail=1
      echo
      echo "FAIL: '$f' is listed in PY_UNLOGGED_DEBT but now reaches SpendLogger."
      echo "   -> Delete that line. The list is the set of files still owing a"
      echo "      ledger write; a fixed file left on it is a hole the guard will"
      echo "      happily ignore the next time someone rips the logging back out."
    fi
  elif in_list "$f" "${PY_UNLOGGED_DEBT[@]}"; then
    py_debt_present+=("$f")
  else
    py_new_offenders+=("$f")
  fi
done

echo "   ${#py_callsites[@]} model call site(s); $py_logged log spend; ${#py_debt_present[@]} known unlogged (pre-P1 debt)"

if [[ ${#py_debt_present[@]} -gt 0 ]]; then
  echo
  echo "   KNOWN DEBT — these call money and write nothing. Not approved, tracked:"
  printf '     %s\n' "${py_debt_present[@]}"
  echo "     -> Each is a line in nf_a.cost_per_completed_task that does not exist."
fi

if [[ ${#py_new_offenders[@]} -gt 0 ]]; then
  fail=1
  echo
  echo "FAIL: new Python model call site that never reaches SpendLogger:"
  printf '   %s\n' "${py_new_offenders[@]}"
  echo
  echo "   -> Call get_spend_logger().log(...) on the response, as"
  echo "      services/agent-orchestrator/services/haiku_enrichment_service.py"
  echo "      does. SpendLogger.log() never raises, so this cannot break the"
  echo "      call path it instruments."
  echo "   -> If the file names a provider without calling one, add it to"
  echo "      PY_ALLOWLIST at the top of this script with a comment."
  echo "   -> Do NOT add it to PY_UNLOGGED_DEBT. That list is shrink-only; it"
  echo "      records what was already broken when the guard landed, not a way"
  echo "      to keep adding to it."
fi

# Third ratchet direction: an entry naming a file that no longer exists, or that
# no longer calls a model at all. Left in place it reads as live debt that is
# actually already gone, which quietly overstates how much is left to fix — and
# an entry the guard never matches is an entry nobody notices is wrong.
for d in "${PY_UNLOGGED_DEBT[@]}"; do
    [ -z "$d" ] && continue
  if ! in_list "$d" "${py_callsites[@]}"; then
    fail=1
    echo
    echo "FAIL: PY_UNLOGGED_DEBT lists '$d', which is no longer a model call site."
    if [[ -f "$d" ]]; then
      echo "   -> The file exists but no longer matches both detection signals."
      echo "      If the call moved elsewhere, the new home needs the ledger write."
    else
      echo "   -> The file is gone."
    fi
    echo "   -> Delete the line. The list must describe what is actually true."
  fi
done
}

# ===========================================================================
# Both runtimes run even if one is blocked — see cannot_check().
# ===========================================================================

py_debt_present=()
check_gateway
echo
check_python
echo

# A real violation outranks a blocked section: if someone added an unlogged call
# site AND the wrapper is missing, the actionable message is the call site.
if [[ $fail -eq 1 ]]; then
  echo "FAIL (exit 1) — a model call site is spending money the ledger cannot see."
  echo "       P1 §6: 'CI guard fails a deliberately unlogged call site'."
  exit 1
fi

if [[ $BLOCKED -eq 1 ]]; then
  echo "FAIL (exit 2) — the guard could not verify one or more runtimes (see BLOCKED"
  echo "       above). Not reported as a pass on purpose: a check that goes green"
  echo "       because it found nothing to inspect reports the same colour as one"
  echo "       that inspected everything, which is how D3 stayed invisible across"
  echo "       seven call sites."
  exit 2
fi

echo "PASS — every model call site routes through the ledger, or is on the"
echo "       shrink-only pre-P1 debt list (${#py_debt_present[@]} remaining)."
exit 0
