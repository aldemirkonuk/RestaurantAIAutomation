"""
PDF Extraction Service
======================
FREE-first PDF processing pipeline:
  1. Try PyPDF2 text extraction (digital PDFs) -> FREE
  2. If no text layer, convert to images and run Surya OCR -> FREE (self-hosted)
  3. Route extracted text to local HtmlMenuParser
  4. Fallback to Gemini TEXT only if local parser confidence < 0.5

Supports:
  - Single-page PDFs
  - Multi-page PDFs (processes each page, merges results)
  - Digital PDFs (text-extractable)
  - Scanned/image-only PDFs (via Surya OCR)
  - Invoice-specific extraction with invoice number detection
"""

import io
import logging
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# Lazy imports for heavy dependencies
PYPDF2_AVAILABLE = False
PIL_AVAILABLE = False
PDF2IMAGE_AVAILABLE = False
SURYA_AVAILABLE = False

try:
    import PyPDF2

    PYPDF2_AVAILABLE = True
except ImportError:
    logger.warning("PyPDF2 not available. Install: pip install PyPDF2")

try:
    from PIL import Image

    PIL_AVAILABLE = True
except ImportError:
    logger.warning("Pillow not available. Install: pip install Pillow")

try:
    from pdf2image import convert_from_bytes, convert_from_path

    PDF2IMAGE_AVAILABLE = True
except ImportError:
    logger.warning("pdf2image not available. Install: pip install pdf2image")


# =============================================================================
# DATA MODELS
# =============================================================================


class PDFType(str, Enum):
    DIGITAL = "digital"  # Has text layer (PyPDF2 works)
    SCANNED = "scanned"  # Image-only (needs OCR)
    MIXED = "mixed"  # Some pages digital, some scanned
    UNKNOWN = "unknown"


class PageResult(BaseModel):
    """Result of processing a single PDF page."""

    page_number: int
    pdf_type: str = "unknown"
    raw_text: str = ""
    text_density: float = 0.0  # chars per estimated area
    extraction_method: str = "none"  # pypdf2, surya_ocr, gemini_vision
    wines_found: int = 0
    parse_result: Optional[Dict[str, Any]] = None
    confidence: float = 0.0


class PDFExtractionResult(BaseModel):
    """Complete result of processing a PDF document."""

    document_type: str = "menu"  # menu or invoice
    pdf_type: str = "unknown"
    total_pages: int = 0
    pages: List[PageResult] = Field(default_factory=list)
    merged_wines: List[Dict[str, Any]] = Field(default_factory=list)
    merged_sections: List[Dict[str, Any]] = Field(default_factory=list)
    section_hierarchy: Dict[str, Any] = Field(default_factory=dict)
    total_wines: int = 0
    overall_confidence: float = 0.0
    extraction_method: str = "free"  # free, surya_ocr, gemini_text, gemini_vision
    invoice_metadata: Optional[Dict[str, Any]] = None
    warnings: List[str] = Field(default_factory=list)
    cost: float = 0.0  # estimated API cost


# =============================================================================
# OCR LINE DATA (for bounding-box annotation pipelines)
# =============================================================================


@dataclass
class OcrLine:
    """A single OCR-detected text line with bounding box coordinates."""

    text: str
    confidence: float
    bbox_x: float  # pixels from left
    bbox_y: float  # pixels from top
    bbox_width: float  # pixels
    bbox_height: float  # pixels


@dataclass
class OcrWord:
    """A single OCR-detected word with bounding box coordinates."""

    text: str
    confidence: float
    bbox_x: float
    bbox_y: float
    bbox_width: float
    bbox_height: float
    line_index: int


# =============================================================================
# SURYA OCR WRAPPER
# =============================================================================


