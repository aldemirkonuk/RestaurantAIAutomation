"""The one row a reviewed submission becomes in ``master_wine_library``.

Three paths promote a submission into the shared library: the Wine Studio
auto path (``override_service._maybe_promote_submission``), the Studio's
manual "Promote" button (``studio_routes.promote_to_library``) and the review
queue (``quality_routes.patch_review_queue``). Until 2026-11-07 all three built
their own row, and every one of them named columns no migration has ever
created (``restaurant_id``, ``submission_id``, ``wine_type``, ``color``,
``alcohol_pct``, ``avg_price``, ``price``, ``promoted_by`` ...). PostgREST
refused every such insert, and none of them sent ``wine_id``, which is
``NOT NULL`` with no default. So no reviewed wine ever reached the library by
these paths -- and the auto path swallowed the error and still answered
"auto_promoted".

This module builds the row from the table's real columns only
(``supabase/migrations/20260805000000_baseline_from_production.sql`` plus every
later ALTER; ``tests/test_library_promotion_columns.py`` replays them and
fails if a key here is not a column) and reports what happened as one of four
outcomes, so a caller can never say "added" when nothing was.

What each dropped column became, decided per column (the session's call
under the 2026-11-07 /goal, recorded in the PR):

  wine_type / color   -> ``primary_type`` (NOT NULL). primary_type first, then
                         color, then the vocabulary member ``"unknown"`` -- the
                         same word the gateway's menu import writes for
                         "unclassified" (wine-submissions.service.ts).
  submission_id       -> not on the library row. The link is written the other
                         way, to ``master_wine_library_submissions.matched_master_id``,
                         the column the rest of the product already reads.
  restaurant_id, avg_price / price, price_glass, section_name, bin_number
                      -> dropped. The library is SHARED; one house's menu
                         prices and cellar bins would become every house's
                         reference data (QA H-4). They stay on the submission.
  alcohol_pct         -> dropped, NOT mapped to ``abv_percent``. That column is
                         "typed by a person" with a required author
                         (20260906120000_a_strength_is_stated_by_a_person); an
                         enrichment value is not a person's statement.
  sweetness_level, tasting_notes, description, food_pairing
                      -> dropped. No column holds them; they stay on the
                         submission's field_confidence, reachable through
                         matched_master_id.
  ai_enriched, enrichment_source
                      -> dropped. Submission-only columns
                         (20261116101500_the_enrich_chain_gets_the_columns_it_writes);
                         ``source`` already says which path promoted the row.
  promoted_by, promoted_at
                      -> dropped. No column; the server log keeps who and when.
  grape_family        -> the library column is varchar(100) while the
                         submission's is the Haiku object; the object's
                         ``family`` string is written, anything else is NULL.
  vintage             -> integer column: a four-digit year or NULL ("NV" and
                         unreadable vintages are NULL, never a 500).
  wine_id             -> generated, same shape as the gateway's
                         ``generateWineId`` (``WINE_`` + base36, <= 20 chars).
"""

from __future__ import annotations

import logging
import random
import string
import time
import uuid
from typing import Any, Callable, Dict, Optional, Tuple

from services.field_confidence import JSONB_ENRICHMENT_KEYS

logger = logging.getLogger(__name__)

# Outcomes. A caller turns these into words; it never turns FAILED into "added".
PROMOTED = "promoted"
NOT_READY = "not_ready"
ALREADY_IN_LIBRARY = "already_in_library"
FAILED = "failed"

# What the contributor reads for each outcome that needs saying.
OUTCOME_WORDS: Dict[str, str] = {
    PROMOTED: "Added to the wine library.",
    ALREADY_IN_LIBRARY: "This wine is already in the wine library.",
    FAILED: (
        "Your change is saved, but the wine could not be added to the wine "
        "library. Nothing was added. Try again, or tell a reviewer."
    ),
}

# The text fields copied straight across, source field name -> library column.
_TEXT_FIELDS: Dict[str, str] = {
    "wine_name": "name",
    "producer": "producer",
    "region": "region",
    "sub_region": "sub_region",
    "appellation": "appellation",
    "country": "country",
    "grape_variety": "grape_variety",
    "producer_bio": "producer_bio",
}

# grape_family is the one JSONB enrichment key whose library column is text.
_JSONB_LIBRARY_COLUMNS = tuple(k for k in JSONB_ENRICHMENT_KEYS if k != "grape_family")


def generate_wine_id() -> str:
    """``WINE_`` + base36 time + random suffix, at most 20 characters."""
    alphabet = string.digits + string.ascii_lowercase
    n, stamp = int(time.time() * 1000), ""
    while n:
        n, r = divmod(n, 36)
        stamp = alphabet[r] + stamp
    suffix = "".join(random.choices(alphabet, k=6))
    return f"WINE_{stamp[-8:]}{suffix}"[:20]


def _text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def parse_vintage(value: Any) -> Optional[int]:
    """A four-digit year, or None. ``"NV"``, ``""`` and junk are None."""
    if value is None or isinstance(value, bool):
        return None
    try:
        year = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return year if 1000 <= year <= 9999 else None


def _grape_family(value: Any) -> Optional[str]:
    if isinstance(value, dict):
        value = value.get("family")
    text = _text(value) if isinstance(value, str) else None
    return text if text and len(text) <= 100 else None


def build_library_row(
    value_of: Callable[[str], Any], submission: Dict[str, Any], source: str
) -> Dict[str, Any]:
    """The insert for ``master_wine_library``, real columns only.

    ``value_of(field)`` returns the reviewed value of a submission field
    (field_confidence first, as each caller already decides). ``submission``
    supplies the JSONB enrichment columns.
    """
    row: Dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "wine_id": generate_wine_id(),
        "source": source,
        "vintage": parse_vintage(value_of("vintage")),
        "primary_type": _text(value_of("primary_type"))
        or _text(value_of("color"))
        or "unknown",
    }
    for field, column in _TEXT_FIELDS.items():
        row[column] = _text(value_of(field))
    for key in _JSONB_LIBRARY_COLUMNS:
        value = submission.get(key)
        row[key] = value if isinstance(value, (dict, list)) and value else None
    row["grape_family"] = _grape_family(submission.get("grape_family"))
    return row


def _is_unique_violation(exc: Exception) -> bool:
    code = getattr(exc, "code", None)
    if code == "23505":
        return True
    text = str(exc)
    return "23505" in text or "duplicate key value" in text


def insert_library_row(supabase, row: Dict[str, Any]) -> Tuple[str, Optional[str]]:
    """Insert ``row``; return ``(outcome, library_id)``.

    PROMOTED with the new id, ALREADY_IN_LIBRARY when the identity's
    signature_hash is taken (the unique index decides, not a pre-check), or
    FAILED. Never raises.
    """
    try:
        resp = supabase.table("master_wine_library").insert(row).execute()
    except Exception as exc:  # noqa: BLE001 -- the outcome carries it
        if _is_unique_violation(exc):
            return ALREADY_IN_LIBRARY, None
        logger.error(
            "master_wine_library insert failed (source=%s): %s", row.get("source"), exc
        )
        return FAILED, None
    data = getattr(resp, "data", None)
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return PROMOTED, data[0].get("id") or row["id"]
    return PROMOTED, row["id"]
