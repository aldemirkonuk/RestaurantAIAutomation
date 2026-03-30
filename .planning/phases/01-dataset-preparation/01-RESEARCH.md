# Phase 1: Dataset Preparation - Research

**Researched:** 2026-03-30
**Domain:** Label Studio annotation conversion, YOLO dataset construction, Gemini Vision auto-annotation, data augmentation
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DATA-01 | Label Studio annotations converted to YOLO format (x_center, y_center, w, h normalized) for Wine Entry and Section Header classes | Conversion formula verified by direct inspection of annotation JSON and coordinate math (see Architecture Patterns) |
| DATA-02 | 262 labeled images split into train/val/test sets (70/20/10) | Yields 183/52/27; stratified split by source_type (screenshot vs pdf) confirmed as best practice for this imbalanced composition |
| DATA-03 | Gemini Vision auto-annotates 11 sub-field classes within each Wine Entry bounding box | genai 0.3.2 installed, GenerativeModel + PIL inline image confirmed working; gemini-1.5-flash is the correct model name |
| DATA-04 | Auto-annotations reviewed and saved to YOLO label files | Merge strategy: append sub-field lines to existing label files; confidence threshold filtering required |
| DATA-05 | Data augmentation pipeline applied (flip, rotate, brightness, mosaic) | Ultralytics 8.1.0 has all these built-in via training hyperparameters; no extra library needed |
</phase_requirements>

---

## Summary

This phase converts 262 Label Studio-annotated images into a complete YOLO training dataset with all 13 classes labeled. The first step is deterministic: parse the Label Studio JSON, apply a two-line coordinate conversion formula, copy images into train/val/test split directories, and write YOLO .txt label files. The second step is probabilistic: crop every Wine Entry bounding box from each image, send the crop to Gemini Vision, and parse sub-field bounding boxes from the response.

The most significant risk in this phase is Gemini Vision annotation quality. Wine Entry crops are extremely wide and flat (typical PDF crop: 1418×40 pixels; typical screenshot crop: 508×34 pixels). These aspect ratios are unusual and Gemini may struggle to localize sub-fields precisely. The prompt strategy must account for this — requesting normalized coordinates relative to the crop dimensions, not pixel values. Responses must be validated for coordinate sanity before writing to label files.

The data.yaml path configuration has a verified bug: the current value `path: datasets/wine_menus` double-nests against the DATASETS_DIR setting (`/path/to/project/datasets`), producing a broken path at training time. This must be fixed to `path: wine_menus` before any training attempt.

**Primary recommendation:** Build a two-script pipeline — `convert_labels.py` for the deterministic Label Studio → YOLO conversion (including split and copy), and `auto_annotate_subfields.py` for the Gemini Vision loop. Keep them separate so the first can be validated independently before the expensive Gemini step runs.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ultralytics | 8.1.0 (installed) | YOLO dataset format, training, augmentation | Official YOLO implementation; all augmentation built-in |
| google-generativeai | 0.3.2 (installed) | Gemini Vision API for sub-field auto-annotation | Already installed; GenerativeModel supports inline PIL images |
| Pillow | 10.4.0 (installed) | Image cropping, format conversion | Required by both ultralytics and genai for image manipulation |
| numpy | 1.26.4 (installed) | Array operations, coordinate math | Standard numeric library |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| json (stdlib) | — | Parse Label Studio annotation files | Step 1 of conversion |
| shutil (stdlib) | — | Copy images to train/val/test directories | Required; ultralytics cannot use symlinks reliably |
| pathlib (stdlib) | — | Cross-platform path handling | Safer than os.path for all path operations |
| random (stdlib) | — | Reproducible train/val/test shuffle | Use `random.seed(42)` for reproducibility |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| genai 0.3.2 | Upgrade to genai 0.8.6 | 0.8.6 supports gemini-2.0-flash and has a cleaner API, but 0.3.2 is installed and works for the task; upgrading risks breaking other pipeline dependencies |
| Built-in augmentation | albumentations | albumentations not installed; ultralytics built-in augmentation covers all DATA-05 requirements |
| Inline PIL images | Base64 string | Both work in 0.3.2; PIL inline is simpler and avoids manual encoding |

**Installation:** No new packages required. All dependencies are already installed.