class SuryaOCRService:
    """
    Wrapper around Surya OCR for reading text from images.
    Self-hosted, free, 90+ languages, Apache 2.0.
    Falls back gracefully if not installed.
    """

    def __init__(self):
        self._model = None
        self._processor = None
        self._initialized = False
        self._available = False
        self._check_availability()

    def _check_availability(self):
        """Check if surya-ocr is installed."""
        try:
            import surya

            self._available = True
        except ImportError:
            logger.info(
                "Surya OCR not installed. Scanned PDF support limited. "
                "Install: pip install surya-ocr"
            )
            self._available = False

    def _initialize(self):
        """Lazy-initialize Surya models."""
        if self._initialized:
            return
        if not self._available:
            return
        try:
            from surya.recognition import RecognitionPredictor
            from surya.detection import DetectionPredictor
            from surya.foundation import FoundationPredictor

            self._det_predictor = DetectionPredictor()
            foundation = FoundationPredictor()
            self._rec_predictor = RecognitionPredictor(foundation)
            self._initialized = True
            logger.info("Surya OCR initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize Surya OCR: {e}")
            self._available = False

    @property
    def is_available(self) -> bool:
        return self._available

    @staticmethod
    def _polygon_to_bbox(polygon):
        """Convert polygon [[x1,y1],[x2,y2],[x3,y3],[x4,y4]] to (x, y, w, h)."""
        xs = [p[0] for p in polygon]
        ys = [p[1] for p in polygon]
        x_min, y_min = min(xs), min(ys)
        return (x_min, y_min, max(xs) - x_min, max(ys) - y_min)

    def read_image(self, image) -> Tuple[str, float]:
        """
        Read text from a PIL Image using Surya OCR.

        Args:
            image: PIL Image object.

        Returns:
            (extracted_text, confidence) tuple.
        """
        if not self._available:
            return ("", 0.0)

        self._initialize()
        if not self._initialized:
            return ("", 0.0)

        try:
            results = self._rec_predictor([image], det_predictor=self._det_predictor)

            lines = []
            confidences = []
            if results and len(results) > 0:
                for text_line in results[0].text_lines:
                    lines.append(text_line.text)
                    confidences.append(text_line.confidence or 0.0)

            text = "\n".join(lines)
            avg_conf = sum(confidences) / len(confidences) if confidences else 0.0

            return (text, avg_conf)

        except Exception as e:
            logger.error(f"Surya OCR failed: {e}")
            return ("", 0.0)

    def read_image_with_boxes(
        self, image
    ) -> Tuple[str, float, List[OcrLine], List[OcrWord]]:
        """
        Read text from a PIL Image using Surya OCR and return bounding boxes.

        Args:
            image: PIL Image object.

        Returns:
            (full_text, avg_confidence, list_of_OcrLine, list_of_OcrWord) tuple.
            Each OcrLine has text, confidence, and pixel-level bbox coords.
            Each OcrWord has text, confidence, bbox, and parent line_index.
        """
        if not self._available:
            return ("", 0.0, [], [])

        self._initialize()
        if not self._initialized:
            return ("", 0.0, [], [])

        try:
            results = self._rec_predictor([image], det_predictor=self._det_predictor)

            ocr_lines: List[OcrLine] = []
            ocr_words: List[OcrWord] = []
            lines: List[str] = []
            confidences: List[float] = []

            if results and len(results) > 0:
                for line_idx, text_line in enumerate(results[0].text_lines):
                    raw_text = text_line.text
                    clean_text = raw_text.replace("<b>", "").replace("</b>", "")
                    lines.append(clean_text)
                    conf = text_line.confidence or 0.0
                    confidences.append(conf)

                    x, y, w, h = self._polygon_to_bbox(text_line.polygon)
                    ocr_lines.append(
                        OcrLine(
                            text=clean_text,
                            confidence=conf,
                            bbox_x=x,
                            bbox_y=y,
                            bbox_width=w,
                            bbox_height=h,
                        )
                    )

                    if hasattr(text_line, "words") and text_line.words:
                        for word in text_line.words:
                            word_text = word.text.replace("<b>", "").replace("</b>", "")
                            if not word_text.strip():
                                continue
                            wx, wy, ww, wh = self._polygon_to_bbox(word.polygon)
                            word_conf = (
                                word.confidence
                                if hasattr(word, "confidence") and word.confidence
                                else conf
                            )
                            ocr_words.append(
                                OcrWord(
                                    text=word_text,
                                    confidence=word_conf,
                                    bbox_x=wx,
                                    bbox_y=wy,
                                    bbox_width=ww,
                                    bbox_height=wh,
                                    line_index=line_idx,
                                )
                            )

            text = "\n".join(lines)
            avg_conf = sum(confidences) / len(confidences) if confidences else 0.0
            return (text, avg_conf, ocr_lines, ocr_words)

        except Exception as e:
            logger.error(f"Surya OCR read_image_with_boxes failed: {e}")
            return ("", 0.0, [], [])


# =============================================================================
# PDF EXTRACTION SERVICE
# =============================================================================


