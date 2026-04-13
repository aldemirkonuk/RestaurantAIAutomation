#!/usr/bin/env python3
"""
Prepare Annotation Tasks for Label Studio — Three-Pass Gemini+Surya Pipeline
=============================================================================
Converts PDFs and screenshots into Label Studio JSON tasks using:
  Pass 1: Page Classification  — filter non-wine pages, tag mixed content
  Pass 2: Zone Detection       — wine entry zones + section headers + structured data
  Pass 3: Field-Level Boxes    — per-entry cropped field bbox detection
  Surya:  OCR on cropped zones — word-level boxes for snapping
  Snap:   Align Gemini bboxes to Surya word boundaries

Usage:
  python scripts/prepare_annotation_tasks.py \
    --input datasets/annotation_inbox/pdfs \
    --output-images datasets/annotation_images \
    --output-tasks datasets/annotation_tasks/pdfs.json \
    --source-type pdf

  python scripts/prepare_annotation_tasks.py \
    --input datasets/annotation_inbox/screenshots \
    --output-images datasets/annotation_images \
    --output-tasks datasets/annotation_tasks/screenshots.json \
    --source-type screenshot
"""

import argparse
import base64
import json
import os
import re
import sys
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SERVICES_ROOT = PROJECT_ROOT / "services" / "agent-orchestrator"
sys.path.insert(0, str(SERVICES_ROOT))

EXTENSIONS_PDF = (".pdf",)
EXTENSIONS_IMAGE = (".jpg", ".jpeg", ".png", ".webp")

FAST_MODEL = "gemini-3.1-flash-lite-preview"
FALLBACK_MODEL = "gemini-2.5-flash"

ADAPTIVE_BATCH_THRESHOLD = 120
BATCH_STRIP_SIZE = 3


