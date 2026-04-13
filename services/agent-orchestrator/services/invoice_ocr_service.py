"""
Invoice OCR Service
===================
Processes invoice PDF and image files to extract wine data.
Supports automated inventory updates with audit trail.

FREE-first pipeline:
  1. PyPDF2 text extraction (digital PDFs) -> FREE
  2. Surya OCR fallback (scanned PDFs) -> FREE (self-hosted)
  3. EasyOCR fallback (if Surya unavailable)
  4. Multi-page merging for line items
  5. Invoice number detection for audit

Audit trail: every processed invoice is logged with:
  - invoice_number, vendor, date, line items
  - extraction_method, confidence, timestamp
  - original file hash for dedup
"""

import hashlib
import io
import json
import re
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from pathlib import Path
from io import BytesIO

try:
    import easyocr
    EASYOCR_AVAILABLE = True
except ImportError:
    EASYOCR_AVAILABLE = False
    logging.warning("EasyOCR not available. Install with: pip install easyocr")

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False
    logging.warning("PIL not available. Install with: pip install Pillow")

try:
    import PyPDF2
    PYPDF2_AVAILABLE = True
except ImportError:
    PYPDF2_AVAILABLE = False
    logging.warning("PyPDF2 not available. Install with: pip install PyPDF2")

logger = logging.getLogger(__name__)

# Project paths
PROJECT_ROOT = Path(__file__).resolve().parents[3]
AUDIT_DIR = PROJECT_ROOT / "datasets" / "raw_uploads" / "invoices"


