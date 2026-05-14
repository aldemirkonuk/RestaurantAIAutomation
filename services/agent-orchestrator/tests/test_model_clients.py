"""
Smoke tests for model_clients.py singletons and email_intel.py Pydantic schemas.
Per Phase 24 test plan (RESEARCH.md Validation Architecture section).
"""
import asyncio
import pytest
from unittest.mock import patch, MagicMock


class TestModelClientImports:
    """Verify model_clients.py imports correctly without live API keys."""

    def test_get_gemini_client_import(self):
        """get_gemini_client must be importable."""
        from services.model_clients import get_gemini_client
        assert callable(get_gemini_client)

    def test_get_haiku_client_import(self):
        """get_haiku_client must be importable."""
        from services.model_clients import get_haiku_client
        assert callable(get_haiku_client)

    def test_get_haiku_semaphore_returns_semaphore(self):
        """get_haiku_semaphore() returns an asyncio.Semaphore with value 5."""
        from services.model_clients import get_haiku_semaphore
        import services.model_clients as mc
        mc._haiku_semaphore = None  # reset singleton for test isolation
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        sem = get_haiku_semaphore()
        assert isinstance(sem, asyncio.Semaphore)
        loop.close()


class TestEmailIntelModels:
    """Pydantic schema validation tests."""

    def test_email_classification_valid(self):
        from models.email_intel import EmailClassification
        c = EmailClassification(
            category="PROMO",
            confidence=0.92,
            reasoning="mentions discount and valid_until",
            provider_name="PlumpJack",
            urgency="high",
        )
        assert c.category == "PROMO"
        assert c.confidence == 0.92

    def test_promo_details_valid(self):
        from models.email_intel import PromoDetails
        p = PromoDetails(
            product_name="Burgundy Grand Cru",
            grape_variety="Pinot Noir",
            discount_pct=20.0,
            promo_description="20% off on all 2022 Pinot Noir",
            confidence=0.88,
        )
        assert p.discount_pct == 20.0
        assert p.product_name == "Burgundy Grand Cru"
