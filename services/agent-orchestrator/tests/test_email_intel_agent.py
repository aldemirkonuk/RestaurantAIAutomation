"""
Integration tests for EmailIntelAgent — Phase 24, Plan 04.
Per RESEARCH.md Validation Architecture.

Tests cover:
  1. NOISE email → silent discard (no publish, no notify)
  2. OPERATIONAL routing → re-publish to email.inbound.received
  3. PROMO routing → inserts to vendor_promotions
  4. Dedup hash prevents re-insertion of same deal
  5. Stale email (>18h) skips Redis digest accumulation
  6. D-16 urgency score formula: fit_score × stock_factor × calendar_prox × 10
  7. Haiku semaphore is acquired for every PROMO extraction call
  8. Idempotency check — duplicate gmail_message_id skips processing
"""

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch


from agents.email_intel_agent import EmailIntelAgent
from models.email_intel import EmailClassification, PromoDetails


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_db_mock(existing_promo_data=None, insert_data=None):
    """Build a Supabase mock that returns configurable data on execute()."""
    db = MagicMock()
    # Chain: table().select().eq().execute() → .data = []
    chain = MagicMock()
    chain.select.return_value = chain
    chain.insert.return_value = chain
    chain.update.return_value = chain
    chain.eq.return_value = chain
    chain.in_.return_value = chain
    chain.ilike.return_value = chain
    chain.gte.return_value = chain
    chain.lte.return_value = chain
    chain.order.return_value = chain
    chain.limit.return_value = chain
    chain.not_ = chain
    chain.is_.return_value = chain
    # Default: empty rows, successful insert
    chain.execute.return_value.data = (
        existing_promo_data if existing_promo_data is not None else []
    )
    db.supabase.table.return_value = chain
    return db, chain


def _make_agent(db=None, bus=None, redis=None, existing_promo_data=None):
    """Create EmailIntelAgent with all external dependencies mocked."""
    if db is None:
        db, _ = _make_db_mock(existing_promo_data=existing_promo_data)
    # Override insert response to return a promo id
    db.supabase.table.return_value.insert.return_value.execute.return_value.data = [
        {"id": "test-promo-id"}
    ]
    if bus is None:
        bus = AsyncMock()
    if redis is None:
        redis = MagicMock()
        pipe = MagicMock()
        pipe.lpush = MagicMock()
        pipe.expire = MagicMock()
        pipe.execute = AsyncMock(return_value=[1, True])
        redis.pipeline.return_value = pipe

    agent = EmailIntelAgent(message_bus=bus, database=db, redis_client=redis)
    agent.haiku_semaphore = asyncio.Semaphore(5)
    agent.logger = MagicMock()
    return agent


