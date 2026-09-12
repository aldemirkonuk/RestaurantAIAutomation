"""
Procurement Agent — Lean Decision Engine, propose-only on the buy side
=====================================================================
Order decision logic and status management.

Architecture (Gateway Pattern):
- This agent decides WHAT to buy, HOW MUCH, and at WHAT PRICE TARGET
- ProviderConversationAgent handles ALL provider communication
- This agent stages proposals and receives parsed responses

Responsibilities:
- Stock threshold breach → **propose** a reorder for a human to approve
- Manual order requests → the same proposal, with the requester's overrides
- Receive parsed intent responses from ProviderConversationAgent
- Order status state machine (NEGOTIATING → CONFIRMED → IN_TRANSIT → DELIVERED)
- Price history and target calculation
- Voice call initiation (Plivo API), but message content via ProviderConversationAgent

WHAT CHANGED AND WHY (ADR 0039 Track A3, following recurring_order_agent)
-------------------------------------------------------------------------
``_initiate_procurement`` used to turn a ``stock.threshold.breached`` event into a
purchase attempt with no human anywhere in the path. On one par crossing it:

  1. called ``database.create_procurement_order({... "status": "NEGOTIATING"})``,
     and
  2. published ``procurement.conversation_request`` — the intent that makes
     ProviderConversationAgent draft and send to the vendor.

That is sense → act with no confirmation record, which is the violation
FUTURES §8.1 exists to prevent:

    Ask → propose → confirm → execute. AI never silently mutates stock, money,
    or outbound vendor email. Confirmation is the gate; existing services are
    the executors.

**It was inert only by accident of plumbing, and the accident was about to be
undone.** This agent is CORE (``core/agent_registry.py:78-82``): it starts on
every boot and its queue is bound. What was missing was the *input* — the only
producers of ``stock.threshold.breached`` are ``buffer_manager.py:284`` and
``:451``, and the Python POS pipeline that drives them is dormant. E1's other
half is "unify the POS pipeline", which supplies exactly that input. The gate
therefore had to close before the pipe opened, not after.

The order-creation path is **deleted, not disabled**, on the same reasoning as
``recurring_order_agent``: a disabled path is one edit away from a live one.
There is no ``_create_order``/``_place_order`` here, and no call to
``database.create_procurement_order`` anywhere in this module.

What replaced it, and what was deliberately kept:

* ``_build_reorder_plan`` — the vendor-selection and price-target logic, intact
  and moved into a **pure** method: it reads inventory, provider and price
  history and returns a plan. It writes nothing and publishes nothing, so the
  future hop-4 bridge can call it to decide *what* to buy without any risk of it
  also *buying* it. This is where the negotiation logic went; nothing was thrown
  away.
* ``_propose_reorder`` — stages a ``one_tap_actions`` row with
  ``status='pending'`` and null ``executed_by``/``executed_at``, and writes a
  ``decision_log`` row. Execution happens later in
  ``OneTapActionsService.executeAction``
  (``apps/api-gateway/src/one-tap-actions/one-tap-actions.service.ts:230``),
  which stamps ``executed_by`` from the authenticated user. Nothing in this file
  can produce that stamp.

**Shadow mode: the proposal is written, but no human is told.** Approving a
proposal executes nothing today — ``triggerWorkflow`` is a switch of TODO logs
with no branch for this family — so notifying a manager would put a card in
front of a person that does nothing when tapped, silently. ADR 0020 (LOCKED)
forbids exactly that. The rows are still staged, and are safe to stage because
the web action center filters this ``action_type`` out by design; they serve as
shadow-mode input for the hop-4 bridge. See the ``PROPOSAL_EXECUTOR_EXISTS``
block below for the full argument and for what to change when the executor
lands. This means the buy side is now **safe, not finished**.
* ``_emit_action_proposal`` — the enforcement point, copied from
  ``recurring_order_agent.py``. It validates the caller-supplied row and refuses
  anything that arrives already confirmed.

**Fail closed.** If the proposal cannot be staged, ``_propose_reorder`` records
the failure and returns. It does not fall back to creating an order, and it does
not publish a vendor-facing intent — there is no code path left that could.
Losing a reorder proposal is a missed suggestion; the alternative was an
unapproved purchase.

Nothing downstream is orphaned by this. ``procurement.conversation_request`` and
``procurement.order.created`` both keep their live producers in the gateway
(``apps/api-gateway/src/procurement/procurement.service.ts:877`` — published from
the *approve* path — and ``:443``, from ``createOrder``), which is where they
belong: after a human acted.

Voice is a binding surface and is gated (FUTURES §8.1): `_initiate_voice_negotiation`
requires a recorded human approval for the exact terms, and the whole capability is
off unless VOICE_ORDER_CALLS_ENABLED=true. Enforcement lives in PlivoVoiceClient, not
here. See services/plivo_voice_client.py.
"""

from typing import Dict, List, Any, Optional, TYPE_CHECKING
from datetime import datetime

from core.base_agent import BaseAgent

if TYPE_CHECKING:  # import-time cost only for type checkers, not for the orchestrator
    from services.plivo_voice_client import VoiceOrderApproval


# Typed action envelope (ACTION-SCHEMA-SPEC.md §1). Module constants so the spec,
# this agent and the tests all name the same strings.
ACTION_FAMILY = "procurement"
ACTION_KIND = "procurement.reorder.place"
AUTONOMY_TIER = "propose_only"

# one_tap_actions.action_type is a Postgres enum (public.one_tap_action_type,
# migration 20260805000000_baseline_from_production.sql:173). 'custom' is the
# interim carrier ACTION-SCHEMA-SPEC §4.1 prescribes until step 6 of its
# migration order adds a first-class value; the real family/kind live in
# metadata. Deliberately NOT 'low_stock': the renderers and
# OneTapActionsService.triggerWorkflow dispatch on this column, and inventing a
# dispatch target for a proposal is how a proposal becomes an execution.
ONE_TAP_ACTION_TYPE = "custom"
PROPOSAL_STATUS = "pending"

DECISION_REORDER_PROPOSAL = "procurement_reorder_proposal"
DECISION_REORDER_BLOCKED = "procurement_reorder_blocked"

# The manager-facing announcement. `notification.events` is bound `notification.#`
# by the gateway bridge (apps/api-gateway/src/common/orchestrator/
# rabbitmq-bridge.service.ts:186-190), so this reaches the frontend the same way
# the other three notifications in this file do.
EXCHANGE_NOTIFICATION = "notification.events"
RK_REORDER_PROPOSED = "notification.procurement_reorder_proposed"


