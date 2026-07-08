"""
Dataset Ingestion Service
==========================
Phase 10 (D-02): Enriches master_wine_library wines with metadata from curated dataset files.

Sources (auto-discovered via glob):
  - library/*.jsonl    (wineops_basic_v1.jsonl, restaurant_wine_dataset.jsonl)
  - External_Wine_Datasets/*.csv   (WineDataset.csv)

Enriches: wine_structure, sensory_profile, quality_signals JSONB columns ONLY.
NOT pricing data (D-02b).

Non-destructive rule (D-02, RESEARCH.md §Open Questions):
  Only writes to empty JSONB columns ({} or None).
  Existing Haiku/Phase7 enrichment is preserved.

Match key: fuzzy match on (name, producer, vintage, appellation) — SequenceMatcher ratio >= 0.85.
Write threshold: >= 2 of 4 fields must match. CSV rows (no producer) use 3-field key.
"""

import csv
import glob
import json
import logging
import os
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Dict, List, Optional

from supabase import create_client

from config.settings import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# ---------------------------------------------------------------------------
# Project root — resolve relative to this file's location.
# This file: services/agent-orchestrator/services/dataset_ingestion_service.py
# Project root: 4 levels up (services/agent-orchestrator/services/ → services/agent-orchestrator/
#               → services/ → project root)
# ---------------------------------------------------------------------------
_PROJECT_ROOT = Path(__file__).resolve().parents[3]

DATASET_SOURCES = [
    {"glob": str(_PROJECT_ROOT / "library" / "*.jsonl"), "format": "jsonl"},
    {"glob": str(_PROJECT_ROOT / "External_Wine_Datasets" / "*.csv"), "format": "csv"},
]

# Fuzzy match threshold — SequenceMatcher ratio must meet this to count a field as matching
MATCH_THRESHOLD: float = 0.85
# Minimum matching fields required to write enrichment (D-02c)
MIN_MATCH_COUNT: int = 2


def _get_supabase_client():
    return create_client(settings.supabase_url, settings.supabase_key)


# ---------------------------------------------------------------------------
# Fuzzy matching helpers
# ---------------------------------------------------------------------------


def _field_match(
    a: Optional[str], b: Optional[str], threshold: float = MATCH_THRESHOLD
) -> bool:
    """Return True if two strings fuzzy-match above threshold. Handles None/empty."""
    if not a or not b:
        return False
    return (
        SequenceMatcher(None, str(a).lower().strip(), str(b).lower().strip()).ratio()
        >= threshold
    )


def wine_matches(library_wine: Dict[str, Any], db_wine: Dict[str, Any]) -> int:
    """
    Count matching fields between a library/dataset record and a DB wine row.
    Returns int count (0-4). Write if >= MIN_MATCH_COUNT.

    Match fields: name, producer, vintage, appellation.
    CSV rows have no 'producer' — producer match is skipped if library_wine['producer'] is None.
    """
    match_count = 0

    if _field_match(library_wine.get("name"), db_wine.get("name")):
        match_count += 1

    # Producer: skip entirely if library wine has no producer (CSV rows)
    lib_producer = library_wine.get("producer")
    if lib_producer and _field_match(lib_producer, db_wine.get("producer")):
        match_count += 1

    # Vintage: exact integer/string equality (int vs str normalised via str())
    lib_vintage = library_wine.get("vintage")
    db_vintage = db_wine.get("vintage")
    if lib_vintage is not None and db_vintage is not None:
        if str(lib_vintage) == str(db_vintage):
            match_count += 1

    # Appellation
    if _field_match(library_wine.get("appellation"), db_wine.get("appellation")):
        match_count += 1

    return match_count


# ---------------------------------------------------------------------------
# File discovery
# ---------------------------------------------------------------------------


def discover_datasets() -> List[Dict[str, str]]:
    """
    Return list of discovered dataset files.
    Uses glob patterns relative to project root. Skips missing files gracefully.
    Each entry: {"path": str, "format": "jsonl"|"csv"}
    """
    discovered = []
    for source in DATASET_SOURCES:
        matches = glob.glob(source["glob"])
        for path in sorted(matches):
            if os.path.isfile(path):
                discovered.append({"path": path, "format": source["format"]})
                logger.debug("discover_datasets: found %s (%s)", path, source["format"])
    logger.info("discover_datasets: found %d dataset files", len(discovered))
    return discovered


# ---------------------------------------------------------------------------
# Record extraction from source formats
# ---------------------------------------------------------------------------


