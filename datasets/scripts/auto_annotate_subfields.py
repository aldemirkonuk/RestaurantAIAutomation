"""
auto_annotate_subfields.py

Reads existing YOLO label files from the wine_menus dataset, crops every class-0
(Wine Entry) bounding box from the source image, sends each crop to Gemini Vision
(gemini-2.5-flash-lite), and appends valid sub-field annotations (classes 2-12) back to
the label files.

Usage:
    python3 datasets/scripts/auto_annotate_subfields.py --resume
    python3 datasets/scripts/auto_annotate_subfields.py --splits train val
"""

import json
import os
import time
import argparse
import tempfile
import shutil
from pathlib import Path
from PIL import Image

# ---------------------------------------------------------------------------
# Attempt to load GOOGLE_API_KEY from .env files if not already in environment
# ---------------------------------------------------------------------------
def _load_dotenv_fallback():
    """Try to load GOOGLE_API_KEY from .env files if not set in environment."""
    if os.environ.get("GOOGLE_API_KEY"):
        return  # Already set

    # Search in project root and common service directories
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent.parent
    candidate_envs = [
        project_root / ".env",
        project_root / "services" / "agent-orchestrator" / ".env",
        project_root / ".env.local",
    ]
    for env_path in candidate_envs:
        if env_path.exists():
            try:
                for line in env_path.read_text().splitlines():
                    line = line.strip()
                    if line.startswith("#") or "=" not in line:
                        continue
                    key, _, val = line.partition("=")
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    if key == "GOOGLE_API_KEY" and val:
                        os.environ["GOOGLE_API_KEY"] = val
                        print(f"  Loaded GOOGLE_API_KEY from {env_path}")
                        return
            except Exception:
                pass


_load_dotenv_fallback()

import google.generativeai as genai  # noqa: E402 — must come after env load

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
PROJECT_ROOT    = Path(__file__).resolve().parent.parent.parent
ANNOTATION_IMGS = PROJECT_ROOT / "datasets" / "annotation_images"
LABELS_BASE     = PROJECT_ROOT / "datasets" / "wine_menus" / "labels"
IMAGES_BASE     = PROJECT_ROOT / "datasets" / "wine_menus" / "images"
PROGRESS_FILE   = PROJECT_ROOT / "datasets" / "wine_menus" / "annotation_progress.json"

SUBFIELD_CLASS_IDS = {
    "wine_name": 2,
    "producer": 3,
    "vintage": 4,
    "price": 5,
    "grape_variety": 6,
    "origin_info": 7,
    "description": 8,
    "serving_type": 9,
    "rating": 10,
    "classification": 11,
    "bottle_info": 12,
}


# ---------------------------------------------------------------------------
# Fail-fast API key check
# ---------------------------------------------------------------------------
def _require_api_key():
    """Fail fast with a clear message if GOOGLE_API_KEY is not set."""
    key = os.environ.get("GOOGLE_API_KEY", "")
    if not key:
        raise EnvironmentError(
            "GOOGLE_API_KEY environment variable is not set. "
            "Export it before running: export GOOGLE_API_KEY='your-key'\n"
            "Or place it in the project's .env file as: GOOGLE_API_KEY=your-key"
        )
    return key


# ---------------------------------------------------------------------------
# Prompt builder
# ---------------------------------------------------------------------------
def build_subfield_prompt():
    """Return the Gemini Vision prompt for sub-field detection."""
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


# ---------------------------------------------------------------------------
# Box validation
# ---------------------------------------------------------------------------
def _is_valid_box(box):
    """
    Validate and clamp a Gemini-returned bounding box.

    Returns (is_valid: bool, clamped_box: dict).

    Rules:
    - Required keys: class, x_center, y_center, width, height
    - class must be in SUBFIELD_CLASS_IDS
    - Each coordinate clamped to [0.001, 0.999] if within 0.05 tolerance of [0, 1]
    - If any coordinate deviates more than 0.05 outside [0, 1], reject
    - width and height must be >= 0.01 after clamping
    """
    required = {"class", "x_center", "y_center", "width", "height"}
    if not required.issubset(box.keys()):
        return False, box
    if box["class"] not in SUBFIELD_CLASS_IDS:
        return False, box

    clamped = dict(box)
    for key in ("x_center", "y_center", "width", "height"):
        try:
            v = float(box[key])
        except (TypeError, ValueError):
            return False, box

        if v < 0.0:
            if v < -0.05:
                return False, box
            v = 0.001  # clamp slightly-negative
        elif v > 1.0:
            if v > 1.05:
                return False, box
            v = 0.999  # clamp slightly-above-1
        clamped[key] = v

    if clamped["width"] < 0.01 or clamped["height"] < 0.01:
        return False, clamped

    return True, clamped


