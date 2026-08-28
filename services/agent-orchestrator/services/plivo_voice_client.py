"""
Plivo Voice Client - Production-Ready Voice Calling Service

Handles voice calls via Plivo API with:
- Call initiation and management
- Recording and transcription
- Webhook handling
- AI conversation flow
- Error handling and retry logic

Binding-surface gate (FUTURES §8.1)
-----------------------------------
Voice is a **vendor-facing binding surface**. ``generate_negotiation_xml`` speaks a
quantity and a target price down the phone and gathers "press 1 if you can
accommodate this order" — from the vendor's side that is an offer plus an
acceptance channel, i.e. outbound vendor communication that can form a
commitment. FUTURES §8.1 is absolute: *ask → propose → confirm → execute; AI never
silently mutates stock, money, or outbound vendor communication.*

Email already obeys that rule — ``ProviderCommunicationAgent`` runs every draft
through ``ConstraintEngine.check_hard_constraints`` before it can be sent
(``agents/provider_communication_agent.py:458``). Voice had **no** equivalent: no
constraint pass, no approval record, and — as of this commit — no in-repo caller
at all. Three things follow, all enforced in this module rather than in callers,
because a gate that lives in the caller is a gate the next caller can forget:

1. **Hard-constraint pass.** Anything order-shaped is run through the same
   ``ConstraintEngine`` the email path uses. If the engine cannot be imported the
   call is refused — failing closed, never open.
2. **Recorded human confirmation.** The call site must present a
   ``VoiceOrderApproval`` naming the persisted approval row, the human who
   approved, and *the exact terms they approved*. Speaking a quantity or a price
   the human did not approve is a new commitment, so the gate rejects mismatches
   as hard as it rejects a missing approval.
3. **Off by default.** The whole outbound-order voice capability sits behind
   ``VOICE_ORDER_CALLS_ENABLED`` (default ``false``). The flow currently has no
   caller; this flag is what stops it quietly acquiring one. A future caller that
   forgets the approval evidence trips the gate on its first run, in the dev's
   own test, instead of on a live vendor's phone line.

Violations raise ``VoiceBindingGateError`` and are never swallowed into a falsy
return — an execution-shaped failure must be loud (same shape as the tiered
"money/stock never auto-applies" rule in ``agents/drift_agent.py:8-17``).

**Non-binding voice is untouched.** Plain ``make_call`` (a reminder, a
notification) and plain ``generate_answer_xml`` (speak-only, or a menu that is
not an order-acceptance prompt) work exactly as before.

Known limit (follow-up): the gate validates the *shape and freshness* of the
approval record the caller presents; it does not itself re-read the row from
Supabase. Pass ``approval_verifier`` to ``PlivoVoiceClient`` to close that,
and see the follow-up slice noted in the branch report.
"""

import asyncio
import os
import re
from dataclasses import dataclass
from typing import Optional, Dict, Any, List, Callable
from datetime import datetime, timedelta, timezone
from enum import Enum
import plivo
from plivo.exceptions import PlivoRestError

from utils.logger import setup_logger

logger = setup_logger(__name__)


# ──────────────────────────────────────────────────────────────────────────
# Binding gate (FUTURES §8.1)
# ──────────────────────────────────────────────────────────────────────────

#: Env flag that enables the outbound *order* voice capability. Default false.
VOICE_ORDER_CALLS_ENV = "VOICE_ORDER_CALLS_ENABLED"

#: An approval older than this is stale — a human who approved 6 bottles at $25
#: yesterday has not approved today's call. Rejected the same as no approval.
APPROVAL_MAX_AGE_SECONDS = 24 * 3600

#: Context keys that make a ``make_call`` order-shaped. Presence of ANY of these
#: means the call is about placing/negotiating an order and needs the full gate.
ORDER_BINDING_CONTEXT_KEYS = (
    "order_id",
    "negotiation_type",
    "target_price",
    "quantity",
)

#: Speak-text shapes that turn a generic ``GetDigits`` menu into an order
#: acceptance channel. Deliberately narrow: a "press 1 to hear your low-stock
#: alert" prompt must keep working, but "press 1 if you can accommodate this
#: order" must not be reachable without the gate.
ORDER_ACCEPTANCE_PATTERNS = (
    r"press\s+\w+\s+(?:if you can\s+)?(?:accommodate|accept|confirm|fulfill|fill)\b",
    r"press\s+\w+\s+to\s+(?:accept|confirm|approve|place|book)\b.{0,40}\b(order|price|quantity|deal|offer)\b",
    r"\b(?:accept|confirm|approve)\b.{0,30}\bthis (?:order|price|offer|deal)\b",
)


