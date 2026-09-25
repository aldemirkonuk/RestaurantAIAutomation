"""
Sentry Error Tracking Client for FastAPI Agent Orchestrator

Provides centralized error tracking and monitoring:
- Automatic error capture
- Custom error reporting
- User context tracking
- Performance monitoring
"""

import os
import logging
import re
from typing import Optional, Dict, Any
from functools import wraps

# Try to import sentry_sdk, but don't fail if not installed
try:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration
    from sentry_sdk.integrations.logging import LoggingIntegration

    SENTRY_AVAILABLE = True
except ImportError:
    SENTRY_AVAILABLE = False
    sentry_sdk = None

logger = logging.getLogger(__name__)


# Identity fields that must never reach the error tracker. Kept byte-identical
# with PII_USER_KEYS in apps/web/src/lib/error-tracking.ts and
# apps/api-gateway/src/common/error-tracking/sentry.service.ts —
# scripts/check_sentry_pii_scope.py fails the build if the three drift.
#
# `id` and restaurant_id survive on purpose: they are UUIDs that mean nothing
# outside our own database, so an issue stays routable to an account without
# Sentry holding an identity.
PII_USER_KEYS = ("email", "username", "name", "ip_address")

# Identity keys stripped from every *free-form* container an event can carry
# (`extra`, `request.data`, each entry of `contexts`). Wider than
# PII_USER_KEYS because these bags are assembled ad hoc by callers and nothing
# types them. Kept byte-identical with PII_KEYS in the two TypeScript scrubbers.
PII_KEYS = (
    "email",
    "name",
    "username",
    "first_name",
    "last_name",
    "phone",
    "phone_number",
    "ip_address",
    "address",
    "password",
    "ssn",
)
_PII_KEY_SET = frozenset(PII_KEYS)

# Request headers that carry a credential rather than a description.
SENSITIVE_HEADERS = ("authorization", "cookie", "x-api-key", "proxy-authorization")


def _scrub_pii_keys(obj: Any) -> None:
    """
    Drop every PII key from one free-form mapping, in place, case-insensitively.

    Non-dict input is ignored rather than rejected: `before_send` raising would
    drop the event and hide the very error it was reporting.
    """
    if not isinstance(obj, dict):
        return
    for key in list(obj):
        if isinstance(key, str) and key.lower() in _PII_KEY_SET:
            obj.pop(key, None)


# OpenTelemetry attaches its own copy of the request URL here, independent of
# `event["request"]`: `contexts["trace"]["data"]` and each span's own "data"
# carry "url"/"http.url"/"http.target"/"http.query" (and similar) regardless
# of what request["url"] says. `_scrub_pii_keys`'s key-name pass over contexts
# never reaches these because "data" is not a PII key name -- confirmed live
# by PR #427's own round-2 audit, which found the calendar feed token and the
# inbound-webhook secret both survived here after request["url"] was already
# fixed. Query-only keys are dropped entirely, matching the founder's ruling
# already applied to request["query_string"]; URL/path keys go through
# scrub_url, which redacts a path-borne token and drops any query it still has.
# "http.fragment" joined 2026-09-25 (PR #427 round 3): sentry_sdk's httpx and
# stdlib integrations set it beside "http.query" with sanitize=False, and the
# http-client breadcrumb is built from the same span data.
_SPAN_DATA_QUERY_KEYS = ("url.query", "http.query", "http.fragment")
_SPAN_DATA_URL_KEYS = ("url", "url.full", "url.path", "http.url", "http.target")


def _scrub_span_data(data: Any) -> None:
    """Strip the same URL-shaped keys from one span/trace `data` dict, in place."""
    if not isinstance(data, dict):
        return
    for key in _SPAN_DATA_QUERY_KEYS:
        data.pop(key, None)
    for key in _SPAN_DATA_URL_KEYS:
        value = data.get(key)
        if isinstance(value, str):
            data[key] = scrub_url(value)