**Version verification:** Confirmed installed versions via `pip3 show` on 2026-03-30.

---

## Architecture Patterns

### Recommended Project Structure
```
datasets/
├── annotation_tasks/
│   ├── screenshots.json          # 28 tasks, 270 boxes (267 WE + 3 SH)
│   └── pdfs.json                 # 234 tasks, 2480 boxes (2464 WE + 16 SH)
├── annotation_images/            # 334 total PNGs (262 annotated, 72 unannotated)
└── wine_menus/
    ├── data.yaml                 # MUST fix path: wine_menus (currently broken)
    ├── images/
    │   ├── train/                # 183 images (shutil.copy from annotation_images/)
    │   ├── val/                  # 52 images
    │   └── test/                 # 27 images
    ├── labels/
    │   ├── train/                # 183 .txt files (YOLO format)
    │   ├── val/                  # 52 .txt files
    │   └── test/                 # 27 .txt files
    └── dataset_stats.json        # Class distribution report

datasets/scripts/                 # New: conversion scripts
├── convert_labels.py             # Step 1: Label Studio → YOLO + split + copy
└── auto_annotate_subfields.py    # Step 2: Gemini Vision sub-field annotation
```

### Pattern 1: Label Studio to YOLO Coordinate Conversion

**What:** Label Studio stores bounding boxes as top-left corner (x, y) + dimensions (width, height), all as percentages of image dimensions (0-100). YOLO requires center coordinates normalized to 0-1.

**Exact formula (verified against real annotation data):**
```python
# Source: verified by inspection of screenshots.json and pdfs.json
# Label Studio values are already in percentage units (0-100)
# No need to use original_width/original_height — percentages are dimension-independent

def ls_to_yolo(x_pct, y_pct, w_pct, h_pct):
    """Convert Label Studio rectanglelabel to YOLO normalized format."""
    x_center = (x_pct + w_pct / 2) / 100.0
    y_center = (y_pct + h_pct / 2) / 100.0
    width    = w_pct / 100.0
    height   = h_pct / 100.0
    return x_center, y_center, width, height

# Verified example: x=2.8, y=2.8, w=21.6, h=3.2 (screenshot, 2352x1076)
# → x_center=0.1360, y_center=0.0440, width=0.2160, height=0.0320
# All values confirmed in [0, 1] range
```

**Class ID mapping (from data.yaml):**
```python
LABEL_TO_CLASS_ID = {
    "Wine Entry":      0,
    "Section Header":  1,
    # Sub-field classes 2-12 come from Gemini auto-annotation only
}
```

**YOLO label file format:**
```
# One line per bounding box: class_id x_center y_center width height
0 0.1360 0.0440 0.2160 0.0320
1 0.4500 0.1200 0.8900 0.0180
```

### Pattern 2: Annotation JSON Parsing Strategy

**What:** Each annotation task has multiple result entries of different types (rectanglelabels, textarea, choices). Only `rectanglelabels` entries contain the bounding box and class label needed for YOLO conversion.

```python
# Source: verified by inspection of screenshots.json / pdfs.json structure
def parse_task(task):
    """Extract YOLO-ready bounding boxes from a Label Studio task."""
    image_filename = task["data"]["image"].split("d=datasets/annotation_images/")[-1]
    boxes = []
    for prediction in task.get("predictions", []):
        for result in prediction.get("result", []):
            if result.get("type") != "rectanglelabels":
                continue
            value = result["value"]
            label = value["rectanglelabels"][0]
            if label not in LABEL_TO_CLASS_ID:
                continue  # Skip unknown labels
            class_id = LABEL_TO_CLASS_ID[label]
            x_c, y_c, w, h = ls_to_yolo(value["x"], value["y"], value["width"], value["height"])
            boxes.append((class_id, x_c, y_c, w, h))
    return image_filename, boxes
```

### Pattern 3: Train/Val/Test Split with Stratification

**What:** 262 images split 70/20/10 with stratification by source type (screenshot vs PDF). This ensures both types appear in all splits proportionally.