def _promo_payload(**overrides):
    base = {
        "gmail_message_id": "msg-promo-001",
        "subject": "20% off 2024 Pinot Noir allocation",
        "body": "We are pleased to offer 20% off on all 2024 Pinot Noir from Burgundy.",
        "restaurant_id": "rest-abc",
        "provider_id": "prov-xyz",
        "from_email": "vendor@winery.com",
        "received_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    base.update(overrides)
    return base


def _operational_payload(**overrides):
    base = {
        "gmail_message_id": "msg-op-001",
        "subject": "Order #12345 confirmed",
        "body": "Your order has been confirmed and will ship tomorrow.",
        "restaurant_id": "rest-abc",
        "provider_id": "prov-xyz",
        "from_email": "vendor@winery.com",
        "received_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    base.update(overrides)
    return base


def _mock_classification(
    category: str, confidence: float = 0.92, provider_name: str = "TestVendor"
):
    return EmailClassification(
        category=category,
        confidence=confidence,
        reasoning=f"Test {category.lower()} reasoning",
        provider_name=provider_name,
        urgency="medium",
    )


def _mock_promo_details(**overrides):
    base = {
        "product_name": "Burgundy Pinot Noir 2024",
        "grape_variety": "Pinot Noir",
        "region": "Burgundy",
        "discount_pct": 20.0,
        "promo_description": "20% off 2024 Pinot Noir allocation",
        "confidence": 0.88,
    }
    base.update(overrides)
    return PromoDetails(**base)


# ---------------------------------------------------------------------------
# Test 1: NOISE email → silent discard
# ---------------------------------------------------------------------------


async def test_noise_email_silent_discard():
    """NOISE emails must be silently discarded — no publish, no notify, no DB write."""
    agent = _make_agent()
    payload = {
        "gmail_message_id": "msg-noise-001",
        "subject": "Our monthly wine newsletter",
        "body": "Check out our latest picks...",
        "restaurant_id": "rest-abc",
        "received_at": datetime.now(tz=timezone.utc).isoformat(),
    }

    with patch.object(agent, "_check_idempotency", return_value=False), patch.object(
        agent, "_classify_email", return_value=_mock_classification("NOISE")
    ), patch.object(
        agent, "_mark_processed", new_callable=AsyncMock
    ) as mock_mark, patch.object(
        agent, "_notify", new_callable=AsyncMock
    ) as mock_notify:
        await agent.process_message(payload)

    agent.message_bus.publish.assert_not_called()
    mock_notify.assert_not_called()
    # Should still mark processed
    mock_mark.assert_called_once()


# ---------------------------------------------------------------------------
# Test 2: OPERATIONAL routing → re-publish to email.inbound.received
# ---------------------------------------------------------------------------


async def test_operational_email_republishes_to_received():
    """OPERATIONAL emails must be re-published to email.inbound.received with __intel_bypass."""
    agent = _make_agent()
    payload = _operational_payload()

    with patch.object(agent, "_check_idempotency", return_value=False), patch.object(
        agent, "_classify_email", return_value=_mock_classification("OPERATIONAL")
    ), patch.object(agent, "_mark_processed", new_callable=AsyncMock), patch.object(
        agent, "_notify", new_callable=AsyncMock
    ), patch.object(
        agent, "publish", new_callable=AsyncMock
    ) as mock_publish:
        await agent.process_message(payload)

    mock_publish.assert_called_once()
    call_args = mock_publish.call_args
    assert call_args[0][0] == "email.events"
    assert call_args[0][1] == "email.inbound.received"
    # __intel_bypass must be in the re-published payload
    published_payload = call_args[0][2]
    assert published_payload.get("__intel_bypass") is True


# ---------------------------------------------------------------------------
# Test 3: PROMO routing → inserts to vendor_promotions
# ---------------------------------------------------------------------------


async def test_promo_email_inserts_to_vendor_promotions():
    """PROMO emails must trigger extraction and insert a row into vendor_promotions."""
    db, chain = _make_db_mock()
    # Dedup check returns empty (no existing promo)
    chain.execute.return_value.data = []
    # Insert returns a promo id
    chain.insert.return_value.execute.return_value.data = [{"id": "new-promo-id"}]

    agent = _make_agent(db=db)
    payload = _promo_payload()

    with patch.object(agent, "_check_idempotency", return_value=False), patch.object(
        agent, "_classify_email", return_value=_mock_classification("PROMO")
    ), patch.object(
        agent, "_extract_promo", return_value=_mock_promo_details()
    ), patch.object(
        agent, "_compute_urgency_score", return_value=7.5
    ), patch.object(
        agent, "_find_linked_events", return_value=["evt-001"]
    ), patch.object(
        agent, "_get_last_purchase_price", return_value=45.0
    ), patch.object(
        agent, "_mark_processed", new_callable=AsyncMock
    ), patch.object(
        agent, "_notify", new_callable=AsyncMock
    ):
        await agent.process_message(payload)

    # vendor_promotions table must be called
    [str(c) for c in db.supabase.table.call_args_list]
    vendor_promo_calls = [
        c for c in db.supabase.table.call_args_list if "vendor_promotions" in str(c)
    ]
    assert len(vendor_promo_calls) >= 1, "vendor_promotions table must be accessed"


# ---------------------------------------------------------------------------
# Test 4: Dedup hash prevents re-insertion of same deal
# ---------------------------------------------------------------------------


async def test_promo_dedup_prevents_duplicate_insert():
    """When dedup_hash already exists, the promo must NOT be re-inserted."""
    # Dedup check returns existing row → suppress
    db, chain = _make_db_mock(existing_promo_data=[{"id": "existing-promo"}])
    # Make insert tracking available
    insert_called = []

    original_insert = chain.insert

    def track_insert(*args, **kwargs):
        insert_called.append(args)
        return original_insert(*args, **kwargs)

    agent = _make_agent(db=db)
    payload = _promo_payload()

    with patch.object(agent, "_check_idempotency", return_value=False), patch.object(
        agent, "_classify_email", return_value=_mock_classification("PROMO")
    ), patch.object(
        agent, "_extract_promo", return_value=_mock_promo_details()
    ), patch.object(
        agent, "_mark_processed", new_callable=AsyncMock
    ), patch.object(
        agent, "_notify", new_callable=AsyncMock
    ):
        # Patch the dedup check to return existing data
        with patch.object(agent, "_handle_promo") as mock_handle_promo:
            # We need to test _handle_promo directly with mocked dedup
            mock_handle_promo.side_effect = AsyncMock()
            await agent.process_message(payload)

    # Now test _handle_promo directly with a dedup hit
    db2, chain2 = _make_db_mock(existing_promo_data=[{"id": "existing-promo"}])
    agent2 = _make_agent(db=db2)
    agent2.haiku_semaphore = asyncio.Semaphore(5)

    promo_details = _mock_promo_details()
    classification = _mock_classification("PROMO")

    with patch.object(
        agent2, "_extract_promo", return_value=promo_details
    ), patch.object(agent2, "_notify", new_callable=AsyncMock):
        await agent2._handle_promo(
            payload=_promo_payload(gmail_message_id="dup-msg"),
            classification=classification,
            restaurant_id="rest-abc",
            is_stale=False,
        )

    # Insert must NOT be called when dedup match found
    [c for c in db2.supabase.table.call_args_list if "vendor_promotions" in str(c)]
    # Only the select (dedup check) call should exist, no insert
    table_mock = db2.supabase.table.return_value
    table_mock.insert.assert_not_called()


# ---------------------------------------------------------------------------
# Test 5: Stale email (>18h) skips Redis digest accumulation
# ---------------------------------------------------------------------------


async def test_stale_email_skips_redis_digest():
    """Emails older than STALE_EMAIL_HOURS must not be pushed to Redis digest."""
    # Timestamp 20 hours ago
    stale_time = (datetime.now(tz=timezone.utc) - timedelta(hours=20)).isoformat()
    payload = _promo_payload(received_at=stale_time, gmail_message_id="stale-msg-001")

    db, chain = _make_db_mock()
    chain.insert.return_value.execute.return_value.data = [{"id": "stale-promo-id"}]

    redis_mock = MagicMock()
    pipe_mock = MagicMock()
    pipe_mock.execute = AsyncMock()
    redis_mock.pipeline.return_value = pipe_mock

    agent = _make_agent(db=db, redis=redis_mock)
    agent.haiku_semaphore = asyncio.Semaphore(5)

    with patch.object(agent, "_check_idempotency", return_value=False), patch.object(
        agent, "_classify_email", return_value=_mock_classification("PROMO")
    ), patch.object(
        agent, "_extract_promo", return_value=_mock_promo_details()
    ), patch.object(
        agent, "_compute_urgency_score", return_value=3.0
    ), patch.object(
        agent, "_find_linked_events", return_value=[]
    ), patch.object(
        agent, "_get_last_purchase_price", return_value=None
    ), patch.object(
        agent, "_mark_processed", new_callable=AsyncMock
    ), patch.object(
        agent, "_notify", new_callable=AsyncMock
    ):
        await agent.process_message(payload)

    # Redis pipeline must NOT have been called (stale email)
    redis_mock.pipeline.assert_not_called()


# ---------------------------------------------------------------------------
# Test 6: Urgency score formula D-16
# ---------------------------------------------------------------------------


async def test_urgency_score_formula():
    """
    D-16: urgency = round(min(10.0, fit_score × stock_factor × calendar_prox × 10), 1)
    With fit_score=0.6 (PARTIAL_FIT), stock_live=0, threshold_min=4, calendar_prox=1.0 (event ≤3d):
      stock_factor = max(0, 1 - 0/(4*2)) = 1.0
      urgency = round(min(10, 0.6 × 1.0 × 1.0 × 10), 1) = 6.0
    """
    from datetime import date as _date

    agent = _make_agent()
    db, chain = _make_db_mock()

    # Mock inventory: stock_live=0, threshold_min=4, matching Pinot Noir
    inv_row = {
        "stock_live": 0,
        "threshold_min": 4,
        "master_wine_library": {"grape_variety": "Pinot Noir"},
    }
    cal_row = {"event_date": (_date.today() + timedelta(days=2)).isoformat()}  # ≤3 days

    # First call returns inventory (for stock_factor), second returns calendar (for calendar_prox)
    execute_results = [
        MagicMock(data=[inv_row]),  # restaurant_inventory query
        MagicMock(data=[cal_row]),  # calendar_events query
    ]
    chain.execute.side_effect = execute_results

    agent.database = db
    classification = _mock_classification("PROMO")
    score = await agent._compute_urgency_score("rest-abc", "Pinot Noir", classification)

    # Expected: fit=0.6, stock_factor=1.0, calendar_prox=1.0 → 6.0
    assert score == 6.0, f"Expected urgency=6.0, got {score}"


# ---------------------------------------------------------------------------
# Test 7: Haiku semaphore is acquired during PROMO extraction
# ---------------------------------------------------------------------------


async def test_haiku_semaphore_acquired_during_extraction():
    """The haiku_semaphore must be acquired when _extract_promo is called."""
    agent = _make_agent()
    acquired = []

    asyncio.Semaphore(5)

    class TrackingSemaphore:
        """Wrapper that records acquisition."""

        async def __aenter__(self):
            acquired.append(True)
            return self

        async def __aexit__(self, *args):
            pass

    agent.haiku_semaphore = TrackingSemaphore()

    with patch.object(
        agent, "_extract_promo", return_value=_mock_promo_details()
    ), patch.object(agent, "_compute_urgency_score", return_value=5.0), patch.object(
        agent, "_find_linked_events", return_value=[]
    ), patch.object(
        agent, "_get_last_purchase_price", return_value=None
    ), patch.object(
        agent, "_notify", new_callable=AsyncMock
    ):
        await agent._handle_promo(
            payload=_promo_payload(),
            classification=_mock_classification("PROMO"),
            restaurant_id="rest-abc",
            is_stale=False,
        )

    assert (
        len(acquired) == 1
    ), "Semaphore must be acquired exactly once per PROMO extraction"


# ---------------------------------------------------------------------------
# Test 8: Idempotency check — duplicate gmail_message_id skips processing
# ---------------------------------------------------------------------------


async def test_idempotency_skips_duplicate_message():
    """If _check_idempotency returns True (already processed), skip all logic."""
    agent = _make_agent()
    payload = {
        "gmail_message_id": "already-processed-msg",
        "subject": "20% off deal",
        "body": "Great deal",
        "restaurant_id": "rest-abc",
        "received_at": datetime.now(tz=timezone.utc).isoformat(),
    }

    with patch.object(
        agent, "_check_idempotency", return_value=True
    ) as mock_check, patch.object(
        agent, "_triage_inbound", new_callable=AsyncMock
    ) as mock_triage, patch.object(
        agent, "_mark_processed", new_callable=AsyncMock
    ) as mock_mark:
        await agent.process_message(payload)

    mock_check.assert_called_once_with("email_intel:already-processed-msg")
    mock_triage.assert_not_called()
    mock_mark.assert_not_called()


# =============================================================================
# Classification escalation (ADR 0010): low-confidence primary -> Sonnet
# =============================================================================

ESCALATION_JSON = (
    '{"category": "PROMO", "confidence": 0.91, "reasoning": "discount with deadline", '
    '"provider_name": "Caves", "urgency": "high"}'
)


def _agent():
    return EmailIntelAgent(message_bus=MagicMock(), database=MagicMock())


def _gemini_returning(category: str, confidence: float):
    """Mock the Gemini client so only the confidence gate is under test."""
    resp = MagicMock()
    resp.text = (
        f'{{"category": "{category}", "confidence": {confidence}, "reasoning": "r", '
        f'"provider_name": "V", "urgency": "low"}}'
    )
    resp.usage_metadata.prompt_token_count = 400
    resp.usage_metadata.candidates_token_count = 60
    resp.usage_metadata.thoughts_token_count = 0
    client = MagicMock()
    client.models.generate_content.return_value = resp
    return client


def _anthropic_returning(text: str):
    block = MagicMock()
    block.type = "text"
    block.text = text
    resp = MagicMock()
    resp.content = [block]
    resp.usage.input_tokens = 400
    resp.usage.output_tokens = 60
    client = MagicMock()
    client.messages.create = AsyncMock(return_value=resp)
    return client


async def test_confident_primary_does_not_escalate():
    """Escalation costs ~10x per token — it must not fire on confident calls."""
    agent = _agent()
    with patch(
        "agents.email_intel_agent.get_gemini_client",
        return_value=_gemini_returning("PROMO", 0.95),
    ), patch.object(agent, "_escalate_classification", new_callable=AsyncMock) as esc:
        result = await agent._classify_email("s", "b")

    esc.assert_not_awaited()
    assert result.category == "PROMO"


async def test_low_confidence_primary_escalates_and_result_wins():
    agent = _agent()
    with patch(
        "agents.email_intel_agent.get_gemini_client",
        return_value=_gemini_returning("NOISE", 0.20),
    ), patch(
        "agents.email_intel_agent.get_anthropic_client",
        return_value=_anthropic_returning(ESCALATION_JSON),
    ):
        result = await agent._classify_email("s", "b")

    assert result.category == "PROMO"  # escalated verdict replaces the primary
    assert result.confidence == 0.91


async def test_escalation_failure_keeps_primary_verdict():
    """A failed escalation must never drop the email — degraded beats lost."""
    agent = _agent()
    with patch(
        "agents.email_intel_agent.get_gemini_client",
        return_value=_gemini_returning("NOISE", 0.20),
    ), patch(
        "agents.email_intel_agent.get_anthropic_client",
        side_effect=RuntimeError("anthropic down"),
    ):
        result = await agent._classify_email("s", "b")

    assert result.category == "NOISE"  # primary survives
    assert result.confidence == 0.20


async def test_escalation_parses_json_embedded_in_prose():
    """Anthropic has no response_mime_type, so JSON can arrive wrapped in text."""
    agent = _agent()
    client = _anthropic_returning(f"Looking at this:\n```json\n{ESCALATION_JSON}\n```")
    with patch("agents.email_intel_agent.get_anthropic_client", return_value=client):
        result = await agent._escalate_classification(
            "s", "b", MagicMock(confidence=0.2)
        )

    assert result is not None and result.category == "PROMO"
    assert client.messages.create.await_args.kwargs["model"] == "claude-sonnet-5"


async def test_escalation_returns_none_when_no_json_present():
    agent = _agent()
    client = _anthropic_returning("I am unable to classify this.")
    with patch("agents.email_intel_agent.get_anthropic_client", return_value=client):
        assert (
            await agent._escalate_classification("s", "b", MagicMock(confidence=0.2))
            is None
        )
