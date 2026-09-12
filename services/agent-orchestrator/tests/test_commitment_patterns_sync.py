"""Anti-divergence tests for the UCC contract-formation guardrail (OD-44).

The guardrail lives in three places that must agree:

  1. apps/api-gateway/src/common/orchestrator/commitment-patterns.ts  (CANON)
  2. services/agent-orchestrator/core/commitment_patterns.py        (generated)
  3. services/constraint_engine.py C-02                               (canon ∪ heuristics)

They had already diverged once — TS carried 19 phrases, the Python agent carried 8,
under a comment claiming they were "ported verbatim", and the Python runtime is the
one that auto-sends. These tests fail if that ever happens again. The sync itself is
today's symptom; this file is the fix.
"""

from __future__ import annotations

import importlib.util
import re
import subprocess
import sys
from pathlib import Path

import pytest

SERVICE_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = SERVICE_ROOT.parent.parent

TS_CANON = (
    REPO_ROOT
    / "apps"
    / "api-gateway"
    / "src"
    / "common"
    / "orchestrator"
    / "commitment-patterns.ts"
)
PY_GENERATED = SERVICE_ROOT / "core" / "commitment_patterns.py"
SYNC_SCRIPT = REPO_ROOT / "scripts" / "sync_commitment_patterns.py"

# The whole monorepo is present in CI and in a dev checkout, but the orchestrator
# ships as a standalone container. Skip rather than fail if the sibling tree is
# absent, so the suite stays runnable inside that image.
requires_monorepo = pytest.mark.skipif(
    not TS_CANON.exists() or not SYNC_SCRIPT.exists(),
    reason="TypeScript canon not present (standalone service checkout)",
)


