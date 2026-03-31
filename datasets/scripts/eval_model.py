"""
YOLOv8 model evaluation script — Phase 2 Wave 2 (YOLO-02 through YOLO-06).

Evaluates best.pt on val set, measures CPU inference time, writes eval_report.md.

Usage:
    python datasets/scripts/eval_model.py
    python datasets/scripts/eval_model.py --weights datasets/wine_menus_2class/runs/train/weights/best.pt --data datasets/wine_menus_2class/data.yaml
"""

import argparse
import json
import time
from datetime import date
from pathlib import Path

import numpy as np
from ultralytics import YOLO

PROJECT_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_WEIGHTS = PROJECT_ROOT / "datasets" / "wine_menus_2class" / "runs" / "train" / "weights" / "best.pt"
DEFAULT_DATA    = PROJECT_ROOT / "datasets" / "wine_menus_2class" / "data.yaml"
REPORT_PATH     = PROJECT_ROOT / "datasets" / "wine_menus_2class" / "runs" / "train" / "eval_report.md"

CLASS_NAMES = {
    0: "wine_entry",
    1: "section_header",
    2: "wine_name",
    3: "producer",
    4: "vintage",
    5: "price",
    6: "grape_variety",
    7: "origin_info",
    8: "description",
    9: "serving_type",
    10: "rating",
    11: "classification",
    12: "bottle_info",
}


def measure_inference_time(model, runs: int = 5) -> float:
    """Time inference on a synthetic 2352x1076 image (typical screenshot size)."""
    dummy = np.zeros((1076, 2352, 3), dtype=np.uint8)
    # Warm-up
    model.predict(dummy, device="cpu", verbose=False)
    times = []
    for _ in range(runs):
        t0 = time.perf_counter()
        model.predict(dummy, device="cpu", verbose=False)
        times.append(time.perf_counter() - t0)
    return round(sum(times) / len(times), 3)


def run_eval(weights: Path, data: Path) -> None:
    print(f"Loading model: {weights}")
    model = YOLO(str(weights))

    # --- Val set metrics ---
    print("Running validation...")
    val_results = model.val(data=str(data), split="val", device="cpu", verbose=True)

    # Extract per-class mAP50 (padded to nc length)
    nc = val_results.box.nc if hasattr(val_results.box, "nc") else len(model.names)
    maps = list(val_results.box.maps) if hasattr(val_results.box, "maps") else []
    while len(maps) < nc:
        maps.append(0.0)

    overall_map50    = float(val_results.box.map50)
    overall_map5095  = float(val_results.box.map)
    precision        = float(val_results.box.mp)
    recall           = float(val_results.box.mr)

    # --- Test set section_header (0 val instances) ---
    test_results = model.val(data=str(data), split="test", device="cpu", verbose=False)
    test_maps = list(test_results.box.maps) if hasattr(test_results.box, "maps") else []
    while len(test_maps) < nc:
        test_maps.append(0.0)

    # --- CPU inference time ---
    print("Measuring CPU inference time...")
    inference_sec = measure_inference_time(model)

    # --- Build per-class table rows ---
    rows = []
    for cid in range(nc):
        name     = model.names.get(cid, CLASS_NAMES.get(cid, f"class_{cid}"))
        val_map  = maps[cid] if cid < len(maps) else 0.0
        test_map = test_maps[cid] if cid < len(test_maps) else 0.0

        if cid == 1 and val_map == 0.0:
            val_note  = "N/A (0 val instances)"
            test_note = f"{test_map:.3f} (AT RISK — 3 test instances)" if test_map > 0 else "INSUFFICIENT DATA"
        else:
            val_note  = f"{val_map:.3f}"
            test_note = f"{test_map:.3f}"
        rows.append((cid, name, val_note, test_note))

    # --- PASS/FAIL ---
    wine_entry_map = maps[0] if maps else 0.0
    yolo02_pass = wine_entry_map >= 0.95
    yolo04_pass = inference_sec < 5.0

    # --- Write report ---
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(REPORT_PATH, "w") as f:
        f.write(f"# YOLO Model Evaluation Report\n\n")
        f.write(f"**Generated:** {date.today()}  \n")
        f.write(f"**Model:** {weights}  \n")
        f.write(f"**Dataset:** {data}  \n\n")
        f.write(f"## Overall Metrics (val set)\n\n")
        f.write(f"| Metric | Value |\n|--------|-------|\n")
        f.write(f"| mAP50 (all classes) | {overall_map50:.4f} |\n")
        f.write(f"| mAP50-95 | {overall_map5095:.4f} |\n")
        f.write(f"| Precision | {precision:.4f} |\n")
        f.write(f"| Recall | {recall:.4f} |\n\n")
        f.write(f"## Per-Class mAP50\n\n")
        f.write(f"| Class ID | Class Name | Val mAP50 | Test mAP50 |\n")
        f.write(f"|----------|------------|-----------|------------|\n")
        for cid, name, v, t in rows:
            f.write(f"| {cid} | {name} | {v} | {t} |\n")
        f.write(f"\n## Success Criteria\n\n")
        f.write(f"| Requirement | Target | Result | Status |\n")
        f.write(f"|-------------|--------|--------|--------|\n")
        f.write(f"| YOLO-02: wine_entry mAP50 | ≥ 0.95 | {wine_entry_map:.4f} | {'✅ PASS' if yolo02_pass else '❌ FAIL'} |\n")
        f.write(f"| YOLO-03: section_header mAP50 | ≥ 0.90 | AT RISK (0 val) | ⚠️ AT RISK |\n")
        f.write(f"| YOLO-04: CPU inference < 5s | < 5.0s | {inference_sec:.3f}s | {'✅ PASS' if yolo04_pass else '❌ FAIL'} |\n")
        f.write(f"\n## CPU Inference Time\n\n")
        f.write(f"Image size: 2352×1076 (typical screenshot), averaged over 5 runs.  \n")
        f.write(f"**Result: {inference_sec:.3f}s** ({'PASS' if yolo04_pass else 'FAIL'} — target < 5.0s)\n")

    print(f"\nReport written: {REPORT_PATH}")
    print(f"  wine_entry mAP50: {wine_entry_map:.4f}  ({'PASS' if yolo02_pass else 'FAIL'} vs 0.95 target)")
    print(f"  CPU inference:    {inference_sec:.3f}s  ({'PASS' if yolo04_pass else 'FAIL'} vs 5.0s target)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", default=str(DEFAULT_WEIGHTS))
    parser.add_argument("--data",    default=str(DEFAULT_DATA))
    args = parser.parse_args()
    run_eval(Path(args.weights), Path(args.data))


if __name__ == "__main__":
    main()
