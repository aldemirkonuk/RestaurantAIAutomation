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
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any

from scripts.simulate.payloads import canonical_check, toast_webhook
from scripts.simulate.service import Check

#: The NestJS gateway mounts every controller under a global prefix
#: (`app.setGlobalPrefix("api/v1")` in apps/api-gateway/src/main.ts:36). The
#: controller decorators say `@Controller("pos-hub")`, so reading them alone gives
#: a path that 404s. Found by posting for real — no dry run could have caught it,
#: which is the argument for exercising --apply at least once.
API_PREFIX = "/api/v1"

#: Ingress A — analytics. Idempotent on (restaurant_id, source, external_check_id).
ANALYTICS_PATH = API_PREFIX + "/pos-hub/webhook/generic_webhook/{restaurant_id}"

#: Ingress B — stock movement. Only "toast" is registered in _get_providers().
#: FastAPI sets this prefix on the router itself, so it is already complete.
STOCK_PATH = "/api/v1/pos/webhook/toast"

#: pos_item_mappings upsert, one row per request.
MAPPINGS_PATH = API_PREFIX + "/pos-hub/mappings/{restaurant_id}"


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
    #: 429s absorbed by retrying. Non-zero is fine; it means pacing worked.
    throttled: int = 0
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
    #: Required to --apply against a non-loopback analytics_base/stock_base.
    #:
    #: INCIDENT, 2026-08-05: a local dev script sourced a scratchpad env file to
    #: point the orchestrator at local Supabase before running the simulator.
    #: Between sessions the scratchpad was cleared; `. "$FILE"` on a missing file
    #: fails SILENTLY in bash (no `set -e` in that shell, and sourcing nothing is
    #: not an error), so the orchestrator process fell through to `.env`, which
    #: holds the PRODUCTION Supabase credentials. 311 requests went to
    #: `exzueerziesmczwlhomd.supabase.co` before it was noticed. The simulator
    #: itself posted to `localhost:8000` exactly as configured — the leak was in
    #: a separate, manually-launched process that the simulator had no way to see
    #: or check. 114 decision_log rows and 53 idempotency_keys rows landed in
    #: production (no business table — inventory_lots, restaurant_inventory,
    #: procurement_orders, pos_checks — was touched); all were identified and
    #: deleted the same session.
    #:
    #: This flag is the mitigation on the side that CAN be checked: the HTTP
    #: target the simulator itself calls. It is not a fix for the class of bug
    #: above (a downstream process resolving the wrong config), which needs a
    #: guard in whatever launches that process — see scripts/dev_local_env.sh.
    allow_remote: bool = False

    def wants(self, which: str) -> bool:
        return self.ingress in ("both", which)

    #: Hosts treated as "local" without --allow-remote. IPv6 loopback included
    #: because `curl -6` and some Docker configurations resolve localhost there.
    _LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "0.0.0.0"})

    def assert_targets_are_safe(self) -> None:
        """Refuse to apply against a non-loopback ingress without explicit opt-in."""
        if not self.apply or self.allow_remote:
            return
        for label, base in (("analytics_base", self.analytics_base), ("stock_base", self.stock_base)):
            host = urllib.parse.urlparse(base).hostname or ""
            if host not in self._LOCAL_HOSTS:
                raise RemoteTargetRefusedError(
                    f"--apply refused: {label}={base!r} is not localhost. "
                    "If this is deliberate, pass --allow-remote. If it is not, "
                    "check what set this value — a config file may have silently "
                    "failed to load and fallen back to a default pointing at a "
                    "real deployment (see the 2026-08-05 incident note on this class)."
                )


class RemoteTargetRefusedError(RuntimeError):
    """Raised when --apply would post to a non-loopback host without --allow-remote."""


