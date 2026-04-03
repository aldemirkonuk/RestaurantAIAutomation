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