class VoiceBindingGateError(RuntimeError):
    """
    Raised when an order-binding voice action is attempted without the evidence
    FUTURES §8.1 requires: the capability flag, a recorded human confirmation for
    *these* terms, and a passing constraint-engine check.

    This is intentionally an exception rather than a falsy return. The voice path
    is execution-shaped; a caller that treats "no call placed" as a soft outcome
    would degrade the gate into a retry loop.
    """


@dataclass(frozen=True)
class VoiceOrderApproval:
    """
    Evidence that a human confirmed *this* order, on *these* terms, recently.

    The call site must build this from a persisted approval row — ``approval_id``
    and ``source`` exist so the record is traceable back to that row, not
    invented at the call site. ``approved_quantity`` / ``approved_unit_price``
    are what the human actually signed off on; the gate refuses to speak numbers
    that differ from them.
    """

    approval_id: str
    order_id: str
    approved_by: str
    approved_at: datetime
    approved_quantity: float
    approved_unit_price: float
    #: Where the approval row lives, e.g. "procurement_orders.manager_approval_status".
    source: str

    def validate(self) -> List[str]:
        """Return a list of reasons this evidence is unusable (empty == usable)."""
        problems: List[str] = []
        for field_name in (
            "approval_id",
            "order_id",
            "approved_by",
            "source",
        ):
            value = getattr(self, field_name, None)
            if not isinstance(value, str) or not value.strip():
                problems.append(f"{field_name} is missing or blank")

        if not isinstance(self.approved_at, datetime):
            problems.append("approved_at is not a datetime")
        else:
            age = _approval_age_seconds(self.approved_at)
            if age < -60:
                problems.append("approved_at is in the future")
            elif age > APPROVAL_MAX_AGE_SECONDS:
                problems.append(
                    f"approval is stale ({int(age)}s old, max {APPROVAL_MAX_AGE_SECONDS}s)"
                )

        if not isinstance(self.approved_quantity, (int, float)) or (
            self.approved_quantity <= 0
        ):
            problems.append("approved_quantity must be a positive number")
        if not isinstance(self.approved_unit_price, (int, float)) or (
            self.approved_unit_price <= 0
        ):
            problems.append("approved_unit_price must be a positive number")

        return problems


def _approval_age_seconds(approved_at: datetime) -> float:
    """Age of an approval in seconds, tolerating naive (assumed UTC) datetimes."""
    if approved_at.tzinfo is None:
        approved_at = approved_at.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - approved_at).total_seconds()


def voice_order_calls_enabled() -> bool:
    """
    True only when ``VOICE_ORDER_CALLS_ENABLED`` is explicitly truthy.

    Read from the environment on every call rather than cached at import, so the
    capability can be switched off without a redeploy and so tests cannot leave a
    process-wide "on" behind them.
    """
    return os.getenv(VOICE_ORDER_CALLS_ENV, "false").strip().lower() in (
        "true",
        "1",
        "yes",
        "on",
    )


def is_order_acceptance_prompt(speak_text: str) -> bool:
    """True when speak text turns a DTMF menu into an order-acceptance channel."""
    if not speak_text:
        return False
    return any(
        re.search(p, speak_text, re.IGNORECASE) for p in ORDER_ACCEPTANCE_PATTERNS
    )


def _spoken_dollar_amounts(text: str) -> List[float]:
    """Every dollar figure that will actually be read out to the vendor."""
    amounts: List[float] = []
    for raw in re.findall(r"\$\s*([\d,]+(?:\.\d{1,2})?)", text or ""):
        try:
            amounts.append(float(raw.replace(",", "")))
        except ValueError:
            continue
    return amounts


def _numbers_match(spoken: Optional[float], approved: float) -> bool:
    """Terms must match what the human approved (cent-level tolerance only)."""
    if spoken is None:
        return False
    try:
        return abs(float(spoken) - float(approved)) < 0.005
    except (TypeError, ValueError):
        return False


