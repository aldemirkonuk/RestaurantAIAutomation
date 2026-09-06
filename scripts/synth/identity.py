"""The library's wine identity, mirrored so the seed can collapse before it inserts.

`master_wine_library` recomputes `signature_hash` on every insert through
`trg_sync_signature_hash` → `wine_signature_hash(producer, name, vintage, country,
region, grape_variety)`, and a UNIQUE index sits on the result. The synth seed
(2026-07-27) predates that rule: it inserted one provisional wine per *menu line
hash* (an md5 of the crawled row), so two menu lines the library considers the
same wine — same six fields, different price or section — collided inside one
transaction and the whole seed rolled back (measured 2026-09-03: the bistro menu's
92 line hashes are 66 library identities).

This module is a line-for-line mirror of the two SQL functions, read from
production on 2026-09-03. `scripts/test_synth_identity.py` pins it against
outputs the SQL functions produced, and `seed.py` re-checks every planned wine
against the SQL function at apply time and refuses to seed on any drift — the
same lockstep discipline `scripts/simulate/hours.py` uses for its fixture.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata

#: Mirrors the character class in wine_normalize_text(): combining diacritical
#: marks (four Unicode blocks) plus the spacing accents and modifier letters the
#: SQL lists explicitly. Change both together — the SQL comment says the same.
_DIACRITICS = re.compile("[̀-ͯ᪰-᫿᷀-᷿︠-︯" "^`¨¯´·¸ʰ-˿ʹ͵ͺ΄΅]")

#: The abbreviation expansions, in the SQL's order. `\m` in Postgres is "start of
#: word"; `\b(?=\w)` is the same boundary in Python's `re`.
_EXPANSIONS: tuple[tuple[re.Pattern[str], str], ...] = tuple(
    (re.compile(r"\b(?=\w)" + pat), rep)
    for pat, rep in (
        (r"az\.\s*agr\.\s*", "azienda agricola "),
        (r"dom\.\s*", "domaine "),
        (r"ch\.\s*", "chateau "),
        (r"cht\.\s*", "chateau "),
        (r"bod\.\s*", "bodegas "),
        (r"wgt\.\s*", "weingut "),
        (r"ten\.\s*", "tenuta "),
        (r"fatt\.\s*", "fattoria "),
        (r"cant\.\s*", "cantina "),
        (r"march\.\s*", "marchesi "),
        (r"ste\.\s*", "sainte "),
        (r"st\.\s*", "saint "),
        (r"mt\.\s*", "monte "),
    )
)
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def wine_normalize_text(value: str | None) -> str:
    """Mirror of public.wine_normalize_text(text)."""
    s = unicodedata.normalize("NFD", value or "")
    s = _DIACRITICS.sub("", s)
    s = s.lower()
    for pat, rep in _EXPANSIONS:
        s = pat.sub(rep, s)
    s = _NON_ALNUM.sub(" ", s)
    return s.strip()


def wine_signature_hash(
    producer: str | None,
    name: str | None,
    vintage: int | str | None,
    country: str | None,
    region: str | None,
    grape_variety: str | None,
) -> str:
    """Mirror of public.wine_signature_hash(...) — sha256 hex over the six fields."""
    vintage_txt = "NV" if vintage is None or vintage == "" else str(int(vintage))
    joined = "|".join(
        [
            wine_normalize_text(producer),
            wine_normalize_text(name),
            vintage_txt,
            wine_normalize_text(country),
            wine_normalize_text(region),
            wine_normalize_text(grape_variety),
        ]
    )
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


def wine_signature_for_item(item: dict) -> str:
    """The library identity of one menu-snapshot line (datasets/sim/menus/*.json)."""
    return wine_signature_hash(
        item.get("producer"),
        item.get("wine_name"),
        item.get("vintage"),
        item.get("country"),
        item.get("region"),
        item.get("grape_variety"),
    )


#: The venue segment that separates a venue-scoped key from a shared one.
#: Mirrors PROVISIONAL_SIGNATURE_PREFIX in
#: apps/api-gateway/src/wines/wine-signature.ts and the literal in
#: public.wine_provisional_signature_hash. Disjoint from any shared key by
#: construction: a shared key's first segment is wine_normalize_text(producer),
#: whose output alphabet is [a-z0-9 ] and can never contain a colon.
PROVISIONAL_PREFIX = "venue:"


def wine_identity_is_specific(
    producer: str | None,
    name: str | None,
    vintage: int | str | None,
    region: str | None,
) -> bool:
    """Mirror of public.wine_identity_is_specific(...) — ADR 0130.

    An identity may join the SHARED library only when it carries a name plus
    EITHER a producer, OR a vintage and a region. A bare "House White Wine" is
    a menu section, and on 2026-09-04 one venue's menu section auto-linked to
    another venue's 2023 California wine at confidence 90.

    `vintage` is judged the way Postgres sees it: the resolver reaches the SQL
    through `parseInt(...) || null`, so anything that is not a number is NULL
    there and must be absent here.
    """
    if wine_normalize_text(name) == "":
        return False
    if wine_normalize_text(producer) != "":
        return True
    return _vintage_or_none(vintage) is not None and wine_normalize_text(region) != ""


def _vintage_or_none(value: int | str | None) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def wine_provisional_signature_hash(
    restaurant_id: str,
    producer: str | None,
    name: str | None,
    vintage: int | str | None,
    country: str | None,
    region: str | None,
    grape_variety: str | None,
) -> str:
    """Mirror of public.wine_provisional_signature_hash(...) — ADR 0130.

    The identity of one venue's own provisional wine: the same six-field key,
    behind a "venue:<id>|" segment, so two venues printing the same generic
    words occupy two rows under the UNIQUE index instead of colliding on one.
    """
    vintage_txt = "NV" if vintage is None or vintage == "" else str(int(vintage))
    joined = "|".join(
        [
            wine_normalize_text(producer),
            wine_normalize_text(name),
            vintage_txt,
            wine_normalize_text(country),
            wine_normalize_text(region),
            wine_normalize_text(grape_variety),
        ]
    )
    return hashlib.sha256(
        f"{PROVISIONAL_PREFIX}{restaurant_id}|{joined}".encode("utf-8")
    ).hexdigest()
