"""
Wine Scanning API Routes
========================
Unified scanning endpoints that route through the existing agents
(MenuAnalyzerAgent, VisualVerificationAgent) instead of direct Gemini calls.

Supports three source types: menu, label, invoice.
Returns 25 structured wine fields per detection.
"""

import logging
import base64
import json
import time
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect

from api.auth import verify_admin_key
from pydantic import BaseModel, Field

from config.settings import get_settings
from services.governance import GovernanceTier

logger = logging.getLogger(__name__)
settings = get_settings()


# =============================================================================
# ENRICHMENT QUEUE HELPER
# =============================================================================


async def _queue_enrichment_if_needed(
    wine_data: dict,
    restaurant_id: Optional[str] = None,
) -> bool:
    """
    Queue Tier 2 wines (confidence 0.70–0.94) for background web enrichment.
    Inserts into enrichment_queue table for async processing.
    Returns True if queued, False otherwise.
    """
    library_tier = wine_data.get("library_tier")
    if library_tier != GovernanceTier.WEB_ENRICHED.value:  # Only Tier 2
        return False

    from core.database import get_supabase_client

    supabase = get_supabase_client()
    if not supabase:
        return False

    try:
        confidence = wine_data.get("confidence", 0.0)
        enrichment_job = {
            "wine_name": wine_data.get("wine_name", "Unknown"),
            "producer": wine_data.get("producer"),
            "vintage": wine_data.get("vintage"),
            "country": wine_data.get("country"),
            "region": wine_data.get("region"),
            "restaurant_id": restaurant_id,
            "current_confidence": confidence,
            "parsed_fields_snapshot": {
                k: v
                for k, v in wine_data.items()
                if k not in ("field_confidences", "field_sources", "warnings")
            },
            "status": "pending",
            "priority": 1 if confidence >= 0.85 else 2,
        }

        supabase.table("enrichment_queue").insert(enrichment_job).execute()
        logger.info(
            f"Queued enrichment for '{wine_data.get('wine_name')}' (tier={library_tier}, conf={confidence:.2f})"
        )
        return True
    except Exception as e:
        logger.warning(f"Failed to queue enrichment: {e}")
        return False


router = APIRouter(prefix="/api/v1/scan", tags=["scanning"])

# Preview router — separate prefix so URL is /api/v1/preview/detect (not /api/v1/scan/...)
router_preview = APIRouter(prefix="/api/v1/preview", tags=["preview"])


# =============================================================================
# REQUEST / RESPONSE MODELS
# =============================================================================


class WineScanRequest(BaseModel):
    """Request to scan/interpret wine from OCR text or image."""

    ocr_text: Optional[str] = None
    image_base64: Optional[str] = None
    source_type: str = Field(default="menu", description="menu | label | invoice")
    restaurant_id: Optional[str] = None


class WineResearchRequest(BaseModel):
    """Request deep research on an unknown wine."""

    wine_name: str
    producer: Optional[str] = None
    vintage: Optional[int] = None
    additional_context: Optional[str] = None
    restaurant_id: Optional[str] = None


class FuzzyMatchRequest(BaseModel):
    """Request fuzzy matching against master wine library."""

    query: str
    producer: Optional[str] = None
    vintage: Optional[int] = None
    limit: int = 5


