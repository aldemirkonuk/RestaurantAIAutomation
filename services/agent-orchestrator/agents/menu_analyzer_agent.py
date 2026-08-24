"""
Menu Analyzer Agent
===================
AI-powered menu scanning with:
- YOLOv8 wine region detection (13-class custom model)
- Per-region OCR text extraction (Surya OCR — CPU-native, 90+ languages)
- Image pre-processing: RGB normalisation, auto-upscale, contrast boost
- Text normalisation (abbreviation expansion, OCR error correction)
- Gemini Pro structured field parsing (25 fields)
- Master library matching (pgvector + fuzzy + AI enrichment)
"""

from typing import Dict, List, Any, Optional
import asyncio
import base64
import io
import logging

from core.base_agent import BaseAgent

# Lazy imports to avoid loading heavy dependencies at startup
PIL_AVAILABLE = False
YOLO_AVAILABLE = False

logger = logging.getLogger(__name__)


def _check_pil():
    global PIL_AVAILABLE
    try:
        from PIL import Image

        PIL_AVAILABLE = True
        return True
    except ImportError:
        return False


def _check_yolo():
    global YOLO_AVAILABLE
    try:
        YOLO_AVAILABLE = True
        return True
    except Exception:
        return False


# 2-class menu model class map — per D-02 (Phase 3: YOLO 2-class Preview)
MENU_CLASS_NAMES = {
    0: "wine_entry",
    1: "section_header",
}