def _sanitize_filename(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", name)


def _collect_files(input_dir: Path) -> List[Path]:
    all_exts = EXTENSIONS_PDF + EXTENSIONS_IMAGE
    return sorted(
        f for f in input_dir.rglob("*")
        if f.is_file() and f.suffix.lower() in all_exts
    )


def _restaurant_from_path(file_path: Path) -> str:
    return file_path.stem.replace("_", " ").replace("-", " ").title()


# =========================================================================
# GEMINI CLIENT (AI Studio)
# =========================================================================

_gemini_client = None

def _get_gemini_client():
    global _gemini_client
    if _gemini_client is None:
        from google import genai
        _gemini_client = genai.Client(api_key=os.environ.get("GOOGLE_AI_STUDIO_KEY", ""))
    return _gemini_client


def _image_to_inline_part(image_path: Path) -> dict:
    image_bytes = image_path.read_bytes()
    suffix = image_path.suffix.lower()
    mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
    mime_type = mime_map.get(suffix, "image/png")
    return {"inline_data": {"mime_type": mime_type, "data": base64.b64encode(image_bytes).decode()}}


def _pil_to_inline_part(pil_img, fmt: str = "PNG") -> dict:
    import io
    buf = io.BytesIO()
    pil_img.save(buf, format=fmt)
    mime = "image/png" if fmt == "PNG" else "image/jpeg"
    return {"inline_data": {"mime_type": mime, "data": base64.b64encode(buf.getvalue()).decode()}}


def _bbox_to_percent(
    bbox_x: float, bbox_y: float, bbox_w: float, bbox_h: float,
    img_width: int, img_height: int,
) -> Tuple[float, float, float, float]:
    x_pct = (bbox_x / img_width) * 100
    y_pct = (bbox_y / img_height) * 100
    w_pct = (bbox_w / img_width) * 100
    h_pct = (bbox_h / img_height) * 100
    return (x_pct, y_pct, w_pct, h_pct)


def _gemini_box_to_percent(
    box_2d: List[int], img_width: int, img_height: int,
) -> Tuple[float, float, float, float]:
    y_min, x_min, y_max, x_max = box_2d[:4]
    x_pct = (x_min / 1000) * 100
    y_pct = (y_min / 1000) * 100
    w_pct = ((x_max - x_min) / 1000) * 100
    h_pct = ((y_max - y_min) / 1000) * 100
    return (x_pct, y_pct, w_pct, h_pct)


# =========================================================================
# WINE TYPE NORMALIZATION
# =========================================================================

WINE_TYPE_NORMALIZE = {
    "red": "red", "rouge": "red", "tinto": "red", "rosso": "red", "rot": "red",
    "white": "white", "blanc": "white", "blanco": "white", "bianco": "white", "weiss": "white",
    "rosé": "rose", "rose": "rose", "rosato": "rose",
    "orange": "orange", "amber": "orange", "skin-contact": "orange", "skin contact": "orange",
    "sparkling": "sparkling", "champagne": "sparkling", "cava": "sparkling",
    "prosecco": "sparkling", "crémant": "sparkling", "cremant": "sparkling",
    "pétillant": "sparkling", "petillant": "sparkling", "pet-nat": "sparkling",
    "pét-nat": "sparkling", "spumante": "sparkling", "sekt": "sparkling",
    "fortified": "fortified", "port": "fortified", "sherry": "fortified",
    "madeira": "fortified", "marsala": "fortified", "vermouth": "fortified",
    "dessert": "dessert", "sweet": "dessert", "sauternes": "dessert",
    "tokaji": "dessert", "ice wine": "dessert", "late harvest": "dessert",
}


def _normalize_wine_type(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    key = raw.strip().lower()
    if key in WINE_TYPE_NORMALIZE:
        return WINE_TYPE_NORMALIZE[key]
    for token, norm in WINE_TYPE_NORMALIZE.items():
        if token in key:
            return norm
    return "other"


# =========================================================================
# PYDANTIC SCHEMAS FOR THREE-PASS ARCHITECTURE
# =========================================================================

try:
    from pydantic import BaseModel, Field
except ImportError:
    print("ERROR: pydantic required. Install: pip install pydantic", file=sys.stderr)
    sys.exit(1)


class PageClassification(BaseModel):
    page_type: Literal["wine_list", "mixed_beverage", "spirits_only", "food_menu", "not_menu"]
    has_wine_entries: bool
    has_non_wine_items: bool
    estimated_wine_count: int
    section_types_visible: list[str] = Field(default_factory=list)
    confidence: float


class WineEntryZone(BaseModel):
    box_2d: list[int]
    wine_name: Optional[str] = None
    producer: Optional[str] = None
    vintage: Optional[int] = None
    price_bottle: Optional[float] = None
    price_glass: Optional[float] = None
    wine_type: Optional[str] = None
    country: Optional[str] = None
    region: Optional[str] = None
    grape: Optional[str] = None
    appellation: Optional[str] = None
    bottle_size: Optional[str] = None
    serving_type: Optional[str] = None
    confidence: float = 0.5


class SectionHeader(BaseModel):
    box_2d: list[int]
    text: str
    section_type: Optional[str] = None


class PageExtraction(BaseModel):
    entries: list[WineEntryZone] = Field(default_factory=list)
    section_headers: list[SectionHeader] = Field(default_factory=list)
    total_wines: int = 0


class FieldBox(BaseModel):
    box_2d: list[int]
    label: str
    text: str = ""


class EntryFieldDetection(BaseModel):
    fields: list[FieldBox] = Field(default_factory=list)


# =========================================================================
# PASS 1: PAGE CLASSIFICATION
# =========================================================================

PASS1_PROMPT = """Classify this menu page. Determine:
1. What type of page is this?
   - wine_list: exclusively or primarily wine
   - mixed_beverage: wine AND spirits/cocktails/beer on same page
   - spirits_only: only spirits, cocktails, beer (no wine)
   - food_menu: food items only
   - not_menu: not a menu page at all
2. Does it contain wine entries?
3. Does it contain non-wine items (spirits, cocktails, beer)?
4. How many wine entries are approximately visible?
5. What section headers are visible? (e.g. "RED WINES", "Cocktails", "By The Glass")"""


def _pass1_classify_page(
    image_path: Path,
    model: str = FAST_MODEL,
) -> Optional[PageClassification]:
    client = _get_gemini_client()
    try:
        from google.genai import types as genai_types
        response = client.models.generate_content(
            model=model,
            contents=[{
                "role": "user",
                "parts": [_image_to_inline_part(image_path), {"text": PASS1_PROMPT}],
            }],
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=PageClassification,
                temperature=0.1,
            ),
        )
        raw = (response.text or "").strip()
        data = json.loads(raw)
        return PageClassification(**data)
    except Exception as e:
        print(f"  [PASS1 ERROR] {e}", file=sys.stderr)
        if model == FAST_MODEL and model != FALLBACK_MODEL:
            print(f"  [FALLBACK] Retrying Pass 1 with {FALLBACK_MODEL}...", file=sys.stderr)
            return _pass1_classify_page(image_path, model=FALLBACK_MODEL)
        return None


# =========================================================================
# PASS 2: ZONE DETECTION + STRUCTURED DATA
# =========================================================================

PASS2_PROMPT_TEMPLATE = """You are a wine menu document analyst. Analyze this menu page image.

CONTEXT: This page is classified as: {page_type}
{mixed_warning}

TASK (in priority order):

1. SECTION HEADERS: Find all section headers (e.g. "RED WINES", "By The Glass", "Champagne & Sparkling"). Draw a bounding box around each. Classify each as wine/spirits/cocktails/beer/mixed.

2. WINE ENTRY ZONES: For each individual wine listing, draw a bounding box around the ENTIRE entry (all lines belonging to one wine). The box should include the wine name, producer, vintage, price, and any description text.

3. STRUCTURED DATA: For each wine entry, extract:
   - wine_name: The cuvee, brand, or estate name (NOT the full line -- just the identifying name)
   - producer: The winery/producer name (if separate from wine_name)
   - vintage: 4-digit year, or null for NV
   - price_bottle: Price per bottle (default if only one price shown)
   - price_glass: Price per glass (only if explicitly shown as glass price)
   - wine_type: red/white/rose/sparkling/dessert/fortified/orange
   - country, region, grape, appellation: Only if literally printed on the page
   - bottle_size: e.g. "375ml", "1.5L", "magnum" (only if printed)
   - serving_type: glass/bottle/carafe (only if indicated)

RULES:
- Skip non-wine items (spirits, cocktails, beer, amaro, ouzo, mastiha, grappa, mezcal, whiskey, sake)
- INCLUDE vermouth as wine — vermouth is an aromatized fortified wine (wine_type: fortified)
- If only one price is shown with no context, it is price_bottle
- For grape: only extract if the grape name is literally visible (e.g. "(assyrtiko)" or "Pinot Noir"). Do NOT infer grape from region or appellation
- wine_name is the identifying name/brand, NOT "vintage + producer + region". Example: for "2024 Domaine Sigalas Santorini, Greece" the wine_name is "Domaine Sigalas"
- Use box_2d format: [y_min, x_min, y_max, x_max] with coordinates normalized 0-1000"""


def _pass2_extract_zones(
    image_path: Path,
    page_type: str = "wine_list",
    model: str = FAST_MODEL,
) -> Optional[PageExtraction]:
    client = _get_gemini_client()
    mixed_warning = ""
    if page_type == "mixed_beverage":
        mixed_warning = "This page contains BOTH wine and non-wine items. Extract ONLY wine entries (including vermouth, which is a fortified wine). Skip spirits, cocktails, beer, amaro, and non-alcoholic beverages."

    prompt = PASS2_PROMPT_TEMPLATE.format(page_type=page_type, mixed_warning=mixed_warning)

    try:
        from google.genai import types as genai_types
        response = client.models.generate_content(
            model=model,
            contents=[{
                "role": "user",
                "parts": [_image_to_inline_part(image_path), {"text": prompt}],
            }],
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=PageExtraction,
                temperature=0.2,
            ),
        )
        raw = (response.text or "").strip()
        data = json.loads(raw)
        result = PageExtraction(**data)
        if result.total_wines == 0:
            result.total_wines = len(result.entries)
        return result
    except Exception as e:
        print(f"  [PASS2 ERROR] {e}", file=sys.stderr)
        if model == FAST_MODEL and model != FALLBACK_MODEL:
            print(f"  [FALLBACK] Retrying Pass 2 with {FALLBACK_MODEL}...", file=sys.stderr)
            return _pass2_extract_zones(image_path, page_type, model=FALLBACK_MODEL)
        return None


