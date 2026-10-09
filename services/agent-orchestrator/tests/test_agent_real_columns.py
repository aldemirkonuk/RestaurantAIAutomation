"""
The agents' reads name columns the tables actually have (sim wave 15).

F-533, F-536, F-537 and F-520 were reads of columns production does not have
(providers.ai_personality_notes, negotiation_facts.fact_field/fact_value,
procurement_orders.wine_name / price_per_bottle / target_price_per_bottle).
PostgREST fails such a read with 42703; every site caught it and carried on
with an empty answer. The old tests passed because their mocks returned the
phantom columns. The fake below refuses them, as PostgREST does.

The static half of this check is scripts/check_agent_columns.py.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock, patch


# Real columns, copied from supabase/migrations/20260805000000_baseline_from_production.sql
# (only the tables these tests read).
COLUMNS = {
    "providers": {
        "id",
        "name",
        "restaurant_id",
        "personality_notes",
        "close_relationship",
        "relationship_health_score",
        "notes",
        "contact_email",
        "primary_contact",
    },
    "negotiation_facts": {
        "id",
        "session_id",
        "provider_id",
        "restaurant_id",
        "fact_type",
        "fact_key",
        "value_numeric",
        "value_text",
        "unit",
        "commitment_type",
        "status",
        "created_at",
    },
    "procurement_orders": {
        "id",
        "order_number",
        "restaurant_id",
        "inventory_id",
        "provider_id",
        "quantity",
        "unit_type",
        "final_price",
        "negotiated_price",
        "status",
        "created_at",
    },
    "procurement_conversations": {
        "id",
        "order_id",
        "restaurant_id",
        "provider_id",
        "direction",
        "message_text",
        "created_at",
        "rolling_summary",
        "status",
    },
}

HOUSE_A = "house-a"
HOUSE_B = "house-b"
PROV = "prov-1"


class _Result:
    def __init__(self, data: Any):
        self.data = data


class _Query:
    def __init__(self, db: "_Db", name: str):
        self.db, self.name = db, name
        self.preds: List[Any] = []
        self.one = False
        self.cap: Optional[int] = None

    def select(self, columns: str = "*", **_k: Any) -> "_Query":
        known = COLUMNS.get(self.name)
        if known is not None:
            for tok in columns.split(","):
                tok = tok.strip()
                if tok and tok != "*" and "(" not in tok and tok not in known:
                    raise RuntimeError(
                        f"42703: column {self.name}.{tok} does not exist"
                    )
        self.db.selects.append((self.name, columns))
        return self

    def _check(self, col: str) -> None:
        known = COLUMNS.get(self.name)
        if known is not None and "." not in col and col not in known:
            raise RuntimeError(f"42703: column {self.name}.{col} does not exist")

    def eq(self, col: str, val: Any) -> "_Query":
        self._check(col)
        self.preds.append(lambda r: r.get(col) == val)
        return self

    def neq(self, col: str, val: Any) -> "_Query":
        self._check(col)
        self.preds.append(lambda r: r.get(col) != val)
        return self

    def in_(self, col: str, vals: List[Any]) -> "_Query":
        self._check(col)
        self.preds.append(lambda r: r.get(col) in vals)
        return self

    def ilike(self, col: str, pattern: str) -> "_Query":
        self._check(col)
        needle = pattern.strip("%").lower()
        self.preds.append(lambda r: needle in str(r.get(col) or "").lower())
        return self

    def order(self, col: str, **_k: Any) -> "_Query":
        self._check(col)
        return self

    def limit(self, n: int) -> "_Query":
        self.cap = n
        return self

    def single(self) -> "_Query":
        self.one = True
        return self

    maybe_single = single

    def execute(self) -> _Result:
        rows = [
            r for r in self.db.rows.get(self.name, []) if all(p(r) for p in self.preds)
        ]
        if self.cap is not None:
            rows = rows[: self.cap]
        if self.one:
            return _Result(dict(rows[0]) if rows else None)
        return _Result([dict(r) for r in rows])


class _Db:
    def __init__(self, rows: Dict[str, List[Dict[str, Any]]]):
        self.rows = rows
        self.selects: List[Any] = []

    def table(self, name: str) -> _Query:
        return _Query(self, name)


def _comm_agent(rows: Dict[str, List[Dict[str, Any]]]):
    from agents.provider_communication_agent import ProviderCommunicationAgent

    db = MagicMock()
    db.supabase = _Db(rows)
    a = ProviderCommunicationAgent(
        message_bus=AsyncMock(), database=db, redis_client=AsyncMock()
    )
    a.haiku_semaphore = asyncio.Semaphore(1)
    a.logger = MagicMock()
    return a


def _provider(**kw: Any) -> Dict[str, Any]:
    row = {
        "id": PROV,
        "restaurant_id": HOUSE_A,
        "name": "Burgundy Imports",
        "personality_notes": "Prefers short emails",
        "close_relationship": False,
        "relationship_health_score": 8,
    }
    row.update(kw)
    return row


def _order(order_id: str, house: str, inventory_id: str, status: str = "PENDING"):
    return {
        "id": order_id,
        "restaurant_id": house,
        "provider_id": PROV,
        "inventory_id": inventory_id,
        "quantity": 6,
        "status": status,
        "created_at": "2026-10-01T00:00:00Z",
        "inventory": {"wine_name": f"wine of {inventory_id}"},
    }


# ─────────────────────────────────────────────────────────────────────────────
# F-533: the create-time letter's context
# ─────────────────────────────────────────────────────────────────────────────


async def test_the_create_time_letter_knows_the_vendor_and_the_agreed_terms():
    agent = _comm_agent(
        {
            "providers": [_provider()],
            "negotiation_facts": [
                {
                    "provider_id": PROV,
                    "restaurant_id": HOUSE_A,
                    "fact_key": "payment_terms",
                    "value_text": "Net 30",
                    "commitment_type": "AGREEMENT",
                    "status": "active",
                },
                {
                    "provider_id": PROV,
                    "restaurant_id": HOUSE_A,
                    "fact_key": "min_order",
                    "value_numeric": 6,
                    "unit": "cases",
                    "commitment_type": "AGREEMENT",
                    "status": "active",
                },
                # Superseded, and another house's: neither reaches this letter.
                {
                    "provider_id": PROV,
                    "restaurant_id": HOUSE_A,
                    "fact_key": "discount",
                    "value_text": "old 5%",
                    "commitment_type": "AGREEMENT",
                    "status": "superseded",
                },
                {
                    "provider_id": PROV,
                    "restaurant_id": HOUSE_B,
                    "fact_key": "discount",
                    "value_text": "house B 10%",
                    "commitment_type": "AGREEMENT",
                    "status": "active",
                },
            ],
        }
    )

    prompt, _ = await agent._build_context_window(
        PROV, HOUSE_A, "ord-1", "PRICE_INQUIRY", {"wine_name": "Pommard", "quantity": 4}
    )

    assert "provider: Burgundy Imports" in prompt
    assert 'notes="Prefers short emails"' in prompt
    assert "payment_terms=Net 30" in prompt
    assert "min_order=6 cases" in prompt
    assert "old 5%" not in prompt and "house B" not in prompt
    agent.logger.error.assert_not_called()


async def test_an_unreadable_vendor_profile_is_logged_not_hidden():
    agent = _comm_agent({"providers": [_provider()]})

    def boom(*_a: Any, **_k: Any) -> Any:
        raise RuntimeError("connection reset")

    agent.database.supabase.table = boom

    prompt, _ = await agent._build_context_window(
        PROV, HOUSE_A, "ord-1", "PRICE_INQUIRY", {"wine_name": "Pommard"}
    )

    assert "provider: the provider" in prompt
    assert agent.logger.error.called


async def _run_order_created(agent, order_id: str) -> AsyncMock:
    payload = {
        "order_id": order_id,
        "restaurant_id": HOUSE_A,
        "provider_id": PROV,
        "wine_name": "Pommard",
        "quantity": 4,
        "target_price_per_bottle": None,
    }
    with patch.object(
        agent, "_acquire_draft_lock", new_callable=AsyncMock, return_value=True
    ), patch.object(
        agent, "_check_idempotency", new_callable=AsyncMock, return_value=False
    ), patch.object(
        agent, "_mark_processed", new_callable=AsyncMock
    ), patch.object(
        agent,
        "_check_and_increment_rate_limit",
        new_callable=AsyncMock,
        return_value=False,
    ), patch(
        "agents.provider_communication_agent.get_haiku_client"
    ) as hc, patch.object(
        agent, "_notify", new_callable=AsyncMock
    ) as notify:
        hc.return_value.messages.create = AsyncMock(
            side_effect=RuntimeError("no model in tests")
        )
        try:
            await agent._handle_order_created(payload)
        except Exception:
            pass  # past C-10 the draft path needs more than this fake has
        notify.model_called = hc.return_value.messages.create.called
    return notify


async def test_a_second_open_order_for_the_same_wine_is_held_back():
    """C-10 filtered procurement_orders.wine_name, which does not exist, and
    `except: pass` read the failure as "no duplicate"."""
    agent = _comm_agent(
        {
            "providers": [_provider()],
            "procurement_orders": [
                _order("ord-new", HOUSE_A, "inv-1"),
                _order("ord-old", HOUSE_A, "inv-1", status="CONFIRMED"),
            ],
        }
    )

    notify = await _run_order_created(agent, "ord-new")

    titles = [c.kwargs.get("title") for c in notify.call_args_list]
    assert "Duplicate order detected" in titles
    assert notify.model_called is False


async def test_another_houses_order_for_the_same_wine_is_not_a_duplicate():
    agent = _comm_agent(
        {
            "providers": [_provider()],
            "procurement_orders": [
                _order("ord-new", HOUSE_A, "inv-1"),
                _order("ord-b", HOUSE_B, "inv-1"),
                _order("ord-other-wine", HOUSE_A, "inv-2"),
            ],
        }
    )

    notify = await _run_order_created(agent, "ord-new")

    titles = [c.kwargs.get("title") for c in notify.call_args_list]
    assert "Duplicate order detected" not in titles
    assert notify.model_called is True


async def test_an_off_app_invoice_is_matched_by_the_wine_on_the_order():
    """The invoice match selected procurement_orders.wine_name and failed, so
    the house heard nothing. The name now comes through the inventory embed."""
    agent = _comm_agent({"procurement_orders": [_order("ord-1", HOUSE_A, "inv-1")]})
    seen: Dict[str, Any] = {}

    def best_order_match(**kw: Any) -> Dict[str, Any]:
        seen["orders"] = kw["orders"]
        return {**kw["orders"][0], "_match_class": "auto_suggest", "_match_score": 0.95}

    with patch(
        "agents.provider_communication_agent.get_fuzzy_matcher"
    ) as fm, patch.object(agent, "_notify", new_callable=AsyncMock) as notify:
        fm.return_value.best_order_match = best_order_match
        await agent._handle_invoice_match(
            HOUSE_A,
            PROV,
            "Burgundy Imports",
            {"line_items": [{"wine_name": "wine of inv-1", "quantity": 6}]},
        )

    assert seen["orders"][0]["wine_name"] == "wine of inv-1"
    assert notify.call_args.kwargs["metadata"]["match_class"] == "auto_suggest"
    agent.logger.error.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# F-520: the approval-time prompt's open orders and credit terms
# ─────────────────────────────────────────────────────────────────────────────


def _conv_agent(rows: Dict[str, List[Dict[str, Any]]]):
    from agents.provider_conversation_agent import ProviderConversationAgent

    agent = object.__new__(ProviderConversationAgent)
    agent.logger = MagicMock()
    agent.database = MagicMock()
    agent.database.supabase = _Db(rows)
    return agent


async def test_the_prompt_sees_only_this_houses_open_orders_and_terms():
    agent = _conv_agent(
        {
            "procurement_orders": [
                _order("a-open", HOUSE_A, "inv-1", status="APPROVED"),
                _order("a-done", HOUSE_A, "inv-2", status="DELIVERED"),
                _order("b-open", HOUSE_B, "inv-3", status="APPROVED"),
            ],
            "negotiation_facts": [
                {
                    "provider_id": PROV,
                    "restaurant_id": HOUSE_B,
                    "fact_key": "payment_terms",
                    "value_text": "house B Net 60",
                    "commitment_type": "AGREEMENT",
                    "status": "active",
                },
                {
                    "provider_id": PROV,
                    "restaurant_id": HOUSE_A,
                    "fact_key": "payment_terms",
                    "value_text": "Net 30",
                    "commitment_type": "AGREEMENT",
                    "status": "active",
                },
            ],
            "providers": [_provider()],
        }
    )

    ctx = await agent._get_db_context_for_prompt(
        provider_id=PROV, restaurant_id=HOUSE_A
    )

    assert ctx["open_orders"] == "wine of inv-1 ×6 [APPROVED]"
    assert ctx["credit_terms"] == "payment_terms: Net 30"
    agent.logger.error.assert_not_called()
