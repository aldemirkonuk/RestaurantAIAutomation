"""
RFQ Agent (Request for Quotation) — propose-only on solicitation
================================================================
AI-powered polite bidding system with:
- Multi-vendor RFQ **proposal** (a human sends it, never this agent)
- Response parsing and comparison
- Best offer selection
- Manager notification

WHAT CHANGED AND WHY (second ungated par-crossing → vendor path)
---------------------------------------------------------------
This agent subscribed to ``stock.threshold.breached`` — the same par-crossing
event that ``procurement_agent`` did — and turned it into outbound vendor
contact with no human anywhere in the path:

    stock.threshold.breached
      → _handle_low_stock
      → _initiate_rfq
      → _send_rfq_to_vendor          (once per selected vendor)
      → publish notification.send_sms   to vendor.contact_phone
      → publish notification.send_email to vendor.contact_email

One par crossing produced N outbound commercial contacts in the restaurant's
name. That is sense → act with no confirmation record, the violation
FUTURES §8.1 exists to prevent:

    Ask → propose → confirm → execute. AI never silently mutates stock, money,
    or outbound vendor email. Confirmation is the gate; existing services are
    the executors.

FUTURES §8.2 is more specific still: "sending email without draft review" is
named in the *out of MVP / gated harder* set.

**The subtlety that made this easy to miss.** The agent's *order-placement*
half was gated — ``_handle_manager_selection`` only reaches
``_create_order_from_rfq`` on an explicit ``action == "approve"``. Only the
**solicitation** half was open. Soliciting a quote is not "just asking": it is
an outbound commercial contact in the restaurant's name, and this repo already
treats vendor-facing language as legally sensitive (the UCC contract-formation
guardrail, ``core/commitment_patterns.py``, generated from the TypeScript canon
and kept in sync by a blocking CI job).

**It was inert, and inert is not safe.** Three independent accidents kept it
from firing, and *any one of them changing re-opens it*:

  1. ``rfq_agent`` is ``AgentTier.ON_DEMAND`` (``core/agent_registry.py:162-166``),
     so the orchestrator never instantiates it on boot. One tier edit undoes this.
  2. ``_send_rfq_to_vendor`` returned early when ``mock_mode`` was true, and
     ``mock_mode`` defaulted to true. One config value undoes this.
  3. Nothing *delivers* ``notification.send_sms`` / ``notification.send_email``.
     Note this is NOT "nothing consumes them": the gateway bridge binds
     ``notification.#`` on ``notification.events``
     (``apps/api-gateway/src/common/orchestrator/rabbitmq-bridge.service.ts:186-188``),
     so these messages ARE consumed — ``handleNotificationEvent`` just turns
     them into a websocket toast and drops them for want of a ``restaurant_id``.
     One SMS/email worker subscribing to those keys undoes this.

Treating "inert" as "safe" is exactly the reasoning that left ``procurement_agent``
open until it was found. So the gate closes on the code path, not on the plumbing.

What replaced it, following ``procurement_agent`` and ``recurring_order_agent``
(PR #152) rather than inventing a second shape:

* ``_send_rfq_to_vendor`` is **deleted, not disabled**. A flag that can be
  flipped back is not a gate. There is no method in this module that publishes
  ``notification.send_sms`` or ``notification.send_email``, and no vendor
  ``contact_phone`` / ``contact_email`` is read anywhere on the origination path.
  ``_initiate_rfq`` and the public ``initiate_rfq`` wrapper are gone with it.
* ``_build_rfq_plan`` keeps the RFQ reasoning whole — vendor selection,
  quantity, delivery date, template choice and the composed quote-request text —
  as a **side-effect-free** method. It reads inventory and providers and returns
  a plan; it writes nothing, publishes nothing, and stages nothing. That is
  where the solicitation logic went: the future hop-4 bridge can reuse the
  reasoning without inheriting the ability to act on it.
* ``_propose_rfq_solicitation`` stages a ``one_tap_actions`` row
  (``status='pending'``, null ``executed_by``/``executed_at``), writes a
  ``decision_log`` row, and notifies the manager. The confirmation stamp is
  written later by ``OneTapActionsService.executeAction`` from the
  authenticated user id; nothing in this file can produce it.
* ``_emit_action_proposal`` is the enforcement point, the same shape as
  ``recurring_order_agent._emit_action_proposal`` (ACTION-SCHEMA-SPEC.md §1
  invariant 1 names that method as the reference implementation) and
  ``procurement_agent``'s copy, so all three proposers enforce one rule one way
  instead of drifting apart. It refuses any row that arrives already confirmed.
* **Commitment-language gate.** The composed quote request is checked against
  ``core.commitment_patterns.contains_commitment_language`` before it can be
  staged. All three templates are clean today; this makes that a *property the
  code enforces* rather than a fact that happens to hold. A template edit that
  introduces binding language fails the proposal closed instead of putting a
  contract-forming sentence in front of a one-tap approve button.
* **Fail closed.** Every failure on this path does nothing. If the plan cannot
  be built, if the text trips the commitment guardrail, or if the proposal
  cannot be staged, the agent records the refusal and returns. There is no
  fallback to direct send, because there is no remaining code path that could
  reach a vendor.

``action_family`` is ``communications``, not ``procurement``. Per
ACTION-SCHEMA-SPEC.md §2 the family is bound to the effect, and the effect here
is FUTURES §8.2's Communications row — "Provider draft (existing outbound
engine; manager approve)". ``procurement_agent`` proposes *placing an order* and
is correctly ``procurement``; this proposes *sending a solicitation*. The gate
mechanism is identical; only the field that describes the effect differs.

The carve-out, stated plainly because a blanket claim here would be false: the
inbound half of this agent still writes directly — ``_process_vendor_response``
records a quote, ``_compare_and_present_offers`` selects a winner,
``_handle_manager_selection`` drives status. That is bookkeeping on an RFQ a
human already approved, reacting to what a vendor said. It can record or unwind
a solicitation, never originate one. Same split ``drift_agent`` draws
(``drift_agent.py:8-17``).

Core Philosophy: "Polite Bidding" — professional tone, no aggressive
negotiation, let vendors compete naturally, present the best offer
transparently. Unchanged; it is now a human who presses send.
"""