# =========================================================================
# PASS 3: FIELD-LEVEL BOUNDING BOXES (PER-ENTRY CROPS)
# =========================================================================

PASS3_PROMPT_TEMPLATE = """This is a cropped image of a single wine entry from a menu.

KNOWN DATA (from previous extraction):
- Wine name: {wine_name}
- Producer: {producer}
- Vintage: {vintage}
- Price: {price}

TASK: Draw a tight bounding box around EACH visible field in this wine entry. Only box text that is literally visible in the image.

FIELDS TO DETECT:
- wine_name: The cuvee/brand/estate name text
- producer: Producer/winery name (if visually separate from wine_name)
- vintage: The 4-digit year text
- price_bottle: Bottle price text (including currency symbol)
- price_glass: Glass price text (only if separate from bottle price)
- region: Region name text
- country: Country name text
- grape: Grape variety text (only if literally printed)
- appellation: Appellation text (e.g. "DOC", "AOC Bordeaux")
- wine_type: Type text if literally printed (e.g. "Red", "Blanc")
- bottle_size: Size text (e.g. "375ml", "1.5L")
- serving_type: Serving indicator text (e.g. "BTL", "GL")

RULES:
- Draw boxes ONLY around text that is actually visible
- Each box should tightly wrap just that field's text
- If wine_name and producer are the same text, label it as wine_name only
- Use box_2d: [y_min, x_min, y_max, x_max] normalized 0-1000 within this cropped image"""

PASS3_BATCH_PROMPT_TEMPLATE = """This is a cropped image of multiple wine entries from a menu.

TASK: For EACH wine entry visible in this strip, draw a tight bounding box around EACH visible field. Only box text that is literally visible.

FIELDS TO DETECT (for each entry):
- wine_name: The cuvee/brand/estate name text
- producer: Producer/winery name (if visually separate from wine_name)
- vintage: The 4-digit year text
- price_bottle: Bottle price text (including currency symbol)
- price_glass: Glass price text (only if separate from bottle price)
- region: Region name text
- country: Country name text
- grape: Grape variety text (only if literally printed)
- appellation: Appellation text (e.g. "DOC", "AOC Bordeaux")
- wine_type: Type text if literally printed (e.g. "Red", "Blanc")
- bottle_size: Size text (e.g. "375ml", "1.5L")
- serving_type: Serving indicator text (e.g. "BTL", "GL")

RULES:
- Draw boxes ONLY around text that is actually visible
- Each box should tightly wrap just that field's text
- If wine_name and producer are the same text, label it as wine_name only
- Use box_2d: [y_min, x_min, y_max, x_max] normalized 0-1000 within this cropped image"""


def _crop_zone_from_image(pil_img, box_2d: list, padding_pct: float = 2.0):
    """Crop a zone region from the full page image using Gemini box_2d coords (0-1000)."""
    w, h = pil_img.size
    y_min, x_min, y_max, x_max = box_2d[:4]

    px_x1 = int((x_min / 1000) * w)
    px_y1 = int((y_min / 1000) * h)
    px_x2 = int((x_max / 1000) * w)
    px_y2 = int((y_max / 1000) * h)

    pad_x = int((padding_pct / 100) * w)
    pad_y = int((padding_pct / 100) * h)
    px_x1 = max(0, px_x1 - pad_x)
    px_y1 = max(0, px_y1 - pad_y)
    px_x2 = min(w, px_x2 + pad_x)
    px_y2 = min(h, px_y2 + pad_y)

    if px_x2 <= px_x1 or px_y2 <= px_y1:
        return None
    return pil_img.crop((px_x1, px_y1, px_x2, px_y2))


def _transform_field_box_to_page(
    field_box_2d: list,
    zone_box_2d: list,
    page_width: int,
    page_height: int,
    padding_pct: float = 2.0,
) -> list:
    """Transform field box_2d (0-1000 within crop) to page-level box_2d (0-1000)."""
    if len(zone_box_2d) < 4 or len(field_box_2d) < 4:
        return field_box_2d[:4] if len(field_box_2d) >= 4 else field_box_2d

    zy_min, zx_min, zy_max, zx_max = zone_box_2d[:4]

    pad_x = padding_pct * 10
    pad_y = padding_pct * 10
    crop_x_min = max(0, zx_min - pad_x)
    crop_y_min = max(0, zy_min - pad_y)
    crop_x_max = min(1000, zx_max + pad_x)
    crop_y_max = min(1000, zy_max + pad_y)
    crop_w = crop_x_max - crop_x_min
    crop_h = crop_y_max - crop_y_min

    if crop_w <= 0 or crop_h <= 0:
        return field_box_2d[:4]

    fy_min, fx_min, fy_max, fx_max = field_box_2d[:4]
    page_x_min = crop_x_min + (fx_min / 1000) * crop_w
    page_y_min = crop_y_min + (fy_min / 1000) * crop_h
    page_x_max = crop_x_min + (fx_max / 1000) * crop_w
    page_y_max = crop_y_min + (fy_max / 1000) * crop_h

    return [
        int(max(0, min(1000, page_y_min))),
        int(max(0, min(1000, page_x_min))),
        int(max(0, min(1000, page_y_max))),
        int(max(0, min(1000, page_x_max))),
    ]


