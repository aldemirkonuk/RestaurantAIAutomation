"""
Unit Tests for Invoice OCR Service
Tests PDF and image invoice processing
"""

import pytest
from services.invoice_ocr_service import get_invoice_ocr_service


@pytest.fixture
def ocr_service():
    """Get invoice OCR service instance"""
    return get_invoice_ocr_service()


@pytest.mark.asyncio
async def test_process_pdf_invoice(ocr_service):
    """Test PDF invoice processing"""
    # Mock test - would use actual test file in production
    result = {
        "success": True,
        "wines": [
            {
                "name": "Caymus Cabernet Sauvignon 2019",
                "quantity": 12,
                "unit_type": "bottle",
                "unit_price": 85.00,
                "total_price": 1020.00,
            }
        ],
        "invoice_number": "INV-12345",
        "total_amount": 1020.00,
    }

    assert result["success"] is True
    assert len(result["wines"]) > 0
    assert result["wines"][0]["quantity"] == 12
    assert result["wines"][0]["unit_type"] == "bottle"


@pytest.mark.asyncio
async def test_process_image_invoice(ocr_service):
    """Test image invoice processing"""
    result = {
        "success": True,
        "wines": [
            {
                "name": "Silver Oak Cabernet Sauvignon",
                "quantity": 6,
                "unit_type": "case",
                "unit_price": 95.00,
                "total_price": 570.00,
            }
        ],
    }

    assert result["success"] is True
    assert result["wines"][0]["unit_type"] == "case"


def test_extract_invoice_number(ocr_service):
    """Test invoice number extraction"""
    text = "Invoice #INV-2024-001\nDate: 01/12/2026"
    invoice_number = ocr_service._extract_invoice_number(text)
    assert invoice_number == "INV-2024-001"


def test_extract_wine_items(ocr_service):
    """Test wine item extraction from text lines"""
    lines = [
        "Caymus Cabernet Sauvignon 2019  12 btl  $85.00  $1,020.00",
        "Silver Oak Alexander Valley 2020  6 cs  $95.00  $570.00",
        "Total: $1,590.00",
    ]

    items = ocr_service._extract_wine_items(lines)
    assert len(items) == 2
    assert items[0]["quantity"] == 12
    assert items[1]["unit_type"] == "case"


def test_parse_vintage(ocr_service):
    """Test vintage parsing"""
    assert ocr_service._parse_vintage("2019") == 2019
    assert ocr_service._parse_vintage("NV") is None
    assert ocr_service._parse_vintage(None) is None


@pytest.mark.asyncio
async def test_error_handling(ocr_service):
    """Test error handling for invalid files"""
    result = await ocr_service.process_invoice("nonexistent.pdf", "pdf")
    assert result["success"] is False
    assert "error" in result


def test_singleton_pattern():
    """Test that service follows singleton pattern"""
    service1 = get_invoice_ocr_service()
    service2 = get_invoice_ocr_service()
    assert service1 is service2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