def _extract_jsonl_records(path: str) -> List[Dict[str, Any]]:
    """Read JSONL file and return list of normalised wine dicts."""
    records = []
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line_num, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                    classification = record.get("classification", {})
                    normalised = {
                        "name": record.get("name"),
                        "producer": record.get("producer"),
                        "vintage": record.get("vintage"),
                        "appellation": classification.get("appellation"),
                        "country": classification.get("country"),
                        "region": classification.get("region"),
                        # Enrichment payloads (unmapped — passed through JSONL mapper)
                        "_wine_structure": record.get("wine_structure", {}),
                        "_sensory_profile": record.get("sensory_profile", {}),
                        "_quality_signals": record.get("quality_signals", {}),
                    }
                    records.append(normalised)
                except json.JSONDecodeError as e:
                    logger.warning(
                        "_extract_jsonl_records: line %d parse error in %s: %s",
                        line_num,
                        path,
                        e,
                    )
    except OSError as e:
        logger.warning("_extract_jsonl_records: cannot read %s: %s", path, e)
    return records


def _extract_csv_records(path: str) -> List[Dict[str, Any]]:
    """Read WineDataset.csv and return list of normalised wine dicts (no producer field)."""
    records = []
    try:
        with open(path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                name = row.get("Title", "").strip()
                if not name:
                    continue
                characteristics = row.get("Characteristics", "").strip()
                style = row.get("Style", "").strip()
                # Build pre-mapped enrichment patches from CSV columns
                wine_structure_patch: Dict[str, Any] = {}
                if style:
                    wine_structure_patch["style"] = style
                sensory_profile_patch: Dict[str, Any] = {}
                if characteristics:
                    sensory_profile_patch["characteristics_raw"] = characteristics
                records.append(
                    {
                        "name": name,
                        "producer": None,  # CSV has no producer column (Pitfall 7)
                        "vintage": row.get("Vintage", "").strip() or None,
                        "appellation": row.get("Appellation", "").strip() or None,
                        "country": row.get("Country", "").strip() or None,
                        "region": row.get("Region", "").strip() or None,
                        # CSV patches are already in target schema format — skip JSONL mapper
                        "_wine_structure": wine_structure_patch,
                        "_sensory_profile": sensory_profile_patch,
                        "_quality_signals": {},
                    }
                )
    except OSError as e:
        logger.warning("_extract_csv_records: cannot read %s: %s", path, e)
    return records


# ---------------------------------------------------------------------------
# JSONB field mappers (JSONL source → master_wine_library schema)
# ---------------------------------------------------------------------------


def _map_jsonl_wine_structure(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Map JSONL wine_structure keys to master_wine_library JSONB schema."""
    mapped: Dict[str, Any] = {}
    if raw.get("body"):
        mapped["body"] = raw["body"]
    if raw.get("acidity"):
        mapped["acidity"] = raw["acidity"]
    if raw.get("tannins"):
        mapped["tannin"] = raw["tannins"]  # key rename: tannins → tannin
    if raw.get("finish"):
        mapped["finish"] = raw["finish"]
    if raw.get("alcohol_pct") is not None:
        mapped["alcohol_pct"] = raw["alcohol_pct"]
    return mapped


def _map_jsonl_sensory_profile(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Map JSONL sensory_profile keys to master_wine_library JSONB schema."""
    mapped: Dict[str, Any] = {}
    if raw.get("primary_aromas"):
        mapped["aromas"] = raw["primary_aromas"]
    if raw.get("flavor_profile"):
        mapped["palate"] = raw["flavor_profile"]
    if raw.get("flavor_intensity"):
        mapped["flavor_intensity"] = raw["flavor_intensity"]
    return mapped


def _build_enrichment_payload(library_record: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build the {wine_structure, sensory_profile, quality_signals} enrichment payload.

    Detection: CSV records store pre-mapped patches (style/characteristics_raw keys);
    JSONL records carry raw JSONL keys (body/acidity/tannins) that need mapping.
    """
    raw_ws = library_record.get("_wine_structure", {})
    raw_sp = library_record.get("_sensory_profile", {})
    raw_qs = library_record.get("_quality_signals", {})

    # Detect format: CSV patches have style/characteristics_raw; JSONL has body/acidity/tannins
    is_csv = "style" in raw_ws or "characteristics_raw" in raw_sp
    if is_csv:
        return {
            "wine_structure": raw_ws,
            "sensory_profile": raw_sp,
            "quality_signals": raw_qs,
        }

    return {
        "wine_structure": _map_jsonl_wine_structure(raw_ws),
        "sensory_profile": _map_jsonl_sensory_profile(raw_sp),
        "quality_signals": {
            k: v
            for k, v in {
                "quality_level": raw_qs.get("quality_level"),
                "producer_tier": raw_qs.get("producer_tier"),
                "awards_ratings": raw_qs.get("awards_ratings", []),
                "appellation_class": raw_qs.get("appellation_class"),
            }.items()
            if v is not None
        },
    }


# ---------------------------------------------------------------------------
# Main service class
# ---------------------------------------------------------------------------


class DatasetIngestionService:
    """
    Phase 10 (D-02): Dataset ingestion pipeline for wine metadata enrichment.

    Reads library/*.jsonl and External_Wine_Datasets/*.csv.
    Fuzzy-matches each record to master_wine_library by (name, producer, vintage, appellation).
    Non-destructively writes wine_structure, sensory_profile, quality_signals JSONB columns.
    """

    def discover_datasets(self) -> List[Dict[str, str]]:
        return discover_datasets()

    def enrich_wine(self, wine_id: str) -> Dict[str, Any]:
        """
        Main entry point: fetch wine from DB, scan all datasets, write best-matching enrichment.

        Returns:
            {"wine_id": wine_id, "status": "enriched"|"not_found"|"skipped"|"no_match",
             "datasets_scanned": int, "fields_written": list}
        """
        supabase = _get_supabase_client()

        # Fetch wine record from master_wine_library
        resp = (
            supabase.table("master_wine_library")
            .select(
                "id, name, producer, vintage, appellation, wine_structure, sensory_profile, quality_signals"
            )
            .eq("id", wine_id)
            .maybe_single()
            .execute()
        )
        if not resp.data:
            logger.warning(
                "DatasetIngestionService.enrich_wine: wine_id=%s not found", wine_id
            )
            return {"wine_id": wine_id, "status": "not_found"}

        db_wine = resp.data
        dataset_files = self.discover_datasets()

        if not dataset_files:
            logger.info(
                "DatasetIngestionService.enrich_wine: no dataset files found — skipping wine_id=%s",
                wine_id,
            )
            return {
                "wine_id": wine_id,
                "status": "skipped",
                "reason": "no_dataset_files",
            }

        best_match: Optional[Dict[str, Any]] = None
        best_count = 0

        for dataset_file in dataset_files:
            fmt = dataset_file["format"]
            path = dataset_file["path"]
            if fmt == "jsonl":
                records = _extract_jsonl_records(path)
            elif fmt == "csv":
                records = _extract_csv_records(path)
            else:
                continue

            for record in records:
                count = wine_matches(record, db_wine)
                if count > best_count:
                    best_count = count
                    best_match = record
                    if count == 4:
                        break  # perfect match — no need to scan further

        if best_count < MIN_MATCH_COUNT or best_match is None:
            logger.info(
                "DatasetIngestionService.enrich_wine: wine_id=%s — no match (best_count=%d)",
                wine_id,
                best_count,
            )
            return {
                "wine_id": wine_id,
                "status": "no_match",
                "datasets_scanned": len(dataset_files),
            }

        payload = _build_enrichment_payload(best_match)
        fields_written = []

        # Non-destructive guard (T-10-07): only write to empty JSONB columns
        update_patch: Dict[str, Any] = {}
        for col in ("wine_structure", "sensory_profile", "quality_signals"):
            existing = db_wine.get(col)
            if (existing is None or existing == {} or existing == "{}") and payload.get(
                col
            ):
                update_patch[col] = payload[col]
                fields_written.append(col)

        if not update_patch:
            logger.info(
                "DatasetIngestionService.enrich_wine: wine_id=%s — all JSONB columns already populated (skipping)",
                wine_id,
            )
            return {
                "wine_id": wine_id,
                "status": "skipped",
                "reason": "already_populated",
            }

        # Row-scoped update — T-10-10 mitigation: every update uses .eq("id", wine_id)
        supabase.table("master_wine_library").update(update_patch).eq(
            "id", wine_id
        ).execute()
        logger.info(
            "DatasetIngestionService.enrich_wine: wine_id=%s — wrote %s (match_count=%d)",
            wine_id,
            fields_written,
            best_count,
        )
        return {
            "wine_id": wine_id,
            "status": "enriched",
            "datasets_scanned": len(dataset_files),
            "fields_written": fields_written,
            "match_count": best_count,
        }