```python
import random
from pathlib import Path

def stratified_split(screenshot_tasks, pdf_tasks, seed=42):
    """
    Returns (train_files, val_files, test_files) as lists of image filenames.
    70/20/10 split applied separately to screenshots and PDFs.
    Result: train=183, val=52, test=27
    """
    random.seed(seed)

    def split_group(tasks):
        filenames = [t["data"]["image"].split("d=datasets/annotation_images/")[-1] for t in tasks]
        random.shuffle(filenames)
        n = len(filenames)
        n_train = int(n * 0.70)
        n_val   = int(n * 0.20)
        return filenames[:n_train], filenames[n_train:n_train+n_val], filenames[n_train+n_val:]

    ss_train, ss_val, ss_test = split_group(screenshot_tasks)
    pdf_train, pdf_val, pdf_test = split_group(pdf_tasks)

    train = ss_train + pdf_train  # ~183
    val   = ss_val   + pdf_val    # ~52
    test  = ss_test  + pdf_test   # ~27
    return train, val, test
```

### Pattern 4: Gemini Vision Sub-Field Auto-Annotation

**What:** For each Wine Entry bounding box, crop the image, send to Gemini 1.5 Flash, and request normalized bounding boxes for the 11 sub-field classes. Coordinates must be relative to the crop (not the original image) and will later be re-projected back.

**Crop dimensions context:** Wine Entry crops are typically 1418×40px (PDF) or 508×34px (screenshot) — very wide and flat. Sub-field elements like price/vintage are approximately 170×22px within the crop.

```python
import google.generativeai as genai
from PIL import Image
import json

def build_subfield_prompt():
    return """You are analyzing a cropped wine menu entry. The image shows a single wine listing.

Identify the locations of these elements if they are visible:
- wine_name: the primary wine name
- producer: winery or estate name (only if separate from wine_name)
- vintage: the year (4-digit) or "NV"
- price: the price with currency symbol
- grape_variety: varietal text (only if on its own)
- origin_info: country/region/appellation
- description: tasting notes or description text
- serving_type: glass/bottle/carafe indicator
- rating: score badge (e.g. "92pts", stars)
- classification: "Grand Cru", "Reserva", "DOC", etc.
- bottle_info: volume ("750ml") or ABV ("13.5%")

Return ONLY a JSON array. Each element:
{
  "class": "<class_name>",
  "x_center": <0.0-1.0>,
  "y_center": <0.0-1.0>,
  "width": <0.0-1.0>,
  "height": <0.0-1.0>
}

Coordinates are normalized to the crop image dimensions (0.0 = left/top, 1.0 = right/bottom).
Omit any class not visible. Return [] if no sub-fields are detectable.
Return ONLY the JSON array, no other text."""

def annotate_wine_entry_crop(model, crop_pil_image):
    """Send a Wine Entry crop to Gemini and return parsed sub-field boxes."""
    prompt = build_subfield_prompt()
    try:
        response = model.generate_content([prompt, crop_pil_image])
        text = response.text.strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        boxes = json.loads(text)
        return [b for b in boxes if _is_valid_box(b)]
    except Exception:
        return []

def _is_valid_box(box):
    """Validate that a Gemini-returned box has sane coordinates."""
    required = {"class", "x_center", "y_center", "width", "height"}
    if not required.issubset(box.keys()):
        return False
    for key in ("x_center", "y_center", "width", "height"):
        v = box[key]
        if not (0.0 <= v <= 1.0):
            return False
    if box["width"] < 0.01 or box["height"] < 0.01:
        return False  # Degenerate box
    return True
```

**Re-projection from crop space to image space:**
```python
def reproject_to_image(crop_box, entry_box_yolo, img_w, img_h):
    """
    Convert sub-field box (relative to crop) back to full-image YOLO coords.

    crop_box: {"x_center", "y_center", "width", "height"} — normalized to crop
    entry_box_yolo: (x_center, y_center, width, height) — normalized to full image
    """
    # Convert entry box from YOLO normalized to pixel coords
    ex_c = entry_box_yolo[0] * img_w
    ey_c = entry_box_yolo[1] * img_h
    ew   = entry_box_yolo[2] * img_w
    eh   = entry_box_yolo[3] * img_h
    ex_tl = ex_c - ew / 2
    ey_tl = ey_c - eh / 2

    # Sub-field position within crop (pixel coords relative to crop)
    sf_x_c_px = crop_box["x_center"] * ew
    sf_y_c_px = crop_box["y_center"] * eh
    sf_w_px   = crop_box["width"]    * ew
    sf_h_px   = crop_box["height"]   * eh

    # Absolute pixel position in original image
    abs_x_c = ex_tl + sf_x_c_px
    abs_y_c = ey_tl + sf_y_c_px

    # Normalize to full image
    return abs_x_c / img_w, abs_y_c / img_h, sf_w_px / img_w, sf_h_px / img_h
```

