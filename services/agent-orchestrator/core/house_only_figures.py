"""Withhold the house's price ceiling from a vendor-facing draft.

Scope: one house-only key, `max_acceptable_price`, read from the intent
passed to the drafting call. It is stripped from the prompt, and a draft
that states its exact figure (in the forms listed below) is replaced.

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
     built, so the intent in the prompt no longer carries the top-level
     `max_acceptable_price` key. The model can still meet the figure in
     memories or history.
  2. `withheld_figures_in` checks the drafted text for the ceiling figure in
     these forms: 1199, 1,199, 1.199, 1 199, 1'199 (also with U+2019, U+2018
     or U+02BC as the apostrophe), 1199.00 and 1.199,00, also when another
     number follows it in the same sentence ("$1,199. 6 bottles"). The text
     is normalised first: NFKC (so "1，199" with a full-width comma
     counts as "1,199"), then every format character (category Cf, e.g.
     zero-width space, word joiner, BOM, soft hyphen) is deleted, then every
     separator character (category Z: any Unicode space, and also the line
     and paragraph separators U+2028 and U+2029) is read as a plain space.
     The caller replaces a draft that holds it with
     `order_letter_without_ceiling`. A ceiling equal to the target is not
     withheld, because the target is the price the house means to propose.

Not covered: a figure in words ("eleven hundred"), a rounded one ("about
1,200", "1.2k"), a figure the model works out from others ("ten percent
over our target"), and shapes the tokenizer does not join: "1, 199", the
groups split by a tab or by a line break that is a control character (LF,
CR, U+0085: category Cc, not Z, so unlike U+2028 they are not read as a
space), "1_199", "1.199.00", "1 1 99", the figure run into other digits
("6,1199"), and the Arabic separators U+066C and U+066B.

An exact match is not proof of a leak: a quantity or a date can equal the
ceiling. That is why the replacement still says everything the order needs,
and why the drop is recorded in `constraint_flags.audit_trail` on the
conversation row (no screen reads that field yet).
"""

from __future__ import annotations

import re
import sys
import unicodedata
from typing import Any, Dict, List, Mapping

# Top-level intent keys that hold the house's own decision figures; they are
# kept out of the drafting prompt.
HOUSE_ONLY_INTENT_KEYS = frozenset({"max_acceptable_price"})

# Before matching, the text is normalised so that characters a reader does
# not see as separate from the digits cannot hide the figure:
#   1. NFKC normalisation, so compatibility forms fold to the plain ones
#      (the full-width comma U+FF0C becomes ",", full-width digits become
#      ASCII digits);
#   2. every format character (category Cf: zero-width space U+200B, word
#      joiner U+2060, BOM U+FEFF, soft hyphen U+00AD, the bidi marks and the
#      rest) is deleted, because it is invisible: "1<U+200B>199" shows as 1199;
#   3. every separator character (category Z: the space separators Zs, the
#      line separator U+2028 and the paragraph separator U+2029) becomes a
#      plain space. They are mapped, not deleted, so two figures side by side
#      stay two figures ("6 1199").
# Tab, \n, \r and U+0085 are control characters (Cc), not Z, and are left
# alone, so a figure split by them is not joined (disclosed in the docstring).


def _format_and_separator_table() -> Dict[int, str | None]:
    table: Dict[int, str | None] = {}
    for cp in range(sys.maxunicode + 1):
        cat = unicodedata.category(chr(cp))
        if cat == "Cf":
            table[cp] = None
        elif cat[0] == "Z" and cp != 0x20:
            table[cp] = " "
    return table


_FORMAT_AND_SEPARATORS = _format_and_separator_table()

# The apostrophes used for Swiss-style grouping: ', U+2019, U+2018, U+02BC.
_APOS = "'\u2019\u2018\u02bc"

# A number: digit runs joined by a single , . apostrophe or space (after the
# reading above). A separator must sit between digits, so a sentence's own
# comma or full stop ends the number ("$1,199. 6").
_NUMBER = re.compile(rf"\d+(?:[,.{_APOS} ]\d+)*")


def _as_the_vendor_sees_it(text: str) -> str:
    return unicodedata.normalize("NFKC", text).translate(_FORMAT_AND_SEPARATORS)


def vendor_safe_intent(intent: Mapping[str, Any] | None) -> Dict[str, Any]:
    """A copy of the intent without the keys the vendor must not see."""
    return {k: v for k, v in (intent or {}).items() if k not in HOUSE_ONLY_INTENT_KEYS}


def _as_number(value: Any) -> float | None:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


_EN = re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?")
_TR = re.compile(r"\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?")
_APOSTROPHE = re.compile(rf"\d{{1,3}}(?:[{_APOS}]\d{{3}})+(?:\.\d+)?")


def _plain_readings(token: str) -> List[float]:
    """Values of a token with no spaces, in English, Turkish or Swiss grouping.

    A separator counts as grouping only before exactly three digits, so
    "11,99" reads 11.99, not 1199.
    """
    out: List[float] = []
    if _EN.fullmatch(token):
        out.append(float(token.replace(",", "")))
    if _TR.fullmatch(token):
        out.append(float(token.replace(".", "").replace(",", ".")))
    if _APOSTROPHE.fullmatch(token):
        out.append(float(re.sub(rf"[{_APOS}]", "", token)))
    return out


def _readings(token: str) -> List[float]:
    """Every value the token could mean.

    A token with spaces may be one space-grouped figure ("1 199") or several
    figures side by side ("1 199 1 090"), so each run of up to six parts that
    starts with a one- to three-digit part is read.
    """
    parts = token.split(" ")
    if len(parts) == 1:
        return _plain_readings(token)
    out: List[float] = []
    for i in range(len(parts)):
        out.extend(_plain_readings(parts[i]))
        if not 1 <= len(parts[i]) <= 3 or not parts[i].isdigit():
            continue
        # Extend the run while each next part is a three-digit group (the last
        # may carry decimals), at most five groups: no ceiling is larger.
        value = float(parts[i])
        for group in parts[i + 1 : i + 6]:
            tail = re.fullmatch(r"(\d{3})[.,](\d+)", group)
            if tail:
                out.append(value * 1000 + float(f"{tail.group(1)}.{tail.group(2)}"))
                break
            if not (len(group) == 3 and group.isdigit()):
                break
            value = value * 1000 + int(group)
            out.append(value)
    return out


def withheld_figures_in(text: str, intent: Mapping[str, Any] | None) -> List[str]:
    """The house-only keys whose figure appears in `text` (empty when none).

    A key whose value equals the intent's target price is skipped: that
    figure is meant to be said.
    """
    if not text or not intent:
        return []
    target = _as_number(intent.get("target_price"))
    spaced = _as_the_vendor_sees_it(text)
    values = [_readings(m.group(0)) for m in _NUMBER.finditer(spaced)]
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

    It asks for a quote on what the order needs (the wine, the quantity and
    the target price, when the intent has them) and is built without the
    house-only keys. It is an inquiry, worded to stay clear of the commitment
    phrases in core/commitment_patterns.py. It is English only and names no
    currency, because the intent carries neither a language nor a currency.
    """
    intent = intent or {}
    wine = str(intent.get("wine_name") or "").strip()
    quantity = str(intent.get("quantity") or "").strip()
    target = _price(intent.get("target_price"))
    what = " of ".join(x for x in (quantity, wine) if x) or "our next order"
    target_line = f" Our target is {target} per bottle." if target is not None else ""
    return (
        f"Hello, could you quote us for {what}?{target_line} Please let us "
        f"know availability, price and the earliest delivery date. Thank you."
    )
