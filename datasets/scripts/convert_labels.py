"""
convert_labels.py — Label Studio → YOLO format converter with stratified 70/20/10 split.

Reads datasets/annotation_tasks/screenshots.json and pdfs.json, converts bounding boxes
from Label Studio percentage format to YOLO normalized xywh format, and copies images
into train/val/test directories with matching label files.
"""

from pathlib import Path
import json
import random
import shutil

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PROJECT_ROOT       = Path(__file__).resolve().parent.parent.parent
ANNOTATION_IMAGES  = PROJECT_ROOT / "datasets" / "annotation_images"
OUTPUT_BASE        = PROJECT_ROOT / "datasets" / "wine_menus"
SCREENSHOTS_JSON   = PROJECT_ROOT / "datasets" / "annotation_tasks" / "screenshots.json"
PDFS_JSON          = PROJECT_ROOT / "datasets" / "annotation_tasks" / "pdfs.json"
LABEL_TO_CLASS_ID  = {"Wine Entry": 0, "Section Header": 1}


# ---------------------------------------------------------------------------
# Coordinate conversion
# ---------------------------------------------------------------------------

def ls_to_yolo(x_pct, y_pct, w_pct, h_pct):
    """Convert Label Studio percentage coords to YOLO normalized xywh.

    Label Studio stores top-left corner (x, y) + dimensions (width, height),
    all as percentages of image dimensions (0-100). YOLO requires center
    coordinates normalized to 0-1.

    Verified example: x=2.8, y=2.8, w=21.6, h=3.2
    → (0.136, 0.044, 0.216, 0.032)
    """
    x_center = (x_pct + w_pct / 2) / 100.0
    y_center = (y_pct + h_pct / 2) / 100.0
    width    = w_pct / 100.0
    height   = h_pct / 100.0
    return x_center, y_center, width, height


# ---------------------------------------------------------------------------
# Task parsing
# ---------------------------------------------------------------------------

def parse_task(task):
    """Extract YOLO-ready bounding boxes from a Label Studio task.

    Returns:
        (filename: str, boxes: list of (class_id, x_c, y_c, w, h))

    Anti-patterns avoided:
    - Only processes type=="rectanglelabels" entries; textarea and choices
      entries share the same id/coordinates and would triple-count boxes.
    - Does not use original_width/original_height — percentage coords are
      already dimension-independent.
    """
    filename = task["data"]["image"].split("d=datasets/annotation_images/")[-1]
    boxes = []
    for pred in task.get("predictions", []):
        for r in pred.get("result", []):
            if r.get("type") != "rectanglelabels":
                continue
            value = r["value"]
            label = value["rectanglelabels"][0]
            if label not in LABEL_TO_CLASS_ID:
                continue
            class_id = LABEL_TO_CLASS_ID[label]
            x_c, y_c, w, h = ls_to_yolo(
                value["x"], value["y"], value["width"], value["height"]
            )
            boxes.append((class_id, x_c, y_c, w, h))
    return filename, boxes


# ---------------------------------------------------------------------------
# Stratified split
# ---------------------------------------------------------------------------

def stratified_split(screenshot_tasks, pdf_tasks, seed=42):
    """Split tasks into train/val/test using 70/20/10 stratified by source type.

    Stratification ensures both screenshots and PDFs appear in all splits
    proportionally. seed=42 guarantees reproducibility.

    Returns:
        (train_files, val_files, test_files) — lists of image filenames (strings)
    """
    random.seed(seed)

    def split_group(tasks):
        filenames = [
            t["data"]["image"].split("d=datasets/annotation_images/")[-1]
            for t in tasks
        ]
        random.shuffle(filenames)
        n = len(filenames)
        n_train = int(n * 0.70)
        n_val   = int(n * 0.20)
        return (
            filenames[:n_train],
            filenames[n_train:n_train + n_val],
            filenames[n_train + n_val:],
        )

    ss_train, ss_val, ss_test   = split_group(screenshot_tasks)
    pdf_train, pdf_val, pdf_test = split_group(pdf_tasks)

    train = ss_train + pdf_train
    val   = ss_val   + pdf_val
    test  = ss_test  + pdf_test
    return train, val, test