class Bridge:
    """Posts checks through the production ingresses."""

    def __init__(self, config: BridgeConfig) -> None:
        config.assert_targets_are_safe()
        self.config = config
        self.analytics = IngressResult(
            ingress="analytics",
            url=self.config.analytics_base
            + ANALYTICS_PATH.format(restaurant_id=self.config.restaurant_id),
        )
        self.stock = IngressResult(
            ingress="stock", url=self.config.stock_base + STOCK_PATH
        )
        self.mappings: IngressResult | None = None
        self._unsigned_warned = False

    # -- transport ---------------------------------------------------------

    def _post(
        self,
        url: str,
        body: bytes,
        headers: dict[str, str],
        result: IngressResult,
        *,
        retries: int = 2,
    ) -> None:
        """POST once, retrying only on 429.

        The gateway's limits differ sharply by tier
        (`common/rate-limit/rate-limit.guard.ts:27`): webhooks get 1000/60s, but
        everything else — including the pos_item_mappings upsert — gets 100/60s.
        Seeding 145 mapping rows therefore 429s partway through, and the rows that
        fail are silently the ones never mapped, so wine detection quietly stays
        broken for exactly those wines. Retrying with the server's own retryAfter
        is the honest fix; dropping them is not.

        Nothing else is retried. A 4xx from a malformed payload would be a bug to
        surface, not a transient to paper over.
        """
        for attempt in range(retries + 1):
            request = urllib.request.Request(url, data=body, method="POST")
            request.add_header("Content-Type", "application/json")
            for key, value in headers.items():
                request.add_header(key, value)
            try:
                with urllib.request.urlopen(
                    request, timeout=self.config.timeout
                ) as resp:
                    if 200 <= resp.status < 300:
                        result.posted += 1
                    else:
                        result.note_error(f"HTTP {resp.status}")
                    return
            except urllib.error.HTTPError as exc:
                detail = ""
                try:
                    detail = exc.read().decode("utf-8", "replace")[:200]
                except Exception:
                    pass
                if exc.code == 429 and attempt < retries:
                    result.throttled += 1
                    time.sleep(_retry_after_seconds(exc, detail))
                    continue
                result.note_error(f"HTTP {exc.code} {detail}".strip())
                return
            except urllib.error.URLError as exc:
                result.note_error(f"unreachable: {exc.reason}")
                return
            except Exception as exc:  # noqa: BLE001 — report, never abort the run
                result.note_error(f"{type(exc).__name__}: {exc}")
                return

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

    def seed_mappings(self, rows: list[dict[str, Any]]) -> IngressResult:
        """Upsert pos_item_mappings before any check is posted.

        Must happen first. `PosHubService.ingest` resolves wine per check at
        ingest time, so a mapping that arrives after a check does not
        retroactively reclassify it — the row is already written with
        `is_wine: false` and only a re-post would fix it. Ordering here is the
        difference between a run that measures the pipeline and a run that
        measures the keyword list.
        """
        from scripts.simulate.mappings import to_upsert_body

        result = IngressResult(
            ingress="mappings",
            url=self.config.analytics_base
            + MAPPINGS_PATH.format(restaurant_id=self.config.restaurant_id),
        )
        for row in rows:
            body = to_upsert_body(row)
            if result.sample_payload is None:
                result.sample_payload = body
            if not self.config.apply:
                result.skipped += 1
                continue
            self._post(result.url, _encode(body), {}, result)
        self.mappings = result
        return result

    def send(self, check: Check) -> None:
        """One logical event, both encodings.

        Order matters only for readability of the logs; the two ingresses share no
        state, which is the thing this simulator exists to expose.
        """
        self.send_analytics(check)
        self.send_stock(check)

    # -- reporting ---------------------------------------------------------

    def summary(self) -> dict[str, Any]:
        summary = {
            "applied": self.config.apply,
            "ingress": self.config.ingress,
            "analytics": _result_dict(self.analytics),
            "stock": _result_dict(self.stock),
        }
        if self.mappings is not None:
            summary["mappings"] = _result_dict(self.mappings)
        return summary


def _retry_after_seconds(exc: Any, detail: str, *, default: float = 5.0) -> float:
    """Honour the server's own backoff hint.

    The guard returns `retryAfter` in the JSON body and may also set the standard
    header. Capped so a misconfigured window cannot stall a run for an hour.
    """
    header = getattr(exc, "headers", None)
    raw = header.get("Retry-After") if header else None
    if not raw:
        match = re.search(r'"retryAfter"\s*:\s*(\d+)', detail or "")
        raw = match.group(1) if match else None
    try:
        return max(0.5, min(float(raw), 90.0))
    except (TypeError, ValueError):
        return default


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
        "throttled": result.throttled,
        "errors": result.errors,
    }
