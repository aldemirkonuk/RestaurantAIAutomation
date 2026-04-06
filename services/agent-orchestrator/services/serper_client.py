"""
Serper API Client
=================
Thin async httpx wrapper for https://google.serper.dev/search.
No SDK — Serper has no official Python SDK; httpx is the correct choice.

Cost: $0.001/query (Serper Starter plan, verified 2026-04-06 — NOT $0.005).
Reference: serper.dev/pricing

Returns the top `num_results` organic results. Each result has:
  title   : str  — page title
  link    : str  — URL
  snippet : str  — text excerpt (200–400 chars; sufficient for concordance)
  position: int  — rank in Google results

IMPORTANT: snippet content is sufficient for Phase 8 concordance checks.
Full page fetching (Playwright) is Phase 12's fetch-verify step — do NOT add it here.
"""

import logging
from typing import Optional, TypedDict

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from config.settings import get_settings

logger = logging.getLogger(__name__)


class SerperResult(TypedDict):
    """Shape of a single organic search result from Serper API."""
    title: str
    link: str
    snippet: str
    position: int


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    reraise=True,
)
async def serper_search(
    query: str,
    num_results: int = 5,
    api_key: Optional[str] = None,
) -> list[SerperResult]:
    """
    Execute a Google web search via Serper API.

    Args:
        query:       Search query string, e.g. "Domaine Leflaive Puligny-Montrachet 2019"
        num_results: Maximum organic results to return (default 5 per WSRCH-01 spec).
        api_key:     Serper API key (defaults to settings.serper_api_key).

    Returns:
        List of SerperResult dicts (title, link, snippet, position).
        Returns empty list on empty organic results — never raises on 200 response.

    Raises:
        httpx.HTTPStatusError: On 4xx/5xx from Serper (triggers tenacity retry).
        httpx.TimeoutException: On timeout after 10s (triggers tenacity retry).
    """
    settings = get_settings()
    key = api_key or settings.serper_api_key
    if not key:
        logger.warning("serper_search: SERPER_API_KEY not configured — returning empty results")
        return []

    url = "https://google.serper.dev/search"
    headers = {
        "X-API-KEY": key,
        "Content-Type": "application/json",
    }
    payload = {"q": query, "num": num_results}

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()

    organic = data.get("organic", [])
    results: list[SerperResult] = []
    for item in organic[:num_results]:
        results.append(
            SerperResult(
                title=item.get("title", ""),
                link=item.get("link", ""),
                snippet=item.get("snippet", ""),
                position=item.get("position", 0),
            )
        )
    logger.debug(
        "serper_search: query=%r returned %d results", query, len(results)
    )
    return results