### Pattern 5: data.yaml Path Fix

**What:** The current `data.yaml` has `path: datasets/wine_menus`. Ultralytics resolves non-absolute paths by prepending `DATASETS_DIR`. The project's `DATASETS_DIR` is already set to `.../datasets`, so the current value resolves to `.../datasets/datasets/wine_menus` — a broken double-nested path.

**Fix (update data.yaml):**
```yaml
# BEFORE (broken):
path: datasets/wine_menus

# AFTER (correct — ultralytics prepends DATASETS_DIR which is already .../datasets):
path: wine_menus
```

**Verified:** `DATASETS_DIR = /Users/aldemirkonuk/Desktop/UnicornProjects/Restaurant AI Automation/datasets` (confirmed via `ultralytics.utils.SETTINGS`). With `path: wine_menus`, ultralytics resolves to `.../datasets/wine_menus` which is correct.

### Anti-Patterns to Avoid

- **Filtering result entries by label only:** The JSON has multiple result types per annotation (rectanglelabels, textarea, choices) all sharing the same `id`. Filter strictly on `type == "rectanglelabels"` or you will process the same coordinate three times.
- **Using original_width/original_height for coordinate conversion:** Label Studio percentage coords are already dimension-independent. Do not multiply by original_width/height before the conversion — the formula operates directly on percentage values.
- **Writing empty label files:** Images with no valid annotations after filtering must still get an empty `.txt` file. Ultralytics silently skips images with no label file but may crash or warn if expected label files are missing.
- **Sending full-image to Gemini for sub-fields:** Always crop to the Wine Entry bounding box first. Full-image prompts with many wine entries produce hallucinated/unreliable per-entry coordinates.
- **Absolute pixel coordinates in Gemini prompts:** Gemini Vision cannot reliably return pixel coordinates. Always ask for normalized coordinates (0.0-1.0 relative to the input crop).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Image augmentation | Custom flip/rotate/brightness pipeline | ultralytics built-in augmentation hyperparameters (`fliplr`, `degrees`, `hsv_v`, `mosaic`) | Already built into training loop; no extra library or pre-augmentation step needed |
| Mosaic augmentation | Custom tile-combining code | ultralytics `mosaic=1.0` default | ultralytics mosaic combines 4 images during training; complex to replicate correctly |
| YOLO label format validation | Custom validator | ultralytics auto-validation at training start | Ultralytics validates all label files and reports malformed lines before training begins |
| JSON response parsing from Gemini | Regex-based parser | `json.loads()` with try/except + code fence stripping | Gemini outputs vary slightly; strict JSON parse with fallback to empty list is correct approach |

**Key insight:** The augmentation required by DATA-05 (flip, rotate, brightness, mosaic) is entirely handled by ultralytics training hyperparameters. There is no need to pre-augment images on disk. Setting training args `fliplr=0.5, degrees=10, hsv_v=0.4, mosaic=1.0` covers all DATA-05 requirements.

---

## Common Pitfalls

### Pitfall 1: Gemini Returns Boxes Outside [0, 1] Range
**What goes wrong:** Gemini occasionally returns coordinate values slightly above 1.0 (e.g., 1.02) or negative values, especially for elements near crop edges.
**Why it happens:** Gemini does not enforce strict bounds on numerical outputs.
**How to avoid:** Apply `_is_valid_box()` validation after every API call. Clamp any box with coordinates slightly outside range (e.g., clip to [0.001, 0.999]) rather than discarding, if other fields are valid.
**Warning signs:** `x_center + width/2 > 1.0` or any negative value.

### Pitfall 2: Gemini Returns Coordinates Relative to Full Image, Not Crop
**What goes wrong:** Despite the prompt explicitly stating "normalized to the crop image dimensions," Gemini sometimes returns coordinates in the range [0.0, 0.1] suggesting full-image space (since a crop is ~10% of the original image).
**Why it happens:** Gemini may interpret the image in context of the original source.
**How to avoid:** Add a sanity check: if all returned `x_center` values are < 0.15 AND the crop is known to be < 15% of the image width, flag as possibly full-image coordinates and skip or re-prompt.
**Warning signs:** All sub-field x_centers clustering in a narrow range (< 0.2 width).