class WineParsedResponse(BaseModel):
    """
    Full structured wine detection result with 3-layer schema.
    Layer 1: Identity fields (wine_name, producer, vintage, country, region, grape_variety, wine_type)
    Layer 2: Appellation + structure fields
    Layer 3: Quality + production fields
    Metadata: confidence, governance, sources
    """

    # ── Layer 1: Identity (MUST HAVE — confidence targets > 0.90) ──
    wine_name: str = "Unknown Wine"
    producer: Optional[str] = None
    vintage: Optional[int] = None
    wine_type: Optional[str] = (
        None  # red | white | sparkling | rosé | dessert | fortified | orange
    )
    country: Optional[str] = None
    region: Optional[str] = None
    grape_variety: Optional[str] = None

    # ── Layer 2: Appellation + Structure ──
    sub_region: Optional[str] = None
    appellation: Optional[str] = None
    appellation_class: Optional[str] = None  # AOC | DOC | DOCG | AVA | DO | etc
    appellation_tier: Optional[str] = None  # Grand Cru | Premier Cru | Classico | etc
    is_blend: Optional[bool] = None
    body: Optional[str] = None  # light | medium | medium-full | full
    sweetness: Optional[str] = None  # bone-dry | dry | off-dry | medium-sweet | sweet
    acidity: Optional[str] = None  # low | medium-minus | medium | medium-plus | high
    tannins: Optional[str] = None  # low | medium-minus | medium | medium-plus | high
    alcohol_pct: Optional[float] = None
    texture: Optional[str] = None  # silky | grippy | oily | etc
    finish: Optional[str] = None  # short | medium | long | very-long
    primary_aromas: Optional[List[str]] = None
    secondary_aromas: Optional[List[str]] = None
    tertiary_aromas: Optional[List[str]] = None

    # ── Layer 3: Quality + Production ──
    quality_level: Optional[str] = None  # basic | premium | super-premium | icon | cult
    classification_name: Optional[str] = None
    classification_system: Optional[str] = (
        None  # Bordeaux 1855 | Burgundy AOC | Italian DOCG | etc
    )
    reserve_status: Optional[str] = (
        None  # reserve | gran_reserva | riserva | unregulated_us | none
    )
    vintage_quality: Optional[str] = (
        None  # exceptional | excellent | very_good | good | average | non_vintage
    )
    farming: Optional[str] = (
        None  # conventional | sustainable | organic | biodynamic | natural
    )
    aging_vessel: Optional[str] = (
        None  # french_oak | american_oak | stainless_steel | concrete_egg | amphora
    )
    aging_duration: Optional[str] = None  # "18 months in French oak"
    serving_temp_celsius: Optional[int] = None
    glass_type: Optional[str] = None  # bordeaux | burgundy | flute | universal | coupe
    decanting_recommended: Optional[bool] = None
    aging_potential_years: Optional[int] = None
    food_pairings: Optional[List[str]] = None
    tasting_notes: Optional[str] = None
    bottle_volume: Optional[str] = None
    bottle_size_ml: Optional[int] = None
    price: Optional[float] = None
    price_currency: Optional[str] = None
    serving_type: Optional[str] = None  # glass | bottle | carafe
    rating_ws: Optional[str] = None  # Wine Spectator score
    rating_rp: Optional[str] = None  # Robert Parker / Wine Advocate
    rating_jr: Optional[str] = None  # Jancis Robinson

    # ── Metadata: Confidence + Governance ──
    confidence: float = 0.0  # Overall confidence (subject to Layer 1 Cap Rule)
    field_confidences: Dict[str, float] = Field(
        default_factory=dict
    )  # Per-field confidence
    field_sources: Dict[str, str] = Field(
        default_factory=dict
    )  # Per-field source types
    warnings: List[str] = Field(default_factory=list)
    library_tier: Optional[int] = (
        None  # 0=Canonical, 1=AutoValidated, 2=WebEnriched, 3=Provisional, 4=Unresolved
    )
    canonical_name_verified: bool = False
    in_master_library: bool = False
    master_wine_id: Optional[str] = None
    source: str = "menu_scan"

    # Backwards compatibility aliases (deprecated)
    rating: Optional[str] = None  # Legacy — use rating_ws/rating_rp/rating_jr
    classification: Optional[str] = (
        None  # Legacy — use classification_name + classification_system
    )


class MenuScanResponse(BaseModel):
    """Full menu scan result (multiple wines)."""

    wines_detected: int = 0
    wines: List[WineParsedResponse] = Field(default_factory=list)
    regions_detected: int = 0
    section_headers: List[str] = Field(default_factory=list)


class FuzzyMatchResult(BaseModel):
    """Individual fuzzy match result."""

    wine_id: str
    name: str
    producer: Optional[str] = None
    vintage: Optional[int] = None
    wine_type: Optional[str] = None
    similarity_score: float
    match_type: str
    match_phase: str


# ── Phase 3: YOLO 2-class Preview ─────────────────────────────────────────────


class PreviewDetectRequest(BaseModel):
    """Single camera frame for YOLO bounding box detection. Returns boxes only."""

    frame_base64: str = Field(
        ..., description="Base64-encoded JPEG or PNG of a camera frame"
    )
    confidence_threshold: float = Field(default=0.3, ge=0.0, le=1.0)


class BoundingBox(BaseModel):
    """Normalized [0-1] bounding box from YOLO 2-class inference."""

    x1: float
    y1: float
    x2: float
    y2: float
    label: str  # "wine_entry" or "section_header"
    confidence: float


class PreviewDetectResponse(BaseModel):
    """
    Bounding box detection result. Does NOT contain OCR text or wine data.
    YOLO output is UX preview only — extraction is separate (POST /api/v1/onboarding/extract).
    """

    boxes: List[BoundingBox]
    model_loaded: bool


# =============================================================================
# AGENT SINGLETONS (lazy initialised)
# =============================================================================

_menu_agent = None
_field_parser = None
_wine_matcher = None


def _get_menu_agent():
    """Get or create MenuAnalyzerAgent singleton for API use."""
    global _menu_agent
    if _menu_agent is not None:
        return _menu_agent

    from agents.menu_analyzer_agent import MenuAnalyzerAgent

    config = {
        "menu_model_path": settings.cv_menu_model_path,
        "confidence_threshold": 0.3,
        "mock_mode": settings.cv_yolov8_mock_mode,
        "google_api_key": settings.google_api_key,
        "ocr_languages": (
            settings.cv_ocr_languages.split(",")
            if isinstance(settings.cv_ocr_languages, str)
            else ["en"]
        ),
    }

    _menu_agent = MenuAnalyzerAgent(
        agent_name="menu_analyzer_api",
        message_bus=None,
        database=None,
        config=config,
    )
    return _menu_agent


def _get_field_parser():
    """Get WineFieldParser singleton."""
    global _field_parser
    if _field_parser is not None:
        return _field_parser

    from services.wine_field_parser import get_field_parser

    _field_parser = get_field_parser(
        google_api_key=settings.google_api_key,
        mock_mode=settings.mock_llm,
    )
    return _field_parser


