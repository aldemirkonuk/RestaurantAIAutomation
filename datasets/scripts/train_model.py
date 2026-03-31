"""
YOLOv8s fine-tuning script for the WineOps 13-class wine menu dataset.

NOTE: section_header has 16 train / 0 val instances. mAP50 >= 0.90 is AT RISK.
Expect near-zero mAP or high variance for this class in validation metrics.

Usage:
    python datasets/scripts/train_model.py

Hyperparameters are hardcoded in TRAIN_CONFIG for reproducibility (YOLO-05).
Do NOT add CLI argument parsing — config is the single source of truth.
"""

import json
import os
from pathlib import Path

from ultralytics import YOLO

# ---------------------------------------------------------------------------
# Paths — resolved to absolute to avoid cwd ambiguity with ultralytics
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parents[2]  # Restaurant AI Automation/
DATA_YAML = PROJECT_ROOT / "datasets" / "wine_menus" / "data.yaml"
RUNS_DIR = PROJECT_ROOT / "datasets" / "wine_menus" / "runs"

# ---------------------------------------------------------------------------
# Training configuration — DATA-05 augmentation hyperparameters locked in
# Phase 1 (per datasets/wine_menus/dataset_stats.json).
# ---------------------------------------------------------------------------
TRAIN_CONFIG = {
    "model": "yolov8s.pt",
    "data": str(DATA_YAML),
    "epochs": 100,
    "imgsz": 640,
    "batch": 8,
    "device": "cpu",
    "project": str(RUNS_DIR),
    "name": "train",
    "exist_ok": True,
    # DATA-05 augmentation (per dataset_stats.json)
    "fliplr": 0.5,
    "degrees": 10,
    "hsv_v": 0.4,
    "mosaic": 1.0,
    # class loss weight — helps rare classes like section_header
    "cls": 0.5,
}


def main() -> None:
    # Validate paths before starting
    if not DATA_YAML.exists():
        raise FileNotFoundError(f"data.yaml not found at: {DATA_YAML}")

    print(f"Project root : {PROJECT_ROOT}")
    print(f"Data YAML    : {DATA_YAML}")
    print(f"Runs dir     : {RUNS_DIR}")
    print(f"Training config: {json.dumps(TRAIN_CONFIG, indent=2)}")

    # Load base YOLOv8s model (downloads yolov8s.pt if not cached)
    model = YOLO(TRAIN_CONFIG["model"])

    # Build training kwargs (exclude model key — already used above)
    train_args = {k: v for k, v in TRAIN_CONFIG.items() if k != "model"}

    # Run training
    results = model.train(**train_args)

    # Record actual best.pt path in config for downstream plans (02-02)
    best_pt = RUNS_DIR / "train" / "weights" / "best.pt"
    TRAIN_CONFIG["best_pt_path"] = str(best_pt)

    # Save full config alongside best.pt for reproducibility (YOLO-05)
    config_path = RUNS_DIR / "train" / "training_config.json"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    with open(config_path, "w") as fh:
        json.dump(TRAIN_CONFIG, fh, indent=2)

    print(f"\nTraining complete.")
    print(f"Best weights : {best_pt}")
    print(f"Config saved : {config_path}")

    return results


if __name__ == "__main__":
    main()
