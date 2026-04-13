"""
Wine Label Scanner - YOLOv8 Training Script
============================================
Fine-tunes YOLOv8m on the wine label dataset (10 classes).

Usage:
    python training/train_label_scanner.py [--epochs 120] [--imgsz 1280] [--batch 8] [--device 0]

Prerequisites:
    1. Annotated dataset in datasets/wine_labels/ (exported from Roboflow in YOLOv8 format)
    2. pip install ultralytics
"""

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
DATASET_DIR = PROJECT_ROOT / "datasets" / "wine_labels"
OUTPUT_DIR = PROJECT_ROOT / "services" / "agent-orchestrator" / "models"


def main():
    parser = argparse.ArgumentParser(description="Train WineOps Label Scanner (YOLOv8m)")
    parser.add_argument("--epochs", type=int, default=120, help="Training epochs")
    parser.add_argument("--imgsz", type=int, default=1280, help="Image size (px)")
    parser.add_argument("--batch", type=int, default=8, help="Batch size")
    parser.add_argument("--device", type=str, default="0", help="Device")
    parser.add_argument("--model", type=str, default="yolov8m.pt", help="Base model")
    parser.add_argument("--patience", type=int, default=20, help="Early-stopping patience")
    parser.add_argument("--name", type=str, default="label_scanner_v1", help="Run name")
    args = parser.parse_args()

    data_yaml = DATASET_DIR / "data.yaml"
    if not data_yaml.exists():
        print(f"ERROR: Dataset config not found at {data_yaml}")
        sys.exit(1)

    train_dir = DATASET_DIR / "images" / "train"
    train_images = list(train_dir.glob("*.jpg")) + list(train_dir.glob("*.png"))
    if len(train_images) == 0:
        print(f"ERROR: No training images found in {train_dir}")
        print("Minimum recommended: 1,500+ images with diverse label styles.")
        sys.exit(1)

    print(f"Dataset: {data_yaml}")
    print(f"Training images: {len(train_images)}")
    print(f"Config: epochs={args.epochs}, imgsz={args.imgsz}, batch={args.batch}")
    print()

    from ultralytics import YOLO

    model = YOLO(args.model)

    results = model.train(
        data=str(data_yaml),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        patience=args.patience,
        device=args.device,
        project=str(PROJECT_ROOT / "runs" / "label_scanner"),
        name=args.name,
        # ----- Augmentation (label-optimised) -----
        augment=True,
        mosaic=0.8,           # Higher mosaic OK for labels (each label is one item)
        mixup=0.0,            # No mixup - text must remain readable
        degrees=15.0,         # Labels can be photographed at angles
        translate=0.15,
        scale=0.4,
        perspective=0.001,    # More perspective warp for bottle photos
        flipud=0.0,           # Don't flip vertically
        fliplr=0.5,           # Horizontal flip OK (symmetric labels)
        hsv_h=0.015,
        hsv_s=0.3,
        hsv_v=0.4,            # Higher value range for varied lighting
    )

    # Validate
    print("\n===== VALIDATION =====")
    metrics = model.val()
    map50 = metrics.box.map50
    print(f"mAP50:    {map50:.4f}  (target >= 0.88)")

    if map50 < 0.88:
        print(f"WARNING: mAP50 {map50:.4f} below 88% target.")
    else:
        print("PASS: mAP50 meets target.")

    # Export
    print("\n===== EXPORT =====")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    model.export(format="onnx", imgsz=args.imgsz, simplify=True)
    model.export(format="torchscript", imgsz=args.imgsz)

    best_pt = Path(results.save_dir) / "weights" / "best.pt" if hasattr(results, 'save_dir') else None
    if best_pt and best_pt.exists():
        import shutil
        dest = OUTPUT_DIR / f"{args.name}.pt"
        shutil.copy2(best_pt, dest)
        print(f"Best weights copied to: {dest}")

    print("\nTraining complete.")


if __name__ == "__main__":
    main()
