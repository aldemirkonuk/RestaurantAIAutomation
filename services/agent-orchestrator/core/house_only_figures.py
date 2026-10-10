"""Withhold the house's price ceiling from a vendor-facing draft.

Scope: one house-only key, `max_acceptable_price`, read from the intent
passed to the drafting call. It is stripped from the prompt, and a draft
that states its figure (in the forms listed below) is replaced.

A procurement intent carries `max_acceptable_price`, the house's ceiling.
The agent uses it only for its own accept test
(ProviderConversationAgent, "parsed_price <= max_acceptable"). It used to
reach the drafting prompt too, because the whole intent was json-dumped
into RESPONSE_SYSTEM_PROMPT's {intent_description}. On 2026-10-08 the F-106
production dry run found a waiting draft that told the vendor both the
target and the ceiling. That draft was never sent (found by PR #679).

There are two layers here:
  1. `vendor_safe_intent` removes the house-only keys before the prompt is
     built, so the intent in the prompt no longer carries the top-level
     `max_acceptable_price` key. The model can still meet the figure in
     memories or history.
  2. `withheld_figures_in` checks the drafted text for the ceiling figure in
     these forms: 1199, 1,199, 1.199, 1 199, 1'199 (also with U+2019, U+2018
     or U+02BC as the apostrophe), 1·199 (also with U+2027 or U+30FB as the
     dot), 1199.00 and 1.199,00, also when another number follows it in the
     same sentence ("$1,199. 6 bottles"). A ceiling with a part below the
     cent is also found cut to the cent and rounded half-up to the cent
     (13.607 is found as 13.607, 13.60 and 13.61). The text is normalised
     first, as described at `_normalised`. The caller replaces a draft that
     holds it with `order_letter_without_ceiling`. A form of the ceiling
     (the ceiling itself, or its cut or rounded cent form) that equals the
     target (`target_price`, or `target_price_per_bottle` when that is not a
     positive number) is not looked
     for, because the target is the price the house means to propose.

The ceiling is read from a number, or from a string holding one figure,
optionally with one currency symbol (category Sc) or three ASCII letters
("EUR") before or after it: "1199", "1,199", "$1,199.00", "1.199,00 EUR".
A string that can be read two ways ("1,199" is 1199 or 1.199) is looked
for in both readings. An int or float ceiling of zero or less is
treated as unset, without a warning: the gateway writers send
`(price || 0) * 1.1`, so 0 is their "no price". A ceiling that is set but
cannot be read (NaN, infinity, a bool, a string that holds no positive
figure such as "n/a" or "0", or a string longer than 64 characters after
normalising) is logged as a warning and nothing is looked for.

Not covered: a figure in words ("eleven hundred"), a rounded one ("about
1,200", "1.2k"), one cut or rounded to whole units (13 for 13.60), a figure
the model works out from others ("ten percent over our target"), and
shapes the tokenizer does not join: "1, 199", the groups split by a
whitespace control character (tab, LF, VT, FF, CR, U+001C to U+001F,
U+0085: category Cc, so unlike U+2028 they are not read as a space), the
groups split by a hyphen or minus ("1-199", U+2010, U+2011, U+2212), "1_199",
"1.199.00", "1 1 99", the figure run into other digits ("6,1199"), the
Arabic separators U+066C and U+066B, and any other character between the
groups that `_normalised` neither deletes nor maps, including characters
some fonts draw blank whose category is Lo, So, Mc, Co, Cn or Cs (other
than the five fillers it deletes).

An exact match is not proof of a leak: a quantity or a date can equal the
ceiling. That is why the replacement asks for a quote on the wine, the
quantity and the target price (when the intent has them) and for
availability, price and the earliest delivery date, and why the drop is
recorded in `constraint_flags.audit_trail` on the conversation row (no
screen reads that field yet).
"""

from __future__ import annotations

import logging
import math
import re
import unicodedata
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any, Dict, List, Mapping

logger = logging.getLogger(__name__)

