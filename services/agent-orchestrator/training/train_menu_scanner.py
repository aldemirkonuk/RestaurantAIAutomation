"""
Wine Menu Scanner - YOLOv8 Training Script
===========================================
Fine-tunes YOLOv8m on the wine menu dataset (13 classes).

Usage:
    python training/train_menu_scanner.py [--epochs 150] [--imgsz 1280] [--batch 8] [--device 0]

Prerequisites:
    1. Annotated dataset in datasets/wine_menus/ (exported from Roboflow in YOLOv8 format)
    2. pip install ultralytics supervision inference
"""

import argparse
import sys
from pathlib import Path

# Resolve project root
PROJECT_ROOT = Path(__file__).resolve().parents[3]  # Restaurant AI Automation/
DATASET_DIR = PROJECT_ROOT / "datasets" / "wine_menus"
OUTPUT_DIR = PROJECT_ROOT / "services" / "agent-orchestrator" / "models"


def main():
    parser = argparse.ArgumentParser(description="Train WineOps Menu Scanner (YOLOv8m)")
    parser.add_argument("--epochs", type=int, default=150, help="Training epochs")
    parser.add_argument("--imgsz", type=int, default=1280, help="Image size (px)")
    parser.add_argument("--batch", type=int, default=8, help="Batch size")
    parser.add_argument("--device", type=str, default="0", help="Device: '0' for GPU, 'cpu' for CPU")
    parser.add_argument("--model", type=str, default="yolov8m.pt", help="Base model")
    parser.add_argument("--patience", type=int, default=25, help="Early-stopping patience")
    parser.add_argument("--name", type=str, default="menu_scanner_v1", help="Run name")
    args = parser.parse_args()

    # Validate dataset exists
    data_yaml = DATASET_DIR / "data.yaml"
    if not data_yaml.exists():
        print(f"ERROR: Dataset config not found at {data_yaml}")
        print("Please annotate your menu images and export from Roboflow in YOLOv8 format.")
        sys.exit(1)

    train_dir = DATASET_DIR / "images" / "train"
    train_images = list(train_dir.glob("*.jpg")) + list(train_dir.glob("*.png"))
    if len(train_images) == 0:
        print(f"ERROR: No training images found in {train_dir}")
        print("Minimum recommended: 2,000+ images from 50+ restaurant styles.")
        sys.exit(1)

    print(f"Dataset: {data_yaml}")
    print(f"Training images: {len(train_images)}")
    print(f"Base model: {args.model}")
    print(f"Config: epochs={args.epochs}, imgsz={args.imgsz}, batch={args.batch}, device={args.device}")
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
        project=str(PROJECT_ROOT / "runs" / "menu_scanner"),
        name=args.name,
        # ----- Augmentation (menu-optimised) -----
        augment=True,
        mosaic=0.5,           # Lower mosaic - menus lose spatial structure at high mosaic
        mixup=0.0,            # No mixup - destroys text readability
        degrees=5.0,          # Slight rotation only (menus are mostly upright)
        translate=0.1,
        scale=0.3,
        perspective=0.0005,   # Slight perspective for phone camera angles
        flipud=0.0,           # NEVER flip menus vertically
        fliplr=0.0,           # NEVER flip menus horizontally
        hsv_h=0.015,
        hsv_s=0.2,
        hsv_v=0.3,
    )

    # Validate
    print("\n===== VALIDATION =====")
    metrics = model.val()
    map50 = metrics.box.map50
    map50_95 = metrics.box.map

    print(f"mAP50:    {map50:.4f}  (target >= 0.90)")
    print(f"mAP50-95: {map50_95:.4f}  (target >= 0.75)")

    if map50 < 0.90:
        print(f"WARNING: mAP50 {map50:.4f} below 90% target. Consider more data or longer training.")
    else:
        print("PASS: mAP50 meets target.")

    # Export for production
    print("\n===== EXPORT =====")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    onnx_path = model.export(format="onnx", imgsz=args.imgsz, simplify=True)
    print(f"ONNX exported to: {onnx_path}")

    torchscript_path = model.export(format="torchscript", imgsz=args.imgsz)
    print(f"TorchScript exported to: {torchscript_path}")

    # Copy best.pt to models/ directory
    best_pt = Path(results.save_dir) / "weights" / "best.pt" if hasattr(results, 'save_dir') else None
    if best_pt and best_pt.exists():
        import shutil
        dest = OUTPUT_DIR / f"{args.name}.pt"
        shutil.copy2(best_pt, dest)
        print(f"Best weights copied to: {dest}")

    print("\nTraining complete.")


if __name__ == "__main__":
    main()
