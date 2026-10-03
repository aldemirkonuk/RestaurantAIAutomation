"""Owner-quarter sim F-126: one "pre-drafts paused" notice per pause.

Past the house's daily AI pre-draft cap, every new order used to post its own
HIGH "Draft limit reached ... Drafts frozen until tomorrow" notice. The bell
flooded, and both halves of the sentence were false. The cap itself is not
changed here (it waits on the houses' F-084/F-089 change, share-out O1); only
how often the notice fires and what it says. Words ruled by the founder,
2026-10-03 (ADR 0260, follow-up rulings).

The Redis here is a small in-memory stand-in with a clock, so the tests can
walk a pause from start to end instead of asserting on mock calls alone.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.provider_communication_agent import (
    ProviderCommunicationAgent,
    _ordinal,
)

HOUSE = "rest-1"
RATE_KEY = f"negotiation_draft:{HOUSE}:day"
FENCE_KEY = f"prov_comm:cap_notice:{HOUSE}"
DAY = 86400


class _FakeRedis:
    """get / set(nx, ex, px) / ttl / pipeline(incr, expire) with a movable clock."""

    def __init__(self) -> None:
        self.now = 0.0
        self.store: dict = {}

    def _live(self, key):
        entry = self.store.get(key)
        if entry is None:
            return None
        if entry[1] is not None and entry[1] <= self.now:
            del self.store[key]
            return None
        return entry

    async def get(self, key):
        entry = self._live(key)
        return None if entry is None else entry[0]

    async def set(self, key, value, nx=False, ex=None, px=None):
        if nx and self._live(key) is not None:
            return None
        if ex is not None:
            expires = self.now + ex
        elif px is not None:
            expires = self.now + px / 1000
        else:
            expires = None
        self.store[key] = (str(value), expires)
        return True

    async def ttl(self, key):
        entry = self._live(key)
        if entry is None:
            return -2
        if entry[1] is None:
            return -1
        return int(entry[1] - self.now)

    def pipeline(self):
        return _FakePipeline(self)


class _FakePipeline:
    def __init__(self, redis: _FakeRedis) -> None:
        self.redis = redis
        self.ops: list = []

    def incr(self, key):
        self.ops.append(("incr", key))

    def expire(self, key, seconds):
        self.ops.append(("expire", key, seconds))

    async def execute(self):
        out = []
        for op in self.ops:
            entry = self.redis._live(op[1])
            if op[0] == "incr":
                count = int(entry[0]) + 1 if entry else 1
                self.redis.store[op[1]] = (str(count), entry[1] if entry else None)
                out.append(count)
            else:
                if entry:
                    self.redis.store[op[1]] = (entry[0], self.redis.now + op[2])
                out.append(bool(entry))
        self.ops = []
        return out


def _agent(redis) -> ProviderCommunicationAgent:
    a = ProviderCommunicationAgent(
        message_bus=AsyncMock(),
        database=MagicMock(),
        redis_client=redis,
    )
    a.haiku_semaphore = asyncio.Semaphore(1)
    a.logger = MagicMock()
    a.settings.negotiation_draft_daily_cap = 50
    a._check_idempotency = AsyncMock(return_value=False)
    a._mark_processed = AsyncMock()
    a._notify = AsyncMock()
    return a


def _order(n: int) -> dict:
    return {
        "order_id": f"ord-{n}",
        "restaurant_id": HOUSE,
        "provider_id": "prov-1",
        "wine_name": "Pommard 1er Cru",
        "quantity": 4,
    }


def _cap_notices(agent) -> list:
    return [
        c
        for c in agent._notify.call_args_list
        if c.kwargs.get("notification_type") == "rate_limit_reached"
    ]


def _at_cap(redis: _FakeRedis, seconds_left: int = DAY) -> None:
    """The 50th pre-draft has been counted; the counter clears in seconds_left."""
    redis.store[RATE_KEY] = ("50", redis.now + seconds_left)


class TestOneNoticePerPause:
    @pytest.mark.asyncio
    async def test_three_orders_over_the_cap_post_one_notice(self):
        redis = _FakeRedis()
        _at_cap(redis)
        agent = _agent(redis)

        for n in range(3):
            await agent._handle_order_created(_order(n))

        assert len(_cap_notices(agent)) == 1
        assert agent._notify.await_count == 1, "an over-cap order drafts nothing"

    @pytest.mark.asyncio
    async def test_the_fence_lasts_as_long_as_the_pause(self):
        redis = _FakeRedis()
        _at_cap(redis, seconds_left=5000)
        agent = _agent(redis)

        await agent._handle_order_created(_order(1))

        assert await redis.ttl(FENCE_KEY) == 5000 + 60

    @pytest.mark.asyncio
    async def test_the_next_pause_gets_its_own_notice(self):
        redis = _FakeRedis()
        _at_cap(redis, seconds_left=5000)
        agent = _agent(redis)
        await agent._handle_order_created(_order(1))

        redis.now += 5000 + 61  # counter and fence have both cleared
        _at_cap(redis)  # fifty more pre-drafts later, the cap is reached again
        await agent._handle_order_created(_order(2))
        await agent._handle_order_created(_order(3))

        assert len(_cap_notices(agent)) == 2

    @pytest.mark.asyncio
    async def test_a_ttl_redis_cannot_give_holds_the_fence_a_day(self):
        redis = _FakeRedis()
        redis.store[RATE_KEY] = ("50", None)  # no expiry on the counter
        agent = _agent(redis)

        await agent._handle_order_created(_order(1))

        assert len(_cap_notices(agent)) == 1
        assert await redis.ttl(FENCE_KEY) == DAY

    @pytest.mark.asyncio
    async def test_a_failed_fence_sends_nothing(self):
        redis = _FakeRedis()
        _at_cap(redis)
        real_set = redis.set

        async def set_fails_for_the_fence(key, *args, **kwargs):
            if key == FENCE_KEY:
                raise ConnectionError("redis went away")
            return await real_set(key, *args, **kwargs)

        redis.set = set_fails_for_the_fence
        agent = _agent(redis)

        await agent._handle_order_created(_order(1))

        assert _cap_notices(agent) == []
        agent.logger.error.assert_called()

    @pytest.mark.asyncio
    async def test_houses_are_fenced_apart(self):
        redis = _FakeRedis()
        _at_cap(redis)
        redis.store["negotiation_draft:rest-2:day"] = ("50", redis.now + DAY)
        agent = _agent(redis)

        await agent._handle_order_created(_order(1))
        await agent._handle_order_created({**_order(2), "restaurant_id": "rest-2"})

        assert [c.kwargs["restaurant_id"] for c in _cap_notices(agent)] == [
            HOUSE,
            "rest-2",
        ]


class TestTheWords:
    @pytest.mark.asyncio
    async def test_the_notice_says_what_is_true(self):
        redis = _FakeRedis()
        _at_cap(redis)
        agent = _agent(redis)

        await agent._handle_order_created(_order(1))

        (call,) = _cap_notices(agent)
        assert call.kwargs["title"] == "AI pre-drafts paused"
        assert call.kwargs["message"] == (
            "This house reached its limit of 50 AI pre-drafts. "
            "They resume 24 hours after the 50th. "
            "Orders you approve still get a vendor letter to review."
        )
        assert call.kwargs["priority"] == "high"
        assert call.kwargs["action_url"] == "/orders"
        assert call.kwargs["group_key"] == "rate_limit_reached"
        # One notice stands for every order in the pause, so it names none.
        assert "metadata" not in call.kwargs

    @pytest.mark.asyncio
    async def test_the_words_follow_the_configured_cap(self):
        redis = _FakeRedis()
        _at_cap(redis)
        agent = _agent(redis)
        agent.settings.negotiation_draft_daily_cap = 22
        redis.store[RATE_KEY] = ("22", redis.now + DAY)

        await agent._handle_order_created(_order(1))

        (call,) = _cap_notices(agent)
        assert "limit of 22 AI pre-drafts" in call.kwargs["message"]
        assert "after the 22nd." in call.kwargs["message"]

    @pytest.mark.parametrize(
        "n, word",
        [
            (1, "1st"),
            (2, "2nd"),
            (3, "3rd"),
            (4, "4th"),
            (11, "11th"),
            (12, "12th"),
            (13, "13th"),
            (21, "21st"),
            (50, "50th"),
            (101, "101st"),
            (111, "111th"),
            (112, "112th"),
        ],
    )
    def test_ordinal(self, n, word):
        assert _ordinal(n) == word


class TestGroupKeyReachesTheBell:
    @pytest.mark.asyncio
    async def test_notify_passes_group_key_through(self):
        agent = ProviderCommunicationAgent(
            message_bus=AsyncMock(), database=MagicMock(), redis_client=None
        )
        agent.logger = MagicMock()
        with patch(
            "agents.provider_communication_agent.notify_restaurant",
            new_callable=AsyncMock,
            return_value=1,
        ) as notify:
            await agent._notify(
                restaurant_id=HOUSE,
                notification_type="rate_limit_reached",
                title="t",
                message="m",
                group_key="rate_limit_reached",
            )

        assert notify.await_args.kwargs["group_key"] == "rate_limit_reached"
