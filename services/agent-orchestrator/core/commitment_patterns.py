"""GENERATED FILE — DO NOT EDIT BY HAND.

UCC contract-formation guardrail patterns (AI-SPEC §6, OD-44).

Canonical source:
    apps/api-gateway/src/common/orchestrator/commitment-patterns.ts

Regenerate with:
    python3 scripts/sync_commitment_patterns.py

CI runs ``--check`` and fails if this file drifts from the TypeScript canon.
Editing the list here instead of at the canon is the exact failure OD-44 records:
the guardrail silently weakened on the runtime that can auto-send.
"""

from __future__ import annotations

import re
from typing import List

#: Pattern sources, mirrored verbatim from the TypeScript canon.
COMMITMENT_PATTERNS: List[str] = [
    "\\bwill take\\b",
    "\\bwould like to order\\b",
    "\\bplease confirm our order\\b",
    "\\bwe'?ll proceed with\\b",
    "\\bwe accept\\b",
    "\\bconfirm \\d+ cases?\\b",
    "\\blet'?s go ahead\\b",
    "\\bsending payment\\b",
    "\\bplace the order\\b",
    "\\bgo ahead and ship\\b",
    "\\bnous acceptons\\b",
    "\\bnous confirmons\\b",
    "\\bbon de commande\\b",
    "\\baccettiamo\\b",
    "\\bconfermiamo l'ordine\\b",
    "\\baceptamos\\b",
    "\\bconfirmamos el pedido\\b",
    "\\bwir akzeptieren\\b",
    "\\bbestellung aufgeben\\b",
]

#: Pre-compiled, case-insensitive — matches the JavaScript ``/i`` flag.
COMPILED_COMMITMENT_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in COMMITMENT_PATTERNS
]


def contains_commitment_language(text: str) -> bool:
    """True when *text* contains language that could form a binding purchase commitment.

    Callers must never auto-send a message for which this returns True.
    """
    return any(p.search(text) for p in COMPILED_COMMITMENT_PATTERNS)
