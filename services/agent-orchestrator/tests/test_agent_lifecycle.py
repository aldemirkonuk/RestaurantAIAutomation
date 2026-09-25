"""Real lifecycle methods against an in-memory broker; no external services."""

import asyncio
import json
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock

import pytest

from core.base_agent import BaseAgent, AgentStatus
from core.agent_registry import AgentRegistry, AgentTier, LazyAgentProxy, AgentSpec
from core.message_bus import MessageBus

# Exact source methods, with no startup/import of unrelated provider SDKs.
import ast
from pathlib import Path
from utils.logger import setup_logger

_orchestrator_source = Path(__file__).parents[1] / "core" / "orchestrator.py"
_tree = ast.parse(_orchestrator_source.read_text())
_class = next(
    n
    for n in _tree.body
    if isinstance(n, ast.ClassDef) and n.name == "AgentOrchestrator"
)
_methods = [
    n
    for n in _class.body
    if isinstance(n, ast.AsyncFunctionDef)
    and n.name in {"stop_agent", "restart_agent", "start_agent", "get_agent_health"}
]
_namespace = {
    "Dict": dict,
    "Any": object,
    "AgentStatus": AgentStatus,
    "asyncio": asyncio,
    "logger": setup_logger(__name__),
}
exec(
    compile(
        ast.Module(body=_methods, type_ignores=[]), str(_orchestrator_source), "exec"
    ),
    _namespace,
)
AgentOrchestrator = type(
    "AgentOrchestrator", (), {n.name: _namespace[n.name] for n in _methods}
)


class Incoming:
    def __init__(self, body, key=""):
        self.body = json.dumps(body).encode()
        self.headers = {"x-idempotency-key": key}
        self.exchange, self.routing_key = "test.events", "test.work"
        self.acked, self.requeued, self.processed = 0, None, False

    async def ack(self):
        assert not self.processed, "duplicate acknowledgement"
        self.acked, self.processed = self.acked + 1, True

    async def reject(self, requeue):
        assert not self.processed, "duplicate rejection"
        self.requeued, self.processed = requeue, True

    @asynccontextmanager
    async def process(self, ignore_processed=False):
        yield self
        if not (ignore_processed and self.processed):
            await self.ack()


class Queue:
    def __init__(self):
        self.callbacks, self.next_tag, self.cancel_calls = {}, 0, []
        self.cancel_error = False

    async def consume(self, callback, no_ack=False):
        self.next_tag += 1
        tag = f"consumer-{self.next_tag}"
        self.callbacks[tag] = callback
        return tag

    async def cancel(self, tag, timeout=None):
        self.cancel_calls.append(tag)
        if self.cancel_error:
            raise ConnectionError("broker cancellation failed")
        del self.callbacks[tag]

    async def deliver(self, body, key=""):
        msg = Incoming(body, key)
        await next(iter(self.callbacks.values()))(msg)
        return msg


class Agent(BaseAgent):
    def __init__(self, bus, **config):
        super().__init__(
            "test",
            bus,
            MagicMock(),
            {
                "circuit_breaker_enabled": False,
                "max_retries": 1,
                "task_timeout_seconds": 2,
                "max_concurrent_tasks": 1,
                **config,
            },
        )
        self.initialize_count = self.cleanup_count = 0
        self.cleanup_error, self.seen = False, []
        self.entered, self.release = asyncio.Event(), asyncio.Event()
        self.release.set()

    async def initialize(self):
        self.initialize_count += 1

    async def cleanup(self):
        self.cleanup_count += 1
        if self.cleanup_error:
            raise RuntimeError("cleanup failed")

    async def process_message(self, message):
        self.entered.set()
        await self.release.wait()
        self.seen.append(message["number"])

    def get_subscribed_routing_keys(self):
        return [("test.events", "test.work")]


def fixture(**config):
    bus, queue = MessageBus("amqp://unused"), Queue()
    bus.queues["queue.test.test_work"] = queue
    return Agent(bus, **config), bus, queue