def assert_order_voice_allowed(
    *,
    surface: str,
    spoken_text: str,
    approval: Optional[VoiceOrderApproval],
    order_id: Optional[str] = None,
    quantity: Optional[float] = None,
    unit_price: Optional[float] = None,
    approval_verifier: Optional[Callable[[VoiceOrderApproval], bool]] = None,
) -> None:
    """
    The single gate every order-binding voice action must pass.

    Raises ``VoiceBindingGateError`` unless ALL of the following hold:
      1. ``VOICE_ORDER_CALLS_ENABLED`` is on;
      2. a well-formed, fresh ``VoiceOrderApproval`` is presented;
      3. that approval names this order and these exact terms;
      4. the optional ``approval_verifier`` (DB re-read) confirms it;
      5. the text about to be spoken passes ``ConstraintEngine.check_hard_constraints``.

    Order matters: the cheap, unambiguous refusals come first so a violation
    reports the *first* thing that is wrong rather than a downstream symptom.
    """
    if not voice_order_calls_enabled():
        raise VoiceBindingGateError(
            f"{surface}: outbound order voice calls are disabled. "
            f"Set {VOICE_ORDER_CALLS_ENV}=true to enable this capability "
            "(default off — FUTURES §8.1)."
        )

    if approval is None:
        raise VoiceBindingGateError(
            f"{surface}: no recorded human approval presented. An order-binding "
            "voice call requires a VoiceOrderApproval built from a persisted "
            "approval row (FUTURES §8.1: confirmation is the gate)."
        )

    if not isinstance(approval, VoiceOrderApproval):
        raise VoiceBindingGateError(
            f"{surface}: approval must be a VoiceOrderApproval, got "
            f"{type(approval).__name__}."
        )

    problems = approval.validate()
    if problems:
        raise VoiceBindingGateError(
            f"{surface}: approval evidence is unusable — {'; '.join(problems)}."
        )

    if order_id is not None and str(order_id) != approval.order_id:
        raise VoiceBindingGateError(
            f"{surface}: approval {approval.approval_id} is for order "
            f"{approval.order_id}, not {order_id}."
        )

    if not _numbers_match(quantity, approval.approved_quantity):
        raise VoiceBindingGateError(
            f"{surface}: about to speak quantity {quantity!r} but the human "
            f"approved {approval.approved_quantity!r} (approval "
            f"{approval.approval_id})."
        )

    if not _numbers_match(unit_price, approval.approved_unit_price):
        raise VoiceBindingGateError(
            f"{surface}: about to speak unit price {unit_price!r} but the human "
            f"approved {approval.approved_unit_price!r} (approval "
            f"{approval.approval_id})."
        )

    if approval_verifier is not None:
        try:
            verified = approval_verifier(approval)
        except VoiceBindingGateError:
            raise
        except Exception as exc:  # verifier blew up → cannot check → refuse
            raise VoiceBindingGateError(
                f"{surface}: approval verifier failed for {approval.approval_id} "
                f"({exc}); refusing to place an order-binding call it could not confirm."
            ) from exc
        if not verified:
            raise VoiceBindingGateError(
                f"{surface}: approval verifier rejected {approval.approval_id} "
                "(no matching persisted approval)."
            )

    # Every price actually read out must be one the human signed off on: the
    # approved unit price, or the line total it implies. Catches the case the
    # scalar checks above cannot see — a script whose arguments match the
    # approval but whose text quotes a different number to the vendor.
    allowed_amounts = (
        float(approval.approved_unit_price),
        float(approval.approved_unit_price) * float(approval.approved_quantity),
    )
    for amount in _spoken_dollar_amounts(spoken_text):
        if not any(_numbers_match(amount, allowed) for allowed in allowed_amounts):
            raise VoiceBindingGateError(
                f"{surface}: script would speak ${amount:.2f}, which is neither "
                f"the approved unit price (${allowed_amounts[0]:.2f}) nor the "
                f"approved line total (${allowed_amounts[1]:.2f}) on approval "
                f"{approval.approval_id}."
            )

    # Constraint pass — same engine and same call shape the (guarded) email path
    # uses at agents/provider_communication_agent.py:458. Imported here, not at
    # module scope, so an import failure refuses the call instead of silently
    # removing the check from a module that would otherwise still load.
    try:
        from services.constraint_engine import get_constraint_engine
    except Exception as exc:
        raise VoiceBindingGateError(
            f"{surface}: constraint engine unavailable ({exc}); refusing to place "
            "an order-binding call that cannot be constraint-checked."
        ) from exc

    check = get_constraint_engine().check_hard_constraints(
        spoken_text,
        quantity=float(approval.approved_quantity),
        order_quantity=float(approval.approved_quantity),
        target_price=float(approval.approved_unit_price),
        proposed_price=float(unit_price) if unit_price is not None else None,
    )
    if check.blocked:
        raise VoiceBindingGateError(
            f"{surface}: hard constraints triggered "
            f"({', '.join(check.triggered_hard) or 'unspecified'}) on the text "
            "about to be spoken to the vendor."
        )


