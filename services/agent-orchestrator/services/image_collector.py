"""
Multi-Source Image Collection Pipeline
=======================================
Collects wine menu, label, and invoice images from multiple sources
for YOLO model training data. Sources include:
- Manual upload (primary)
- Google Places API
- OpenTable via Apify
- Yelp Fusion API
- Vivino (wine labels)
- Generic web scraper

Features:
- Perceptual hash deduplication
- Supabase Storage integration
- Metadata tracking in collection_metadata table
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import logging
import re
import uuid
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum

import httpx
from PIL import Image

logger = logging.getLogger(__name__)


# =============================================================================
# DATA MODELS
# =============================================================================


class ImageSource(str, Enum):
    MANUAL = "manual"
    GOOGLE_PLACES = "google_places"
    OPENTABLE = "opentable"
    YELP = "yelp"
    VIVINO = "vivino"
    WEB = "web"


class ImageCategory(str, Enum):
    MENU = "menu"
    LABEL = "label"
    INVOICE = "invoice"


@dataclass
class CollectedImage:
    """Represents a collected image with metadata."""

    source: ImageSource
    category: ImageCategory
    image_bytes: bytes
    image_url: Optional[str] = None
    restaurant_name: Optional[str] = None
    file_extension: str = "jpg"
    dimensions: Optional[Tuple[int, int]] = None
    perceptual_hash: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class CollectionResult:
    """Result of a collection operation."""

    success: bool
    images_collected: int = 0
    images_deduplicated: int = 0
    images_stored: int = 0
    errors: List[str] = field(default_factory=list)
    storage_paths: List[str] = field(default_factory=list)


# =============================================================================
# PERCEPTUAL HASHING FOR DEDUPLICATION
# =============================================================================


def compute_average_hash(image_bytes: bytes, hash_size: int = 8) -> str:
    """
    Compute average perceptual hash (aHash) for image deduplication.
    Uses PIL directly to avoid external imagehash dependency.
    """
    try:
        img = Image.open(io.BytesIO(image_bytes))
        # Resize to hash_size x hash_size and convert to grayscale
        img = img.resize((hash_size, hash_size), Image.LANCZOS).convert("L")
        pixels = list(img.getdata())
        avg = sum(pixels) / len(pixels)
        # Build binary hash
        bits = "".join("1" if p > avg else "0" for p in pixels)
        # Convert to hex
        hex_hash = hex(int(bits, 2))[2:].zfill(hash_size * hash_size // 4)
        return hex_hash
    except Exception as e:
        logger.warning(f"Failed to compute perceptual hash: {e}")
        # Fallback to content hash
        return hashlib.sha256(image_bytes).hexdigest()[:16]


def compute_difference_hash(image_bytes: bytes, hash_size: int = 8) -> str:
    """
    Compute difference hash (dHash) for more robust deduplication.
    Compares adjacent pixels rather than average.
    """
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img = img.resize((hash_size + 1, hash_size), Image.LANCZOS).convert("L")
        pixels = list(img.getdata())
        bits = []
        for row in range(hash_size):
            for col in range(hash_size):
                left = pixels[row * (hash_size + 1) + col]
                right = pixels[row * (hash_size + 1) + col + 1]
                bits.append("1" if left > right else "0")
        hex_hash = hex(int("".join(bits), 2))[2:].zfill(hash_size * hash_size // 4)
        return hex_hash
    except Exception as e:
        logger.warning(f"Failed to compute difference hash: {e}")
        return hashlib.sha256(image_bytes).hexdigest()[:16]


def hamming_distance(hash1: str, hash2: str) -> int:
    """Compute Hamming distance between two hex hashes."""
    b1 = bin(int(hash1, 16))[2:]
    b2 = bin(int(hash2, 16))[2:]
    max_len = max(len(b1), len(b2))
    b1 = b1.zfill(max_len)
    b2 = b2.zfill(max_len)
    return sum(c1 != c2 for c1, c2 in zip(b1, b2))


# =============================================================================
# SOURCE ADAPTERS
# =============================================================================


class BaseAdapter(ABC):
    """Base class for image source adapters."""

    def __init__(self, http_client: Optional[httpx.AsyncClient] = None):
        self._client = http_client

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    @abstractmethod
    async def collect(self, **kwargs) -> List[CollectedImage]:
        """Collect images from the source."""
        ...

    async def _download_image(self, url: str) -> Optional[bytes]:
        """Download image bytes from a URL."""
        try:
            resp = await self.client.get(url, follow_redirects=True)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "")
            if "image" in content_type or len(resp.content) > 1000:
                return resp.content
            return None
        except Exception as e:
            logger.warning(f"Failed to download image from {url}: {e}")
            return None


class ManualUploadAdapter(BaseAdapter):
    """Passthrough adapter for manual image uploads."""

    async def collect(
        self,
        image_bytes: bytes,
        category: ImageCategory = ImageCategory.MENU,
        restaurant_name: Optional[str] = None,
        file_extension: str = "jpg",
        **kwargs,
    ) -> List[CollectedImage]:
        try:
            img = Image.open(io.BytesIO(image_bytes))
            dimensions = img.size
        except Exception:
            dimensions = None

        return [
            CollectedImage(
                source=ImageSource.MANUAL,
                category=category,
                image_bytes=image_bytes,
                restaurant_name=restaurant_name,
                file_extension=file_extension,
                dimensions=dimensions,
            )
        ]


class GooglePlacesAdapter(BaseAdapter):
    """Adapter for Google Places Photos API."""

    def __init__(self, api_key: str, http_client: Optional[httpx.AsyncClient] = None):
        super().__init__(http_client)
        self.api_key = api_key

    async def collect(
        self,
        restaurant_name: str,
        location: Optional[str] = None,
        max_photos: int = 10,
        **kwargs,
    ) -> List[CollectedImage]:
        images: List[CollectedImage] = []
        if not self.api_key:
            logger.warning("Google Places API key not configured")
            return images

        try:
            # Step 1: Find place
            search_url = (
                "https://maps.googleapis.com/maps/api/place/findplacefromtext/json"
            )
            query = f"{restaurant_name} restaurant menu"
            if location:
                query += f" {location}"

            resp = await self.client.get(
                search_url,
                params={
                    "input": query,
                    "inputtype": "textquery",
                    "fields": "place_id,name,photos",
                    "key": self.api_key,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            candidates = data.get("candidates", [])

            if not candidates:
                logger.info(f"No Google Places results for: {restaurant_name}")
                return images

            place = candidates[0]
            photos = place.get("photos", [])[:max_photos]

            # Step 2: Download each photo
            for photo in photos:
                photo_ref = photo.get("photo_reference")
                if not photo_ref:
                    continue

                photo_url = (
                    f"https://maps.googleapis.com/maps/api/place/photo"
                    f"?maxwidth=1600&photo_reference={photo_ref}&key={self.api_key}"
                )
                img_bytes = await self._download_image(photo_url)
                if img_bytes:
                    try:
                        img = Image.open(io.BytesIO(img_bytes))
                        dims = img.size
                    except Exception:
                        dims = None

                    images.append(
                        CollectedImage(
                            source=ImageSource.GOOGLE_PLACES,
                            category=ImageCategory.MENU,
                            image_bytes=img_bytes,
                            image_url=photo_url,
                            restaurant_name=restaurant_name,
                            dimensions=dims,
                            metadata={"photo_reference": photo_ref},
                        )
                    )

        except Exception as e:
            logger.error(f"Google Places collection failed: {e}")

        return images


class ApifyOpenTableAdapter(BaseAdapter):
    """Adapter for OpenTable scraping via Apify actor."""

    def __init__(
        self, apify_token: str, http_client: Optional[httpx.AsyncClient] = None
    ):
        super().__init__(http_client)
        self.apify_token = apify_token
        self.actor_id = "memo23/opentable-reviews-cheerio"

    async def collect(
        self,
        restaurant_name: str,
        location: Optional[str] = None,
        max_photos: int = 10,
        **kwargs,
    ) -> List[CollectedImage]:
        images: List[CollectedImage] = []
        if not self.apify_token:
            logger.warning("Apify token not configured")
            return images

        try:
            # Start Apify actor run
            run_url = f"https://api.apify.com/v2/acts/{self.actor_id}/runs"
            search_query = restaurant_name
            if location:
                search_query += f" {location}"

            resp = await self.client.post(
                run_url,
                params={"token": self.apify_token},
                json={
                    "searchQuery": search_query,
                    "maxResults": 3,
                    "includeMenu": True,
                    "includePhotos": True,
                },
                timeout=120.0,
            )
            resp.raise_for_status()
            run_data = resp.json()
            run_id = run_data.get("data", {}).get("id")

            if not run_id:
                logger.warning("Failed to start Apify actor run")
                return images

            # Poll for completion (max 2 minutes)
            dataset_url = f"https://api.apify.com/v2/actor-runs/{run_id}/dataset/items"
            for _ in range(24):
                await asyncio.sleep(5)
                status_resp = await self.client.get(
                    f"https://api.apify.com/v2/actor-runs/{run_id}",
                    params={"token": self.apify_token},
                )
                status = status_resp.json().get("data", {}).get("status")
                if status == "SUCCEEDED":
                    break
                if status in ("FAILED", "ABORTED"):
                    logger.warning(f"Apify run {status}")
                    return images
            else:
                logger.warning("Apify run timed out")
                return images

            # Fetch results
            items_resp = await self.client.get(
                dataset_url, params={"token": self.apify_token}
            )
            items = items_resp.json()

            for item in items:
                menu_photos = item.get("menuPhotos", []) or item.get("photos", [])
                for photo_url in menu_photos[:max_photos]:
                    if isinstance(photo_url, dict):
                        photo_url = photo_url.get("url", "")
                    if not photo_url:
                        continue

                    img_bytes = await self._download_image(photo_url)
                    if img_bytes:
                        try:
                            img = Image.open(io.BytesIO(img_bytes))
                            dims = img.size
                        except Exception:
                            dims = None
                        images.append(
                            CollectedImage(
                                source=ImageSource.OPENTABLE,
                                category=ImageCategory.MENU,
                                image_bytes=img_bytes,
                                image_url=photo_url,
                                restaurant_name=item.get("name", restaurant_name),
                                dimensions=dims,
                                metadata={"opentable_id": item.get("id")},
                            )
                        )

        except Exception as e:
            logger.error(f"OpenTable/Apify collection failed: {e}")

        return images


class YelpAdapter(BaseAdapter):
    """Adapter for Yelp Fusion API menu photos."""

    def __init__(self, api_key: str, http_client: Optional[httpx.AsyncClient] = None):
        super().__init__(http_client)
        self.api_key = api_key

    async def collect(
        self,
        restaurant_name: str,
        location: Optional[str] = None,
        max_photos: int = 10,
        **kwargs,
    ) -> List[CollectedImage]:
        images: List[CollectedImage] = []
        if not self.api_key:
            logger.warning("Yelp API key not configured")
            return images

        try:
            headers = {"Authorization": f"Bearer {self.api_key}"}

            # Step 1: Search for business
            search_url = "https://api.yelp.com/v3/businesses/search"
            params = {"term": f"{restaurant_name} restaurant", "limit": 3}
            if location:
                params["location"] = location

            resp = await self.client.get(search_url, headers=headers, params=params)
            resp.raise_for_status()
            businesses = resp.json().get("businesses", [])

            for biz in businesses[:1]:
                biz_id = biz.get("id")
                if not biz_id:
                    continue

                # Step 2: Get business photos
                photos_url = f"https://api.yelp.com/v3/businesses/{biz_id}"
                photos_resp = await self.client.get(photos_url, headers=headers)
                photos_resp.raise_for_status()
                biz_data = photos_resp.json()
                photo_urls = biz_data.get("photos", [])[:max_photos]

                for photo_url in photo_urls:
                    img_bytes = await self._download_image(photo_url)
                    if img_bytes:
                        try:
                            img = Image.open(io.BytesIO(img_bytes))
                            dims = img.size
                        except Exception:
                            dims = None
                        images.append(
                            CollectedImage(
                                source=ImageSource.YELP,
                                category=ImageCategory.MENU,
                                image_bytes=img_bytes,
                                image_url=photo_url,
                                restaurant_name=biz_data.get("name", restaurant_name),
                                dimensions=dims,
                                metadata={"yelp_id": biz_id},
                            )
                        )

        except Exception as e:
            logger.error(f"Yelp collection failed: {e}")

        return images


class VivinoAdapter(BaseAdapter):
    """Adapter for Vivino wine label images."""

    async def collect(
        self,
        wine_name: Optional[str] = None,
        search_query: Optional[str] = None,
        max_photos: int = 10,
        **kwargs,
    ) -> List[CollectedImage]:
        images: List[CollectedImage] = []
        query = wine_name or search_query or "wine"

        try:
            # Vivino has an unofficial API; use their explore endpoint
            explore_url = "https://www.vivino.com/api/explore/explore"
            resp = await self.client.get(
                explore_url,
                params={
                    "q": query,
                    "page": 1,
                    "per_page": max_photos,
                },
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
                },
            )
            if resp.status_code != 200:
                logger.info(f"Vivino search returned status {resp.status_code}")
                return images

            data = resp.json()
            matches = data.get("explore_vintage", {}).get("matches", [])

            for match in matches[:max_photos]:
                vintage = match.get("vintage", {})
                wine = vintage.get("wine", {})
                image_info = vintage.get("image", {}) or wine.get("image", {})
                img_url = image_info.get("location") or ""

                if not img_url:
                    continue

                # Ensure full URL
                if img_url.startswith("//"):
                    img_url = f"https:{img_url}"

                img_bytes = await self._download_image(img_url)
                if img_bytes:
                    try:
                        img = Image.open(io.BytesIO(img_bytes))
                        dims = img.size
                    except Exception:
                        dims = None
                    images.append(
                        CollectedImage(
                            source=ImageSource.VIVINO,
                            category=ImageCategory.LABEL,
                            image_bytes=img_bytes,
                            image_url=img_url,
                            restaurant_name=None,
                            dimensions=dims,
                            metadata={
                                "wine_name": wine.get("name"),
                                "winery": wine.get("winery", {}).get("name"),
                                "vintage_year": vintage.get("year"),
                            },
                        )
                    )

        except Exception as e:
            logger.error(f"Vivino collection failed: {e}")

        return images


class GenericWebAdapter(BaseAdapter):
    """Generic web scraper that finds menu/wine images on any restaurant URL."""

    MENU_IMAGE_PATTERNS = [
        r"menu",
        r"wine.?list",
        r"carte",
        r"drink",
        r"bottle",
        r"vintage",
        r"cellar",
        r"sommelier",
    ]

    async def collect(
        self,
        url: str,
        category: ImageCategory = ImageCategory.MENU,
        max_photos: int = 10,
        **kwargs,
    ) -> List[CollectedImage]:
        images: List[CollectedImage] = []
        if not url:
            return images

        try:
            resp = await self.client.get(
                url,
                follow_redirects=True,
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
                },
            )
            resp.raise_for_status()
            html = resp.text

            # Extract image URLs from HTML
            img_pattern = re.compile(r'<img[^>]+src=["\']([^"\']+)["\']', re.IGNORECASE)
            all_img_urls = img_pattern.findall(html)

            # Also check srcset
            srcset_pattern = re.compile(r'srcset=["\']([^"\']+)["\']', re.IGNORECASE)
            for srcset in srcset_pattern.findall(html):
                for entry in srcset.split(","):
                    parts = entry.strip().split()
                    if parts:
                        all_img_urls.append(parts[0])

            # Filter for likely menu/wine images
            pattern = re.compile("|".join(self.MENU_IMAGE_PATTERNS), re.IGNORECASE)
            candidate_urls = []
            for img_url in all_img_urls:
                # Skip tiny icons and data URIs
                if img_url.startswith("data:") or len(img_url) < 10:
                    continue
                # Resolve relative URLs
                if img_url.startswith("//"):
                    img_url = f"https:{img_url}"
                elif img_url.startswith("/"):
                    from urllib.parse import urlparse

                    parsed = urlparse(url)
                    img_url = f"{parsed.scheme}://{parsed.netloc}{img_url}"
                elif not img_url.startswith("http"):
                    img_url = f"{url.rstrip('/')}/{img_url}"

                if pattern.search(img_url) or pattern.search(html[:500]):
                    candidate_urls.append(img_url)

            # If no pattern matches, just take larger images
            if not candidate_urls:
                candidate_urls = [
                    u
                    for u in all_img_urls
                    if u.startswith("http") and not u.startswith("data:")
                ]

            # Download candidates
            for img_url in candidate_urls[:max_photos]:
                img_bytes = await self._download_image(img_url)
                if img_bytes and len(img_bytes) > 5000:  # Skip tiny images
                    try:
                        img = Image.open(io.BytesIO(img_bytes))
                        dims = img.size
                        # Skip very small images (icons)
                        if dims[0] < 200 or dims[1] < 200:
                            continue
                    except Exception:
                        dims = None
                    images.append(
                        CollectedImage(
                            source=ImageSource.WEB,
                            category=category,
                            image_bytes=img_bytes,
                            image_url=img_url,
                            dimensions=dims,
                            metadata={"source_page": url},
                        )
                    )

        except Exception as e:
            logger.error(f"Web scraping collection from {url} failed: {e}")

        return images


# =============================================================================
# IMAGE COLLECTOR SERVICE
# =============================================================================


class ImageCollectorService:
    """
    Central service for collecting images from multiple sources.
    Handles deduplication, storage, and metadata tracking.
    """

    # Maximum Hamming distance to consider two images as duplicates
    DEDUP_THRESHOLD = 5

    def __init__(
        self,
        supabase_url: Optional[str] = None,
        supabase_key: Optional[str] = None,
        google_places_api_key: Optional[str] = None,
        apify_token: Optional[str] = None,
        yelp_api_key: Optional[str] = None,
    ):
        self.supabase_url = supabase_url
        self.supabase_key = supabase_key
        self._supabase = None

        self._http_client: Optional[httpx.AsyncClient] = None

        # Initialize adapters
        self.adapters: Dict[ImageSource, BaseAdapter] = {}
        self.adapters[ImageSource.MANUAL] = ManualUploadAdapter()
        if google_places_api_key:
            self.adapters[ImageSource.GOOGLE_PLACES] = GooglePlacesAdapter(
                google_places_api_key
            )
        if apify_token:
            self.adapters[ImageSource.OPENTABLE] = ApifyOpenTableAdapter(apify_token)
        if yelp_api_key:
            self.adapters[ImageSource.YELP] = YelpAdapter(yelp_api_key)
        self.adapters[ImageSource.VIVINO] = VivinoAdapter()
        self.adapters[ImageSource.WEB] = GenericWebAdapter()

        # In-memory hash cache for session dedup
        self._hash_cache: Dict[str, str] = {}

        logger.info(
            f"ImageCollectorService initialized with {len(self.adapters)} adapters: "
            f"{', '.join(a.value for a in self.adapters.keys())}"
        )

    @property
    def http_client(self) -> httpx.AsyncClient:
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(timeout=30.0)
        return self._http_client

    def _get_supabase(self):
        if self._supabase is None and self.supabase_url and self.supabase_key:
            from supabase import create_client

            self._supabase = create_client(self.supabase_url, self.supabase_key)
        return self._supabase

    async def collect_from_source(
        self,
        source: ImageSource,
        **kwargs,
    ) -> CollectionResult:
        """Collect images from a single source."""
        adapter = self.adapters.get(source)
        if not adapter:
            return CollectionResult(
                success=False,
                errors=[f"No adapter configured for source: {source.value}"],
            )

        try:
            raw_images = await adapter.collect(**kwargs)
            return await self._process_and_store(raw_images)
        except Exception as e:
            logger.error(f"Collection from {source.value} failed: {e}")
            return CollectionResult(success=False, errors=[str(e)])

    async def collect_batch(
        self,
        restaurant_name: str,
        location: Optional[str] = None,
        max_photos_per_source: int = 10,
    ) -> CollectionResult:
        """Run all available adapters for a restaurant."""
        all_images: List[CollectedImage] = []
        errors: List[str] = []

        tasks = []
        for source, adapter in self.adapters.items():
            if source == ImageSource.MANUAL:
                continue  # Manual requires explicit bytes
            if source == ImageSource.WEB:
                continue  # Web requires explicit URL

            kwargs = {
                "restaurant_name": restaurant_name,
                "location": location,
                "max_photos": max_photos_per_source,
            }

            tasks.append((source, adapter.collect(**kwargs)))

        results = await asyncio.gather(*(t[1] for t in tasks), return_exceptions=True)

        for (source, _), result in zip(tasks, results):
            if isinstance(result, Exception):
                errors.append(f"{source.value}: {result}")
            elif isinstance(result, list):
                all_images.extend(result)

        collection_result = await self._process_and_store(all_images)
        collection_result.errors.extend(errors)
        return collection_result

    async def _process_and_store(
        self, images: List[CollectedImage]
    ) -> CollectionResult:
        """Deduplicate, store, and record metadata for collected images."""
        result = CollectionResult(success=True, images_collected=len(images))
        dedup_count = 0
        stored_count = 0

        for image in images:
            # Compute perceptual hash
            p_hash = compute_difference_hash(image.image_bytes)
            image.perceptual_hash = p_hash

            # Check for duplicates against in-memory cache
            is_dup = False
            for cached_hash in self._hash_cache.values():
                if hamming_distance(p_hash, cached_hash) <= self.DEDUP_THRESHOLD:
                    is_dup = True
                    break

            if is_dup:
                dedup_count += 1
                continue

            # Check against database for existing hashes
            if await self._check_db_duplicate(p_hash):
                dedup_count += 1
                continue

            # Store in Supabase Storage
            storage_path = await self._store_image(image)
            if storage_path:
                self._hash_cache[storage_path] = p_hash
                result.storage_paths.append(storage_path)
                stored_count += 1

                # Record metadata
                await self._record_metadata(image, storage_path)

        result.images_deduplicated = dedup_count
        result.images_stored = stored_count
        return result

    async def _check_db_duplicate(self, p_hash: str) -> bool:
        """Check if a perceptual hash already exists in the database."""
        supabase = self._get_supabase()
        if not supabase:
            return False

        try:
            resp = (
                supabase.table("collection_metadata")
                .select("id,perceptual_hash")
                .eq("perceptual_hash", p_hash)
                .limit(1)
                .execute()
            )
            return len(resp.data) > 0
        except Exception as e:
            logger.debug(f"DB duplicate check failed (non-critical): {e}")
            return False

    async def _store_image(self, image: CollectedImage) -> Optional[str]:
        """Store image in Supabase Storage."""
        supabase = self._get_supabase()
        if not supabase:
            logger.debug("Supabase not configured; skipping storage")
            return f"local/{image.source.value}/{image.category.value}/{uuid.uuid4()}.{image.file_extension}"

        try:
            file_id = str(uuid.uuid4())
            path = f"training-images/{image.source.value}/{image.category.value}/{file_id}.{image.file_extension}"

            supabase.storage.from_("training-images").upload(
                path,
                image.image_bytes,
                {"content-type": f"image/{image.file_extension}"},
            )

            return path
        except Exception as e:
            logger.error(f"Failed to store image: {e}")
            return None

    async def _record_metadata(self, image: CollectedImage, storage_path: str) -> None:
        """Insert metadata into collection_metadata table."""
        supabase = self._get_supabase()
        if not supabase:
            return

        try:
            record = {
                "source": image.source.value,
                "category": image.category.value,
                "image_url": image.image_url,
                "storage_path": storage_path,
                "perceptual_hash": image.perceptual_hash,
                "dimensions": (
                    {"width": image.dimensions[0], "height": image.dimensions[1]}
                    if image.dimensions
                    else None
                ),
                "file_size_bytes": len(image.image_bytes),
                "restaurant_name": image.restaurant_name,
                "annotated": False,
            }

            supabase.table("collection_metadata").insert(record).execute()
        except Exception as e:
            logger.warning(f"Failed to record metadata (non-critical): {e}")

    async def close(self):
        """Cleanup resources."""
        if self._http_client:
            await self._http_client.aclose()


# =============================================================================
# SINGLETON ACCESS
# =============================================================================

_collector_instance: Optional[ImageCollectorService] = None


def get_image_collector(
    supabase_url: Optional[str] = None,
    supabase_key: Optional[str] = None,
    google_places_api_key: Optional[str] = None,
    apify_token: Optional[str] = None,
    yelp_api_key: Optional[str] = None,
) -> ImageCollectorService:
    """Get or create the singleton ImageCollectorService."""
    global _collector_instance
    if _collector_instance is None:
        _collector_instance = ImageCollectorService(
            supabase_url=supabase_url,
            supabase_key=supabase_key,
            google_places_api_key=google_places_api_key,
            apify_token=apify_token,
            yelp_api_key=yelp_api_key,
        )
    return _collector_instance
