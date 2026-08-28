"""
Recurring Order Agent — scheduled purchasing, propose-only
==========================================================
Owns the ``recurring_orders`` schedule: which standing order is due, when the
manager gets warned, and when the next occurrence falls.

WHAT CHANGED AND WHY (ADR 0039 Track A3)
----------------------------------------
This agent used to be a plain class ("Standalone scheduler — not a message-bus
agent") registered nowhere, with no retry, idempotency, DLQ, health, or
lifecycle — and it *placed orders*. ``_process_due_order`` branched on the
``recurring_orders.auto_approve`` column and, when set, called
``db.create_order({... "auto_approved": True})`` and then told the manager the
order "has been automatically placed". That is scheduled purchasing executed by
an agent with no recorded human confirmation, which is the single clearest
violation of FUTURES §8.1:

    Ask → propose → confirm → execute. AI never silently mutates stock, money,
    or outbound vendor email. Confirmation is the gate; existing services are
    the executors.

The order-placement path is **deleted, not disabled**. There is no
``_create_order`` here and no call to any order-writing service, because a
disabled path is one edit away from being a live one and the column that used
to gate it (``auto_approve``, default false, set once at schedule-creation
time) still exists in the database and still arrives on every row. A boolean
set months ago on a *schedule* is not a human confirming *this* purchase, at
this price, this week — so ``auto_approve`` is now advisory only: it raises the
proposal's priority and is recorded in the payload, and it never shortens the
path to execution. See ``_emit_action_proposal`` for the enforcement point.

Every due order therefore becomes a **proposal**: a ``one_tap_actions`` row with
``status='pending'`` and null ``executed_by``/``executed_at``, plus a
``decision_log`` row, plus a manager notification carrying Approve / Edit / Skip.
Execution happens later, in ``OneTapActionsService.executeAction``
(``apps/api-gateway/src/one-tap-actions/one-tap-actions.service.ts:230``), which
stamps ``executed_by`` with the authenticated user id. That stamp is the
confirmation record; nothing in this file can produce it.

Tiering follows ``drift_agent.py:8-17``: money/stock touching outcomes become
open, human-owned records; only bookkeeping (advancing ``next_order_date``) is
written directly. Registered OPTIONAL and gated off — see
``core/agent_registry.py`` DEFAULT_AGENT_SPECS — so bringing scheduled
purchasing under the harness does not switch it on.
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from core.base_agent import BaseAgent

# Bus topology. The reminder/approval keys are not invented here — NotificationAgent
# has subscribed to all three of these since Phase 21 (notification_agent.py:296-298)
# and owns the templates. `recurring.order.executed` is deliberately absent from
# this module: it is the "we placed it for you" notification, and nothing here can
# legitimately publish it any more.
EXCHANGE_RECURRING = "recurring.events"
RK_REMINDER = "recurring.order.reminder"
RK_APPROVAL_NEEDED = "recurring.order.approval_needed"

# Trigger: same idiom as drift_agent — a scheduled tick on system.control, so an
# operator or a cron job can force a sweep without waiting for the daily loop.
EXCHANGE_CONTROL = "system.control"
RK_SCHEDULE_TICK = "system.schedule.recurring_orders"

DECISION_CHECK = "recurring_order_check"
DECISION_PROPOSAL = "recurring_order_proposal"
DECISION_REMINDER = "recurring_order_reminder"

# Typed action envelope (ACTION-SCHEMA-SPEC.md). Kept as module constants so the
# spec, this agent, and the tests all name the same strings.
ACTION_FAMILY = "procurement"
ACTION_KIND = "procurement.recurring_order.place"
AUTONOMY_TIER = "propose_only"

# one_tap_actions.action_type is a Postgres enum (public.one_tap_action_type) whose
# values predate this work; 'custom' is the only member that fits a recurring PO.
# The real family/kind live in metadata until the spec's migration order adds a
# first-class value.
ONE_TAP_ACTION_TYPE = "custom"
PROPOSAL_STATUS = "pending"

REMINDER_LEAD_DAYS = 2
_ERROR_BACKOFF_SECONDS = 3600


class RecurringOrderSafetyError(RuntimeError):
    """
    Raised when a caller tries to write a purchase action that is already
    confirmed. Not defensive decoration: it is the assertion that keeps the
    propose→confirm→execute gate from being edited away silently.
    """


class RecurringOrderAgent(BaseAgent):
    """
    Scheduled purchasing under the BaseAgent harness.

    Lifecycle, retry, idempotency, DLQ, circuit breaker and health all come from
    BaseAgent. The daily sweep is kept — it runs as a task owned by this agent,
    started in ``initialize()`` and cancelled in ``cleanup()``, and it honours
    the harness pause/resume events rather than a private ``self.running`` flag.

    Autonomy tier: propose_only. This class has no order-placement path.
    """

    # Read by tests and by anything auditing agent autonomy without importing
    # the module's constants.
    AUTONOMY_TIER = AUTONOMY_TIER

    def __init__(
        self,
        agent_name: str,
        message_bus: Any,
        database: Any,
        config: Dict[str, Any],
    ):
        super().__init__(agent_name, message_bus, database, config)
        # AgentConfig ignores unknown keys, so agent-specific settings have to be
        # kept off it.
        self._settings: Dict[str, Any] = dict(config or {})
        self._scheduler_task: Optional[asyncio.Task] = None

    # =========================================================================
    # Harness contract
    # =========================================================================

    async def initialize(self) -> None:
        self.logger.info("Initializing Recurring Order Agent (propose-only)")
        if self._settings.get("scheduler_enabled", True):
            self._scheduler_task = asyncio.create_task(
                self._scheduler_loop(),
                name=f"{self.agent_name}-scheduler",
            )
        self.logger.info(
            "✓ Recurring Order Agent initialized "
            f"(autonomy_tier={AUTONOMY_TIER}, scheduler="
            f"{'on' if self._scheduler_task else 'off'})"
        )

    def get_subscribed_routing_keys(self) -> List[tuple[str, str]]:
        return [(EXCHANGE_CONTROL, RK_SCHEDULE_TICK)]

    async def process_message(self, message: Dict[str, Any]) -> Dict[str, Any]:
        payload = message.get("payload") or message
        return await self.check_scheduled_orders(
            restaurant_id=payload.get("restaurant_id")
        )

    async def cleanup(self) -> None:
        if self._scheduler_task and not self._scheduler_task.done():
            self._scheduler_task.cancel()
            try:
                await self._scheduler_task
            except asyncio.CancelledError:
                pass
            except Exception as exc:
                self.logger.warning(f"Scheduler task ended with error: {exc}")
        self._scheduler_task = None

    async def health_check(self) -> Dict[str, Any]:
        health = await super().health_check()
        health["scheduler_running"] = bool(
            self._scheduler_task and not self._scheduler_task.done()
        )
        health["autonomy_tier"] = AUTONOMY_TIER
        health["can_execute_orders"] = False
        return health

    # =========================================================================
    # Scheduling
    # =========================================================================

    async def _scheduler_loop(self) -> None:
        """Daily sweep. Kept from the original agent, moved under the harness."""
        while not self._shutdown_event.is_set():
            try:
                await self._pause_event.wait()
                await self.check_scheduled_orders()
                await self._sleep_until_next_check()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.logger.error(f"Error in recurring order sweep: {exc}")
                self.metrics.record_error(str(exc))
                await asyncio.sleep(_ERROR_BACKOFF_SECONDS)

    async def _sleep_until_next_check(self) -> None:
        """Sleep until tomorrow 00:05 (small offset for safety)."""
        now = datetime.now()
        tomorrow = now + timedelta(days=1)
        next_check = tomorrow.replace(hour=0, minute=5, second=0, microsecond=0)
        sleep_seconds = (next_check - now).total_seconds()
        self.logger.info(
            f"Next recurring-order sweep in {sleep_seconds / 3600:.1f} hours"
        )
        await asyncio.sleep(sleep_seconds)

    # =========================================================================
    # Public entry point
    # =========================================================================

    async def check_scheduled_orders(
        self, restaurant_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Sweep active recurring orders. Emits reminders for orders due in
        ``REMINDER_LEAD_DAYS`` days and proposals for orders due today.

        Always writes a ``decision_log`` row for the sweep itself, so a run that
        found nothing is distinguishable from a run that did not happen.
        """
        orders = await self._load_active_recurring_orders(restaurant_id)
        today = date.today()

        reminders: List[str] = []
        proposals: List[Dict[str, Any]] = []
        errors: List[Dict[str, Any]] = []

        for order in orders:
            try:
                next_date = self._parse_date(order["next_order_date"])
                delta_days = (next_date - today).days

                if delta_days == REMINDER_LEAD_DAYS:
                    await self._send_reminder_notification(order)
                    reminders.append(str(order.get("id")))
                elif delta_days <= 0:
                    proposal = await self._process_due_order(order)
                    if proposal:
                        proposals.append(proposal)
            except Exception as exc:
                self.logger.error(
                    f"Error processing recurring order {order.get('id')}: {exc}"
                )
                errors.append(
                    {"recurring_order_id": order.get("id"), "error": str(exc)}
                )

        await self.log_decision(
            decision_type=DECISION_CHECK,
            inputs={
                "restaurant_id": restaurant_id,
                "orders_examined": len(orders),
                "as_of": today.isoformat(),
            },
            output={
                "reminders": len(reminders),
                "proposals": len(proposals),
                "errors": len(errors),
                "orders_placed": 0,  # invariant: this agent cannot place orders
            },
            reasoning=(
                "Recurring-order sweep. Due orders become one_tap_actions "
                "proposals awaiting human confirmation; nothing is purchased here."
            ),
            confidence=1.0,
            restaurant_id=restaurant_id,
        )

        return {
            "orders_examined": len(orders),
            "reminders": reminders,
            "proposals": proposals,
            "errors": errors,
        }

    # =========================================================================
    # Due order → proposal (never execution)
    # =========================================================================

    async def _process_due_order(
        self, order: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """
        Handle an order whose scheduled date has arrived.

        The old branch — ``if order.get("auto_approve"): await
        self._create_order(order)`` — is gone. Both branches now converge on a
        proposal; ``auto_approve`` only decides the proposal's priority.
        """
        proposal = await self._propose_order(order)

        # Bookkeeping, and the only direct write this agent makes to the
        # schedule. Advancing the date is what keeps a second sweep on the same
        # day (or a retry after a partial failure) from stacking proposals; the
        # open proposal itself is unaffected and stays open until a human acts.
        await self._update_next_order_date(order)
        return proposal

    async def _propose_order(self, order: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Stage a purchase proposal and ask a human to confirm it."""
        restaurant_id = order.get("restaurant_id")
        wine = await self._load_wine(order.get("wine_id"), restaurant_id)
        wine_name = wine.get("wine_name") or str(order.get("wine_id") or "Unknown wine")

        existing = await self._find_open_proposal(order["id"], restaurant_id)
        if existing:
            self.logger.info(
                f"Recurring order {order['id']} already has an open proposal "
                f"{existing} — not staging a second one"
            )
            return {
                "recurring_order_id": order["id"],
                "action_id": existing,
                "status": PROPOSAL_STATUS,
                "duplicate": True,
            }

        payload = {
            "recurring_order_id": order["id"],
            "restaurant_id": restaurant_id,
            "wine_id": order.get("wine_id"),
            "wine_name": wine_name,
            "quantity": order.get("quantity"),
            "unit_type": order.get("unit_type"),
            "preferred_providers": order.get("preferred_providers") or [],
            "frequency": order.get("frequency"),
            "scheduled_date": self._iso(order.get("next_order_date")),
            # Recorded, deliberately not acted on. See the module docstring.
            "schedule_auto_approve_flag": bool(order.get("auto_approve")),
        }

        decision_id = await self.log_decision(
            decision_type=DECISION_PROPOSAL,
            inputs=payload,
            output={
                "action": "proposal",
                "autonomy_tier": AUTONOMY_TIER,
                "status": PROPOSAL_STATUS,
                "executed": False,
            },
            reasoning=(
                "Recurring order reached its scheduled date. Staged a pending "
                "one_tap_actions proposal for manager confirmation. The schedule's "
                "auto_approve flag is recorded but not honoured as consent: "
                "FUTURES §8.1 requires a confirmation record (executed_by/"
                "executed_at) against this specific action."
            ),
            confidence=0.9,
            restaurant_id=restaurant_id,
        )

        action_id = await self._emit_action_proposal(
            {
                "restaurant_id": restaurant_id,
                "action_type": ONE_TAP_ACTION_TYPE,
                "title": f"Recurring order due: {wine_name}",
                "description": (
                    f"{payload['quantity']} {payload['unit_type']}(s) of {wine_name} "
                    f"({payload['frequency']} schedule). Approve to place the order."
                ),
                # auto_approve buys urgency, not autonomy.
                "priority": "high" if order.get("auto_approve") else "medium",
                "status": PROPOSAL_STATUS,
                "metadata": {
                    "action_family": ACTION_FAMILY,
                    "action_kind": ACTION_KIND,
                    "proposer": self.agent_name,
                    "autonomy_tier": AUTONOMY_TIER,
                    "payload": payload,
                    "decision_log_id": decision_id,
                    "correlation_id": self._current_correlation_id,
                },
            }
        )

        await self.publish(
            exchange_name=EXCHANGE_RECURRING,
            routing_key=RK_APPROVAL_NEEDED,
            message_body={
                "recurring_order_id": order["id"],
                "restaurant_id": restaurant_id,
                "wine_id": order.get("wine_id"),
                "wine_name": wine_name,
                "quantity": order.get("quantity"),
                "unit_type": order.get("unit_type"),
                "preferred_providers": payload["preferred_providers"],
                "next_order_date": payload["scheduled_date"],
                "one_tap_action_id": action_id,
            },
            priority=7,
        )

        return {
            "recurring_order_id": order["id"],
            "action_id": action_id,
            "decision_log_id": decision_id,
            "status": PROPOSAL_STATUS,
            "autonomy_tier": AUTONOMY_TIER,
            "duplicate": False,
        }

    async def _emit_action_proposal(self, row: Dict[str, Any]) -> Optional[str]:
        """
        THE ENFORCEMENT POINT for the no-auto-execute guarantee.

        This is the only method in the agent that writes a purchase-shaped row,
        and it refuses any row that arrives already confirmed — a status other
        than ``pending``, or a populated ``executed_by`` / ``executed_at`` /
        ``execution_result``. The confirmation stamp belongs to the API gateway
        (``apps/api-gateway/src/one-tap-actions/one-tap-actions.service.ts:245-246``),
        written after a human taps approve; an agent writing it would forge
        consent and be, at rest, indistinguishable from a real approval.

        It validates caller-supplied data rather than data it built itself, so
        it still fails on a future caller that reintroduces execution — which is
        the whole point of putting the check here instead of in a comment.
        """
        violations = [
            field
            for field in ("executed_by", "executed_at", "execution_result")
            if row.get(field) is not None
        ]
        if row.get("status") != PROPOSAL_STATUS:
            violations.append(f"status={row.get('status')!r}")

        if violations:
            raise RecurringOrderSafetyError(
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

    # =========================================================================
    # Reminder
    # =========================================================================

    async def _send_reminder_notification(self, order: Dict[str, Any]) -> None:
        """Advance reminder, ``REMINDER_LEAD_DAYS`` before the scheduled date."""
        restaurant_id = order.get("restaurant_id")
        wine = await self._load_wine(order.get("wine_id"), restaurant_id)
        wine_name = wine.get("wine_name") or str(order.get("wine_id") or "Unknown wine")

        await self.publish(
            exchange_name=EXCHANGE_RECURRING,
            routing_key=RK_REMINDER,
            message_body={
                "recurring_order_id": order["id"],
                "restaurant_id": restaurant_id,
                "wine_id": order.get("wine_id"),
                "wine_name": wine_name,
                "quantity": order.get("quantity"),
                "unit_type": order.get("unit_type"),
                "frequency": order.get("frequency"),
                "days_until": REMINDER_LEAD_DAYS,
                "preferred_providers": order.get("preferred_providers") or [],
                "next_order_date": self._iso(order.get("next_order_date")),
            },
            priority=6,
        )

        await self.log_decision(
            decision_type=DECISION_REMINDER,
            inputs={
                "recurring_order_id": order["id"],
                "wine_name": wine_name,
                "days_until": REMINDER_LEAD_DAYS,
            },
            output={"action": "reminder", "executed": False},
            reasoning=(
                f"Recurring order is due in {REMINDER_LEAD_DAYS} days — notified "
                "the manager so the schedule can be edited or skipped before it "
                "produces a proposal."
            ),
            confidence=1.0,
            restaurant_id=restaurant_id,
        )

    # =========================================================================
    # Schedule arithmetic (unchanged behaviour)
    # =========================================================================

    async def _update_next_order_date(self, order: Dict[str, Any]) -> Optional[date]:
        current_date = self._parse_date(order["next_order_date"])
        next_date = self._calculate_next_date(
            current_date, order.get("frequency"), order.get("frequency_day")
        )
        try:
            self.database.supabase.table("recurring_orders").update(
                {
                    "next_order_date": next_date.isoformat(),
                    "updated_at": datetime.utcnow().isoformat(),
                }
            ).eq("id", order["id"]).execute()
            self.logger.info(
                f"Advanced next_order_date for {order['id']} to {next_date}"
            )
        except Exception as exc:
            self.logger.warning(
                f"Failed to advance next_order_date for {order.get('id')}: {exc}"
            )
        return next_date

    def _calculate_next_date(
        self, current_date: date, frequency: Optional[str], frequency_day: Optional[int]
    ) -> date:
        """Next occurrence for 'daily' | 'weekly' | 'biweekly' | 'monthly'."""
        if frequency == "daily":
            return current_date + timedelta(days=1)

        if frequency == "weekly":
            days_ahead = (frequency_day or 0) - current_date.weekday()
            if days_ahead <= 0:
                days_ahead += 7
            return current_date + timedelta(days=days_ahead)

        if frequency == "biweekly":
            return current_date + timedelta(weeks=2)

        if frequency == "monthly":
            if frequency_day:
                if current_date.month == 12:
                    next_month = date(current_date.year + 1, 1, 1)
                else:
                    next_month = date(current_date.year, current_date.month + 1, 1)
                try:
                    return date(next_month.year, next_month.month, frequency_day)
                except ValueError:
                    # Day does not exist in that month (e.g. Feb 31) — last day.
                    if next_month.month == 12:
                        return date(next_month.year + 1, 1, 1) - timedelta(days=1)
                    return date(next_month.year, next_month.month + 1, 1) - timedelta(
                        days=1
                    )
            return current_date + timedelta(days=30)

        return current_date + timedelta(days=7)

    def _parse_date(self, date_str: Any) -> date:
        if isinstance(date_str, datetime):
            return date_str.date()
        if isinstance(date_str, date):
            return date_str
        return datetime.fromisoformat(str(date_str)).date()

    @staticmethod
    def _iso(value: Any) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, (date, datetime)):
            return value.isoformat()
        return str(value)

    # =========================================================================
    # Persistence helpers
    # =========================================================================

    async def _load_active_recurring_orders(
        self, restaurant_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        try:
            query = (
                self.database.supabase.table("recurring_orders")
                .select(
                    "id, restaurant_id, wine_id, quantity, unit_type, frequency, "
                    "frequency_day, preferred_providers, auto_approve, "
                    "next_order_date, last_order_date, active"
                )
                .eq("active", True)
            )
            if restaurant_id:
                query = query.eq("restaurant_id", restaurant_id)
            result = query.execute()
            return result.data or []
        except Exception as exc:
            self.logger.error(f"Failed to load recurring orders: {exc}")
            return []

    async def _load_wine(
        self, wine_id: Any, restaurant_id: Optional[str]
    ) -> Dict[str, Any]:
        """
        Best-effort name lookup. ``recurring_orders.wine_id`` is a legacy
        varchar(50), so a miss is expected and must not abort the sweep.
        """
        if not wine_id:
            return {}
        try:
            result = (
                self.database.supabase.table("restaurant_inventory")
                .select("id, wine_name")
                .eq("id", wine_id)
                .limit(1)
                .execute()
            )
            if result.data:
                return result.data[0]
        except Exception as exc:
            self.logger.debug(f"Wine lookup failed for {wine_id}: {exc}")
        return {}

    async def _find_open_proposal(
        self, recurring_order_id: Any, restaurant_id: Optional[str]
    ) -> Optional[str]:
        """Return the id of an already-pending proposal for this schedule."""
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
                if str(payload.get("recurring_order_id")) == str(recurring_order_id):
                    return row.get("id")
        except Exception as exc:
            self.logger.warning(f"Open-proposal lookup failed: {exc}")
        return None