def _pass3_detect_fields_single(
    crop_img,
    entry: WineEntryZone,
    model: str = FAST_MODEL,
) -> Optional[EntryFieldDetection]:
    client = _get_gemini_client()
    prompt = PASS3_PROMPT_TEMPLATE.format(
        wine_name=entry.wine_name or "unknown",
        producer=entry.producer or "unknown",
        vintage=entry.vintage or "unknown",
        price=entry.price_bottle or "unknown",
    )

    try:
        from google.genai import types as genai_types
        response = client.models.generate_content(
            model=model,
            contents=[{
                "role": "user",
                "parts": [_pil_to_inline_part(crop_img), {"text": prompt}],
            }],
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=EntryFieldDetection,
                temperature=0.2,
            ),
        )
        raw = (response.text or "").strip()
        data = json.loads(raw)
        return EntryFieldDetection(**data)
    except Exception as e:
        print(f"    [PASS3 ERROR] {e}", file=sys.stderr)
        if model == FAST_MODEL and model != FALLBACK_MODEL:
            return _pass3_detect_fields_single(crop_img, entry, model=FALLBACK_MODEL)
        return None


def _pass3_detect_fields_batch(
    strip_img,
    model: str = FAST_MODEL,
) -> Optional[EntryFieldDetection]:
    client = _get_gemini_client()
    try:
        from google.genai import types as genai_types
        response = client.models.generate_content(
            model=model,
            contents=[{
                "role": "user",
                "parts": [_pil_to_inline_part(strip_img), {"text": PASS3_BATCH_PROMPT_TEMPLATE}],
            }],
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=EntryFieldDetection,
                temperature=0.2,
            ),
        )
        raw = (response.text or "").strip()
        data = json.loads(raw)
        return EntryFieldDetection(**data)
    except Exception as e:
        print(f"    [PASS3 BATCH ERROR] {e}", file=sys.stderr)
        if model == FAST_MODEL and model != FALLBACK_MODEL:
            return _pass3_detect_fields_batch(strip_img, model=FALLBACK_MODEL)
        return None


# =========================================================================
# BBOX ALIGNMENT: SNAP GEMINI BBOXES TO SURYA WORDS
# =========================================================================

def _iou(box_a, box_b) -> float:
    ax1, ay1 = box_a[0], box_a[1]
    ax2, ay2 = ax1 + box_a[2], ay1 + box_a[3]
    bx1, by1 = box_b[0], box_b[1]
    bx2, by2 = bx1 + box_b[2], by1 + box_b[3]

    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    if inter == 0:
        return 0.0

    area_a = box_a[2] * box_a[3]
    area_b = box_b[2] * box_b[3]
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _overlap_ratio(inner, outer) -> float:
    ix1 = max(inner[0], outer[0])
    iy1 = max(inner[1], outer[1])
    ix2 = min(inner[0] + inner[2], outer[0] + outer[2])
    iy2 = min(inner[1] + inner[3], outer[1] + outer[3])
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    area = inner[2] * inner[3]
    return inter / area if area > 0 else 0.0


def _gemini_box_to_pixels(box_2d: List[int], img_w: int, img_h: int) -> Tuple[float, float, float, float]:
    y_min, x_min, y_max, x_max = box_2d[:4]
    px_x = (x_min / 1000) * img_w
    px_y = (y_min / 1000) * img_h
    px_w = ((x_max - x_min) / 1000) * img_w
    px_h = ((y_max - y_min) / 1000) * img_h
    return (px_x, px_y, px_w, px_h)


def _snap_bbox_to_words(
    gemini_box_2d: List[int],
    surya_words: list,
    img_width: int,
    img_height: int,
    overlap_threshold: float = 0.3,
) -> Tuple[float, float, float, float, str, bool]:
    """
    Align a Gemini bbox to Surya word boundaries.
    Returns (x_pct, y_pct, w_pct, h_pct, merged_text, snapped).
    """
    gem_px = _gemini_box_to_pixels(gemini_box_2d, img_width, img_height)

    overlapping = []
    for word in surya_words:
        word_box = (word.bbox_x, word.bbox_y, word.bbox_width, word.bbox_height)
        if _overlap_ratio(word_box, gem_px) >= overlap_threshold:
            overlapping.append(word)

    if not overlapping:
        x_pct, y_pct, w_pct, h_pct = _gemini_box_to_percent(gemini_box_2d, img_width, img_height)
        return (x_pct, y_pct, w_pct, h_pct, "", False)

    overlapping.sort(key=lambda w: (w.bbox_y, w.bbox_x))
    min_x = min(w.bbox_x for w in overlapping)
    min_y = min(w.bbox_y for w in overlapping)
    max_x = max(w.bbox_x + w.bbox_width for w in overlapping)
    max_y = max(w.bbox_y + w.bbox_height for w in overlapping)

    x_pct, y_pct, w_pct, h_pct = _bbox_to_percent(
        min_x, min_y, max_x - min_x, max_y - min_y, img_width, img_height
    )
    merged_text = " ".join(w.text for w in overlapping)
    return (x_pct, y_pct, w_pct, h_pct, merged_text, True)


# =========================================================================
# PREDICTION BUILDER (zone + field boxes -> Label Studio format)
# =========================================================================

FIELD_LABEL_MAP = {
    "wine_name": "Wine Name",
    "producer": "Producer",
    "vintage": "Vintage",
    "price_bottle": "Price (Bottle)",
    "price_glass": "Price (Glass)",
    "region": "Region",
    "country": "Country",
    "grape": "Grape",
    "appellation": "Appellation",
    "wine_type": "Wine Type",
    "price": "Price (Bottle)",
    "bottle_size": "Bottle Size",
    "serving_type": "Serving Type",
}