# ---------------------------------------------------------------------------
# Response parser
# ---------------------------------------------------------------------------
def parse_gemini_response(text):
    """
    Strip markdown code fences from Gemini response and parse as JSON array.
    Returns list of validated, clamped box dicts. Returns [] on any failure.
    """
    text = text.strip()
    if text.startswith("```"):
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else ""
        if text.startswith("json"):
            text = text[4:]
    try:
        boxes = json.loads(text.strip())
        if not isinstance(boxes, list):
            return []
        valid = []
        for b in boxes:
            ok, clamped = _is_valid_box(b)
            if ok:
                valid.append(clamped)
        return valid
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Pitfall 2 guard: full-image coordinate detection
# ---------------------------------------------------------------------------
def detect_full_image_coords(boxes, crop_w_fraction):
    """
    Detect if Gemini returned full-image coordinates instead of crop-relative ones.

    Returns True (discard) if all x_centers < 0.15 AND crop_w_fraction < 0.15.
    """
    if not boxes:
        return False
    if all(b["x_center"] < 0.15 for b in boxes) and crop_w_fraction < 0.15:
        return True
    return False


# ---------------------------------------------------------------------------
# Crop extraction with upscale
# ---------------------------------------------------------------------------
def crop_wine_entry(img_path, yolo_box):
    """
    Crop a Wine Entry bounding box from an image and optionally upscale it.

    Args:
        img_path: Path to the source image
        yolo_box: (x_center, y_center, width, height) normalized YOLO coords

    Returns:
        (crop_pil, img_w, img_h) where img_w/img_h are PRE-upscale dimensions
    """
    img = Image.open(img_path).convert("RGB")
    img_w, img_h = img.size

    x_c, y_c, w, h = yolo_box
    x1 = max(0, int((x_c - w / 2) * img_w))
    y1 = max(0, int((y_c - h / 2) * img_h))
    x2 = min(img_w, int((x_c + w / 2) * img_w))
    y2 = min(img_h, int((y_c + h / 2) * img_h))

    # Ensure at least 1px crop
    x2 = max(x2, x1 + 1)
    y2 = max(y2, y1 + 1)

    crop = img.crop((x1, y1, x2, y2))
    cw, ch = crop.size

    # Upscale very short crops for better Gemini performance (Pitfall 5)
    if ch < 60:
        scale = 60 / ch
        crop = crop.resize((int(cw * scale), 60), Image.LANCZOS)

    return crop, img_w, img_h


# ---------------------------------------------------------------------------
# Gemini API call with exponential backoff
# ---------------------------------------------------------------------------
def annotate_with_backoff(model, prompt, crop_pil, max_retries=5):
    """
    Call Gemini Vision with exponential backoff on rate limit (HTTP 429).

    Returns list of validated box dicts, or [] on failure.
    """
    for attempt in range(max_retries):
        try:
            response = model.generate_content([prompt, crop_pil])
            return parse_gemini_response(response.text)
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "quota" in err_str.lower() or "rate" in err_str.lower():
                wait = min(2 ** attempt, 64)
                print(f"  Rate limit hit (attempt {attempt + 1}), waiting {wait}s...")
                time.sleep(wait)
            else:
                print(f"  API error (attempt {attempt + 1}): {err_str[:100]}")
                return []
    return []


# ---------------------------------------------------------------------------
# Re-projection: crop space -> full image space
# ---------------------------------------------------------------------------
def reproject_to_image(crop_box, entry_box_yolo, img_w, img_h):
    """
    Convert sub-field box (relative to crop) back to full-image YOLO coords.

    crop_box: dict with keys x_center, y_center, width, height (0-1, crop-relative)
    entry_box_yolo: (x_center, y_center, width, height) normalized to full image
    img_w, img_h: PRE-upscale full image dimensions in pixels

    Returns (x_c, y_c, w, h) normalized to full image [0, 1]
    """
    ex_c = entry_box_yolo[0] * img_w
    ey_c = entry_box_yolo[1] * img_h
    ew   = entry_box_yolo[2] * img_w
    eh   = entry_box_yolo[3] * img_h
    ex_tl = ex_c - ew / 2
    ey_tl = ey_c - eh / 2

    sf_x_c_px = crop_box["x_center"] * ew
    sf_y_c_px = crop_box["y_center"] * eh
    sf_w_px   = crop_box["width"]    * ew
    sf_h_px   = crop_box["height"]   * eh

    abs_x_c = ex_tl + sf_x_c_px
    abs_y_c = ey_tl + sf_y_c_px

    return abs_x_c / img_w, abs_y_c / img_h, sf_w_px / img_w, sf_h_px / img_h


# ---------------------------------------------------------------------------
# Progress checkpoint helpers
# ---------------------------------------------------------------------------
def load_progress():
    """Load progress checkpoint from disk. Returns default structure if not found."""
    if PROGRESS_FILE.exists():
        try:
            return json.loads(PROGRESS_FILE.read_text())
        except Exception:
            pass
    return {
        "annotated_images": [],
        "stats": {
            "total_entries": 0,
            "annotated_entries": 0,
            "failed_entries": 0,
        },
    }


