"""
Wine Invoice Scanner - YOLOv8 Training Script
==============================================
Fine-tunes YOLOv8m on the wine invoice dataset (8 classes).

Usage:
    python training/train_invoice_scanner.py [--epochs 100] [--imgsz 1280] [--batch 8] [--device 0]

Prerequisites:
    1. Annotated dataset in datasets/wine_invoices/ (exported from Roboflow in YOLOv8 format)
    2. pip install ultralytics
"""

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
DATASET_DIR = PROJECT_ROOT / "datasets" / "wine_invoices"
OUTPUT_DIR = PROJECT_ROOT / "services" / "agent-orchestrator" / "models"


def main():
    parser = argparse.ArgumentParser(description="Train WineOps Invoice Scanner (YOLOv8m)")
    parser.add_argument("--epochs", type=int, default=100, help="Training epochs")
    parser.add_argument("--imgsz", type=int, default=1280, help="Image size (px)")
    parser.add_argument("--batch", type=int, default=8, help="Batch size")
    parser.add_argument("--device", type=str, default="0", help="Device")
    parser.add_argument("--model", type=str, default="yolov8m.pt", help="Base model")
    parser.add_argument("--patience", type=int, default=20, help="Early-stopping patience")
    parser.add_argument("--name", type=str, default="invoice_scanner_v1", help="Run name")
    args = parser.parse_args()

    data_yaml = DATASET_DIR / "data.yaml"
    if not data_yaml.exists():
        print(f"ERROR: Dataset config not found at {data_yaml}")
        sys.exit(1)

    train_dir = DATASET_DIR / "images" / "train"
    train_images = list(train_dir.glob("*.jpg")) + list(train_dir.glob("*.png"))
    if len(train_images) == 0:
        print(f"ERROR: No training images found in {train_dir}")
        print("Minimum recommended: 500+ images.")
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
        project=str(PROJECT_ROOT / "runs" / "invoice_scanner"),
        name=args.name,
        # ----- Augmentation (invoice/document-optimised) -----
        augment=True,
        mosaic=0.3,           # Low mosaic - invoices are structured documents
        mixup=0.0,            # No mixup
        degrees=3.0,          # Very slight rotation (invoices are mostly aligned)
        translate=0.05,
        scale=0.2,
        perspective=0.0003,
        flipud=0.0,           # Never flip
        fliplr=0.0,           # Never flip
        hsv_h=0.01,
        hsv_s=0.1,
        hsv_v=0.2,
    )

    # Validate
    print("\n===== VALIDATION =====")
    metrics = model.val()
    map50 = metrics.box.map50
    print(f"mAP50:    {map50:.4f}  (target >= 0.85)")

    if map50 < 0.85:
        print(f"WARNING: mAP50 {map50:.4f} below 85% target.")
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
