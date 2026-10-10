"""
F-534 / F-535 (sim wave 15, 2026-10-09): the provider agent and EmailIntel
keep a vendor's facts, sessions, bells and deals inside the house they belong
to.

The fake database below FILTERS rows by every `.eq` / `.in_` / `.ilike` the
code applies, and rejects a column the table does not have, so a read that
forgets the house returns the other house's rows and a read that names a
phantom column raises -- the two ways these paths failed before.
"""

from __future__ import annotations

import asyncio
import hashlib
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

HOUSE_A = "11111111-1111-1111-1111-111111111111"
HOUSE_B = "22222222-2222-2222-2222-222222222222"
VENDOR = "33333333-3333-3333-3333-333333333333"

# Columns that exist in production (baseline 20260805000000), per table read here.
COLUMNS = {
    "provider_conversation_sessions": {
        "id",
        "provider_id",
        "restaurant_id",
        "session_type",
        "status",
        "initiated_by",
        "intent",
        "context",
        "topic_stack",
        "turn_count",
        "created_at",
    },
    "provider_knowledge": {
        "id",
        "provider_id",
        "restaurant_id",
        "category",
        "subcategory",
        "label",
        "attributes",
        "confidence",
        "verified",
        "is_active",
        "version",
        "previous_value",
        "source_message_text",
    },
    "provider_sentiment_history": {
        "id",
        "provider_id",
        "restaurant_id",
        "sentiment_score",
        "created_at",
    },
    "conversation_embeddings": {
        "id",
        "provider_id",
        "restaurant_id",
        "message_text",
        "role",
        "channel",
        "importance_score",
        "created_at",
        "has_signal",
        "sensitive",
    },
    "procurement_conversations": {
        "id",
        "provider_id",
        "restaurant_id",
        "message_id",
        "email_headers",
        "direction",
        "message_text",
        "sent_at",
        "received_at",
        "created_at",
    },
    "providers": {"id", "restaurant_id", "contact_email", "name", "is_active"},
    "provider_contacts": {"id", "provider_id", "email", "name"},
    "vendor_promotions": {
        "id",
        "provider_id",
        "restaurant_id",
        "detected_from_email_subject",
        "product_name",
        "grape_variety",
        "region",
        "discount_pct",
        "discount_fixed",
        "valid_until",
        "promo_description",
        "conditions",
        "min_quantity",
        "dedup_hash",
        "urgency_score",
        "linked_event_ids",
        "last_comparison_price",
        "status",
    },
    "user_restaurant_access": {"user_id", "restaurant_id", "is_active"},
    "restaurants": {"id", "owner_id"},
    "notifications": {
        "restaurant_id",
        "recipient_id",
        "notification_type",
        "channels",
        "user_id",
        "type",
        "title",
        "message",
        "priority",
        "status",
        "action_url",
        "action_label",
        "group_key",
        "metadata",
    },
}
NOT_NULL_NO_DEFAULT = {
    "notifications": {"restaurant_id", "recipient_id", "notification_type", "channels"},
}


