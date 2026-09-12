from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from core.commitment_patterns import (
    COMMITMENT_PATTERNS as SHARED_COMMITMENT_PATTERNS,
)

# ──────────────────────────────────────────────────────────────────────────
# Module-level regex patterns (D-32-14)
# ──────────────────────────────────────────────────────────────────────────

# C-01 TOPIC_LOCK: allow only wine/beverage procurement content
# Presence of ANY wine keyword means topic is valid — absence triggers C-01
WINE_TOPIC_PATTERNS = [
    r"\b(wine|bottle|case|vintage|varietal|appellation|grape|burgundy|bordeaux|champagne|"
    r"chardonnay|cabernet|pinot|merlot|syrah|riesling|invoice|delivery|shipment|"
    r"distributor|importer|broker|allocation|sommelier|winery|cellar|vintage)\b",
]

# C-02 COMMITMENT_GUARD (OD-44).
#
# The comment here used to read "copied verbatim from provider_conversation_agent.py".
# It never was: that agent carried a list of exact commitment phrases, this carries
# three broad co-occurrence heuristics. Two different guardrails asserting parity —
# the same defect OD-44 records for the TypeScript/Python pair.
#
# Resolved as a UNION, not a replacement. SHARED_COMMITMENT_PATTERNS (imported at the
# top of this file) is the generated cross-runtime list whose canon is
# apps/api-gateway/src/common/orchestrator/commitment-patterns.ts; the three heuristics
# below are kept on top of it. C-02 therefore becomes strictly stronger and never
# weaker: nothing it blocks today stops being blocked, and the phrases the other two
# runtimes treat as contract-forming are now blocked here as well.

#: Broad co-occurrence heuristics unique to C-02 — catch commitment shapes the exact
#: phrase list cannot ("we agree to buy 6 cases at the offered price").
COMMITMENT_HEURISTIC_PATTERNS = [
    r"\b(agree|commit|confirm|purchase|buy|order|proceed|close|accept|finalize)\b"
    r".*\b(deal|offer|price|quantity|terms)\b",
    r"\bwe will\b.*\b(buy|purchase|take|order)\b",
    r"\b(confirmed?|accepted?|agreed?)\b.*\b(price|quantity|terms|offer)\b",
]

COMMITMENT_PATTERNS = [
    *SHARED_COMMITMENT_PATTERNS,
    *COMMITMENT_HEURISTIC_PATTERNS,
]

# C-08 / C-21 PII_PAYMENT_GUARD
PII_PATTERNS = [
    r"\b\d{3}-\d{2}-\d{4}\b",  # SSN
    r"\b\d{9}\b",  # 9-digit routing number
    r"\b4[0-9]{12}(?:[0-9]{3})?\b",  # Visa card number
    r"\b5[1-5][0-9]{14}\b",  # Mastercard
    r"\b3[47][0-9]{13}\b",  # Amex
    r"\brouting.{0,20}number\b",  # "routing number" phrase
    r"\bssn\b|\bsocial.{0,10}security\b",  # SSN phrases
]

# C-19 THREE_TIER_COMPLIANCE
THREE_TIER_PATTERNS = [
    r"\bdirect[- ]from[- ]winery\b",
    r"\boff[- ]invoice\b",
    r"\bbypass[- ]distributor\b",
    r"\bkickback\b",
    r"\bunder.{0,10}table\b",
]

# C-20 EMOTIONAL_ESCALATION
EMOTIONAL_ESCALATION_PATTERNS = [
    r"\b(furious|outraged|unacceptable|lawsuit|legal.{0,15}action|never.{0,10}again)\b",
    r"\b(threatening|ultimatum|last.{0,10}chance|final.{0,10}warning)\b",
]

# C-13 AUTO_REPLY_LOOP
AUTO_REPLY_PATTERNS = [
    r"\b(out.{0,5}of.{0,5}office|auto.{0,5}reply|automatic.{0,5}response|"
    r"unsubscribe|no.{0,5}reply|mailer.{0,5}daemon|do.{0,5}not.{0,5}reply)\b",
]