# Route prefixes whose NEXT path segment is a credential. Enumerates ROUTES that
# bear a secret, not parameter names. Still an allow-list, so it does not stand
# alone: scripts/check_sentry_pii_scope.py enumerates every @Public() gateway
# route whose path parameter is named like a credential and FAILS THE BUILD if
# one is not covered. The gateway entries were found by PR #427's own security
# audit, which blocked the first version of this fix for missing them.
TOKEN_PATH_PREFIXES = (
    "/invite/",
    # DELETE /restaurants/:id/invites/:code -- the SAME organization_invites.code
    # column as /auth/invite/. Found by PR #427's correctness audit: it leaks
    # exactly when the revoke FAILED, while the invite is still live.
    "/invites/",
    "/studio/invite/",
    "/devices/",  # DELETE /mobile/devices/:token -- a push-send capability
    "/calendar/feed/",
    "/digest/unsubscribe/",
)


def scrub_url(raw: str) -> str:
    """
    The URL as Sentry may keep it: origin and path, with a path-borne credential
    replaced and the query gone. Founder ruling 2026-09-21.

    Only the ONE segment after the prefix is replaced, so `/auth/invite/<code>/accept`
    keeps `/accept`. Over-redaction is the safe direction.

    A plain string cut, never urlparse: this runs inside `before_send` on an error
    path and must not raise a second failure, and it must work on a relative URL.
    """
    path = raw
    for sep in ("?", "#"):
        cut = path.find(sep)
        if cut != -1:
            path = path[:cut]
    for prefix in TOKEN_PATH_PREFIXES:
        at = path.find(prefix)
        if at == -1:
            continue
        start_of_seg = at + len(prefix)
        next_slash = path.find("/", start_of_seg)
        tail = "" if next_slash == -1 else path[next_slash:]
        return path[:start_of_seg] + "<redacted>" + tail
    return path


# Free text as Sentry may keep it: scrub_url's two rules, applied where a URL
# sits INSIDE a sentence rather than being the whole field. Any query or
# fragment carrying a key=value is removed wherever it sits (a bare ?/# is left
# alone), and the one segment after every TOKEN_PATH_PREFIXES occurrence is
# replaced. PR #427 round 3 (2026-09-25). Kept identical in all three runtimes.
#
# The load-bearing case here is httpx's own INFO log line, which
# LoggingIntegration(level=INFO) turns into a breadcrumb MESSAGE:
#   HTTP Request: GET https://<ref>.supabase.co/rest/v1/studio_invites?select=*&token=eq.<token> ...
# (api/studio_routes.py looks a studio invite up by its token), and an
# httpx.HTTPStatusError's own message, which quotes the full URL with its query.
_TEXT_QUERY_RE = re.compile(r"[?#][^\s'\"<>`]*=[^\s'\"<>`]*")
_TEXT_TOKEN_SEGMENT_RES = tuple(
    (prefix, re.compile(re.escape(prefix) + r"[^/\s?#'\"<>`]+"))
    for prefix in TOKEN_PATH_PREFIXES
)


def scrub_text(raw: str) -> str:
    """Redact a query and a path-borne credential wherever they sit in text."""
    out = _TEXT_QUERY_RE.sub("", raw)
    for prefix, pattern in _TEXT_TOKEN_SEGMENT_RES:
        out = pattern.sub(prefix + "<redacted>", out)
    return out


# A navigation breadcrumb keeps its URLs in "from"/"to"; an http one uses the
# same keys as span data ("url", "http.query", "http.fragment").
_BREADCRUMB_URL_KEYS = ("from", "to")


def _scrub_breadcrumbs(crumbs: Any) -> None:
    """
    Scrub every breadcrumb in place: its message, and its data the way span data
    is scrubbed. sentry_sdk nests the list as {"values": [...]}; a hand-built
    event may carry the bare list. Breadcrumbs were scrubbed in the web runtime
    only until PR #427 round 3 (2026-09-25).
    """
    if isinstance(crumbs, dict):
        crumbs = crumbs.get("values")
    if not isinstance(crumbs, list):
        return
    for crumb in crumbs:
        if not isinstance(crumb, dict):
            continue
        message = crumb.get("message")
        if isinstance(message, str):
            crumb["message"] = scrub_text(message)
        data = crumb.get("data")
        if not isinstance(data, dict):
            continue
        _scrub_span_data(data)
        for key in _BREADCRUMB_URL_KEYS:
            value = data.get(key)
            if isinstance(value, str):
                data[key] = scrub_url(value)
        arguments = data.get("arguments")
        if isinstance(arguments, list):
            data["arguments"] = [
                scrub_text(a) if isinstance(a, str) else a for a in arguments
            ]


