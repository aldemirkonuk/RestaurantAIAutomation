"""Thin FastAPI admin wrappers for the synthetic restaurant factory (D-14..D-16).

POST /api/v1/admin/synth/{refresh|generate|teardown}
Header: X-Admin-Key
Body: { "archetype": "bistro"|"all", "apply": false }  # apply defaults false
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(tags=["synth-admin"])


def verify_admin_key(x_admin_key: Optional[str] = Header(None)) -> str:
    """Require X-Admin-Key header matching ADMIN_API_KEY env var."""
    expected = os.getenv("ADMIN_API_KEY", "")
    if not x_admin_key:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Admin-Key")
    if not expected or x_admin_key != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Admin-Key")
    return x_admin_key


class SynthRequest(BaseModel):
    archetype: str = Field(default="all")
    apply: bool = Field(default=False)


def _resolve_ids(archetype: str) -> list[str]:
    from scripts.synth.recipes import UnknownArchetypeError, list_archetypes

    known = list_archetypes()
    if archetype == "all":
        return list(known)
    if archetype not in known:
        raise HTTPException(status_code=400, detail=f"Unknown archetype: {archetype}")
    return [archetype]


@router.post("/api/v1/admin/synth/generate")
async def synth_generate(
    body: SynthRequest,
    _key: str = Depends(verify_admin_key),
) -> dict[str, Any]:
    from scripts.synth.teardown import (
        WriteSetTeardownCoverageError,
        refuse_multi_archetype_apply_unless_ready,
    )

    ids = _resolve_ids(body.archetype)
    if body.apply:
        try:
            refuse_multi_archetype_apply_unless_ready(
                archetypes=ids, apply=True
            )
        except WriteSetTeardownCoverageError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    plans = [apply_seed(aid, apply=bool(body.apply)) for aid in ids]
    return {
        "command": "generate",
        "apply": bool(body.apply),
        "dry_run": not bool(body.apply),
        "archetype_count": len(plans),
        "plans": [
            {
                "archetype_id": p.get("archetype_id"),
                "slug": p.get("slug"),
                "sku_count": p.get("sku_count"),
                "dry_run": p.get("dry_run"),
            }
            for p in plans
        ],
    }


@router.post("/api/v1/admin/synth/teardown")
async def synth_teardown(
    body: SynthRequest | None = None,
    _key: str = Depends(verify_admin_key),
) -> dict[str, Any]:
    apply = bool(body.apply) if body is not None else False
    result = teardown_sim(apply=apply)
    return {"command": "teardown", **result}


@router.post("/api/v1/admin/synth/refresh")
async def synth_refresh(
    body: SynthRequest,
    _key: str = Depends(verify_admin_key),
) -> dict[str, Any]:
    from scripts.synth.snapshots import refresh_snapshot

    ids = _resolve_ids(body.archetype)
    if not body.apply:
        return {
            "command": "refresh",
            "dry_run": True,
            "apply": False,
            "archetypes": ids,
            "note": "pass apply:true to re-crawl/update snapshots",
        }
    results = []
    for aid in ids:
        snap = refresh_snapshot(aid, use_crawler=True)
        results.append(
            {
                "archetype_id": aid,
                "item_count": len(snap.get("items") or []),
                "menu_quality": snap.get("menu_quality"),
            }
        )
    return {"command": "refresh", "apply": True, "results": results}


def apply_seed(*args: Any, **kwargs: Any) -> Any:
    """Thin wrapper — tests patch this; routes call this (not seed.apply_seed directly)."""
    from scripts.synth.seed import apply_seed as _apply

    return _apply(*args, **kwargs)


def teardown_sim(*args: Any, **kwargs: Any) -> Any:
    """Thin wrapper — tests patch this; routes call this (not teardown.teardown_sim directly)."""
    from scripts.synth.teardown import teardown_sim as _td

    return _td(*args, **kwargs)