def _build_predictions(
    page_extraction: PageExtraction,
    entry_fields: Dict[int, List[FieldBox]],
    surya_words_by_entry: Dict[int, list],
    crop_dims_by_entry: Dict[int, Tuple[int, int]],
    img_width: int,
    img_height: int,
    page_surya_words: list,
) -> Tuple[List[Dict[str, Any]], int, int, List[int]]:
    """Build Label Studio predictions from three-pass results.
    Returns (results, zone_count, field_count, flagged_entry_indices).
    """
    results = []
    flagged = []

    for entry_idx, entry in enumerate(page_extraction.entries):
        if not entry.box_2d or len(entry.box_2d) != 4:
            continue

        zone_id = f"zone_{entry_idx}_{uuid.uuid4().hex[:6]}"

        x_pct, y_pct, w_pct, h_pct, _, _ = _snap_bbox_to_words(
            entry.box_2d, page_surya_words, img_width, img_height, overlap_threshold=0.15
        )
        if w_pct < 0.5 or h_pct < 0.5:
            continue

        bbox_value = {
            "x": round(x_pct, 2), "y": round(y_pct, 2),
            "width": round(w_pct, 2), "height": round(h_pct, 2),
            "rotation": 0,
        }

        results.append({
            "id": zone_id,
            "type": "rectanglelabels",
            "from_name": "zone",
            "to_name": "image",
            "original_width": img_width,
            "original_height": img_height,
            "image_rotation": 0,
            "value": {**bbox_value, "rectanglelabels": ["Wine Entry"]},
        })

        wine_name = entry.wine_name or ""
        producer = entry.producer or ""
        entry_text = f"{wine_name} {producer}".strip() or "wine entry"
        results.append({
            "id": zone_id,
            "type": "textarea",
            "from_name": "transcription",
            "to_name": "image",
            "original_width": img_width,
            "original_height": img_height,
            "image_rotation": 0,
            "value": {**bbox_value, "text": [entry_text]},
        })

        norm_wtype = _normalize_wine_type(entry.wine_type)
        if norm_wtype:
            results.append({
                "id": zone_id,
                "type": "choices",
                "from_name": "wine_type_choice",
                "to_name": "image",
                "original_width": img_width,
                "original_height": img_height,
                "image_rotation": 0,
                "value": {**bbox_value, "choices": [norm_wtype]},
            })

        fields_for_entry = entry_fields.get(entry_idx, [])
        is_flagged = (
            (not entry.wine_name)
            and not any(f.label == "wine_name" for f in fields_for_entry)
        ) or (entry_text == "wine entry") or (len(fields_for_entry) == 0)

        conf_val = entry.confidence if entry.confidence else 0.5
        if is_flagged:
            conf_val = min(conf_val, 0.3)
            flagged.append(entry_idx)
        conf_label = "high" if conf_val >= 0.8 else ("medium" if conf_val >= 0.5 else "low")

        results.append({
            "id": zone_id,
            "type": "choices",
            "from_name": "confidence",
            "to_name": "image",
            "original_width": img_width,
            "original_height": img_height,
            "image_rotation": 0,
            "value": {**bbox_value, "choices": [conf_label]},
        })

        crop_w, crop_h = crop_dims_by_entry.get(entry_idx, (0, 0))
        crop_surya = surya_words_by_entry.get(entry_idx, [])

        for field_idx, field in enumerate(fields_for_entry):
            if not field.box_2d or len(field.box_2d) != 4:
                continue

            raw_label = field.label
            label = FIELD_LABEL_MAP.get(raw_label, raw_label)
            if label not in FIELD_LABEL_MAP.values():
                continue

            page_box = _transform_field_box_to_page(
                field.box_2d, entry.box_2d, img_width, img_height
            )

            field_id = f"field_{entry_idx}_{field_idx}_{uuid.uuid4().hex[:6]}"

            if crop_surya and crop_w > 0 and crop_h > 0:
                fx, fy, fw, fh, snap_text, snapped = _snap_bbox_to_words(
                    page_box, page_surya_words, img_width, img_height
                )
            else:
                fx, fy, fw, fh = _gemini_box_to_percent(page_box, img_width, img_height)
                snap_text = ""
                snapped = False

            if fw < 0.1 or fh < 0.1:
                continue

            field_text = snap_text if snapped else field.text
            field_bbox = {
                "x": round(fx, 2), "y": round(fy, 2),
                "width": round(fw, 2), "height": round(fh, 2),
                "rotation": 0,
            }

            results.append({
                "id": field_id,
                "type": "rectanglelabels",
                "from_name": "field",
                "to_name": "image",
                "original_width": img_width,
                "original_height": img_height,
                "image_rotation": 0,
                "value": {**field_bbox, "rectanglelabels": [label]},
            })
            if field_text:
                results.append({
                    "id": field_id,
                    "type": "textarea",
                    "from_name": "transcription",
                    "to_name": "image",
                    "original_width": img_width,
                    "original_height": img_height,
                    "image_rotation": 0,
                    "value": {**field_bbox, "text": [field_text]},
                })

    for sec_idx, section in enumerate(page_extraction.section_headers):
        sec_box = section.box_2d
        if not sec_box or len(sec_box) != 4:
            continue

        sec_id = f"sec_{sec_idx}_{uuid.uuid4().hex[:6]}"
        sx, sy, sw, sh, sec_text, _ = _snap_bbox_to_words(
            sec_box, page_surya_words, img_width, img_height
        )
        if sw < 0.1 or sh < 0.1:
            continue

        sec_text = sec_text or section.text
        sec_bbox = {
            "x": round(sx, 2), "y": round(sy, 2),
            "width": round(sw, 2), "height": round(sh, 2),
            "rotation": 0,
        }

        results.append({
            "id": sec_id,
            "type": "rectanglelabels",
            "from_name": "zone",
            "to_name": "image",
            "original_width": img_width,
            "original_height": img_height,
            "image_rotation": 0,
            "value": {**sec_bbox, "rectanglelabels": ["Section Header"]},
        })
        if sec_text:
            results.append({
                "id": sec_id,
                "type": "textarea",
                "from_name": "transcription",
                "to_name": "image",
                "original_width": img_width,
                "original_height": img_height,
                "image_rotation": 0,
                "value": {**sec_bbox, "text": [sec_text]},
            })

    zone_count = sum(1 for r in results if r.get("from_name") == "zone" and r.get("type") == "rectanglelabels")
    field_count = sum(1 for r in results if r.get("from_name") == "field" and r.get("type") == "rectanglelabels")
    return results, zone_count, field_count, flagged