# ---------------------------------------------------------------------------
# Main conversion + copy
# ---------------------------------------------------------------------------

def convert_and_split():
    """Run full conversion: parse → split → copy images → write label files."""

    # Load annotation JSON files
    with open(SCREENSHOTS_JSON) as f:
        all_tasks = json.load(f)
    with open(PDFS_JSON) as f:
        all_tasks += json.load(f)

    # Separate by source type for stratified split
    screenshot_tasks = [t for t in all_tasks if t["data"]["source_type"] == "screenshot"]
    pdf_tasks        = [t for t in all_tasks if t["data"]["source_type"] == "pdf"]

    # Build label map: filename → [(class_id, x_c, y_c, w, h), ...]
    label_map = {}
    for task in all_tasks:
        fname, boxes = parse_task(task)
        label_map[fname] = boxes

    # Stratified split
    train_files, val_files, test_files = stratified_split(screenshot_tasks, pdf_tasks)

    splits = [
        ("train", train_files),
        ("val",   val_files),
        ("test",  test_files),
    ]

    summary = {}
    errors  = []

    for split_name, file_list in splits:
        img_dir = OUTPUT_BASE / "images" / split_name
        lbl_dir = OUTPUT_BASE / "labels" / split_name
        img_dir.mkdir(parents=True, exist_ok=True)
        lbl_dir.mkdir(parents=True, exist_ok=True)

        box_count    = 0
        we_count     = 0
        sh_count     = 0
        copied_count = 0

        for fname in file_list:
            src = ANNOTATION_IMAGES / fname
            dst = img_dir / fname

            # Copy image
            try:
                shutil.copy(src, dst)
                copied_count += 1
            except FileNotFoundError:
                errors.append(f"MISSING image: {fname}")
                # Still write an empty label file so dataset remains consistent
                (lbl_dir / (Path(fname).stem + ".txt")).write_text("")
                continue

            # Write label file (empty if no boxes — intentional)
            boxes = label_map.get(fname, [])
            label_path = lbl_dir / (Path(fname).stem + ".txt")
            with open(label_path, "w") as lf:
                for cid, x_c, y_c, w, h in boxes:
                    lf.write(f"{cid} {x_c:.6f} {y_c:.6f} {w:.6f} {h:.6f}\n")
                    box_count += 1
                    if cid == 0:
                        we_count += 1
                    elif cid == 1:
                        sh_count += 1

        summary[split_name] = {
            "images":          copied_count,
            "total_boxes":     box_count,
            "wine_entry_boxes": we_count,
            "section_header_boxes": sh_count,
        }

    return summary, errors


def main():
    print("Starting Label Studio → YOLO conversion...")
    summary, errors = convert_and_split()

    print("\n--- Conversion Summary ---")
    total_images = 0
    total_we     = 0
    total_sh     = 0
    for split_name, stats in summary.items():
        print(
            f"  {split_name:5s}: {stats['images']:4d} images, "
            f"{stats['total_boxes']:5d} boxes "
            f"(WineEntry={stats['wine_entry_boxes']}, "
            f"SectionHeader={stats['section_header_boxes']})"
        )
        total_images += stats["images"]
        total_we     += stats["wine_entry_boxes"]
        total_sh     += stats["section_header_boxes"]

    print(f"\n  Total: {total_images} images, {total_we} Wine Entry boxes, {total_sh} Section Header boxes")

    if errors:
        print(f"\n  WARNINGS ({len(errors)} errors):")
        for e in errors:
            print(f"    {e}")
    else:
        print("\n  No errors encountered.")

    print("\nDone.")
    return summary, errors


if __name__ == "__main__":
    main()
