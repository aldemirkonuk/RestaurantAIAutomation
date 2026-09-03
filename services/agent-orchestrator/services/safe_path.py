"""
Safe Path Segments
==================
Validation for caller-controlled values interpolated into outbound service URLs
(CodeQL py/partial-ssrf).

The Python mirror of `apps/api-gateway/src/common/http/safe-path.ts`, which
already fixed this category on the gateway side. Same shape of defect, same
allowlist, same reasoning — restated here because the orchestrator is reachable
server-to-server in its own right, so it cannot borrow the gateway's validation
by assuming every caller came through the gateway.

The defect: a caller-controlled value dropped into a template string that
becomes a URL.

    f"{base_url}/config/v2/menus/{menu_id}"   with menu_id = "..%2f..%2fadmin"
    → the value is already URL-decoded by the ASGI layer before the route sees
      it, so a real slash arrives inside what was meant to be one segment, and
      the request escapes the path it was supposed to be confined to.

This is an allowlist, not a sanitiser. Stripping `..` invites a rematch on the
next encoding anyone thinks of; requiring the value to look like an identifier
ends the category. `%` is absent from the class, so every percent-encoded
escape fails on the same rule as the literal one.
"""

import re

__all__ = ["SAFE_SEGMENT", "is_safe_path_segment"]

# One path segment: identifiers and GUIDs. No slash, no `%`, no `\`, no `:`.
SAFE_SEGMENT = re.compile(r"^[A-Za-z0-9._~-]+$")


def is_safe_path_segment(segment: object) -> bool:
    """True when `segment` can only be a single, literal path segment.

    Rejects `.` and `..` explicitly — both match the character class but
    traverse. Length is capped for the same reason the gateway caps it: an
    unbounded segment is its own denial-of-service against whatever parses it.
    """
    if not isinstance(segment, str):
        return False
    if len(segment) == 0 or len(segment) > 256:
        return False
    if segment in (".", ".."):
        return False
    return bool(SAFE_SEGMENT.match(segment))
