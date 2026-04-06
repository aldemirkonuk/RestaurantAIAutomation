"""
Producer Name Normalization
===========================
Converts Unicode producer names to stable, deterministic slug keys.
Used as the primary lookup key in the producers knowledge graph table.

Why deterministic normalization over fuzzy matching:
  - For a DB key lookup, exact match after normalization is correct and fast.
  - Edit distance / embedding similarity would produce false matches.
  - Pattern: unidecode(name).lower() -> strip non-alphanumeric -> collapse with hyphens

Examples:
  "Chateau Muller-Catoir"          -> "chateau-muller-catoir"
  "Domaine de la Romanee-Conti"    -> "domaine-de-la-romanee-conti"
  "DRC"                            -> "drc"
  "J. Lohr"                        -> "j-lohr"
  "Antinori"                       -> "antinori"
  ""                               -> ""
  None                             -> ""
"""

import re
from typing import Optional

from unidecode import unidecode


def normalize_producer_name(name: Optional[str]) -> str:
    """
    Normalize a producer name to a stable lookup key.

    Steps:
      1. Transliterate Unicode to ASCII (Chateau, Muller)
      2. Lowercase
      3. Replace non-alphanumeric chars (including spaces) with hyphens
      4. Collapse consecutive hyphens into one
      5. Strip leading/trailing hyphens

    Args:
        name: Raw producer name string, or None.

    Returns:
        Normalized slug string. Returns "" for None or empty input.
    """
    if not name:
        return ""
    text = unidecode(name)
    text = text.lower()
    text = re.sub(r"[^\w]+", "-", text)
    text = text.strip("-")
    return text


def build_search_query(
    producer: Optional[str],
    wine_name: Optional[str],
    vintage: Optional[str],
) -> str:
    """
    Construct the Serper search query for a wine per WSRCH-01 spec.

    Format: "{producer} {wine_name} {vintage}"
    Empty/None parts are omitted. At least wine_name should be present.

    Args:
        producer:   Producer/winery name (may be None for unknown producers).
        wine_name:  Wine name as extracted by Claude Vision.
        vintage:    Vintage year as string (e.g. "2019"), or None for NV wines.

    Returns:
        Search query string, e.g. "Domaine Leflaive Puligny-Montrachet 2019"

    Examples:
        build_search_query("Domaine Leflaive", "Puligny-Montrachet", "2019")
            returns "Domaine Leflaive Puligny-Montrachet 2019"
        build_search_query(None, "Barolo Riserva", "2018")
            returns "Barolo Riserva 2018"
        build_search_query("DRC", "Romanee-Conti", None)
            returns "DRC Romanee-Conti"
    """
    parts = []
    if producer:
        parts.append(producer.strip())
    if wine_name:
        parts.append(wine_name.strip())
    if vintage:
        parts.append(str(vintage).strip())
    return " ".join(parts)
