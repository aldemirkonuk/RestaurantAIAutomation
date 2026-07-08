"""
Restaurant Website Crawler
===========================
Phase B of the two-phase crawling architecture.
Visits restaurant websites (from OpenTable discovery queue) and
extracts wine menu content using the FREE-first approach.

Flow:
  1. Read pending URLs from restaurant_directory
  2. Check robots.txt before launching Playwright browser (GMFL-04)
  3. Playwright visits restaurant's own website
  4. Detect content: HTML menu? PDF link? Image-only?
  5. Extract text via DOM (HTML) or download PDF
  6. Call GeminiFlashCrawlerExtractor to extract wine data (GMFL-02)
  7. Deduplicate against master_wine_library (GMFL-05)
  8. Save to restaurant menu dataset JSONL (GMFL-03)

Rate: 100 websites/day (configurable via CRAWL_RATE_LIMIT env var)
Note: _daily_count is in-memory only — resets on service restart. Known limitation.
Legal: Only visits restaurant's own website, respects robots.txt.
"""

import asyncio
import base64
import hashlib
import json
import logging
import re
import ssl
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import aiohttp

from services.vlm_extraction_service import get_gemini_crawler_extractor
from services.claude_vision_extractor import get_claude_vision_extractor

try:
    from playwright.async_api import async_playwright
except ImportError:
    async_playwright = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[3]
CRAWL_CACHE_DIR = PROJECT_ROOT / "datasets" / "scraped" / "menus"
RESTAURANT_MENUS_DIR = PROJECT_ROOT / "datasets" / "restaurant_menus"


# =============================================================================
# DATA MODELS
# =============================================================================


class ContentType(str, Enum):
    HTML_MENU = "html_menu"
    PDF_LINK = "pdf_link"
    IMAGE_ONLY = "image_only"
    NO_MENU = "no_menu"
    ERROR = "error"


@dataclass
class VisitedUrl:
    """A URL visited during a crawl with its result."""

    url: str
    content_type: str
    http_status: Optional[int] = None


@dataclass
class CrawlResult:
    """Result of crawling a single restaurant website."""

    restaurant_name: str
    website_url: str
    content_type: ContentType = ContentType.NO_MENU
    extracted_text: str = ""
    pdf_urls: List[str] = field(default_factory=list)
    pdf_bytes: Optional[bytes] = None
    screenshot_bytes: Optional[bytes] = None
    content_hash: str = ""
    menu_page_url: str = ""
    crawl_duration_ms: int = 0
    error: Optional[str] = None
    restaurant_id: Optional[str] = None
    visited_urls: List[VisitedUrl] = field(default_factory=list)
    image_menu_detected: bool = False  # True when Vision path was taken (Phase 6)
    wines: List[Dict[str, Any]] = field(
        default_factory=list
    )  # Phase 11: accumulated by _persist_crawled_wines for diff engine


@dataclass
class CrawlSessionResult:
    """Result of a crawling session."""

    total_crawled: int = 0
    menus_found: int = 0
    pdfs_found: int = 0
    no_menu: int = 0
    errors: int = 0
    details: List[Dict[str, Any]] = field(default_factory=list)


# =============================================================================
# MENU LINK DETECTION PATTERNS
# =============================================================================

MENU_LINK_PATTERNS = [
    re.compile(r"wine\s*(?:list|menu|card|program)", re.I),
    re.compile(r"(?:drink|beverage)\s*menu", re.I),
    re.compile(r"(?:our|the)\s*wines?", re.I),
    re.compile(r"wine\s*(?:by|selection)", re.I),
    re.compile(r"cellar|sommelier", re.I),
]

PDF_LINK_PATTERNS = [
    re.compile(r"\.pdf(?:\?|$)", re.I),
    re.compile(r"wine.*\.pdf", re.I),
    re.compile(r"menu.*\.pdf", re.I),
]

