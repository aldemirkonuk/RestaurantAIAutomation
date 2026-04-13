"""
Book Scraper Agent
==================
Agent wrapper for the WineBookScraper service.
Listens for PDF upload events and processes wine books through the hybrid pipeline.
"""

import logging
import base64
from typing import Dict, Any, List, Optional

from agents.base_agent import BaseAgent

logger = logging.getLogger(__name__)


class BookScraperAgent(BaseAgent):
    """
    AI Agent that processes wine reference books and catalogs.
    Extracts structured wine data using a hybrid PyPDF2 + Gemini Vision pipeline
    and upserts results to the master_wine_library.
    """

    def __init__(self, agent_name: str, message_bus, database, config: dict):
        super().__init__(
            agent_name=agent_name,
            message_bus=message_bus,
            database=database,
            config=config,
        )
        self.google_api_key = config.get("google_api_key")
        self.mock_mode = config.get("mock_mode", True)
        self.scraper = None

    async def initialize(self) -> None:
        """Initialize the Book Scraper Agent."""
        self.logger.info("Initializing Book Scraper Agent")

        from services.wine_book_scraper import get_wine_book_scraper

        supabase = None
        try:
            from core.database import get_supabase_client
            supabase = get_supabase_client()
        except Exception:
            pass

        self.scraper = get_wine_book_scraper(
            google_api_key=self.google_api_key,
            supabase_client=supabase,
            mock_mode=self.mock_mode,
        )

        self.logger.info("Book Scraper Agent initialized")

    def get_subscribed_routing_keys(self) -> List[tuple]:
        return [
            ("enrichment.events", "enrichment.book_upload"),
            ("enrichment.events", "enrichment.pdf_process"),
        ]

    async def process_message(self, message: Dict[str, Any]) -> None:
        routing_key = message.get("routing_key")
        payload = message.get("payload", {})

        if routing_key in ("enrichment.book_upload", "enrichment.pdf_process"):
            await self._process_book(payload)

    async def _process_book(self, payload: Dict[str, Any]) -> None:
        """Process an uploaded wine book PDF."""
        pdf_base64 = payload.get("pdf_base64")
        source_name = payload.get("source_name", "uploaded_book")
        restaurant_id = payload.get("restaurant_id")

        if not pdf_base64:
            self.logger.error("No pdf_base64 in book upload payload")
            return

        try:
            pdf_bytes = base64.b64decode(pdf_base64)
        except Exception as e:
            self.logger.error(f"Failed to decode PDF base64: {e}")
            return

        self.logger.info(f"Processing wine book: {source_name}")

        result = await self.scraper.process_pdf(
            pdf_bytes=pdf_bytes,
            source_name=source_name,
            restaurant_id=restaurant_id,
        )

        # Publish results
        await self.publish(
            exchange_name="enrichment.events",
            routing_key="enrichment.book_processed",
            message_body={
                "event_type": "BookProcessed",
                "payload": {
                    "source": source_name,
                    "wines_extracted": result["wines_extracted"],
                    "pages_processed": result["pages_processed"],
                    "upserted": result.get("upserted", 0),
                    "errors": result.get("errors", []),
                    "restaurant_id": restaurant_id,
                },
            },
        )

        self.logger.info(
            f"Book processing complete: {result['wines_extracted']} wines from "
            f"{result['pages_processed']} pages ({source_name})"
        )