class _Q:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.limit_n, self.op = (
            db,
            table,
            [],
            None,
            "select",
        )
        self.payload = None
        db.queries.append(self)

    def _col(self, col):
        if col not in COLUMNS[self.table]:
            raise RuntimeError(f"42703 column {self.table}.{col} does not exist")

    def select(self, cols="*"):
        if cols != "*":
            for c in cols.split(","):
                self._col(c.strip())
        return self

    def eq(self, col, val):
        self._col(col)
        self.filters.append(lambda r, c=col, v=val: r.get(c) == v)
        return self

    def in_(self, col, vals):
        self._col(col)
        self.filters.append(lambda r, c=col, v=tuple(vals): r.get(c) in v)
        return self

    def ilike(self, col, pat):
        self._col(col)
        self.filters.append(
            lambda r, c=col, p=pat: (r.get(c) or "").lower() == p.lower()
        )
        return self

    def gte(self, col, val):
        self._col(col)
        return self

    def order(self, *a, **k):
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def update(self, payload):
        for c in payload:
            self._col(c)
        self.op, self.payload = "update", payload
        return self

    def insert(self, payload):
        rows = payload if isinstance(payload, list) else [payload]
        for row in rows:
            for c in row:
                self._col(c)
            for c in NOT_NULL_NO_DEFAULT.get(self.table, ()):
                if row.get(c) is None:
                    raise RuntimeError(f"23502 null value in column {c}")
        self.op, self.payload = "insert", rows
        return self

    def execute(self):
        if self.op == "update":
            hit = [
                r
                for r in self.db.rows.get(self.table, [])
                if all(f(r) for f in self.filters)
            ]
            for r in hit:
                r.update(self.payload)
            return SimpleNamespace(data=hit)
        if self.op == "insert":
            for row in self.payload:
                row.setdefault("id", f"{self.table}-{len(self.db.queries)}")
            self.db.rows.setdefault(self.table, []).extend(self.payload)
            return SimpleNamespace(data=self.payload)
        out = [
            r
            for r in self.db.rows.get(self.table, [])
            if all(f(r) for f in self.filters)
        ]
        if self.limit_n is not None:
            out = out[: self.limit_n]
        return SimpleNamespace(data=out)


class _DB:
    def __init__(self, rows):
        self.rows = rows
        self.queries = []
        self.rpc_calls = []
        self.supabase = self

    def table(self, name):
        return _Q(self, name)

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))

        class _R:
            def execute(self_inner):
                if name == "match_conversation_embeddings":
                    # The function's only signature (baseline :1065) has no
                    # default for match_restaurant_id: PostgREST answers PGRST202.
                    required = {
                        "query_embedding",
                        "match_provider_id",
                        "match_restaurant_id",
                    }
                    if not required <= set(params):
                        raise RuntimeError("PGRST202 no function matches")
                    return SimpleNamespace(data=[{"message_text": "rpc-hit"}])
                return SimpleNamespace(data=[])

        return _R()


def _conversation_agent(db):
    from agents.provider_conversation_agent import ProviderConversationAgent

    agent = object.__new__(ProviderConversationAgent)
    agent.logger = MagicMock()
    agent.database = db
    agent.config = {}
    agent.mock_mode = True
    agent._active_sessions = {}
    agent.publish = AsyncMock()
    return agent


# ──────────────────────────────────────────────────────────────────────────────
# F-534 — provider agent context is keyed on the house as well as the vendor
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_house_b_does_not_resume_house_a_paused_session():
    db = _DB(
        {
            "provider_conversation_sessions": [
                {
                    "id": "sess-A",
                    "provider_id": VENDOR,
                    "restaurant_id": HOUSE_A,
                    "status": "paused_for_approval",
                    "context": {"pending_conversation_id": "conv-A"},
                }
            ]
        }
    )
    agent = _conversation_agent(db)

    a = await agent._get_or_create_session(VENDOR, HOUSE_A, "negotiation", "t")
    assert a.session_id == "sess-A"

    b = await agent._get_or_create_session(VENDOR, HOUSE_B, "negotiation", "t")
    assert b.session_id != "sess-A"
    assert b.restaurant_id == HOUSE_B
    # A's paused session and its pending draft are untouched in the cache.
    assert agent._active_sessions[(HOUSE_A, VENDOR)].context == {
        "pending_conversation_id": "conv-A"
    }
    assert agent._active_sessions[(HOUSE_B, VENDOR)] is b


@pytest.mark.asyncio
async def test_twin_and_style_profile_read_only_this_house():
    db = _DB(
        {
            "provider_knowledge": [
                {
                    "provider_id": VENDOR,
                    "restaurant_id": HOUSE_A,
                    "is_active": True,
                    "category": "relationship",
                    "subcategory": "communication_style",
                    "label": "style",
                    "attributes": {"formality": "house-A-only"},
                    "confidence": 0.9,
                    "verified": True,
                }
            ]
        }
    )
    agent = _conversation_agent(db)

    assert await agent._load_digital_twin(VENDOR, HOUSE_B) == {}
    style_b = await agent._load_style_profile(VENDOR, HOUSE_B)
    assert style_b.get("formality") != "house-A-only"

    assert "relationship" in await agent._load_digital_twin(VENDOR, HOUSE_A)
    style_a = await agent._load_style_profile(VENDOR, HOUSE_A)
    assert style_a == {"formality": "house-A-only"}


