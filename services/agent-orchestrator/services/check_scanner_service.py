"""
Digital Check Scanner Service
Extracts financial data from digital receipts/checks for profit margin analysis
"""

import re
import logging
from typing import Dict, List, Optional
from decimal import InvalidOperation

try:
    import easyocr

    EASYOCR_AVAILABLE = True
except ImportError:
    EASYOCR_AVAILABLE = False
    logging.warning("EasyOCR not available")

logger = logging.getLogger(__name__)


class CheckScannerService:
    """
    Service for extracting financial data from digital checks/receipts
    Calculates profit margins and identifies wine sales
    """

    def __init__(self, ocr_service=None):
        """
        Initialize check scanner service

        Args:
            ocr_service: Optional OCR service (uses EasyOCR if not provided)
        """
        self.ocr_service = ocr_service
        self._reader = None

    def _get_ocr_reader(self):
        """Lazy load OCR reader"""
        if not self._reader and EASYOCR_AVAILABLE:
            self._reader = easyocr.Reader(["en"], gpu=False)
        return self._reader

    async def process_check(
        self, file_path: str, scan_date: Optional[str] = None
    ) -> Dict:
        """
        Extract financial data from digital check/receipt

        Args:
            file_path: Path to image file
            scan_date: Optional date string for the check

        Returns:
            Dict containing financial metrics and extracted data
        """
        try:
            # Extract text using OCR
            if self.ocr_service:
                text = await self.ocr_service.extract_text(file_path)
            else:
                text = await self._extract_text_with_easyocr(file_path)

            if not text:
                return {
                    "success": False,
                    "error": "No text extracted from check",
                    "extracted_data": {},
                }

            # Parse financial data
            extracted_data = self._parse_check_text(text)

            # Calculate profit margin if we have cost data
            if extracted_data.get("wine_sales") and extracted_data.get("wine_cost"):
                extracted_data["profit_margin"] = self._calculate_profit_margin(
                    extracted_data["wine_sales"], extracted_data["wine_cost"]
                )

            return {
                "success": True,
                "scan_date": scan_date or extracted_data.get("timestamp"),
                "total_amount": extracted_data.get("total"),
                "wine_sales": extracted_data.get("wine_sales"),
                "wine_cost": extracted_data.get("wine_cost"),
                "profit_margin": extracted_data.get("profit_margin"),
                "extracted_data": extracted_data,
                "raw_text": text,
            }

        except Exception as e:
            logger.error(f"Error processing check: {e}")
            return {"success": False, "error": str(e), "extracted_data": {}}

    async def _extract_text_with_easyocr(self, file_path: str) -> str:
        """Extract text using EasyOCR"""
        if not EASYOCR_AVAILABLE:
            raise ImportError("EasyOCR is required for check scanning")

        try:
            reader = self._get_ocr_reader()
            if not reader:
                raise RuntimeError("OCR reader not initialized")

            result = reader.readtext(file_path)
            text_lines = [text for _, text, _ in result]
            return "\n".join(text_lines)

        except Exception as e:
            logger.error(f"Error extracting text with EasyOCR: {e}")
            return ""

    def _parse_check_text(self, text: str) -> Dict:
        """
        Parse check text to extract financial metrics

        Returns:
            Dict with:
            - items: List of line items
            - subtotal: Subtotal amount
            - tax: Tax amount
            - tip: Tip amount (if present)
            - total: Total amount
            - wine_sales: Total wine sales
            - wine_items: List of wine items
            - timestamp: Transaction timestamp
        """
        lines = text.split("\n")

        result = {
            "items": [],
            "wine_items": [],
            "subtotal": 0.0,
            "tax": 0.0,
            "tip": 0.0,
            "total": 0.0,
            "wine_sales": 0.0,
            "timestamp": self._extract_timestamp(text),
        }

        # Extract line items
        items = self._extract_line_items(lines)
        result["items"] = items

        # Identify wine items
        wine_items = [item for item in items if item.get("is_wine")]
        result["wine_items"] = wine_items

        # Calculate wine sales
        result["wine_sales"] = sum(item["price"] for item in wine_items)

        # Extract totals
        result["subtotal"] = self._extract_subtotal(text)
        result["tax"] = self._extract_tax(text)
        result["tip"] = self._extract_tip(text)
        result["total"] = self._extract_total(text)

        # If no subtotal found, calculate from items
        if not result["subtotal"] and items:
            result["subtotal"] = sum(item["price"] for item in items)

        # If no total found, calculate
        if not result["total"]:
            result["total"] = result["subtotal"] + result["tax"] + result["tip"]

        return result

    def _extract_line_items(self, lines: List[str]) -> List[Dict]:
        """
        Extract individual line items from receipt

        Common patterns:
        - "[Item Name] [Qty] x [Price] = [Total]"
        - "[Qty] [Item Name] [Price]"
        - "[Item Name] [Price]"
        """
        items = []

        # Wine keywords for identification
        wine_keywords = [
            "wine",
            "red",
            "white",
            "sparkling",
            "champagne",
            "prosecco",
            "chardonnay",
            "cabernet",
            "merlot",
            "pinot",
            "sauvignon",
            "bottle",
            "glass",
            "btl",
            "gl",
        ]

        for line in lines:
            # Skip header/footer lines
            if any(
                skip in line.lower()
                for skip in [
                    "receipt",
                    "thank you",
                    "total",
                    "subtotal",
                    "tax",
                    "server",
                    "table",
                    "check",
                    "bill",
                    "date",
                    "time",
                ]
            ):
                continue

            # Pattern 1: Item with price at end
            # e.g., "Caymus Cabernet 2019 - Glass  $18.00"
            pattern1 = r"(.+?)\s+[\$]?([\d,]+\.?\d{0,2})$"
            match = re.search(pattern1, line)

            if match:
                item_name = match.group(1).strip()
                price_str = match.group(2).replace(",", "")

                try:
                    price = float(price_str)

                    # Determine if wine item
                    is_wine = any(
                        keyword in item_name.lower() for keyword in wine_keywords
                    )

                    # Extract quantity if present
                    qty_match = re.search(
                        r"(\d+)\s*x\s*[\$]?([\d,]+\.?\d{0,2})", item_name
                    )
                    if qty_match:
                        quantity = int(qty_match.group(1))
                        item_name = re.sub(
                            r"\d+\s*x\s*[\$]?[\d,]+\.?\d{0,2}", "", item_name
                        ).strip()
                    else:
                        quantity = 1

                    items.append(
                        {
                            "item_name": item_name,
                            "quantity": quantity,
                            "price": price,
                            "is_wine": is_wine,
                            "raw_line": line,
                        }
                    )

                except (ValueError, InvalidOperation):
                    continue

        return items

    def _extract_total(self, text: str) -> float:
        """Extract total amount from check"""
        patterns = [
            r"total\s*:?\s*[\$]?([\d,]+\.?\d{0,2})",
            r"amount\s+due\s*:?\s*[\$]?([\d,]+\.?\d{0,2})",
            r"balance\s*:?\s*[\$]?([\d,]+\.?\d{0,2})",
            r"grand\s+total\s*:?\s*[\$]?([\d,]+\.?\d{0,2})",
        ]

        return self._extract_amount(text, patterns)

    def _extract_subtotal(self, text: str) -> float:
        """Extract subtotal amount"""
        patterns = [
            r"subtotal\s*:?\s*[\$]?([\d,]+\.?\d{0,2})",
            r"sub\s+total\s*:?\s*[\$]?([\d,]+\.?\d{0,2})",
        ]

        return self._extract_amount(text, patterns)

    def _extract_tax(self, text: str) -> float:
        """Extract tax amount"""
        patterns = [
            r"tax\s*:?\s*[\$]?([\d,]+\.?\d{0,2})",
            r"sales\s+tax\s*:?\s*[\$]?([\d,]+\.?\d{0,2})",
        ]

        return self._extract_amount(text, patterns)

    def _extract_tip(self, text: str) -> float:
        """Extract tip amount"""
        patterns = [
            r"tip\s*:?\s*[\$]?([\d,]+\.?\d{0,2})",
            r"gratuity\s*:?\s*[\$]?([\d,]+\.?\d{0,2})",
        ]

        return self._extract_amount(text, patterns)

    def _extract_amount(self, text: str, patterns: List[str]) -> float:
        """Extract amount using regex patterns"""
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                try:
                    return float(match.group(1).replace(",", ""))
                except (ValueError, InvalidOperation):
                    continue
        return 0.0

    def _extract_timestamp(self, text: str) -> Optional[str]:
        """Extract transaction timestamp"""
        # Date patterns
        date_patterns = [
            r"(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})",
            r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2},?\s+\d{4}",
        ]

        # Time patterns
        time_patterns = [r"(\d{1,2}:\d{2}\s*(?:am|pm)?)", r"(\d{1,2}:\d{2}:\d{2})"]

        date_str = None
        time_str = None

        for pattern in date_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                date_str = match.group(1)
                break

        for pattern in time_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                time_str = match.group(1)
                break

        if date_str and time_str:
            return f"{date_str} {time_str}"
        elif date_str:
            return date_str

        return None

    def _calculate_profit_margin(self, wine_sales: float, wine_cost: float) -> float:
        """
        Calculate profit margin percentage

        Formula: ((Sales - Cost) / Sales) * 100

        Args:
            wine_sales: Total wine sales revenue
            wine_cost: Total wine cost (COGS)

        Returns:
            Profit margin as percentage
        """
        if wine_sales == 0:
            return 0.0

        profit = wine_sales - wine_cost
        margin = (profit / wine_sales) * 100

        return round(margin, 2)

    async def batch_process_checks(self, file_paths: List[str]) -> List[Dict]:
        """
        Process multiple checks in batch

        Args:
            file_paths: List of file paths to process

        Returns:
            List of processing results
        """
        import asyncio

        tasks = [self.process_check(path) for path in file_paths]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Handle exceptions
        processed_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Error processing check {file_paths[i]}: {result}")
                processed_results.append(
                    {"success": False, "error": str(result), "file_path": file_paths[i]}
                )
            else:
                processed_results.append(result)

        return processed_results


# Singleton instance
_check_scanner_service = None


def get_check_scanner_service() -> CheckScannerService:
    """Get singleton instance of CheckScannerService"""
    global _check_scanner_service
    if _check_scanner_service is None:
        _check_scanner_service = CheckScannerService()
    return _check_scanner_service
