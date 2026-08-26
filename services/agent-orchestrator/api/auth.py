"""
Shared HTTP authentication dependencies
=======================================
ONE scheme, reused — the `X-Admin-Key` check already defined in
`api/health_routes.py:verify_admin_key` (header `X-Admin-Key` vs env
`ADMIN_API_KEY`). This module deliberately does not introduce a second scheme;
it re-exports that dependency and adds exactly one composite dependency for the
single endpoint that legitimately has two kinds of caller.

Why a composite is needed at all
--------------------------------
`POST /api/v1/onboarding/extract` is called from two places:

  1. server-to-server (the NestJS gateway / internal jobs) — carries
     `X-Admin-Key`, the pattern every other protected route here uses; and
  2. the Studio UI **in the browser**
     (apps/web/src/pages/studio/CommandBar.tsx — `studioFetch`), which sends
     `Authorization: Bearer <Supabase JWT>` and has no way to hold an admin
     key. That same component calls `POST /api/v1/studio/sessions` one line
     earlier, which already requires a studio role via
     `services/override_service.py:require_studio_role`.

Requiring only the admin key would have broken the browser path; accepting only
the JWT would have broken the server-to-server path. So the composite accepts
either, and rejects anonymous callers with 401 — which is the whole point: the
endpoint bills the Anthropic account on every call.

Both branches delegate to the existing verifiers. Nothing about the admin-key
semantics is re-implemented here.
"""

from typing import Any, Optional

from fastapi import Header, HTTPException

from api.health_routes import verify_admin_key

__all__ = ["verify_admin_key", "require_admin_or_studio", "STUDIO_INGEST_ROLES"]

# Same role set the Studio UI already needs for POST /api/v1/studio/sessions,
# which it calls immediately before /onboarding/extract. Anything narrower would
# reject callers the studio flow has already admitted.
STUDIO_INGEST_ROLES = ("developer", "certified_contributor", "review_admin")


def require_admin_or_studio(
    x_admin_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
) -> dict[str, Any]:
    """Accept an admin key OR a studio-role Supabase JWT. Reject anonymous.

    Returns a caller descriptor:
        {"kind": "admin",  "subject": "admin-key"}
        {"kind": "studio", "subject": <jwt sub>, "claims": {...}}

    The `subject` is what spend accounting must key on — never a request-body
    field, which the caller controls and can rotate at will.

    Precedence: `X-Admin-Key` wins when present. A caller holding the admin key
    is already trusted server-to-server, and checking it first avoids a pointless
    JWT decode on the gateway's hot path.
    """
    if x_admin_key:
        verify_admin_key(x_admin_key=x_admin_key)
        return {"kind": "admin", "subject": "admin-key"}

    if authorization:
        # Imported lazily: override_service pulls config.settings, and this
        # module is imported from api/onboarding_routes.py which main.py loads
        # before settings are needed.
        from services.override_service import require_studio_role

        claims = require_studio_role(*STUDIO_INGEST_ROLES)(authorization=authorization)
        subject = claims.get("sub")
        if not subject:
            raise HTTPException(status_code=401, detail="Token carries no subject")
        return {"kind": "studio", "subject": subject, "claims": claims}

    raise HTTPException(
        status_code=401,
        detail=(
            "Authentication required: send X-Admin-Key (server-to-server) "
            "or Authorization: Bearer <token> (studio user)"
        ),
    )
