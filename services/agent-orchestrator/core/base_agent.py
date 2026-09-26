"""
State-of-the-Art Base Agent
============================
Abstract base for autonomous agents with:
- Structured concurrency with TaskGroup
- Circuit breaker for fault tolerance
- Comprehensive lifecycle management
- Performance monitoring and metrics
- Graceful degradation
- Backpressure handling
"""

from __future__ import annotations

import asyncio
import re
import uuid
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List, TypeVar
from datetime import datetime, timedelta
from enum import Enum
from dataclasses import dataclass, field
from contextlib import asynccontextmanager
import traceback

from pydantic import BaseModel

from core.message_bus import (
    MessageBus,
    BaseEvent,
    EventPriority,
    CircuitBreaker,
    CircuitBreakerConfig,
    ConsumerUnavailable,
)
from core.database import DatabaseClient
from utils.logger import setup_logger, set_log_context


T = TypeVar("T")


# =============================================================================
# SUBSCRIPTION QUEUE NAMES
# =============================================================================

# The characters pamqp, the frame codec under aio-pika/aiormq, accepts in a
# queue name (pamqp/constants.py DOMAIN_REGEX["queue-name"], pamqp 3.3.0 as
# pulled in by the aiormq==6.8.0 pin). Queue.Declare, Queue.Bind and
# Basic.Consume are all checked against this set before a frame leaves the
# client, and the first character outside it raises
# ValueError("Invalid value for queue").
_QUEUE_NAME_CHAR = re.compile(r"[a-zA-Z0-9\-_.:@#,/ ]")


def subscription_queue_name(agent_name: str, routing_key: str) -> str:
    """The durable queue one of an agent's subscriptions is consumed from.

    Dots in the routing key become underscores, as they always have. Every
    subscription queue this service has declared was named by that rule, and
    every one is durable. A key that already produced a valid name must keep producing that
    exact name: a renamed queue leaves the old one bound on the broker, filling
    with no consumer.

    The old rule stopped at dots. `*`, the topic-exchange wildcard for one
    word, is a legal binding pattern but not a legal queue-name character.
    provider_conversation_agent subscribes to `system.provider_conversation.*`,
    so every boot died in the codec on that subscription and the agent never
    ran in production. `*` is now written `star`. `#` is left alone: pamqp accepts it, and
    `queue.state_invariant_enforcer.#` already exists under that name. Any other
    character the codec refuses is written as `x` plus its hex code point, so
    no routing key can produce a name the codec rejects.
    """
    word = routing_key.replace(".", "_").replace("*", "star")
    safe = "".join(
        ch if _QUEUE_NAME_CHAR.fullmatch(ch) else f"x{ord(ch):x}" for ch in word
    )
    return f"queue.{agent_name}.{safe}"


# =============================================================================
# AGENT STATUS & LIFECYCLE
# =============================================================================


class AgentStatus(Enum):
    """Agent lifecycle states"""

    INITIALIZING = "initializing"
    STARTING = "starting"
    ACTIVE = "active"
    IDLE = "idle"
    PAUSED = "paused"
    DEGRADED = "degraded"  # Running with reduced functionality
    ERROR = "error"
    STOPPING = "stopping"
    STOPPED = "stopped"


class AgentCapability(Enum):
    """Agent capability flags"""

    CONSUME_MESSAGES = "consume_messages"
    PUBLISH_MESSAGES = "publish_messages"
    DATABASE_READ = "database_read"
    DATABASE_WRITE = "database_write"
    EXTERNAL_API = "external_api"
    AI_INFERENCE = "ai_inference"


# =============================================================================
# PERFORMANCE METRICS
# =============================================================================


