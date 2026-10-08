"""Figures the house keeps to itself never reach a vendor-facing draft.

A procurement intent carries `max_acceptable_price`, the house's ceiling.
The agent uses it only for its own accept test
(ProviderConversationAgent, "parsed_price <= max_acceptable"). It used to
reach the drafting prompt too, because the whole intent was json-dumped
into RESPONSE_SYSTEM_PROMPT's {intent_description}. On 2026-10-08 the F-106
production dry run found a waiting draft that told the vendor both the
target and the ceiling. That draft was never sent (tech-debt.d
2026-10-08-data-f106-reconcile-pending-drafts).

There are two layers here:
  1. `vendor_safe_intent` removes the house-only keys before the prompt is
     built, so the model never sees the ceiling.
  2. `withheld_figures_in` checks the drafted text for the ceiling figure in
     the forms a model writes it: 1199, 1,199, 1.199, 1 199, 1199.00 and
     1.199,00. The caller drops a draft that holds it. A ceiling equal to the
     target is not withheld, because the target is the price the house means
     to propose (procurement_agent.py sets max = target when it has no other
     figure).

Not covered: a figure written in words ("eleven hundred"), and a figure
the model works out from others ("ten percent over our target").
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Mapping

# Intent keys that are for the house's own decisions and never for a vendor.
HOUSE_ONLY_INTENT_KEYS = frozenset({"max_acceptable_price"})

# A number as a model writes one: digits, optionally grouped by , . or a
# space (incl. no-break and thin spaces), optionally with decimals.
_NUMBER = re.compile(r"\d(?:[\d.,   ]*\d)?")


def vendor_safe_intent(intent: Mapping[str, Any] | None) -> Dict[str, Any]:
    """A copy of the intent without the keys the vendor must not see."""
    return {k: v for k, v in (intent or {}).items() if k not in HOUSE_ONLY_INTENT_KEYS}


def _as_number(value: Any) -> float | None:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


_SPACES = "\u00a0\u202f "
_EN = re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?")
_TR = re.compile(r"\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?")
_SPACE_GROUPED = re.compile(r"\d{1,3}(?:[\u00a0\u202f ]\d{3})+(?:[.,]\d+)?")


def _readings(token: str) -> List[float]:
    """Every value the token could mean, in English or Turkish grouping.

    A separator counts as grouping only before exactly three digits, so
    "11,99" reads 11.99 and never 1199.
    """
    if any(c in token for c in _SPACES):
        if not _SPACE_GROUPED.fullmatch(token):
            parts = re.split(r"[\u00a0\u202f ]+", token)
            return [v for part in parts if part for v in _readings(part)]
        token = re.sub(r"[\u00a0\u202f ]", "", token)
    out: List[float] = []
    if _EN.fullmatch(token):
        out.append(float(token.replace(",", "")))
    if _TR.fullmatch(token):
        out.append(float(token.replace(".", "").replace(",", ".")))
    return out


def withheld_figures_in(text: str, intent: Mapping[str, Any] | None) -> List[str]:
    """The house-only keys whose figure appears in `text` (empty when none).

    A key whose value equals the intent's target price is skipped: that
    figure is meant to be said.
    """
    if not text or not intent:
        return []
    target = _as_number(intent.get("target_price"))
    values = [_readings(m.group(0)) for m in _NUMBER.finditer(text)]
    hits: List[str] = []
    for key in sorted(HOUSE_ONLY_INTENT_KEYS):
        ceiling = _as_number(intent.get(key))
        if ceiling is None or (target is not None and abs(ceiling - target) < 0.005):
            continue
        if any(abs(v - ceiling) < 0.005 for vs in values for v in vs):
            hits.append(key)
    return hits