class InvoiceOCRService:
    """
    Service for OCR processing of wine invoices
    Extracts wine names, quantities, prices, and provider information
    """
    
    def __init__(self):
        """Initialize OCR reader (lazy loading for performance)"""
        self.reader = None
        self._reader_initialized = False
        
    def _initialize_reader(self):
        """Lazy initialization of EasyOCR reader"""
        if not self._reader_initialized and EASYOCR_AVAILABLE:
            try:
                self.reader = easyocr.Reader(['en'], gpu=False)  # CPU mode for Railway
                self._reader_initialized = True
                logger.info("EasyOCR reader initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize EasyOCR: {e}")
                self.reader = None
        
    async def process_invoice(
        self, 
        file_path: str, 
        file_type: str,
        provider_id: Optional[str] = None
    ) -> Dict:
        """
        Extract wine data from PDF or image invoice
        
        Args:
            file_path: Path to invoice file
            file_type: 'pdf' or 'image'
            provider_id: Optional provider ID for context
            
        Returns:
            Dict containing extracted invoice data
        """
        try:
            # Extract text based on file type
            if file_type == 'pdf':
                text = self._extract_from_pdf(file_path)
            else:
                text = self._extract_from_image(file_path)
            
            if not text:
                return {
                    'success': False,
                    'error': 'No text extracted from invoice',
                    'wines': []
                }
            
            # Parse invoice structure
            parsed_data = self._parse_invoice_text(text, provider_id)
            
            return {
                'success': True,
                'wines': parsed_data['wines'],
                'invoice_number': parsed_data.get('invoice_number'),
                'invoice_date': parsed_data.get('invoice_date'),
                'total_amount': parsed_data.get('total_amount'),
                'provider_info': parsed_data.get('provider_info'),
                'raw_text': text  # For debugging
            }
            
        except Exception as e:
            logger.error(f"Error processing invoice: {e}")
            return {
                'success': False,
                'error': str(e),
                'wines': []
            }
    
    def _extract_from_pdf(self, file_path: str) -> str:
        """Extract text from PDF file"""
        if not PYPDF2_AVAILABLE:
            raise ImportError("PyPDF2 is required for PDF processing")
        
        try:
            text_content = []
            with open(file_path, 'rb') as file:
                pdf_reader = PyPDF2.PdfReader(file)
                for page in pdf_reader.pages:
                    text_content.append(page.extract_text())
            
            return "\n".join(text_content)
        
        except Exception as e:
            logger.error(f"Error extracting text from PDF: {e}")
            return ""
    
    def _extract_from_image(self, file_path: str) -> str:
        """Extract text from image file using OCR"""
        if not EASYOCR_AVAILABLE or not PIL_AVAILABLE:
            raise ImportError("EasyOCR and PIL are required for image processing")
        
        try:
            # Initialize reader if not already done
            if not self._reader_initialized:
                self._initialize_reader()
            
            if not self.reader:
                raise RuntimeError("OCR reader not initialized")
            
            # Read and process image
            result = self.reader.readtext(file_path)
            
            # Extract text from results
            text_lines = [text for _, text, _ in result]
            return "\n".join(text_lines)
        
        except Exception as e:
            logger.error(f"Error extracting text from image: {e}")
            return ""
    
    def _parse_invoice_text(
        self, 
        text: str, 
        provider_id: Optional[str] = None
    ) -> Dict:
        """
        Parse invoice text to extract structured wine data
        
        Uses regex patterns and heuristics to identify:
        - Wine names
        - Quantities (with case/bottle detection)
        - Unit prices
        - Provider info
        - Invoice metadata
        """
        lines = text.split('\n')
        
        result = {
            'wines': [],
            'invoice_number': self._extract_invoice_number(text),
            'invoice_date': self._extract_invoice_date(text),
            'total_amount': self._extract_total_amount(text),
            'provider_info': self._extract_provider_info(text, provider_id)
        }
        
        # Extract wine items
        wine_items = self._extract_wine_items(lines)
        result['wines'] = wine_items
        
        return result
    
    def _extract_wine_items(self, lines: List[str]) -> List[Dict]:
        """
        Extract individual wine items from invoice lines
        
        Common invoice patterns:
        - "[Qty] [Wine Name] [Vintage] [Price]"
        - "[Wine Name] - [Qty]x [Unit] @ [Price]"
        - "[Code] [Wine Name] [Case/Bottle] [Qty] [Price]"
        """
        wine_items = []
        
        # Patterns for wine line detection
        wine_patterns = [
            # Pattern 1: Quantity at start
            r'(\d+)\s+([A-Za-z\s\']+(?:\d{4})?)\s+[\$]?([\d,]+\.?\d{0,2})',
            
            # Pattern 2: Wine name first with "cs" or "btl"
            r'([A-Za-z\s\']+)\s+(\d+)\s*(cs|case|btl|bottle)s?\s+[\$]?([\d,]+\.?\d{0,2})',
            
            # Pattern 3: Complex format with code
            r'([A-Z0-9]+)\s+([A-Za-z\s\']+)\s+(\d+)\s*(cs|case|btl|bottle)?\s+[\$]?([\d,]+\.?\d{0,2})'
        ]
        
        for line in lines:
            # Skip header/footer lines
            if any(skip in line.lower() for skip in ['invoice', 'total', 'subtotal', 'tax', 'page', 'terms']):
                continue
            
            # Try each pattern
            for pattern in wine_patterns:
                match = re.search(pattern, line, re.IGNORECASE)
                if match:
                    wine_item = self._parse_wine_match(match, line)
                    if wine_item:
                        wine_items.append(wine_item)
                        break  # Found a match, skip other patterns
        
        return wine_items
    
    def _parse_wine_match(self, match: re.Match, line: str) -> Optional[Dict]:
        """Parse a regex match into a structured wine item"""
        try:
            groups = match.groups()
            
            # Determine wine name, quantity, unit type, price
            wine_name = None
            quantity = None
            unit_type = 'bottle'  # Default
            unit_price = None
            
            # Extract based on group count and content
            for group in groups:
                if group:
                    # Check if it's a wine name (contains letters)
                    if re.search(r'[A-Za-z]{3,}', group):
                        if not wine_name:
                            wine_name = group.strip()
                    
                    # Check if it's a quantity (pure number)
                    elif re.match(r'^\d+$', group):
                        if not quantity:
                            quantity = int(group)
                    
                    # Check if it's unit type
                    elif group.lower() in ['cs', 'case', 'cases']:
                        unit_type = 'case'
                    elif group.lower() in ['btl', 'bottle', 'bottles']:
                        unit_type = 'bottle'
                    
                    # Check if it's a price (contains decimal or comma)
                    elif re.search(r'[\d,]+\.?\d{0,2}', group):
                        if not unit_price:
                            unit_price = float(group.replace(',', ''))
            
            # Validate we have minimum required data
            if wine_name and quantity:
                return {
                    'name': wine_name,
                    'quantity': quantity,
                    'unit_type': unit_type,
                    'unit_price': unit_price or 0.0,
                    'total_price': (unit_price or 0.0) * quantity,
                    'raw_line': line  # For debugging
                }
        
        except Exception as e:
            logger.warning(f"Error parsing wine match: {e}")
        
        return None
    
    def _extract_invoice_number(self, text: str) -> Optional[str]:
        """Extract invoice number from text"""
        patterns = [
            r'invoice\s*#?\s*:?\s*([A-Z0-9-]+)',
            r'inv\s*#?\s*:?\s*([A-Z0-9-]+)',
            r'number\s*:?\s*([A-Z0-9-]+)'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return match.group(1)
        
        return None
    
    def _extract_invoice_date(self, text: str) -> Optional[str]:
        """Extract invoice date from text"""
        # Common date patterns
        patterns = [
            r'date\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})',
            r'(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})',
            r'(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2},?\s+\d{4}'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return match.group(1)
        
        return None
    
    def _extract_total_amount(self, text: str) -> Optional[float]:
        """Extract total amount from invoice"""
        patterns = [
            r'total\s*:?\s*[\$]?([\d,]+\.?\d{0,2})',
            r'amount\s+due\s*:?\s*[\$]?([\d,]+\.?\d{0,2})',
            r'balance\s*:?\s*[\$]?([\d,]+\.?\d{0,2})'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return float(match.group(1).replace(',', ''))
        
        return None
    
    def _extract_provider_info(
        self, 
        text: str, 
        provider_id: Optional[str]
    ) -> Dict:
        """Extract provider information from invoice"""
        # If provider_id is given, we can look it up
        # For now, extract from text
        
        provider_info = {}
        
        # Extract company name (usually at top)
        lines = text.split('\n')[:10]  # Check first 10 lines
        for line in lines:
            if len(line) > 10 and not any(skip in line.lower() for skip in ['invoice', 'date', 'page']):
                # Likely company name
                if not provider_info.get('name'):
                    provider_info['name'] = line.strip()
                    break
        
        # Extract phone number
        phone_match = re.search(r'(\(\d{3}\)\s*\d{3}-\d{4}|\d{3}-\d{3}-\d{4})', text)
        if phone_match:
            provider_info['phone'] = phone_match.group(1)
        
        return provider_info


# =============================================================================
# ENHANCED INVOICE PIPELINE (with Surya OCR + audit trail)
# =============================================================================

class EnhancedInvoiceService(InvoiceOCRService):
    """
    Enhanced invoice processing with:
    - Surya OCR fallback (free, self-hosted)
    - Multi-page merging
    - Invoice number detection for audit
    - Audit trail logging
    - Credit memo / delivery receipt detection
    """

    def __init__(self):
        super().__init__()
        self._surya = None
        AUDIT_DIR.mkdir(parents=True, exist_ok=True)

    def _get_surya(self):
        """Lazy-load Surya OCR service."""
        if self._surya is None:
            try:
                from services.pdf_extraction_service import SuryaOCRService
                self._surya = SuryaOCRService()
            except ImportError:
                logger.info("Surya OCR not available for invoices")
        return self._surya

    async def process_invoice_enhanced(
        self,
        file_path: str,
        file_type: str,
        provider_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Enhanced invoice processing with free-first approach and audit trail.

        Args:
            file_path: Path to invoice file.
            file_type: 'pdf' or 'image'.
            provider_id: Optional provider ID.

        Returns:
            Dict with extracted data + audit metadata.
        """
        path = Path(file_path)
        extraction_method = "unknown"
        text = ""
        page_texts: List[str] = []

        # Calculate file hash for dedup
        file_hash = ""
        if path.exists():
            with open(path, "rb") as f:
                file_hash = hashlib.md5(f.read()).hexdigest()

        # Step 1: Extract text
        if file_type == "pdf":
            # Try PyPDF2 first (FREE)
            page_texts = self._extract_pages_pypdf2(file_path)
            text = "\n\n".join(page_texts)
            extraction_method = "pypdf2"

            # If no text, try Surya OCR (FREE, self-hosted)
            if not text.strip() or len(text.strip()) < 50:
                surya = self._get_surya()
                if surya and surya.is_available:
                    text = await self._extract_with_surya(file_path)
                    extraction_method = "surya_ocr"
                else:
                    # Fall back to EasyOCR
                    text = self._extract_from_image_pages(file_path)
                    extraction_method = "easyocr"

        elif file_type == "image":
            # Try Surya first
            surya = self._get_surya()
            if surya and surya.is_available:
                try:
                    img = Image.open(file_path)
                    text, _ = surya.read_image(img)
                    extraction_method = "surya_ocr"
                except Exception:
                    pass

            if not text.strip():
                text = self._extract_from_image(file_path)
                extraction_method = "easyocr"

        if not text:
            return {
                "success": False,
                "error": "No text extracted from invoice",
                "wines": [],
                "audit": self._create_audit_entry(
                    file_path, file_hash, "failed", extraction_method
                ),
            }

        # Step 2: Parse invoice
        parsed = self._parse_invoice_text(text, provider_id)

        # Step 3: Detect document type
        doc_type = self._detect_document_type(text)

        # Step 4: Enhanced line item extraction
        line_items = self._extract_line_items_enhanced(text)

        # Step 5: Merge with existing wine items
        all_wines = parsed.get("wines", []) + line_items
        # Dedup by name similarity
        all_wines = self._dedup_line_items(all_wines)

        # Step 6: Create audit entry
        audit = self._create_audit_entry(
            file_path, file_hash, "success", extraction_method,
            invoice_number=parsed.get("invoice_number"),
            vendor=parsed.get("provider_info", {}).get("name"),
            total_amount=parsed.get("total_amount"),
            line_count=len(all_wines),
        )

        # Step 7: Save audit trail
        self._save_audit(audit)

        return {
            "success": True,
            "document_type": doc_type,
            "wines": all_wines,
            "invoice_number": parsed.get("invoice_number"),
            "invoice_date": parsed.get("invoice_date"),
            "total_amount": parsed.get("total_amount"),
            "provider_info": parsed.get("provider_info"),
            "extraction_method": extraction_method,
            "page_count": len(page_texts) if page_texts else 1,
            "raw_text": text,
            "audit": audit,
        }

    def _extract_pages_pypdf2(self, file_path: str) -> List[str]:
        """Extract text from each page using PyPDF2."""
        if not PYPDF2_AVAILABLE:
            return []
        try:
            pages = []
            with open(file_path, "rb") as f:
                reader = PyPDF2.PdfReader(f)
                for page in reader.pages:
                    pages.append(page.extract_text() or "")
            return pages
        except Exception as e:
            logger.error(f"PyPDF2 page extraction failed: {e}")
            return []

    async def _extract_with_surya(self, file_path: str) -> str:
        """Extract text from PDF using Surya OCR on rendered pages."""
        try:
            from pdf2image import convert_from_path
            images = convert_from_path(file_path, dpi=300)

            surya = self._get_surya()
            if not surya:
                return ""

            texts = []
            for img in images:
                text, _ = surya.read_image(img)
                texts.append(text)

            return "\n\n".join(texts)
        except Exception as e:
            logger.error(f"Surya OCR extraction failed: {e}")
            return ""

    def _extract_from_image_pages(self, file_path: str) -> str:
        """Extract text from PDF by rendering to images and running EasyOCR."""
        try:
            from pdf2image import convert_from_path
            images = convert_from_path(file_path, dpi=200)

            if not self._reader_initialized:
                self._initialize_reader()
            if not self.reader:
                return ""

            texts = []
            for img in images:
                buf = io.BytesIO()
                img.save(buf, format="PNG")
                buf.seek(0)
                result = self.reader.readtext(buf.getvalue())
                texts.append("\n".join(t for _, t, _ in result))

            return "\n\n".join(texts)
        except Exception as e:
            logger.error(f"EasyOCR page extraction failed: {e}")
            return ""

    def _detect_document_type(self, text: str) -> str:
        """Detect if document is invoice, credit memo, delivery receipt, or PO."""
        lower = text.lower()
        if any(kw in lower for kw in ["credit memo", "credit note", "credit adjustment"]):
            return "credit_memo"
        if any(kw in lower for kw in ["delivery receipt", "delivery note", "packing slip"]):
            return "delivery_receipt"
        if any(kw in lower for kw in ["purchase order", "p.o.", "po #"]):
            return "purchase_order"
        return "invoice"

    def _extract_line_items_enhanced(self, text: str) -> List[Dict[str, Any]]:
        """Enhanced line item extraction with more patterns."""
        items = []
        lines = text.split("\n")

        # Additional patterns beyond the base class
        patterns = [
            # SKU pattern: SKU NAME VINTAGE QTY PRICE
            re.compile(
                r"([A-Z0-9]{4,12})\s+"
                r"([A-Za-z\s\'\-]{5,50})\s+"
                r"(\d{4})?\s*"
                r"(\d+)\s*(?:cs|case|btl|bottle)?\s*"
                r"[\$]?([\d,]+\.?\d{0,2})"
            ),
            # Name, Vintage, Qty x Price
            re.compile(
                r"([A-Za-z\s\'\-]{5,50})\s+"
                r"(\d{4})\s+"
                r"(\d+)\s*[xX×]\s*"
                r"[\$]?([\d,]+\.?\d{0,2})"
            ),
            # Simple: Name Price
            re.compile(
                r"([A-Za-z\s\'\-]{5,50})\s+"
                r"[\$]([\d,]+\.?\d{0,2})"
            ),
        ]

        for line in lines:
            line = line.strip()
            if not line or len(line) < 5:
                continue
            if any(skip in line.lower() for skip in [
                "subtotal", "total", "tax", "shipping", "page", "terms",
                "thank you", "remit", "notes"
            ]):
                continue

            for pattern in patterns:
                match = pattern.search(line)
                if match:
                    groups = match.groups()
                    item: Dict[str, Any] = {"raw_line": line}

                    if len(groups) >= 5:
                        item["sku"] = groups[0]
                        item["name"] = groups[1].strip()
                        item["vintage"] = int(groups[2]) if groups[2] else None
                        item["quantity"] = int(groups[3])
                        item["unit_price"] = float(groups[4].replace(",", ""))
                    elif len(groups) == 4:
                        item["name"] = groups[0].strip()
                        item["vintage"] = int(groups[1]) if groups[1] else None
                        item["quantity"] = int(groups[2])
                        item["unit_price"] = float(groups[3].replace(",", ""))
                    elif len(groups) == 2:
                        item["name"] = groups[0].strip()
                        item["quantity"] = 1
                        item["unit_price"] = float(groups[1].replace(",", ""))
                    else:
                        continue

                    item.setdefault("unit_type", "bottle")
                    item["total_price"] = item.get("quantity", 1) * item.get("unit_price", 0)
                    items.append(item)
                    break

        return items

    def _dedup_line_items(self, items: List[Dict]) -> List[Dict]:
        """Remove duplicate line items by name similarity."""
        if len(items) <= 1:
            return items

        seen_names: Dict[str, int] = {}
        unique = []

        for item in items:
            name = (item.get("name") or "").lower().strip()
            if not name:
                unique.append(item)
                continue

            # Simple dedup: skip if name is very similar to existing
            key = re.sub(r"[^a-z0-9]", "", name)[:20]
            if key in seen_names:
                continue

            seen_names[key] = len(unique)
            unique.append(item)

        return unique

    def _create_audit_entry(
        self,
        file_path: str,
        file_hash: str,
        status: str,
        method: str,
        invoice_number: Optional[str] = None,
        vendor: Optional[str] = None,
        total_amount: Optional[float] = None,
        line_count: int = 0,
    ) -> Dict[str, Any]:
        """Create an audit trail entry."""
        return {
            "file_path": file_path,
            "file_hash": file_hash,
            "status": status,
            "extraction_method": method,
            "invoice_number": invoice_number,
            "vendor": vendor,
            "total_amount": total_amount,
            "line_item_count": line_count,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }

    def _save_audit(self, audit: Dict[str, Any]):
        """Save audit trail to JSON file."""
        audit_file = AUDIT_DIR / "_audit_trail.jsonl"
        try:
            with open(audit_file, "a") as f:
                f.write(json.dumps(audit, default=str) + "\n")
        except Exception as e:
            logger.warning(f"Failed to save audit trail: {e}")


# =============================================================================
# SINGLETONS
# =============================================================================

_invoice_ocr_service = None
_enhanced_invoice_service = None


def get_invoice_ocr_service() -> InvoiceOCRService:
    """Get singleton instance of InvoiceOCRService"""
    global _invoice_ocr_service
    if _invoice_ocr_service is None:
        _invoice_ocr_service = InvoiceOCRService()
    return _invoice_ocr_service


def get_enhanced_invoice_service() -> EnhancedInvoiceService:
    """Get singleton instance of EnhancedInvoiceService"""
    global _enhanced_invoice_service
    if _enhanced_invoice_service is None:
        _enhanced_invoice_service = EnhancedInvoiceService()
    return _enhanced_invoice_service

