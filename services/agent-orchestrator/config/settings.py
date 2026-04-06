"""
Application Settings
====================
Lazy-loaded settings with environment variable support.
Supabase client is optional — returns None if not configured.
"""

import os
from functools import lru_cache
from typing import Optional


class Settings:
    """Application settings loaded from environment variables."""

    def __init__(self):
        self.claude_api_key: Optional[str] = os.getenv("CLAUDE_API_KEY")
        self.supabase_url: Optional[str] = os.getenv("SUPABASE_URL")
        self.supabase_key: Optional[str] = (
            os.getenv("SUPABASE_SERVICE_KEY")
            or os.getenv("SUPABASE_KEY")
            or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        )
        self._supabase_client = None
        # YOLO Preview Model (Phase 3) — per D-06
        self.yolo_model_path: str = os.getenv(
            "YOLO_MODEL_PATH",
            "datasets/wine_menus_2class/runs/train2/weights/best.pt",
        )
        self.cv_menu_model_path: str = self.yolo_model_path   # alias used by scan_routes.py
        self.cv_yolov8_mock_mode: bool = False                # D-07: no mock for YOLO path
        # Agent config used by _get_menu_agent() in scan_routes.py
        self.google_api_key: Optional[str] = os.getenv("GOOGLE_API_KEY")
        self.cv_ocr_languages: str = os.getenv("CV_OCR_LANGUAGES", "en")
        self.mock_llm: bool = os.getenv("MOCK_LLM", "false").lower() == "true"
        # Email credentials for cost alerts (Phase 5 — COST-02, COST-03)
        self.manager_email: Optional[str] = os.getenv("MANAGER_EMAIL")
        self.gmail_user: Optional[str] = os.getenv("GMAIL_USER")
        self.gmail_password: Optional[str] = os.getenv("GMAIL_PASSWORD")
        # Celery broker/backend (Phase 4+ background tasks)
        self.celery_broker_url: str = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
        self.celery_backend_url: str = os.getenv("CELERY_BACKEND_URL", "redis://localhost:6379/1")
        # Web Search Verification (Phase 8 — WSRCH-01, WSRCH-08)
        self.serper_api_key: Optional[str] = os.getenv("SERPER_API_KEY")
        self.web_search_daily_budget_usd: float = float(
            os.getenv("WEB_SEARCH_DAILY_BUDGET_USD", "5.0")
        )
        # Serper Starter plan: $0.001/query — NOT $0.005 (Pitfall 5, RESEARCH.md)
        self.serper_cost_per_query: float = 0.001

    @property
    def supabase_client(self):
        """Lazy-init Supabase client. Returns None if not configured."""
        if self._supabase_client is None and self.supabase_url and self.supabase_key:
            try:
                from supabase import create_client
                self._supabase_client = create_client(self.supabase_url, self.supabase_key)
            except Exception:
                pass
        return self._supabase_client


@lru_cache()
def get_settings() -> Settings:
    """Return cached Settings instance."""
    return Settings()
