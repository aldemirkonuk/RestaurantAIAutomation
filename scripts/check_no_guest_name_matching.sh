#!/usr/bin/env bash
# Guard: guests.display_label is never used to resolve, match or merge a
# person (register A14; 20260819000000_guest_identity_minimal_slice.sql).
#
# The wine analogue is what makes this dangerous. master_wine_library.name IS
# part of a match key -- producer + name + residual tokens identify a product,
# and arch §3.4 measured that key at 0 false merges over 732,874 pairs. The
# instinct to reuse the pattern on a person is strong and it is wrong: a name
# carries none of the information that distinguishes two people. "John Smith"
# is a collision class, and which John Smith is not in the string at all, so
# no tokenisation recovers it. Name similarity therefore has arch §3.2's
# distribution-overlap defect in its worst form -- there is no threshold, not
# even a very high one.
#
# And the cost of getting it wrong is not a data-quality error. A false guest
# merge is a DISCLOSURE: one person's dining history, spend, allergies and
# companions become visible to another, and to every staff member reading the
# profile. No un-merge reverses that.
#
# Identity resolution has exactly one legal home: guest_link_identifier(),
# which decides by exact hashed-verified-channel equality inside the database.
#
#   ./scripts/check_no_guest_name_matching.sh              # the check
#   ./scripts/check_no_guest_name_matching.sh --self-test  # proves it can fail
#
# Exits 1 if application code appears to match on a guest's display label.
# Exits 2 (CANNOT CHECK) if it could not search: until ADR 0259 it ran `rg`,
# which the CI runner does not have, and printed PASS over nothing.

set -uo pipefail

here="${BASH_SOURCE[0]}"; [[ "$here" == */* ]] && lib="${here%/*}/lib" || lib=lib
# shellcheck source=lib/app_code_grep.sh
source "$lib/app_code_grep.sh" 2>/dev/null \
  || { echo "CANNOT CHECK — ${lib}/app_code_grep.sh is missing."; exit 2; }
acg_enter_repo

# display_label appearing near a comparison, similarity call, or lookup.
# Deliberately broad: a false positive is one line in the allowlist below,
# a false negative is a disclosure.
PATTERN='display_label\s*(===|==|!=|!==|\.localeCompare|\.includes|\.startsWith|ilike|similar|~\*)|(similarity|levenshtein|fuzzy|soundex|metaphone)\s*\([^)]*display_label|display_label[^)\n]*\b(similarity|levenshtein|fuzzy)\b'

# File and exact trimmed line, audited as NOT a violation (keyed on content,
# so an exemption never drifts onto a different line):
ALLOWLIST=(
)

if [[ "${1:-}" == "--self-test" ]]; then
  acg_self_test scripts/check_no_guest_name_matching.sh \
    "if (guest.display_label === other.display_label) mergeGuests(guest, other);" \
    "if guest.display_label == other.display_label:"
  exit $?
fi

acg_measure_corpus
matches="$(acg_search "$PATTERN")" || exit $?

fail=0
offenders=()
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  if ! acg_is_allowlisted "$line" "${ALLOWLIST[@]}"; then
    offenders+=("$line")
    fail=1
  fi
done <<< "$matches"

if [[ $fail -eq 1 ]]; then
  echo "FAIL: a guest's display_label appears to be used for matching:"
  printf '  %s\n' "${offenders[@]}"
  echo
  echo "display_label is a display string, never a match key -- the same rule"
  echo "as beverages.age_years. Resolve guests through"
  echo "guest_link_identifier(), which decides by exact hashed verified"
  echo "channel equality. If two guests are genuinely the same person and no"
  echo "verified channel proves it, that needs a human, not a string compare."
  exit 1
fi

echo "PASS — no guest display_label matching in application code."
echo "  searched ${ACG_CORPUS_COUNT} files (${ACG_TSX_COUNT} .tsx, ${ACG_PY_COUNT} .py) under apps/, services/ and scripts/."