def proxy_for(agent):
    return LazyAgentProxy(AgentSpec("test", Agent), lambda: agent, {})


def orchestrator_for(agent, proxy=None):
    orchestrator = AgentOrchestrator.__new__(AgentOrchestrator)
    orchestrator.agents = {"test": agent}
    orchestrator._proxies = {"test": proxy} if proxy else {}
    return orchestrator


async def eventually(predicate):
    for _ in range(100):
        if predicate():
            return
        await asyncio.sleep(0.001)
    assert predicate()


@pytest.mark.asyncio
async def test_restart_reuses_instance_with_live_worker_and_one_subscription():
    agent, _, queue = fixture()
    proxy = proxy_for(agent)
    orchestrator = orchestrator_for(agent, proxy)
    await proxy.ensure_started()
    assert (await queue.deliver({"number": 1})).acked == 1
    old_worker = agent._processor_task
    assert (await orchestrator.restart_agent("test"))["success"] is True
    assert old_worker.done() and not agent._shutdown_event.is_set()
    assert not agent._processor_task.done() and len(queue.callbacks) == 1
    await queue.deliver({"number": 2})
    assert (await orchestrator.stop_agent("test"))["success"] is True
    assert agent.seen == [1, 2]
    assert orchestrator.agents["test"] is agent and proxy.state == "stopped"
    assert (await orchestrator.restart_agent("test"))["success"] is True
    await queue.deliver({"number": 3})
    await proxy.stop()
    assert agent.seen == [1, 2, 3] and not queue.callbacks


@pytest.mark.asyncio
async def test_paused_stop_drains_all_previously_acknowledged_work():
    agent, _, queue = fixture()
    await agent.start()
    await agent.pause()
    for number in range(4):
        assert (await queue.deliver({"number": number})).acked == 1
    await agent.stop()
    assert agent.seen == list(range(4)) and agent.status == AgentStatus.STOPPED
    assert agent._message_queue.empty() and agent._processor_task.done()


@pytest.mark.asyncio
async def test_stop_waits_for_inflight_work_before_cleanup():
    agent, _, queue = fixture()
    agent.release.clear()
    await agent.start()
    await queue.deliver({"number": 1})
    await agent.entered.wait()
    stopping = asyncio.create_task(agent.stop())
    await eventually(lambda: not queue.callbacks)
    assert not stopping.done() and agent.cleanup_count == 0
    agent.release.set()
    await stopping
    assert agent.seen == [1] and agent.cleanup_count == 1


@pytest.mark.asyncio
async def test_timeout_never_cancels_business_work_or_allows_second_worker():
    agent, _, queue = fixture()
    agent.release.clear()
    await agent.start()
    await queue.deliver({"number": 1})
    await agent.entered.wait()
    work = next(iter(agent._active_tasks))
    # The business call already has its 2s limit. Shorten only the stop window.
    agent.config.task_timeout_seconds = 0.01
    with pytest.raises(TimeoutError, match="still draining"):
        await agent.stop()
    assert not work.cancelled() and not work.done()
    assert agent.status == AgentStatus.ERROR and agent.cleanup_count == 0
    with pytest.raises(RuntimeError, match="Previous agent run"):
        await agent.start()
    agent.release.set()
    agent.config.task_timeout_seconds = 2
    await agent.stop()
    assert agent.seen == [1]
    await agent.start()
    await queue.deliver({"number": 2})
    await agent.stop()
    assert agent.seen == [1, 2]


@pytest.mark.asyncio
@pytest.mark.parametrize("lazy", [False, True])
async def test_cleanup_failure_is_not_reported_as_success(lazy):
    agent, _, queue = fixture()
    proxy = proxy_for(agent) if lazy else None
    await (proxy.ensure_started() if proxy else agent.start())
    agent.cleanup_error = True
    orchestrator = orchestrator_for(agent, proxy)
    assert (await orchestrator.restart_agent("test"))["success"] is False
    assert agent.status == AgentStatus.ERROR and agent.initialize_count == 1
    assert not queue.callbacks
    if proxy:
        assert proxy.state == "error" and not proxy.is_active
    assert (await orchestrator.stop_agent("test"))["success"] is False
    agent.cleanup_error = False
    assert (await orchestrator.stop_agent("test"))["success"] is True
    assert (await orchestrator.restart_agent("test"))["success"] is True
    await agent.stop()


