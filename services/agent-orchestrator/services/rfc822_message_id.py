"""One stored shape for an RFC 5322 Message-ID: ``<id-left@id-right>``.

Angle brackets kept, white space dropped, case kept. The gateway has the same
rule in ``apps/api-gateway/src/communications/rfc822-message-id.ts`` and the
backfill ``20270625100000`` has it in SQL; change all three together. That
file says why the brackets stay: the wire needs them, and every source
(Gmail's API, nodemailer, Postmark's header, both minting functions) already
writes them.
"""

from __future__ import annotations

import re
from typing import List, Optional

_BRACKETED = re.compile(r"<([^<>]*[^<>\s][^<>]*)>")
_OUTER_SPACE = re.compile(r"^\s+|\s+$")
_EDGES = re.compile(r"^[\s<>]+|[\s<>]+$")
_FIRST_TOKEN = re.compile(r"^[^<>\s]+")


def canonical_message_id(value: object) -> Optional[str]:
    """The stored shape of a Message-ID header value, or None when it holds no id.

    ``<a@b>``, `` a@b ``, ``<a@b`` and ``x <a@b> <c@d>`` all give ``<a@b>``.
    White space inside the brackets is kept except at the ends, so an obsolete
    quoted id-left (``<"a b"@x>``) stays whole.
    """
    if not isinstance(value, str):
        return None
    bracketed = _BRACKETED.search(value)
    if bracketed:
        return f"<{_OUTER_SPACE.sub('', bracketed.group(1))}>"
    bare = _FIRST_TOKEN.match(_EDGES.sub("", value))
    return f"<{bare.group(0)}>" if bare else None


def message_id_variants(value: object) -> List[str]:
    """Both shapes a stored row may hold for this id: ``<id>`` first, then ``id``.

    Rows written before the backfill may hold either, so a lookup that compares
    a Message-ID matches ``message_id`` against both.
    """
    canonical = canonical_message_id(value)
    return [canonical, canonical[1:-1]] if canonical else []


def message_ids_in(header_value: object) -> List[str]:
    """Every id in an In-Reply-To or References value, canonical, in order, once each.

    A token that is neither ``<...>`` nor a bare run is skipped.
    """
    if not isinstance(header_value, str):
        return []
    found: List[str] = []
    for token in re.findall(r"<[^<>]*>|[^\s<>]+", header_value):
        canonical = canonical_message_id(token)
        if canonical and canonical not in found:
            found.append(canonical)
    return found