def _get_wine_matcher():
    """Get WineMatcher singleton."""
    global _wine_matcher
    if _wine_matcher is not None:
        return _wine_matcher

    from services.wine_matcher import get_wine_matcher

    from core.database import get_supabase_client

    # None is legitimate (no database configured); the callee runs in mock /
    # degraded mode. An import fault is a wiring bug and must surface.
    supabase = get_supabase_client()

    _wine_matcher = get_wine_matcher(
        supabase_client=supabase,
        google_api_key=settings.google_api_key,
        mock_mode=settings.mock_llm,
    )
    return _wine_matcher


# =============================================================================
# ROUTES
# =============================================================================


@router.post("/wine", response_model=WineParsedResponse)
async def scan_wine(request: WineScanRequest):
    """
    Scan and interpret a single wine from OCR text or image.
    Routes through MenuAnalyzerAgent's field parser + matcher pipeline.
    Returns 25 structured fields with confidence and source annotations.
    """
    if not request.ocr_text and not request.image_base64:
        raise HTTPException(
            status_code=400, detail="Either ocr_text or image_base64 is required"
        )

    # If image provided, run through full agent pipeline
    if request.image_base64:
        agent = _get_menu_agent()
        result = await agent.process_menu_image(
            image_data=request.image_base64,
            restaurant_id=request.restaurant_id,
        )
        wines = result.get("wines", [])
        if wines:
            first = wines[0]
            return WineParsedResponse(
                **{
                    k: v
                    for k, v in first.items()
                    if k in WineParsedResponse.model_fields
                },
                source=f"{request.source_type}_scan",
            )
        raise HTTPException(status_code=404, detail="No wines detected in image")

    # Text-only: parse with field parser + match
    ocr_text = request.ocr_text or ""
    parser = _get_field_parser()
    parsed = await parser.parse(ocr_text=ocr_text, source_type=request.source_type)

    matcher = _get_wine_matcher()
    match_result = await matcher.match(
        wine_name=parsed.wine_name,
        producer=parsed.producer,
        vintage=parsed.vintage,
        wine_type=parsed.wine_type,
        restaurant_id=request.restaurant_id,
    )

    resp = parsed.model_dump()
    resp["source"] = f"{request.source_type}_scan"
    if match_result["matched"] and match_result["best_match"]:
        resp["in_master_library"] = True
        resp["master_wine_id"] = match_result["best_match"]["wine_id"]
        resp["canonical_name_verified"] = True
    else:
        resp["in_master_library"] = False

    # Queue Tier 2 wines for background web enrichment
    await _queue_enrichment_if_needed(resp, restaurant_id=request.restaurant_id)

    return WineParsedResponse(**resp)


@router.post("/menu", response_model=MenuScanResponse)
async def scan_menu(request: WineScanRequest):
    """
    Scan a full menu image and return all detected wines.
    Runs the complete 4-layer pipeline:
      YOLO (13-class) → OCR → Gemini field parser → library matching.
    """
    if not request.image_base64:
        raise HTTPException(
            status_code=400, detail="image_base64 is required for menu scanning"
        )

    agent = _get_menu_agent()
    result = await agent.process_menu_image(
        image_data=request.image_base64,
        restaurant_id=request.restaurant_id,
    )

    wines = []
    for w in result.get("wines", []):
        wine_data = {k: v for k, v in w.items() if k in WineParsedResponse.model_fields}
        wine_data["source"] = "menu_scan"
        # Queue Tier 2 wines for background enrichment
        await _queue_enrichment_if_needed(
            wine_data, restaurant_id=request.restaurant_id
        )
        wines.append(WineParsedResponse(**wine_data))

    return MenuScanResponse(
        wines_detected=result.get("wines_detected", 0),
        wines=wines,
        regions_detected=result.get("regions_detected", 0),
        section_headers=result.get("section_headers", []),
    )


@router.post("/wine-research")
async def research_wine(request: WineResearchRequest):
    """
    Deep research an unknown wine.
    Routes through WineMatcher's AI enrichment phase.
    """
    matcher = _get_wine_matcher()

    # First try matching (might find it in library)
    match_result = await matcher.match(
        wine_name=request.wine_name,
        producer=request.producer,
        vintage=request.vintage,
        restaurant_id=request.restaurant_id,
    )

    if match_result["matched"] and match_result["best_match"]:
        return {
            "found_in_library": True,
            "match": match_result["best_match"],
            "confidence": match_result["best_match"]["similarity_score"],
        }

    # Not found -- return enrichment data
    enrichment = match_result.get("enrichment")
    submitted = False

    if enrichment:
        from core.database import get_supabase_client
        import hashlib

        supabase = get_supabase_client()
        try:
            if supabase:
                payload = {
                    "name": enrichment.get("name", request.wine_name),
                    "producer": enrichment.get("producer", request.producer),
                    "vintage": enrichment.get("vintage", request.vintage),
                    "wine_type": enrichment.get("wine_type"),
                    "region": enrichment.get("region"),
                    "country": enrichment.get("country"),
                    "grape_variety": enrichment.get("grape_variety"),
                    "confidence": enrichment.get("confidence", 0.5),
                }
                sig_str = f"{payload.get('name','')}-{payload.get('producer','')}-{payload.get('vintage','')}".lower().strip()
                signature_hash = hashlib.sha256(sig_str.encode()).hexdigest()

                supabase.table("master_wine_library_submissions").insert(
                    {
                        "restaurant_id": request.restaurant_id,
                        "submitted_by": "gemini_research",
                        "payload": payload,
                        "signature_hash": signature_hash,
                        "status": "pending_review",
                    }
                ).execute()
                submitted = True
        except Exception as e:
            logger.warning(f"Failed to submit to library: {e}")

    return {
        "found_in_library": False,
        "enrichment": enrichment,
        "submitted_to_library": submitted,
        "confidence": enrichment.get("confidence", 0.5) if enrichment else 0.0,
    }