# Top-level intent keys that hold the house's own decision figures; they are
# kept out of the drafting prompt.
HOUSE_ONLY_INTENT_KEYS = frozenset({"max_acceptable_price"})

# Before matching, `_normalised` rewrites the text:
#   1. NFKC, so compatibility forms fold to the plain ones (the full-width
#      comma U+FF0C becomes ",", full-width digits become ASCII digits, the
#      half-width katakana middle dot U+FF65 becomes U+30FB);
#   2. these are deleted: every format character (category Cf, e.g. U+200B,
#      U+2060, U+FEFF, U+00AD), every combining mark (Mn and Me, e.g.
#      U+0300, U+034F, U+17B4, the variation selectors U+FE00-U+FE0F), every
#      control character that is not whitespace (Cc, e.g. U+0000, U+007F),
#      and five blank fillers: U+115F, U+1160, U+3164, U+FFA0 (Lo) and
#      U+2800 (So). So "1<U+200B>199" and "1<U+FE0F>199" read 1199;
#   3. every separator character (category Z: the space separators Zs,
#      U+2028 and U+2029) becomes a plain space. They are mapped, not
#      deleted, so two figures side by side stay two figures ("6 1199");
#   4. the middle dots U+00B7, U+2027 and U+30FB become ".", so they group
#      digits as "." does ("1\u00b7199" reads 1199 and 1.199).
# The whitespace controls (tab, LF, VT, FF, CR, U+001C-U+001F, U+0085), the
# hyphens and every other character are left alone, so a figure split by
# them is not joined.

_BLANK_FILLERS = (0x115F, 0x1160, 0x3164, 0xFFA0, 0x2800)
_MIDDLE_DOTS = (0x00B7, 0x2027, 0x30FB)

# Outside these ranges, in the Unicode version this was written against
# (14.0, Python 3.11), there is no character of category Cf, Mn, Me, Cc, Z
# or Sc, so the build below walks only these ranges (about 200k code points
# instead of 1.1M). `test_no_character_the_build_reads_lies_outside_the_walk`
# walks every code point to check that for the Unicode version in use.
_WALKED = ((0x0, 0x30000), (0xE0000, 0xE1000))


def _deleted(cp: int, cat: str) -> bool:
    if cat in ("Cf", "Mn", "Me"):
        return True
    return cat == "Cc" and not chr(cp).isspace()


def _build() -> tuple[Dict[int, str | None], str]:
    """The reading table for `_normalised`, and every currency symbol."""
    table: Dict[int, str | None] = {}
    currency: List[str] = []
    for start, stop in _WALKED:
        for cp in range(start, stop):
            cat = unicodedata.category(chr(cp))
            if _deleted(cp, cat):
                table[cp] = None
            elif cat[0] == "Z" and cp != 0x20:
                table[cp] = " "
            elif cat == "Sc":
                currency.append(chr(cp))
    for cp in _BLANK_FILLERS:
        table[cp] = None
    for cp in _MIDDLE_DOTS:
        table[cp] = "."
    return table, "".join(currency)


_READING, _CURRENCY = _build()

# The apostrophes used for Swiss-style grouping: ', U+2019, U+2018, U+02BC.
_APOS = "'\u2019\u2018\u02bc"

# A number: digit runs joined by a single , . apostrophe or space (after the
# reading above). A separator must sit between digits, so a sentence's own
# comma or full stop ends the number ("$1,199. 6").
_NUMBER = re.compile(rf"\d+(?:[,.{_APOS} ]\d+)*")


def _normalised(text: str) -> str:
    return unicodedata.normalize("NFKC", text).translate(_READING)


def vendor_safe_intent(intent: Mapping[str, Any] | None) -> Dict[str, Any]:
    """A copy of the intent without the keys the vendor must not see."""
    return {k: v for k, v in (intent or {}).items() if k not in HOUSE_ONLY_INTENT_KEYS}


def _as_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) and n > 0 else None


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


