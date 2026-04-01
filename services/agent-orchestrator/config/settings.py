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
        self.supabase_key: Optional[str] = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")
        self._supabase_client = None

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