# ──────────────────────────────────────────────────────────────────────────
# Result dataclass
# ──────────────────────────────────────────────────────────────────────────


@dataclass
class ConstraintResult:
    blocked: bool = False
    warnings: List[str] = field(default_factory=list)
    annotations: List[Dict] = field(default_factory=list)
    triggered_hard: List[str] = field(default_factory=list)
    triggered_annotating: List[str] = field(default_factory=list)
    is_sensitive: bool = False


# ──────────────────────────────────────────────────────────────────────────
# ConstraintEngine
# ──────────────────────────────────────────────────────────────────────────


class ConstraintEngine:
    """
    20-constraint enforcement engine (D-32-14).
    Pure Python — no LLM, no async, no external deps except re.
    """

    def check_hard_constraints(
        self,
        draft_text: str,
        *,
        quantity: Optional[float] = None,
        order_quantity: Optional[float] = None,
        target_price: Optional[float] = None,
        proposed_price: Optional[float] = None,
        auto_reply_count: int = 0,
        round_count: int = 0,
        max_rounds: int = 6,
    ) -> ConstraintResult:
        """
        Check all HARD constraints (C-01..C-22 hard group).
        Returns ConstraintResult with blocked=True if any hard constraint fires.
        First match wins; multiple may fire and all are reported.
        """
        result = ConstraintResult()
        text_lower = draft_text.lower()

        # C-13: Auto-reply loop — check before topic lock (auto-replies are off-topic by design)
        if auto_reply_count >= 3 or any(
            re.search(p, text_lower, re.IGNORECASE) for p in AUTO_REPLY_PATTERNS
        ):
            result.blocked = True
            result.triggered_hard.append("C-13")

        # C-21 / C-08: PII guard (highest priority — never log sensitive content)
        if any(re.search(p, draft_text, re.IGNORECASE) for p in PII_PATTERNS):
            result.blocked = True
            result.is_sensitive = True
            result.triggered_hard.append("C-21")

        # C-20: Emotional escalation
        if any(
            re.search(p, text_lower, re.IGNORECASE)
            for p in EMOTIONAL_ESCALATION_PATTERNS
        ):
            result.blocked = True
            result.triggered_hard.append("C-20")

        # C-19: Three-tier compliance
        if any(re.search(p, text_lower, re.IGNORECASE) for p in THREE_TIER_PATTERNS):
            result.blocked = True
            result.triggered_hard.append("C-19")

        # C-02: Commitment guard
        if any(re.search(p, text_lower, re.IGNORECASE) for p in COMMITMENT_PATTERNS):
            result.blocked = True
            result.triggered_hard.append("C-02")

        # C-01: Topic lock — if no wine keyword found → off-topic
        if not any(
            re.search(p, text_lower, re.IGNORECASE) for p in WINE_TOPIC_PATTERNS
        ):
            result.blocked = True
            result.triggered_hard.append("C-01")

        # C-03: Quantity cap (not pre-approved path)
        if quantity is not None and order_quantity is not None and order_quantity > 0:
            if quantity > order_quantity * 1.5:
                result.blocked = True
                result.triggered_hard.append("C-03")

        # C-04: Price ceiling
        if target_price is not None and proposed_price is not None and target_price > 0:
            if proposed_price > target_price * 1.15:
                result.blocked = True
                result.triggered_hard.append("C-04")

        # C-05: Round limit
        if round_count >= max_rounds:
            result.blocked = True
            result.triggered_hard.append("C-05")

        return result

    def check_annotating_constraints(
        self,
        *,
        stale_price: bool = False,
        stale_price_date: Optional[str] = None,
        last_price: Optional[float] = None,
        outstanding_invoice: bool = False,
        invoice_number: Optional[str] = None,
        unit_ambiguous: bool = False,
        relationship_drift: bool = False,
        off_hours: bool = False,
        draft_text: str = "",
    ) -> ConstraintResult:
        """
        Check ANNOTATING constraints (C-09, C-11, C-14, C-15, C-17, C-18).
        Draft proceeds but warnings/annotations are attached.
        """
        result = ConstraintResult()

        # C-09: Stale price guard (>30 days old)
        if stale_price:
            note = f"Last recorded price: ${last_price} on {stale_price_date} — confirm current pricing."
            result.triggered_annotating.append("C-09")
            result.annotations.append(
                {"code": "C-09", "message": note, "severity": "annotating"}
            )

        # C-14: Outstanding invoice
        if outstanding_invoice:
            note = f"Outstanding invoice #{invoice_number} with this provider."
            result.triggered_annotating.append("C-14")
            result.annotations.append(
                {"code": "C-14", "message": note, "severity": "annotating"}
            )

        # C-11: Unit ambiguity — bare number without unit in draft
        if unit_ambiguous or (
            draft_text
            and re.search(
                r"\b\d+\b(?!\s*(case|bottle|magnum|liter|ml|oz))",
                draft_text,
                re.IGNORECASE,
            )
        ):
            note = "Quantity unit unclear — draft should explicitly ask for cases/bottles/magnums."
            result.triggered_annotating.append("C-11")
            result.annotations.append(
                {"code": "C-11", "message": note, "severity": "annotating"}
            )

        # C-15: Relationship drift
        if relationship_drift:
            note = "Relationship profile may be outdated — using standard tone."
            result.triggered_annotating.append("C-15")
            result.annotations.append(
                {"code": "C-15", "message": note, "severity": "annotating"}
            )

        # C-17: Off-hours hold
        if off_hours:
            note = (
                "Draft held until provider's business hours (8am–6pm their timezone)."
            )
            result.triggered_annotating.append("C-17")
            result.annotations.append(
                {"code": "C-17", "message": note, "severity": "annotating"}
            )

        # C-18: Soft commitment trap
        soft_commitment_patterns = [
            r"\bwe always order from you\b",
            r"\bcount on us every quarter\b",
            r"\byou can always count on us\b",
        ]
        for p in soft_commitment_patterns:
            if re.search(p, draft_text, re.IGNORECASE):
                note = "Softened implicit ongoing commitment language detected."
                result.triggered_annotating.append("C-18")
                result.annotations.append(
                    {"code": "C-18", "message": note, "severity": "annotating"}
                )
                break

        return result

    def check_soft_constraints(self, draft_text: str) -> ConstraintResult:
        """
        Check SOFT constraints (S-01..S-04). Style defaults, overridable per provider.
        """
        result = ConstraintResult()
        text_lower = draft_text.lower()

        # S-01: No competitor mention
        if re.search(
            r"\b(other.{0,15}supplier|competitor|another.{0,10}vendor)\b", text_lower
        ):
            result.warnings.append(
                "S-01: Competitor mention detected — consider removing."
            )

        # S-02: Professional close — should end with next action
        if not re.search(
            r"\b(please|looking forward|let.{0,5}know|confirm|by|before)\b",
            text_lower[-200:],
        ):
            result.warnings.append(
                "S-02: Draft may lack a specific next action or timeline."
            )

        # S-04: Price anchor first — should ask for price before revealing target
        if re.search(r"\bour.{0,20}target.{0,10}price\b", text_lower[:200]):
            result.warnings.append(
                "S-04: Price anchor revealed in opening — consider asking their price first."
            )

        return result

    def word_count(self, text: str) -> int:
        """C-06: Count words for 180-word length cap."""
        return len(text.split())

    def check_length_cap(
        self, draft_text: str, max_words: int = 180
    ) -> ConstraintResult:
        """C-06: LENGTH_CAP — max 180 words per outbound email."""
        result = ConstraintResult()
        count = self.word_count(draft_text)
        if count > max_words:
            result.blocked = True
            result.triggered_hard.append("C-06")
            result.warnings.append(f"C-06: Draft is {count} words (max {max_words}).")
        return result


# ──────────────────────────────────────────────────────────────────────────
# Singleton
# ──────────────────────────────────────────────────────────────────────────

_constraint_engine: Optional[ConstraintEngine] = None


def get_constraint_engine() -> ConstraintEngine:
    global _constraint_engine
    if _constraint_engine is None:
        _constraint_engine = ConstraintEngine()
    return _constraint_engine