@pytest.mark.asyncio
async def test_memory_search_passes_the_house_to_the_rpc():
    db = _DB({})
    agent = _conversation_agent(db)

    out = await agent._search_conversation_memory(
        provider_id=VENDOR, restaurant_id=HOUSE_A, query="price"
    )

    assert out == [{"message_text": "rpc-hit"}]
    name, params = db.rpc_calls[0]
    assert name == "match_conversation_embeddings"
    assert params["match_restaurant_id"] == HOUSE_A


@pytest.mark.asyncio
async def test_memory_fallback_keeps_house_signal_and_sensitive_filters():
    rows = [
        {
            "provider_id": VENDOR,
            "restaurant_id": HOUSE_A,
            "has_signal": True,
            "sensitive": False,
            "message_text": "A ok",
        },
        {
            "provider_id": VENDOR,
            "restaurant_id": HOUSE_B,
            "has_signal": True,
            "sensitive": False,
            "message_text": "B house",
        },
        {
            "provider_id": VENDOR,
            "restaurant_id": HOUSE_A,
            "has_signal": False,
            "sensitive": False,
            "message_text": "A noise",
        },
        {
            "provider_id": VENDOR,
            "restaurant_id": HOUSE_A,
            "has_signal": True,
            "sensitive": True,
            "message_text": "A secret",
        },
    ]
    agent = _conversation_agent(_DB({"conversation_embeddings": rows}))

    out = await agent._get_recent_messages(VENDOR, HOUSE_A)

    assert [r["message_text"] for r in out] == ["A ok"]


@pytest.mark.asyncio
async def test_sentiment_trend_counts_only_this_house():
    rows = [
        {"provider_id": VENDOR, "restaurant_id": HOUSE_A, "sentiment_score": -0.9}
        for _ in range(6)
    ]
    agent = _conversation_agent(_DB({"provider_sentiment_history": rows}))

    await agent._check_sentiment_trend(VENDOR, HOUSE_B)
    agent.publish.assert_not_called()

    await agent._check_sentiment_trend(VENDOR, HOUSE_A)
    agent.publish.assert_called()


@pytest.mark.asyncio
async def test_knowledge_upsert_does_not_update_another_house_fact():
    db = _DB(
        {
            "provider_knowledge": [
                {
                    "id": "fact-A",
                    "provider_id": VENDOR,
                    "restaurant_id": HOUSE_A,
                    "category": "pricing",
                    "subcategory": "terms",
                    "label": "net",
                    "is_active": True,
                    "attributes": {"days": 30},
                    "version": 1,
                    "confidence": 0.9,
                }
            ]
        }
    )
    agent = _conversation_agent(db)
    agent._detect_contradiction = MagicMock(return_value=None)

    await agent._upsert_knowledge(
        VENDOR, HOUSE_B, "pricing", "terms", "net", {"days": 60}, 0.9, "msg"
    )

    rows = db.rows["provider_knowledge"]
    fact_a = next(r for r in rows if r.get("id") == "fact-A")
    assert fact_a["attributes"] == {"days": 30}
    assert fact_a["version"] == 1
    assert any(
        r["restaurant_id"] == HOUSE_B and r["attributes"] == {"days": 60} for r in rows
    )


# ──────────────────────────────────────────────────────────────────────────────
# F-535 — EmailIntel: unknown sender, bells, promo dedupe
# ──────────────────────────────────────────────────────────────────────────────


def _email_agent(db):
    from agents.email_intel_agent import EmailIntelAgent

    agent = EmailIntelAgent(message_bus=MagicMock(), database=db)
    agent.haiku_semaphore = asyncio.Semaphore(1)
    agent.logger = MagicMock()
    return agent