@pytest.mark.asyncio
async def test_failed_broker_cancel_is_retained_and_safe_to_retry():
    agent, bus, queue = fixture()
    await agent.start()
    queue.cancel_error = True
    with pytest.raises(ConnectionError):
        await agent.stop()
    assert agent.status == AgentStatus.ERROR and agent.cleanup_count == 0
    assert len(agent._consumer_tags) == len(bus._consumers) == 1
    racing_delivery = asyncio.create_task(queue.deliver({"number": 1}, "not-accepted"))
    await asyncio.sleep(0)
    assert not racing_delivery.done()  # no hot requeue while cancel is failing
    assert "not-accepted" not in bus._processed_ids
    queue.cancel_error = False
    await agent.stop()
    racing = await racing_delivery
    assert racing.requeued is True and racing.acked == 0
    assert not bus._consumers and not queue.callbacks and agent.seen == []


@pytest.mark.asyncio
@pytest.mark.parametrize("stop", [True, False])
async def test_full_queue_backpressures_without_ack_or_retry_loop(stop):
    agent, bus, queue = fixture(max_queue_size=1)
    await agent.start()
    await agent.pause()
    await asyncio.sleep(0)
    await queue.deliver({"number": 1})
    pending = asyncio.create_task(queue.deliver({"number": 2}, "held"))
    await asyncio.sleep(0)
    assert not pending.done()
    if stop:
        await agent.stop()
        msg = await pending
        assert msg.acked == 0 and msg.requeued is True
        assert "held" not in bus._processed_ids and agent.seen == [1]
    else:
        await agent.resume()
        msg = await pending
        assert msg.acked == 1 and msg.requeued is None
        await agent.stop()
        assert agent.seen == [1, 2]


@pytest.mark.asyncio
@pytest.mark.parametrize("lazy", [False, True])
async def test_parallel_starts_create_only_one_worker(lazy):
    agent, _, queue = fixture()
    proxy = proxy_for(agent)
    start = proxy.ensure_started if lazy else agent.start
    await asyncio.gather(*(start() for _ in range(5)))
    assert agent.initialize_count == 1 and len(queue.callbacks) == 1
    await (proxy.stop() if lazy else agent.stop())


@pytest.mark.asyncio
async def test_cancel_one_consumer_preserves_other_and_requeues_late_delivery():
    _, bus, queue = fixture()
    first, second = AsyncMock(), AsyncMock()
    name = "queue.test.test_work"
    tag1 = await bus.consume(name, first)
    old_callback = queue.callbacks[tag1]
    tag2 = await bus.consume(name, second)
    await bus.stop_consuming(name, tag1)
    assert list(queue.callbacks) == [tag2]
    late = Incoming({"number": 1}, "late")
    await old_callback(late)
    first.assert_not_awaited()
    assert late.requeued is True and late.acked == 0
    assert "late" not in bus._processed_ids
    assert (await queue.deliver({"number": 2})).acked == 1
    second.assert_awaited_once()
    await bus.stop_consuming(name, tag2)
    assert not bus.handlers


@pytest.mark.asyncio
async def test_cancel_timeout_retains_registration_without_cancelling_callback():
    _, bus, queue = fixture()
    entered, release = asyncio.Event(), asyncio.Event()

    async def callback(body):
        entered.set()
        await release.wait()

    name = "queue.test.test_work"
    tag = await bus.consume(name, callback)
    delivery = asyncio.create_task(queue.deliver({"number": 1}))
    await entered.wait()
    with pytest.raises(TimeoutError):
        await bus.stop_consuming(name, tag, timeout=0.001)
    assert not delivery.done() and not delivery.cancelled() and tag in bus._consumers
    release.set()
    assert (await delivery).acked == 1
    await bus.stop_consuming(name, tag)
    assert queue.cancel_calls == [tag] and tag not in bus._consumers