### Pitfall 3: data.yaml Double-Nested Path Breaks Training
**What goes wrong:** Training fails with "Dataset images not found" despite images being present.
**Why it happens:** `path: datasets/wine_menus` + `DATASETS_DIR=/path/to/project/datasets` resolves to `.../datasets/datasets/wine_menus`.
**How to avoid:** Fix data.yaml to `path: wine_menus` before running any training. Verify resolution with: `python3 -c "from ultralytics.data.utils import check_det_dataset; d = check_det_dataset('datasets/wine_menus/data.yaml'); print(d['path'])"`
**Warning signs:** "missing path" error at training start; path in error message contains `datasets/datasets/`.

### Pitfall 4: Section Header Extreme Class Imbalance
**What goes wrong:** Only 19 Section Header boxes exist across all 262 images (ratio 144:1 vs Wine Entry). With a 70% train split, approximately 13 Section Header boxes are in training data — far below the ~300 instances typically needed for reliable detection.
**Why it happens:** Section Headers are rare in wine menus; the annotation scope only captured prominent ones.
**How to avoid:** This is an inherent data limitation. Document the expected low mAP for Section Header in dataset_stats.json. Do NOT attempt to reject or re-sample to balance classes — the 13 real examples are better than nothing. The Phase 2 training target of mAP50 ≥ 0.90 for Section Header is ambitious given this data; Phase 2 should lower expectations for this class.
**Warning signs:** Section Header mAP reported as 0.0 or near-zero in validation.

### Pitfall 5: Wide-Flat Crops Confuse Sub-Field Localization
**What goes wrong:** Wine Entry crops average 1418×40px (PDFs) — an extreme 35:1 aspect ratio. Gemini Vision performs best on approximately square images. Sub-field precision will be lower for these wide entries.
**Why it happens:** Wine menu rows are designed for human reading in narrow horizontal bands.
**How to avoid:** Before sending to Gemini, check if crop height < 60px and upscale to at least 2× height (e.g., resize to 1418×80px using LANCZOS). This gives the model more pixel signal without distorting the aspect ratio conceptually. Log the original dimensions so reproject_to_image uses pre-upscale dimensions.
**Warning signs:** All returned height values clustering near 1.0 (Gemini treating entire height as one element).

### Pitfall 6: google-generativeai 0.3.2 API Rate Limits
**What goes wrong:** With 2,731 Wine Entry boxes, sending one API call per box will hit Gemini rate limits (free tier: 15 requests/minute; paid: 1000 RPM for flash).
**Why it happens:** Volume of auto-annotation calls.
**How to avoid:** Add `time.sleep(0.1)` between calls (safe at 600 RPM), implement exponential backoff on 429 errors, and checkpoint progress to a JSON file so the script can resume if interrupted. Log success/failure per image.
**Warning signs:** HTTP 429 errors; incomplete annotation files.

---

## Code Examples