from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
import json
import re
import time

from core.base_agent import BaseAgent
from core.commitment_patterns import contains_commitment_language
from core.database import RFQRequest, Provider
from config.settings import get_settings


# Typed action envelope (ACTION-SCHEMA-SPEC.md §1). Module constants so the
# spec, this agent and the tests all name the same strings.
#
# `communications`, not `procurement`: §2 binds the family to the effect, and
# the effect is an outbound vendor message (FUTURES §8.2 Communications row).
ACTION_FAMILY = "communications"
ACTION_KIND = "communications.rfq.solicit"
AUTONOMY_TIER = "propose_only"

# one_tap_actions.action_type is a Postgres enum (public.one_tap_action_type,
# migration 20260805000000_baseline_from_production.sql:173). 'custom' is the
# interim carrier ACTION-SCHEMA-SPEC §4.1 prescribes until step 6 of its
# migration order adds a first-class value; the real family/kind live in
# metadata. Deliberately NOT 'low_stock': the renderers and
# OneTapActionsService.triggerWorkflow dispatch on this column, and inventing a
# dispatch target for a proposal is how a proposal becomes an execution. This
# matches procurement_agent and recurring_order_agent exactly.
ONE_TAP_ACTION_TYPE = "custom"
PROPOSAL_STATUS = "pending"

DECISION_RFQ_PROPOSAL = "rfq_solicitation_proposal"
DECISION_RFQ_BLOCKED = "rfq_solicitation_blocked"

# The manager-facing announcement. `notification.events` is bound `notification.#`
# by the gateway bridge (apps/api-gateway/src/common/orchestrator/
# rabbitmq-bridge.service.ts:186-188), so this reaches the frontend the same way
# the winner presentation below does.
EXCHANGE_NOTIFICATION = "notification.events"
RK_RFQ_PROPOSED = "notification.rfq_solicitation_proposed"


class RFQSafetyError(RuntimeError):
    """
    Raised when a caller tries to write a vendor-contact action that is already
    confirmed. Not defensive decoration: it is the assertion that keeps the
    propose→confirm→execute gate from being edited away silently.
    """


