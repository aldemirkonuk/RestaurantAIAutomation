"""
Image Collection API Routes
============================
Endpoints for collecting training images from multiple sources.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from config.settings import get_settings
from services.image_collector import (
    CollectionResult,
    ImageCategory,
    ImageSource,
    get_image_collector,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/collect", tags=["Image Collection"])

# =============================================================================
# REQUEST / RESPONSE MODELS
# =============================================================================


class GooglePlacesRequest(BaseModel):
    restaurant_name: str = Field(..., description="Restaurant name to search")
    location: Optional[str] = Field(None, description="City or address for narrowing search")
    max_photos: int = Field(10, ge=1, le=50)


class OpenTableRequest(BaseModel):
    restaurant_name: str = Field(..., description="Restaurant name to search on OpenTable")
    location: Optional[str] = Field(None, description="City or address")
    max_photos: int = Field(10, ge=1, le=50)


class YelpRequest(BaseModel):
    restaurant_name: str = Field(..., description="Restaurant name to search on Yelp")
    location: Optional[str] = Field(None, description="City or address")
    max_photos: int = Field(10, ge=1, le=50)


class VivinoRequest(BaseModel):
    wine_name: Optional[str] = Field(None, description="Wine name to search")
    search_query: Optional[str] = Field(None, description="General search query")
    max_photos: int = Field(10, ge=1, le=50)


class WebScrapeRequest(BaseModel):
    url: str = Field(..., description="URL of the restaurant/wine page to scrape")
    category: str = Field("menu", description="Image category: menu, label, invoice")
    max_photos: int = Field(10, ge=1, le=50)


class BatchCollectRequest(BaseModel):
    restaurant_name: str = Field(..., description="Restaurant name for all sources")
    location: Optional[str] = Field(None, description="City or address")
    max_photos_per_source: int = Field(10, ge=1, le=50)


class CollectionResponse(BaseModel):
    success: bool
    images_collected: int
    images_deduplicated: int
    images_stored: int
    errors: list[str]
    storage_paths: list[str]


# =============================================================================
# HELPER
# =============================================================================


def _get_collector():
    settings = get_settings()
    return get_image_collector(
        supabase_url=settings.supabase_url,
        supabase_key=settings.supabase_service_role_key or settings.supabase_anon_key,
        google_places_api_key=getattr(settings, "google_places_api_key", None),
        apify_token=getattr(settings, "apify_token", None),
        yelp_api_key=getattr(settings, "yelp_api_key", None),
    )


def _result_to_response(result: CollectionResult) -> CollectionResponse:
    return CollectionResponse(
        success=result.success,
        images_collected=result.images_collected,
        images_deduplicated=result.images_deduplicated,
        images_stored=result.images_stored,
        errors=result.errors,
        storage_paths=result.storage_paths,
    )


# =============================================================================
# ENDPOINTS
# =============================================================================


@router.post("/upload", response_model=CollectionResponse)
async def upload_image(
    file: UploadFile = File(...),
    category: str = Form("menu"),
    restaurant_name: Optional[str] = Form(None),
):
    """Upload a manual image for the training dataset."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    image_bytes = await file.read()
    if len(image_bytes) < 1000:
        raise HTTPException(status_code=400, detail="Image too small")

    ext = file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "jpg"

    try:
        cat = ImageCategory(category)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid category. Must be one of: {', '.join(c.value for c in ImageCategory)}",
        )

    collector = _get_collector()
    result = await collector.collect_from_source(
        source=ImageSource.MANUAL,
        image_bytes=image_bytes,
        category=cat,
        restaurant_name=restaurant_name,
        file_extension=ext,
    )
    return _result_to_response(result)


@router.post("/google-places", response_model=CollectionResponse)
async def collect_google_places(req: GooglePlacesRequest):
    """Collect menu photos from Google Places API."""
    collector = _get_collector()
    result = await collector.collect_from_source(
        source=ImageSource.GOOGLE_PLACES,
        restaurant_name=req.restaurant_name,
        location=req.location,
        max_photos=req.max_photos,
    )
    return _result_to_response(result)


@router.post("/opentable", response_model=CollectionResponse)
async def collect_opentable(req: OpenTableRequest):
    """Collect menu photos from OpenTable via Apify scraper."""
    collector = _get_collector()
    result = await collector.collect_from_source(
        source=ImageSource.OPENTABLE,
        restaurant_name=req.restaurant_name,
        location=req.location,
        max_photos=req.max_photos,
    )
    return _result_to_response(result)


@router.post("/yelp", response_model=CollectionResponse)
async def collect_yelp(req: YelpRequest):
    """Collect menu photos from Yelp Fusion API."""
    collector = _get_collector()
    result = await collector.collect_from_source(
        source=ImageSource.YELP,
        restaurant_name=req.restaurant_name,
        location=req.location,
        max_photos=req.max_photos,
    )
    return _result_to_response(result)


@router.post("/vivino", response_model=CollectionResponse)
async def collect_vivino(req: VivinoRequest):
    """Collect wine label images from Vivino."""
    collector = _get_collector()
    result = await collector.collect_from_source(
        source=ImageSource.VIVINO,
        wine_name=req.wine_name,
        search_query=req.search_query,
        max_photos=req.max_photos,
    )
    return _result_to_response(result)


@router.post("/web", response_model=CollectionResponse)
async def collect_web(req: WebScrapeRequest):
    """Scrape images from a generic web page."""
    try:
        cat = ImageCategory(req.category)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid category. Must be one of: {', '.join(c.value for c in ImageCategory)}",
        )

    collector = _get_collector()
    result = await collector.collect_from_source(
        source=ImageSource.WEB,
        url=req.url,
        category=cat,
        max_photos=req.max_photos,
    )
    return _result_to_response(result)


@router.post("/batch", response_model=CollectionResponse)
async def collect_batch(req: BatchCollectRequest):
    """Run all available adapters for a restaurant (Google Places, OpenTable, Yelp, Vivino)."""
    collector = _get_collector()
    result = await collector.collect_batch(
        restaurant_name=req.restaurant_name,
        location=req.location,
        max_photos_per_source=req.max_photos_per_source,
    )
    return _result_to_response(result)