@pytest.mark.asyncio
async def test_failed_partial_start_requires_cleanup_before_retry():
    agent, _, queue = fixture()
    original = agent._setup_subscriptions

    async def subscribe_then_fail():
        await original()
        raise RuntimeError("second binding failed")

    agent._setup_subscriptions = subscribe_then_fail
    with pytest.raises(RuntimeError, match="binding failed"):
        await agent.start()
    with pytest.raises(RuntimeError, match="Previous agent run"):
        await agent.start()
    await agent.stop()
    assert not queue.callbacks and agent._processor_task.done()
    agent._setup_subscriptions = original
    await agent.start()
    await agent.stop()


@pytest.mark.asyncio
async def test_legacy_stop_that_swallows_failure_is_not_successful():
    agent = MagicMock(status=AgentStatus.ERROR)
    agent.stop = AsyncMock()
    orchestrator = orchestrator_for(agent)
    assert (await orchestrator.stop_agent("test"))["success"] is False
    assert (await orchestrator.restart_agent("test"))["success"] is False
    agent.start.assert_not_called()


@pytest.mark.asyncio
async def test_unknown_agent_is_not_started_or_reported_successful():
    orchestrator = orchestrator_for(None)
    assert (await orchestrator.stop_agent("absent"))["success"] is False
    assert (await orchestrator.restart_agent("absent"))["success"] is False


def bind_agent_methods(agent, filename, names, **globals_):
    """Use exact background hooks without importing models/provider SDKs."""
    from types import MethodType
    from datetime import datetime, timedelta

    source = Path(__file__).parents[1] / "agents" / filename
    tree = ast.parse(source.read_text())
    cls = next(
        n
        for n in tree.body
        if isinstance(n, ast.ClassDef)
        and any(isinstance(m, ast.AsyncFunctionDef) and m.name in names for m in n.body)
    )
    methods = [
        n for n in cls.body if isinstance(n, ast.AsyncFunctionDef) and n.name in names
    ]
    assert {n.name for n in methods} == set(names)
    namespace = {
        "asyncio": asyncio,
        "datetime": datetime,
        "timedelta": timedelta,
        "AUTONOMY_TIER": "propose_only",
        "_ERROR_BACKOFF_SECONDS": 60,
        **globals_,
    }
    exec(
        compile(ast.Module(body=methods, type_ignores=[]), str(source), "exec"),
        namespace,
    )
    for method in methods:
        setattr(agent, method.name, MethodType(namespace[method.name], agent))


def background_fixture(kind):
    from types import SimpleNamespace, MethodType

    agent, bus, queue = fixture()
    if kind == "provider":
        agent.mock_mode = True
        agent.email_composer = SimpleNamespace(database=None)
        agent._active_sessions = {}
        agent._proactive_monitor_task = None
        bind_agent_methods(
            agent,
            "provider_conversation_agent.py",
            {
                "initialize",
                "cleanup",
                "_proactive_monitor_loop",
            },
        )
        return agent, "_proactive_monitor_task"
    if kind == "recurring":
        agent._settings = {"scheduler_enabled": True}
        agent._scheduler_task = None
        agent.check_scheduled_orders = AsyncMock()
        bind_agent_methods(
            agent,
            "recurring_order_agent.py",
            {
                "initialize",
                "cleanup",
                "_scheduler_loop",
                "_sleep_until_next_check",
                "_wait_for_shutdown",
            },
        )
        return agent, "_scheduler_task"
    if kind == "notification":
        agent._batch_task = None
        agent._redis = None
        agent.batch_interval_seconds = 300
        bind_agent_methods(
            agent, "notification_agent.py", {"cleanup", "_batch_processor"}
        )

        async def initialize(self):
            # Resource construction is excluded: no Redis connection in this test.
            self._batch_task = asyncio.create_task(self._batch_processor())

        agent.initialize = MethodType(initialize, agent)
        return agent, "_batch_task"
    if kind == "calendar":
        agent._daily_check_task = None
        agent._check_upcoming_events = AsyncMock()
        bind_agent_methods(
            agent,
            "calendar_agent.py",
            {"initialize", "cleanup", "_daily_check_loop"},
        )
        return agent, "_daily_check_task"
    agent.evaluation_interval = 86400
    agent.active_buffers, agent._persistence_tasks = {}, set()
    agent.redis_client = None
    agent.evaluation_task = None
    bind_agent_methods(agent, "buffer_manager.py", {"cleanup", "_periodic_evaluation"})

    async def initialize(self):
        # Resource construction is excluded: no Redis connection in this test.
        self.evaluation_task = asyncio.create_task(self._periodic_evaluation())

    agent.initialize = MethodType(initialize, agent)
    return agent, "evaluation_task"