def _load_sync_module():
    spec = importlib.util.spec_from_file_location(
        "sync_commitment_patterns", SYNC_SCRIPT
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _ts_patterns() -> list[str]:
    return _load_sync_module().parse_canonical_patterns(
        TS_CANON.read_text(encoding="utf-8")
    )


def _py_patterns() -> list[str]:
    from core.commitment_patterns import COMMITMENT_PATTERNS

    return list(COMMITMENT_PATTERNS)


# ─────────────────────────────────────────────────────────────────────────────
# The divergence guards
# ─────────────────────────────────────────────────────────────────────────────


@requires_monorepo
def test_python_guardrail_matches_typescript_canon_exactly():
    """The two runtimes carry the same patterns, in the same order.

    This is the test OD-44 asked for: it fails the moment either list is edited
    without the other. Order is asserted too, so a reviewer diffing the two files
    sees them line up.
    """
    ts = _ts_patterns()
    py = _py_patterns()

    assert py == ts, (
        "Commitment-language guardrail has diverged between runtimes.\n"
        f"  TypeScript canon ({len(ts)}): {ts}\n"
        f"  Python generated ({len(py)}): {py}\n"
        f"  only in TS: {sorted(set(ts) - set(py))}\n"
        f"  only in PY: {sorted(set(py) - set(ts))}\n"
        "Edit apps/api-gateway/src/common/orchestrator/commitment-patterns.ts, then "
        "run: python3 scripts/sync_commitment_patterns.py"
    )


@requires_monorepo
def test_generated_module_is_not_stale():
    """Regenerating from the canon must reproduce the checked-in file byte for byte.

    Catches a hand-edit of the generated module even when the pattern list itself
    still happens to agree.
    """
    result = subprocess.run(
        [sys.executable, str(SYNC_SCRIPT), "--check"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, (
        "scripts/sync_commitment_patterns.py --check failed:\n"
        f"{result.stdout}\n{result.stderr}"
    )


@requires_monorepo
def test_no_pattern_is_dropped_relative_to_the_original_typescript_list():
    """Regression floor: the guardrail may grow, never shrink.

    OD-44 was resolved by raising Python to the TypeScript list, explicitly not by
    lowering TypeScript. These ten English phrases were in the stronger list at the
    time of the fix; dropping any of them is a deliberate weakening that must not
    pass silently.
    """
    required = {
        r"\bwill take\b",
        r"\bwould like to order\b",
        r"\bplease confirm our order\b",
        r"\bwe'?ll proceed with\b",
        r"\bwe accept\b",
        r"\bconfirm \d+ cases?\b",
        r"\blet'?s go ahead\b",
        r"\bsending payment\b",
        r"\bplace the order\b",
        r"\bgo ahead and ship\b",
    }
    missing = required - set(_py_patterns())
    assert not missing, f"Commitment guardrail lost patterns: {sorted(missing)}"


def test_patterns_are_portable_between_javascript_and_python():
    """Every pattern must compile under Python `re` and stay in the shared subset.

    The lists can only be kept identical if the syntax means the same thing in both
    engines, so constructs that exist in only one are rejected here.
    """
    unportable = ("(?<", "(?P<", "(?i)", "\\A", "\\Z", "\\p{", "\\h")
    for pattern in _py_patterns():
        re.compile(pattern)  # raises re.error on invalid Python syntax
        for token in unportable:
            assert token not in pattern, (
                f"Pattern {pattern!r} uses {token!r}, which does not mean the same "
                "thing in JavaScript RegExp and Python re."
            )


# ─────────────────────────────────────────────────────────────────────────────
# Behaviour: the guardrail actually fires, and the auto-send path still works
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "text",
    [
        "Great — we accept the offered price.",
        "Please place the order for 6 cases.",
        "You can go ahead and ship them this week.",
        "Nous acceptons votre offre.",
        "Confermiamo l'ordine di 12 bottiglie.",
        "Wir akzeptieren den Preis.",
        "WE ACCEPT THE TERMS",  # case-insensitive, mirroring the JS /i flag
    ],
)
def test_commitment_language_is_detected(text):
    from core.commitment_patterns import contains_commitment_language

    assert contains_commitment_language(text) is True


@pytest.mark.parametrize(
    "text",
    [
        "Could you please hold those for us? I'll get back to you very soon.",
        "What is your price on the 2019 Barolo?",
        "Thanks for the heads up — let me check with my manager.",
    ],
)
def test_non_commitment_language_is_not_flagged(text):
    from core.commitment_patterns import contains_commitment_language

    assert contains_commitment_language(text) is False


def test_scarcity_auto_reply_hold_message_still_clears_the_guardrail():
    """The one Python path that auto-sends must not be blocked by the wider list.

    ``ProviderConversationAgent._scarcity_auto_reply`` sends this templated hold
    message without human approval, gated on the commitment check. Raising Python
    from 8 to 19 patterns must not silently disable that path.
    """
    from core.commitment_patterns import contains_commitment_language

    hold_message = (
        "Hi Marco,\n\n"
        "Thanks for the heads up. Could you please hold those for us? "
        "I'll get back to you very soon with confirmation.\n\n"
        "Thank you,\nRestaurant Manager"
    )
    assert contains_commitment_language(hold_message) is False


def test_constraint_engine_c02_includes_the_shared_patterns():
    """C-02 carried a third list under the same false "copied verbatim" comment.

    It is now the union of the shared canon and its own broad heuristics, so it can
    only get stronger. Both halves must be present.
    """
    from services.constraint_engine import (
        COMMITMENT_HEURISTIC_PATTERNS,
        COMMITMENT_PATTERNS as C02_PATTERNS,
    )

    shared = _py_patterns()
    assert set(shared).issubset(
        set(C02_PATTERNS)
    ), "C-02 no longer contains the shared cross-runtime commitment patterns."
    assert set(COMMITMENT_HEURISTIC_PATTERNS).issubset(
        set(C02_PATTERNS)
    ), "C-02 lost its own co-occurrence heuristics — that is a weakening."
