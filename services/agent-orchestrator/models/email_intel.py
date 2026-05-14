"""
Pydantic models for Phase 24 email intelligence pipeline.
Per AI-SPEC §4b — all LLM outputs must be parsed against these schemas.
"""
from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel, Field


class EmailClassification(BaseModel):
    """Output schema for GeminiFlash email classification step."""

    category: Literal["OPERATIONAL", "PROMO", "NOISE"]
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str
    provider_name: Optional[str] = None
    urgency: Literal["low", "medium", "high"] = "low"


class PromoDetails(BaseModel):
    """Output schema for Haiku PROMO extraction step."""

    product_name: str
    grape_variety: Optional[str] = None
    region: Optional[str] = None
    discount_pct: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    discount_fixed: Optional[float] = Field(default=None, ge=0.0)
    valid_until: Optional[str] = None  # ISO 8601 date string, e.g. "2026-06-01"
    min_quantity: Optional[int] = Field(default=None, ge=1)
    promo_description: str
    conditions: Optional[str] = None
    confidence: float = Field(ge=0.0, le=1.0)