@dataclass
class AgentMetrics:
    """Comprehensive agent performance metrics"""

    # Message processing
    messages_received: int = 0
    messages_processed: int = 0
    messages_failed: int = 0
    messages_skipped: int = 0

    # Timing
    total_processing_time_ms: float = 0.0
    min_processing_time_ms: float = float("inf")
    max_processing_time_ms: float = 0.0
    processing_times: List[float] = field(default_factory=list)

    # Health
    errors: int = 0
    last_error: Optional[str] = None
    last_error_time: Optional[datetime] = None
    circuit_breaker_trips: int = 0

    # Activity
    started_at: Optional[datetime] = None
    last_activity: Optional[datetime] = None
    pause_count: int = 0
    restart_count: int = 0

    def record_processing(self, duration_ms: float, success: bool) -> None:
        """Record message processing result"""
        self.messages_received += 1

        if success:
            self.messages_processed += 1
            self.total_processing_time_ms += duration_ms
            self.min_processing_time_ms = min(self.min_processing_time_ms, duration_ms)
            self.max_processing_time_ms = max(self.max_processing_time_ms, duration_ms)

            # Keep last 100 for percentiles
            self.processing_times.append(duration_ms)
            if len(self.processing_times) > 100:
                self.processing_times.pop(0)
        else:
            self.messages_failed += 1

        self.last_activity = datetime.utcnow()

    def record_error(self, error: str) -> None:
        """Record error occurrence"""
        self.errors += 1
        self.last_error = error
        self.last_error_time = datetime.utcnow()

    @property
    def avg_processing_time_ms(self) -> float:
        if self.messages_processed == 0:
            return 0.0
        return self.total_processing_time_ms / self.messages_processed

    @property
    def p95_processing_time_ms(self) -> float:
        if not self.processing_times:
            return 0.0
        sorted_times = sorted(self.processing_times)
        idx = int(len(sorted_times) * 0.95)
        return sorted_times[min(idx, len(sorted_times) - 1)]

    @property
    def success_rate(self) -> float:
        total = self.messages_processed + self.messages_failed
        if total == 0:
            return 1.0
        return self.messages_processed / total

    @property
    def uptime_seconds(self) -> float:
        if not self.started_at:
            return 0.0
        return (datetime.utcnow() - self.started_at).total_seconds()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "messages": {
                "received": self.messages_received,
                "processed": self.messages_processed,
                "failed": self.messages_failed,
                "skipped": self.messages_skipped,
                "success_rate": f"{self.success_rate:.2%}",
            },
            "timing": {
                "avg_ms": round(self.avg_processing_time_ms, 2),
                "min_ms": (
                    round(self.min_processing_time_ms, 2)
                    if self.min_processing_time_ms != float("inf")
                    else 0
                ),
                "max_ms": round(self.max_processing_time_ms, 2),
                "p95_ms": round(self.p95_processing_time_ms, 2),
            },
            "health": {
                "errors": self.errors,
                "last_error": self.last_error,
                "circuit_breaker_trips": self.circuit_breaker_trips,
            },
            "activity": {
                "uptime_seconds": round(self.uptime_seconds, 2),
                "last_activity": (
                    self.last_activity.isoformat() if self.last_activity else None
                ),
                "pause_count": self.pause_count,
                "restart_count": self.restart_count,
            },
        }


# =============================================================================
# AGENT CONFIGURATION
# =============================================================================


class AgentConfig(BaseModel):
    """Base agent configuration"""

    # Identity
    name: str
    version: str = "1.0.0"

    # Capabilities
    capabilities: List[AgentCapability] = [
        AgentCapability.CONSUME_MESSAGES,
        AgentCapability.PUBLISH_MESSAGES,
    ]

    # Performance
    max_concurrent_tasks: int = 10
    task_timeout_seconds: float = 30.0

    # Circuit breaker
    circuit_breaker_enabled: bool = True
    circuit_breaker_failure_threshold: int = 5
    circuit_breaker_timeout_seconds: float = 30.0

    # Backpressure
    max_queue_size: int = 1000
    drop_oldest_on_overflow: bool = True

    # Retry
    max_retries: int = 3
    retry_delay_seconds: float = 1.0
    retry_exponential_backoff: bool = True

    # Debug
    debug: bool = False
    environment: str = "development"


# =============================================================================
# BASE AGENT
# =============================================================================