# =========================================================================
# SURYA OCR
# =========================================================================

_surya_instance = None

def _get_surya():
    global _surya_instance
    if _surya_instance is None:
        from services.pdf_extraction_service import SuryaOCRService
        _surya_instance = SuryaOCRService()
    return _surya_instance


# =========================================================================
# CORE PROCESSING: THREE-PASS PIPELINE
# =========================================================================

def _process_image_file(
    image_path: Path,
    output_images_dir: Path,
    source_type: str,
    source_file: str,
    page: int = 1,
    restaurant_name: str = "",
    pypdf2_text: str = "",
) -> Optional[Dict[str, Any]]:
    """Process a single image through the three-pass pipeline."""
    try:
        from PIL import Image as PILImage
    except ImportError:
        print("ERROR: Pillow required. Install: pip install Pillow", file=sys.stderr)
        return None

    try:
        img = PILImage.open(image_path)
        img.verify()
        img = PILImage.open(image_path)
    except Exception as e:
        print(f"  [SKIP] Cannot open image: {e}", file=sys.stderr)
        return None

    img_width, img_height = img.size

    safe_name = _sanitize_filename(image_path.name)
    dest = output_images_dir / safe_name
    if not dest.exists():
        import shutil
        shutil.copy2(image_path, dest)

    # === PASS 1: Page Classification ===
    print(f"    Pass 1: Classifying page...", end="", flush=True)
    classification = _pass1_classify_page(dest)
    time.sleep(0.5)

    if classification is None:
        print(" [FAILED, proceeding as wine_list]")
        page_type = "wine_list"
    else:
        page_type = classification.page_type
        print(f" {page_type} (~{classification.estimated_wine_count} wines, conf={classification.confidence:.2f})")

    if page_type in ("spirits_only", "food_menu", "not_menu"):
        print(f"    [SKIP] Page type: {page_type}")
        return None

    # === PASS 2: Zone Detection + Structured Data ===
    print(f"    Pass 2: Detecting zones...", end="", flush=True)
    page_data = _pass2_extract_zones(dest, page_type=page_type)
    time.sleep(0.5)

    if not page_data or not page_data.entries:
        print(" [NO ENTRIES]")
        return None

    print(f" {len(page_data.entries)} entries, {len(page_data.section_headers)} sections")

    # === SURYA OCR on full page (for zone snapping) ===
    surya = _get_surya()
    page_surya_words = []
    if surya.is_available:
        _, _, _, page_surya_words = surya.read_image_with_boxes(img)
    else:
        print(f"    [WARN] Surya OCR not available", file=sys.stderr)

    # === PASS 3: Field-Level Boxes ===
    num_entries = len(page_data.entries)
    use_batch = num_entries > ADAPTIVE_BATCH_THRESHOLD

    entry_fields: Dict[int, List[FieldBox]] = {}
    surya_words_by_entry: Dict[int, list] = {}
    crop_dims_by_entry: Dict[int, Tuple[int, int]] = {}

    if use_batch:
        print(f"    Pass 3: Field detection (batch mode, {num_entries} entries)...", flush=True)
        sorted_entries = sorted(
            enumerate(page_data.entries),
            key=lambda x: x[1].box_2d[0] if x[1].box_2d and len(x[1].box_2d) == 4 else 0,
        )

        batch_num = 0
        total_batches = (len(sorted_entries) + BATCH_STRIP_SIZE - 1) // BATCH_STRIP_SIZE
        for batch_start in range(0, len(sorted_entries), BATCH_STRIP_SIZE):
            batch = sorted_entries[batch_start:batch_start + BATCH_STRIP_SIZE]
            batch_num += 1
            if not batch:
                continue

            all_boxes = [e.box_2d for _, e in batch if e.box_2d and len(e.box_2d) == 4]
            if not all_boxes:
                continue

            strip_y_min = min(b[0] for b in all_boxes)
            strip_x_min = min(b[1] for b in all_boxes)
            strip_y_max = max(b[2] for b in all_boxes)
            strip_x_max = max(b[3] for b in all_boxes)
            strip_box = [strip_y_min, strip_x_min, strip_y_max, strip_x_max]

            strip_img = _crop_zone_from_image(img, strip_box)
            if strip_img is None:
                continue

            result = _pass3_detect_fields_batch(strip_img)
            time.sleep(0.3)

            if result:
                for orig_idx, entry in batch:
                    matched_fields = []
                    for field in result.fields:
                        page_fbox = _transform_field_box_to_page(field.box_2d, strip_box, img_width, img_height)
                        fy_center = (page_fbox[0] + page_fbox[2]) / 2
                        fx_center = (page_fbox[1] + page_fbox[3]) / 2
                        ebox = entry.box_2d
                        if ebox and len(ebox) == 4:
                            if ebox[0] <= fy_center <= ebox[2] and ebox[1] <= fx_center <= ebox[3]:
                                matched_fields.append(FieldBox(
                                    box_2d=page_fbox,
                                    label=field.label,
                                    text=field.text,
                                ))

                    entry_fields[orig_idx] = matched_fields
                    crop_dims_by_entry[orig_idx] = (strip_img.size[0], strip_img.size[1])
                print(f"      Batch {batch_num}/{total_batches}: OK ({sum(len(entry_fields.get(i, [])) for i, _ in batch)} fields)", flush=True)
            else:
                print(f"      Batch {batch_num}/{total_batches}: FAILED, falling back to individual...", flush=True)
                for orig_idx, entry in batch:
                    if not entry.box_2d or len(entry.box_2d) != 4:
                        continue
                    crop_img = _crop_zone_from_image(img, entry.box_2d)
                    if crop_img is None:
                        entry_fields[orig_idx] = []
                        continue
                    crop_dims_by_entry[orig_idx] = (crop_img.size[0], crop_img.size[1])
                    if surya.is_available:
                        try:
                            _, _, _, crop_words = surya.read_image_with_boxes(crop_img)
                            surya_words_by_entry[orig_idx] = crop_words
                        except Exception:
                            surya_words_by_entry[orig_idx] = []
                    ind_result = _pass3_detect_fields_single(crop_img, entry)
                    time.sleep(0.3)
                    if ind_result:
                        transformed = []
                        for field in ind_result.fields:
                            page_box = _transform_field_box_to_page(
                                field.box_2d, entry.box_2d, img_width, img_height
                            )
                            transformed.append(FieldBox(box_2d=page_box, label=field.label, text=field.text))
                        entry_fields[orig_idx] = transformed
                    else:
                        entry_fields[orig_idx] = []
    else:
        print(f"    Pass 3: Field detection (individual, {num_entries} entries)...", flush=True)
        for entry_idx, entry in enumerate(page_data.entries):
            if not entry.box_2d or len(entry.box_2d) != 4:
                continue

            crop_img = _crop_zone_from_image(img, entry.box_2d)
            if crop_img is None:
                continue

            crop_w, crop_h = crop_img.size
            crop_dims_by_entry[entry_idx] = (crop_w, crop_h)

            if surya.is_available:
                try:
                    _, _, _, crop_words = surya.read_image_with_boxes(crop_img)
                    surya_words_by_entry[entry_idx] = crop_words
                except Exception:
                    surya_words_by_entry[entry_idx] = []
            else:
                surya_words_by_entry[entry_idx] = []

            result = _pass3_detect_fields_single(crop_img, entry)
            time.sleep(0.3)

            if result:
                transformed = []
                for field in result.fields:
                    page_box = _transform_field_box_to_page(
                        field.box_2d, entry.box_2d, img_width, img_height
                    )
                    transformed.append(FieldBox(
                        box_2d=page_box,
                        label=field.label,
                        text=field.text,
                    ))
                entry_fields[entry_idx] = transformed
            else:
                entry_fields[entry_idx] = []

            if (entry_idx + 1) % 10 == 0:
                print(f"      {entry_idx + 1}/{num_entries} entries processed", flush=True)

    total_fields = sum(len(f) for f in entry_fields.values())
    print(f"    Pass 3 done: {total_fields} field boxes across {len(entry_fields)} entries")

    # === BUILD PREDICTIONS ===
    all_results, zone_count, field_count, flagged = _build_predictions(
        page_extraction=page_data,
        entry_fields=entry_fields,
        surya_words_by_entry=surya_words_by_entry,
        crop_dims_by_entry=crop_dims_by_entry,
        img_width=img_width,
        img_height=img_height,
        page_surya_words=page_surya_words,
    )

    if flagged:
        print(f"    Validation: {len(flagged)} entries flagged for review")

    model_used = FAST_MODEL
    task = {
        "data": {
            "image": f"/data/local-files/?d=datasets/annotation_images/{safe_name}",
            "source_type": source_type,
            "source_file": source_file,
            "page": page,
            "restaurant_name": restaurant_name,
            "vlm_count": page_data.total_wines,
            "vlm_conf": round(
                sum(e.confidence for e in page_data.entries) / len(page_data.entries)
                if page_data.entries else 0.0,
                3,
            ),
            "ocr_line_count": len(page_surya_words),
            "labeled_count": zone_count,
            "page_type": page_type,
            "flagged_count": len(flagged),
            "page_info": f"Page {page} · {source_type}",
            "pipeline_info": f"{page_data.total_wines} entries · {zone_count} zones · {field_count} fields · {model_used}",
        },
        "predictions": [{
            "model_version": f"three-pass-{model_used}",
            "result": all_results,
        }],
    }
    return task