BACKGROUND_KINDS = ["provider", "buffer", "recurring", "notification", "calendar"]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", BACKGROUND_KINDS)
async def test_background_scheduler_wakes_on_stop_and_restart_has_one_task(kind):
    agent, attr = background_fixture(kind)
    previous = []
    for _ in range(3):
        await agent.start()
        task = getattr(agent, attr)
        assert task not in previous
        previous.append(task)
        await asyncio.sleep(0)
        await agent.stop()
        assert task.done() and not task.cancelled()
        assert getattr(agent, attr) is None
    assert all(t.done() for t in previous)


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", BACKGROUND_KINDS)
async def test_background_inflight_timeout_does_not_force_cancel_or_cleanup(kind):
    agent, attr = background_fixture(kind)
    await agent.start()
    idle_task = getattr(agent, attr)
    agent._shutdown_event.set()
    await idle_task
    agent._shutdown_event.clear()
    release = asyncio.Event()
    work = asyncio.create_task(release.wait())
    setattr(agent, attr, work)
    agent.config.task_timeout_seconds = 0.005
    with pytest.raises(TimeoutError):
        await agent.stop()
    assert not work.done() and not work.cancelled()
    assert getattr(agent, attr) is work and agent.status == AgentStatus.ERROR
    release.set()
    agent.config.task_timeout_seconds = 2
    await agent.stop()
    assert getattr(agent, attr) is None and work.done()


@pytest.mark.asyncio
async def test_notification_redis_client_closes_on_stop_and_restart_opens_only_one():
    from types import MethodType

    agent, attr = background_fixture("notification")
    clients = []

    async def initialize(self):
        client = MagicMock()
        client.close = AsyncMock()
        clients.append(client)
        self._redis = client
        self._batch_task = asyncio.create_task(self._batch_processor())

    agent.initialize = MethodType(initialize, agent)
    for _ in range(2):
        await agent.start()
        assert agent._redis is clients[-1]
        await agent.stop()
        assert agent._redis is None
        clients[-1].close.assert_awaited_once()
    assert len(clients) == 2 and all(c.close.await_count == 1 for c in clients)


@pytest.mark.asyncio
async def test_buffer_persistence_finishes_before_redis_closes():
    agent, _ = background_fixture("buffer")
    await agent.start()
    release = asyncio.Event()
    work = asyncio.create_task(release.wait())
    agent._persistence_tasks.add(work)
    redis = MagicMock()
    redis.close = AsyncMock()
    agent.redis_client = redis
    stopping = asyncio.create_task(agent.stop())
    await asyncio.sleep(0.005)
    redis.close.assert_not_awaited()
    assert not stopping.done()
    release.set()
    await stopping
    redis.close.assert_awaited_once()
    assert agent.redis_client is None


@pytest.mark.asyncio
async def test_resume_cannot_turn_stopped_agent_into_false_active_health():
    agent, _, _ = fixture()
    await agent.start()
    await agent.stop()
    with pytest.raises(RuntimeError, match="must be started"):
        await agent.resume()
    assert agent.get_health()["healthy"] is False