# =============================================================================
# WHY NOBODY IS TOLD ABOUT THESE PROPOSALS YET  —  REMOVE THIS WITH THE EXECUTOR
# =============================================================================
# Approving a proposal is supposed to execute it. Today nothing does.
# ``OneTapActionsService.triggerWorkflow``
# (``apps/api-gateway/src/one-tap-actions/one-tap-actions.service.ts:404-429``)
# is a switch of TODO logs, and it has no branch for this family at all. A
# manager who approved one of these would get silence: no order, no error, no
# explanation.
#
# ADR 0020 (LOCKED, `.planning/decisions/0020-no-fabricated-answers.md`) forbids
# precisely that shape — "Actions that cannot complete refuse out loud and keep
# the card", and "An error must never render as emptiness". Shipping a card that
# does nothing when tapped is the defect that ADR catalogues, not a lesser
# version of it.
#
# So the notification is gated, and only the notification. The row is still
# staged, and that is both safe and useful:
#
#   * Safe, because the web action center filters this action_type out. `custom`
#     is deliberately absent from RENDERABLE_SERVER_TYPES and `mapServerAction`
#     returns None for it — "it is filtered out rather than shown as a dead
#     card" (apps/web/src/components/notifications/OneTapActionCenter.tsx:76-90,
#     :104-116). No card reaches a person from the row alone. The mobile app
#     does not read one_tap_actions at all.
#   * Useful, because the rows accumulate as shadow-mode input: the hop-4 bridge
#     design needs to know how often a par crossing would fire and what it would
#     propose, and that is exactly what these rows measure.
#
# The publish is the one step that would put a human in front of a dead action,
# which is why it is the one step behind this flag.
#
# TO WHOEVER BUILDS THE EXECUTOR: flip this to True in the same change that
# gives `triggerWorkflow` a real branch for `procurement.reorder.place`, and
# delete this block. Do not flip it on its own — the flag means "approval does
# something", not "we would like to notify".
# ``tests/test_procurement_agent.py::TestNoHumanIsToldUntilApprovalWorks`` pins
# both halves until then.
#
# NOTE: this is not unique to this agent. `recurring_order_agent` stages the
# same `custom` rows against the same absent executor, so its proposals approved
# today also buy nothing. That is a pre-existing defect in the other runtime,
# tracked separately, and deliberately not widened into this change.
PROPOSAL_EXECUTOR_EXISTS = False


class ProcurementSafetyError(RuntimeError):
    """
    Raised when a caller tries to write a purchase action that is already
    confirmed. Not defensive decoration: it is the assertion that keeps the
    propose→confirm→execute gate from being edited away silently.
    """


