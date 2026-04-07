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
        # Phase 11: max concurrent restaurant re-crawl tasks per beat run
        self.recrawl_max_concurrent: int = int(os.getenv("RECRAWL_MAX_CONCURRENT", "10"))
        # Web Search Verification (Phase 8 — WSRCH-01, WSRCH-08)
        self.serper_api_key: Optional[str] = os.getenv("SERPER_API_KEY")
        self.web_search_daily_budget_usd: float = float(
            os.getenv("WEB_SEARCH_DAILY_BUDGET_USD", "5.0")
        )
        # Serper Starter plan: $0.001/query — NOT $0.005 (Pitfall 5, RESEARCH.md)
        self.serper_cost_per_query: float = 0.001
        # Phase 12: Research agent settings
        # Budget math (12-CONTEXT.md Decision 4, corrected 2026-04-06):
        #   raw_ceiling = (0.001×8) + (0.0001×8) + (0.001×4) = $0.0128
        #   BUDGET_PER_RECORD_MAX = 0.0128 × 3.0 safety_factor = $0.0384 → $0.04
        #   records_per_day_min = floor($5.00 / $0.04) = 125 records/day guaranteed
        self.research_daily_budget_usd: float = float(
            os.getenv("RESEARCH_DAILY_BUDGET_USD", "5.0")
        )
        self.research_max_cost_per_record_usd: float = float(
            os.getenv("RESEARCH_MAX_COST_PER_RECORD_USD", "0.04")
        )
        self.research_max_calls_per_record: int = int(
            os.getenv("RESEARCH_MAX_CALLS_PER_RECORD", "8")
        )
        self.research_eligibility_cooldown_days: int = int(
            os.getenv("RESEARCH_ELIGIBILITY_COOLDOWN_DAYS", "7")
        )
        self.research_fetch_verify_enabled: bool = (
            os.getenv("RESEARCH_FETCH_VERIFY_ENABLED", "true").lower() == "true"
        )
        # Phase 12.1: Cascade model routing (D-02)
        self.research_cascade_haiku_model: str = os.getenv(
            "RESEARCH_CASCADE_HAIKU_MODEL", "claude-haiku-4-5-20251001"
        )
        self.research_cascade_flash_model: str = os.getenv(
            "RESEARCH_CASCADE_FLASH_MODEL", "gemini-2.5-flash"
        )
        self.research_cascade_sonnet_model: str = os.getenv(
            "RESEARCH_CASCADE_SONNET_MODEL", "claude-sonnet-4-20250514"
        )
        # Phase 12.1: Entity cache (D-04)
        self.redis_url: Optional[str] = os.getenv("REDIS_URL")
        self.research_cache_wine_ttl_days: int = int(
            os.getenv("RESEARCH_CACHE_WINE_TTL_DAYS", "30")
        )
        self.research_cache_producer_ttl_days: int = int(
            os.getenv("RESEARCH_CACHE_PRODUCER_TTL_DAYS", "90")
        )
        self.research_cache_max_memory_entries: int = int(
            os.getenv("RESEARCH_CACHE_MAX_MEMORY_ENTRIES", "5000")
        )
        # Phase 12.1: Reflexion retry (D-03)
        self.research_max_reflexion_retries: int = int(
            os.getenv("RESEARCH_MAX_REFLEXION_RETRIES", "3")
        )
        # Phase 13: Studio role enforcement
        # SUPABASE_JWT_SECRET is the JWT secret from Supabase project settings (different from service key)
        # Found at: Supabase Dashboard → Settings → API → JWT Secret
        self.supabase_jwt_secret: str = os.getenv("SUPABASE_JWT_SECRET", "")
        # Trust level threshold: certified_contributor auto-promotes after this many consecutive approvals (D-12)
        self.trust_level_threshold: int = int(os.getenv("TRUST_LEVEL_THRESHOLD", "5"))

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