class CallStatus(Enum):
    """Voice call status states"""

    INITIATED = "initiated"
    RINGING = "ringing"
    IN_PROGRESS = "in-progress"
    COMPLETED = "completed"
    BUSY = "busy"
    NO_ANSWER = "no-answer"
    FAILED = "failed"
    CANCELED = "canceled"


class PlivoVoiceClient:
    """
    Production-ready Plivo Voice client

    Features:
    - Async voice call initiation
    - Call recording with automatic transcription
    - Webhook handling for call events
    - Retry with exponential backoff
    - Cost tracking
    - AI-powered conversation flow
    """

    def __init__(
        self,
        auth_id: str,
        auth_token: str,
        from_number: str,
        webhook_base_url: str = "https://your-domain.com/webhooks/plivo",
        mock_mode: bool = False,
        approval_verifier: Optional[Callable[["VoiceOrderApproval"], bool]] = None,
    ):
        """
        Initialize Plivo Voice client

        Args:
            auth_id: Plivo Auth ID
            auth_token: Plivo Auth Token
            from_number: Source phone number (Plivo number)
            webhook_base_url: Base URL for webhooks
            mock_mode: If True, log instead of making real calls
            approval_verifier: Optional callable that re-reads the approval row
                and returns True if it really exists and is still approved. When
                supplied it is an ADDITIONAL requirement on order-binding calls,
                never a replacement for the rest of the gate.
        """
        self.auth_id = auth_id
        self.auth_token = auth_token
        self.from_number = from_number
        self.webhook_base_url = webhook_base_url
        self.mock_mode = mock_mode
        self.approval_verifier = approval_verifier

        # Initialize Plivo client
        if not mock_mode and auth_id and auth_token:
            try:
                self.client = plivo.RestClient(auth_id, auth_token)
                logger.info("✅ Plivo Voice client initialized")
            except Exception as e:
                logger.error(f"Failed to initialize Plivo Voice client: {e}")
                self.client = None
        else:
            self.client = None
            if mock_mode:
                logger.info("📞 Plivo Voice running in MOCK mode")

        # Active calls tracking
        self.active_calls: Dict[str, Dict[str, Any]] = {}

        # Rate limiting
        self.rate_limit_per_hour = 50
        self.calls_made_timestamps: Dict[str, List[datetime]] = {}

        # Cost tracking
        self.cost_per_minute = 0.015  # $0.015 per minute (US)
        self.total_cost = 0.0
        self.total_calls = 0
        self.total_duration_seconds = 0

    def _gate_call_context(
        self,
        context: Optional[Dict[str, Any]],
        order_approval: Optional[VoiceOrderApproval],
    ) -> None:
        """
        Apply the §8.1 gate when — and only when — a call is order-shaped.

        Non-binding calls (a delivery reminder, a notification callback) carry
        none of ``ORDER_BINDING_CONTEXT_KEYS`` and pass straight through, so this
        gate cannot break the voice uses that commit nothing.
        """
        if not context:
            return
        if not any(context.get(k) is not None for k in ORDER_BINDING_CONTEXT_KEYS):
            return

        quantity = context.get("quantity")
        unit_price = context.get("target_price")
        if unit_price is None:
            unit_price = context.get("unit_price", context.get("price_per_bottle"))

        # Prefer the literal script when the caller has one; otherwise check the
        # same context-derived summary the guarded email path pre-checks with
        # (agents/provider_communication_agent.py:458).
        spoken_text = context.get("spoken_text") or (
            f"wine {context.get('wine_name', '')} bottles "
            f"quantity {quantity} price {unit_price}"
        )

        assert_order_voice_allowed(
            surface="make_call(order context)",
            spoken_text=spoken_text,
            approval=order_approval,
            order_id=context.get("order_id"),
            quantity=quantity,
            unit_price=unit_price,
            approval_verifier=self.approval_verifier,
        )

    async def make_call(
        self,
        to_number: str,
        answer_xml_url: Optional[str] = None,
        answer_method: str = "POST",
        record: bool = True,
        record_callback_url: Optional[str] = None,
        max_retries: int = 3,
        context: Optional[Dict[str, Any]] = None,
        order_approval: Optional[VoiceOrderApproval] = None,
    ) -> Dict[str, Any]:
        """
        Initiate a voice call

        Args:
            to_number: Destination phone number (E.164 format)
            answer_xml_url: URL returning XML for call flow
            answer_method: HTTP method for answer URL
            record: Whether to record the call
            record_callback_url: URL for recording callback
            max_retries: Number of retry attempts
            context: Additional context for the call
            order_approval: Required when ``context`` is order-shaped (see
                ``ORDER_BINDING_CONTEXT_KEYS``) — recorded human confirmation of
                the exact terms this call will discuss.

        Returns:
            Dict with call_uuid, status, etc.

        Raises:
            VoiceBindingGateError: the call is order-binding and the gate is not
                satisfied. Raised BEFORE any dialling, mock or real: a mock run
                that would have been a violation in production must fail in the
                developer's test, not pass quietly.
        """
        # Binding gate — first statement in the method, ahead of input validation,
        # rate limiting and the mock-mode short-circuit, so no branch reaches a
        # dial (or a convincing fake of one) without passing it.
        self._gate_call_context(context, order_approval)

        # Validate inputs
        if not to_number:
            return {"success": False, "error": "Missing to_number"}

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
            mock_uuid = f"mock-call-{datetime.utcnow().timestamp()}"
            logger.info(f"📞 [MOCK CALL] To: {to_number}, UUID: {mock_uuid}")

            # Track mock call
            self.active_calls[mock_uuid] = {
                "to": to_number,
                "status": CallStatus.INITIATED.value,
                "started_at": datetime.utcnow().isoformat(),
                "context": context,
                "mock": True,
            }

            return {
                "success": True,
                "mock": True,
                "call_uuid": mock_uuid,
                "to": to_number,
                "status": CallStatus.INITIATED.value,
                "cost": 0.0,
            }

        # Set default answer URL if not provided
        if not answer_xml_url:
            answer_xml_url = f"{self.webhook_base_url}/voice/answer"

        if not record_callback_url:
            record_callback_url = f"{self.webhook_base_url}/voice/recording"

        # Real call with retries
        for attempt in range(max_retries):
            try:
                response = await self._make_call_via_plivo(
                    to_number=to_number,
                    answer_xml_url=answer_xml_url,
                    answer_method=answer_method,
                    record=record,
                    record_callback_url=record_callback_url,
                )

                call_uuid = response.get("call_uuid")

                # Track rate limit
                self._record_call_made(to_number)

                # Track active call
                self.active_calls[call_uuid] = {
                    "to": to_number,
                    "status": CallStatus.INITIATED.value,
                    "started_at": datetime.utcnow().isoformat(),
                    "context": context,
                    "recording_enabled": record,
                }

                # Update stats
                self.total_calls += 1

                logger.info(f"✅ Call initiated to {to_number} (UUID: {call_uuid})")

                return {
                    "success": True,
                    "call_uuid": call_uuid,
                    "to": to_number,
                    "status": CallStatus.INITIATED.value,
                    "attempt": attempt + 1,
                }

            except PlivoRestError as e:
                logger.error(
                    f"Plivo API error (attempt {attempt + 1}/{max_retries}): {e}"
                )

                # Don't retry on certain errors
                if hasattr(e, "status") and e.status in [400, 401, 403]:
                    return {"success": False, "error": str(e), "error_code": e.status}

                # Retry on temporary errors
                if attempt < max_retries - 1:
                    wait_time = 2**attempt
                    logger.info(f"Retrying in {wait_time}s...")
                    await asyncio.sleep(wait_time)
                else:
                    return {"success": False, "error": str(e), "attempts": max_retries}

            except Exception as e:
                logger.error(
                    f"Unexpected error making call (attempt {attempt + 1}): {e}"
                )
                if attempt < max_retries - 1:
                    await asyncio.sleep(2**attempt)
                else:
                    return {"success": False, "error": str(e), "attempts": max_retries}

        return {"success": False, "error": "Max retries exceeded"}

    async def _make_call_via_plivo(
        self,
        to_number: str,
        answer_xml_url: str,
        answer_method: str,
        record: bool,
        record_callback_url: str,
    ) -> Dict[str, Any]:
        """
        Make call via Plivo API (async wrapper)
        """
        if not self.client:
            raise Exception("Plivo client not initialized")

        # Run synchronous Plivo call in executor
        loop = asyncio.get_event_loop()

        call_params = {
            "from_": self.from_number,
            "to_": to_number,
            "answer_url": answer_xml_url,
            "answer_method": answer_method,
            "hangup_url": f"{self.webhook_base_url}/voice/hangup",
            "hangup_method": "POST",
            "fallback_url": f"{self.webhook_base_url}/voice/fallback",
            "fallback_method": "POST",
        }

        if record:
            call_params["record"] = True
            call_params["record_callback_url"] = record_callback_url
            call_params["record_callback_method"] = "POST"

        response = await loop.run_in_executor(
            None, lambda: self.client.calls.create(**call_params)
        )

        return {
            "call_uuid": (
                response[0].request_uuid
                if hasattr(response[0], "request_uuid")
                else None
            ),
            "status": "initiated",
        }

    async def hangup_call(self, call_uuid: str) -> Dict[str, Any]:
        """
        Hang up an active call

        Args:
            call_uuid: UUID of the call to hang up

        Returns:
            Dict with status
        """
        if self.mock_mode:
            if call_uuid in self.active_calls:
                self.active_calls[call_uuid]["status"] = CallStatus.COMPLETED.value
                logger.info(f"📞 [MOCK] Hung up call {call_uuid}")
            return {"success": True, "mock": True}

        if not self.client:
            return {"success": False, "error": "Client not initialized"}

        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None, lambda: self.client.calls.delete(call_uuid)
            )

            if call_uuid in self.active_calls:
                self.active_calls[call_uuid]["status"] = CallStatus.COMPLETED.value

            logger.info(f"✅ Hung up call {call_uuid}")
            return {"success": True, "call_uuid": call_uuid}

        except Exception as e:
            logger.error(f"Failed to hang up call {call_uuid}: {e}")
            return {"success": False, "error": str(e)}

    async def get_call_details(self, call_uuid: str) -> Dict[str, Any]:
        """
        Get details of a call

        Args:
            call_uuid: UUID of the call

        Returns:
            Call details
        """
        if self.mock_mode:
            return self.active_calls.get(
                call_uuid, {"error": "Call not found", "mock": True}
            )

        if not self.client:
            return {"error": "Client not initialized"}

        try:
            loop = asyncio.get_event_loop()
            call = await loop.run_in_executor(
                None, lambda: self.client.calls.get(call_uuid)
            )

            return {
                "call_uuid": call_uuid,
                "status": (
                    call.call_status if hasattr(call, "call_status") else "unknown"
                ),
                "duration": call.duration if hasattr(call, "duration") else 0,
                "from": call.from_number if hasattr(call, "from_number") else None,
                "to": call.to_number if hasattr(call, "to_number") else None,
                "direction": (
                    call.call_direction if hasattr(call, "call_direction") else None
                ),
            }

        except Exception as e:
            logger.error(f"Failed to get call details for {call_uuid}: {e}")
            return {"error": str(e)}

    async def get_recording(self, recording_uuid: str) -> Dict[str, Any]:
        """
        Get recording details and URL

        Args:
            recording_uuid: UUID of the recording

        Returns:
            Recording details including URL
        """
        if self.mock_mode:
            return {
                "recording_uuid": recording_uuid,
                "recording_url": f"https://mock-recording.plivo.com/{recording_uuid}.mp3",
                "mock": True,
            }

        if not self.client:
            return {"error": "Client not initialized"}

        try:
            loop = asyncio.get_event_loop()
            recording = await loop.run_in_executor(
                None, lambda: self.client.recordings.get(recording_uuid)
            )

            return {
                "recording_uuid": recording_uuid,
                "recording_url": (
                    recording.recording_url
                    if hasattr(recording, "recording_url")
                    else None
                ),
                "duration": (
                    recording.recording_duration_ms / 1000
                    if hasattr(recording, "recording_duration_ms")
                    else 0
                ),
                "call_uuid": (
                    recording.call_uuid if hasattr(recording, "call_uuid") else None
                ),
            }

        except Exception as e:
            logger.error(f"Failed to get recording {recording_uuid}: {e}")
            return {"error": str(e)}

    def handle_call_webhook(self, webhook_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Handle incoming call webhook

        Args:
            webhook_data: Webhook payload from Plivo

        Returns:
            Processed webhook data
        """
        event_type = webhook_data.get("Event")
        call_uuid = webhook_data.get("CallUUID")

        logger.info(f"📞 Call webhook: {event_type} for {call_uuid}")

        if call_uuid and call_uuid in self.active_calls:
            # Update call status
            if event_type == "CallRinging":
                self.active_calls[call_uuid]["status"] = CallStatus.RINGING.value
            elif event_type == "CallAnswer":
                self.active_calls[call_uuid]["status"] = CallStatus.IN_PROGRESS.value
                self.active_calls[call_uuid][
                    "answered_at"
                ] = datetime.utcnow().isoformat()
            elif event_type == "Hangup":
                self.active_calls[call_uuid]["status"] = CallStatus.COMPLETED.value
                self.active_calls[call_uuid]["ended_at"] = datetime.utcnow().isoformat()

                # Calculate duration and cost
                duration = int(webhook_data.get("Duration", 0))
                self.total_duration_seconds += duration
                call_cost = (duration / 60) * self.cost_per_minute
                self.total_cost += call_cost
                self.active_calls[call_uuid]["duration_seconds"] = duration
                self.active_calls[call_uuid]["cost"] = call_cost

        return {"event": event_type, "call_uuid": call_uuid, "processed": True}

    def handle_recording_webhook(self, webhook_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Handle recording completion webhook

        Args:
            webhook_data: Webhook payload from Plivo

        Returns:
            Processed recording data
        """
        call_uuid = webhook_data.get("CallUUID")
        recording_url = webhook_data.get("RecordUrl")
        recording_uuid = webhook_data.get("RecordingID")
        duration = int(webhook_data.get("RecordingDuration", 0))

        logger.info(f"📼 Recording webhook: {recording_uuid} for call {call_uuid}")

        if call_uuid and call_uuid in self.active_calls:
            self.active_calls[call_uuid]["recording_url"] = recording_url
            self.active_calls[call_uuid]["recording_uuid"] = recording_uuid
            self.active_calls[call_uuid]["recording_duration"] = duration

        return {
            "call_uuid": call_uuid,
            "recording_uuid": recording_uuid,
            "recording_url": recording_url,
            "duration": duration,
            "processed": True,
        }

    def generate_answer_xml(
        self,
        speak_text: Optional[str] = None,
        gather_input: bool = False,
        gather_action_url: Optional[str] = None,
        record_voicemail: bool = False,
        order_approval: Optional[VoiceOrderApproval] = None,
    ) -> str:
        """
        Generate Plivo XML for call flow

        Args:
            speak_text: Text to speak to the caller
            gather_input: Whether to gather DTMF input
            gather_action_url: URL to send gathered input
            record_voicemail: Whether to record a voicemail
            order_approval: Required only when the speak text is an order
                acceptance prompt (see ``ORDER_ACCEPTANCE_PATTERNS``).

        Returns:
            Plivo XML string

        Raises:
            VoiceBindingGateError: the XML would gather an order acceptance and
                the gate is not satisfied. This closes the obvious bypass — a
                caller that skips ``generate_negotiation_xml`` and hands its own
                order script straight to this method.
        """
        if gather_input and is_order_acceptance_prompt(speak_text or ""):
            approval = order_approval
            assert_order_voice_allowed(
                surface="generate_answer_xml(order acceptance prompt)",
                spoken_text=speak_text or "",
                approval=approval,
                order_id=approval.order_id if approval else None,
                quantity=approval.approved_quantity if approval else None,
                unit_price=approval.approved_unit_price if approval else None,
                approval_verifier=self.approval_verifier,
            )

        xml_parts = ['<?xml version="1.0" encoding="UTF-8"?>', "<Response>"]

        if speak_text:
            if gather_input:
                xml_parts.append(
                    f'<GetDigits action="{gather_action_url or ""}" method="POST" timeout="10" numDigits="1">'
                )
                xml_parts.append(f"<Speak>{speak_text}</Speak>")
                xml_parts.append("</GetDigits>")
            else:
                xml_parts.append(f"<Speak>{speak_text}</Speak>")

        if record_voicemail:
            xml_parts.append(
                f'<Record action="{self.webhook_base_url}/voice/voicemail" method="POST" maxLength="120" transcriptionType="auto" transcriptionUrl="{self.webhook_base_url}/voice/transcription"/>'
            )

        xml_parts.append("</Response>")

        return "\n".join(xml_parts)

    def generate_negotiation_xml(
        self,
        wine_name: str,
        quantity: int,
        target_price: float,
        provider_name: str,
        *,
        order_id: Optional[str] = None,
        order_approval: Optional[VoiceOrderApproval] = None,
    ) -> str:
        """
        Generate XML for AI-powered negotiation call.

        This is the binding surface: the XML speaks a quantity and a price to a
        vendor and gathers "press 1 if you can accommodate this order". It is
        therefore gated — flag on, human approval for these exact terms, and a
        hard-constraint pass on the greeting — per FUTURES §8.1.

        Args:
            wine_name: Name of the wine
            quantity: Quantity to order
            target_price: Target price per bottle
            provider_name: Name of the provider
            order_id: Procurement order these terms belong to (must match the
                approval)
            order_approval: Recorded human confirmation of these exact terms

        Returns:
            Plivo XML for negotiation flow

        Raises:
            VoiceBindingGateError: whenever the gate is not satisfied. Never
                returns a "safe" fallback XML — a caller must not be able to
                place a degraded version of this call by ignoring a return value.
        """
        greeting = (
            f"Hello, this is an automated call from WineOps AI. "
            f"I'm calling to inquire about ordering {quantity} bottles of {wine_name}. "
            f"We're looking for a price around ${target_price:.2f} per bottle. "
            f"Please press 1 if you can accommodate this order, "
            f"press 2 if you need to discuss pricing, "
            f"or press 3 to leave a voicemail."
        )

        assert_order_voice_allowed(
            surface="generate_negotiation_xml",
            spoken_text=greeting,
            approval=order_approval,
            order_id=order_id,
            quantity=quantity,
            unit_price=target_price,
            approval_verifier=self.approval_verifier,
        )

        return self.generate_answer_xml(
            speak_text=greeting,
            gather_input=True,
            gather_action_url=f"{self.webhook_base_url}/voice/negotiation/response",
            order_approval=order_approval,
        )

    def _normalize_phone(self, phone: str) -> str:
        """Normalize phone number to E.164 format"""
        cleaned = "".join(
            c for c in phone if c.isdigit() or (c == "+" and phone.index(c) == 0)
        )

        if not cleaned.startswith("+"):
            if len(cleaned) == 10:
                cleaned = "+1" + cleaned
            else:
                cleaned = "+" + cleaned

        return cleaned

    def _check_rate_limit(self, phone: str) -> bool:
        """Check if phone number has exceeded rate limit"""
        now = datetime.utcnow()
        hour_ago = now - timedelta(hours=1)

        timestamps = self.calls_made_timestamps.get(phone, [])
        recent_timestamps = [ts for ts in timestamps if ts > hour_ago]

        return len(recent_timestamps) < self.rate_limit_per_hour

    def _record_call_made(self, phone: str) -> None:
        """Record call made for rate limiting"""
        now = datetime.utcnow()

        if phone not in self.calls_made_timestamps:
            self.calls_made_timestamps[phone] = []

        self.calls_made_timestamps[phone].append(now)

        # Cleanup old timestamps
        two_hours_ago = now - timedelta(hours=2)
        self.calls_made_timestamps[phone] = [
            ts for ts in self.calls_made_timestamps[phone] if ts > two_hours_ago
        ]

    def get_stats(self) -> Dict[str, Any]:
        """Get voice call statistics"""
        return {
            "total_calls": self.total_calls,
            "total_duration_seconds": self.total_duration_seconds,
            "total_duration_minutes": round(self.total_duration_seconds / 60, 2),
            "total_cost": round(self.total_cost, 4),
            "cost_per_minute": self.cost_per_minute,
            "active_calls": len(
                [
                    c
                    for c in self.active_calls.values()
                    if c.get("status")
                    in [
                        CallStatus.INITIATED.value,
                        CallStatus.RINGING.value,
                        CallStatus.IN_PROGRESS.value,
                    ]
                ]
            ),
            "rate_limit_per_hour": self.rate_limit_per_hour,
            "mock_mode": self.mock_mode,
        }

    def get_active_calls(self) -> Dict[str, Dict[str, Any]]:
        """Get all active calls"""
        return {
            uuid: call
            for uuid, call in self.active_calls.items()
            if call.get("status")
            in [
                CallStatus.INITIATED.value,
                CallStatus.RINGING.value,
                CallStatus.IN_PROGRESS.value,
            ]
        }
