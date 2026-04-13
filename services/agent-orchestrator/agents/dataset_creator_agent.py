"""
Dataset Creator Agent
=====================
Listens for scan/enrichment events and captures input-output pairs
as training data for future custom LLM fine-tuning.

Captures:
  - Menu scan results (image -> detected wines)
  - Label scan results (image -> wine fields)
  - Enrichment results (wine name -> enriched fields)
  - Book scrape results (PDF page -> structured entries)
  - User corrections (original output -> corrected output)

Storage: training_datasets table in Supabase/PostgreSQL
Export: JSONL format for fine-tuning pipelines
"""

import logging
from typing import Dict, Any, List

from agents.base_agent import BaseAgent

logger = logging.getLogger(__name__)


class DatasetCreatorAgent(BaseAgent):
    """
    Agent that passively captures training data from scan/enrichment pipelines.
    Does NOT modify any data - purely observational and storage-focused.
    """

    def __init__(self, agent_name: str, message_bus, database, config: dict):
        super().__init__(
            agent_name=agent_name,
            message_bus=message_bus,
            database=database,
            config=config,
        )
        self.mock_mode = config.get("mock_mode", True)
        self.store = None

    async def initialize(self) -> None:
        """Initialize the Dataset Creator Agent."""
        self.logger.info("Initializing Dataset Creator Agent")

        from services.training_data_store import get_training_data_store

        supabase = None
        try:
            from core.database import get_supabase_client
            supabase = get_supabase_client()
        except Exception:
            pass

        self.store = get_training_data_store(
            supabase_client=supabase,
            mock_mode=self.mock_mode,
        )

        self.logger.info("Dataset Creator Agent initialized")

    def get_subscribed_routing_keys(self) -> List[tuple]:
        """Subscribe to all scan/enrichment result events."""
        return [
            # Menu/label scan results
            ("scan.events", "scan.menu_completed"),
            ("scan.events", "scan.label_completed"),

            # Wine enrichment results
            ("enrichment.events", "enrichment.wine_enriched"),
            ("enrichment.events", "enrichment.book_processed"),

            # User corrections (from frontend)
            ("training.events", "training.user_correction"),
            ("training.events", "training.scan_confirmed"),

            # Sommelier enrichment
            ("sommelier.events", "sommelier.wine_enriched"),
        ]

    async def process_message(self, message: Dict[str, Any]) -> None:
        """Route messages to appropriate handlers."""
        routing_key = message.get("routing_key", "")
        payload = message.get("payload", {})

        try:
            if routing_key == "scan.menu_completed":
                await self._capture_menu_scan(payload)
            elif routing_key == "scan.label_completed":
                await self._capture_label_scan(payload)
            elif routing_key in ("enrichment.wine_enriched", "sommelier.wine_enriched"):
                await self._capture_enrichment(payload)
            elif routing_key == "enrichment.book_processed":
                await self._capture_book_scrape(payload)
            elif routing_key == "training.user_correction":
                await self._capture_user_correction(payload)
            elif routing_key == "training.scan_confirmed":
                await self._capture_scan_confirmation(payload)
        except Exception as e:
            self.logger.error(f"Dataset capture failed for {routing_key}: {e}")

    async def _capture_menu_scan(self, payload: Dict[str, Any]) -> None:
        """Capture a completed menu scan as training data."""
        wines = payload.get("wines", [])
        image_info = payload.get("image_info", {})
        restaurant_id = payload.get("restaurant_id")

        if not wines:
            return

        input_data = {
            "source_type": "menu",
            "image_size": image_info.get("size_bytes", 0),
            "regions_detected": payload.get("regions_detected", 0),
            "section_headers": payload.get("section_headers", []),
        }

        # Include truncated image reference if available
        if image_info.get("hash"):
            input_data["image_hash"] = image_info["hash"]

        output_data = {
            "wines_detected": len(wines),
            "wines": [self._sanitize_wine(w) for w in wines],
        }

        await self.store.save_scan_pair(
            dataset_type="menu_scan",
            input_data=input_data,
            output_data=output_data,
            model_version=payload.get("model_version", "gemini-2.0-flash"),
            confidence=sum(w.get("confidence", 0) for w in wines) / max(len(wines), 1),
            restaurant_id=restaurant_id,
        )

        self.logger.info(f"Captured menu scan: {len(wines)} wines")

    async def _capture_label_scan(self, payload: Dict[str, Any]) -> None:
        """Capture a completed label scan as training data."""
        wine = payload.get("wine", {})
        if not wine:
            return

        await self.store.save_scan_pair(
            dataset_type="label_scan",
            input_data={
                "source_type": "label",
                "ocr_text": payload.get("ocr_text", ""),
            },
            output_data=self._sanitize_wine(wine),
            model_version=payload.get("model_version", "gemini-2.0-flash"),
            confidence=wine.get("confidence", 0.5),
            restaurant_id=payload.get("restaurant_id"),
        )

        self.logger.info(f"Captured label scan: {wine.get('name', 'unknown')}")

    async def _capture_enrichment(self, payload: Dict[str, Any]) -> None:
        """Capture a wine enrichment result as training data."""
        wine_name = payload.get("wine_name", "")
        enrichment = payload.get("enrichment", {})

        if not wine_name or not enrichment:
            return

        await self.store.save_enrichment_pair(
            wine_name=wine_name,
            enrichment_input={
                "producer": payload.get("producer"),
                "vintage": payload.get("vintage"),
                "source": payload.get("source", "unknown"),
            },
            enrichment_output=enrichment,
            model_version=payload.get("model_version", "gemini-2.0-flash"),
            restaurant_id=payload.get("restaurant_id"),
        )

        self.logger.info(f"Captured enrichment: {wine_name}")

    async def _capture_book_scrape(self, payload: Dict[str, Any]) -> None:
        """Capture book scraping results as training data."""
        source = payload.get("source", "unknown_book")
        wines_extracted = payload.get("wines_extracted", 0)

        if wines_extracted == 0:
            return

        await self.store.save_scan_pair(
            dataset_type="book_scrape",
            input_data={
                "source_name": source,
                "pages_processed": payload.get("pages_processed", 0),
            },
            output_data={
                "wines_extracted": wines_extracted,
                "upserted": payload.get("upserted", 0),
            },
            model_version="gemini-2.0-flash",
            confidence=0.7,
            restaurant_id=payload.get("restaurant_id"),
        )

        self.logger.info(f"Captured book scrape: {wines_extracted} wines from {source}")

    async def _capture_user_correction(self, payload: Dict[str, Any]) -> None:
        """
        Capture user corrections to scan/enrichment results.
        These are high-value training pairs (human-verified ground truth).
        """
        original = payload.get("original", {})
        corrected = payload.get("corrected", {})
        correction_type = payload.get("type", "unknown")

        if not original or not corrected:
            return

        await self.store.save_scan_pair(
            dataset_type=f"{correction_type}_correction",
            input_data={"original_output": original},
            output_data={"corrected_output": corrected},
            model_version=payload.get("model_version", "human"),
            confidence=1.0,  # Human-verified is highest confidence
            human_verified=True,
            restaurant_id=payload.get("restaurant_id"),
        )

        self.logger.info(f"Captured user correction: {correction_type}")

    async def _capture_scan_confirmation(self, payload: Dict[str, Any]) -> None:
        """
        Capture when a user confirms scan results (accepts wines from scanner).
        The accepted set becomes a positive training signal.
        """
        accepted_wines = payload.get("accepted_wines", [])
        rejected_wines = payload.get("rejected_wines", [])

        if not accepted_wines and not rejected_wines:
            return

        await self.store.save_scan_pair(
            dataset_type="scan_confirmation",
            input_data={
                "total_detected": len(accepted_wines) + len(rejected_wines),
            },
            output_data={
                "accepted": [self._sanitize_wine(w) for w in accepted_wines],
                "rejected": [self._sanitize_wine(w) for w in rejected_wines],
                "acceptance_rate": len(accepted_wines) / max(len(accepted_wines) + len(rejected_wines), 1),
            },
            model_version=payload.get("model_version", "gemini-2.0-flash"),
            confidence=1.0,
            human_verified=True,
            restaurant_id=payload.get("restaurant_id"),
        )

        self.logger.info(
            f"Captured scan confirmation: {len(accepted_wines)} accepted, "
            f"{len(rejected_wines)} rejected"
        )

    @staticmethod
    def _sanitize_wine(wine: Dict[str, Any]) -> Dict[str, Any]:
        """
        Sanitize a wine dict for storage (remove large binary data like images).
        """
        sanitized = {}
        for key, value in wine.items():
            # Skip binary/large data
            if key in ("image_base64", "image_data", "raw_image"):
                sanitized[key] = f"[{len(str(value))} bytes]"
            elif isinstance(value, str) and len(value) > 5000:
                sanitized[key] = value[:5000] + "...[truncated]"
            else:
                sanitized[key] = value
        return sanitized