class PDFExtractionService:
    """
    FREE-first PDF extraction pipeline.
    Handles both menu PDFs and invoice PDFs.
    """

    # Minimum text density to consider a page as digital (chars per page)
    MIN_TEXT_DENSITY = 50

    def __init__(self):
        self._surya = SuryaOCRService()
        self._menu_parser = None  # lazy import

    def _get_menu_parser(self):
        if self._menu_parser is None:
            from services.html_menu_parser import get_menu_parser

            self._menu_parser = get_menu_parser()
        return self._menu_parser

    # =========================================================================
    # MAIN EXTRACTION
    # =========================================================================

    async def extract_from_file(
        self,
        file_path: str,
        document_type: str = "menu",
        restaurant_name: Optional[str] = None,
    ) -> PDFExtractionResult:
        """
        Extract wine data from a PDF file.

        Args:
            file_path: Path to PDF file.
            document_type: 'menu' or 'invoice'.
            restaurant_name: Optional restaurant name for context.
        """
        path = Path(file_path)
        if not path.exists():
            return PDFExtractionResult(warnings=[f"File not found: {file_path}"])

        with open(path, "rb") as f:
            pdf_bytes = f.read()

        return await self.extract_from_bytes(pdf_bytes, document_type, restaurant_name)

    async def extract_from_bytes(
        self,
        pdf_bytes: bytes,
        document_type: str = "menu",
        restaurant_name: Optional[str] = None,
    ) -> PDFExtractionResult:
        """
        Extract wine data from PDF bytes.

        Args:
            pdf_bytes: Raw PDF file bytes.
            document_type: 'menu' or 'invoice'.
            restaurant_name: Optional restaurant name for context.
        """
        result = PDFExtractionResult(document_type=document_type)

        # Step 1: Try PyPDF2 text extraction
        pages_text = self._extract_text_pypdf2(pdf_bytes)
        result.total_pages = len(pages_text)

        if not pages_text:
            result.warnings.append("Failed to read PDF")
            return result

        # Step 2: Classify each page (digital vs scanned)
        page_results: List[PageResult] = []
        all_text_parts: List[str] = []
        has_scanned = False
        has_digital = False

        for page_num, text in enumerate(pages_text):
            pr = PageResult(page_number=page_num + 1)
            text_density = len(text.strip())

            if text_density >= self.MIN_TEXT_DENSITY:
                # Digital page: text layer is usable
                pr.pdf_type = "digital"
                pr.raw_text = text
                pr.text_density = text_density
                pr.extraction_method = "pypdf2"
                has_digital = True
                all_text_parts.append(text)
            else:
                # Scanned page: needs OCR
                pr.pdf_type = "scanned"
                has_scanned = True

                # Try Surya OCR
                ocr_text, ocr_conf = await self._ocr_page(pdf_bytes, page_num)
                if ocr_text and len(ocr_text.strip()) >= 10:
                    pr.raw_text = ocr_text
                    pr.text_density = len(ocr_text.strip())
                    pr.extraction_method = "surya_ocr"
                    pr.confidence = ocr_conf
                    all_text_parts.append(ocr_text)
                else:
                    pr.extraction_method = "none"
                    pr.confidence = 0.0
                    result.warnings.append(
                        f"Page {page_num + 1}: No text extracted (scanned, OCR failed)"
                    )

            page_results.append(pr)

        # Determine overall PDF type
        if has_scanned and has_digital:
            result.pdf_type = "mixed"
        elif has_scanned:
            result.pdf_type = "scanned"
        else:
            result.pdf_type = "digital"

        # Step 3: Parse combined text with local parser
        combined_text = "\n\n".join(all_text_parts)
        if combined_text.strip():
            parser = self._get_menu_parser()
            parse_result = parser.parse_menu(
                combined_text,
                source_type="pdf",
                restaurant_name=restaurant_name,
            )

            result.merged_wines = parse_result.wines
            result.merged_sections = parse_result.sections
            result.section_hierarchy = parse_result.section_hierarchy
            result.total_wines = parse_result.total_wines
            result.overall_confidence = parse_result.parser_confidence
            result.warnings.extend(parse_result.warnings)

            # Update page-level wine counts
            for pr in page_results:
                if pr.raw_text:
                    page_parse = parser.parse_menu(pr.raw_text, source_type="pdf")
                    pr.wines_found = page_parse.total_wines
                    pr.confidence = page_parse.parser_confidence

        # Determine extraction method used
        methods = set(
            pr.extraction_method
            for pr in page_results
            if pr.extraction_method != "none"
        )
        if methods == {"pypdf2"}:
            result.extraction_method = "free"
        elif "surya_ocr" in methods:
            result.extraction_method = "surya_ocr"
        else:
            result.extraction_method = "free"

        result.pages = page_results
        result.cost = 0.0  # All free paths

        # Invoice-specific: extract invoice metadata
        if document_type == "invoice" and combined_text.strip():
            result.invoice_metadata = self._extract_invoice_metadata(combined_text)

        return result

    # =========================================================================
    # PYPDF2 TEXT EXTRACTION
    # =========================================================================

    def _extract_text_pypdf2(self, pdf_bytes: bytes) -> List[str]:
        """Extract text from each page using PyPDF2."""
        if not PYPDF2_AVAILABLE:
            logger.warning("PyPDF2 not available")
            return []

        try:
            reader = PyPDF2.PdfReader(io.BytesIO(pdf_bytes))
            pages = []
            for page in reader.pages:
                text = page.extract_text() or ""
                pages.append(text)
            return pages
        except Exception as e:
            logger.error(f"PyPDF2 extraction failed: {e}")
            return []

    # =========================================================================
    # SURYA OCR FOR SCANNED PAGES
    # =========================================================================

    async def _ocr_page(self, pdf_bytes: bytes, page_number: int) -> Tuple[str, float]:
        """OCR a single page from a PDF using Surya."""
        if not self._surya.is_available:
            return ("", 0.0)

        if not PDF2IMAGE_AVAILABLE or not PIL_AVAILABLE:
            logger.warning("pdf2image or Pillow not available for page conversion")
            return ("", 0.0)

        try:
            images = convert_from_bytes(
                pdf_bytes,
                first_page=page_number + 1,
                last_page=page_number + 1,
                dpi=300,
            )
            if not images:
                return ("", 0.0)

            return self._surya.read_image(images[0])
        except Exception as e:
            logger.error(f"Page OCR failed for page {page_number}: {e}")
            return ("", 0.0)

    # =========================================================================
    # INVOICE METADATA EXTRACTION
    # =========================================================================

    def _extract_invoice_metadata(self, text: str) -> Dict[str, Any]:
        """Extract invoice-specific metadata (number, date, vendor, totals)."""
        import re

        metadata: Dict[str, Any] = {}

        # Invoice number patterns
        inv_patterns = [
            r"(?:invoice|inv|bill)[\s#:]*([A-Z0-9\-]+)",
            r"(?:no|number|#)[\s.:]*([A-Z0-9\-]{3,20})",
            r"(?:ref|reference)[\s.:]*([A-Z0-9\-]{3,20})",
        ]
        for pattern in inv_patterns:
            match = re.search(pattern, text, re.I)
            if match:
                metadata["invoice_number"] = match.group(1).strip()
                break

        # Date patterns
        date_patterns = [
            r"(?:date|dated|invoice date)[\s.:]*(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})",
            r"(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})",
            r"(\w+ \d{1,2},?\s*\d{4})",
        ]
        for pattern in date_patterns:
            match = re.search(pattern, text, re.I)
            if match:
                metadata["invoice_date"] = match.group(1).strip()
                break

        # Total amount
        total_patterns = [
            r"(?:total|grand total|amount due|balance due)[\s.:]*\$?([\d,]+\.?\d{0,2})",
            r"(?:total)[\s.:]*€?([\d,]+\.?\d{0,2})",
        ]
        for pattern in total_patterns:
            match = re.search(pattern, text, re.I)
            if match:
                try:
                    metadata["total_amount"] = float(match.group(1).replace(",", ""))
                except ValueError:
                    pass
                break

        # Vendor/provider name (usually at top of invoice)
        first_lines = text.strip().split("\n")[:5]
        if first_lines:
            # First non-empty, non-date line is often the vendor
            for line in first_lines:
                line = line.strip()
                if line and len(line) > 3 and not re.match(r"^\d", line):
                    metadata["vendor_name"] = line
                    break

        return metadata


# =============================================================================
# MODULE-LEVEL SINGLETON
# =============================================================================

_service_instance: Optional[PDFExtractionService] = None


def get_pdf_service() -> PDFExtractionService:
    """Get module-level singleton PDF extraction service."""
    global _service_instance
    if _service_instance is None:
        _service_instance = PDFExtractionService()
    return _service_instance
