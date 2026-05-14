"""
AI Model Client Singletons — Phase 24
======================================
Per AI-SPEC §3: Uses the NEW google-genai SDK (google.genai / genai.Client).
Thread-safe module-level singletons. Both clients are lazy-initialized on first call.

Usage:
    from services.model_clients import get_gemini_client, get_haiku_client
    client = get_gemini_client()
    haiku = get_haiku_client()
"""
from __future__ import annotations

import asyncio
from typing import Optional

try:
    from google import genai
    from google.genai import types as genai_types  # noqa: F401 — re-exported for callers
    _GEMINI_AVAILABLE = True
except ImportError:
    genai = None  # type: ignore
    genai_types = None  # type: ignore
    _GEMINI_AVAILABLE = False

try:
    import anthropic
    _ANTHROPIC_AVAILABLE = True
except ImportError:
    anthropic = None  # type: ignore
    _ANTHROPIC_AVAILABLE = False

from config.settings import Settings
from utils.logger import setup_logger

logger = setup_logger(__name__)

_gemini_client: Optional["genai.Client"] = None
_haiku_client: Optional["anthropic.AsyncAnthropic"] = None

# Haiku concurrency semaphore — max 5 concurrent LLM calls (CONTEXT.md decision).
# NOTE: Semaphore must be created inside a running event loop, NOT at module load time.
# Call get_haiku_semaphore() from within an async context (e.g., agent's initialize()).
_haiku_semaphore: Optional[asyncio.Semaphore] = None


def get_gemini_client() -> "genai.Client":
    """
    Returns the module-level GeminiFlash client singleton.
    Uses NEW google-genai SDK: genai.Client(api_key=...).
    The old SDK used genai.configure() — this module does NOT use that approach.
    """
    global _gemini_client
    if _gemini_client is None:
        if not _GEMINI_AVAILABLE:
            raise ImportError(
                "google-genai package not installed. "
                "Run: pip install 'google-genai>=1.0.0'"
            )
        settings = Settings()
        if not settings.google_api_key:
            logger.warning("GOOGLE_API_KEY not set — Gemini calls will fail")
        _gemini_client = genai.Client(api_key=settings.google_api_key)
        logger.info("GeminiFlash client initialized (google-genai new SDK)")
    return _gemini_client


def get_haiku_client() -> "anthropic.AsyncAnthropic":
    """
    Returns the module-level Haiku async client singleton.
    Uses anthropic.AsyncAnthropic for BaseAgent async context.
    """
    global _haiku_client
    if _haiku_client is None:
        if not _ANTHROPIC_AVAILABLE:
            raise ImportError(
                "anthropic package not installed. "
                "Run: pip install 'anthropic>=0.50.0'"
            )
        settings = Settings()
        if not settings.claude_api_key:
            logger.warning("CLAUDE_API_KEY not set — Haiku calls will fail")
        _haiku_client = anthropic.AsyncAnthropic(api_key=settings.claude_api_key)
        logger.info("Haiku async client initialized")
    return _haiku_client


def get_haiku_semaphore() -> asyncio.Semaphore:
    """
    Returns (or creates) the Haiku concurrency semaphore (max 5 concurrent calls).
    MUST be called from within a running event loop (e.g., from agent's initialize()).
    """
    global _haiku_semaphore
    if _haiku_semaphore is None:
        _haiku_semaphore = asyncio.Semaphore(5)
    return _haiku_semaphore
