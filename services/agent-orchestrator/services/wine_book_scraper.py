"""
Wine Book Scraper Service
=========================
State-of-the-art hybrid PDF pipeline for extracting structured wine data
from wine reference books, catalogs, and educational materials.

Pipeline:
  1. Page Classifier - determines if page is text-heavy or image/table-heavy
  2. PyPDF2 Text Extract - for text-heavy pages
  3. Gemini Vision - for image/table pages (page rendered as image)
  4. Chunk by Wine Entry - split extracted content into individual wine entries
  5. Gemini Structured Extraction - parse each entry into 25 master_wine_library fields
  6. Schema Validation - validate and normalize extracted data
  7. Upsert to master_wine_library - deduplicate and insert
  8. Generate pgvector Embedding - for similarity search
"""

import io
import json
import logging
import base64
import time
from typing import Optional, List, Dict, Any
from datetime import datetime

logger = logging.getLogger(__name__)


class WineBookScraper:
    """
    Hybrid PDF wine book scraper using PyPDF2 + Gemini Vision.
    Extracts structured wine data and upserts to master_wine_library.
    """

    # Fields we extract per wine entry (matches master_wine_library schema)
    WINE_FIELDS = [
        "name",
        "producer",
        "region",
        "country",
        "grape_variety",
        "vintage",
        "wine_type",
        "color",
        "alcohol_pct",
        "tasting_notes",
        "description",
        "avg_price",
        "barcode",
        "upc",
        "ean",
        "sku",
        "image_url",
        "sub_region",
        "appellation",
        "appellation_class",
        "is_blend",
        "body",
        "sweetness",
        "food_pairings",
        "classification",
    ]

    def __init__(
        self,
        google_api_key: Optional[str] = None,
        supabase_client=None,
        mock_mode: bool = False,
    ):
        self.google_api_key = google_api_key
        self.supabase = supabase_client
        self.mock_mode = mock_mode
        self._genai_client = None

    def _get_genai_client(self):
        """Lazy-initialize the Gemini client."""
        if self._genai_client is not None:
            return self._genai_client
        try:
            from google import genai

            self._genai_client = genai.Client(api_key=self.google_api_key)
            return self._genai_client
        except ImportError:
            logger.warning("google-genai not available, falling back to legacy")
            return None

    async def process_pdf(
        self,
        pdf_bytes: bytes,
        source_name: str = "unknown_book",
        restaurant_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Main entry point: process an entire PDF and extract wine entries.

        Returns:
            {
                "wines_extracted": int,
                "pages_processed": int,
                "wines": [...],
                "errors": [...],
                "source": str,
            }
        """
        logger.info(f"Processing PDF: {source_name} ({len(pdf_bytes)} bytes)")

        # Step 1: Extract pages
        pages = self._extract_pages(pdf_bytes)
        logger.info(f"Extracted {len(pages)} pages from PDF")

        if not pages:
            return {
                "wines_extracted": 0,
                "pages_processed": 0,
                "wines": [],
                "errors": ["Failed to extract pages from PDF"],
                "source": source_name,
            }

        # Step 2: Classify and extract text from each page
        all_text_chunks = []
        all_image_pages = []
        errors = []

        for i, page_data in enumerate(pages):
            page_type = self._classify_page(page_data)
            if page_type == "text":
                text = page_data.get("text", "")
                if text.strip():
                    all_text_chunks.append(
                        {
                            "page": i + 1,
                            "text": text,
                            "type": "text_extract",
                        }
                    )
            elif page_type == "image":
                all_image_pages.append(
                    {
                        "page": i + 1,
                        "image_bytes": page_data.get("image_bytes"),
                    }
                )

        # Step 3: Process image-heavy pages with Gemini Vision
        for img_page in all_image_pages:
            try:
                vision_text = await self._extract_with_vision(
                    img_page["image_bytes"], restaurant_id=restaurant_id
                )
                if vision_text:
                    all_text_chunks.append(
                        {
                            "page": img_page["page"],
                            "text": vision_text,
                            "type": "vision_extract",
                        }
                    )
            except Exception as e:
                errors.append(
                    f"Vision extraction failed for page {img_page['page']}: {e}"
                )

        # Step 4: Combine all text and chunk by wine entry
        combined_text = "\n\n".join(
            [
                f"--- Page {c['page']} ({c['type']}) ---\n{c['text']}"
                for c in sorted(all_text_chunks, key=lambda x: x["page"])
            ]
        )

        # Step 5: Extract structured wine data from chunks
        wines = await self._extract_wines_from_text(
            combined_text, source_name, restaurant_id=restaurant_id
        )

        # Step 6: Validate and normalize
        validated_wines = []
        for wine in wines:
            validated = self._validate_wine(wine)
            if validated:
                validated["enrichment_source"] = f"book_scrape:{source_name}"
                validated_wines.append(validated)

        # Step 7: Upsert to database
        upserted_count = 0
        if self.supabase and validated_wines:
            upserted_count = await self._upsert_wines(validated_wines, restaurant_id)

        logger.info(
            f"PDF processing complete: {len(validated_wines)} wines extracted, "
            f"{upserted_count} upserted from {len(pages)} pages"
        )

        return {
            "wines_extracted": len(validated_wines),
            "pages_processed": len(pages),
            "wines": validated_wines,
            "errors": errors,
            "source": source_name,
            "upserted": upserted_count,
        }

    def _extract_pages(self, pdf_bytes: bytes) -> List[Dict[str, Any]]:
        """Extract pages from PDF using PyPDF2 and pdf2image for image pages."""
        pages = []
        try:
            import PyPDF2

            reader = PyPDF2.PdfReader(io.BytesIO(pdf_bytes))

            for i, page in enumerate(reader.pages):
                text = page.extract_text() or ""
                page_data = {
                    "page_number": i + 1,
                    "text": text,
                    "text_length": len(text.strip()),
                    "image_bytes": None,
                }

                # If text extraction is poor, try to render as image
                if len(text.strip()) < 100:
                    try:
                        image_bytes = self._render_page_as_image(pdf_bytes, i)
                        page_data["image_bytes"] = image_bytes
                    except Exception:
                        pass

                pages.append(page_data)

        except Exception as e:
            logger.error(f"Failed to extract PDF pages: {e}")

        return pages

    def _render_page_as_image(
        self, pdf_bytes: bytes, page_index: int
    ) -> Optional[bytes]:
        """Render a specific PDF page as a JPEG image for Vision processing."""
        try:
            from pdf2image import convert_from_bytes

            images = convert_from_bytes(
                pdf_bytes,
                first_page=page_index + 1,
                last_page=page_index + 1,
                dpi=200,
            )
            if images:
                img_buffer = io.BytesIO()
                images[0].save(img_buffer, format="JPEG", quality=85)
                return img_buffer.getvalue()
        except ImportError:
            logger.warning("pdf2image not installed, cannot render pages as images")
        except Exception as e:
            logger.warning(f"Failed to render page {page_index} as image: {e}")
        return None

    def _classify_page(self, page_data: Dict[str, Any]) -> str:
        """
        Classify a page as 'text' (suitable for PyPDF2) or 'image' (needs Vision).
        Heuristic: if text content is less than 100 chars, treat as image page.
        """
        text_len = page_data.get("text_length", 0)
        has_image = page_data.get("image_bytes") is not None

        if text_len >= 100:
            return "text"
        elif has_image:
            return "image"
        else:
            return "text"  # Even short text pages, try to use the text

    async def _extract_with_vision(
        self, image_bytes: bytes, restaurant_id: Optional[str] = None
    ) -> Optional[str]:
        """
        Use Gemini Vision to extract wine information from a page image.
        """
        if self.mock_mode or not self.google_api_key:
            return None

        client = self._get_genai_client()
        if not client:
            return None

        try:
            from google.genai import types

            image_b64 = base64.b64encode(image_bytes).decode()

            _t0 = time.perf_counter()
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=[
                    types.Content(
                        parts=[
                            types.Part(
                                text=(
                                    "Extract ALL wine entries from this page image. "
                                    "For each wine, extract: name, producer, vintage, region, country, "
                                    "grape variety, wine type, tasting notes, price if visible. "
                                    "Return as structured text, one wine per paragraph."
                                )
                            ),
                            types.Part(
                                inline_data=types.Blob(
                                    mime_type="image/jpeg",
                                    data=base64.b64decode(image_b64),
                                )
                            ),
                        ]
                    ),
                ],
                config=types.GenerateContentConfig(temperature=0.1),
            )

            # P1: previously an unlogged model call (dark site)
            try:
                from services.spend_logger import estimate_llm_cost, get_spend_logger

                _usage = getattr(response, "usage_metadata", None)
                _in = getattr(_usage, "prompt_token_count", 0) or 0
                _out = getattr(_usage, "candidates_token_count", 0) or 0
                get_spend_logger().log(
                    provider="google",
                    model="gemini-2.5-flash",
                    input_tokens=_in,
                    output_tokens=_out,
                    cost_usd=estimate_llm_cost("gemini-2.5-flash", _in, _out),
                    restaurant_id=restaurant_id or None,
                    agent_fallback="wine_book_scraper",
                    task_type="book_vision_extraction",
                    outcome="success",  # call-level: response returned
                    duration_ms=int((time.perf_counter() - _t0) * 1000),
                )
            except Exception:
                pass

            return response.text

        except Exception as e:
            logger.error(f"Vision extraction failed: {e}")
            return None

    async def _extract_wines_from_text(
        self,
        text: str,
        source_name: str,
        restaurant_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Use Gemini to extract structured wine entries from combined text.
        Handles chunking for large texts.
        """
        if self.mock_mode:
            return [
                {
                    "name": "Mock Wine from Book",
                    "producer": "Mock Publisher",
                    "wine_type": "red",
                    "country": "France",
                    "region": "Bordeaux",
                    "source": "mock_book_extraction",
                }
            ]

        if not self.google_api_key:
            return []

        client = self._get_genai_client()
        if not client:
            return []

        # Chunk text if too long (Gemini has token limits)
        max_chars = 30000  # ~7500 tokens, safe for Gemini
        chunks = []
        if len(text) > max_chars:
            # Split by page boundaries
            pages = text.split("--- Page ")
            current_chunk = ""
            for page in pages:
                if len(current_chunk) + len(page) > max_chars:
                    if current_chunk:
                        chunks.append(current_chunk)
                    current_chunk = page
                else:
                    current_chunk += "\n--- Page " + page if current_chunk else page
            if current_chunk:
                chunks.append(current_chunk)
        else:
            chunks = [text]

        all_wines = []

        for chunk_idx, chunk in enumerate(chunks):
            try:
                from google.genai import types

                grounding_tool = types.Tool(google_search=types.GoogleSearch())
                config = types.GenerateContentConfig(
                    tools=[grounding_tool],
                    temperature=0.1,
                )

                prompt = f"""You are a wine data extraction expert. Extract ALL individual wine entries from the following text (from a wine book/catalog called "{source_name}").

For EACH wine found, provide ALL available fields as a JSON object. Use web search to verify and fill in missing information if possible.

Return a JSON array of wine objects, each with these fields (use null if not found):
- name, producer, vintage (int or null), wine_type, color, country, region, sub_region
- grape_variety, is_blend (bool), alcohol_pct (float), appellation, appellation_class
- tasting_notes, description, food_pairings (array), avg_price (float in USD)
- body, sweetness, classification, barcode, upc, ean, sku
- confidence (0.0-1.0 based on data completeness)

Text to process:
{chunk}

Return ONLY a valid JSON array. If no wines found, return []."""

                _t0 = time.perf_counter()
                response = client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=prompt,
                    config=config,
                )

                # P1: previously an unlogged model call (dark site)
                try:
                    from services.spend_logger import (
                        estimate_llm_cost,
                        get_spend_logger,
                    )

                    _usage = getattr(response, "usage_metadata", None)
                    _in = getattr(_usage, "prompt_token_count", 0) or 0
                    _out = getattr(_usage, "candidates_token_count", 0) or 0
                    get_spend_logger().log(
                        provider="google",
                        model="gemini-2.5-flash",
                        input_tokens=_in,
                        output_tokens=_out,
                        cost_usd=estimate_llm_cost("gemini-2.5-flash", _in, _out),
                        restaurant_id=restaurant_id or None,
                        agent_fallback="wine_book_scraper",
                        task_type="book_text_extraction",
                        outcome="success",  # call-level: response returned
                        duration_ms=int((time.perf_counter() - _t0) * 1000),
                        context={"chunk_index": chunk_idx},
                    )
                except Exception:
                    pass

                result_text = response.text.strip()
                if "```json" in result_text:
                    result_text = (
                        result_text.split("```json")[1].split("```")[0].strip()
                    )
                elif "```" in result_text:
                    result_text = result_text.split("```")[1].split("```")[0].strip()

                wines = json.loads(result_text)
                if isinstance(wines, list):
                    all_wines.extend(wines)
                elif isinstance(wines, dict):
                    all_wines.append(wines)

                logger.info(
                    f"Chunk {chunk_idx + 1}/{len(chunks)}: extracted {len(wines) if isinstance(wines, list) else 1} wines"
                )

            except Exception as e:
                logger.error(f"Wine extraction from chunk {chunk_idx + 1} failed: {e}")

        return all_wines

    def _validate_wine(self, wine: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Validate and normalize a wine entry against master_wine_library schema."""
        if not wine or not isinstance(wine, dict):
            return None

        name = wine.get("name")
        if not name or len(str(name).strip()) < 2:
            return None

        validated = {
            "name": str(name).strip()[:500],
            "ai_enriched": True,
        }

        # String fields with max lengths
        string_fields = {
            "producer": 255,
            "region": 255,
            "country": 100,
            "grape_variety": 255,
            "wine_type": 50,
            "color": 50,
            "tasting_notes": None,
            "description": None,
            "barcode": 100,
            "upc": 50,
            "ean": 50,
            "sku": 100,
            "image_url": None,
            "appellation": 255,
            "appellation_class": 100,
            "body": 50,
            "sweetness": 50,
            "classification": 255,
        }

        for field, max_len in string_fields.items():
            val = wine.get(field)
            if val is not None and val != "null":
                val_str = str(val).strip()
                if max_len and len(val_str) > max_len:
                    val_str = val_str[:max_len]
                validated[field] = val_str if val_str else None
            else:
                validated[field] = None

        # Integer fields
        vintage = wine.get("vintage")
        if vintage is not None and vintage != "null":
            try:
                v = int(vintage)
                if 1800 <= v <= 2030:
                    validated["vintage"] = v
                else:
                    validated["vintage"] = None
            except (ValueError, TypeError):
                validated["vintage"] = None
        else:
            validated["vintage"] = None

        # Float fields
        for field in ["alcohol_pct", "avg_price"]:
            val = wine.get(field)
            if val is not None and val != "null":
                try:
                    validated[field] = round(float(val), 2)
                except (ValueError, TypeError):
                    validated[field] = None
            else:
                validated[field] = None

        # Food pairings (JSONB)
        pairings = wine.get("food_pairings")
        if isinstance(pairings, list):
            validated["food_pairings"] = pairings
        elif isinstance(pairings, str):
            validated["food_pairings"] = [p.strip() for p in pairings.split(",")]
        else:
            validated["food_pairings"] = None

        return validated

    async def _upsert_wines(
        self,
        wines: List[Dict[str, Any]],
        restaurant_id: Optional[str] = None,
    ) -> int:
        """Upsert validated wines to master_wine_library, deduplicating by name+producer+vintage."""
        if not self.supabase:
            return 0

        upserted = 0
        for wine in wines:
            try:
                # Check for existing entry
                query = self.supabase.table("master_wine_library").select("id")
                query = query.eq("name", wine["name"])
                if wine.get("producer"):
                    query = query.eq("producer", wine["producer"])
                if wine.get("vintage"):
                    query = query.eq("vintage", wine["vintage"])

                existing = query.limit(1).execute()

                if existing.data:
                    # Update existing (merge non-null fields)
                    update_data = {k: v for k, v in wine.items() if v is not None}
                    update_data["updated_at"] = datetime.utcnow().isoformat()
                    self.supabase.table("master_wine_library").update(update_data).eq(
                        "id", existing.data[0]["id"]
                    ).execute()
                else:
                    # Insert new
                    self.supabase.table("master_wine_library").insert(wine).execute()

                upserted += 1

            except Exception as e:
                logger.warning(f"Failed to upsert wine '{wine.get('name')}': {e}")

        return upserted


# =============================================================================
# MODULE-LEVEL SINGLETON
# =============================================================================

_scraper_instance: Optional[WineBookScraper] = None


def get_wine_book_scraper(
    google_api_key: Optional[str] = None,
    supabase_client=None,
    mock_mode: bool = False,
) -> WineBookScraper:
    """Get or create module-level singleton scraper."""
    global _scraper_instance
    if _scraper_instance is None:
        _scraper_instance = WineBookScraper(
            google_api_key=google_api_key,
            supabase_client=supabase_client,
            mock_mode=mock_mode,
        )
    return _scraper_instance
