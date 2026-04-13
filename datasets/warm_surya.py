#!/usr/bin/env python3
"""
One-time Surya model warm-up script.
Run this ONCE after installing surya-ocr to pre-load the models into the
OS disk cache. Subsequent runs of organize_menus.py will load in ~30s.

Usage:
    python3 datasets/warm_surya.py
"""
import os, sys, time
os.environ["DISABLE_TQDM"] = "1"

print("Warming Surya OCR models into disk cache…")
print("This loads 1.4 GB of model weights — takes 3–8 min on first run.\n")

t0 = time.time()
try:
    from surya.detection import DetectionPredictor
    print(f"  Detection predictor loaded  ({time.time()-t0:.0f}s)", flush=True)
    from surya.foundation import FoundationPredictor
    fp = FoundationPredictor()
    print(f"  Foundation predictor loaded ({time.time()-t0:.0f}s)", flush=True)
    from surya.recognition import RecognitionPredictor
    RecognitionPredictor(fp)
    print(f"  Recognition predictor ready ({time.time()-t0:.0f}s)", flush=True)
    print(f"\nDone — models warmed in {time.time()-t0:.0f}s.")
    print("organize_menus.py will now load Surya in ~30s on this machine.")
except ImportError as e:
    print(f"surya-ocr not installed: {e}")
    sys.exit(1)