def _sender_db():
    return _DB(
        {
            "providers": [
                {
                    "id": "prov-A",
                    "restaurant_id": HOUSE_A,
                    "contact_email": "Sales@Vendor.com",
                },
                {
                    "id": "prov-B",
                    "restaurant_id": HOUSE_B,
                    "contact_email": "only-b@other.com",
                },
            ],
            "provider_contacts": [
                {"id": "c-1", "provider_id": "prov-A", "email": "rep@vendor.com"},
                {"id": "c-2", "provider_id": "prov-B", "email": "b-rep@other.com"},
            ],
        }
    )


@pytest.mark.asyncio
async def test_known_sender_by_contact_email_in_the_house():
    agent = _email_agent(_sender_db())
    assert await agent._detect_unknown_sender(HOUSE_A, " sales@vendor.com ") is False


@pytest.mark.asyncio
async def test_known_sender_by_secondary_contact_of_a_house_provider():
    agent = _email_agent(_sender_db())
    assert await agent._detect_unknown_sender(HOUSE_A, "rep@vendor.com") is False


@pytest.mark.asyncio
async def test_unknown_sender_is_reported_unknown():
    agent = _email_agent(_sender_db())
    assert await agent._detect_unknown_sender(HOUSE_A, "stranger@new.com") is True


@pytest.mark.asyncio
async def test_another_house_vendor_is_unknown_here():
    agent = _email_agent(_sender_db())
    assert await agent._detect_unknown_sender(HOUSE_A, "only-b@other.com") is True
    assert await agent._detect_unknown_sender(HOUSE_A, "b-rep@other.com") is True


@pytest.mark.asyncio
async def test_notify_lands_a_bell_for_each_member():
    db = _DB(
        {
            "user_restaurant_access": [
                {"user_id": "u-1", "restaurant_id": HOUSE_A, "is_active": True},
                {"user_id": "u-2", "restaurant_id": HOUSE_A, "is_active": True},
            ]
        }
    )
    agent = _email_agent(db)

    await agent._notify(
        restaurant_id=HOUSE_A,
        notification_type="email_classified_promo",
        title="Deal: Barolo at 20% off",
        message="m",
        priority="medium",
        action_url="/providers",
        metadata={"promo_id": "p-1"},
    )

    rows = db.rows["notifications"]
    assert [r["recipient_id"] for r in rows] == ["u-1", "u-2"]
    assert all(r["notification_type"] == "email_classified_promo" for r in rows)
    assert all(r["channels"] == ["in_app"] for r in rows)
    assert all(r["restaurant_id"] == HOUSE_A for r in rows)


def _promo_details():
    from models.email_intel import PromoDetails

    return PromoDetails(
        product_name="Barolo 2019", promo_description="20% off", confidence=0.9
    )


@pytest.mark.asyncio
async def test_same_blast_is_kept_by_each_house():
    from models.email_intel import EmailClassification

    db = _DB({"vendor_promotions": []})
    agent = _email_agent(db)
    agent._extract_promo = AsyncMock(return_value=_promo_details())
    agent._compute_urgency_score = AsyncMock(return_value=0.5)
    agent._find_linked_events = AsyncMock(return_value=[])
    agent._get_last_purchase_price = AsyncMock(return_value=None)
    agent._notify = AsyncMock()
    classification = EmailClassification(
        category="PROMO", confidence=0.9, reasoning="r", provider_name="V"
    )
    payload = {
        "from_email": "sales@vendor.com",
        "subject": "Deal",
        "body": "x",
        "provider_id": VENDOR,
    }

    await agent._handle_promo(payload, classification, HOUSE_A, False)
    await agent._handle_promo(payload, classification, HOUSE_B, False)
    await agent._handle_promo(payload, classification, HOUSE_A, False)

    kept = db.rows["vendor_promotions"]
    assert sorted(r["restaurant_id"] for r in kept) == sorted([HOUSE_A, HOUSE_B])
    hashes = {r["restaurant_id"]: r["dedup_hash"] for r in kept}
    assert hashes[HOUSE_A] != hashes[HOUSE_B]
    today = date.today().isoformat()
    assert (
        hashes[HOUSE_A]
        == hashlib.sha256(
            f"{HOUSE_A}sales@vendor.comBarolo 2019{today}".encode()
        ).hexdigest()
    )