def _scrub_strings_deep(value: Any, depth: int = 0) -> Any:
    """
    Every string inside a frame's local variables, however deeply nested.
    sentry_sdk attaches locals by default (include_local_variables); PR #427's
    round-3 wire test found an httpx Request repr and an error message -- both
    quoting the token-bearing URL -- in frames[].vars, and a *bare* token with
    no URL around it that scrub_text alone could not catch. As of round 3
    (founder 2026-09-25) both sentry_sdk.init() call sites in this service set
    include_local_variables=False, so `vars` should never arrive here in
    production -- this stays as defense in depth for any call site or SDK
    default drift that re-enables it. Depth-capped: it runs on an error path
    and must not recurse without bound.
    """
    if isinstance(value, str):
        return scrub_text(value)
    if depth > 8:
        return value
    if isinstance(value, dict):
        for key in list(value):
            value[key] = _scrub_strings_deep(value[key], depth + 1)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            value[index] = _scrub_strings_deep(item, depth + 1)
    return value


def _scrub_exceptions(exception: Any) -> None:
    """
    An exception's message can quote the URL it failed on. Frame paths are only
    touched when they are http(s) URLs, so a filesystem path -- and with it
    issue grouping -- is left exactly as the SDK produced it.
    """
    values = exception.get("values") if isinstance(exception, dict) else None
    if not isinstance(values, list):
        return
    for ex in values:
        if not isinstance(ex, dict):
            continue
        value = ex.get("value")
        if isinstance(value, str):
            ex["value"] = scrub_text(value)
        stacktrace = ex.get("stacktrace")
        frames = stacktrace.get("frames") if isinstance(stacktrace, dict) else None
        if not isinstance(frames, list):
            continue
        for frame in frames:
            if not isinstance(frame, dict):
                continue
            _scrub_strings_deep(frame.get("vars"))
            for key in ("filename", "abs_path"):
                path = frame.get(key)
                if isinstance(path, str) and path.startswith(("http://", "https://")):
                    frame[key] = scrub_url(path)


def _scrub_logentry(logentry: Any) -> None:
    """A log record's template, its params and its formatted form."""
    if not isinstance(logentry, dict):
        return
    for key in ("message", "formatted"):
        value = logentry.get(key)
        if isinstance(value, str):
            logentry[key] = scrub_text(value)
    params = logentry.get("params")
    if isinstance(params, list):
        logentry["params"] = [
            scrub_text(p) if isinstance(p, str) else p for p in params
        ]


def scrub_sentry_event(event: Dict, hint: Optional[Dict] = None) -> Optional[Dict]:
    """
    Strip credentials and identity from an event before it is transmitted.

    Registered as `before_send` on every sentry_sdk.init() in this service. It is
    the last line of defence, not the first: `send_default_pii=False` keeps the
    SDK from attaching bodies and IPs of its own accord, and the narrowed
    `set_user` signature keeps identity out at the source. This catches whatever
    reached the event by a path neither of those covers.

    The containers covered here are the contract the three runtimes share, and
    scripts/check_sentry_pii_scope.py fails the build if one of them stops
    covering a container the others do. `extra` and `contexts` are scrubbed even
    though no caller in this service currently puts identity there: the whole
    point of a last line of defence is that it does not depend on what today's
    callers happen to do.

    `hint` is accepted and ignored — sentry_sdk always passes it.
    """
    request = event.get("request")
    if isinstance(request, dict):
        headers = request.get("headers")
        if isinstance(headers, dict):
            for name in list(headers):
                lower = name.lower()
                if lower in SENSITIVE_HEADERS:
                    headers.pop(name, None)
                elif lower == "referer" and isinstance(headers[name], str):
                    # The calling page's full URL: a browser on /invite/<code>
                    # or /reset-password?token= sends it with every call it
                    # makes. Scrubbed, not dropped. PR #427 round 3.
                    headers[name] = scrub_url(headers[name])
        request.pop("cookies", None)
        url = request.get("url")
        if isinstance(url, str):
            request["url"] = scrub_url(url)
        # In the ASGI integration `url` is built WITHOUT the querystring
        # (sentry_sdk/integrations/_asgi_common.py `_get_url`), and the query is
        # put here instead -- so scrubbing only `url` would have been a no-op for
        # the thing this fix is named after. Found by PR #427's security audit.
        request.pop("query_string", None)
        _scrub_pii_keys(request.get("data"))

    user = event.get("user")
    if isinstance(user, dict):
        for key in PII_USER_KEYS:
            user.pop(key, None)

    _scrub_pii_keys(event.get("extra"))

    # The transaction/span NAME is built from the raw request path -- a
    # GET /calendar/feed/<token>.ics request names its own transaction
    # <token>.ics regardless of what request["url"] says.
    transaction = event.get("transaction")
    if isinstance(transaction, str):
        event["transaction"] = scrub_url(transaction)

    contexts = event.get("contexts")
    if isinstance(contexts, dict):
        for ctx in contexts.values():
            _scrub_pii_keys(ctx)
        trace = contexts.get("trace")
        if isinstance(trace, dict):
            _scrub_span_data(trace.get("data"))

    spans = event.get("spans")
    if isinstance(spans, list):
        for span in spans:
            if isinstance(span, dict):
                _scrub_span_data(span.get("data"))

    _scrub_breadcrumbs(event.get("breadcrumbs"))

    # Free text that can quote a URL: the event's own message, a log record, and
    # each exception's message and frames. PR #427 round 3.
    message = event.get("message")
    if isinstance(message, str):
        event["message"] = scrub_text(message)
    _scrub_logentry(event.get("logentry"))
    _scrub_exceptions(event.get("exception"))

    return event


