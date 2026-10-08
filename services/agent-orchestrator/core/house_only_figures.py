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
     the forms a model writes it: 1199, 1,199, 1.199, 1 199, 1'199, 1199.00
     and 1.199,00, also when another number follows it in the same sentence
     ("$1,199. 6 bottles"). The caller replaces a draft that holds it with
     `order_letter_without_ceiling`. A ceiling equal to the target is not
     withheld, because the target is the price the house means to propose.

Not covered: a figure in words ("eleven hundred"), a rounded one ("about
1,200", "1.2k"), and a figure the model works out from others ("ten percent
over our target"). An exact match is not proof of a leak: a quantity or a
date can equal the ceiling. That is why the replacement still says
everything the order needs, and why the drop is recorded in the audit trail
the manager reads.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Mapping

# Intent keys that are for the house's own decisions and never for a vendor.
HOUSE_ONLY_INTENT_KEYS = frozenset({"max_acceptable_price"})

# A number as a model writes one: digit runs joined by a single , . ' or a
# space (incl. no-break and thin spaces). A separator must sit between digits,
# so a sentence's own comma or full stop ends the number ("$1,199. 6").
_NUMBER = re.compile(r"\d+(?:[,.'\u2019\u00a0\u202f ]\d+)*")


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
_APOSTROPHE = re.compile(r"\d{1,3}(?:['\u2019]\d{3})+(?:\.\d+)?")
_SPACE_GROUPED = re.compile(r"\d{1,3}(?:[\u00a0\u202f ]\d{3})+(?:[.,]\d+)?")


def _plain_readings(token: str) -> List[float]:
    """Values of a token with no spaces, in English, Turkish or Swiss grouping.

    A separator counts as grouping only before exactly three digits, so
    "11,99" reads 11.99 and never 1199.
    """
    out: List[float] = []
    if _EN.fullmatch(token):
        out.append(float(token.replace(",", "")))
    if _TR.fullmatch(token):
        out.append(float(token.replace(".", "").replace(",", ".")))
    if _APOSTROPHE.fullmatch(token):
        out.append(float(re.sub(r"['\u2019]", "", token)))
    return out


def _readings(token: str) -> List[float]:
    """Every value the token could mean.

    A token with spaces may be one space-grouped figure ("1 199") or several
    figures side by side ("1 199 1 090"), so every run of its parts is read.
    """
    parts = re.split(r"[\u00a0\u202f ]+", token)
    if len(parts) == 1:
        return _plain_readings(token)
    out: List[float] = []
    for i in range(len(parts)):
        out.extend(_plain_readings(parts[i]))
        for j in range(i + 2, len(parts) + 1):
            run = " ".join(parts[i:j])
            if _SPACE_GROUPED.fullmatch(run):
                out.append(float(re.sub(r"[\u00a0\u202f ]", "", run).replace(",", ".")))
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


def _price(value: Any) -> str | None:
    n = _as_number(value)
    return f"{n:,.2f}" if n is not None else None


def order_letter_without_ceiling(intent: Mapping[str, Any] | None) -> str:
    """The letter staged in place of a draft that stated a house-only figure.

    It says what the order needs (the wine, the quantity and the target
    price, when the intent has them) and nothing the house keeps to itself.
    """
    intent = intent or {}
    wine = str(intent.get("wine_name") or "").strip()
    quantity = str(intent.get("quantity") or "").strip()
    target = _price(intent.get("target_price"))
    what = " of ".join(x for x in (quantity, wine) if x) or "an order"
    ask = f"We would like to order {what}"
    if target is not None:
        ask += f", at {target} per bottle if that works for you"
    return (
        f"Hello, {ask}. Could you confirm availability, price and the "
        f"earliest delivery date? Thank you."
    )
