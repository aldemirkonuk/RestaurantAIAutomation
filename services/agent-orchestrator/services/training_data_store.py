"""
Training Data Store
===================
Storage service for ML training datasets.
Captures input-output pairs from scan/enrichment pipelines
for future custom LLM training.

Schema:
  training_datasets table (Supabase/PostgreSQL)
  - id: UUID
  - dataset_type: 'menu_scan' | 'label_scan' | 'enrichment' | 'book_scrape'
  - input_data: JSONB (raw image base64, OCR text, etc.)
  - output_data: JSONB (corrected structured fields)
  - model_version: str (which model generated the output)
  - confidence: float (0.0-1.0)
  - human_verified: bool (was this verified/corrected by a user?)
  - restaurant_id: UUID (optional)
  - created_at: timestamp
"""

import json
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime

logger = logging.getLogger(__name__)


class TrainingDataStore:
    """
    Manages training dataset storage for future LLM fine-tuning.
    Captures scan/enrichment input-output pairs.
    """

    def __init__(self, supabase_client=None, mock_mode: bool = False):
        self.supabase = supabase_client
        self.mock_mode = mock_mode
        self._buffer: List[Dict[str, Any]] = []  # In-memory buffer for batch writes

    async def save_scan_pair(
        self,
        dataset_type: str,
        input_data: Dict[str, Any],
        output_data: Dict[str, Any],
        model_version: str = "gemini-2.5-flash",
        confidence: float = 0.0,
        human_verified: bool = False,
        restaurant_id: Optional[str] = None,
    ) -> Optional[str]:
        """
        Save a single input-output pair for training.

        Args:
            dataset_type: Type of data ('menu_scan', 'label_scan', 'enrichment', 'book_scrape')
            input_data: Raw input (image base64, OCR text, etc.)
            output_data: Structured output (25-field wine data, corrections, etc.)
            model_version: Which model generated this output
            confidence: Confidence score of the output
            human_verified: Whether a human verified/corrected this pair
            restaurant_id: Optional restaurant context

        Returns:
            ID of the saved record, or None if failed
        """
        record = {
            "dataset_type": dataset_type,
            "input_data": input_data,
            "output_data": output_data,
            "model_version": model_version,
            "confidence": round(confidence, 3),
            "human_verified": human_verified,
            "restaurant_id": restaurant_id,
            "created_at": datetime.utcnow().isoformat(),
        }

        if self.mock_mode or not self.supabase:
            # Buffer in memory
            self._buffer.append(record)
            logger.debug(
                f"Training data buffered (mock/no-db): {dataset_type}, buffer size: {len(self._buffer)}"
            )
            return f"buffered_{len(self._buffer)}"

        try:
            result = self.supabase.table("training_datasets").insert(record).execute()
            if result.data:
                record_id = result.data[0].get("id")
                logger.info(f"Training data saved: {dataset_type} (id: {record_id})")
                return record_id
        except Exception as e:
            logger.warning(f"Failed to save training data: {e}")
            # Buffer as fallback
            self._buffer.append(record)

        return None

    async def save_menu_scan_pair(
        self,
        image_base64: str,
        detected_wines: List[Dict[str, Any]],
        user_corrections: Optional[List[Dict[str, Any]]] = None,
        model_version: str = "gemini-2.5-flash",
        restaurant_id: Optional[str] = None,
    ) -> Optional[str]:
        """
        Save a menu scan input-output pair.

        The input is the raw image. The output is the detected wines,
        optionally including user corrections (accepted/rejected/edited wines).
        """
        input_data = {
            "image_base64_truncated": (
                image_base64[:100] + "..." if len(image_base64) > 100 else image_base64
            ),
            "image_size_bytes": len(image_base64),
            "source_type": "menu",
        }

        output_data = {
            "wines_detected": len(detected_wines),
            "wines": detected_wines,
        }

        if user_corrections:
            output_data["user_corrections"] = user_corrections
            output_data["has_corrections"] = True

        avg_confidence = sum(w.get("confidence", 0) for w in detected_wines) / max(
            len(detected_wines), 1
        )

        return await self.save_scan_pair(
            dataset_type="menu_scan",
            input_data=input_data,
            output_data=output_data,
            model_version=model_version,
            confidence=avg_confidence,
            human_verified=user_corrections is not None,
            restaurant_id=restaurant_id,
        )

    async def save_enrichment_pair(
        self,
        wine_name: str,
        enrichment_input: Dict[str, Any],
        enrichment_output: Dict[str, Any],
        model_version: str = "gemini-2.5-flash",
        human_corrections: Optional[Dict[str, Any]] = None,
        restaurant_id: Optional[str] = None,
    ) -> Optional[str]:
        """
        Save a wine enrichment input-output pair.

        Input is the wine name/context. Output is the enriched fields.
        """
        input_data = {
            "wine_name": wine_name,
            **enrichment_input,
        }

        output_data = {
            **enrichment_output,
        }

        if human_corrections:
            output_data["human_corrections"] = human_corrections
            output_data["has_corrections"] = True

        confidence = enrichment_output.get("confidence", 0.5)

        return await self.save_scan_pair(
            dataset_type="enrichment",
            input_data=input_data,
            output_data=output_data,
            model_version=model_version,
            confidence=confidence,
            human_verified=human_corrections is not None,
            restaurant_id=restaurant_id,
        )

    async def export_jsonl(
        self,
        dataset_type: Optional[str] = None,
        human_verified_only: bool = False,
        limit: int = 10000,
    ) -> str:
        """
        Export training data in JSONL format for LLM fine-tuning.

        Returns:
            JSONL string (one JSON object per line)
        """
        if self.mock_mode or not self.supabase:
            # Export from buffer
            records = self._buffer
            if dataset_type:
                records = [r for r in records if r["dataset_type"] == dataset_type]
            if human_verified_only:
                records = [r for r in records if r.get("human_verified")]
            return "\n".join(json.dumps(r) for r in records[:limit])

        try:
            query = self.supabase.table("training_datasets").select("*")
            if dataset_type:
                query = query.eq("dataset_type", dataset_type)
            if human_verified_only:
                query = query.eq("human_verified", True)
            query = query.order("created_at", desc=True).limit(limit)

            result = query.execute()
            records = result.data or []

            return "\n".join(json.dumps(r) for r in records)

        except Exception as e:
            logger.error(f"Failed to export training data: {e}")
            return ""

    async def get_stats(self) -> Dict[str, Any]:
        """Get statistics about the training dataset."""
        if self.mock_mode or not self.supabase:
            return {
                "total": len(self._buffer),
                "by_type": {},
                "human_verified": sum(
                    1 for r in self._buffer if r.get("human_verified")
                ),
            }

        try:
            result = (
                self.supabase.table("training_datasets")
                .select("dataset_type, human_verified", count="exact")
                .execute()
            )
            records = result.data or []

            by_type: Dict[str, int] = {}
            verified = 0
            for r in records:
                t = r.get("dataset_type", "unknown")
                by_type[t] = by_type.get(t, 0) + 1
                if r.get("human_verified"):
                    verified += 1

            return {
                "total": len(records),
                "by_type": by_type,
                "human_verified": verified,
            }
        except Exception as e:
            logger.error(f"Failed to get training data stats: {e}")
            return {"total": 0, "by_type": {}, "human_verified": 0}

    def flush_buffer(self) -> List[Dict[str, Any]]:
        """Return and clear the in-memory buffer."""
        buffer = list(self._buffer)
        self._buffer.clear()
        return buffer


# =============================================================================
# MODULE-LEVEL SINGLETON
# =============================================================================

_store_instance: Optional[TrainingDataStore] = None


def get_training_data_store(
    supabase_client=None,
    mock_mode: bool = False,
) -> TrainingDataStore:
    """Get or create module-level singleton store."""
    global _store_instance
    if _store_instance is None:
        _store_instance = TrainingDataStore(
            supabase_client=supabase_client,
            mock_mode=mock_mode,
        )
    return _store_instance