@pytest.mark.asyncio
async def test_failed_initial_start_stays_visible_and_can_be_stopped_and_restarted():
    from types import SimpleNamespace

    agent, _, queue = fixture()
    proxy = proxy_for(agent)
    orchestrator = orchestrator_for(agent, proxy)
    orchestrator.agents.clear()
    orchestrator.system_paused = False
    orchestrator.registry = SimpleNamespace(
        get_all_statuses=lambda: {"test": proxy.get_status()},
        registered_count=1,
        loaded_count=1,
        active_count=0,
    )
    original = agent.initialize
    agent.initialize = AsyncMock(side_effect=RuntimeError("initialization failed"))
    assert (await orchestrator.start_agent("test"))["success"] is False
    assert orchestrator.agents["test"] is agent
    assert (await orchestrator.get_agent_health())["system_healthy"] is False
    assert (await orchestrator.stop_agent("test"))["success"] is True
    agent.initialize = original
    assert (await orchestrator.restart_agent("test"))["success"] is True
    await queue.deliver({"number": 1})
    await proxy.stop()
    assert agent.seen == [1]


@pytest.mark.asyncio
async def test_cancelled_processor_reports_failed_drain_not_cancelled_http_request():
    agent, _, _ = fixture()
    await agent.start()
    agent._processor_task.cancel()
    await asyncio.sleep(0)
    result = await orchestrator_for(agent).stop_agent("test")
    assert result["success"] is False and agent.status == AgentStatus.ERROR


@pytest.mark.asyncio
async def test_second_stop_after_a_cancelled_processor_succeeds():
    """Before this session's fix, `_drain_tasks` never forgot a DONE handle:
    `self._processor_task` still pointed at the same cancelled task after the
    first failed `stop()`, so every later `stop()` re-awaited it, found it
    DONE-and-cancelled again, and failed the same way forever — an agent
    whose processor died once could never reach STOPPED again short of a
    process restart.
    """
    agent, _, _ = fixture()
    await agent.start()
    agent._processor_task.cancel()
    await asyncio.sleep(0)
    first = await orchestrator_for(agent).stop_agent("test")
    assert first["success"] is False and agent.status == AgentStatus.ERROR
    assert agent._processor_task is None, "the cancelled handle must be forgotten"
    second = await orchestrator_for(agent).stop_agent("test")
    assert second["success"] is True and agent.status == AgentStatus.STOPPED


def _fake_proxy(*, suspend):
    """A minimal stand-in with just what the suspend monitor reads."""
    from types import SimpleNamespace

    proxy = SimpleNamespace(
        is_active=True,
        idle_seconds=999999,
        spec=SimpleNamespace(tier=AgentTier.ON_DEMAND, idle_timeout_seconds=1),
    )
    proxy.suspend = suspend
    return proxy


@pytest.mark.asyncio
async def test_one_agents_refused_suspend_does_not_end_auto_suspend_for_every_other():
    """Before this session's fix, `_monitor`'s `while True` had no try/except
    around `proxy.suspend()`: one agent refusing (e.g. `pause()` on an ERROR
    agent) let the exception propagate out of the loop body, silently ending
    the monitor task for every on-demand agent for the rest of the process.
    """
    registry = AgentRegistry()
    failed = AsyncMock(side_effect=RuntimeError("Only a running agent can be paused"))
    healthy = AsyncMock()
    registry._proxies = {
        "broken": _fake_proxy(suspend=failed),
        "fine": _fake_proxy(suspend=healthy),
    }
    await registry.start_suspend_monitor(check_interval=0.01)
    await asyncio.sleep(0.05)
    assert failed.await_count >= 1 and healthy.await_count >= 1
    assert not registry._suspend_task.done(), "the monitor died on the first refusal"
    # stop_suspend_monitor must not re-raise a stored exception either.
    await registry.stop_suspend_monitor()
    assert registry._suspend_task is None