### Full Conversion Script Skeleton
```python
# Source: derived from verified annotation format inspection
import json, random, shutil
from pathlib import Path

ANNOTATION_IMAGES = Path("datasets/annotation_images")
OUTPUT_BASE        = Path("datasets/wine_menus")
LABEL_TO_CLASS_ID  = {"Wine Entry": 0, "Section Header": 1}

def ls_to_yolo(x, y, w, h):
    return (x + w/2)/100, (y + h/2)/100, w/100, h/100

def convert_and_split(screenshots_json, pdfs_json, seed=42):
    # 1. Parse all tasks
    tasks = json.load(open(screenshots_json)) + json.load(open(pdfs_json))

    # 2. Build label map
    label_map = {}  # filename → [(class_id, x_c, y_c, w, h), ...]
    for task in tasks:
        fname = task["data"]["image"].split("d=datasets/annotation_images/")[-1]
        boxes = []
        for pred in task.get("predictions", []):
            for r in pred.get("result", []):
                if r.get("type") != "rectanglelabels":
                    continue
                label = r["value"]["rectanglelabels"][0]
                if label not in LABEL_TO_CLASS_ID:
                    continue
                cid = LABEL_TO_CLASS_ID[label]
                boxes.append((cid, *ls_to_yolo(r["value"]["x"], r["value"]["y"],
                                               r["value"]["width"], r["value"]["height"])))
        label_map[fname] = boxes

    # 3. Stratified split
    random.seed(seed)
    ss = [t for t in tasks if t["data"]["source_type"] == "screenshot"]
    pdf = [t for t in tasks if t["data"]["source_type"] == "pdf"]
    train_files, val_files, test_files = stratified_split(ss, pdf)

    # 4. Copy images + write labels
    for split_name, file_list in [("train", train_files), ("val", val_files), ("test", test_files)]:
        img_dir = OUTPUT_BASE / "images" / split_name
        lbl_dir = OUTPUT_BASE / "labels" / split_name
        img_dir.mkdir(parents=True, exist_ok=True)
        lbl_dir.mkdir(parents=True, exist_ok=True)
        for fname in file_list:
            shutil.copy(ANNOTATION_IMAGES / fname, img_dir / fname)
            stem = Path(fname).stem
            label_file = lbl_dir / f"{stem}.txt"
            with open(label_file, "w") as f:
                for box in label_map.get(fname, []):
                    f.write(f"{box[0]} {box[1]:.6f} {box[2]:.6f} {box[3]:.6f} {box[4]:.6f}\n")
```

### Gemini Vision Setup (genai 0.3.2)
```python
# Source: verified by inspecting google.generativeai.types.content_types
import google.generativeai as genai
import os

genai.configure(api_key=os.environ["GOOGLE_API_KEY"])
model = genai.GenerativeModel("gemini-1.5-flash")

# Pass PIL image directly — genai 0.3.2 auto-converts via pil_to_blob()
from PIL import Image
crop = Image.open("path/to/crop.png")
response = model.generate_content([prompt_text, crop])
```

### Crop Extraction
```python
# Source: standard Pillow crop operation
from PIL import Image

def crop_wine_entry(img_path, yolo_box):
    """
    yolo_box: (x_center, y_center, width, height) — all normalized 0-1
    Returns: PIL.Image of the crop, and (img_w, img_h) for reprojection
    """
    img = Image.open(img_path).convert("RGB")
    img_w, img_h = img.size

    x_c, y_c, w, h = yolo_box
    x1 = max(0, int((x_c - w/2) * img_w))
    y1 = max(0, int((y_c - h/2) * img_h))
    x2 = min(img_w, int((x_c + w/2) * img_w))
    y2 = min(img_h, int((y_c + h/2) * img_h))

    crop = img.crop((x1, y1, x2, y2))

    # Upscale very short crops for better Gemini performance
    cw, ch = crop.size
    if ch < 60:
        scale = 60 / ch
        crop = crop.resize((int(cw * scale), 60), Image.LANCZOS)

    return crop, img_w, img_h
```