MENU_PAGE_PATTERNS = [
    re.compile(r"/(?:wine|wines|wine-list|wine-menu|drinks|beverage)/?", re.I),
    re.compile(r"/(?:menu|menus)/?.*(?:wine|drink|beverage)", re.I),
    re.compile(r"/(?:cellar|bar-menu|cocktails-wine)/?", re.I),
]


# =============================================================================
# CRAWLER SERVICE
# =============================================================================


class WebCrawlerService:
    """
    Playwright-based restaurant website crawler.
    Extracts wine menu content for FREE-first processing.
    """

    CRAWL_RATE_LIMIT = 100  # websites per day
    PAGE_TIMEOUT_MS = 20000
    NAVIGATION_DELAY_S = 1.5

    def __init__(self, rate_limit: Optional[int] = None, supabase_client=None):
        self._daily_count = 0
        self._rate_limit = rate_limit or self.CRAWL_RATE_LIMIT
        self._supabase = supabase_client
        CRAWL_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    # =========================================================================
    # MAIN CRAWL
    # =========================================================================

    async def crawl_restaurant(
        self, website_url: str, restaurant_name: str
    ) -> CrawlResult:
        """
        Crawl a single restaurant website to find and extract wine menu.

        Args:
            website_url: Restaurant's own website URL.
            restaurant_name: Restaurant name for context.
        """
        import time

        start = time.monotonic()

        result = CrawlResult(
            restaurant_name=restaurant_name,
            website_url=website_url,
        )

        # Rate limit check (GMFL-04)
        if self._daily_count >= self._rate_limit:
            result.error = f"Daily rate limit reached ({self._rate_limit})"
            result.content_type = ContentType.ERROR
            return result

        # robots.txt check (GMFL-04)
        if not await self._is_crawl_allowed(website_url):
            result.error = f"robots.txt disallows crawling {website_url}"
            result.content_type = ContentType.ERROR
            return result

        if async_playwright is None:
            result.error = "Playwright not installed"
            result.content_type = ContentType.ERROR
            return result

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
            )
            page = await context.new_page()

            try:
                # Step 1: Visit homepage
                resp = await page.goto(
                    website_url,
                    wait_until="domcontentloaded",
                    timeout=self.PAGE_TIMEOUT_MS,
                )
                result.visited_urls.append(
                    VisitedUrl(
                        url=website_url,
                        content_type="homepage",
                        http_status=resp.status if resp else None,
                    )
                )
                await asyncio.sleep(self.NAVIGATION_DELAY_S)

                # Step 2: Look for wine menu links
                menu_url, pdf_urls = await self._find_menu_links(page, website_url)

                # Step 3: If wine menu page found, navigate to it
                if menu_url:
                    menu_resp = await page.goto(
                        menu_url,
                        wait_until="domcontentloaded",
                        timeout=self.PAGE_TIMEOUT_MS,
                    )
                    result.visited_urls.append(
                        VisitedUrl(
                            url=menu_url,
                            content_type="menu_page",
                            http_status=menu_resp.status if menu_resp else None,
                        )
                    )
                    await asyncio.sleep(self.NAVIGATION_DELAY_S)
                    result.menu_page_url = menu_url

                # Step 4: Extract content
                if pdf_urls:
                    result.content_type = ContentType.PDF_LINK
                    result.pdf_urls = pdf_urls
                    result.pdf_bytes = await self._download_pdf(context, pdf_urls[0])
                    for purl in pdf_urls:
                        result.visited_urls.append(
                            VisitedUrl(
                                url=purl,
                                content_type="pdf_link",
                            )
                        )
                    if result.pdf_bytes:
                        await self._handle_pdf_vision(
                            result, restaurant_name, website_url
                        )
                else:
                    text = await self._extract_page_text(page)
                    if text and len(text.strip()) > 100:
                        result.content_type = ContentType.HTML_MENU
                        result.extracted_text = text
                    else:
                        has_images = await self._check_image_menu(page)
                        if not has_images:
                            has_images = await self._is_image_menu(page)
                        if has_images:
                            result.content_type = ContentType.IMAGE_ONLY
                            result.screenshot_bytes = await page.screenshot(
                                full_page=True, type="jpeg", quality=85
                            )
                            await self._handle_image_menu(
                                page, result, restaurant_name, website_url
                            )
                        else:
                            result.content_type = ContentType.NO_MENU

                # Content hash for freshness tracking
                content = result.extracted_text or str(result.pdf_urls)
                result.content_hash = hashlib.md5(content.encode()).hexdigest()

                # Gemini Flash extraction + dedup + persist (GMFL-02, GMFL-03, GMFL-05)
                if (
                    result.content_type == ContentType.HTML_MENU
                    and result.extracted_text
                ):
                    extractor = get_gemini_crawler_extractor()
                    extraction = await extractor.extract_from_text(
                        result.extracted_text, restaurant_name
                    )
                    if extraction.wines:
                        non_dupes = [
                            w
                            for w in extraction.wines
                            if not self._wine_is_duplicate(w, restaurant_name)
                        ]
                        if non_dupes:
                            self._persist_crawled_wines(
                                non_dupes, restaurant_name, website_url, result=result
                            )
                        logger.info(
                            f"Crawled {restaurant_name}: {len(extraction.wines)} wines found, "
                            f"{len(extraction.wines) - len(non_dupes)} duplicates skipped"
                        )
                    elif await self._is_image_menu(page):
                        await self._handle_image_menu(
                            page, result, restaurant_name, website_url
                        )

            except Exception as e:
                result.error = str(e)
                result.content_type = ContentType.ERROR
                logger.error(f"Crawl failed for {website_url}: {e}")

            finally:
                await browser.close()

        result.crawl_duration_ms = int((time.monotonic() - start) * 1000)
        self._daily_count += 1

        # Cache the result
        self._cache_result(result)

        # Log all visited URLs to crawl_log
        self._log_crawl_to_db(result)

        return result

    async def crawl_batch(
        self,
        restaurants: List[Dict[str, Any]],
        max_count: Optional[int] = None,
    ) -> CrawlSessionResult:
        """
        Crawl a batch of restaurants from the discovery queue.

        Args:
            restaurants: List of restaurant dicts with website_url and restaurant_name.
            max_count: Max restaurants to crawl in this session.
        """
        limit = min(
            max_count or self._rate_limit,
            self._rate_limit - self._daily_count,
        )
        session = CrawlSessionResult()

        for rest in restaurants[:limit]:
            url = rest.get("website_url")
            name = rest.get("restaurant_name", "Unknown")

            if not url:
                continue

            result = await self.crawl_restaurant(url, name)
            session.total_crawled += 1

            if result.content_type == ContentType.HTML_MENU:
                session.menus_found += 1
            elif result.content_type == ContentType.PDF_LINK:
                session.pdfs_found += 1
            elif result.content_type == ContentType.NO_MENU:
                session.no_menu += 1
            elif result.content_type == ContentType.ERROR:
                session.errors += 1

            session.details.append(
                {
                    "restaurant": name,
                    "url": url,
                    "content_type": result.content_type.value,
                    "text_length": len(result.extracted_text),
                    "pdf_count": len(result.pdf_urls),
                    "duration_ms": result.crawl_duration_ms,
                    "error": result.error,
                }
            )

            # Delay between restaurants
            await asyncio.sleep(self.NAVIGATION_DELAY_S)

        return session

    # =========================================================================
    # ROBOTS.TXT GATE (GMFL-04)
    # =========================================================================

    async def _is_crawl_allowed(self, url: str) -> bool:
        """
        Check robots.txt before crawling. Uses stdlib RobotFileParser via asyncio.to_thread.

        Returns True if crawling is allowed or robots.txt is unreadable (fail open).
        Returns False only if robots.txt explicitly disallows the URL.
        """
        parsed = urlparse(url)
        robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
        rp = RobotFileParser()
        rp.set_url(robots_url)
        try:
            # asyncio.to_thread — non-blocking, Python 3.9+, project uses 3.11
            await asyncio.to_thread(rp.read)
        except Exception:
            # Unreadable robots.txt = allow (fail open)
            return True
        return rp.can_fetch("*", url)

    # =========================================================================
    # WINE DEDUPLICATION (GMFL-05)
    # =========================================================================

    def _wine_is_duplicate(self, wine: dict, restaurant_name: str) -> bool:
        """
        Check if a wine already exists in master_wine_library.

        Uses case-insensitive name match + optional vintage filter.
        Fails open: returns False if supabase is None or query errors.
        """
        if self._supabase is None:
            return False

        name = wine.get("wine_name", "").strip()
        if not name:
            return False

        vintage = wine.get("vintage")

        try:
            q = (
                self._supabase.table("master_wine_library")
                .select("id")
                .ilike("name", name)
            )
            if vintage:
                q = q.eq("vintage", vintage)
            result = q.limit(1).execute()
            return bool(result.data)
        except Exception as e:
            logger.debug(
                f"Dedup query failed for '{name}': {e} — allowing insert (fail open)"
            )
            return False

    # =========================================================================
    # JSONL PERSISTENCE (GMFL-03)
    # =========================================================================

    def _normalize_wine_field(self, s: str) -> str:
        """Normalize a wine field value for dedup hashing."""
        return re.sub(r"[^a-z0-9 ]", "", (s or "").lower().strip())

    def _persist_crawled_wines(
        self,
        wines: list,
        restaurant_name: str,
        source_url: str,
        source_type: str = "crawled",
        result: Optional[
            "CrawlResult"
        ] = None,  # Phase 11: append to result.wines for diff engine
    ):
        """
        Write non-duplicate crawled wines to JSONL dataset file.

        Output: datasets/restaurant_menus/<YYYYMMDD>_<slug>.jsonl
        Each record is Supabase-aligned for master_wine_library insert
        (wine_name maps to .name at insert time; all other fields are direct columns).
        """
        RESTAURANT_MENUS_DIR.mkdir(parents=True, exist_ok=True)
        slug = re.sub(r"[^\w]", "_", restaurant_name.lower())[:50]
        ts = datetime.now(timezone.utc).strftime("%Y%m%d")
        out_file = RESTAURANT_MENUS_DIR / f"{ts}_{slug}.jsonl"

        count = 0
        crawled_at = datetime.now(timezone.utc).isoformat()
        crawl_year = datetime.now(timezone.utc).year

        BOTTLE_SIZE_PATTERNS = {
            "magnum": r"\bmagnum\b|1\.5\s*l",
            "half": r"\bhalf\s*bottle\b|375\s*ml",
            "split": r"\bsplit\b|187\s*ml",
        }

        with open(out_file, "a") as f:
            for wine in wines:
                # -- core fields --
                wine_name = wine.get("wine_name", "") or ""
                producer = wine.get("producer", "") or ""
                vintage_raw = wine.get("vintage")
                vintage = (
                    int(vintage_raw)
                    if vintage_raw and str(vintage_raw).isdigit()
                    else None
                )
                primary_type = wine.get("primary_type") or wine.get("wine_type")
                country = wine.get("country")
                region = wine.get("region")
                grape_variety = wine.get("grape_variety")
                sub_region = wine.get("sub_region")
                appellation = wine.get("appellation")
                price_ref_raw = wine.get("price_reference") or wine.get("price")
                price_reference = float(price_ref_raw) if price_ref_raw else None
                price_glass = wine.get("price_glass")

                # -- derived fields --
                bottle_size = "standard"
                for size_name, pattern in BOTTLE_SIZE_PATTERNS.items():
                    if re.search(pattern, wine_name, re.I):
                        bottle_size = size_name
                        break

                is_blend = bool(grape_variety and len(grape_variety.split(",")) > 1)
                vintage_age = (crawl_year - vintage) if vintage else None

                if price_reference is None:
                    price_tier = None
                elif price_reference < 50:
                    price_tier = "entry"
                elif price_reference < 150:
                    price_tier = "mid"
                elif price_reference < 500:
                    price_tier = "premium"
                else:
                    price_tier = "luxury"

                # -- dedup fields --
                norm_name = self._normalize_wine_field(wine_name)
                norm_producer = self._normalize_wine_field(producer)
                sig_input = (
                    norm_name
                    + norm_producer
                    + str(vintage or "")
                    + self._normalize_wine_field(region or "")
                )
                signature_hash = hashlib.md5(sig_input.encode()).hexdigest()

                # -- data_enrichment JSONB --
                data_enrichment = {
                    "source_url": source_url,
                    "source_type": source_type,
                    "restaurant_name": restaurant_name,
                    "crawled_at": crawled_at,
                    "confidence": wine.get("confidence"),
                    "extraction_model": wine.get(
                        "extraction_model", "gemini-2.5-flash"
                    ),
                }

                record = {
                    # Direct columns
                    "wine_name": wine_name,
                    "producer": producer,
                    "vintage": vintage,
                    "primary_type": primary_type,
                    "country": country,
                    "region": region,
                    "grape_variety": grape_variety,
                    "sub_region": sub_region,
                    "appellation": appellation,
                    "price_reference": price_reference,
                    # Derived
                    "price_glass": price_glass,
                    "bottle_size": bottle_size,
                    "is_blend": is_blend,
                    "vintage_age": vintage_age,
                    "price_tier": price_tier,
                    # Dedup
                    "signature_hash": signature_hash,
                    "normalized_name": norm_name,
                    "normalized_producer": norm_producer,
                    # JSONB metadata
                    "data_enrichment": data_enrichment,
                    # Future enrichment stubs (Haiku Phase 4 fills these)
                    "color": None,
                    "sweetness_level": None,
                    "food_pairing": None,
                    # Submissions staging
                    "restaurant_id": None,
                }
                f.write(json.dumps(record) + "\n")
                if result is not None:
                    result.wines.append(record)
                count += 1

        logger.info(
            f"Persisted {count} crawled wines for {restaurant_name} to {out_file.name}"
        )

    # =========================================================================
    # LINK DETECTION
    # =========================================================================

    async def _find_menu_links(
        self, page, base_url: str
    ) -> Tuple[Optional[str], List[str]]:
        """Find wine menu page links and PDF links on the current page."""
        menu_url = None
        pdf_urls = []

        try:
            links = await page.query_selector_all("a[href]")

            for link in links:
                href = await link.get_attribute("href")
                if not href:
                    continue

                text = await link.inner_text()
                text = (text or "").strip()

                # Resolve relative URLs
                full_url = urljoin(base_url, href)

                # Check for PDF links
                for pattern in PDF_LINK_PATTERNS:
                    if pattern.search(href):
                        pdf_urls.append(full_url)
                        break

                # Check for wine menu page links
                if not menu_url:
                    for pattern in MENU_LINK_PATTERNS:
                        if pattern.search(text) or pattern.search(href):
                            menu_url = full_url
                            break

                    for pattern in MENU_PAGE_PATTERNS:
                        if pattern.search(href):
                            menu_url = full_url
                            break

        except Exception as e:
            logger.debug(f"Link detection error: {e}")

        return menu_url, pdf_urls

    # =========================================================================
    # CONTENT EXTRACTION
    # =========================================================================

    async def _extract_page_text(self, page) -> str:
        """Extract readable text from the current page DOM."""
        try:
            # Get text from main content areas
            selectors = [
                "main",
                "article",
                '[role="main"]',
                ".menu",
                ".wine-list",
                ".wine-menu",
                "#menu",
                "#wine-list",
                "#wine-menu",
                ".content",
                "#content",
                ".page-content",
            ]

            for selector in selectors:
                el = await page.query_selector(selector)
                if el:
                    text = await el.inner_text()
                    if text and len(text.strip()) > 100:
                        return text.strip()

            # Fallback: get body text
            body = await page.query_selector("body")
            if body:
                text = await body.inner_text()
                return text.strip() if text else ""

        except Exception as e:
            logger.debug(f"Text extraction error: {e}")

        return ""

    async def _check_image_menu(self, page) -> bool:
        """Check if the page has a menu rendered as images."""
        try:
            images = await page.query_selector_all("img")
            for img in images:
                alt = await img.get_attribute("alt") or ""
                src = await img.get_attribute("src") or ""
                if any(
                    kw in (alt + src).lower()
                    for kw in ["menu", "wine", "list", "carta"]
                ):
                    return True
        except Exception:
            pass
        return False

    async def _take_viewport_chunks(self, page) -> List[bytes]:
        """
        Scroll the page in 900px increments and capture each viewport as JPEG bytes.
        Max 10 chunks = cost ceiling ~$0.15/restaurant.
        Used by _handle_image_menu() for IMAGE_ONLY and 0-wine HTML_MENU paths.
        """
        VIEWPORT_HEIGHT = 900
        VIEWPORT_WIDTH = 1280
        MAX_CHUNKS = 10

        try:
            await page.set_viewport_size(
                {"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT}
            )
            total_height = await page.evaluate(
                "Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, window.innerHeight)"
            )
        except Exception:
            total_height = VIEWPORT_HEIGHT
        if not total_height:
            total_height = VIEWPORT_HEIGHT

        chunks: List[bytes] = []
        offset = 0
        while offset < total_height and len(chunks) < MAX_CHUNKS:
            try:
                await page.evaluate(f"window.scrollTo(0, {offset})")
                await asyncio.sleep(0.3)  # allow lazy-loaded images to render
                chunk = await page.screenshot(
                    clip={
                        "x": 0,
                        "y": 0,
                        "width": VIEWPORT_WIDTH,
                        "height": min(VIEWPORT_HEIGHT, total_height - offset),
                    },
                    type="jpeg",
                    quality=85,
                )
                chunks.append(chunk)
            except Exception as e:
                logger.debug(f"Viewport chunk {len(chunks)} failed: {e}")
                break
            offset += VIEWPORT_HEIGHT

        return chunks

    async def _is_image_menu(self, page) -> bool:
        """
        Check for image-menu signals on a 0-wine HTML_MENU page (D-03).
        Signal 1: any <img> with naturalWidth > 400px (large embedded image).
        Signal 2: page text contains no wine patterns (\\d{4} years or $\\d+ prices).
        Either signal alone triggers Vision path. Fails open (returns False on error).
        Note: Different from _check_image_menu() which uses keyword alt/src matching.
        """
        try:
            # Signal 1: large images
            images = await page.query_selector_all("img")
            for img in images:
                natural_width = await page.evaluate("(el) => el.naturalWidth", img)
                if natural_width and natural_width > 400:
                    return True

            # Signal 2: no wine patterns in page text
            page_text = await page.evaluate("document.body.innerText")
            if not re.search(r"\d{4}|\$\d+", page_text or ""):
                return True

        except Exception as e:
            logger.debug(f"_is_image_menu check failed: {e}")

        return False

    async def _handle_image_menu(
        self, page, result: CrawlResult, restaurant_name: str, website_url: str
    ) -> None:
        """
        Orchestrate Vision extraction for an image-only or image-menu page.
        Takes viewport chunks, encodes to base64, calls extract_menu(), deduplicates,
        persists with source_type="image_menu", sets result.image_menu_detected=True.
        """
        chunks = await self._take_viewport_chunks(page)
        if not chunks:
            logger.warning(f"No viewport chunks captured for {restaurant_name}")
            return

        # extract_menu() requires List[str] (base64 strings), NOT bytes
        b64_pages = [base64.b64encode(c).decode("utf-8") for c in chunks]

        extractor = get_claude_vision_extractor()
        try:
            extraction = await extractor.extract_menu(b64_pages)
        except RuntimeError as e:
            logger.error(f"Image menu extraction failed for {restaurant_name}: {e}")
            return

        if extraction.wines:
            non_dupes = [
                w
                for w in extraction.wines
                if not self._wine_is_duplicate(w, restaurant_name)
            ]
            if non_dupes:
                self._persist_crawled_wines(
                    non_dupes,
                    restaurant_name,
                    website_url,
                    source_type="image_menu",
                    result=result,
                )
            logger.info(
                f"Image menu {restaurant_name}: {len(extraction.wines)} wines extracted, "
                f"{len(extraction.wines) - len(non_dupes)} dupes skipped"
            )

        result.image_menu_detected = True

    async def _handle_pdf_vision(
        self, result: CrawlResult, restaurant_name: str, website_url: str
    ) -> None:
        """
        Route a downloaded PDF through Claude Vision extract_pdf().
        Does not need Playwright — reads from result.pdf_bytes already downloaded.
        Persists with source_type="pdf_vision_fallback".
        """
        if not result.pdf_bytes:
            return

        extractor = get_claude_vision_extractor()
        try:
            extraction = await extractor.extract_pdf(result.pdf_bytes)
        except Exception as e:
            logger.error(f"PDF vision extraction failed for {restaurant_name}: {e}")
            return

        if extraction.wines:
            non_dupes = [
                w
                for w in extraction.wines
                if not self._wine_is_duplicate(w, restaurant_name)
            ]
            if non_dupes:
                self._persist_crawled_wines(
                    non_dupes,
                    restaurant_name,
                    website_url,
                    source_type="pdf_vision_fallback",
                    result=result,
                )
            logger.info(
                f"PDF vision {restaurant_name}: {len(extraction.wines)} wines extracted, "
                f"{len(extraction.wines) - len(non_dupes)} dupes skipped"
            )

        result.image_menu_detected = True

    async def _download_pdf(self, context, pdf_url: str) -> Optional[bytes]:
        """Download a PDF file. Tries Playwright first, falls back to aiohttp."""
        # Try Playwright inline navigation
        try:
            page = await context.new_page()
            response = await page.goto(pdf_url, timeout=15000)
            if response and response.ok:
                body = await response.body()
                await page.close()
                return body
            await page.close()
        except Exception as e:
            logger.debug(f"PDF Playwright download failed for {pdf_url}: {e}")

        # Fallback: aiohttp direct download (handles Content-Disposition: attachment)
        try:
            ssl_ctx = ssl.create_default_context()
            ssl_ctx.check_hostname = False
            ssl_ctx.verify_mode = ssl.CERT_NONE
            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            }
            async with aiohttp.ClientSession(headers=headers) as session:
                async with session.get(
                    pdf_url, ssl=ssl_ctx, timeout=aiohttp.ClientTimeout(total=20)
                ) as resp:
                    if resp.status == 200:
                        body = await resp.read()
                        if body[:4] == b"%PDF":
                            return body
        except Exception as e:
            logger.debug(f"PDF aiohttp download failed for {pdf_url}: {e}")

        return None

    # =========================================================================
    # CRAWL LOG (Supabase)
    # =========================================================================

    def _log_crawl_to_db(self, result: CrawlResult):
        """Log all visited URLs from a crawl to the crawl_log table."""
        if not self._supabase:
            return

        result_type_map = {
            ContentType.HTML_MENU: "html_menu",
            ContentType.PDF_LINK: "pdf_link",
            ContentType.IMAGE_ONLY: "image_only",
            ContentType.NO_MENU: "no_menu",
            ContentType.ERROR: "error",
        }

        for visited in result.visited_urls:
            try:
                self._supabase.table("crawl_log").insert(
                    {
                        "restaurant_id": result.restaurant_id,
                        "url": visited.url,
                        "result_type": result_type_map.get(
                            result.content_type, visited.content_type
                        ),
                        "content_hash": result.content_hash,
                        "extracted_text_length": (
                            len(result.extracted_text) if result.extracted_text else 0
                        ),
                        "pdf_downloaded": bool(result.pdf_bytes),
                        "error_message": result.error,
                    }
                ).execute()
            except Exception as e:
                logger.debug(f"crawl_log insert failed for {visited.url}: {e}")

        if not result.visited_urls:
            try:
                self._supabase.table("crawl_log").insert(
                    {
                        "restaurant_id": result.restaurant_id,
                        "url": result.website_url,
                        "result_type": result_type_map.get(
                            result.content_type, "error"
                        ),
                        "content_hash": result.content_hash,
                        "extracted_text_length": 0,
                        "pdf_downloaded": False,
                        "error_message": result.error,
                    }
                ).execute()
            except Exception as e:
                logger.debug(f"crawl_log insert failed: {e}")

    # =========================================================================
    # CACHING
    # =========================================================================

    def _cache_result(self, result: CrawlResult):
        """Cache crawl results for dedup and freshness tracking."""
        slug = re.sub(r"[^\w]", "_", result.restaurant_name.lower())[:50]
        ts = datetime.now(timezone.utc).strftime("%Y%m%d")

        # Save extracted text
        if result.extracted_text:
            text_file = CRAWL_CACHE_DIR / f"{ts}_{slug}.txt"
            with open(text_file, "w") as f:
                f.write(result.extracted_text)

        # Save PDF
        if result.pdf_bytes:
            pdf_file = CRAWL_CACHE_DIR / f"{ts}_{slug}.pdf"
            with open(pdf_file, "wb") as f:
                f.write(result.pdf_bytes)

        # Append to local crawl log JSON (fallback when no Supabase)
        crawl_log_file = CRAWL_CACHE_DIR / "_crawl_log.jsonl"
        try:
            entry = {
                "restaurant_name": result.restaurant_name,
                "url": result.website_url,
                "menu_page_url": result.menu_page_url,
                "result_type": result.content_type.value,
                "content_hash": result.content_hash,
                "extracted_text_length": len(result.extracted_text),
                "pdf_urls": result.pdf_urls,
                "pdf_downloaded": bool(result.pdf_bytes),
                "duration_ms": result.crawl_duration_ms,
                "visited_urls": [
                    {"url": v.url, "type": v.content_type, "status": v.http_status}
                    for v in result.visited_urls
                ],
                "error": result.error,
                "crawled_at": datetime.now(timezone.utc).isoformat(),
            }
            with open(crawl_log_file, "a") as f:
                f.write(json.dumps(entry) + "\n")
        except Exception as e:
            logger.debug(f"Local crawl log append failed: {e}")

    def reset_daily_count(self):
        """Reset the daily crawl counter (called by Celery beat at midnight)."""
        self._daily_count = 0

    @property
    def remaining_today(self) -> int:
        return max(0, self._rate_limit - self._daily_count)


# =============================================================================
# MODULE-LEVEL SINGLETON
# =============================================================================

_service_instance: Optional[WebCrawlerService] = None


def get_crawler_service(
    rate_limit: Optional[int] = None,
    supabase_client=None,
) -> WebCrawlerService:
    """Get module-level singleton crawler service."""
    global _service_instance
    if _service_instance is None:
        _service_instance = WebCrawlerService(rate_limit, supabase_client)
    return _service_instance
