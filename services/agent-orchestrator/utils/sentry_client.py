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

# Request headers that carry a credential rather than a description.
SENSITIVE_HEADERS = ("authorization", "cookie", "x-api-key", "proxy-authorization")


def scrub_sentry_event(event: Dict, hint: Optional[Dict] = None) -> Optional[Dict]:
    """
    Strip credentials and identity from an event before it is transmitted.

    Registered as `before_send` on every sentry_sdk.init() in this service. It is
    the last line of defence, not the first: `send_default_pii=False` keeps the
    SDK from attaching bodies and IPs of its own accord, and the narrowed
    `set_user` signature keeps identity out at the source. This catches whatever
    reached the event by a path neither of those covers.

    `hint` is accepted and ignored — sentry_sdk always passes it.
    """
    request = event.get("request")
    if isinstance(request, dict):
        headers = request.get("headers")
        if isinstance(headers, dict):
            for name in list(headers):
                if name.lower() in SENSITIVE_HEADERS:
                    headers.pop(name, None)
        request.pop("cookies", None)

    user = event.get("user")
    if isinstance(user, dict):
        for key in PII_USER_KEYS:
            user.pop(key, None)

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
                integrations=[
                    FastApiIntegration(transaction_style="endpoint"),
                    StarletteIntegration(transaction_style="endpoint"),
                    LoggingIntegration(
                        level=logging.INFO,
                        event_level=logging.ERROR,
                    ),
                ],
                before_send=scrub_sentry_event,
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
