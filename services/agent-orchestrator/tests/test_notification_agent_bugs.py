"""Tests for BUG-07 (Redis rate limits) and BUG-08 (batch task monitoring)."""

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from agents.notification_agent import NotificationAgent


def _make_agent(config=None):
    """Build a NotificationAgent with mocked dependencies."""
    cfg = {
        "mock_mode": True,
        "redis_url": "redis://localhost:6379",
        "plivo_auth_id": None,
        "plivo_auth_token": None,
        "plivo_phone_number": None,
        "email_backend": "gmail",
        "gmail_user": None,
        "gmail_password": None,
        "sendgrid_api_key": None,
        "from_email": None,
        "vapid_private_key": None,
        "vapid_public_key": None,
        "vapid_email": None,
        "fcm_server_key": None,
    }
    if config:
        cfg.update(config)

    agent = NotificationAgent.__new__(NotificationAgent)
    agent.agent_name = "test_notification"
    agent.logger = MagicMock()
    agent.mock_mode = True
    agent.config = cfg
    agent.rate_limits = {
        "sms": {"per_hour": 10, "per_day": 50},
        "email": {"per_hour": 50, "per_day": 200},
        "push": {"per_hour": 100, "per_day": 500},
    }
    agent._batch_task = None
    agent._redis = None
    # Mocked service clients (not under test)
    agent.sms_client = MagicMock()
    agent.email_client = MagicMock()
    agent.push_service = MagicMock()
    agent.notification_queue = {}
    agent.batch_interval_seconds = 300
    return agent


# ---------------------------------------------------------------------------
# BUG-07: Redis-backed rate limits
# ---------------------------------------------------------------------------


class TestBUG07RedisRateLimits:
    def test_check_rate_limit_calls_redis_get(self):
        """_check_rate_limit must query Redis, not self.rate_limit_counters."""
        agent = _make_agent()
        mock_redis = MagicMock()
        # Redis GET returns current count below limit
        mock_redis.get = AsyncMock(return_value="3")
        agent._redis = mock_redis

        import asyncio

        result = asyncio.get_event_loop().run_until_complete(
            agent._check_rate_limit("rest-1", "sms")
        )
        assert result is True
        mock_redis.get.assert_called_once_with("wineops:ratelimit:rest-1:sms:hour")

    def test_check_rate_limit_blocks_when_at_limit(self):
        """_check_rate_limit returns False when Redis counter >= per_hour limit."""
        agent = _make_agent()
        mock_redis = MagicMock()
        # Redis GET returns count at limit (10 for SMS)
        mock_redis.get = AsyncMock(return_value="10")
        agent._redis = mock_redis

        result = asyncio.get_event_loop().run_until_complete(
            agent._check_rate_limit("rest-1", "sms")
        )
        assert result is False

    def test_check_rate_limit_allows_when_below_limit(self):
        """_check_rate_limit returns True when Redis counter < per_hour limit."""
        agent = _make_agent()
        mock_redis = MagicMock()
        mock_redis.get = AsyncMock(return_value="5")
        agent._redis = mock_redis

        result = asyncio.get_event_loop().run_until_complete(
            agent._check_rate_limit("rest-1", "sms")
        )
        assert result is True

    def test_check_rate_limit_allows_when_key_missing(self):
        """_check_rate_limit returns True when Redis key doesn't exist yet (None)."""
        agent = _make_agent()
        mock_redis = MagicMock()
        mock_redis.get = AsyncMock(return_value=None)
        agent._redis = mock_redis

        result = asyncio.get_event_loop().run_until_complete(
            agent._check_rate_limit("rest-1", "email")
        )
        assert result is True

    def test_increment_rate_limit_calls_incr_and_expire(self):
        """_increment_rate_limit must INCR the Redis key and set TTL 3600."""
        agent = _make_agent()
        mock_redis = MagicMock()
        mock_redis.incr = AsyncMock(return_value=1)
        mock_redis.expire = AsyncMock(return_value=True)
        agent._redis = mock_redis

        asyncio.get_event_loop().run_until_complete(
            agent._increment_rate_limit("rest-1", "sms")
        )

        mock_redis.incr.assert_called_once_with("wineops:ratelimit:rest-1:sms:hour")
        # expire called only when counter == 1 (first increment sets TTL)
        mock_redis.expire.assert_called_once_with(
            "wineops:ratelimit:rest-1:sms:hour", 3600
        )

    def test_increment_subsequent_does_not_reset_expire(self):
        """_increment_rate_limit must NOT reset TTL on subsequent increments (counter > 1)."""
        agent = _make_agent()
        mock_redis = MagicMock()
        mock_redis.incr = AsyncMock(return_value=5)  # not the first increment
        mock_redis.expire = AsyncMock(return_value=True)
        agent._redis = mock_redis

        asyncio.get_event_loop().run_until_complete(
            agent._increment_rate_limit("rest-1", "sms")
        )

        mock_redis.incr.assert_called_once()
        mock_redis.expire.assert_not_called()


# ---------------------------------------------------------------------------
# BUG-08: Batch processor task monitoring
# ---------------------------------------------------------------------------


class TestBUG08BatchTaskMonitoring:
    @pytest.mark.asyncio
    async def test_initialize_stores_batch_task(self):
        """After initialize(), self._batch_task must be set and be an asyncio.Task."""
        agent = _make_agent()
        mock_redis = MagicMock()
        mock_redis.ping = AsyncMock(return_value=True)
        # Mock the redis.asyncio.from_url call
        with patch("agents.notification_agent.aioredis") as mock_aioredis:
            mock_aioredis.from_url = AsyncMock(return_value=mock_redis)
            await agent.initialize()

        assert (
            agent._batch_task is not None
        ), "BUG-08: self._batch_task not set in initialize()"
        assert isinstance(
            agent._batch_task, asyncio.Task
        ), "BUG-08: self._batch_task is not an asyncio.Task"

    @pytest.mark.asyncio
    async def test_health_check_reports_running_task(self):
        """health_check returns batch_processor_running=True when task is running."""
        agent = _make_agent()

        # Create a long-running task
        async def never_done():
            await asyncio.sleep(9999)

        agent._batch_task = asyncio.create_task(never_done())

        # Provide a mock super().health_check() via patching BaseAgent
        with patch.object(
            type(agent).__bases__[0],
            "health_check",
            new=AsyncMock(return_value={"healthy": True, "agent": "test"}),
        ):
            result = await agent.health_check()

        assert result.get("batch_processor_running") is True
        agent._batch_task.cancel()

    @pytest.mark.asyncio
    async def test_health_check_reports_dead_task(self):
        """health_check returns batch_processor_running=False, healthy=False when task crashed."""
        agent = _make_agent()

        async def crash_immediately():
            raise RuntimeError("batch processor crash")

        task = asyncio.create_task(crash_immediately())
        # Let the task finish
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=0.1)
        except Exception:
            pass

        agent._batch_task = task

        with patch.object(
            type(agent).__bases__[0],
            "health_check",
            new=AsyncMock(return_value={"healthy": True, "agent": "test"}),
        ):
            result = await agent.health_check()

        assert result.get("batch_processor_running") is False
        assert result.get("healthy") is False