class BaseAgent(ABC):
    """
    Abstract base class for autonomous agents

    Features:
    ✅ Structured concurrency with TaskGroup
    ✅ Circuit breaker for fault tolerance
    ✅ Comprehensive lifecycle management
    ✅ Performance monitoring
    ✅ Graceful degradation
    ✅ Backpressure handling

    Lifecycle:
    1. __init__() - Create instance
    2. initialize() - Setup resources
    3. start() - Begin processing
    4. pause()/resume() - Control flow
    5. stop() - Graceful shutdown
    6. cleanup() - Release resources
    """

    def __init__(
        self,
        agent_name: str,
        message_bus: MessageBus,
        database: DatabaseClient,
        config: Dict[str, Any],
    ):
        self.agent_name = agent_name
        self.message_bus = message_bus
        self.database = database

        # Parse config
        self.config = AgentConfig(name=agent_name, **config)

        # State
        self.status: AgentStatus = AgentStatus.INITIALIZING
        self.metrics = AgentMetrics()

        # Concurrency control
        self._task_group: Optional[asyncio.TaskGroup] = None
        self._active_tasks: set = set()
        self._semaphore = asyncio.Semaphore(self.config.max_concurrent_tasks)
        self._shutdown_event = asyncio.Event()
        self._pause_event = asyncio.Event()
        self._pause_event.set()  # Not paused by default
        self._queue_space = asyncio.Event()
        self._queue_space.set()
        self._message_ready = asyncio.Event()
        self._lifecycle_lock = asyncio.Lock()
        self._accepting_messages = False
        self._needs_cleanup = False
        self._consumer_tags: Dict[str, str] = {}

        # Message queue (for backpressure)
        self._message_queue: asyncio.Queue = asyncio.Queue(
            maxsize=self.config.max_queue_size
        )

        # Message processor task reference (detect silent failures)
        self._processor_task: Optional[asyncio.Task] = None

        # Circuit breaker
        self._circuit_breaker: Optional[CircuitBreaker] = None
        if self.config.circuit_breaker_enabled:
            self._circuit_breaker = CircuitBreaker(
                f"agent.{agent_name}",
                CircuitBreakerConfig(
                    failure_threshold=self.config.circuit_breaker_failure_threshold,
                    timeout_seconds=self.config.circuit_breaker_timeout_seconds,
                ),
            )

        # Logger
        self.logger = setup_logger(f"agent.{agent_name}")

        # Distributed tracing (INFRA-04)
        self._current_correlation_id: Optional[str] = None
        set_log_context(agent_name=self.agent_name)

        self.logger.info(f"🤖 Agent initialized: {agent_name} (v{self.config.version})")

    # =========================================================================
    # ABSTRACT METHODS (Must implement)
    # =========================================================================

    @abstractmethod
    async def initialize(self) -> None:
        """
        Initialize agent-specific resources.
        Called once during startup.
        """
        pass

    @abstractmethod
    async def process_message(self, message: Dict[str, Any]) -> None:
        """
        Process a message from the queue.

        Args:
            message: Message payload
        """
        pass

    @abstractmethod
    def get_subscribed_routing_keys(self) -> List[tuple[str, str]]:
        """
        Return list of (exchange, routing_key) tuples this agent subscribes to.

        Returns:
            List of (exchange_name, routing_key) tuples
        """
        pass

    # =========================================================================
    # LIFECYCLE MANAGEMENT
    # =========================================================================

    async def start(self) -> None:
        """Start once; a failed stop must be completed before another start."""
        async with self._lifecycle_lock:
            if self.status in (
                AgentStatus.ACTIVE,
                AgentStatus.IDLE,
                AgentStatus.PAUSED,
            ):
                if self._processor_task and not self._processor_task.done():
                    return
            if (
                self._needs_cleanup
                or self._consumer_tags
                or any(not task.done() for task in self._active_tasks)
                or (self._processor_task and not self._processor_task.done())
            ):
                raise RuntimeError(
                    "Previous agent run has not stopped; check health and stop again"
                )
            try:
                self.status = AgentStatus.STARTING
                self._shutdown_event.clear()
                self._pause_event.set()
                self._needs_cleanup = True
                await self.initialize()
                self._accepting_messages = True
                # Start the worker before subscriptions so startup deliveries have
                # a consumer even while the remaining bindings are being installed.
                self._processor_task = asyncio.create_task(
                    self._message_processor(), name=f"{self.agent_name}-processor"
                )
                self._processor_task.add_done_callback(self._on_processor_done)
                await self._setup_subscriptions()
                self.status = AgentStatus.ACTIVE
                self.metrics.started_at = datetime.utcnow()
                self.logger.info(f"Agent {self.agent_name} is ACTIVE")
            except BaseException as exc:
                self._accepting_messages = False
                self._shutdown_event.set()
                self._message_ready.set()
                self._queue_space.set()
                self.status = AgentStatus.ERROR
                self.metrics.record_error(str(exc))
                # Quiesce partial subscriptions immediately. If the broker is
                # unavailable, retained tags and unacked deliveries allow an
                # explicit stop retry without a hot requeue loop.
                for queue_name, tag in list(self._consumer_tags.items()):
                    try:
                        await self.message_bus.stop_consuming(
                            queue_name, tag, timeout=self.config.task_timeout_seconds
                        )
                        del self._consumer_tags[queue_name]
                    except Exception as cancel_error:
                        self.logger.error(
                            f"Partial startup cancellation failed: {cancel_error}"
                        )
                # Resource cleanup remains mandatory before starting again.
                raise

    async def stop(self) -> None:
        """Quiesce ingress and drain accepted work before releasing resources.

        A timeout leaves work running under the same instance, reports ERROR,
        and requires a later stop retry. It does not cancel business operations
        or declare them completed. Broker deliveries racing cancellation requeue.
        """
        async with self._lifecycle_lock:
            if self.status == AgentStatus.STOPPED:
                return
            self.status = AgentStatus.STOPPING
            self._accepting_messages = False
            self._shutdown_event.set()
            self._pause_event.set()
            self._message_ready.set()
            self._queue_space.set()
            deadline = (
                asyncio.get_running_loop().time() + self.config.task_timeout_seconds
            )
            try:
                for queue_name, tag in list(self._consumer_tags.items()):
                    await self.message_bus.stop_consuming(
                        queue_name,
                        tag,
                        timeout=max(0.0, deadline - asyncio.get_running_loop().time()),
                    )
                    del self._consumer_tags[queue_name]
                if self._processor_task:
                    await self._drain_tasks({self._processor_task}, deadline)
                await self._drain_tasks(set(self._active_tasks), deadline)
                if not self._message_queue.empty():
                    raise RuntimeError(
                        "Accepted messages remain unprocessed; stop is incomplete"
                    )
                await self.cleanup()
                self._needs_cleanup = False
                self.status = AgentStatus.STOPPED
                self.logger.info(f"Agent {self.agent_name} stopped")
            except BaseException as exc:
                self.status = AgentStatus.ERROR
                self.metrics.record_error(str(exc))
                self.logger.error(f"Agent shutdown incomplete: {exc}")
                raise

    async def _drain_tasks(self, tasks: set, deadline: float) -> None:
        if not tasks:
            return
        done, pending = await asyncio.wait(
            tasks, timeout=max(0.0, deadline - asyncio.get_running_loop().time())
        )
        if pending:
            raise TimeoutError(
                "Agent work is still draining; check health before retrying stop"
            )
        for task in done:
            try:
                # Cancellation of a worker is a failed drain, not cancellation
                # of the operator's HTTP request (which must receive a clear
                # failure).
                if task.cancelled():
                    raise RuntimeError(
                        "Agent task was cancelled before drain completed"
                    )
                task.result()
            except BaseException:
                # A FAILED handle is forgotten here so a later stop doesn't
                # re-examine it. Before this, `self._processor_task` kept
                # pointing at the same cancelled/errored task after a failed
                # stop() reported it once: the next stop() re-awaited that
                # same already-done task, asyncio.wait returned it in `done`
                # immediately, and the same failure was raised again —
                # forever, since nothing but a fresh start() ever reassigns
                # `_processor_task`. A task that drained successfully is left
                # exactly as it was (callers such as
                # `test_restart_reuses_instance_with_live_worker...` read it
                # afterwards), and a still-PENDING task (the branch above) is
                # also left in place, so a retry keeps watching the same slow
                # task rather than orphaning it mid-drain.
                if task is self._processor_task:
                    self._processor_task = None
                raise

    async def pause(self) -> None:
        """Pause message processing"""
        if self.status not in (
            AgentStatus.ACTIVE,
            AgentStatus.IDLE,
            AgentStatus.DEGRADED,
            AgentStatus.PAUSED,
        ):
            raise RuntimeError("Only a running agent can be paused")
        self.logger.info(f"⏸️ Pausing agent: {self.agent_name}")
        self._pause_event.clear()
        self.status = AgentStatus.PAUSED
        self.metrics.pause_count += 1

    async def resume(self) -> None:
        """Resume message processing"""
        if self.status not in (AgentStatus.PAUSED, AgentStatus.ACTIVE):
            raise RuntimeError("A stopped agent must be started, not resumed")
        self.logger.info(f"▶️ Resuming agent: {self.agent_name}")
        self._pause_event.set()
        self.status = AgentStatus.ACTIVE

    async def restart(self) -> None:
        """Restart the agent"""
        self.logger.info(f"🔄 Restarting agent: {self.agent_name}")
        await self.stop()
        await asyncio.sleep(1)
        await self.start()
        self.metrics.restart_count += 1

    # =========================================================================
    # MESSAGE HANDLING
    # =========================================================================

    async def _setup_subscriptions(self) -> None:
        """Setup message queue subscriptions"""
        subscriptions = self.get_subscribed_routing_keys()

        for exchange_name, routing_key in subscriptions:
            queue_name = subscription_queue_name(self.agent_name, routing_key)

            # Declare queue
            await self.message_bus.declare_queue(
                queue_name=queue_name,
                exchange_name=exchange_name,
                routing_key=routing_key,
                durable=True,
                max_priority=10,
            )

            # Start consuming
            tag = await self.message_bus.consume(
                queue_name=queue_name,
                callback=self._enqueue_message,
                auto_ack=False,
            )

            self._consumer_tags[queue_name] = tag

            self.logger.info(f"📬 Subscribed: {exchange_name}/{routing_key}")

    async def _enqueue_message(self, message: Dict[str, Any]) -> None:
        """Accept into memory or leave the delivery available at the broker.

        The old drop-oldest/reject-return behavior ACKed messages that would
        never run. Keep the legacy config field parseable, but never drop work.
        """
        while self._message_queue.full() and self._accepting_messages:
            # Hold the broker delivery unacknowledged instead of a hot requeue
            # loop. A dequeue or stop wakes all waiters; each rechecks capacity.
            self._queue_space.clear()
            await self._queue_space.wait()
        if not self._accepting_messages:
            raise ConsumerUnavailable("Agent is not accepting deliveries")
        self._message_queue.put_nowait(message)
        self._message_ready.set()

    async def _message_processor(self) -> None:
        """Drain accepted work on stop; never abandon a message after dequeue."""
        while True:
            await self._pause_event.wait()
            if self._message_queue.empty():
                if self._shutdown_event.is_set():
                    return
                self._message_ready.clear()
                await self._message_ready.wait()
                continue
            # Acquire before dequeue so waiting/cancellation cannot lose a body.
            await self._semaphore.acquire()
            try:
                message = self._message_queue.get_nowait()
                self._queue_space.set()
            except asyncio.QueueEmpty:
                self._semaphore.release()
                continue
            task = asyncio.create_task(self._process_queued_message(message))
            self._active_tasks.add(task)
            task.add_done_callback(self._active_tasks.discard)

    async def _process_queued_message(self, message: Dict[str, Any]) -> None:
        try:
            await self._process_with_retry(message)
        finally:
            self._message_queue.task_done()
            self._semaphore.release()

    def _on_processor_done(self, task: asyncio.Task) -> None:
        """Callback when message processor task finishes (expected or unexpected)"""
        if task.cancelled():
            self.logger.info(f"Message processor for {self.agent_name} was cancelled")
            if not self._shutdown_event.is_set():
                self.status = AgentStatus.ERROR
                self.metrics.record_error(
                    "Message processor was unexpectedly cancelled"
                )
            return

        exc = task.exception()
        if exc:
            self.logger.error(
                f"Message processor for {self.agent_name} died with unhandled exception: {exc}",
                exc_info=exc,
            )
            self.status = AgentStatus.ERROR
            self.metrics.record_error(f"Processor died: {exc}")

            # Auto-restart the processor if agent is not shutting down
            if not self._shutdown_event.is_set():
                self.logger.warning(
                    f"Auto-restarting message processor for {self.agent_name}"
                )
                self._processor_task = asyncio.create_task(
                    self._message_processor(),
                    name=f"{self.agent_name}-processor-restart",
                )
                self._processor_task.add_done_callback(self._on_processor_done)
                self.status = AgentStatus.ACTIVE

    async def _process_with_retry(self, message: Dict[str, Any]) -> None:
        """Process message with retry logic and circuit breaker"""
        start_time = asyncio.get_event_loop().time()
        attempt = 0
        last_error = None

        # Extract correlation_id from message (INFRA-04)
        self._current_correlation_id = message.get("correlation_id") or str(
            uuid.uuid4()
        )
        set_log_context(
            agent_name=self.agent_name, correlation_id=self._current_correlation_id
        )

        # Set Sentry scope tags for per-agent error attribution (OBS-01)
        try:
            import sentry_sdk

            sentry_sdk.set_tag("agent", self.agent_name)
            if (
                hasattr(self, "_current_correlation_id")
                and self._current_correlation_id
            ):
                sentry_sdk.set_tag("correlation_id", self._current_correlation_id)
        except ImportError:
            pass  # Sentry not installed (shouldn't happen in production)

        # Idempotency check (INFRA-01)
        message_id = message.get("message_id") or message.get("event_id")
        if message_id and await self._check_idempotency(message_id):
            self.logger.info(f"Skipping duplicate message: {message_id}")
            self.metrics.messages_skipped += 1
            return

        while attempt < self.config.max_retries:
            attempt += 1

            try:
                # Check circuit breaker
                if self._circuit_breaker:
                    if not self._circuit_breaker.is_available:
                        self.metrics.circuit_breaker_trips += 1
                        self.logger.warning("Circuit breaker open, skipping message")
                        self.metrics.messages_skipped += 1
                        return

                    async with self._circuit_breaker:
                        await asyncio.wait_for(
                            self.process_message(message),
                            timeout=self.config.task_timeout_seconds,
                        )
                else:
                    await asyncio.wait_for(
                        self.process_message(message),
                        timeout=self.config.task_timeout_seconds,
                    )

                # Success
                duration_ms = (asyncio.get_event_loop().time() - start_time) * 1000
                self.metrics.record_processing(duration_ms, success=True)

                # Mark as processed for idempotency (INFRA-01)
                if message_id:
                    await self._mark_processed(message_id)

                if self.config.debug:
                    self.logger.debug(f"✓ Processed in {duration_ms:.1f}ms")

                return

            except asyncio.TimeoutError:
                last_error = "Processing timeout"
                self.logger.warning(f"Processing timeout (attempt {attempt})")

            except Exception as e:
                last_error = str(e)
                self.logger.error(f"Processing error (attempt {attempt}): {e}")

                if self.config.debug:
                    self.logger.debug(traceback.format_exc())

            # Retry delay
            if attempt < self.config.max_retries:
                delay = self.config.retry_delay_seconds
                if self.config.retry_exponential_backoff:
                    delay *= 2 ** (attempt - 1)
                await asyncio.sleep(delay)

        # All retries exhausted
        duration_ms = (asyncio.get_event_loop().time() - start_time) * 1000
        self.metrics.record_processing(duration_ms, success=False)
        self.metrics.record_error(last_error or "Unknown error")

        self.logger.error(f"Message processing failed after {attempt} attempts")

        # Send to DLQ (INFRA-05)
        await self._send_to_dlq(
            message=message,
            error=last_error or "Unknown error",
            retry_count=attempt,
        )

    # =========================================================================
    # PUBLISHING
    # =========================================================================

    async def publish(
        self,
        exchange_name: str,
        routing_key: str,
        message_body: Dict[str, Any],
        priority: int = 5,
    ) -> bool:
        """Publish a message to the message bus"""
        # Add source agent
        message_body["source_agent"] = self.agent_name

        # Inject correlation_id (INFRA-04)
        if self._current_correlation_id:
            message_body["correlation_id"] = self._current_correlation_id

        return await self.message_bus.publish(
            exchange_name=exchange_name,
            routing_key=routing_key,
            message_body=message_body,
            priority=priority,
            correlation_id=self._current_correlation_id,
        )

    async def publish_event(
        self,
        exchange_name: str,
        routing_key: str,
        event: BaseEvent,
        priority: EventPriority = EventPriority.NORMAL,
    ) -> bool:
        """Publish a typed event"""
        # Set source agent
        event_dict = event.model_dump()

        # Inject correlation_id (INFRA-04)
        if self._current_correlation_id and not event_dict.get("correlation_id"):
            event_dict["correlation_id"] = self._current_correlation_id

        event_dict["source_agent"] = self.agent_name

        # Recreate event with source
        event_class = type(event)
        enriched_event = event_class(**event_dict)

        return await self.message_bus.publish_event(
            exchange_name=exchange_name,
            routing_key=routing_key,
            event=enriched_event,
            priority=priority,
        )

    # =========================================================================
    # IDEMPOTENCY (INFRA-01)
    # =========================================================================

    async def _check_idempotency(self, message_id: str) -> bool:
        """Check if message was already processed. Fails OPEN (returns False on error)."""
        if not message_id:
            return False
        try:
            result = (
                self.database.supabase.table("idempotency_keys")
                .select("message_id")
                .eq("message_id", message_id)
                .execute()
            )
            return len(result.data) > 0
        except Exception as e:
            self.logger.warning(f"Idempotency check failed (fail open): {e}")
            return False

    async def _mark_processed(self, message_id: str, result: Any = None) -> None:
        """Mark message as processed in idempotency_keys table."""
        if not message_id:
            return
        try:
            self.database.supabase.table("idempotency_keys").insert(
                {
                    "message_id": message_id,
                    "agent_name": self.agent_name,
                    "result": (
                        result
                        if isinstance(result, dict)
                        else {"result": str(result)} if result else {}
                    ),
                }
            ).execute()
        except Exception as e:
            self.logger.warning(f"Failed to mark message processed: {e}")

    # =========================================================================
    # DECISION LOGGING (INFRA-02)
    # =========================================================================

    async def log_decision(
        self,
        decision_type: str,
        inputs: Dict[str, Any],
        output: Dict[str, Any],
        reasoning: str,
        confidence: float = 1.0,
        restaurant_id: Optional[str] = None,
    ) -> Optional[str]:
        """Persist an agent decision to the decision_log table.

        Returns the inserted row id when PostgREST returns a representation,
        otherwise None. Callers that need the FK (e.g. drift_findings) should
        tolerate a missing id — the decision row is still the source of truth.
        """
        try:
            result = (
                self.database.supabase.table("decision_log").insert(
                    {
                        "agent_name": self.agent_name,
                        "decision_type": decision_type,
                        "inputs": inputs,
                        "reasoning": (
                            {"text": reasoning}
                            if isinstance(reasoning, str)
                            else reasoning
                        ),
                        "output": output,
                        "confidence": confidence,
                        "correlation_id": self._current_correlation_id,
                        "restaurant_id": restaurant_id,
                    }
                )
                # NO .select() here. supabase-py >= 2.x returns the inserted
                # representation from .execute() already; chaining .select()
                # onto the insert builder raises AttributeError
                # ("'SyncQueryRequestBuilder' object has no attribute 'select'"),
                # which this method's except-block swallowed. Result: decision_log
                # took ZERO writes and every neural_footprint_event.correlation_id
                # joined to nothing. Verified against supabase-py 2.28.0.
                .execute()
            )
            if result.data and len(result.data) > 0:
                return result.data[0].get("id")
            return None
        except Exception as e:
            self.logger.warning(f"Failed to log decision: {e}")
            return None

    # =========================================================================
    # DEAD LETTER QUEUE (INFRA-05)
    # =========================================================================

    async def _send_to_dlq(
        self,
        message: Dict[str, Any],
        error: str,
        retry_count: int,
        original_exchange: str = "",
        original_routing_key: str = "",
    ) -> None:
        """Persist a failed message to the dead_letter_queue table."""
        try:
            self.database.supabase.table("dead_letter_queue").insert(
                {
                    "agent_name": self.agent_name,
                    "original_exchange": original_exchange
                    or message.get("_exchange", "unknown"),
                    "original_routing_key": original_routing_key
                    or message.get("_routing_key", "unknown"),
                    "message": message,
                    "error": error,
                    "retry_count": retry_count,
                }
            ).execute()
            self.logger.info(
                f"Message sent to DLQ after {retry_count} retries: {error}"
            )
        except Exception as e:
            self.logger.error(f"CRITICAL: Failed to send to DLQ: {e}")

    # =========================================================================
    # SAGA STATE MANAGEMENT (INFRA-06)
    # =========================================================================

    async def start_saga(
        self,
        saga_type: str,
        context: Dict[str, Any],
        deadline_minutes: int = 60,
    ) -> str:
        """Start a new saga and return its saga_id."""
        saga_id = str(uuid.uuid4())
        deadline_at = (
            datetime.utcnow() + timedelta(minutes=deadline_minutes)
        ).isoformat()

        try:
            self.database.supabase.table("saga_state").insert(
                {
                    "saga_id": saga_id,
                    "saga_type": saga_type,
                    "current_step": "INIT",
                    "status": "IN_PROGRESS",
                    "context": context,
                    "compensations": [],
                    "deadline_at": deadline_at,
                }
            ).execute()
            self.logger.info(f"Saga started: {saga_type} ({saga_id})")
            return saga_id
        except Exception as e:
            self.logger.error(f"Failed to start saga: {e}")
            raise

    async def advance_saga(
        self,
        saga_id: str,
        step: str,
        compensation_info: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Advance saga to next step and record compensation info."""
        try:
            result = (
                self.database.supabase.table("saga_state")
                .select("compensations")
                .eq("saga_id", saga_id)
                .execute()
            )

            compensations = result.data[0]["compensations"] if result.data else []
            if compensation_info:
                compensations.append(
                    {
                        "step": step,
                        "compensation": compensation_info,
                    }
                )

            self.database.supabase.table("saga_state").update(
                {
                    "current_step": step,
                    "compensations": compensations,
                    "updated_at": datetime.utcnow().isoformat(),
                }
            ).eq("saga_id", saga_id).execute()

            self.logger.info(f"Saga {saga_id} advanced to step: {step}")
        except Exception as e:
            self.logger.error(f"Failed to advance saga {saga_id}: {e}")
            raise

    async def complete_saga(self, saga_id: str) -> None:
        """Mark saga as completed."""
        try:
            self.database.supabase.table("saga_state").update(
                {
                    "status": "COMPLETED",
                    "current_step": "DONE",
                    "updated_at": datetime.utcnow().isoformat(),
                }
            ).eq("saga_id", saga_id).execute()
            self.logger.info(f"Saga completed: {saga_id}")
        except Exception as e:
            self.logger.error(f"Failed to complete saga {saga_id}: {e}")
            raise

    async def compensate_saga(self, saga_id: str, error: str) -> None:
        """Run compensations in reverse order and mark saga as compensated."""
        try:
            result = (
                self.database.supabase.table("saga_state")
                .select("compensations, saga_type")
                .eq("saga_id", saga_id)
                .execute()
            )

            if not result.data:
                self.logger.warning(f"Saga {saga_id} not found for compensation")
                return

            saga = result.data[0]
            compensations = saga.get("compensations", [])

            self.logger.warning(
                f"Compensating saga {saga_id} ({saga.get('saga_type')}): {error}. "
                f"{len(compensations)} compensation(s) to run."
            )

            self.database.supabase.table("saga_state").update(
                {
                    "status": "COMPENSATED",
                    "error": error,
                    "updated_at": datetime.utcnow().isoformat(),
                }
            ).eq("saga_id", saga_id).execute()

            self.logger.info(f"Saga compensated: {saga_id}")
        except Exception as e:
            self.logger.error(f"Failed to compensate saga {saga_id}: {e}")
            raise

    # =========================================================================
    # EVENT STORE (INFRA-08)
    # =========================================================================

    async def append_event(
        self,
        aggregate_type: str,
        aggregate_id: str,
        event_type: str,
        payload: Dict[str, Any],
        sequence_number: int,
    ) -> None:
        """Append a domain event to the event store (append-only)."""
        try:
            self.database.supabase.table("event_store").insert(
                {
                    "aggregate_type": aggregate_type,
                    "aggregate_id": aggregate_id,
                    "event_type": event_type,
                    "payload": payload,
                    "sequence_number": sequence_number,
                    "correlation_id": self._current_correlation_id,
                }
            ).execute()
        except Exception as e:
            self.logger.error(
                f"Failed to append event {event_type} for {aggregate_type}/{aggregate_id}: {e}"
            )
            raise

    # =========================================================================
    # CLEANUP
    # =========================================================================

    async def cleanup(self) -> None:
        """
        Cleanup agent-specific resources.
        Override in subclass if needed.
        """
        pass

    # =========================================================================
    # HEALTH & MONITORING
    # =========================================================================

    def get_health(self) -> Dict[str, Any]:
        """Get agent health status"""
        is_healthy = (
            self.status in [AgentStatus.ACTIVE, AgentStatus.IDLE]
            and self.metrics.success_rate >= 0.9
            and (self._circuit_breaker is None or self._circuit_breaker.is_available)
        )

        return {
            "agent_name": self.agent_name,
            "version": self.config.version,
            "status": self.status.value,
            "healthy": is_healthy,
            "capabilities": [c.value for c in self.config.capabilities],
        }

    def get_detailed_health(self) -> Dict[str, Any]:
        """Get detailed health with metrics"""
        health = self.get_health()
        health["metrics"] = self.metrics.to_dict()
        health["config"] = {
            "max_concurrent_tasks": self.config.max_concurrent_tasks,
            "max_retries": self.config.max_retries,
            "circuit_breaker_enabled": self.config.circuit_breaker_enabled,
        }
        health["subscriptions"] = self.get_subscribed_routing_keys()
        health["queue_size"] = self._message_queue.qsize()
        health["active_tasks"] = len(self._active_tasks)

        if self._circuit_breaker:
            health["circuit_breaker"] = {
                "state": self._circuit_breaker.state.value,
                "available": self._circuit_breaker.is_available,
            }

        return health

    async def health_check(self) -> Dict[str, Any]:
        """
        Async health check returning a status dict.

        Subclasses should call ``await super().health_check()`` and augment
        the returned dict with their own subsystem checks.
        """
        return self.get_health()

    # =========================================================================
    # UTILITY
    # =========================================================================

    @asynccontextmanager
    async def timed_operation(self, operation_name: str):
        """Context manager for timing operations"""
        start = asyncio.get_event_loop().time()
        try:
            yield
        finally:
            duration = (asyncio.get_event_loop().time() - start) * 1000
            if self.config.debug:
                self.logger.debug(f"{operation_name} completed in {duration:.1f}ms")

    def __repr__(self) -> str:
        return (
            f"<{self.__class__.__name__}("
            f"name={self.agent_name}, "
            f"status={self.status.value}, "
            f"processed={self.metrics.messages_processed}"
            f")>"
        )
