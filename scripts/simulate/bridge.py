"""Transport: one simulated check, posted to both ingresses.

Dry run is the default and is genuinely side-effect-free — it opens no socket. It
builds every payload, computes every signature, and reports what it would have
sent, so the whole encoding path is exercisable with no infrastructure running.

Signing is real. `ToastAdapter.verify_webhook` fails OPEN when no secret is
configured, so an unsigned simulator would pass and leave the HMAC path untested
forever. We compute the signature the adapter's own algorithm computes —
`hmac_sha256(secret, raw_body).hexdigest()`, compared case-insensitively against
the `Toast-Signature` header — over the EXACT bytes we put on the wire. Re-serialising
JSON between signing and sending changes spacing and key order and produces a
valid-looking signature that fails, which is the bug BUG-05 was filed for on the
receiving side.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

from scripts.simulate.payloads import canonical_check, toast_webhook
from scripts.simulate.service import Check

#: Ingress A — analytics. Idempotent on (restaurant_id, source, external_check_id).
ANALYTICS_PATH = "/pos-hub/webhook/generic_webhook/{restaurant_id}"

#: Ingress B — stock movement. Only "toast" is registered in _get_providers().
STOCK_PATH = "/api/v1/pos/webhook/toast"


def sign_toast(secret: str, body: bytes) -> str:
    """Reproduce ToastAdapter.verify_webhook's algorithm exactly.

    That method compares `hmac.new(secret, raw, sha256).hexdigest()` against
    `signature.lower()`, so a lowercase hex digest is what it expects.
    """
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


@dataclass
class IngressResult:
    ingress: str
    url: str
    posted: int = 0
    failed: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)
    #: Set on dry runs so the caller can show a payload without sending it.
    sample_payload: dict[str, Any] | None = None

    def note_error(self, message: str) -> None:
        self.failed += 1
        # Bounded: a dead endpoint would otherwise accumulate one string per check
        # across a 60-day run and dominate the report.
        if len(self.errors) < 8:
            self.errors.append(message)


@dataclass
class BridgeConfig:
    restaurant_id: str
    #: Toast's own restaurant identifier. Distinct from restaurant_id: the former
    #: is ours, the latter is the POS's, and conflating them is how a webhook ends
    #: up attributed to the wrong tenant.
    restaurant_guid: str
    analytics_base: str = "http://localhost:3001"
    stock_base: str = "http://localhost:8000"
    toast_secret: str = ""
    timeout: float = 10.0
    #: "both" | "analytics" | "stock"
    ingress: str = "both"
    apply: bool = False

    def wants(self, which: str) -> bool:
        return self.ingress in ("both", which)


class Bridge:
    """Posts checks through the production ingresses."""

    def __init__(self, config: BridgeConfig) -> None:
        self.config = config
        self.analytics = IngressResult(
            ingress="analytics",
            url=self.config.analytics_base
            + ANALYTICS_PATH.format(restaurant_id=self.config.restaurant_id),
        )
        self.stock = IngressResult(
            ingress="stock", url=self.config.stock_base + STOCK_PATH
        )
        self._unsigned_warned = False

    # -- transport ---------------------------------------------------------

    def _post(
        self, url: str, body: bytes, headers: dict[str, str], result: IngressResult
    ) -> None:
        request = urllib.request.Request(url, data=body, method="POST")
        request.add_header("Content-Type", "application/json")
        for key, value in headers.items():
            request.add_header(key, value)
        try:
            with urllib.request.urlopen(request, timeout=self.config.timeout) as resp:
                if 200 <= resp.status < 300:
                    result.posted += 1
                else:
                    result.note_error(f"HTTP {resp.status}")
        except urllib.error.HTTPError as exc:
            detail = ""
            try:
                detail = exc.read().decode("utf-8", "replace")[:200]
            except Exception:
                pass
            result.note_error(f"HTTP {exc.code} {detail}".strip())
        except urllib.error.URLError as exc:
            result.note_error(f"unreachable: {exc.reason}")
        except Exception as exc:  # noqa: BLE001 — report, never abort the run
            result.note_error(f"{type(exc).__name__}: {exc}")

    # -- per ingress -------------------------------------------------------

    def send_analytics(self, check: Check) -> None:
        result = self.analytics
        if not self.config.wants("analytics"):
            result.skipped += 1
            return
        # The hub accepts a single check or a list; one per request keeps a failure
        # attributable to a specific check.
        payload = canonical_check(check)
        if result.sample_payload is None:
            result.sample_payload = payload
        if not self.config.apply:
            result.skipped += 1
            return
        self._post(result.url, _encode(payload), {}, result)

    def send_stock(self, check: Check) -> None:
        result = self.stock
        if not self.config.wants("stock"):
            result.skipped += 1
            return
        payload = toast_webhook(check, self.config.restaurant_guid)
        # Sign the exact bytes that go on the wire — see the module docstring.
        body = _encode(payload)
        headers: dict[str, str] = {}
        if self.config.toast_secret:
            headers["Toast-Signature"] = sign_toast(self.config.toast_secret, body)
        elif not self._unsigned_warned:
            self._unsigned_warned = True
            result.errors.append(
                "TOAST_WEBHOOK_SECRET not set — the adapter fails open, so this run "
                "does NOT exercise signature verification. Set it to test that path."
            )
        if result.sample_payload is None:
            result.sample_payload = payload
        if not self.config.apply:
            result.skipped += 1
            return
        self._post(result.url, body, headers, result)

    def send(self, check: Check) -> None:
        """One logical event, both encodings.

        Order matters only for readability of the logs; the two ingresses share no
        state, which is the thing this simulator exists to expose.
        """
        self.send_analytics(check)
        self.send_stock(check)

    # -- reporting ---------------------------------------------------------

    def summary(self) -> dict[str, Any]:
        return {
            "applied": self.config.apply,
            "ingress": self.config.ingress,
            "analytics": _result_dict(self.analytics),
            "stock": _result_dict(self.stock),
        }


def _encode(payload: dict[str, Any]) -> bytes:
    """Canonical bytes, used for both signing and sending.

    Separators without spaces and sorted keys make the body byte-stable, so a
    signature computed here is reproducible by anything that re-encodes the same
    dict the same way.
    """
    return json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")


def _result_dict(result: IngressResult) -> dict[str, Any]:
    return {
        "url": result.url,
        "posted": result.posted,
        "failed": result.failed,
        "skipped": result.skipped,
        "errors": result.errors,
    }