class SentryClient:
    """Sentry error tracking client for Python services."""

    _instance: Optional["SentryClient"] = None
    _initialized: bool = False

    def __new__(cls) -> "SentryClient":
        """Singleton pattern."""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def initialize(
        self,
        dsn: Optional[str] = None,
        environment: Optional[str] = None,
        release: Optional[str] = None,
        traces_sample_rate: float = 0.1,
        profiles_sample_rate: float = 0.1,
    ) -> bool:
        """
        Initialize Sentry SDK.

        Args:
            dsn: Sentry DSN (defaults to SENTRY_DSN env var)
            environment: Environment name (defaults to ENVIRONMENT env var)
            release: Release version (defaults to APP_VERSION env var)
            traces_sample_rate: Performance monitoring sample rate
            profiles_sample_rate: Profiling sample rate

        Returns:
            True if initialized successfully, False otherwise
        """
        if self._initialized:
            logger.warning("Sentry already initialized")
            return True

        if not SENTRY_AVAILABLE:
            logger.warning("sentry-sdk not installed - error tracking disabled")
            return False

        dsn = dsn or os.getenv("SENTRY_DSN")
        environment = environment or os.getenv("ENVIRONMENT", "development")
        release = release or os.getenv("APP_VERSION", "1.0.0")

        if not dsn:
            logger.warning("Sentry DSN not configured - error tracking disabled")
            return False

        try:
            sentry_sdk.init(
                dsn=dsn,
                environment=environment,
                release=release,
                traces_sample_rate=(
                    traces_sample_rate if environment == "production" else 1.0
                ),
                profiles_sample_rate=(
                    profiles_sample_rate if environment == "production" else 1.0
                ),
                send_default_pii=False,
                # Founder 2026-09-25 (PR #427 round 3): stop sending locals. See
                # the matching comment at the other sentry_sdk.init() site in
                # main.py -- scrub_text cannot catch a bare token quoted inside a
                # frame local's repr, so the SDK must never attach locals at all.
                include_local_variables=False,
                integrations=[
                    FastApiIntegration(transaction_style="endpoint"),
                    StarletteIntegration(transaction_style="endpoint"),
                    LoggingIntegration(
                        level=logging.INFO,
                        event_level=logging.ERROR,
                    ),
                ],
                before_send=scrub_sentry_event,
                # sentry_sdk skips before_send when event['type'] == 'transaction'
                # (client.py). With traces_sample_rate set, the ASGI integration
                # attaches request.url and request.query_string to EVERY event
                # type, so a SUCCESSFUL request shipped the query -- including
                # INBOUND_WEBHOOK_SECRET -- unscrubbed. Found by PR #427's own
                # security re-audit. scrub_sentry_event never returns None, so it
                # cannot drop a transaction.
                before_send_transaction=scrub_sentry_event,
            )

            self._initialized = True
            logger.info(f"Sentry initialized (environment: {environment})")
            return True

        except Exception as e:
            logger.error(f"Failed to initialize Sentry: {e}")
            return False

    @property
    def is_initialized(self) -> bool:
        """Check if Sentry is initialized."""
        return self._initialized

    def capture_exception(
        self,
        error: Exception,
        context: Optional[Dict[str, Any]] = None,
    ) -> Optional[str]:
        """
        Capture an exception.

        Args:
            error: Exception to capture
            context: Additional context

        Returns:
            Event ID or None
        """
        if not self._initialized or not SENTRY_AVAILABLE:
            logger.error(f"Error (Sentry disabled): {error}", exc_info=error)
            return None

        with sentry_sdk.push_scope() as scope:
            if context:
                for key, value in context.items():
                    scope.set_extra(key, value)

            event_id = sentry_sdk.capture_exception(error)
            logger.error(f"Error captured: {error} (Event ID: {event_id})")
            return event_id

    def capture_message(
        self,
        message: str,
        level: str = "info",
        context: Optional[Dict[str, Any]] = None,
    ) -> Optional[str]:
        """
        Capture a message.

        Args:
            message: Message to capture
            level: Severity level (info, warning, error)
            context: Additional context

        Returns:
            Event ID or None
        """
        if not self._initialized or not SENTRY_AVAILABLE:
            logger.log(
                (
                    logging.INFO
                    if level == "info"
                    else logging.WARNING if level == "warning" else logging.ERROR
                ),
                f"Message (Sentry disabled): {message}",
            )
            return None

        with sentry_sdk.push_scope() as scope:
            if context:
                for key, value in context.items():
                    scope.set_extra(key, value)

            event_id = sentry_sdk.capture_message(message, level=level)
            return event_id

    def set_user(
        self,
        user_id: str,
        restaurant_id: Optional[str] = None,
    ) -> None:
        """
        Set user context — opaque identifiers only.

        `email` and `username` parameters used to exist here and were forwarded
        straight to Sentry. They are gone rather than ignored: a parameter that
        accepts an email is an invitation to pass one, and `send_default_pii`
        does not cover anything set explicitly through set_user().

        Args:
            user_id: User ID (UUID — meaningless outside our database)
            restaurant_id: Restaurant ID (UUID)
        """
        if not self._initialized or not SENTRY_AVAILABLE:
            return

        sentry_sdk.set_user(
            {
                "id": user_id,
                "restaurant_id": restaurant_id,
            }
        )

    def clear_user(self) -> None:
        """Clear user context."""
        if not self._initialized or not SENTRY_AVAILABLE:
            return
        sentry_sdk.set_user(None)

    def set_context(self, name: str, context: Dict[str, Any]) -> None:
        """
        Set extra context.

        Args:
            name: Context name
            context: Context data
        """
        if not self._initialized or not SENTRY_AVAILABLE:
            return
        sentry_sdk.set_context(name, context)

    def set_tag(self, key: str, value: str) -> None:
        """
        Set a tag.

        Args:
            key: Tag key
            value: Tag value
        """
        if not self._initialized or not SENTRY_AVAILABLE:
            return
        sentry_sdk.set_tag(key, value)

    def add_breadcrumb(
        self,
        category: str,
        message: str,
        level: str = "info",
        data: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Add a breadcrumb.

        Args:
            category: Breadcrumb category
            message: Breadcrumb message
            level: Severity level
            data: Additional data
        """
        if not self._initialized or not SENTRY_AVAILABLE:
            return

        sentry_sdk.add_breadcrumb(
            category=category,
            message=message,
            level=level,
            data=data,
        )


# Singleton instance
sentry_client = SentryClient()


def track_errors(func):
    """
    Decorator to automatically capture exceptions.

    Usage:
        @track_errors
        async def my_function():
            ...
    """

    @wraps(func)
    async def async_wrapper(*args, **kwargs):
        try:
            return await func(*args, **kwargs)
        except Exception as e:
            sentry_client.capture_exception(
                e,
                {
                    "function": func.__name__,
                    "args": str(args)[:200],
                    "kwargs": str(kwargs)[:200],
                },
            )
            raise

    @wraps(func)
    def sync_wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            sentry_client.capture_exception(
                e,
                {
                    "function": func.__name__,
                    "args": str(args)[:200],
                    "kwargs": str(kwargs)[:200],
                },
            )
            raise

    import asyncio

    if asyncio.iscoroutinefunction(func):
        return async_wrapper
    return sync_wrapper


def init_sentry() -> bool:
    """Initialize Sentry with default settings."""
    return sentry_client.initialize()