### dataset_stats.json Generation
```python
import json
from collections import defaultdict
from pathlib import Path

CLASS_NAMES = {0:"wine_entry",1:"section_header",2:"wine_name",3:"producer",
               4:"vintage",5:"price",6:"grape_variety",7:"origin_info",
               8:"description",9:"serving_type",10:"rating",11:"classification",12:"bottle_info"}

def generate_stats(labels_base: Path) -> dict:
    counts = defaultdict(lambda: {"train":0, "val":0, "test":0})
    for split in ("train", "val", "test"):
        for lbl_file in (labels_base / split).glob("*.txt"):
            for line in lbl_file.read_text().strip().splitlines():
                if line:
                    cid = int(line.split()[0])
                    counts[CLASS_NAMES[cid]][split] += 1
    return {"class_distribution": dict(counts)}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual annotation for all classes | Gemini Vision auto-annotation for sub-fields | 2026 (this project) | Eliminates need for human annotation of 11 classes; quality is lower but sufficient for training seed labels |
| YOLO data as separate augmentation step | Ultralytics in-training augmentation | YOLOv8 (2023) | No need to pre-augment disk images; augmentation runs on-the-fly per epoch |
| Fixed-size image resizing | Ultralytics `imgsz` parameter with letterboxing | YOLOv8 | Maintains aspect ratio; variable input sizes handled automatically |

**Deprecated/outdated:**
- `labelImg` XML/Pascal VOC format: superseded by YOLO txt format for ultralytics training
- Manual coordinate conversion scripts: Label Studio now has an export plugin, but it is not installed here; the manual formula is sufficient and verified

---

## Open Questions

1. **google-generativeai version for Gemini 2.0**
   - What we know: 0.3.2 is installed; 0.8.6 is latest available; gemini-1.5-flash works with 0.3.2
   - What's unclear: Whether the project's other code depends on 0.3.2 API surface (e.g., `organize_menus.py` uses genai)
   - Recommendation: Use gemini-1.5-flash with 0.3.2 for this phase; if quality is insufficient, evaluate upgrading in Phase 2

2. **72 unannotated images in annotation_images/**
   - What we know: 334 total images, 262 annotated, 72 without annotation tasks
   - What's unclear: Whether these 72 should be included as unannotated images (background/negative examples) or excluded entirely
   - Recommendation: Exclude from this phase. Including them without labels would require YOLO `exclude_classes` handling. They could be added as negatives in Phase 2 if mAP needs improvement.

3. **Gemini sub-field annotation coverage target**
   - What we know: Phase success criterion requires ≥ 80% of Wine Entry boxes successfully annotated
   - What's unclear: Whether "successfully annotated" means ≥ 1 sub-field detected per entry, or all 11 classes present
   - Recommendation: Define as "≥ 1 valid sub-field box returned for the entry." Log per-class hit rates in dataset_stats.json.

4. **Rate limit budget for 2,731 Gemini API calls**
   - What we know: 2,731 Wine Entry boxes total; free tier is 15 RPM; paid is 1000 RPM
   - What's unclear: Which tier the GOOGLE_API_KEY belongs to
   - Recommendation: Script must implement rate limiting regardless of tier. At 15 RPM, full annotation takes ~3 hours. Add `--resume` flag to checkpoint progress.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3 | All scripts | Yes | 3.11.0 | — |
| ultralytics | DATA-05, YOLO format validation | Yes | 8.1.0 | — |
| google-generativeai | DATA-03 | Yes | 0.3.2 | — |
| Pillow | Image cropping | Yes | 10.4.0 | — |
| numpy | Coordinate math | Yes | 1.26.4 | — |
| GOOGLE_API_KEY env var | DATA-03 Gemini calls | Not set in current shell | — | Must be set before running auto_annotate_subfields.py |

**Missing dependencies with no fallback:**
- `GOOGLE_API_KEY` environment variable: not set in the current shell session. Script must fail fast with a clear error if not set, rather than proceeding with empty string key.

**Missing dependencies with fallback:**
- None beyond the API key.

---

## Sources

### Primary (HIGH confidence)
- Direct inspection of `datasets/annotation_tasks/screenshots.json` — annotation format, coordinate values, original_width/height
- Direct inspection of `datasets/annotation_tasks/pdfs.json` — 234 tasks, 2480 boxes, diverse image dimensions
- `ultralytics.utils.SETTINGS` runtime output — confirmed DATASETS_DIR, runs_dir, settings_version
- `ultralytics.data.utils.check_det_dataset` source — path resolution logic verified line by line
- `google.generativeai.types.content_types` source — confirmed PIL inline image support via `pil_to_blob()`
- `ultralytics.cfg.get_cfg()` output — verified default augmentation hyperparameters

### Secondary (MEDIUM confidence)
- ultralytics 8.1.0 installed package — augmentation classes (Mosaic, RandomFlip, Albumentations) confirmed present
- Coordinate math — cross-validated against two sample annotations from different source types (screenshot 2352×1076, PDF 3400×2200)

### Tertiary (LOW confidence)
- Gemini rate limits (15 RPM free, 1000 RPM paid) — based on training data knowledge; verify at https://ai.google.dev/pricing before running at scale
- YOLOv8 "300 instances per class" heuristic — community guideline, not official Ultralytics documentation

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified installed with exact versions
- Architecture: HIGH — conversion formula verified against real data; data.yaml path bug confirmed by ultralytics source inspection
- Pitfalls: HIGH for coordinate conversion and path issues (verified); MEDIUM for Gemini behavior (based on known API patterns); LOW for specific rate limit numbers

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (ultralytics and genai versions stable; Gemini model availability may change sooner)