class ProcurementAgent(BaseAgent):
    """
    Procurement Agent - AI-assisted wine ordering, propose-only on origination

    Negotiation Strategy:
    1. Check historical prices for this wine/provider
    2. Pick the provider and compute the target price band
    3. **Propose** the reorder; a human approves it
    4. From there ProviderConversationAgent negotiates, up to 3 attempts
    5. If still outside range, escalate to manager
    6. Parse the provider response and drive the order state machine

    Autonomy tier: ``propose_only`` for **origination**. This class cannot create
    a procurement order and cannot publish a vendor-conversation intent, so no
    event it consumes can start a purchase.

    The carve-out, stated plainly because a blanket claim here would be false:
    ``_handle_intent_response`` still writes directly — order status, calendar
    cancellation, shadow-stock release. That is bookkeeping on an order a human
    already created through the gateway, reacting to what a vendor said; it can
    only ever *unwind* or record a commitment, never form one. It is the same
    split ``drift_agent`` draws (``drift_agent.py:8-17``) and the same one
    ``recurring_order_agent`` draws when it advances ``next_order_date``.

    LLM Usage: none. The client this agent used to build was removed in OD-57;
    message generation belongs to ProviderConversationAgent.
    """

    # Read by tests and by anything auditing agent autonomy without importing
    # the module's constants.
    AUTONOMY_TIER = AUTONOMY_TIER

    def __init__(self, agent_name: str, message_bus, database, config: Dict[str, Any]):
        super().__init__(agent_name, message_bus, database, config)

        # LLM configuration
        # Kept because the orchestrator still passes llm_model and callers may
        # read it, but nothing in this agent uses it any more — the client it fed
        # was removed in initialize() (OD-57). Default is None rather than a
        # retired id so it cannot quietly become a live model name again.
        self.llm_model = config.get("llm_model")
        self.llm_temperature = config.get("llm_temperature", 0.7)
        self.google_api_key = config.get("google_api_key")
        self.mock_mode = config.get("mock_mode", True)

        # Negotiation settings
        self.max_negotiation_attempts = 3
        self.price_tolerance_percent = 15  # ±15% from target

        # LLM client (will initialize in initialize())
        self.llm_client = None

        # Voice client for Plivo voice calls
        self.voice_client = None
        self.plivo_auth_id = config.get("plivo_auth_id")
        self.plivo_auth_token = config.get("plivo_auth_token")
        self.plivo_phone_number = config.get("plivo_phone_number")
        self.plivo_webhook_base_url = config.get(
            "plivo_webhook_base_url", "https://your-domain.com/webhooks/plivo"
        )

    async def initialize(self) -> None:
        self.logger.info("Initializing Procurement Agent")

        if self.mock_mode:
            self.logger.warning("⚠️ Running in MOCK mode (no real LLM calls)")
        # The Gemini client built here was REMOVED rather than repointed (OD-57).
        # It was constructed on every non-mock boot and never called — llm_client
        # had three references in this file: None, this assignment, None again in
        # cleanup. It was also handed llm_model, which the orchestrator fills from
        # llm_primary_model — a CLAUDE id going into the Gemini SDK. Repointing it
        # would make procurement look like it does LLM work it does not do.

        # Initialize Plivo Voice client
        if self.plivo_auth_id and self.plivo_auth_token:
            try:
                from services.plivo_voice_client import PlivoVoiceClient

                self.voice_client = PlivoVoiceClient(
                    auth_id=self.plivo_auth_id,
                    auth_token=self.plivo_auth_token,
                    from_number=self.plivo_phone_number,
                    webhook_base_url=self.plivo_webhook_base_url,
                    mock_mode=self.mock_mode,
                )
                self.logger.info("✓ Plivo Voice client initialized")
            except Exception as e:
                self.logger.error(f"Failed to initialize Voice client: {e}")
                self.voice_client = None
        else:
            self.logger.warning(
                "⚠️ Plivo credentials not configured, voice calling disabled"
            )

        self.logger.info("✓ Procurement Agent initialized")

    def get_subscribed_routing_keys(self) -> List[tuple[str, str]]:
        return [
            ("stock.events", "stock.threshold.breached"),
            ("procurement.events", "procurement.manual_order_request"),
            ("procurement.events", "procurement.intent_response"),
            ("procurement.events", "procurement.vendor_response"),
            # Voice call events
            ("voice.events", "voice.call_completed"),
            ("voice.events", "voice.transcription_ready"),
        ]

    async def process_message(self, message: Dict[str, Any]) -> None:
        routing_key = message.get("routing_key")

        if routing_key == "stock.threshold.breached":
            await self._propose_reorder(message)
        elif routing_key == "procurement.manual_order_request":
            await self._handle_manual_order(message)
        elif routing_key == "procurement.intent_response":
            await self._handle_intent_response(message)
        elif routing_key == "procurement.vendor_response":
            await self._handle_vendor_email_response(message)
        elif routing_key == "voice.call_completed":
            await self._process_voice_call_completed(message)
        elif routing_key == "voice.transcription_ready":
            await self._process_voice_transcription(message)
        else:
            self.logger.warning(f"Unhandled routing key: {routing_key}")

    # =========================================================================
    # PAR CROSSING → PROPOSAL (never a purchase, never a vendor intent)
    # =========================================================================

    async def _build_reorder_plan(
        self, payload: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """
        Decide WHAT to buy, HOW MUCH, and at WHAT PRICE TARGET — and nothing else.

        This is the vendor-selection and price-target logic that used to live
        inline in ``_initiate_procurement``, kept whole. It is deliberately
        **pure with respect to side effects**: it reads inventory, provider and
        price history, and returns a plan. It creates no order, publishes no
        event, and stages no proposal.

        That separation is the point. The future hop-4 bridge needs this
        reasoning and must not inherit the ability to act on it, so the reasoning
        lives in a method that structurally cannot. Returns ``None`` when the
        plan cannot be built (missing inventory, no provider, unknown provider),
        which callers must treat as "do nothing".
        """
        inventory_id = payload.get("inventory_id")
        wine_name = payload.get("wine_name")

        manual_provider_id = payload.get("_provider_id")
        manual_quantity = payload.get("_quantity")
        manual_target_price = payload.get("_target_price")

        inventory = await self.database.get_inventory_item(inventory_id)
        if not inventory:
            self.logger.error(f"Inventory not found: {inventory_id}")
            return None

        # The column is `provider_id`. `primary_provider_id` does not exist on
        # restaurant_inventory in any environment, so this lookup returned None
        # for EVERY wine and procurement could never be initiated at all — the
        # failure surfaced as `get_provider(None)` crashing on a cache key.
        # It stayed invisible because local databases were hand-built and never
        # had the real column set either. `primary_provider_id` is kept as a
        # fallback in case some row somewhere carries it.
        primary_provider_id = (
            manual_provider_id
            or inventory.get("provider_id")
            or inventory.get("primary_provider_id")
        )
        if not primary_provider_id:
            self.logger.error(
                "No provider on inventory %s (%s) — cannot reorder",
                inventory_id,
                wine_name,
            )
            return None

        provider = await self.database.get_provider(primary_provider_id)
        if not provider:
            self.logger.error(f"Provider not found: {primary_provider_id}")
            return None

        threshold_min = inventory.get("threshold_min", 3)
        reorder_quantity = manual_quantity or inventory.get(
            "reorder_quantity", threshold_min * 3
        )

        price_history = await self._get_price_history(inventory_id, primary_provider_id)
        avg_price = self._calculate_avg_price(price_history)
        target_price = manual_target_price or (avg_price * 0.95)

        return {
            "restaurant_id": inventory.get("restaurant_id")
            or payload.get("restaurant_id"),
            "inventory_id": inventory_id,
            "provider_id": primary_provider_id,
            "provider_name": provider.get("name"),
            "wine_name": wine_name or inventory.get("wine_name"),
            "quantity": reorder_quantity,
            "target_price_per_bottle": target_price,
            "max_acceptable_price": target_price
            * (1 + self.price_tolerance_percent / 100),
            "price_tolerance_percent": self.price_tolerance_percent,
            "avg_historical_price": avg_price,
            "price_history_points": len(price_history),
            "urgency": payload.get("urgency", "medium"),
            "stock_after": payload.get("stock_after", 0),
            "threshold": payload.get("threshold", threshold_min),
            # Recorded so the proposal shows where it came from. A manual request
            # is a request, not a confirmation: it carries no executed_by, so it
            # takes the same path as an automatic par crossing.
            "is_manual": bool(payload.get("_manual", False)),
            "notes": payload.get("_notes", ""),
        }

    async def _propose_reorder(self, message: Dict[str, Any]) -> Optional[str]:
        """
        Turn a par crossing (or a manual request) into a proposal a human taps.

        Replaces ``_initiate_procurement``, which created a ``NEGOTIATING`` order
        and published ``procurement.conversation_request`` — reaching a vendor
        with no confirmation record anywhere in the path. Both of those are gone;
        see the module docstring.

        Fails closed. Every early return does nothing, and there is no branch
        that creates an order. Returns the staged action id, or None.
        """
        payload = message.get("payload", {}) or {}

        try:
            plan = await self._build_reorder_plan(payload)
            if not plan:
                return None

            restaurant_id = plan["restaurant_id"]
            wine_name = plan["wine_name"] or "Unknown wine"

            existing = await self._find_open_proposal(
                plan["inventory_id"], restaurant_id
            )
            if existing:
                self.logger.info(
                    f"Reorder proposal {existing} is already open for inventory "
                    f"{plan['inventory_id']} — not staging a second one"
                )
                return existing

            decision_id = await self.log_decision(
                decision_type=DECISION_REORDER_PROPOSAL,
                inputs=plan,
                output={
                    "action": "proposal",
                    "autonomy_tier": AUTONOMY_TIER,
                    "status": PROPOSAL_STATUS,
                    "executed": False,
                    "orders_created": 0,
                    "vendor_intents_published": 0,
                    # Makes the shadow-mode volume countable straight off
                    # decision_log, which is what the hop-4 bridge design needs.
                    "shadow_mode": not PROPOSAL_EXECUTOR_EXISTS,
                    "manager_notified": PROPOSAL_EXECUTOR_EXISTS,
                },
                reasoning=(
                    "Stock crossed its reorder threshold. Staged a pending "
                    "one_tap_actions proposal for manager confirmation. No "
                    "procurement order was created and no vendor-conversation "
                    "intent was published: FUTURES §8.1 requires a confirmation "
                    "record (executed_by/executed_at) against this specific "
                    "action before anything reaches a vendor."
                    + (
                        " Shadow mode: no manager was notified, because "
                        "approving a proposal executes nothing yet and ADR 0020 "
                        "forbids an action that silently does nothing."
                        if not PROPOSAL_EXECUTOR_EXISTS
                        else ""
                    )
                ),
                confidence=0.9,
                restaurant_id=restaurant_id,
            )

            action_id = await self._emit_action_proposal(
                {
                    "restaurant_id": restaurant_id,
                    "action_type": ONE_TAP_ACTION_TYPE,
                    "title": f"Reorder suggested: {wine_name}",
                    "description": (
                        f"Stock is at {plan['stock_after']} (threshold "
                        f"{plan['threshold']}). Suggested: {plan['quantity']} x "
                        f"{wine_name} from {plan['provider_name']} at a target of "
                        f"${plan['target_price_per_bottle']:.2f}/bottle. "
                        f"Approve to start this reorder."
                    ),
                    "priority": (
                        "high" if plan["urgency"] in ("high", "critical") else "medium"
                    ),
                    "status": PROPOSAL_STATUS,
                    "metadata": {
                        "action_family": ACTION_FAMILY,
                        "action_kind": ACTION_KIND,
                        "proposer": self.agent_name,
                        "autonomy_tier": AUTONOMY_TIER,
                        "payload": plan,
                        "decision_log_id": decision_id,
                        "correlation_id": self._current_correlation_id,
                    },
                }
            )

            if not action_id:
                # FAIL CLOSED. The proposal could not be staged, so the manager
                # will not see this suggestion. That is the acceptable outcome;
                # the unacceptable one would be reaching the vendor anyway, and
                # no code path here can do that.
                self.logger.error(
                    f"Could not stage a reorder proposal for {wine_name} "
                    f"(inventory {plan['inventory_id']}) — nothing was ordered "
                    "and no vendor was contacted"
                )
                await self.log_decision(
                    decision_type=DECISION_REORDER_BLOCKED,
                    inputs=plan,
                    output={"action": "none", "executed": False, "orders_created": 0},
                    reasoning=(
                        "Proposal staging failed. Failing closed: no order was "
                        "created and no vendor intent was published."
                    ),
                    confidence=1.0,
                    restaurant_id=restaurant_id,
                )
                return None

            if not PROPOSAL_EXECUTOR_EXISTS:
                # SHADOW MODE. The row is written; no human is told, because
                # approving it would silently do nothing (ADR 0020). See the
                # PROPOSAL_EXECUTOR_EXISTS block at the top of this module for
                # the full reasoning and for what to change when the executor
                # lands.
                self.logger.info(
                    f"Staged reorder proposal {action_id} in shadow mode: "
                    f"{wine_name} x{plan['quantity']} from "
                    f"{plan['provider_name']}. No manager was notified — "
                    "approving a proposal executes nothing today "
                    "(one-tap-actions.service.ts:404-429)."
                )
                return action_id

            # Tell the manager there is something to look at. This is the only
            # publish on this path, it is manager-facing, and it carries no
            # order id because no order exists yet.
            await self.publish(
                exchange_name=EXCHANGE_NOTIFICATION,
                routing_key=RK_REORDER_PROPOSED,
                message_body={
                    "event_type": "ProcurementReorderProposed",
                    "payload": {
                        "restaurant_id": restaurant_id,
                        "type": "reorder_proposed",
                        "one_tap_action_id": action_id,
                        "inventory_id": plan["inventory_id"],
                        "wine_name": wine_name,
                        "provider_name": plan["provider_name"],
                        "quantity": plan["quantity"],
                        "target_price": plan["target_price_per_bottle"],
                        "title": f"Reorder suggested: {wine_name}",
                        "message": (
                            f"{wine_name} is low. A reorder of {plan['quantity']} "
                            f"from {plan['provider_name']} is waiting for your "
                            "approval."
                        ),
                        "urgency": plan["urgency"],
                        "action_url": "/orders",
                    },
                },
                priority=7 if plan["urgency"] in ("high", "critical") else 5,
            )

            self.logger.info(
                f"Staged reorder proposal {action_id}: {wine_name} x"
                f"{plan['quantity']} from {plan['provider_name']} "
                "(pending human approval; no order created)"
            )
            return action_id

        except Exception as e:
            self.logger.error(f"Error proposing reorder: {e}", exc_info=True)
            return None

    async def _emit_action_proposal(self, row: Dict[str, Any]) -> Optional[str]:
        """
        THE ENFORCEMENT POINT for the no-auto-execute guarantee.

        Copied deliberately from ``recurring_order_agent._emit_action_proposal``
        (ACTION-SCHEMA-SPEC.md §1 invariant 1 names that method as the reference
        implementation) so both purchase proposers enforce the same rule the same
        way rather than two agents drifting apart.

        This is the only method in the agent that writes a purchase-shaped row,
        and it refuses any row that arrives already confirmed — a status other
        than ``pending``, or a populated ``executed_by`` / ``executed_at`` /
        ``execution_result``. The confirmation stamp belongs to the API gateway
        (``apps/api-gateway/src/one-tap-actions/one-tap-actions.service.ts:245-246``),
        written after a human taps approve; an agent writing it would forge
        consent and be, at rest, indistinguishable from a real approval.

        It validates caller-supplied data rather than data it built itself, so it
        still fails on a future caller that reintroduces execution — which is the
        whole point of putting the check here instead of in a comment.
        """
        violations = [
            field
            for field in ("executed_by", "executed_at", "execution_result")
            if row.get(field) is not None
        ]
        if row.get("status") != PROPOSAL_STATUS:
            violations.append(f"status={row.get('status')!r}")

        if violations:
            raise ProcurementSafetyError(
                f"{self.agent_name} may only stage unconfirmed proposals "
                f"(status={PROPOSAL_STATUS!r}; executed_by, executed_at and "
                f"execution_result unset). Refused: {', '.join(violations)}. "
                "Confirmation is written by OneTapActionsService.executeAction "
                "after a human approves — FUTURES §8.1."
            )

        try:
            result = (
                self.database.supabase.table("one_tap_actions").insert(row)
                # No .select() — see BaseAgent.log_decision for why chaining it
                # onto an insert builder raises AttributeError.
                .execute()
            )
            if result.data:
                return result.data[0].get("id")
        except Exception as exc:
            self.logger.warning(f"Failed to stage one_tap_actions proposal: {exc}")
        return None

    async def _find_open_proposal(
        self, inventory_id: Any, restaurant_id: Optional[str]
    ) -> Optional[str]:
        """
        Return the id of an already-pending reorder proposal for this wine.

        Idempotency lives on the envelope, not the executor
        (ACTION-SCHEMA-SPEC.md §1 invariant 5): a par that keeps breaching must
        not stack a proposal per event.
        """
        try:
            query = (
                self.database.supabase.table("one_tap_actions")
                .select("id, metadata")
                .eq("status", PROPOSAL_STATUS)
                .eq("action_type", ONE_TAP_ACTION_TYPE)
            )
            if restaurant_id:
                query = query.eq("restaurant_id", restaurant_id)
            result = query.execute()
            for row in result.data or []:
                metadata = row.get("metadata") or {}
                if metadata.get("action_kind") != ACTION_KIND:
                    continue
                payload = metadata.get("payload") or {}
                if str(payload.get("inventory_id")) == str(inventory_id):
                    return row.get("id")
        except Exception as exc:
            self.logger.warning(f"Open-proposal lookup failed: {exc}")
        return None

    async def _handle_intent_response(self, message: Dict[str, Any]) -> None:
        """
        Handle parsed response from ProviderConversationAgent.

        The intelligence extraction and message parsing has already been done
        by ProviderConversationAgent. This method only manages the order state machine.
        """
        payload = message.get("payload", {})
        order_id = payload.get("order_id")
        response_type = payload.get("response_type", "unknown")
        parsed_price = payload.get("parsed_price")
        restaurant_id = payload.get("restaurant_id")

        if not order_id:
            self.logger.warning("Intent response missing order_id")
            return

        self.logger.info(
            f"Intent response for order {order_id}: type={response_type}, "
            f"price={parsed_price}"
        )

        try:
            order_result = (
                self.database.supabase.table("procurement_orders")
                .select("*")
                .eq("id", order_id)
                .single()
                .execute()
            )
            order = order_result.data if order_result.data else None

            if not order:
                self.logger.error(f"Order {order_id} not found")
                return

            if response_type in ("price_acceptance", "acceptance", "confirmed"):
                await self.database.supabase.table("procurement_orders").update(
                    {
                        "status": "CONFIRMED",
                        "negotiated_price_per_bottle": parsed_price,
                        "updated_at": datetime.utcnow().isoformat(),
                    }
                ).eq("id", order_id).execute()

                await self.publish(
                    exchange_name="procurement.events",
                    routing_key="procurement.order.confirmed",
                    message_body={
                        "event_type": "ProcurementOrderConfirmed",
                        "payload": {
                            "order_id": order_id,
                            "restaurant_id": restaurant_id
                            or order.get("restaurant_id"),
                            "wine_name": order.get("wine_name", ""),
                            "negotiated_price": parsed_price,
                            "status": "CONFIRMED",
                        },
                    },
                )

                # Notify manager that the order was confirmed by the vendor
                await self.publish(
                    exchange_name="notification.events",
                    routing_key="notification.order_confirmed",
                    message_body={
                        "event_type": "OrderConfirmedByVendor",
                        "payload": {
                            "restaurant_id": restaurant_id
                            or order.get("restaurant_id"),
                            "order_id": order_id,
                            "type": "order_confirmed",
                            "title": f"Order confirmed: {order.get('wine_name', 'Wine')}",
                            "message": (
                                f"Vendor confirmed the order for {order.get('wine_name', 'Wine')}. "
                                f"Status is now ORDERED."
                                + (
                                    f" Negotiated price: ${parsed_price}/bottle."
                                    if parsed_price
                                    else ""
                                )
                            ),
                            "urgency": "normal",
                        },
                    },
                )

                self.logger.info(f"Order {order_id} confirmed at ${parsed_price}")

            elif response_type == "counter_offer":
                await self.database.supabase.table("procurement_orders").update(
                    {
                        "status": "COUNTER_OFFERED",
                        "negotiated_price_per_bottle": parsed_price,
                        "updated_at": datetime.utcnow().isoformat(),
                    }
                ).eq("id", order_id).execute()

                await self.publish(
                    exchange_name="notification.events",
                    routing_key="notification.procurement_counter_offer",
                    message_body={
                        "event_type": "ProcurementCounterOffer",
                        "payload": {
                            "restaurant_id": restaurant_id
                            or order.get("restaurant_id"),
                            "order_id": order_id,
                            "title": "Counter offer received",
                            "message": (
                                f"Provider counter-offered ${parsed_price}/bottle "
                                f"for {order.get('wine_name', 'Unknown')} "
                                f"(target was ${order.get('target_price_per_bottle', 0)})"
                            ),
                            "urgency": "high",
                        },
                    },
                )
                self.logger.info(f"Order {order_id} counter-offered at ${parsed_price}")

            elif response_type in ("rejection", "declined"):
                # A VENDOR'S NO IS NOT THE ORDER'S DEATH.
                #
                # ADR 0125 Q3, founder 2026-09-05: "Return to NEGOTIATING, with
                # the decline recorded." This wrote status "REJECTED" — a
                # TERMINAL state — so one vendor saying no dropped the order out
                # of every open-order list, every outstanding count and every
                # reorder widget before a human decided anything. The house may
                # still buy this wine at another price or from another vendor.
                # Dynamics 365 holds such a PO "In external review" for the same
                # reason.
                #
                # As of the same day the DATABASE refuses the old write:
                # `trg_procurement_order_transition_is_legal` has no
                # CONFIRMED>REJECTED edge, so this path would have started
                # raising 23514 rather than quietly closing the order. It is
                # corrected here rather than left to fail.
                #
                # WHO DECLINED, WHEN AND IN WHAT WORDS is the inbound
                # `procurement_conversations` row — provider, created_at, the
                # vendor's own message and detected_intent — written by the
                # responder before this runs. Not copied onto the order: two
                # accounts of one event can disagree, and the row is the one a
                # person reads in the responses sheet.
                await self.database.supabase.table("procurement_orders").update(
                    {
                        "status": "NEGOTIATING",
                        "updated_at": datetime.utcnow().isoformat(),
                    }
                ).eq("id", order_id).execute()

                await self.publish(
                    exchange_name="notification.events",
                    routing_key="notification.procurement_rejected",
                    message_body={
                        "event_type": "ProcurementRejected",
                        "payload": {
                            "restaurant_id": restaurant_id
                            or order.get("restaurant_id"),
                            "order_id": order_id,
                            "title": "Vendor declined - back to you",
                            "message": (
                                f"{order.get('provider_name', 'The vendor')} declined "
                                f"{order.get('wine_name', 'this order')}. The order is open "
                                "again for negotiation, not cancelled - re-price it, try "
                                "another vendor, or reject it yourself."
                            ),
                            "urgency": "high",
                        },
                    },
                )
                self.logger.info(
                    f"Order {order_id} declined by vendor; returned to NEGOTIATING "
                    "(the decline is the inbound conversation row)."
                )

            elif response_type == "unavailable":
                # Full OOS cascade — provider reported the wine is out of stock.
                effective_restaurant_id = restaurant_id or order.get("restaurant_id")
                wine_name = order.get("wine_name", "Unknown wine")
                inventory_id = order.get("inventory_id")
                quantity = order.get("quantity", 0)
                current_provider_id = order.get("provider_id")

                # 1. Mark order CANCELLED (out-of-stock = effectively cancelled)
                await self.database.supabase.table("procurement_orders").update(
                    {
                        "status": "CANCELLED",
                        "rejection_reason": "Out of stock — provider email confirmation",
                        "updated_at": datetime.utcnow().isoformat(),
                    }
                ).eq("id", order_id).execute()

                # 2. Cancel the calendar delivery event for this order
                await self._cancel_order_calendar_event(
                    effective_restaurant_id, order_id
                )

                # 3. Release shadow stock that was reserved for this order
                if inventory_id and quantity:
                    await self._release_shadow_stock(
                        effective_restaurant_id, inventory_id, int(quantity)
                    )

                # 4. Find alternative providers for the manager notification
                alternatives = await self._find_alternative_providers(
                    effective_restaurant_id, current_provider_id, wine_name
                )
                alt_text = ""
                if alternatives:
                    alt_names = ", ".join(alternatives[:3])
                    alt_text = f" Consider these alternatives: {alt_names}."

                # 5. Notify manager with full context
                await self.publish(
                    exchange_name="notification.events",
                    routing_key="notification.procurement_oos",
                    message_body={
                        "event_type": "ProcurementOutOfStock",
                        "payload": {
                            "restaurant_id": effective_restaurant_id,
                            "order_id": order_id,
                            "type": "order_out_of_stock",
                            "title": f"Out of stock: {wine_name}",
                            "message": (
                                f"Provider reports {wine_name} is out of stock. "
                                f"Order cancelled and delivery removed from calendar."
                                f"{alt_text}"
                            ),
                            "urgency": "high",
                            "action_url": f"/orders?highlight={order_id}",
                            "metadata": {
                                "wine_name": wine_name,
                                "order_id": order_id,
                                "alternatives": alternatives,
                            },
                        },
                    },
                )
                self.logger.info(
                    f"Order {order_id} OOS: cancelled, calendar removed, "
                    f"shadow stock released, manager notified"
                )
            else:
                self.logger.info(
                    f"Unknown response type '{response_type}' for order {order_id}"
                )

        except Exception as e:
            self.logger.error(f"Error handling intent response: {e}")

    # =========================================================================
    # OOS HELPERS
    # =========================================================================

    async def _cancel_order_calendar_event(
        self, restaurant_id: str, order_id: str
    ) -> None:
        """Cancel the calendar delivery event that was linked to order_id."""
        try:
            result = (
                self.database.supabase.table("calendar_events")
                .select("id, tags")
                .eq("restaurant_id", restaurant_id)
                .eq("event_type", "delivery")
                .not_("status", "in", '("COMPLETED","CANCELLED")')
                .execute()
            )
            for event in result.data or []:
                try:
                    tags = event.get("tags", {})
                    if isinstance(tags, str):
                        import json as _json

                        tags = _json.loads(tags)
                    if isinstance(tags, dict) and tags.get("order_id") == order_id:
                        self.database.supabase.table("calendar_events").update(
                            {
                                "status": "CANCELLED",
                                "description": f"Order {order_id} cancelled (OOS).",
                            }
                        ).eq("id", event["id"]).execute()
                        self.logger.info(
                            f"Calendar event {event['id']} cancelled for OOS order {order_id}"
                        )
                        break
                except Exception:
                    pass
        except Exception as e:
            self.logger.warning(f"_cancel_order_calendar_event failed: {e}")

    async def _release_shadow_stock(
        self, restaurant_id: str, inventory_id: str, quantity: int
    ) -> None:
        """Subtract order quantity from shadow_stock, floored at 0."""
        try:
            result = (
                self.database.supabase.table("restaurant_inventory")
                .select("shadow_stock")
                .eq("restaurant_id", restaurant_id)
                .eq("id", inventory_id)
                .single()
                .execute()
            )
            if result.data:
                current = result.data.get("shadow_stock") or 0
                released = max(0, current - quantity)
                self.database.supabase.table("restaurant_inventory").update(
                    {"shadow_stock": released}
                ).eq("restaurant_id", restaurant_id).eq("id", inventory_id).execute()
                self.logger.info(
                    f"Released {quantity} shadow stock for inventory {inventory_id} "
                    f"({current} → {released})"
                )
        except Exception as e:
            self.logger.warning(f"_release_shadow_stock failed: {e}")

    async def _find_alternative_providers(
        self, restaurant_id: str, exclude_provider_id: str | None, wine_name: str
    ) -> list:
        """Return names of active providers for this restaurant, excluding the current one."""
        try:
            q = (
                self.database.supabase.table("providers")
                .select("name")
                .eq("restaurant_id", restaurant_id)
                .eq("is_active", True)
                .limit(5)
            )
            if exclude_provider_id:
                q = q.neq("id", exclude_provider_id)
            result = q.execute()
            return [p["name"] for p in (result.data or [])]
        except Exception as e:
            self.logger.warning(f"_find_alternative_providers failed: {e}")
            return []

    async def _handle_vendor_email_response(self, message: Dict[str, Any]) -> None:
        """Handle a vendor email response routed by EmailParsingAgent.

        Maps the email-level fields (subject, body, source) to the intent_response
        format the state machine already handles, using keyword-based intent detection.
        """
        payload = message.get("payload", message)
        order_id = payload.get("order_id")
        body = payload.get("body", "")
        subject = payload.get("subject", "")

        if not order_id:
            self.logger.warning("Vendor email response missing order_id — ignoring")
            return

        text = f"{subject} {body}".lower()

        # Map email text to response_type
        response_type = "unknown"
        parsed_price = None
        if any(
            w in text
            for w in [
                "confirm",
                "approved",
                "agreed",
                "accept",
                "deal",
                "order confirmed",
            ]
        ):
            response_type = "confirmed"
        elif any(w in text for w in ["cancel", "reject", "unable", "sorry", "cannot"]):
            response_type = "rejection"
        elif any(w in text for w in ["unavailable", "out of stock", "sold out"]):
            response_type = "unavailable"
        elif any(
            w in text for w in ["price", "cost", "quote", "offer", "$", "per bottle"]
        ):
            response_type = "price_update"

            # Try to extract a price
            import re

            price_match = re.search(r"\$\s*(\d+(?:\.\d{1,2})?)", text)
            if price_match:
                try:
                    parsed_price = float(price_match.group(1))
                except ValueError:
                    pass

        self.logger.info(
            f"Vendor email for order {order_id}: detected response_type={response_type}"
        )

        # Delegate to the existing intent_response handler
        await self._handle_intent_response(
            {
                "payload": {
                    "order_id": order_id,
                    "response_type": response_type,
                    "parsed_price": parsed_price,
                    "provider_id": payload.get("provider_id"),
                    "restaurant_id": payload.get("restaurant_id"),
                }
            }
        )

    async def _get_price_history(
        self, inventory_id: str, provider_id: str, limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Get recent price history for this wine/provider"""
        try:
            response = (
                self.database.supabase.table("procurement_orders")
                .select("price_per_bottle, created_at")
                .eq("inventory_id", inventory_id)
                .eq("provider_id", provider_id)
                .eq("status", "DELIVERED")
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )

            return response.data if response.data else []
        except Exception as e:
            self.logger.error(f"Failed to get price history: {e}")
            return []

    def _calculate_avg_price(self, price_history: List[Dict[str, Any]]) -> float:
        """Calculate average price from history"""
        if not price_history:
            return 25.0  # Default fallback price

        prices = [
            p.get("price_per_bottle", 0)
            for p in price_history
            if p.get("price_per_bottle")
        ]

        if not prices:
            return 25.0

        return sum(prices) / len(prices)

    async def _handle_manual_order(self, message: Dict[str, Any]) -> None:
        """
        Handle a manual order request -- same flow as auto, with explicit params.

        This still becomes a proposal rather than an order. The message carries
        no ``executed_by`` and no token-derived user id, so nothing in it is a
        confirmation record; treating "a message said a human wanted this" as
        consent is exactly the substitution ACTION-SCHEMA-SPEC §4.1 documents
        (``recurring_orders.auto_approve``) and rejects. The routing key
        ``procurement.manual_order_request`` also has no producer anywhere in the
        repo today, so there is nothing to regress — a real manager-initiated
        order goes through the authenticated gateway path
        (``procurement.service.ts`` ``createOrder``), which already stamps a user.
        """
        payload = message.get("payload", {})

        wine_name = payload.get("wine_name", "Unknown")
        wine_id = payload.get("wine_id") or payload.get("inventory_id")
        provider_id = payload.get("provider_id")
        quantity = payload.get("quantity", 6)
        target_price = payload.get("target_price")
        notes = payload.get("notes", "")

        self.logger.info(f"Manual order request: {wine_name} x{quantity}")

        if not wine_id or not provider_id:
            self.logger.error("Manual order missing wine_id or provider_id")
            return

        # Re-use the proposal flow with manual overrides
        synthetic_message = {
            "routing_key": "stock.threshold.breached",
            "payload": {
                "inventory_id": wine_id,
                "restaurant_id": payload.get("restaurant_id"),
                "wine_name": wine_name,
                "stock_after": payload.get("current_stock", 0),
                "threshold": payload.get("threshold", 3),
                "urgency": payload.get("urgency", "medium"),
                "estimated_stockout_days": 5,
                "sales_velocity_7d": 0,
                "in_transit_quantity": 0,
                "master_wine_id": payload.get("master_wine_id", wine_id),
                # Manual overrides
                "_manual": True,
                "_provider_id": provider_id,
                "_quantity": quantity,
                "_target_price": target_price,
                "_notes": notes,
            },
        }

        await self._propose_reorder(synthetic_message)

    # NOTE: _generate_negotiation_message, _parse_provider_response, _fallback_parser,
    # _send_sms_to_provider, _send_email_to_provider, _pause_for_approval,
    # _resume_conversation, _handle_conversation_rejection, and _handle_vendor_response
    # have been migrated to ProviderConversationAgent (Gateway Pattern).
    # ProcurementAgent now publishes intents and receives pre-parsed responses.

    # =========================================================================
    # VOICE NEGOTIATION METHODS
    # =========================================================================

    async def _initiate_voice_negotiation(
        self,
        order_id: str,
        provider_id: str,
        wine_name: str,
        quantity: int,
        target_price: float,
        *,
        order_approval: "VoiceOrderApproval",
    ) -> Optional[str]:
        """
        Initiate voice call negotiation with provider.

        BINDING SURFACE (FUTURES §8.1). This speaks a quantity and a price to a
        vendor and gathers an acceptance, so ``order_approval`` — a recorded
        human confirmation of these exact terms — is REQUIRED, not optional.
        The gate itself lives one layer down in ``PlivoVoiceClient`` so that a
        future caller cannot reach the phone line by going round this method;
        this signature exists so the requirement is visible at the call site too.

        The capability is additionally off unless ``VOICE_ORDER_CALLS_ENABLED``
        is set — this path has no in-repo caller today, and the flag is what
        stops it acquiring one silently.

        Args:
            order_id: Procurement order ID
            provider_id: Provider ID
            wine_name: Wine name
            quantity: Order quantity
            target_price: Target price per bottle
            order_approval: Human approval evidence for this order and terms

        Returns:
            Call UUID if successful

        Raises:
            VoiceBindingGateError: gate not satisfied. Deliberately propagates —
                the broad ``except`` below must never turn a refusal to place an
                unapproved vendor call into a quiet ``None``.
        """
        if not self.voice_client:
            self.logger.warning("Voice client not available")
            return None

        # Imported here (not at module scope) so the orchestrator's import graph
        # is unchanged; by this point the voice client module is already loaded.
        from services.plivo_voice_client import VoiceBindingGateError

        try:
            # Get provider details
            provider = await self.database.get_provider(provider_id)
            if not provider or not provider.get("contact_phone"):
                self.logger.error(f"Provider {provider_id} has no phone number")
                return None

            provider_name = provider.get("name", "Vendor")
            provider_phone = provider.get("contact_phone")

            # Generate negotiation XML. This is the gated call: it refuses unless
            # the flag is on, `order_approval` covers this order at these exact
            # terms, and the greeting passes the hard constraints.
            #
            # The XML is still not wired to an answer URL — `make_call` below
            # falls back to the default `/voice/answer` webhook — so today this
            # both builds the script and enforces the gate on it. Serving this
            # XML from the answer webhook is the follow-up slice; until then the
            # call must not be placed on a script the gate never saw.
            self.voice_client.generate_negotiation_xml(
                wine_name=wine_name,
                quantity=quantity,
                target_price=target_price,
                provider_name=provider_name,
                order_id=order_id,
                order_approval=order_approval,
            )

            # Make the call — gated again at the client on the order-shaped
            # context, so the dial cannot happen even if the XML step is skipped.
            result = await self.voice_client.make_call(
                to_number=provider_phone,
                record=True,
                context={
                    "order_id": order_id,
                    "provider_id": provider_id,
                    "wine_name": wine_name,
                    "quantity": quantity,
                    "target_price": target_price,
                    "negotiation_type": "voice",
                },
                order_approval=order_approval,
            )

            if result.get("success"):
                call_uuid = result.get("call_uuid")

                # Store voice interaction
                await self.database.order_interactions.create_voice_interaction(
                    order_id=order_id,
                    call_uuid=call_uuid,
                    direction="OUTBOUND",
                    ai_summary=f"Voice negotiation initiated for {wine_name} x{quantity}",
                )

                # Update order with voice negotiation status
                await self.database.procurement.update(
                    order_id,
                    {
                        "negotiation_attempt": 1,
                        "last_negotiation_at": datetime.now().isoformat(),
                        "state_machine_state": "AI_NEGOTIATING",
                    },
                )

                self.logger.info(
                    f"📞 Voice negotiation initiated: {wine_name} x{quantity} "
                    f"to {provider_name} (Call: {call_uuid})"
                )

                return call_uuid
            else:
                self.logger.error(f"Voice call failed: {result.get('error')}")
                return None

        except VoiceBindingGateError:
            # Never swallowed. A gate refusal means the system was one step away
            # from an unapproved commitment to a vendor; collapsing that into
            # `None` would make the most important failure here look like a
            # transient one (FUTURES §8.1).
            self.logger.error(
                f"Voice binding gate refused order {order_id} — no call placed",
                exc_info=True,
            )
            raise
        except Exception as e:
            self.logger.error(f"Error initiating voice negotiation: {e}", exc_info=True)
            return None

    async def _process_voice_call_completed(self, message: Dict[str, Any]) -> None:
        """
        Process completed voice call
        """
        payload = message.get("payload", {})

        call_uuid = payload.get("call_uuid")
        order_id = payload.get("order_id")
        duration_seconds = payload.get("duration_seconds", 0)
        recording_url = payload.get("recording_url")

        self.logger.info(f"Voice call completed: {call_uuid} ({duration_seconds}s)")

        try:
            # Update interaction with recording
            interactions = await self.database.order_interactions.get_voice_calls(
                order_id
            )
            for interaction in interactions:
                if interaction.call_uuid == call_uuid:
                    await self.database.order_interactions.update(
                        interaction.id,
                        {
                            "recording_url": recording_url,
                            "call_duration_seconds": duration_seconds,
                        },
                    )
                    break

        except Exception as e:
            self.logger.error(f"Error processing voice call completion: {e}")

    async def _process_voice_transcription(self, message: Dict[str, Any]) -> None:
        """
        Process voice call transcription by routing to ProviderConversationAgent
        for intelligence extraction (Gateway Pattern).
        """
        payload = message.get("payload", {})

        call_uuid = payload.get("call_uuid")
        order_id = payload.get("order_id")
        transcript = payload.get("transcript")
        provider_id = payload.get("provider_id")
        restaurant_id = payload.get("restaurant_id")

        self.logger.info(f"Transcription received for call {call_uuid}")

        try:
            # Route to ProviderConversationAgent for extraction
            await self.publish(
                exchange_name="conversation.events",
                routing_key="conversation.inbound.voice_transcript",
                message_body={
                    "event_type": "InboundVoiceTranscript",
                    "payload": {
                        "provider_id": provider_id,
                        "restaurant_id": restaurant_id,
                        "order_id": order_id,
                        "call_uuid": call_uuid,
                        "content": transcript,
                        "channel": "voice",
                    },
                },
                priority=7,
            )

            # Update interaction record with raw transcript
            interactions = await self.database.order_interactions.get_voice_calls(
                order_id
            )
            for interaction in interactions:
                if interaction.call_uuid == call_uuid:
                    await self.database.order_interactions.update(
                        interaction.id,
                        {
                            "transcript": transcript,
                        },
                    )
                    break

        except Exception as e:
            self.logger.error(f"Error processing transcription: {e}", exc_info=True)

    async def _handle_voice_response(
        self,
        order_id: str,
        parsed_response: Dict[str, Any],
    ) -> None:
        """
        Handle parsed voice response from provider
        """
        # Get order details
        order = await self.database.procurement.get_by_id(order_id)
        if not order:
            return

        price = parsed_response.get("price")
        parsed_response.get("availability", "unknown")

        if not price:
            # No price extracted - request manager review
            await self._request_voice_review(order_id, parsed_response)
            return

        # Compare with target price
        target_price = order.target_price_per_bottle or 0
        price_diff_percent = (
            abs(price - target_price) / target_price * 100 if target_price else 100
        )

        if price <= target_price:
            # Price accepted - proceed to approval
            await self.database.procurement.update(
                order_id,
                {
                    "negotiated_price_per_bottle": price,
                    "status": "PENDING_APPROVAL",
                    "state_machine_state": "NEGOTIATION_REVIEW",
                },
            )

            # Notify manager
            await self._notify_voice_negotiation_success(order_id, order, price)

        elif price_diff_percent <= self.price_tolerance_percent:
            # Price within tolerance - auto-approve
            await self.database.procurement.update(
                order_id,
                {
                    "negotiated_price_per_bottle": price,
                    "status": "PENDING_APPROVAL",
                    "state_machine_state": "NEGOTIATION_REVIEW",
                },
            )

            await self._notify_voice_negotiation_success(order_id, order, price)

        else:
            # Price too high - request manager decision
            await self._request_voice_review(order_id, parsed_response, price)

    def _generate_transcript_summary(self, parsed: Dict[str, Any]) -> str:
        """
        Generate summary from parsed transcript
        """
        parts = []

        if parsed.get("price"):
            parts.append(f"Price offered: ${parsed['price']:.2f}/bottle")

        if parsed.get("availability"):
            parts.append(f"Availability: {parsed['availability']}")

        if parsed.get("delivery_days"):
            parts.append(f"Delivery: {parsed['delivery_days']} days")

        if parsed.get("conditions"):
            parts.append(f"Conditions: {parsed['conditions']}")

        return " | ".join(parts) if parts else "No specific details extracted"

    async def _notify_voice_negotiation_success(
        self,
        order_id: str,
        order,
        negotiated_price: float,
    ) -> None:
        """
        Notify manager of successful voice negotiation
        """
        await self.publish(
            exchange_name="notification.events",
            routing_key="notification.voice_negotiation_complete",
            message_body={
                "event_type": "VoiceNegotiationComplete",
                "payload": {
                    "type": "voice_negotiation_success",
                    "priority": "high",
                    "order_id": order_id,
                    "wine_name": order.wine_name,
                    "quantity": order.quantity,
                    "negotiated_price": negotiated_price,
                    "target_price": order.target_price_per_bottle,
                    "message": (
                        f"📞 Voice negotiation successful!\n"
                        f"Wine: {order.wine_name}\n"
                        f"Quantity: {order.quantity}\n"
                        f"Price: ${negotiated_price:.2f}/bottle\n"
                        f"Total: ${negotiated_price * order.quantity:.2f}\n\n"
                        f"Approve this order?"
                    ),
                    "actions": [
                        {"id": "approve", "label": "Approve Order", "style": "primary"},
                        {
                            "id": "listen",
                            "label": "Listen to Recording",
                            "style": "secondary",
                        },
                        {"id": "reject", "label": "Reject", "style": "danger"},
                    ],
                    "notification_channels": {"push": True, "onetap": True},
                },
            },
            priority=7,
        )

    async def _request_voice_review(
        self,
        order_id: str,
        parsed_response: Dict[str, Any],
        price: Optional[float] = None,
    ) -> None:
        """
        Request manager review of voice negotiation
        """
        order = await self.database.procurement.get_by_id(order_id)
        if not order:
            return

        await self.publish(
            exchange_name="notification.events",
            routing_key="notification.voice_review_needed",
            message_body={
                "event_type": "VoiceReviewNeeded",
                "payload": {
                    "type": "voice_review_needed",
                    "priority": "high",
                    "order_id": order_id,
                    "wine_name": order.wine_name,
                    "parsed_response": parsed_response,
                    "offered_price": price,
                    "target_price": order.target_price_per_bottle,
                    "message": (
                        f"📞 Voice negotiation needs review\n"
                        f"Wine: {order.wine_name}\n"
                        f"Offered: ${price:.2f}/bottle\n"
                        if price
                        else "Price unclear\n"
                        f"Target: ${order.target_price_per_bottle:.2f}/bottle\n"
                        f"Please review the call recording."
                    ),
                    "actions": [
                        {
                            "id": "listen",
                            "label": "Listen to Recording",
                            "style": "primary",
                        },
                        {"id": "accept", "label": "Accept Offer", "style": "secondary"},
                        {
                            "id": "counter",
                            "label": "Counter Offer",
                            "style": "secondary",
                        },
                        {"id": "reject", "label": "Reject", "style": "danger"},
                    ],
                    "notification_channels": {"push": True, "onetap": True},
                },
            },
            priority=8,
        )

    async def health_check(self) -> Dict[str, Any]:
        """Surface the origination tier where an operator can see it."""
        health = await super().health_check()
        health["autonomy_tier"] = AUTONOMY_TIER
        health["can_create_orders"] = False
        return health

    async def cleanup(self) -> None:
        """Cleanup voice resources (LLM now owned by ProviderConversationAgent)"""
        self.llm_client = None
        self.voice_client = None
        self.logger.info("Procurement Agent cleaned up")
