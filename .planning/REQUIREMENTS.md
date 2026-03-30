# Requirements: WineOps Menu Scanning Pipeline

**Defined:** 2026-03-30
**Core Value:** A manager scans a menu and every wine is correctly identified and onboarded — locally, without paying per-call APIs.

## v1 Requirements

### Dataset Preparation

- [ ] **DATA-01**: Label Studio annotations converted to YOLO format (x_center, y_center, w, h normalized) for Wine Entry and Section Header classes
- [ ] **DATA-02**: 262 labeled images split into train/val/test sets (70/20/10)
- [ ] **DATA-03**: Gemini Vision auto-annotates 11 sub-field classes (wine_name, producer, vintage, price, grape_variety, origin_info, description, serving_type, rating, classification, bottle_info) within each Wine Entry bounding box
- [ ] **DATA-04**: Auto-annotations reviewed and saved to YOLO label files
- [ ] **DATA-05**: Data augmentation pipeline applied (flip, rotate, brightness, mosaic) to compensate for limited dataset size

### YOLO Model Training

- [ ] **YOLO-01**: YOLOv8s model fine-tuned on 13-class wine menu dataset
- [ ] **YOLO-02**: mAP50 ≥ 0.95 achieved on validation set for Wine Entry class
- [ ] **YOLO-03**: mAP50 ≥ 0.90 achieved on validation set for Section Header class
- [ ] **YOLO-04**: Model inference time < 5s per full-menu image on CPU
- [ ] **YOLO-05**: Trained model weights saved to `datasets/wine_menus/runs/` with reproducible training config
- [ ] **YOLO-06**: Per-class mAP report generated for all 13 classes

### Surya OCR Confidence

- [ ] **OCR-01**: Baseline Surya confidence benchmarked on all 334 annotation images (screenshots + PDF pages)
- [ ] **OCR-02**: Preprocessing pipeline tuned to maximize average confidence score
- [ ] **OCR-03**: Confidence results reported per image type (screenshot vs PDF page)
- [ ] **OCR-04**: Any preprocessing change that reduces confidence removed/reverted

### Integration

- [ ] **INT-01**: Trained YOLO model path configured in menu_analyzer_agent (replaces yolov8n.pt)
- [ ] **INT-02**: menu_analyzer_agent mock_mode=False path validated with trained model
- [ ] **INT-03**: End-to-end scan of 5 representative menu images completes without Gemini TEXT fallback
- [ ] **INT-04**: Per-region OCR (Surya on YOLO-cropped Wine Entry boxes) produces higher confidence than full-image OCR

## v2 Requirements

### Extended YOLO Training

- **YOLO-V2-01**: Human-reviewed annotations for all 11 sub-field classes (replaces Gemini auto-labels)
- **YOLO-V2-02**: mAP50 ≥ 0.95 for all 13 individual classes
- **YOLO-V2-03**: GPU-accelerated training for faster iteration

### Advanced OCR

- **OCR-V2-01**: Language-specific Surya tuning for Turkish/French/Italian menus
- **OCR-V2-02**: Confidence-based re-scan trigger (retry with different preprocessing if confidence < threshold)

## Out of Scope

| Feature | Reason |
|---------|--------|
| EasyOCR | Replaced by Surya — not revisited this milestone |
| Gemini Vision path | Photo upload pipeline — separate, not touching |
| Invoice OCR (visual_verification_agent) | Different agent, different pipeline |
| Frontend / API changes | No UI work this milestone |
| GPU training setup | Railway is CPU-only; GPU setup is v2 |
| Custom Surya fine-tuning | Surya model weights not modified — only preprocessing tuned |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DATA-01 | Phase 1 | Pending |
| DATA-02 | Phase 1 | Pending |
| DATA-03 | Phase 1 | Pending |
| DATA-04 | Phase 1 | Pending |
| DATA-05 | Phase 1 | Pending |
| YOLO-01 | Phase 2 | Pending |
| YOLO-02 | Phase 2 | Pending |
| YOLO-03 | Phase 2 | Pending |
| YOLO-04 | Phase 2 | Pending |
| YOLO-05 | Phase 2 | Pending |
| YOLO-06 | Phase 2 | Pending |
| OCR-01 | Phase 3 | Pending |
| OCR-02 | Phase 3 | Pending |
| OCR-03 | Phase 3 | Pending |
| OCR-04 | Phase 3 | Pending |
| INT-01 | Phase 4 | Pending |
| INT-02 | Phase 4 | Pending |
| INT-03 | Phase 4 | Pending |
| INT-04 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-30*
*Last updated: 2026-03-30 after initial definition*
