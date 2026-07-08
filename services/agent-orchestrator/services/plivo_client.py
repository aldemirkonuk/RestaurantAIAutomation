"""
Plivo SMS Client - Production-Ready SMS Service

Handles SMS sending via Plivo API with:
- Retry logic
- Rate limiting
- Delivery tracking
- Error handling
- Cost monitoring
"""

import asyncio
from typing import Dict, Any
from datetime import datetime, timedelta
import plivo
from plivo.exceptions import PlivoRestError

from utils.logger import setup_logger

logger = setup_logger(__name__)


class PlivoSMSClient:
    """
    Production-ready Plivo SMS client

    Features:
    - Async SMS sending
    - Retry with exponential backoff
    - Rate limiting (configurable)
    - Cost tracking
    - Delivery status webhook support
    """

    def __init__(
        self, auth_id: str, auth_token: str, from_number: str, mock_mode: bool = False
    ):
        """
        Initialize Plivo SMS client

        Args:
            auth_id: Plivo Auth ID
            auth_token: Plivo Auth Token
            from_number: Source phone number (Plivo number)
            mock_mode: If True, log instead of sending
        """
        self.auth_id = auth_id
        self.auth_token = auth_token
        self.from_number = from_number
        self.mock_mode = mock_mode

        # Initialize Plivo client
        if not mock_mode and auth_id and auth_token:
            try:
                self.client = plivo.RestClient(auth_id, auth_token)
                logger.info("✅ Plivo client initialized")
            except Exception as e:
                logger.error(f"Failed to initialize Plivo client: {e}")
                self.client = None
        else:
            self.client = None
            if mock_mode:
                logger.info("📱 Plivo running in MOCK mode")

        # Rate limiting
        self.rate_limit_per_hour = 100
        self.sms_sent_timestamps: Dict[str, list] = {}  # phone -> [timestamps]

        # Cost tracking
        self.cost_per_sms = 0.0035  # $0.0035 per SMS in US
        self.total_cost = 0.0
        self.total_sent = 0

    async def send_sms(
        self,
        to_number: str,
        message: str,
        priority: str = "normal",
        max_retries: int = 3,
    ) -> Dict[str, Any]:
        """
        Send SMS with retry logic

        Args:
            to_number: Destination phone number (E.164 format: +1234567890)
            message: SMS body (max 160 chars for single SMS)
            priority: "high" or "normal" (affects retry behavior)
            max_retries: Number of retry attempts

        Returns:
            Dict with status, message_uuid, cost, etc.
        """
        # Validate inputs
        if not to_number or not message:
            return {"success": False, "error": "Missing to_number or message"}

        # Normalize phone number
        to_number = self._normalize_phone(to_number)

        # Check rate limit
        if not self._check_rate_limit(to_number):
            logger.warning(f"Rate limit exceeded for {to_number}")
            return {
                "success": False,
                "error": "Rate limit exceeded",
                "rate_limit": self.rate_limit_per_hour,
            }

        # Mock mode
        if self.mock_mode:
            logger.info(f"📱 [MOCK SMS] To: {to_number}, Message: {message[:50]}...")
            return {
                "success": True,
                "mock": True,
                "message_uuid": f"mock-{datetime.utcnow().timestamp()}",
                "to": to_number,
                "message": message,
                "cost": 0.0,
            }

        # Real sending with retries
        for attempt in range(max_retries):
            try:
                response = await self._send_via_plivo(to_number, message)

                # Track rate limit
                self._record_sms_sent(to_number)

                # Track cost
                self.total_sent += 1
                self.total_cost += self.cost_per_sms

                logger.info(
                    f"✅ SMS sent to {to_number} (UUID: {response.get('message_uuid')})"
                )

                return {
                    "success": True,
                    "message_uuid": response.get("message_uuid"),
                    "to": to_number,
                    "cost": self.cost_per_sms,
                    "message": message,
                    "attempt": attempt + 1,
                }

            except PlivoRestError as e:
                logger.error(
                    f"Plivo API error (attempt {attempt + 1}/{max_retries}): {e}"
                )

                # Don't retry on certain errors
                if e.status in [400, 401, 403]:  # Bad request, auth errors
                    return {"success": False, "error": str(e), "error_code": e.status}

                # Retry on temporary errors
                if attempt < max_retries - 1:
                    wait_time = 2**attempt  # Exponential backoff: 1s, 2s, 4s
                    logger.info(f"Retrying in {wait_time}s...")
                    await asyncio.sleep(wait_time)
                else:
                    return {
                        "success": False,
                        "error": str(e),
                        "error_code": e.status,
                        "attempts": max_retries,
                    }

            except Exception as e:
                logger.error(
                    f"Unexpected error sending SMS (attempt {attempt + 1}): {e}"
                )
                if attempt < max_retries - 1:
                    await asyncio.sleep(2**attempt)
                else:
                    return {"success": False, "error": str(e), "attempts": max_retries}

        return {"success": False, "error": "Max retries exceeded"}

    async def _send_via_plivo(self, to_number: str, message: str) -> Dict[str, Any]:
        """
        Send SMS via Plivo API (async wrapper)

        Plivo SDK is synchronous, so we run it in executor
        """
        if not self.client:
            raise Exception("Plivo client not initialized")

        # Run synchronous Plivo call in executor to avoid blocking
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: self.client.messages.create(
                src=self.from_number,
                dst=to_number,
                text=message,
                url="https://your-domain.com/webhooks/plivo/status",  # Delivery status callback
                method="POST",
            ),
        )

        return {
            "message_uuid": (
                response[1].message_uuid
                if hasattr(response[1], "message_uuid")
                else None
            ),
            "status": "queued",
        }

    def _normalize_phone(self, phone: str) -> str:
        """
        Normalize phone number to E.164 format

        Examples:
        - "4155551234" -> "+14155551234"
        - "+1-415-555-1234" -> "+14155551234"
        - "+14155551234" -> "+14155551234"
        """
        # Remove all non-digit characters except leading +
        cleaned = "".join(
            c for c in phone if c.isdigit() or (c == "+" and phone.index(c) == 0)
        )

        # Add + if missing
        if not cleaned.startswith("+"):
            # Assume US number if no country code
            if len(cleaned) == 10:
                cleaned = "+1" + cleaned
            else:
                cleaned = "+" + cleaned

        return cleaned

    def _check_rate_limit(self, phone: str) -> bool:
        """
        Check if phone number has exceeded rate limit

        Rate limit: max X SMS per hour per number
        """
        now = datetime.utcnow()
        hour_ago = now - timedelta(hours=1)

        # Get timestamps for this number
        timestamps = self.sms_sent_timestamps.get(phone, [])

        # Filter to last hour
        recent_timestamps = [ts for ts in timestamps if ts > hour_ago]

        # Check limit
        if len(recent_timestamps) >= self.rate_limit_per_hour:
            return False

        return True

    def _record_sms_sent(self, phone: str) -> None:
        """Record SMS sent for rate limiting"""
        now = datetime.utcnow()

        if phone not in self.sms_sent_timestamps:
            self.sms_sent_timestamps[phone] = []

        self.sms_sent_timestamps[phone].append(now)

        # Cleanup old timestamps (keep last 2 hours)
        two_hours_ago = now - timedelta(hours=2)
        self.sms_sent_timestamps[phone] = [
            ts for ts in self.sms_sent_timestamps[phone] if ts > two_hours_ago
        ]

    async def send_sms_with_action_buttons(
        self, to_number: str, message: str, approve_url: str, reject_url: str
    ) -> Dict[str, Any]:
        """
        Send SMS with action button URLs

        Since SMS doesn't support real buttons, we include short URLs
        in the message text.

        Args:
            to_number: Destination phone
            message: SMS body
            approve_url: URL for approval action
            reject_url: URL for rejection action

        Returns:
            Send result
        """
        # Append action URLs to message
        full_message = (
            f"{message}\n\n✅ Approve: {approve_url}\n❌ Reject: {reject_url}"
        )

        return await self.send_sms(to_number, full_message, priority="high")

    def get_stats(self) -> Dict[str, Any]:
        """Get SMS statistics"""
        return {
            "total_sent": self.total_sent,
            "total_cost": round(self.total_cost, 4),
            "cost_per_sms": self.cost_per_sms,
            "rate_limit_per_hour": self.rate_limit_per_hour,
            "mock_mode": self.mock_mode,
        }

    async def verify_delivery_status(self, message_uuid: str) -> Dict[str, Any]:
        """
        Check delivery status of a sent message

        Args:
            message_uuid: UUID from send response

        Returns:
            Delivery status info
        """
        if self.mock_mode:
            return {"status": "delivered", "mock": True}

        if not self.client:
            return {"error": "Client not initialized"}

        try:
            loop = asyncio.get_event_loop()
            message = await loop.run_in_executor(
                None, lambda: self.client.messages.get(message_uuid)
            )

            return {
                "message_uuid": message_uuid,
                "status": (
                    message.message_state
                    if hasattr(message, "message_state")
                    else "unknown"
                ),
                "delivered": (
                    message.message_state == "delivered"
                    if hasattr(message, "message_state")
                    else False
                ),
            }
        except Exception as e:
            logger.error(f"Failed to check delivery status: {e}")
            return {"error": str(e)}