# A ceiling string: one figure, with an optional currency symbol or three
# ASCII letters before or after it ("$1,199", "1.199,00 EUR").
_AFFIX = rf"(?:[{re.escape(_CURRENCY)}]|[A-Za-z]{{3}})?"
_CEILING_TEXT = re.compile(
    rf"\s*{_AFFIX}\s*(?P<n>\d[\d,.{_APOS} ]*\d|\d)\s*{_AFFIX}\s*"
)
_SPACE_GROUPED = re.compile(r"\d{1,3}(?: \d{3})+(?:[.,]\d+)?")
# _CEILING_TEXT backtracks cubically on a long run of spaces around a digit
# (about 10 s at 3,200 characters), so a longer ceiling string is unreadable.
_CEILING_TEXT_MAX = 64


def _is_unset_number(value: Any) -> bool:
    """A numeric ceiling of zero or less: the producers' "no price".

    The gateway writers send `(price || 0) * 1.1`, so an intent without a
    price carries a ceiling of 0. That is treated as unset, without a warning.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return math.isfinite(value) and value <= 0


def _ceiling_values(value: Any) -> List[float]:
    """Every value the ceiling may be, or [] when it is unset or unreadable."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return []
    if _is_unset_number(value):
        return []
    if isinstance(value, str):
        text = _normalised(value)
        m = _CEILING_TEXT.fullmatch(text) if len(text) <= _CEILING_TEXT_MAX else None
        token = m.group("n") if m else ""
        if _SPACE_GROUPED.fullmatch(token):
            token = token.replace(" ", "")
        found = sorted({v for v in _plain_readings(token) if v > 0})
    else:
        n = _as_number(value)
        found = [n] if n is not None else []
    if not found:
        logger.warning(
            "house_only_figures: a set ceiling could not be read as a figure "
            "(%r); nothing is withheld for it",
            type(value).__name__,
        )
    return found


def _ceiling_forms(ceiling: float) -> List[float]:
    """The ceiling, cut to the cent and rounded half-up to the cent.

    A ceiling too large to hold to the cent in 28 significant digits is
    looked for as it is.
    """
    cent = Decimal("0.01")
    try:
        d = Decimal(repr(ceiling))
        forms = {
            float(d.quantize(cent, ROUND_DOWN)),
            float(d.quantize(cent, ROUND_HALF_UP)),
        }
    except InvalidOperation:
        return [ceiling]
    return [ceiling, *sorted(forms - {ceiling})]


def withheld_figures_in(text: str, intent: Mapping[str, Any] | None) -> List[str]:
    """The house-only keys whose figure appears in `text` (empty when none).

    A form of the ceiling that equals the intent's target price is skipped:
    that figure is meant to be said. The target is `target_price`, or
    `target_price_per_bottle` when `target_price` is not a positive number.
    """
    if not text or not intent:
        return []
    target = _as_number(intent.get("target_price"))
    if target is None:
        target = _as_number(intent.get("target_price_per_bottle"))
    spaced = _normalised(text)
    values = [v for m in _NUMBER.finditer(spaced) for v in _readings(m.group(0))]
    hits: List[str] = []
    for key in sorted(HOUSE_ONLY_INTENT_KEYS):
        forms = [
            f
            for ceiling in _ceiling_values(intent.get(key))
            for f in _ceiling_forms(ceiling)
            if target is None or abs(f - target) >= 0.005
        ]
        if any(abs(v - f) < 0.005 for v in values for f in forms):
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
    quantity = intent.get("quantity")
    if isinstance(quantity, float) and quantity.is_integer():
        quantity = int(quantity)  # 6.0 is written as 6
    quantity = str(quantity or "").strip()
    target = _price(intent.get("target_price"))
    what = " of ".join(x for x in (quantity, wine) if x) or "our next order"
    target_line = f" Our target is {target} per bottle." if target is not None else ""
    return (
        f"Hello, could you quote us for {what}?{target_line} Please let us "
        f"know availability, price and the earliest delivery date. Thank you."
    )