def save_progress(data):
    """Atomically write progress checkpoint via temp file + rename."""
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        dir=PROGRESS_FILE.parent, prefix=".annotation_progress_", suffix=".json"
    )
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2)
        shutil.move(tmp_path, PROGRESS_FILE)
    except Exception:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
        raise


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Auto-annotate Wine Entry sub-fields using Gemini Vision API"
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Skip already-annotated images (idempotent re-run)",
    )
    parser.add_argument(
        "--splits",
        nargs="+",
        default=["train", "val", "test"],
        help="Dataset splits to process (default: train val test)",
    )
    args = parser.parse_args()

    # Fail fast if API key missing
    api_key = _require_api_key()
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-2.5-flash-lite")
    prompt = build_subfield_prompt()

    progress = load_progress()
    done_set = set(progress["annotated_images"]) if args.resume else set()

    print(f"Starting annotation. Splits: {args.splits}")
    print(f"Resume mode: {args.resume} ({len(done_set)} images already done)")
    print(f"Progress file: {PROGRESS_FILE}")

    total_new_images = 0
    total_new_subfields = 0
    pitfall2_count = 0

    for split in args.splits:
        img_dir = IMAGES_BASE / split
        lbl_dir = LABELS_BASE / split

        if not img_dir.exists():
            print(f"  WARNING: image directory not found: {img_dir}")
            continue

        img_files = sorted(img_dir.glob("*.png")) + sorted(img_dir.glob("*.jpg"))
        print(f"\n[{split}] {len(img_files)} images found")

        for img_path in img_files:
            fname = img_path.name
            if fname in done_set:
                continue

            lbl_path = lbl_dir / (img_path.stem + ".txt")
            if not lbl_path.exists():
                continue

            # Read existing label lines; collect class-0 (Wine Entry) boxes
            existing_lines = lbl_path.read_text().strip().splitlines()
            wine_entry_boxes = []
            for line in existing_lines:
                parts = line.strip().split()
                if not parts:
                    continue
                try:
                    if int(parts[0]) == 0:
                        wine_entry_boxes.append(
                            tuple(float(p) for p in parts[1:5])
                        )
                except (ValueError, IndexError):
                    continue

            if not wine_entry_boxes:
                # No Wine Entry boxes — mark as done so resume skips it
                progress["annotated_images"].append(fname)
                save_progress(progress)
                continue

            new_lines = []
            for entry_box in wine_entry_boxes:
                # Locate source image: prefer annotation_images/, fall back to split dir
                src_img = ANNOTATION_IMGS / fname
                if not src_img.exists():
                    src_img = img_path

                try:
                    crop_pil, img_w, img_h = crop_wine_entry(src_img, entry_box)
                except Exception as e:
                    print(f"  ERROR cropping {fname}: {e}")
                    progress["stats"]["total_entries"] += 1
                    progress["stats"]["failed_entries"] += 1
                    continue

                crop_w_fraction = entry_box[2]  # YOLO width is already normalized

                subfields = annotate_with_backoff(model, prompt, crop_pil)

                # Pitfall 2: full-image coordinate guard
                if detect_full_image_coords(subfields, crop_w_fraction):
                    print(f"  WARNING: full-image coords suspected for {fname}, skipping entry")
                    pitfall2_count += 1
                    subfields = []

                for sf in subfields:
                    x_c, y_c, w, h = reproject_to_image(sf, entry_box, img_w, img_h)
                    # Clamp reprojected coords to [0, 1]
                    x_c = max(0.0, min(1.0, x_c))
                    y_c = max(0.0, min(1.0, y_c))
                    w   = max(0.001, min(1.0, w))
                    h   = max(0.001, min(1.0, h))
                    cid = SUBFIELD_CLASS_IDS[sf["class"]]
                    new_lines.append(f"{cid} {x_c:.6f} {y_c:.6f} {w:.6f} {h:.6f}")

                progress["stats"]["total_entries"] += 1
                if subfields:
                    progress["stats"]["annotated_entries"] += 1
                else:
                    progress["stats"]["failed_entries"] += 1

                time.sleep(0.1)  # rate limit: ~600 RPM safe

            # Append new sub-field lines to label file (never overwrite class 0/1 lines)
            if new_lines:
                with open(lbl_path, "a") as f:
                    for line in new_lines:
                        f.write(line + "\n")
                total_new_subfields += len(new_lines)

            progress["annotated_images"].append(fname)
            save_progress(progress)
            total_new_images += 1
            print(
                f"  {fname}: {len(wine_entry_boxes)} entries "
                f"-> {len(new_lines)} sub-field boxes appended"
            )

    # Final summary
    s = progress["stats"]
    pct = s["annotated_entries"] / max(s["total_entries"], 1) * 100
    print(f"\n{'='*60}")
    print(f"DONE.")
    print(f"Images processed this run: {total_new_images}")
    print(f"Sub-field boxes added this run: {total_new_subfields}")
    print(f"Pitfall-2 (full-image coord) skips: {pitfall2_count}")
    print(f"Coverage: {s['annotated_entries']}/{s['total_entries']} entries annotated ({pct:.1f}%)")
    print(f"Failed entries: {s['failed_entries']}")
    print(f"Progress saved to {PROGRESS_FILE}")
    print(f"{'='*60}")

    if pct < 80.0:
        print(
            f"WARNING: Coverage {pct:.1f}% is below the 80% target. "
            "Check annotation_log.txt for errors and re-run with --resume."
        )


if __name__ == "__main__":
    main()
