"""
SSRF-safe outbound image fetching.

Why this exists
---------------
`POST /api/v1/scan/wine` and `POST /api/v1/scan/menu` accept a field named
`image_base64` typed as a plain `Optional[str]`. Nothing validates that it is
base64. The agent then does::

    image_source = image_data or image_url
    if image_source.startswith("http"):
        response = await client.get(image_source)

so a caller who posts ``{"image_base64": "http://169.254.169.254/latest/..."}``
gets the orchestrator to issue that request from inside the deployment network
and hands back the failure/success signal. The field *name* is the only thing
suggesting base64; the code branches on the *value*. Neither scan router
carries an auth dependency.

What this module enforces
-------------------------
1. Scheme must be http/https (no file://, gopher://, ftp://).
2. Every resolved IP for the host must be publicly routable — loopback,
   private, link-local (incl. 169.254.169.254), CGNAT, multicast and reserved
   ranges are refused, for both IPv4 and IPv6.
3. Redirects are followed manually, and *every hop* is re-validated. Following
   redirects inside httpx would let a public host 302 to the metadata service.
4. Responses are size-capped and time-bounded so a hostile endpoint cannot
   stream forever into memory.

The check is done on the addresses the name actually resolves to, immediately
before the request. That still leaves a DNS-rebinding window; closing it fully
requires pinning the connection to the validated IP, which httpx cannot express
per-request. The residual risk is recorded in ADR 0098 rather than left implied
by silence.
"""

from __future__ import annotations

import ipaddress
import socket
from typing import Iterable
from urllib.parse import urlparse

# httpx is imported inside fetch_image_bytes, not here, so that the validation
# layer (assert_url_is_safe / _is_public) imports with the standard library
# alone. That keeps the guard testable in any environment -- including the
# bare-checkout CI job that re-verifies decision claims -- rather than only
# where the service's full dependency set is installed. A guard you can only
# run where everything is installed is a guard that stops being run.

__all__ = [
    "SsrfBlocked",
    "assert_url_is_safe",
    "is_url_safe",
    "fetch_image_bytes",
]

# 10 MiB. Menu photographs from phone cameras land well under this; anything
# larger is either a mistake or an attempt to exhaust the worker's memory.
MAX_IMAGE_BYTES = 10 * 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 10.0
MAX_REDIRECTS = 3


class SsrfBlocked(ValueError):
    """Raised when a URL is refused before any network request is made."""


def _resolved_addresses(host: str) -> Iterable[ipaddress._BaseAddress]:
    """Every IP the host resolves to, as ip_address objects."""
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise SsrfBlocked(f"Cannot resolve host: {host}") from exc

    seen = set()
    for info in infos:
        addr = info[4][0]
        # IPv6 results can carry a scope suffix (fe80::1%eth0).
        addr = addr.split("%", 1)[0]
        if addr not in seen:
            seen.add(addr)
            yield ipaddress.ip_address(addr)


def _is_public(ip: ipaddress._BaseAddress) -> bool:
    """
    True only for addresses that are routable on the public internet.

    `is_global` already excludes loopback/private/link-local/reserved for both
    families. The explicit checks below are belt-and-braces for the ranges that
    matter most here and for IPv4-mapped IPv6 (::ffff:169.254.169.254), which
    `is_global` evaluates against the v6 rules rather than the embedded v4.
    """
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    if (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    ):
        return False
    return ip.is_global


def assert_url_is_safe(url: str) -> None:
    """Raise SsrfBlocked unless `url` is an http(s) URL on a public address."""
    parsed = urlparse(url)

    if parsed.scheme not in ("http", "https"):
        raise SsrfBlocked(f"Refusing non-HTTP scheme: {parsed.scheme or '(none)'}")

    host = parsed.hostname
    if not host:
        raise SsrfBlocked("Refusing URL with no host")

    for ip in _resolved_addresses(host):
        if not _is_public(ip):
            raise SsrfBlocked(
                f"Refusing request to non-public address {ip} (host {host})"
            )


def is_url_safe(url: str) -> bool:
    """
    Boolean form of `assert_url_is_safe`, for callers that want to branch
    rather than handle an exception (and for the decision-claim check, which
    must express the whole guard as one expression).
    """
    try:
        assert_url_is_safe(url)
        return True
    except SsrfBlocked:
        return False


async def fetch_image_bytes(
    url: str,
    *,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    max_bytes: int = MAX_IMAGE_BYTES,
) -> bytes:
    """
    Fetch `url` with SSRF and size guards, returning the raw body.

    Redirects are resolved here (not by httpx) so each hop is validated.
    """
    import httpx

    current = url
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        for _ in range(MAX_REDIRECTS + 1):
            assert_url_is_safe(current)
            response = await client.get(current)

            if response.is_redirect:
                location = response.headers.get("location")
                if not location:
                    raise SsrfBlocked("Redirect without Location header")
                # Relative redirects must be resolved against the current URL
                # before they can be validated.
                current = str(httpx.URL(current).join(location))
                continue

            response.raise_for_status()
            body = response.content
            if len(body) > max_bytes:
                raise SsrfBlocked(
                    f"Image exceeds {max_bytes} byte cap ({len(body)} bytes)"
                )
            return body

    raise SsrfBlocked(f"Too many redirects (>{MAX_REDIRECTS})")