class MenuAnalyzerAgent(BaseAgent):
    """
    Menu Analyzer Agent - AI-powered menu scanning

    Workflow:
    1. Receive menu scan request (from frontend API endpoint)
    2. Use YOLOv8 (13-class custom model) to detect wine regions on menu image
    3. Use OCR (Surya OCR, CPU-native) to extract text per detected region
    4. Normalise text (abbreviation expansion, OCR error correction)
    5. Parse each wine entry into 25 structured fields via Gemini Pro
    6. Match against master library (pgvector + fuzzy + AI enrichment)
    7. Return enriched wine data to frontend
    """

    def __init__(self, agent_name: str, message_bus, database, config: Dict[str, Any]):
        super().__init__(agent_name, message_bus, database, config)

        # Model paths
        self.menu_model_path = config.get(
            "menu_model_path",
            config.get(
                "yolo_model_path",
                "datasets/wine_menus_2class/runs/train2/weights/best.pt",
            ),
        )
        self.confidence_threshold = config.get("confidence_threshold", 0.3)
        self.mock_mode = config.get("mock_mode", True)

        # LLM configuration
        self.google_api_key = config.get("google_api_key")
        self.openai_api_key = config.get("openai_api_key")

        # Models (lazy-loaded)
        self.yolo_model = None
        self.surya_ocr = None
        self.llm_client = None

        # New pipeline services (lazy-loaded)
        self._normalizer = None
        self._field_parser = None
        self._wine_matcher = None

    def _get_normalizer(self):
        if self._normalizer is None:
            from services.text_normalizer import get_normalizer

            self._normalizer = get_normalizer()
        return self._normalizer

    def _get_field_parser(self):
        if self._field_parser is None:
            from services.wine_field_parser import get_field_parser

            self._field_parser = get_field_parser(
                google_api_key=self.google_api_key,
                mock_mode=self.mock_mode,
            )
        return self._field_parser

    def _get_wine_matcher(self):
        if self._wine_matcher is None:
            from services.wine_matcher import get_wine_matcher

            from core.database import get_supabase_client

            # None is legitimate (no database configured); the matcher falls
            # back to mock mode. An import fault is a wiring bug and must surface.
            supabase = get_supabase_client()

            self._wine_matcher = get_wine_matcher(
                supabase_client=supabase,
                google_api_key=self.google_api_key,
                mock_mode=self.mock_mode,
            )
        return self._wine_matcher

    # =========================================================================
    # FREE-FIRST PIPELINE SERVICES (lazy-loaded)
    # =========================================================================

    _menu_parser = None
    _pdf_service = None
    _vlm_service = None
    _wine_classifier = None
    _quality_scorer = None
    _restaurant_dataset = None

    def _get_menu_parser(self):
        if self._menu_parser is None:
            from services.html_menu_parser import get_menu_parser

            self._menu_parser = get_menu_parser()
        return self._menu_parser

    def _get_pdf_service(self):
        if self._pdf_service is None:
            from services.pdf_extraction_service import get_pdf_service

            self._pdf_service = get_pdf_service()
        return self._pdf_service

    def _get_vlm_service(self):
        if self._vlm_service is None:
            from services.vlm_extraction_service import get_vlm_service

            self._vlm_service = get_vlm_service()
        return self._vlm_service

    def _get_wine_classifier(self):
        if self._wine_classifier is None:
            from services.wine_menu_classifier import get_classifier

            self._wine_classifier = get_classifier()
        return self._wine_classifier

    def _get_quality_scorer(self):
        if self._quality_scorer is None:
            from services.quality_scorer import get_quality_scorer

            self._quality_scorer = get_quality_scorer()
        return self._quality_scorer

    # =========================================================================
    # FREE-FIRST PUBLIC API
    # =========================================================================

    async def process_text_free(
        self,
        raw_text: str,
        source_type: str = "html",
        restaurant_name: str = None,
    ) -> Dict[str, Any]:
        """
        FREE path: Extract wines from raw text using the local parser.
        No API costs. For HTML DOM extractions and PDF text layers.

        Args:
            raw_text: Text from Playwright DOM, PyPDF2, or Surya OCR.
            source_type: 'html', 'pdf', or 'ocr'.
            restaurant_name: Optional restaurant name.
        """
        # Classify
        classifier = self._get_wine_classifier()
        classification = classifier.classify(raw_text)
        if not classification.is_wine_menu:
            return {
                "wines_detected": 0,
                "wines": [],
                "is_wine_menu": False,
                "content_type": classification.content_type,
                "extraction_method": "free_classifier_reject",
                "cost": 0.0,
            }

        # Parse with local parser
        parser = self._get_menu_parser()
        result = parser.parse_menu(raw_text, source_type, restaurant_name)

        # Quality score
        scorer = self._get_quality_scorer()
        quality = scorer.score_extraction(
            wines=result.wines,
            parser_confidence=result.parser_confidence,
            restaurant_name=restaurant_name or "",
        )

        # Fallback to Gemini TEXT if confidence too low
        if result.parser_confidence < 0.5 and result.total_wines == 0:
            try:
                vlm = self._get_vlm_service()
                vlm_result = await vlm.extract_from_text(
                    raw_text, "menu", restaurant_name
                )
                if vlm_result.total_wines > 0:
                    return {
                        "wines_detected": vlm_result.total_wines,
                        "wines": vlm_result.wines,
                        "sections": vlm_result.sections,
                        "extraction_method": "gemini_text_fallback",
                        "confidence": vlm_result.confidence,
                        "cost": vlm_result.cost_estimate,
                        "quality_decision": quality.decision,
                    }
            except Exception as e:
                self.logger.warning(f"VLM text fallback failed: {e}")

        return {
            "wines_detected": result.total_wines,
            "wines": result.wines,
            "sections": result.sections,
            "section_hierarchy": result.section_hierarchy,
            "parser_confidence": result.parser_confidence,
            "extraction_method": "free_local_parser",
            "cost": 0.0,
            "quality_decision": quality.decision,
            "quality_score": quality.composite_score,
        }

    async def process_pdf_free(
        self,
        pdf_bytes: bytes,
        document_type: str = "menu",
        restaurant_name: str = None,
    ) -> Dict[str, Any]:
        """
        FREE path: Extract wines from PDF.
        PyPDF2 for digital, Surya OCR for scanned, Gemini TEXT as last resort.
        """
        pdf_service = self._get_pdf_service()
        result = await pdf_service.extract_from_bytes(
            pdf_bytes, document_type, restaurant_name
        )

        return {
            "wines_detected": result.total_wines,
            "wines": result.merged_wines,
            "sections": result.merged_sections,
            "pdf_type": result.pdf_type,
            "total_pages": result.total_pages,
            "extraction_method": result.extraction_method,
            "confidence": result.overall_confidence,
            "cost": result.cost,
            "invoice_metadata": result.invoice_metadata,
            "warnings": result.warnings,
        }

    async def process_photo_vlm(
        self,
        image_bytes: bytes,
        document_type: str = "menu",
        restaurant_name: str = None,
        mime_type: str = "image/jpeg",
    ) -> Dict[str, Any]:
        """
        PAID path: Extract wines from a photo using Gemini Vision.
        For user uploads and live camera scans only.
        """
        vlm = self._get_vlm_service()
        result = await vlm.extract_from_image(
            image_bytes, document_type, restaurant_name, mime_type
        )

        return {
            "wines_detected": result.total_wines,
            "wines": result.wines,
            "sections": result.sections,
            "extraction_method": result.extraction_method,
            "model_used": result.model_used,
            "confidence": result.confidence,
            "cost": result.cost_estimate,
            "invoice_metadata": result.invoice_metadata,
            "warnings": result.warnings,
        }

    async def initialize(self) -> None:
        """Initialize vision and LLM models"""
        self.logger.info("Initializing Menu Analyzer Agent")

        if self.mock_mode:
            self.logger.warning("Running in MOCK mode (no real vision/LLM processing)")

        # YOLO 2-class model load — runs unconditionally (no mock_mode gate per D-07)
        if _check_yolo():
            try:
                from ultralytics import YOLO
                from pathlib import Path

                model_path = self.menu_model_path
                if not Path(model_path).exists():
                    self.logger.warning(
                        f"YOLO model not found at {model_path}. "
                        "YOLO detection disabled — detect_boxes() will return []."
                    )
                    self.yolo_model = None
                else:
                    self.yolo_model = YOLO(model_path)
                    self.logger.info(f"YOLO 2-class model loaded: {model_path}")
            except Exception as e:
                self.logger.warning(f"YOLO disabled: {e}")
                self.yolo_model = None
        else:
            self.logger.warning("ultralytics not available, YOLO detection disabled")

        if not self.mock_mode:
            # Initialize Surya OCR (replaces EasyOCR — CPU-native, no language list needed)
            try:
                from services.pdf_extraction_service import SuryaOCRService

                self.surya_ocr = SuryaOCRService()
                if self.surya_ocr.is_available:
                    self.logger.info("Surya OCR initialized")
                else:
                    self.logger.warning(
                        "Surya OCR not available — install surya-ocr: pip install surya-ocr"
                    )
            except Exception as e:
                self.logger.warning(f"Surya OCR disabled: {e}")

            # Initialize Gemini Pro client
            if self.google_api_key:
                try:
                    import google.generativeai as genai

                    genai.configure(api_key=self.google_api_key)
                    self.llm_client = genai.GenerativeModel("gemini-pro")
                    self.logger.info("Gemini Pro client initialized")
                except Exception as e:
                    self.logger.error(f"Failed to initialize LLM client: {e}")

        self.logger.info("Menu Analyzer Agent initialized")

    async def detect_boxes(
        self,
        frame_base64: str,
        confidence: float = 0.3,
    ) -> List[Dict[str, Any]]:
        """
        Run YOLO 2-class inference on a single camera frame.
        Returns bounding boxes only. NEVER triggers text extraction.
        Called exclusively from POST /api/v1/preview/detect.
        """
        if self.yolo_model is None:
            return []

        loop = asyncio.get_event_loop()

        def _run_inference():
            import base64 as _base64
            import io as _io
            from PIL import Image
            import numpy as np

            img_bytes = _base64.b64decode(frame_base64)
            img = Image.open(_io.BytesIO(img_bytes))
            img_array = np.array(img)
            results = self.yolo_model.predict(
                img_array,
                conf=confidence,
                verbose=False,
                imgsz=640,
            )
            boxes = []
            if results and results[0].boxes is not None:
                for box in results[0].boxes:
                    xyxyn = box.xyxyn[0].cpu().numpy()  # normalized [0-1] coords
                    cls_id = int(box.cls[0].cpu().numpy())
                    conf_val = float(box.conf[0].cpu().numpy())
                    label = MENU_CLASS_NAMES.get(cls_id, f"class_{cls_id}")
                    boxes.append(
                        {
                            "x1": float(xyxyn[0]),
                            "y1": float(xyxyn[1]),
                            "x2": float(xyxyn[2]),
                            "y2": float(xyxyn[3]),
                            "label": label,
                            "confidence": round(conf_val, 3),
                        }
                    )
            return boxes

        return await loop.run_in_executor(None, _run_inference)

    def get_subscribed_routing_keys(self) -> List[tuple[str, str]]:
        return [
            ("menu.events", "menu.scan_request"),
            ("menu.events", "menu.text_extraction_request"),
            ("menu.events", "menu.wine_lookup_request"),
        ]

    async def process_message(self, message: Dict[str, Any]) -> None:
        routing_key = message.get("routing_key")

        if routing_key == "menu.scan_request":
            await self._process_menu_scan(message)
        elif routing_key == "menu.text_extraction_request":
            await self._extract_text_from_image(message)
        elif routing_key == "menu.wine_lookup_request":
            await self._lookup_wine(message)

    # =========================================================================
    # CORE PIPELINE
    # =========================================================================

    async def _process_menu_scan(self, message: Dict[str, Any]) -> None:
        """Main entry point: Process menu image and extract wines."""
        payload = message.get("payload", {})

        image_data = payload.get("image_data")
        image_url = payload.get("image_url")
        restaurant_id = payload.get("restaurant_id")
        request_id = payload.get("request_id")

        self.logger.info(f"Processing menu scan request {request_id}")

        try:
            result = await self.process_menu_image(
                image_data=image_data,
                image_url=image_url,
                restaurant_id=restaurant_id,
            )

            await self.publish(
                exchange_name="menu.events",
                routing_key="menu.scan_complete",
                message_body={
                    "event_type": "MenuScanComplete",
                    "payload": {
                        "request_id": request_id,
                        "restaurant_id": restaurant_id,
                        **result,
                    },
                },
                priority=5,
            )

            self.logger.info(
                f"Menu scan complete: {result.get('wines_detected', 0)} wines detected"
            )

        except Exception as e:
            self.logger.error(f"Error processing menu scan: {e}", exc_info=True)
            await self.publish(
                exchange_name="menu.events",
                routing_key="menu.scan_error",
                message_body={
                    "event_type": "MenuScanError",
                    "payload": {"request_id": request_id, "error": str(e)},
                },
                priority=7,
            )

    async def process_menu_image(
        self,
        image_data: Optional[str] = None,
        image_url: Optional[str] = None,
        restaurant_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Public API: Process a menu image through the full 4-layer pipeline.

        Returns dict with:
        - wines_detected: int
        - wines: list of enriched wine dicts (25 fields each)
        - regions_detected: int
        - section_headers: list of detected section headers
        """
        image_source = image_data or image_url
        if not image_source:
            return {"error": "No image provided", "wines": [], "wines_detected": 0}

        # ---- Layer 1: YOLO detection (13-class) ----
        detections = await self._detect_wine_regions(image_source)

        # Separate section headers from wine entries
        section_headers = [d for d in detections if d.get("label") == "section_header"]
        wine_entries = [
            d
            for d in detections
            if d.get("label") == "wine_entry" or d.get("full_image")
        ]
        sub_detections = [
            d
            for d in detections
            if d.get("label") not in ("wine_entry", "section_header")
            and not d.get("full_image")
        ]

        # ---- Layer 2: OCR per region ----
        extracted = await self._extract_text_from_regions(image_source, detections)

        # Group sub-detections by parent wine_entry (spatial overlap)
        grouped = self._group_sub_detections(wine_entries, sub_detections, extracted)

        # ---- Layer 3: Structured field parsing (25 fields) ----
        field_parser = self._get_field_parser()
        parsed_wines = []
        for group in grouped:
            section_ctx = self._find_section_header(group, section_headers, extracted)
            parsed = await field_parser.parse(
                ocr_text=group.get("ocr_text", ""),
                section_header=section_ctx,
                yolo_detections=group.get("yolo_hints", {}),
                source_type="menu",
            )
            parsed_wines.append(parsed)

        # ---- Layer 4: Library matching ----
        matcher = self._get_wine_matcher()
        enriched_wines = []
        for parsed in parsed_wines:
            match_result = await matcher.match(
                wine_name=parsed.wine_name,
                producer=parsed.producer,
                vintage=parsed.vintage,
                wine_type=parsed.wine_type,
                restaurant_id=restaurant_id,
            )

            wine_dict = parsed.model_dump()
            wine_dict["match_result"] = {
                "matched": match_result["matched"],
                "auto_accepted": match_result["auto_accepted"],
                "best_match": match_result["best_match"],
                "phase_reached": match_result["phase_reached"],
            }
            if match_result["matched"] and match_result["best_match"]:
                wine_dict["master_wine_id"] = match_result["best_match"]["wine_id"]
                wine_dict["in_master_library"] = True
            else:
                wine_dict["in_master_library"] = False
                wine_dict["enrichment"] = match_result.get("enrichment")

            enriched_wines.append(wine_dict)

        return {
            "wines_detected": len(enriched_wines),
            "wines": enriched_wines,
            "regions_detected": len(detections),
            "section_headers": [
                e.get("text", "")
                for e in extracted
                if any(
                    sh.get("bbox") == e.get("region", {}).get("bbox")
                    for sh in section_headers
                )
            ],
        }

    # =========================================================================
    # LAYER 1: YOLO DETECTION
    # =========================================================================

    async def _detect_wine_regions(self, image_source: str) -> List[Dict[str, Any]]:
        """Detect wine regions using 13-class YOLOv8 model."""
        if self.mock_mode:
            return [
                {
                    "bbox": [50, 20, 400, 50],
                    "confidence": 0.95,
                    "label": "section_header",
                },
                {"bbox": [50, 60, 400, 140], "confidence": 0.92, "label": "wine_entry"},
                {"bbox": [50, 60, 200, 80], "confidence": 0.88, "label": "wine_name"},
                {"bbox": [350, 60, 400, 80], "confidence": 0.94, "label": "price"},
                {"bbox": [210, 60, 260, 80], "confidence": 0.90, "label": "vintage"},
                {
                    "bbox": [50, 150, 400, 230],
                    "confidence": 0.90,
                    "label": "wine_entry",
                },
                {"bbox": [50, 150, 200, 170], "confidence": 0.87, "label": "wine_name"},
                {"bbox": [350, 150, 400, 170], "confidence": 0.93, "label": "price"},
                {
                    "bbox": [50, 240, 400, 320],
                    "confidence": 0.88,
                    "label": "wine_entry",
                },
            ]

        if not self.yolo_model or not _check_pil():
            self.logger.warning("YOLO/PIL not available, using full image OCR")
            return [{"bbox": None, "full_image": True}]

        try:
            from PIL import Image

            if image_source.startswith("http"):
                import httpx

                async with httpx.AsyncClient() as client:
                    response = await client.get(image_source)
                    image = Image.open(io.BytesIO(response.content))
            else:
                img_bytes = base64.b64decode(image_source)
                image = Image.open(io.BytesIO(img_bytes))

            results = self.yolo_model(image, conf=self.confidence_threshold)

            regions = []
            for result in results:
                for box in result.boxes:
                    cls_id = int(box.cls)
                    label = MENU_CLASS_NAMES.get(
                        cls_id, result.names.get(cls_id, f"class_{cls_id}")
                    )
                    regions.append(
                        {
                            "bbox": box.xyxy[0].tolist(),
                            "confidence": float(box.conf),
                            "label": label,
                            "class_id": cls_id,
                        }
                    )

            if not regions:
                regions = [{"bbox": None, "full_image": True}]

            return regions

        except Exception as e:
            self.logger.error(f"YOLO detection error: {e}")
            return [{"bbox": None, "full_image": True}]

    # =========================================================================
    # LAYER 2: OCR EXTRACTION
    # =========================================================================

    def _preprocess_for_ocr(self, image):
        """
        Normalise a PIL image before passing to Surya OCR.

        - Converts to RGB (handles RGBA, palette, greyscale inputs)
        - Upscales if the longer side is below 1200 px (avoids tiny-text failures)
        - Applies a mild contrast boost (1.3×) to help on faded or dark screenshots
        """
        from PIL import Image, ImageEnhance

        if image.mode != "RGB":
            image = image.convert("RGB")

        w, h = image.size
        if max(w, h) < 1200:
            scale = 1200 / max(w, h)
            image = image.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

        image = ImageEnhance.Contrast(image).enhance(1.3)
        return image

    async def _extract_text_from_regions(
        self, image_source: str, regions: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Extract text from each detected region using Surya OCR."""
        if self.mock_mode:
            normalizer = self._get_normalizer()
            mock_texts = [
                ("RED WINES", "section_header"),
                ("Chateau Margaux 2018 - Bordeaux, France $450", "wine_entry"),
                ("Chateau Margaux", "wine_name"),
                ("$450", "price"),
                ("2018", "vintage"),
                ("Opus One 2019 - Napa Valley $380", "wine_entry"),
                ("Opus One", "wine_name"),
                ("$380", "price"),
                ("Sevilen Beyaz 2021 $35", "wine_entry"),
            ]
            results = []
            for i, (text, label) in enumerate(mock_texts):
                norm = normalizer.normalize(text)
                results.append(
                    {
                        "text": text,
                        "corrected_text": norm["corrected"],
                        "normalized_text": norm["normalized"],
                        "region": regions[i] if i < len(regions) else None,
                        "confidence": 0.90 + (i % 3) * 0.03,
                        "label": label,
                    }
                )
            return results

        if not self.surya_ocr or not self.surya_ocr.is_available or not _check_pil():
            self.logger.warning("Surya OCR or PIL not available")
            return []

        try:
            from PIL import Image

            if image_source.startswith("http"):
                import httpx

                async with httpx.AsyncClient() as client:
                    response = await client.get(image_source)
                    image = Image.open(io.BytesIO(response.content))
            else:
                img_bytes = base64.b64decode(image_source)
                image = Image.open(io.BytesIO(img_bytes))

            normalizer = self._get_normalizer()
            extracted_texts = []

            for region in regions:
                if region.get("full_image"):
                    target = self._preprocess_for_ocr(image)
                else:
                    bbox = region["bbox"]
                    cropped = image.crop((bbox[0], bbox[1], bbox[2], bbox[3]))
                    target = self._preprocess_for_ocr(cropped)

                loop = asyncio.get_event_loop()
                region_text, avg_conf = await loop.run_in_executor(
                    None, lambda img=target: self.surya_ocr.read_image(img)
                )

                norm = normalizer.normalize(region_text)
                extracted_texts.append(
                    {
                        "text": region_text,
                        "corrected_text": norm["corrected"],
                        "normalized_text": norm["normalized"],
                        "region": region,
                        "confidence": avg_conf,
                        "label": region.get("label", "unknown"),
                    }
                )

            return extracted_texts

        except Exception as e:
            self.logger.error(f"OCR extraction error: {e}")
            return []

    # =========================================================================
    # GROUPING HELPERS
    # =========================================================================

    def _group_sub_detections(
        self,
        wine_entries: List[Dict[str, Any]],
        sub_detections: List[Dict[str, Any]],
        extracted_texts: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """
        Group sub-detections (wine_name, price, vintage, etc.) under their
        parent wine_entry based on spatial overlap. Build OCR text + YOLO hints
        for each wine entry.
        """
        groups = []

        # Build a lookup from region bbox to extracted text
        text_lookup: Dict[str, str] = {}
        for ext in extracted_texts:
            region = ext.get("region")
            if region and region.get("bbox"):
                key = str(region["bbox"])
                text_lookup[key] = ext.get("text", "")

        for entry in wine_entries:
            entry_bbox = entry.get("bbox")
            entry_key = str(entry_bbox) if entry_bbox else "full"

            # Collect OCR text for the wine entry
            ocr_text = text_lookup.get(entry_key, "")

            # Find sub-detections that overlap with this entry
            yolo_hints: Dict[str, str] = {}
            if entry_bbox:
                for sub in sub_detections:
                    sub_bbox = sub.get("bbox")
                    if sub_bbox and self._bbox_overlaps(entry_bbox, sub_bbox):
                        label = sub.get("label", "")
                        sub_key = str(sub_bbox)
                        sub_text = text_lookup.get(sub_key, "")
                        if label and sub_text:
                            yolo_hints[label] = sub_text

            groups.append(
                {
                    "entry": entry,
                    "ocr_text": ocr_text,
                    "yolo_hints": yolo_hints,
                }
            )

        # If no wine entries detected, treat each extracted text as a wine entry
        if not groups:
            for ext in extracted_texts:
                label = ext.get("label", "")
                if label in ("wine_entry", "unknown") or ext.get("region", {}).get(
                    "full_image"
                ):
                    groups.append(
                        {
                            "entry": ext.get("region", {}),
                            "ocr_text": ext.get("text", ""),
                            "yolo_hints": {},
                        }
                    )

        return groups

    @staticmethod
    def _bbox_overlaps(outer: List[float], inner: List[float]) -> bool:
        """Check if inner bbox is mostly within outer bbox."""
        if not outer or not inner or len(outer) < 4 or len(inner) < 4:
            return False
        # Inner center must be within outer
        inner_cx = (inner[0] + inner[2]) / 2
        inner_cy = (inner[1] + inner[3]) / 2
        return outer[0] <= inner_cx <= outer[2] and outer[1] <= inner_cy <= outer[3]

    @staticmethod
    def _find_section_header(
        group: Dict[str, Any],
        section_headers: List[Dict[str, Any]],
        extracted_texts: List[Dict[str, Any]],
    ) -> Optional[str]:
        """Find the section header above a wine entry."""
        entry = group.get("entry", {})
        entry_bbox = entry.get("bbox")
        if not entry_bbox or not section_headers:
            return None

        # Find the nearest section header ABOVE this entry
        entry_top = entry_bbox[1]
        best_header = None
        best_distance = float("inf")

        for sh in section_headers:
            sh_bbox = sh.get("bbox")
            if not sh_bbox:
                continue
            sh_bottom = sh_bbox[3]
            if sh_bottom <= entry_top:
                distance = entry_top - sh_bottom
                if distance < best_distance:
                    best_distance = distance
                    best_header = sh

        if best_header:
            # Look up the OCR text for this header
            header_key = str(best_header.get("bbox"))
            for ext in extracted_texts:
                region = ext.get("region")
                if region and str(region.get("bbox")) == header_key:
                    return ext.get("text", "")

        return None

    # =========================================================================
    # MESSAGE HANDLERS (standalone)
    # =========================================================================

    async def _extract_text_from_image(self, message: Dict[str, Any]) -> None:
        """Handle text extraction request (standalone)."""
        payload = message.get("payload", {})
        image_data = payload.get("image_data")
        image_url = payload.get("image_url")
        request_id = payload.get("request_id")

        try:
            regions = [{"bbox": None, "full_image": True}]
            extracted_texts = await self._extract_text_from_regions(
                image_data or image_url, regions
            )
            full_text = " ".join([t.get("text", "") for t in extracted_texts])

            await self.publish(
                exchange_name="menu.events",
                routing_key="menu.text_extracted",
                message_body={
                    "event_type": "TextExtracted",
                    "payload": {
                        "request_id": request_id,
                        "text": full_text,
                        "segments": extracted_texts,
                    },
                },
                priority=5,
            )
        except Exception as e:
            self.logger.error(f"Text extraction error: {e}", exc_info=True)

    async def _lookup_wine(self, message: Dict[str, Any]) -> None:
        """Handle wine lookup request (standalone)."""
        payload = message.get("payload", {})
        wine_name = payload.get("wine_name")
        request_id = payload.get("request_id")

        try:
            matcher = self._get_wine_matcher()
            result = await matcher.match(wine_name=wine_name)

            await self.publish(
                exchange_name="menu.events",
                routing_key="menu.wine_lookup_complete",
                message_body={
                    "event_type": "WineLookupComplete",
                    "payload": {
                        "request_id": request_id,
                        "wine_name": wine_name,
                        "result": result,
                    },
                },
                priority=5,
            )
        except Exception as e:
            self.logger.error(f"Wine lookup error: {e}", exc_info=True)

    async def cleanup(self) -> None:
        """Cleanup vision models."""
        self.yolo_model = None
        self.surya_ocr = None
        self.llm_client = None
        self._normalizer = None
        self._field_parser = None
        self._wine_matcher = None
        self.logger.info("Menu Analyzer Agent cleaned up")