class RFQAgent(BaseAgent):
    """
    RFQ Agent - Polite Bidding System, propose-only on solicitation

    Workflow:
    1. Trigger: Low stock detected
    2. Select 3 vendors from `competitor_group` for the wine category
    3. Compose the RFQ text:
       "Hi [Name], I'm looking to buy [Qty] cases of [Wine Name] for this Friday.
       What is the best price you can do for us? Thanks."
    4. **Propose** the solicitation; a human approves it and the outbound engine
       sends it. Steps 1-3 are reasoning; this agent stops here.
    5. Parse vendor replies (via email/SMS webhooks)
    6. Extract price, availability, delivery timeline
    7. Compare offers
    8. Present winner to manager for approval

    Autonomy tier: ``propose_only`` for **solicitation**. This class cannot
    publish a vendor-facing message and cannot read a vendor's phone or email on
    the origination path, so no event it consumes can contact a vendor.
    """

    # Read by tests and by anything auditing agent autonomy without importing
    # the module's constants.
    AUTONOMY_TIER = AUTONOMY_TIER

    def __init__(self, agent_name: str, message_bus, database, config: Dict[str, Any]):
        super().__init__(agent_name, message_bus, database, config)

        # Configuration
        #
        # `mock_mode` no longer gates anything on the origination path — it used
        # to be the early return inside `_send_rfq_to_vendor` that made the
        # ungated send look harmless. It is kept because `_parse_vendor_response`
        # still branches on it for the inbound half.
        self.mock_mode = config.get("mock_mode", True)
        self.default_vendor_count = config.get("default_vendor_count", 3)
        self.response_timeout_hours = config.get("response_timeout_hours", 24)

        # LLM for response parsing
        # Reasoning-shaped: vendor-quote interpretation runs on Claude via the
        # Anthropic client, so the fallback is the Claude primary (OD-57).
        self.llm_model = config.get("llm_model", get_settings().llm_primary_model)
        self.google_api_key = config.get("google_api_key")
        self.llm_client = None

        # RFQ templates.
        #
        # These are vendor-facing commercial language. They are checked against
        # the UCC contract-formation guardrail at composition time
        # (`_compose_quote_request`) — all three are clean today, and the check
        # is what keeps that true after a future edit.
        self.rfq_templates = {
            "standard": (
                "Hi {vendor_name},\n\n"
                "I'm looking to buy {quantity} {unit} of {wine_name} "
                "for delivery by {delivery_date}.\n\n"
                "What is the best price you can do for us?\n\n"
                "Thanks!"
            ),
            "urgent": (
                "Hi {vendor_name},\n\n"
                "We need {quantity} {unit} of {wine_name} urgently - "
                "delivery needed by {delivery_date}.\n\n"
                "Please let us know your best price and availability ASAP.\n\n"
                "Thanks!"
            ),
            "bulk": (
                "Hi {vendor_name},\n\n"
                "We're looking to place a bulk order for {quantity} {unit} of {wine_name}.\n\n"
                "Given the volume, what is the best price you can offer? "
                "Delivery needed by {delivery_date}.\n\n"
                "Thanks!"
            ),
        }

    async def initialize(self) -> None:
        """Initialize RFQ Agent"""
        self.logger.info("Initializing RFQ Agent")

        if self.mock_mode:
            self.logger.warning("⚠️ Running in MOCK mode")
        else:
            # Anthropic, not Gemini (OD-57). The orchestrator fills llm_model
            # from llm_primary_model — a Claude id — and this handed it to
            # genai.GenerativeModel(), so the one real call site could never
            # succeed. The model stays Claude; the client is what changed.
            try:
                from services.model_clients import get_anthropic_client

                self.llm_client = get_anthropic_client()
                self.logger.info(f"✓ Anthropic client initialized ({self.llm_model})")
            except Exception as e:
                self.logger.error(f"Failed to initialize LLM client: {e}")

        self.logger.info(
            f"✓ RFQ Agent initialized (autonomy_tier={AUTONOMY_TIER}; "
            "solicitation is proposed, never sent)"
        )

    def get_subscribed_routing_keys(self) -> List[tuple[str, str]]:
        return [
            ("stock.events", "stock.threshold.breached"),
            ("rfq.events", "rfq.initiate_request"),
            ("rfq.events", "rfq.vendor_response_received"),
            ("rfq.events", "rfq.timeout_check"),
            ("rfq.events", "rfq.manager_selection"),
        ]

    async def process_message(self, message: Dict[str, Any]) -> None:
        routing_key = message.get("routing_key")

        if routing_key == "stock.threshold.breached":
            await self._propose_rfq_solicitation(message)
        elif routing_key == "rfq.initiate_request":
            # Same proposal path, deliberately. A message asserting that someone
            # wants an RFQ carries no executed_by, and treating it as consent is
            # the substitution ACTION-SCHEMA-SPEC §4.1 documents and rejects.
            # This key has no producer in the repo today.
            await self._propose_rfq_solicitation(message)
        elif routing_key == "rfq.vendor_response_received":
            await self._process_vendor_response(message)
        elif routing_key == "rfq.timeout_check":
            await self._check_rfq_timeouts(message)
        elif routing_key == "rfq.manager_selection":
            await self._handle_manager_selection(message)

    # =========================================================================
    # PAR CROSSING → PROPOSAL (never an outbound vendor contact)
    # =========================================================================

    def _compose_quote_request(
        self,
        vendor_name: str,
        wine_name: str,
        quantity: int,
        delivery_date: str,
        urgency: str = "normal",
    ) -> Optional[str]:
        """
        Compose the quote-request text for one vendor. Pure: no I/O, no writes.

        This is the message-composition half of the RFQ reasoning, lifted out of
        the deleted ``_send_rfq_to_vendor`` so the wording logic survives without
        the send that used to follow it two lines later.

        Returns ``None`` when the composed text trips the UCC contract-formation
        guardrail. Callers must treat that as "do not stage this" — see
        ``_build_rfq_plan``. A solicitation that could form a binding commitment
        is not something to put behind a one-tap approve button, even with a
        human on the button.
        """
        # Select template based on urgency and quantity — unchanged logic.
        if urgency == "urgent":
            template_key = "urgent"
        elif quantity >= 24:
            template_key = "bulk"
        else:
            template_key = "standard"

        text = self.rfq_templates[template_key].format(
            vendor_name=vendor_name,
            quantity=quantity,
            unit="bottles",
            wine_name=wine_name,
            delivery_date=delivery_date,
        )

        if contains_commitment_language(text):
            self.logger.error(
                "Refusing to stage an RFQ for %s: the %s template composed text "
                "containing binding commitment language (AI-SPEC §6 / OD-44). "
                "Nothing was proposed and no vendor was contacted.",
                wine_name,
                template_key,
            )
            return None

        return text

    async def _build_rfq_plan(
        self, payload: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """
        Decide WHICH vendors to ask, HOW MUCH to ask for, BY WHEN, and WHAT to
        say — and nothing else.

        This is the vendor-selection, quantity, delivery-date and
        quote-request-composition logic that used to live inline across
        ``_initiate_rfq`` and ``_send_rfq_to_vendor``, kept whole. It is
        deliberately **pure with respect to side effects**: it reads inventory
        and providers and returns a plan. It creates no RFQ record, publishes no
        event, stages no proposal, and contacts nobody.

        That separation is the point. The future hop-4 bridge needs this
        reasoning and must not inherit the ability to act on it, so the reasoning
        lives in a method that structurally cannot.

        Vendor contact details are deliberately NOT carried in the plan. The
        executor resolves ``provider_id`` against the providers table when a
        human approves; copying phone numbers and addresses into a proposals row
        would duplicate vendor PII into a second table for no benefit, and would
        put the exact fields the deleted send path used back within reach.

        Returns ``None`` when the plan cannot be built (missing inventory, no
        vendors, guardrail-tripping text), which callers must treat as
        "do nothing".
        """
        inventory_id = payload.get("inventory_id")
        wine_name = payload.get("wine_name")
        restaurant_id = payload.get("restaurant_id")
        urgency = payload.get("urgency", "normal")
        quantity = payload.get("quantity")

        inventory = await self.database.inventory.get_by_id(inventory_id)
        if not inventory:
            self.logger.error(f"Inventory not found: {inventory_id}")
            return None

        # Calculate quantity if not provided — unchanged logic.
        if not quantity:
            threshold = inventory.threshold_min
            quantity = max(threshold * 3, 12)  # Default to 3x threshold or 12

        # Calculate delivery date (default: 5 days from now) — unchanged logic.
        delivery_date = (datetime.utcnow() + timedelta(days=5)).strftime("%Y-%m-%d")
        if urgency == "urgent":
            delivery_date = (datetime.utcnow() + timedelta(days=2)).strftime("%Y-%m-%d")

        vendors = await self._select_competitor_vendors(
            wine_name=wine_name,
            count=self.default_vendor_count,
        )

        if not vendors:
            self.logger.warning(f"No vendors found for {wine_name}")
            return None

        solicitations: List[Dict[str, Any]] = []
        for vendor in vendors:
            text = self._compose_quote_request(
                vendor_name=vendor.name,
                wine_name=wine_name,
                quantity=quantity,
                delivery_date=delivery_date,
                urgency=urgency,
            )
            if text is None:
                # Guardrail tripped. Fail the WHOLE plan closed rather than
                # quietly proposing a shorter vendor list — a partial RFQ that
                # silently dropped a vendor is a worse artefact than none.
                return None
            solicitations.append(
                {
                    "vendor_id": vendor.id,
                    "vendor_name": vendor.name,
                    # Channel availability, not the addresses themselves.
                    "has_phone": bool(getattr(vendor, "contact_phone", None)),
                    "has_email": bool(getattr(vendor, "contact_email", None)),
                    "message": text,
                }
            )

        return {
            "restaurant_id": restaurant_id,
            "inventory_id": inventory_id,
            "wine_name": wine_name,
            "quantity": quantity,
            "unit": "bottles",
            "delivery_date": delivery_date,
            "urgency": urgency,
            "vendor_count": len(solicitations),
            "solicitations": solicitations,
        }

    async def _propose_rfq_solicitation(
        self, message: Dict[str, Any]
    ) -> Optional[str]:
        """
        Turn a par crossing (or an RFQ request) into a proposal a human taps.

        Replaces ``_handle_low_stock`` → ``_initiate_rfq`` → ``_send_rfq_to_vendor``,
        which published ``notification.send_sms`` / ``notification.send_email``
        straight at ``vendor.contact_phone`` / ``vendor.contact_email`` with no
        confirmation record anywhere in the path. All three are gone; see the
        module docstring.

        Fails closed. Every early return does nothing, and there is no branch
        that contacts a vendor. Returns the staged action id, or None.
        """
        payload = message.get("payload", {}) or {}

        try:
            plan = await self._build_rfq_plan(payload)
            if not plan:
                return None

            inventory_id = plan["inventory_id"]
            restaurant_id = plan["restaurant_id"]
            wine_name = plan["wine_name"] or "Unknown wine"

            # Pre-existing dedup, preserved: an RFQ already in flight for this
            # wine means there is nothing to ask again.
            existing_rfqs = await self.database.rfq_requests.get_by_inventory(
                inventory_id
            )
            pending_rfqs = [
                r
                for r in (existing_rfqs or [])
                if r.status in ["pending", "responses_received"]
            ]
            if pending_rfqs:
                self.logger.info(f"RFQ already pending for {wine_name}, skipping")
                return None

            # Idempotency on the envelope, not the executor (ACTION-SCHEMA-SPEC
            # §1 invariant 5): a par that keeps breaching must not stack a
            # proposal per event.
            existing = await self._find_open_proposal(inventory_id, restaurant_id)
            if existing:
                self.logger.info(
                    f"RFQ proposal {existing} is already open for inventory "
                    f"{inventory_id} — not staging a second one"
                )
                return existing

            decision_id = await self.log_decision(
                decision_type=DECISION_RFQ_PROPOSAL,
                inputs=plan,
                output={
                    "action": "proposal",
                    "autonomy_tier": AUTONOMY_TIER,
                    "status": PROPOSAL_STATUS,
                    "executed": False,
                    "vendors_contacted": 0,
                    "messages_sent": 0,
                },
                reasoning=(
                    "Stock crossed its reorder threshold. Composed a quote "
                    "request for each candidate vendor and staged a pending "
                    "one_tap_actions proposal for manager confirmation. No "
                    "vendor was contacted: FUTURES §8.1 requires a confirmation "
                    "record (executed_by/executed_at) against this specific "
                    "action before any outbound vendor message is sent, and "
                    "§8.2 puts un-reviewed outbound email in the gated-harder "
                    "set."
                ),
                confidence=0.9,
                restaurant_id=restaurant_id,
            )

            action_id = await self._emit_action_proposal(
                {
                    "restaurant_id": restaurant_id,
                    "action_type": ONE_TAP_ACTION_TYPE,
                    "title": f"Quote request ready: {wine_name}",
                    "description": (
                        f"{wine_name} is low. A request for {plan['quantity']} "
                        f"{plan['unit']} by {plan['delivery_date']} is drafted for "
                        f"{plan['vendor_count']} vendor(s). "
                        "Approve to send these quote requests."
                    ),
                    "priority": "high" if plan["urgency"] == "urgent" else "medium",
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
                # the unacceptable one would be contacting the vendors anyway,
                # and no code path here can do that.
                self.logger.error(
                    f"Could not stage an RFQ proposal for {wine_name} "
                    f"(inventory {inventory_id}) — no vendor was contacted"
                )
                await self.log_decision(
                    decision_type=DECISION_RFQ_BLOCKED,
                    inputs=plan,
                    output={
                        "action": "none",
                        "executed": False,
                        "vendors_contacted": 0,
                    },
                    reasoning=(
                        "Proposal staging failed. Failing closed: no RFQ was "
                        "created and no vendor was contacted."
                    ),
                    confidence=1.0,
                    restaurant_id=restaurant_id,
                )
                return None

            # Tell the manager there is something to look at. This is the only
            # publish on this path, it is manager-facing, and it carries no
            # vendor address because nothing has been sent.
            await self.publish(
                exchange_name=EXCHANGE_NOTIFICATION,
                routing_key=RK_RFQ_PROPOSED,
                message_body={
                    "event_type": "RFQSolicitationProposed",
                    "payload": {
                        "restaurant_id": restaurant_id,
                        "type": "rfq_solicitation_proposed",
                        "one_tap_action_id": action_id,
                        "inventory_id": inventory_id,
                        "wine_name": wine_name,
                        "quantity": plan["quantity"],
                        "vendor_count": plan["vendor_count"],
                        "delivery_date": plan["delivery_date"],
                        "title": f"Quote request ready: {wine_name}",
                        "message": (
                            f"{wine_name} is low. Quote requests to "
                            f"{plan['vendor_count']} vendor(s) are waiting for "
                            "your approval."
                        ),
                        "urgency": plan["urgency"],
                        "action_url": "/orders",
                    },
                },
                priority=7 if plan["urgency"] == "urgent" else 5,
            )

            self.logger.info(
                f"Staged RFQ proposal {action_id}: {wine_name} x{plan['quantity']} "
                f"for {plan['vendor_count']} vendor(s) "
                "(pending human approval; no vendor contacted)"
            )
            return action_id

        except Exception as e:
            self.logger.error(f"Error proposing RFQ: {e}", exc_info=True)
            return None

    async def _emit_action_proposal(self, row: Dict[str, Any]) -> Optional[str]:
        """
        THE ENFORCEMENT POINT for the no-auto-send guarantee.

        Copied deliberately from ``recurring_order_agent._emit_action_proposal``
        (ACTION-SCHEMA-SPEC.md §1 invariant 1 names that method as the reference
        implementation) and matching ``procurement_agent``'s copy, so all three
        proposers enforce the same rule the same way rather than drifting apart.

        This is the only method in the agent that writes a vendor-contact-shaped
        row, and it refuses any row that arrives already confirmed — a status
        other than ``pending``, or a populated ``executed_by`` / ``executed_at``
        / ``execution_result``. The confirmation stamp belongs to the API gateway
        (``apps/api-gateway/src/one-tap-actions/one-tap-actions.service.ts``),
        written after a human taps approve; an agent writing it would forge
        consent and be, at rest, indistinguishable from a real approval.

        It validates caller-supplied data rather than data it built itself, so it
        still fails on a future caller that reintroduces sending — which is the
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
            raise RFQSafetyError(
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
        Return the id of an already-pending RFQ proposal for this wine.

        Same shape as ``procurement_agent._find_open_proposal`` and
        ``recurring_order_agent``'s, keyed on ``action_kind`` so the two
        procurement-adjacent proposers do not deduplicate against each other.
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

    async def _select_competitor_vendors(
        self,
        wine_name: str,
        count: int = 3,
    ) -> List[Provider]:
        """
        Select competitor vendors for RFQ. Read-only.

        Selection criteria:
        1. Match competitor_group if available
        2. Active vendors only
        3. Prefer vendors with good ratings
        """
        try:
            # Get all active providers
            providers = await self.database.providers.get_active_providers()

            if not providers:
                return []

            # Filter by competitor group if possible
            # (In real implementation, would match wine category to competitor_group)

            # Sort by rating (if available)
            sorted_providers = sorted(
                providers,
                key=lambda p: p.rating or 0,
                reverse=True,
            )

            # Return top N vendors
            return sorted_providers[:count]

        except Exception as e:
            self.logger.error(f"Error selecting vendors: {e}")
            return []

    # =========================================================================
    # INBOUND HALF — bookkeeping on an RFQ a human already approved
    # =========================================================================

    async def _process_vendor_response(self, message: Dict[str, Any]) -> None:
        """
        Process vendor response to RFQ

        Parse response to extract:
        - Price
        - Availability
        - Delivery timeline
        """
        payload = message.get("payload", {})

        rfq_id = payload.get("rfq_id")
        vendor_id = payload.get("vendor_id")
        response_text = payload.get("response_text")
        payload.get("channel", "sms")

        self.logger.info(f"Processing vendor response for RFQ {rfq_id}")

        try:
            # Parse response
            parsed = await self._parse_vendor_response(response_text)

            # Add response to RFQ
            await self.database.rfq_requests.add_vendor_response(
                rfq_id=rfq_id,
                vendor_id=vendor_id,
                price=parsed.get("price", 0),
                availability=parsed.get("availability", "unknown"),
                delivery_date=parsed.get("delivery_date"),
            )

            # Get updated RFQ
            rfq = await self.database.rfq_requests.get_by_id(rfq_id)

            # Check if we have enough responses
            if rfq and rfq.vendor_responses and len(rfq.vendor_responses) >= 2:
                # Compare offers and present winner
                await self._compare_and_present_offers(rfq)

        except Exception as e:
            self.logger.error(f"Error processing vendor response: {e}", exc_info=True)

    async def _parse_vendor_response(self, response_text: str) -> Dict[str, Any]:
        """
        Parse vendor response using LLM
        """
        if self.mock_mode:
            return {
                "price": 25.00,
                "availability": "in_stock",
                "delivery_date": (datetime.utcnow() + timedelta(days=3)).strftime(
                    "%Y-%m-%d"
                ),
                "notes": "Mock parsed response",
            }

        if not self.llm_client:
            return self._fallback_parse_response(response_text)

        try:
            prompt = f"""Parse this vendor response to an RFQ (Request for Quotation).

Response: "{response_text}"

Extract JSON:
{{
  "price": <price per bottle as number, or null>,
  "availability": "in_stock" | "limited" | "backorder" | "unavailable",
  "delivery_date": "<YYYY-MM-DD format, or null>",
  "minimum_order": <minimum order quantity, or null>,
  "notes": "<any special conditions or notes>"
}}

Respond with valid JSON only."""

            _t0 = time.perf_counter()
            response = await self.llm_client.messages.create(
                model=self.llm_model,
                max_tokens=1024,
                messages=[{"role": "user", "content": prompt}],
            )
            text = "".join(b.text for b in response.content if b.type == "text")
            _elapsed_ms = int((time.perf_counter() - _t0) * 1000)

            # OD-75: the parse runs FIRST so the outcome can report whether the
            # completion was usable. Logging above it graded prose as a completed
            # task — `success` on a row that only proved the call returned 200.
            #
            # Anthropic has no response_mime_type, so JSON can arrive wrapped in
            # prose; a parse failure degrades to the regex fallback below.
            _parsed: Optional[Dict[str, Any]] = None
            _parse_failed = False
            try:
                _m = re.search(r"\{.*\}", text, re.DOTALL)
                _parsed = json.loads(_m.group() if _m else text)
            except (json.JSONDecodeError, ValueError) as exc:
                _parse_failed = True
                self.logger.warning(f"RFQ response parse failed: {exc}")

            # P1: previously an unlogged model call (dark site).
            # Emitted on BOTH paths — the tokens were spent before the parse ran.
            try:
                from services.spend_logger import estimate_llm_cost, get_spend_logger

                _in = response.usage.input_tokens or 0
                _out = response.usage.output_tokens or 0
                get_spend_logger().log(
                    provider="anthropic",
                    model=self.llm_model,
                    input_tokens=_in,
                    output_tokens=_out,
                    cost_usd=estimate_llm_cost(self.llm_model, _in, _out),
                    agent=self.agent_name,
                    task_type="rfq_response_parse",
                    choice="quote:parse_failed" if _parse_failed else "quote:parsed",
                    outcome="partial" if _parse_failed else "success",
                    duration_ms=_elapsed_ms,
                    correlation_id=getattr(self, "_current_correlation_id", None),
                    context={
                        "outcome_basis": "parse_v1",
                        "parse_failed": _parse_failed,
                    },
                )
            except Exception:
                pass

            if _parse_failed:
                return self._fallback_parse_response(response_text)
            return _parsed

        except Exception as e:
            self.logger.error(f"LLM parsing failed: {e}")
            return self._fallback_parse_response(response_text)

    def _fallback_parse_response(self, response_text: str) -> Dict[str, Any]:
        """
        Fallback regex-based response parsing
        """
        import re

        result = {
            "price": None,
            "availability": "unknown",
            "delivery_date": None,
            "notes": "",
        }

        # Extract price
        price_match = re.search(r"\$?\s*(\d+(?:\.\d{2})?)", response_text)
        if price_match:
            result["price"] = float(price_match.group(1))

        # Detect availability
        text_lower = response_text.lower()
        if any(word in text_lower for word in ["in stock", "available", "have"]):
            result["availability"] = "in_stock"
        elif any(word in text_lower for word in ["limited", "few", "last"]):
            result["availability"] = "limited"
        elif any(word in text_lower for word in ["backorder", "week", "wait"]):
            result["availability"] = "backorder"
        elif any(
            word in text_lower for word in ["unavailable", "out of stock", "sorry"]
        ):
            result["availability"] = "unavailable"

        return result

    async def _compare_and_present_offers(self, rfq: RFQRequest) -> None:
        """
        Compare vendor offers and present best to manager
        """
        responses = rfq.vendor_responses or []

        if not responses:
            self.logger.warning(f"No responses to compare for RFQ {rfq.id}")
            return

        # Filter valid responses (with price)
        valid_responses = [r for r in responses if r.get("price")]

        if not valid_responses:
            self.logger.warning(f"No valid price responses for RFQ {rfq.id}")
            return

        # Sort by price (lowest first)
        sorted_responses = sorted(
            valid_responses, key=lambda r: r.get("price", float("inf"))
        )

        # Select winner
        winner = sorted_responses[0]

        # Calculate savings
        if len(sorted_responses) > 1:
            savings = sorted_responses[-1]["price"] - winner["price"]
            savings_percent = (savings / sorted_responses[-1]["price"]) * 100
        else:
            savings = 0
            savings_percent = 0

        # Update RFQ with selection
        await self.database.rfq_requests.select_winner(
            rfq_id=rfq.id,
            vendor_id=winner["vendor_id"],
            price=winner["price"],
            reason=f"Lowest price: ${winner['price']:.2f}/bottle",
        )

        # Get vendor details
        vendor = await self.database.providers.get_by_id(winner["vendor_id"])
        vendor_name = vendor.name if vendor else "Unknown Vendor"

        # Notify manager
        await self._present_winner_to_manager(
            rfq=rfq,
            winner=winner,
            vendor_name=vendor_name,
            all_responses=sorted_responses,
            savings=savings,
            savings_percent=savings_percent,
        )

    async def _present_winner_to_manager(
        self,
        rfq: RFQRequest,
        winner: Dict[str, Any],
        vendor_name: str,
        all_responses: List[Dict[str, Any]],
        savings: float,
        savings_percent: float,
    ) -> None:
        """
        Present winning offer to manager for approval
        """
        self.logger.info(
            f"🏆 Presenting winner for RFQ {rfq.id}: "
            f"{vendor_name} at ${winner['price']:.2f}/bottle"
        )

        # Build comparison summary
        comparison_summary = []
        for i, resp in enumerate(all_responses):
            vendor = await self.database.providers.get_by_id(resp["vendor_id"])
            comparison_summary.append(
                {
                    "rank": i + 1,
                    "vendor_name": vendor.name if vendor else "Unknown",
                    "price": resp["price"],
                    "availability": resp.get("availability", "unknown"),
                    "is_winner": i == 0,
                }
            )

        # Publish notification
        await self.publish(
            exchange_name="notification.events",
            routing_key="notification.rfq_winner",
            message_body={
                "event_type": "RFQWinnerPresentation",
                "payload": {
                    "type": "rfq_winner",
                    "priority": "high",
                    "rfq_id": rfq.id,
                    "wine_name": rfq.wine_name,
                    "quantity": rfq.quantity,
                    "winner": {
                        "vendor_name": vendor_name,
                        "price": winner["price"],
                        "availability": winner.get("availability"),
                        "delivery_date": winner.get("delivery_date"),
                    },
                    "comparison": comparison_summary,
                    "savings": {
                        "amount": savings,
                        "percent": savings_percent,
                    },
                    "message": (
                        f"🍷 Best Quote for {rfq.wine_name} x{rfq.quantity}:\n\n"
                        f"Winner: {vendor_name}\n"
                        f"Price: ${winner['price']:.2f}/bottle\n"
                        f"Total: ${winner['price'] * rfq.quantity:.2f}\n"
                        f"Savings: ${savings:.2f} ({savings_percent:.1f}%)\n\n"
                        f"Approve this order?"
                    ),
                    "actions": [
                        {
                            "id": "approve",
                            "label": "Approve & Order",
                            "style": "primary",
                        },
                        {
                            "id": "view_all",
                            "label": "View All Quotes",
                            "style": "secondary",
                        },
                        {"id": "reject", "label": "Reject", "style": "danger"},
                    ],
                    "notification_channels": {"push": True, "onetap": True},
                },
            },
            priority=7,
        )

    async def _check_rfq_timeouts(self, message: Dict[str, Any]) -> None:
        """
        Check for RFQ timeouts and handle accordingly
        """
        # Get all pending RFQs
        # In real implementation, would query by created_at < timeout threshold
        pass

    async def _handle_manager_selection(self, message: Dict[str, Any]) -> None:
        """
        Handle manager's selection from RFQ offers
        """
        payload = message.get("payload", {})

        rfq_id = payload.get("rfq_id")
        action = payload.get("action")
        vendor_id = payload.get("vendor_id")

        self.logger.info(f"Manager selection for RFQ {rfq_id}: {action}")

        if action == "approve":
            # Create procurement order
            await self._create_order_from_rfq(rfq_id, vendor_id)
        elif action == "reject":
            # Cancel RFQ
            await self.database.rfq_requests.update(rfq_id, {"status": "cancelled"})

    async def _create_order_from_rfq(
        self,
        rfq_id: str,
        vendor_id: Optional[str] = None,
    ) -> None:
        """
        Create procurement order from approved RFQ.

        Reached only from ``rfq.manager_selection`` with ``action == "approve"``
        — the order-placement half, which was already gated and is left as it
        was. It publishes ``procurement.create_order`` and contacts no vendor.

        NOT audited clean by this change: that gate is an *asserted* approval (a
        message claiming a manager approved) rather than a confirmation record
        with an ``executed_by``, which is the substitution ACTION-SCHEMA-SPEC
        §4.1 rejects. ``rfq.manager_selection`` has no producer in the repo
        today. Flagged for the founder rather than changed here — it is not a
        par-crossing path and it does not reach a vendor.
        """
        rfq = await self.database.rfq_requests.get_by_id(rfq_id)
        if not rfq:
            return

        # Use selected vendor or winner
        final_vendor_id = vendor_id or rfq.selected_vendor_id
        final_price = rfq.selected_price

        # Publish order creation event
        await self.publish(
            exchange_name="procurement.events",
            routing_key="procurement.create_order",
            message_body={
                "event_type": "CreateProcurementOrder",
                "payload": {
                    "inventory_id": rfq.inventory_id,
                    "restaurant_id": rfq.restaurant_id,
                    "provider_id": final_vendor_id,
                    "wine_name": rfq.wine_name,
                    "quantity": rfq.quantity,
                    "price_per_bottle": final_price,
                    "source": "rfq",
                    "rfq_id": rfq_id,
                },
            },
            priority=7,
        )

        # Update RFQ status
        await self.database.rfq_requests.update(
            rfq_id,
            {
                "status": "approved",
                "approved_at": datetime.utcnow().isoformat(),
            },
        )

        self.logger.info(f"✓ Order created from RFQ {rfq_id}")

    # =========================================================================
    # PUBLIC API METHODS
    # =========================================================================

    async def propose_rfq_solicitation(
        self,
        inventory_id: str,
        wine_name: str,
        restaurant_id: str,
        quantity: int,
        urgency: str = "normal",
    ) -> Optional[str]:
        """
        Public API: **propose** an RFQ for a wine. Nothing is sent.

        Replaces the public ``initiate_rfq``, which was a thin wrapper on the
        ungated send path and is deleted with it.

        Returns:
            The staged one_tap_actions id if a proposal was created.
        """
        return await self._propose_rfq_solicitation(
            {
                "payload": {
                    "inventory_id": inventory_id,
                    "wine_name": wine_name,
                    "restaurant_id": restaurant_id,
                    "quantity": quantity,
                    "urgency": urgency,
                }
            }
        )

    async def get_rfq_status(self, rfq_id: str) -> Optional[Dict[str, Any]]:
        """
        Public API: Get RFQ status and responses
        """
        rfq = await self.database.rfq_requests.get_by_id(rfq_id)
        if not rfq:
            return None

        return {
            "rfq_id": rfq.id,
            "wine_name": rfq.wine_name,
            "quantity": rfq.quantity,
            "status": rfq.status,
            "responses_count": len(rfq.vendor_responses or []),
            "selected_vendor_id": rfq.selected_vendor_id,
            "selected_price": rfq.selected_price,
            "created_at": rfq.created_at.isoformat() if rfq.created_at else None,
        }

    async def health_check(self) -> Dict[str, Any]:
        """Health payload, with the autonomy tier stated so an audit can read it."""
        health = await super().health_check()
        health["autonomy_tier"] = AUTONOMY_TIER
        return health

    async def cleanup(self) -> None:
        """Cleanup resources"""
        self.llm_client = None
        self.logger.info("✓ RFQ Agent cleaned up")