@router.post("/fuzzy-match")
async def fuzzy_match_wine(request: FuzzyMatchRequest):
    """
    Fuzzy match a wine name against the master wine library.
    Uses the canonical WineMatcher pipeline (text search → fuzzy scoring).
    """
    matcher = _get_wine_matcher()
    match_result = await matcher.match(
        wine_name=request.query,
        producer=request.producer,
        vintage=request.vintage,
        limit=request.limit,
    )

    candidates = match_result.get("candidates", [])
    results = [
        FuzzyMatchResult(
            wine_id=c["wine_id"],
            name=c["name"],
            producer=c.get("producer"),
            vintage=c.get("vintage"),
            wine_type=c.get("wine_type"),
            similarity_score=c["similarity_score"],
            match_type=c["match_type"],
            match_phase=c["match_phase"],
        )
        for c in candidates
    ]

    return {"matches": results}


# =============================================================================
# PDF WINE BOOK SCRAPING
# =============================================================================


class BookScrapeRequest(BaseModel):
    """Request to process a wine reference book/catalog PDF."""

    pdf_base64: str = Field(description="Base64-encoded PDF file")
    source_name: str = Field(
        default="uploaded_book", description="Name of the book/catalog"
    )
    restaurant_id: Optional[str] = None


@router.post("/book-scrape")
async def scrape_wine_book(request: BookScrapeRequest):
    """
    Process a wine reference book PDF through the hybrid extraction pipeline.
    PyPDF2 for text pages, Gemini Vision for image/table pages.
    Returns extracted wine entries with all 25 master_wine_library fields.
    """
    from services.wine_book_scraper import get_wine_book_scraper

    from core.database import get_supabase_client

    # None is legitimate (no database configured); the callee runs in mock /
    # degraded mode. An import fault is a wiring bug and must surface.
    supabase = get_supabase_client()

    scraper = get_wine_book_scraper(
        google_api_key=settings.google_api_key,
        supabase_client=supabase,
        mock_mode=settings.mock_llm,
    )

    try:
        pdf_bytes = base64.b64decode(request.pdf_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 PDF data")

    result = await scraper.process_pdf(
        pdf_bytes=pdf_bytes,
        source_name=request.source_name,
        restaurant_id=request.restaurant_id,
    )

    return result


# =============================================================================
# FREE-FIRST EXTRACTION ENDPOINTS
# =============================================================================


class TextExtractRequest(BaseModel):
    """Request to extract wines from raw text (HTML DOM or PDF text)."""

    text: str = Field(description="Raw text from HTML DOM, PyPDF2, or OCR")
    source_type: str = Field(default="html", description="html | pdf | ocr")
    restaurant_name: Optional[str] = None
    restaurant_city: Optional[str] = None


class PDFExtractRequest(BaseModel):
    """Request to extract wines from a PDF."""

    pdf_base64: str = Field(description="Base64-encoded PDF file")
    document_type: str = Field(default="menu", description="menu | invoice")
    restaurant_name: Optional[str] = None


class PhotoExtractRequest(BaseModel):
    """Request to extract wines from a photo (uses VLM)."""

    image_base64: str = Field(description="Base64-encoded image")
    document_type: str = Field(default="menu", description="menu | invoice")
    restaurant_name: Optional[str] = None
    mime_type: str = Field(default="image/jpeg")


@router.post("/extract/text")
async def extract_from_text(request: TextExtractRequest):
    """
    FREE path: Extract wines from raw text using the local parser.
    No API costs. Used for HTML DOM extractions and PDF text layers.
    """
    from services.wine_menu_classifier import get_classifier
    from services.html_menu_parser import get_menu_parser
    from services.quality_scorer import get_quality_scorer

    # Step 1: Classify
    classifier = get_classifier()
    classification = classifier.classify(request.text)

    if not classification.is_wine_menu:
        return {
            "success": False,
            "reason": f"Not a wine menu (type: {classification.content_type}, confidence: {classification.confidence:.2f})",
            "classification": {
                "is_wine_menu": classification.is_wine_menu,
                "content_type": classification.content_type,
                "confidence": classification.confidence,
                "estimated_wine_count": classification.estimated_wine_count,
            },
        }

    # Step 2: Parse
    parser = get_menu_parser()
    result = parser.parse_menu(
        request.text,
        source_type=request.source_type,
        restaurant_name=request.restaurant_name,
    )

    # Step 3: Quality score
    scorer = get_quality_scorer()
    quality = scorer.score_extraction(
        wines=result.wines,
        parser_confidence=result.parser_confidence,
        restaurant_name=request.restaurant_name or "",
    )

    return {
        "success": True,
        "extraction_method": "free_local_parser",
        "cost": 0.0,
        "wines": result.wines,
        "sections": result.sections,
        "total_wines": result.total_wines,
        "parser_confidence": result.parser_confidence,
        "quality": {
            "score": quality.composite_score,
            "decision": quality.decision,
            "flagged_for_review": quality.flagged_for_review,
        },
    }


@router.post("/extract/pdf")
async def extract_from_pdf(request: PDFExtractRequest):
    """
    FREE path: Extract wines from a PDF.
    Uses PyPDF2 for digital PDFs, Surya OCR for scanned PDFs.
    Falls back to Gemini TEXT only if parser confidence < 0.5.
    """
    from services.pdf_extraction_service import get_pdf_service

    try:
        pdf_bytes = base64.b64decode(request.pdf_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 PDF data")

    service = get_pdf_service()
    result = await service.extract_from_bytes(
        pdf_bytes,
        document_type=request.document_type,
        restaurant_name=request.restaurant_name,
    )

    # Check if we need VLM fallback
    needs_fallback = (
        result.overall_confidence < settings.scan_parser_confidence_threshold
        and result.total_wines == 0
    )

    vlm_result = None
    if needs_fallback and settings.scan_vlm_enabled:
        from services.vlm_extraction_service import get_vlm_service

        vlm = get_vlm_service()

        # Use TEXT fallback (cheaper than vision)
        combined_text = "\n".join(p.raw_text for p in result.pages if p.raw_text)
        if combined_text.strip():
            vlm_result = await vlm.extract_from_text(
                combined_text,
                document_type=request.document_type,
                restaurant_name=request.restaurant_name,
            )

    return {
        "success": True,
        "pdf_type": result.pdf_type,
        "total_pages": result.total_pages,
        "extraction_method": result.extraction_method,
        "cost": result.cost + (vlm_result.cost_estimate if vlm_result else 0.0),
        "wines": (
            vlm_result.wines
            if vlm_result and vlm_result.total_wines > result.total_wines
            else result.merged_wines
        ),
        "sections": result.merged_sections,
        "total_wines": max(
            vlm_result.total_wines if vlm_result else 0,
            result.total_wines,
        ),
        "confidence": max(
            vlm_result.confidence if vlm_result else 0.0,
            result.overall_confidence,
        ),
        "invoice_metadata": result.invoice_metadata,
        "fallback_used": vlm_result is not None,
        "warnings": result.warnings,
    }


@router.post("/extract/photo")
async def extract_from_photo(request: PhotoExtractRequest):
    """
    PAID path: Extract wines from a photo using Gemini Vision.
    Used for user photo uploads and live camera scans.
    Every call saved for future local VLM training.
    """
    from services.vlm_extraction_service import get_vlm_service

    try:
        image_bytes = base64.b64decode(request.image_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image data")

    vlm = get_vlm_service()
    result = await vlm.extract_from_image(
        image_bytes,
        document_type=request.document_type,
        restaurant_name=request.restaurant_name,
        mime_type=request.mime_type,
    )

    return {
        "success": True,
        "extraction_method": result.extraction_method,
        "model_used": result.model_used,
        "cost": result.cost_estimate,
        "wines": result.wines,
        "sections": result.sections,
        "total_wines": result.total_wines,
        "confidence": result.confidence,
        "invoice_metadata": result.invoice_metadata,
        "warnings": result.warnings,
    }


# =============================================================================
# CRAWLER & DISCOVERY ENDPOINTS
# =============================================================================


class DiscoveryRequest(BaseModel):
    """Request to discover restaurants in a city."""

    city_slug: str = Field(description="City slug (e.g. 'new-york')")
    max_pages: int = Field(default=5, ge=1, le=25)
    sources: List[str] = Field(
        default=["google_maps", "opentable"],
        description="Discovery sources to use",
    )
    auto_chain: Optional[bool] = Field(
        default=None,
        description="Auto-queue for crawling (None = use settings default)",
    )


class CrawlRequest(BaseModel):
    """Request to crawl a restaurant website."""

    website_url: str
    restaurant_name: str


@router.post("/crawler/discover")
async def discover_restaurants(request: DiscoveryRequest):
    """Discover restaurants in a city via Google Maps + OpenTable."""
    from services.unified_discovery import get_unified_discovery_service
    from services.opentable_discovery import CITY_CONFIGS

    city_config = next(
        (c for c in CITY_CONFIGS if c["slug"] == request.city_slug), None
    )
    if not city_config:
        raise HTTPException(
            status_code=400, detail=f"Unknown city: {request.city_slug}"
        )

    unified = get_unified_discovery_service(settings)
    result = await unified.discover_city(
        city_name=city_config["name"],
        state=city_config["state"],
        sources=request.sources,
        auto_chain=request.auto_chain,
    )

    return {
        "city": result.city,
        "google_maps_found": result.google_maps_found,
        "opentable_found": result.opentable_found,
        "total_after_dedup": result.total_after_dedup,
        "duplicates_removed": result.duplicates_removed,
        "saved_to_db": result.saved_to_db,
        "auto_chained": result.auto_chained,
        "errors": result.errors,
    }


@router.post("/crawler/crawl")
async def crawl_restaurant(request: CrawlRequest):
    """Crawl a single restaurant website for wine menu content."""
    from services.web_crawler import get_crawler_service

    crawler = get_crawler_service(rate_limit=settings.crawl_rate_limit_per_day)
    result = await crawler.crawl_restaurant(
        request.website_url, request.restaurant_name
    )

    return {
        "restaurant": result.restaurant_name,
        "url": result.website_url,
        "content_type": result.content_type.value,
        "text_length": len(result.extracted_text),
        "pdf_urls": result.pdf_urls,
        "content_hash": result.content_hash,
        "menu_page_url": result.menu_page_url,
        "duration_ms": result.crawl_duration_ms,
        "error": result.error,
    }


@router.get("/crawler/pending/{city_slug}")
async def get_pending_restaurants(city_slug: str):
    """Get restaurants pending crawl for a city."""
    from services.opentable_discovery import get_discovery_service

    discovery = get_discovery_service()
    city_name = city_slug.replace("-", " ").title()
    pending = discovery.get_pending_restaurants(city_name)

    return {
        "city": city_name,
        "pending_count": len(pending),
        "restaurants": pending[:50],
    }


@router.get("/crawler/stats")
async def get_crawler_stats():
    """Get crawler stats: per-source totals, crawl status breakdown, rate limits."""
    from services.web_crawler import get_crawler_service

    crawler = get_crawler_service(rate_limit=settings.crawl_rate_limit_per_day)
    sources = [s.strip() for s in settings.crawl_discovery_sources.split(",")]

    stats = {
        "remaining_today": crawler.remaining_today,
        "rate_limit_per_day": settings.crawl_rate_limit_per_day,
        "freshness_days": settings.crawl_freshness_days,
        "discovery_sources": sources,
        "auto_chain_enabled": settings.crawl_auto_chain_discovery_to_crawl,
        "google_maps_configured": bool(settings.google_maps_api_key),
    }

    # If Supabase is available, add aggregated counts
    try:
        from supabase import create_client

        sb = create_client(settings.supabase_url, settings.supabase_key)

        # Per-source counts
        all_rows = (
            sb.table("restaurant_directory")
            .select("discovery_sources,crawl_status,city")
            .execute()
        )
        if all_rows.data:
            source_counts: Dict[str, int] = {}
            status_counts: Dict[str, int] = {}
            city_counts: Dict[str, int] = {}
            for row in all_rows.data:
                for src in row.get("discovery_sources") or []:
                    source_counts[src] = source_counts.get(src, 0) + 1
                st = row.get("crawl_status", "pending")
                status_counts[st] = status_counts.get(st, 0) + 1
                ct = row.get("city", "unknown")
                city_counts[ct] = city_counts.get(ct, 0) + 1
            stats["per_source"] = source_counts
            stats["per_status"] = status_counts
            stats["per_city"] = city_counts
            stats["total_discovered"] = len(all_rows.data)
    except Exception:
        pass

    return stats


# =============================================================================
# RESTAURANT DATASET ENDPOINTS
# =============================================================================


@router.get("/restaurants/cities")
async def list_dataset_cities():
    """List all cities with restaurant menu datasets."""
    from services.restaurant_dataset_service import get_restaurant_dataset_service

    svc = get_restaurant_dataset_service()
    return {"cities": svc.get_all_cities()}


@router.get("/restaurants/{city}")
async def get_city_restaurants(city: str):
    """Get all restaurant menu snapshots for a city."""
    from services.restaurant_dataset_service import get_restaurant_dataset_service

    svc = get_restaurant_dataset_service()
    restaurants = svc.get_restaurants_by_city(city)
    return {"city": city, "count": len(restaurants), "restaurants": restaurants}


# =============================================================================
# QUALITY REVIEW ENDPOINTS
# =============================================================================


@router.get("/quality/queue")
async def get_review_queue():
    """Get items pending dev review."""
    from services.quality_scorer import get_quality_scorer

    scorer = get_quality_scorer()
    queue = scorer.get_review_queue()
    return {
        "pending": len(queue),
        "items": [
            {
                "review_id": r.review_id,
                "restaurant": r.restaurant_name,
                "score": r.quality_score,
                "reason": r.review_reason,
                "created_at": r.created_at,
            }
            for r in queue
        ],
    }


@router.post("/quality/approve/{review_id}")
async def approve_review(review_id: str):
    """Approve a quality review item."""
    from services.quality_scorer import get_quality_scorer
    from services.active_learning_service import get_active_learning_service

    scorer = get_quality_scorer()
    success = scorer.approve_review(review_id)

    if success:
        al = get_active_learning_service()
        # Find the review item to get its fields
        for r in scorer._review_queue:
            if r.review_id == review_id:
                fields = {}
                for w in r.extraction_data.get("wines", []):
                    fields.update(w)
                al.process_review_approval(review_id, fields)
                break

    return {"success": success, "review_id": review_id, "action": "approved"}


@router.post("/quality/reject/{review_id}")
async def reject_review(review_id: str):
    """Reject a quality review item."""
    from services.quality_scorer import get_quality_scorer

    scorer = get_quality_scorer()
    success = scorer.reject_review(review_id)
    return {"success": success, "review_id": review_id, "action": "rejected"}


class CorrectionRequest(BaseModel):
    """Corrections for a review item."""

    corrections: Dict[str, Any] = Field(description="Dict of field_name: correct_value")


@router.post("/quality/correct/{review_id}")
async def correct_review(review_id: str, request: CorrectionRequest):
    """Submit corrections for a review item."""
    from services.quality_scorer import get_quality_scorer
    from services.active_learning_service import get_active_learning_service

    scorer = get_quality_scorer()
    success = scorer.correct_review(review_id, request.corrections)

    if success:
        al = get_active_learning_service()
        # Build correction tuples
        for r in scorer._review_queue:
            if r.review_id == review_id:
                wines = r.extraction_data.get("wines", [])
                original = wines[0] if wines else {}
                correction_tuples = {
                    k: (original.get(k), v) for k, v in request.corrections.items()
                }
                al.process_review_correction(
                    review_id=review_id,
                    corrections=correction_tuples,
                )
                break

    return {"success": success, "review_id": review_id, "action": "corrected"}


@router.get("/quality/stats")
async def get_quality_stats():
    """Get quality review statistics."""
    from services.quality_scorer import get_quality_scorer

    scorer = get_quality_scorer()
    return scorer.get_review_stats()


# =============================================================================
# ACTIVE LEARNING ENDPOINTS
# =============================================================================


@router.get("/learning/accuracy")
async def get_accuracy_report():
    """Get parser accuracy report from active learning."""
    from services.active_learning_service import get_active_learning_service

    al = get_active_learning_service()
    return al.get_improvement_report()


@router.post("/learning/run-cycle")
async def run_learning_cycle():
    """Run one active learning improvement cycle.

    Status-code contract (deliberate, and symmetric with ``/learning/benchmark``
    below). The cycle has two halves: rule proposal from corrections, and the
    gold-set benchmark that is what makes those proposals trustworthy. When the
    gold set cannot assert accuracy — empty, below threshold, or present but
    with nothing comparable — the cycle produced *unvalidated* proposals, so a
    200 would put a green status code on a validation that never ran. That is
    the vacuous-pass failure mode ADR 0025 forbids, merely relocated from the
    body to the status line. So this fails loud with the same 503 the benchmark
    route already returns for the same corpus condition, and the two endpoints
    stop disagreeing about whether an unusable gold set is an error.

    A blanket 503 would be its own lie in the other direction, though:
    ``analyze_corrections`` genuinely ran and its proposals are real work. The
    503 body therefore carries the whole cycle payload (rules proposed, plus
    ``benchmark_skipped_reason``) instead of discarding it — the caller loses
    the green light, not the work.

    Rejected alternative: 200 whenever any non-benchmark work succeeded. That
    ties the status code to how many corrections happened to be queued, so the
    same broken gold set answers green on one call and red on the next; worse,
    the green case is exactly "rules proposed, nothing validated" — the state
    most dangerous to report as success.
    """
    from services.active_learning_service import get_active_learning_service

    al = get_active_learning_service()
    # run_improvement_cycle is total: it reports an unusable gold set rather
    # than raising, which is why both the empty and the not-comparable corpus
    # arrive here as a field instead of one 503 and one uncaught 500.
    result = al.run_improvement_cycle()
    if result.get("benchmark_skipped_reason"):
        raise HTTPException(status_code=503, detail=result)
    return result


@router.get("/learning/benchmark")
async def run_benchmark():
    """Run the parser against the gold-standard benchmark set.

    A benchmark over an empty/below-threshold gold set asserts nothing, so the
    oracle raises ``BenchmarkCorpusError`` rather than returning a vacuous 0.0.
    Surface that as a 503 (the check could not run) instead of a green 200 —
    the HTTP analogue of a guard's "exit 2 when it cannot check".
    """
    from services.active_learning_service import (
        get_active_learning_service,
        BenchmarkCorpusError,
    )

    al = get_active_learning_service()
    try:
        result = al.benchmark.run_benchmark()
    except BenchmarkCorpusError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return {
        "documents": result.total_documents,
        "wines": result.total_wines,
        "overall_accuracy": result.overall_accuracy,
        "field_accuracies": result.field_accuracies,
    }


# =============================================================================
# TRAINING DATA EXPORT
# =============================================================================


@router.get("/training-data/export")
async def export_training_data(
    dataset_type: Optional[str] = None,
    human_verified_only: bool = False,
    limit: int = 10000,
):
    """
    Export training data in JSONL format for LLM fine-tuning.
    """
    from services.training_data_store import get_training_data_store

    from core.database import get_supabase_client

    # None is legitimate (no database configured); the callee runs in mock /
    # degraded mode. An import fault is a wiring bug and must surface.
    supabase = get_supabase_client()

    store = get_training_data_store(
        supabase_client=supabase,
        mock_mode=settings.mock_llm,
    )

    jsonl = await store.export_jsonl(
        dataset_type=dataset_type,
        human_verified_only=human_verified_only,
        limit=limit,
    )

    from fastapi.responses import Response

    return Response(
        content=jsonl,
        media_type="application/jsonl",
        headers={
            "Content-Disposition": f"attachment; filename=training_data_{dataset_type or 'all'}.jsonl"
        },
    )


@router.get("/training-data/stats")
async def training_data_stats():
    """Get statistics about collected training data."""
    from services.training_data_store import get_training_data_store

    from core.database import get_supabase_client

    # None is legitimate (no database configured); the callee runs in mock /
    # degraded mode. An import fault is a wiring bug and must surface.
    supabase = get_supabase_client()

    store = get_training_data_store(
        supabase_client=supabase,
        mock_mode=settings.mock_llm,
    )

    return await store.get_stats()


# =============================================================================
# WEBSOCKET: LIVE YOLO PREVIEW
# =============================================================================

# Cache for YOLO model to avoid re-loading per frame
_yolo_model = None


def _get_yolo_model():
    """Get or create YOLOv8 model singleton for preview detection only."""
    global _yolo_model
    if _yolo_model is not None:
        return _yolo_model

    try:
        from ultralytics import YOLO

        model_path = settings.cv_menu_model_path
        if not model_path:
            logger.warning("cv_menu_model_path not set — YOLO preview disabled")
            return None
        from pathlib import Path

        if not Path(model_path).exists():
            logger.warning(f"YOLO model not found at {model_path} — preview disabled")
            return None
        _yolo_model = YOLO(model_path)
        logger.info("YOLO model loaded for live preview")
        return _yolo_model
    except Exception as e:
        logger.warning(f"Failed to load YOLO model for preview: {e}")
        return None


@router.websocket("/preview")
async def yolo_preview_ws(websocket: WebSocket):
    """
    WebSocket endpoint for real-time YOLO detection preview.

    Client sends: {"frame": "<base64 JPEG>"}
    Server responds: {"boxes": [{"x": float, "y": float, "width": float, "height": float, "label": str, "confidence": float}]}

    Throttled to max ~2 fps server-side. The client should also throttle.
    """
    await websocket.accept()
    logger.info("YOLO preview WebSocket connected")

    last_process_time = 0.0
    min_interval = 0.5  # 2 fps max

    try:
        while True:
            data = await websocket.receive_text()

            # Throttle processing
            now = time.time()
            if now - last_process_time < min_interval:
                # Skip this frame, respond with empty boxes
                await websocket.send_text(json.dumps({"boxes": []}))
                continue

            last_process_time = now

            try:
                msg = json.loads(data)
                frame_b64 = msg.get("frame")
                if not frame_b64:
                    await websocket.send_text(
                        json.dumps({"boxes": [], "error": "no frame"})
                    )
                    continue

                # Decode image
                import numpy as np
                from io import BytesIO
                from PIL import Image

                img_bytes = base64.b64decode(frame_b64)
                img = Image.open(BytesIO(img_bytes))
                img_array = np.array(img)

                # Run YOLO detection (fast, no OCR/Gemini)
                model = _get_yolo_model()
                if model is None:
                    await websocket.send_text(
                        json.dumps({"boxes": [], "error": "YOLO model not available"})
                    )
                    continue

                # Run inference with low confidence for preview
                results = model.predict(
                    img_array,
                    conf=0.25,
                    verbose=False,
                    imgsz=640,
                )

                boxes = []
                if results and len(results) > 0:
                    result = results[0]
                    if result.boxes is not None:
                        for box in result.boxes:
                            xyxy = box.xyxy[0].cpu().numpy()
                            conf = float(box.conf[0].cpu().numpy())
                            cls_id = int(box.cls[0].cpu().numpy())
                            label = model.names.get(cls_id, f"class_{cls_id}")

                            boxes.append(
                                {
                                    "x": float(xyxy[0]),
                                    "y": float(xyxy[1]),
                                    "width": float(xyxy[2] - xyxy[0]),
                                    "height": float(xyxy[3] - xyxy[1]),
                                    "label": label,
                                    "confidence": round(conf, 3),
                                    "classId": cls_id,
                                }
                            )

                await websocket.send_text(json.dumps({"boxes": boxes}))

            except json.JSONDecodeError:
                await websocket.send_text(
                    json.dumps({"boxes": [], "error": "invalid JSON"})
                )
            except Exception as e:
                logger.warning(f"YOLO preview frame error: {e}")
                await websocket.send_text(json.dumps({"boxes": [], "error": str(e)}))

    except WebSocketDisconnect:
        logger.info("YOLO preview WebSocket disconnected")
    except Exception as e:
        logger.error(f"YOLO preview WebSocket error: {e}")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# =============================================================================
# PREVIEW DETECT: Single-frame HTTP endpoint (POST)
# Counterpart to the WebSocket at /api/v1/scan/preview (streaming).
# =============================================================================


@router_preview.post("/detect", response_model=PreviewDetectResponse)
async def preview_detect(
    request: PreviewDetectRequest,
    _key: str = Depends(verify_admin_key),
):
    """
    POST /api/v1/preview/detect

    Accept a base64 camera frame, run YOLO 2-class inference, return bounding boxes.
    This endpoint returns boxes ONLY — it does not trigger wine extraction.
    Extraction is only triggered by POST /api/v1/onboarding/extract.

    Returns empty boxes with model_loaded=False if model is not available.
    """
    agent = _get_menu_agent()

    # Ensure agent is initialized (idempotent — safe to call multiple times)
    if agent.yolo_model is None and not hasattr(agent, "_initialized"):
        await agent.initialize()
        agent._initialized = True

    raw_boxes = await agent.detect_boxes(
        request.frame_base64,
        confidence=request.confidence_threshold,
    )

    boxes = [BoundingBox(**b) for b in raw_boxes]
    return PreviewDetectResponse(
        boxes=boxes,
        model_loaded=agent.yolo_model is not None,
    )