def _process_pdf(
    pdf_path: Path,
    output_images_dir: Path,
    restaurant_name: str,
) -> List[Dict[str, Any]]:
    tasks = []

    try:
        from pdf2image import convert_from_path
        images = convert_from_path(pdf_path, dpi=300, fmt="png")
    except ImportError:
        print("ERROR: pdf2image required. Install: pip install pdf2image", file=sys.stderr)
        return tasks
    except Exception as e:
        print(f"  [ERROR] pdf2image failed for {pdf_path.name}: {e}", file=sys.stderr)
        return tasks

    stem = _sanitize_filename(pdf_path.stem)
    for page_idx, pil_img in enumerate(images):
        page_num = page_idx + 1
        img_name = f"{stem}_p{page_num}.png"
        img_path = output_images_dir / img_name
        pil_img.save(img_path, "PNG")

        try:
            task = _process_image_file(
                image_path=img_path,
                output_images_dir=output_images_dir,
                source_type="pdf",
                source_file=pdf_path.name,
                page=page_num,
                restaurant_name=restaurant_name,
            )
            if task:
                tasks.append(task)
        except Exception as e:
            import traceback
            print(f"  [ERROR] Page {page_num}: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)

    return tasks


# =========================================================================
# MAIN
# =========================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Prepare annotation tasks (three-pass Gemini+Surya pipeline)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--input", "-i", type=Path, required=True,
                        help="Directory containing input files")
    parser.add_argument("--output-images", type=Path,
                        default=PROJECT_ROOT / "datasets" / "annotation_images",
                        help="Directory for output page images")
    parser.add_argument("--output-tasks", type=Path,
                        default=PROJECT_ROOT / "datasets" / "annotation_tasks" / "tasks.json",
                        help="Output JSON file for Label Studio import")
    parser.add_argument("--source-type", choices=["pdf", "screenshot", "html_snapshot"],
                        default="pdf", help="Type of input files")
    parser.add_argument("--limit", type=int, default=0,
                        help="Limit number of files to process (0 = all, useful for pilot runs)")
    args = parser.parse_args()

    if not args.input.exists():
        print(f"Input directory not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    args.output_images.mkdir(parents=True, exist_ok=True)
    args.output_tasks.parent.mkdir(parents=True, exist_ok=True)

    files = _collect_files(args.input)
    if not files:
        print(f"No supported files found under {args.input}", file=sys.stderr)
        sys.exit(1)

    if args.limit > 0:
        files = files[:args.limit]

    print(f"Model: {FAST_MODEL} (fallback: {FALLBACK_MODEL})")
    print(f"Pipeline: Three-Pass Gemini+Surya (classify -> zones -> fields)")
    print(f"Found {len(files)} files in {args.input}")
    print(f"Source type: {args.source_type}")
    print(f"Output images: {args.output_images}")
    print(f"Output tasks: {args.output_tasks}")
    print(f"Adaptive batch threshold: >{ADAPTIVE_BATCH_THRESHOLD} entries/page")
    print()

    all_tasks = []
    skipped = 0
    t0 = time.time()

    for i, file_path in enumerate(files, 1):
        restaurant = _restaurant_from_path(file_path)
        print(f"[{i}/{len(files)}] {file_path.name} ...")

        if args.source_type == "pdf" and file_path.suffix.lower() in EXTENSIONS_PDF:
            tasks = _process_pdf(file_path, args.output_images, restaurant)
            kept = len(tasks)
            all_tasks.extend(tasks)
            print(f"  -> {kept} wine page(s) kept")

        elif file_path.suffix.lower() in EXTENSIONS_IMAGE:
            task = _process_image_file(
                image_path=file_path,
                output_images_dir=args.output_images,
                source_type=args.source_type,
                source_file=file_path.name,
                page=1,
                restaurant_name=restaurant,
            )
            if task:
                all_tasks.append(task)
                zones = task["data"].get("vlm_count", "?")
                fields = task["data"]["pipeline_info"].split("·")[2].strip().split(" ")[0] if "·" in task["data"]["pipeline_info"] else "?"
                print(f"  -> 1 task, {zones} wines, {fields} fields")
            else:
                skipped += 1
                print(f"  -> SKIPPED")
        else:
            print(f"  [SKIP] Unsupported file type: {file_path.suffix}")

    page_counts: Dict[str, int] = {}
    for t in all_tasks:
        sf = t["data"]["source_file"]
        page_counts[sf] = page_counts.get(sf, 0) + 1
    for t in all_tasks:
        d = t["data"]
        total = page_counts.get(d["source_file"], "?")
        d["page_info"] = f"Page {d['page']} of {total} · {d['source_type']}"

    with open(args.output_tasks, "w", encoding="utf-8") as f:
        json.dump(all_tasks, f, indent=2, ensure_ascii=False)

    elapsed = time.time() - t0
    print(f"\n{'='*60}")
    print(f"DONE in {elapsed:.0f}s")
    print(f"Tasks created: {len(all_tasks)}")
    print(f"Pages skipped: {skipped}")

    if all_tasks:
        total_vlm_wines = sum(t["data"].get("vlm_count", 0) for t in all_tasks)
        avg_confidence = sum(t["data"].get("vlm_conf", 0) for t in all_tasks) / len(all_tasks)
        total_flagged = sum(t["data"].get("flagged_count", 0) for t in all_tasks)

        zone_dist = {}
        field_dist = {}
        for t in all_tasks:
            for r in t.get("predictions", [{}])[0].get("result", []):
                if r.get("type") == "rectanglelabels":
                    for lbl in r["value"].get("rectanglelabels", []):
                        if r.get("from_name") == "zone":
                            zone_dist[lbl] = zone_dist.get(lbl, 0) + 1
                        elif r.get("from_name") == "field":
                            field_dist[lbl] = field_dist.get(lbl, 0) + 1

        print(f"Total wines detected: {total_vlm_wines}")
        print(f"Avg confidence: {avg_confidence:.2f}")
        print(f"Entries flagged for review: {total_flagged}")
        print(f"\nZone distribution:")
        for lbl, count in sorted(zone_dist.items(), key=lambda x: -x[1]):
            print(f"  {lbl}: {count}")
        print(f"\nField distribution:")
        if field_dist:
            for lbl, count in sorted(field_dist.items(), key=lambda x: -x[1]):
                print(f"  {lbl}: {count}")
        else:
            print("  (none)")

        page_types = {}
        for t in all_tasks:
            pt = t["data"].get("page_type", "unknown")
            page_types[pt] = page_types.get(pt, 0) + 1
        print(f"\nPage type distribution:")
        for pt, count in sorted(page_types.items(), key=lambda x: -x[1]):
            print(f"  {pt}: {count}")

    print(f"\nOutput: {args.output_tasks}")
    print("Import to Label Studio: Data Import -> Upload Files -> select this JSON.")


if __name__ == "__main__":
    main()
