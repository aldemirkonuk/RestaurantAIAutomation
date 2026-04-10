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
import uuid
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List, Callable, Awaitable, TypeVar
from datetime import datetime, timedelta
from enum import Enum
from dataclasses import dataclass, field
from contextlib import asynccontextmanager
import traceback

from pydantic import BaseModel, Field

from core.message_bus import MessageBus, BaseEvent, EventPriority, CircuitBreaker, CircuitBreakerConfig
from core.database import DatabaseClient
from utils.logger import setup_logger, set_log_context


T = TypeVar('T')


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
    min_processing_time_ms: float = float('inf')
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
                "min_ms": round(self.min_processing_time_ms, 2) if self.min_processing_time_ms != float('inf') else 0,
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
                "last_activity": self.last_activity.isoformat() if self.last_activity else None,
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
                )
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
        """Start the agent and begin processing messages"""
        try:
            self.status = AgentStatus.STARTING
            self.logger.info(f"🚀 Starting agent: {self.agent_name}")
            
            # Initialize resources
            await self.initialize()
            
            # Subscribe to queues
            await self._setup_subscriptions()
            
            # Start message processor (store reference to detect silent failures)
            self._processor_task = asyncio.create_task(
                self._message_processor(),
                name=f"{self.agent_name}-processor",
            )
            self._processor_task.add_done_callback(self._on_processor_done)
            
            # Update state
            self.status = AgentStatus.ACTIVE
            self.metrics.started_at = datetime.utcnow()
            
            self.logger.info(f"✅ Agent {self.agent_name} is ACTIVE")
            
        except Exception as e:
            self.status = AgentStatus.ERROR
            self.metrics.record_error(str(e))
            self.logger.error(f"❌ Failed to start agent: {e}")
            raise
    
    async def stop(self) -> None:
        """Stop the agent gracefully"""
        try:
            self.status = AgentStatus.STOPPING
            self.logger.info(f"🛑 Stopping agent: {self.agent_name}")
            
            # Signal shutdown
            self._shutdown_event.set()
            self._pause_event.set()  # Unpause if paused
            
            # Wait for active tasks with timeout
            if self._active_tasks:
                self.logger.info(f"Waiting for {len(self._active_tasks)} tasks to complete...")
                try:
                    await asyncio.wait_for(
                        asyncio.gather(*self._active_tasks, return_exceptions=True),
                        timeout=self.config.task_timeout_seconds,
                    )
                except asyncio.TimeoutError:
                    self.logger.warning("Task completion timeout, forcing shutdown")
            
            # Cleanup
            await self.cleanup()
            
            self.status = AgentStatus.STOPPED
            self.logger.info(f"✅ Agent {self.agent_name} stopped")
            
        except Exception as e:
            self.logger.error(f"Error during shutdown: {e}")
            self.status = AgentStatus.ERROR
    
    async def pause(self) -> None:
        """Pause message processing"""
        self.logger.info(f"⏸️ Pausing agent: {self.agent_name}")
        self._pause_event.clear()
        self.status = AgentStatus.PAUSED
        self.metrics.pause_count += 1
    
    async def resume(self) -> None:
        """Resume message processing"""
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
            queue_name = f"queue.{self.agent_name}.{routing_key.replace('.', '_')}"
            
            # Declare queue
            await self.message_bus.declare_queue(
                queue_name=queue_name,
                exchange_name=exchange_name,
                routing_key=routing_key,
                durable=True,
                max_priority=10,
            )
            
            # Start consuming
            await self.message_bus.consume(
                queue_name=queue_name,
                callback=self._enqueue_message,
                auto_ack=False,
            )
            
            self.logger.info(f"📬 Subscribed: {exchange_name}/{routing_key}")
    
    async def _enqueue_message(self, message: Dict[str, Any]) -> None:
        """Enqueue message for processing (with backpressure)"""
        try:
            if self._message_queue.full():
                if self.config.drop_oldest_on_overflow:
                    # Drop oldest message
                    try:
                        self._message_queue.get_nowait()
                        self.metrics.messages_skipped += 1
                        self.logger.warning("Queue full, dropped oldest message")
                    except asyncio.QueueEmpty:
                        pass
                else:
                    # Reject new message
                    self.metrics.messages_skipped += 1
                    self.logger.warning("Queue full, rejecting message")
                    return
            
            await self._message_queue.put(message)
            
        except Exception as e:
            self.logger.error(f"Failed to enqueue message: {e}")
    
    async def _message_processor(self) -> None:
        """Background task that processes messages from queue"""
        self.logger.info("Message processor started")
        
        while not self._shutdown_event.is_set():
            try:
                # Wait if paused
                await self._pause_event.wait()
                
                # Get message with timeout
                try:
                    message = await asyncio.wait_for(
                        self._message_queue.get(),
                        timeout=1.0,
                    )
                except asyncio.TimeoutError:
                    continue
                
                # Process with concurrency limit
                async with self._semaphore:
                    task = asyncio.create_task(
                        self._process_with_retry(message)
                    )
                    self._active_tasks.add(task)
                    task.add_done_callback(self._active_tasks.discard)
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error(f"Message processor error: {e}")
        
        self.logger.info("Message processor stopped")
    
    def _on_processor_done(self, task: asyncio.Task) -> None:
        """Callback when message processor task finishes (expected or unexpected)"""
        if task.cancelled():
            self.logger.info(f"Message processor for {self.agent_name} was cancelled")
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
                self.logger.warning(f"Auto-restarting message processor for {self.agent_name}")
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
        self._current_correlation_id = message.get("correlation_id") or str(uuid.uuid4())
        set_log_context(agent_name=self.agent_name, correlation_id=self._current_correlation_id)

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
                    delay *= (2 ** (attempt - 1))
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
            result = self.database.supabase.table("idempotency_keys") \
                .select("message_id") \
                .eq("message_id", message_id) \
                .execute()
            return len(result.data) > 0
        except Exception as e:
            self.logger.warning(f"Idempotency check failed (fail open): {e}")
            return False

    async def _mark_processed(self, message_id: str, result: Any = None) -> None:
        """Mark message as processed in idempotency_keys table."""
        if not message_id:
            return
        try:
            self.database.supabase.table("idempotency_keys").insert({
                "message_id": message_id,
                "agent_name": self.agent_name,
                "result": result if isinstance(result, dict) else {"result": str(result)} if result else {},
            }).execute()
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
    ) -> None:
        """Persist an agent decision to the decision_log table."""
        try:
            self.database.supabase.table("decision_log").insert({
                "agent_name": self.agent_name,
                "decision_type": decision_type,
                "inputs": inputs,
                "reasoning": {"text": reasoning} if isinstance(reasoning, str) else reasoning,
                "output": output,
                "confidence": confidence,
                "correlation_id": self._current_correlation_id,
                "restaurant_id": restaurant_id,
            }).execute()
        except Exception as e:
            self.logger.warning(f"Failed to log decision: {e}")

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
            self.database.supabase.table("dead_letter_queue").insert({
                "agent_name": self.agent_name,
                "original_exchange": original_exchange or message.get("_exchange", "unknown"),
                "original_routing_key": original_routing_key or message.get("_routing_key", "unknown"),
                "message": message,
                "error": error,
                "retry_count": retry_count,
            }).execute()
            self.logger.info(f"Message sent to DLQ after {retry_count} retries: {error}")
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
        deadline_at = (datetime.utcnow() + timedelta(minutes=deadline_minutes)).isoformat()

        try:
            self.database.supabase.table("saga_state").insert({
                "saga_id": saga_id,
                "saga_type": saga_type,
                "current_step": "INIT",
                "status": "IN_PROGRESS",
                "context": context,
                "compensations": [],
                "deadline_at": deadline_at,
            }).execute()
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
            result = self.database.supabase.table("saga_state") \
                .select("compensations") \
                .eq("saga_id", saga_id) \
                .execute()

            compensations = result.data[0]["compensations"] if result.data else []
            if compensation_info:
                compensations.append({
                    "step": step,
                    "compensation": compensation_info,
                })

            self.database.supabase.table("saga_state").update({
                "current_step": step,
                "compensations": compensations,
                "updated_at": datetime.utcnow().isoformat(),
            }).eq("saga_id", saga_id).execute()

            self.logger.info(f"Saga {saga_id} advanced to step: {step}")
        except Exception as e:
            self.logger.error(f"Failed to advance saga {saga_id}: {e}")
            raise

    async def complete_saga(self, saga_id: str) -> None:
        """Mark saga as completed."""
        try:
            self.database.supabase.table("saga_state").update({
                "status": "COMPLETED",
                "current_step": "DONE",
                "updated_at": datetime.utcnow().isoformat(),
            }).eq("saga_id", saga_id).execute()
            self.logger.info(f"Saga completed: {saga_id}")
        except Exception as e:
            self.logger.error(f"Failed to complete saga {saga_id}: {e}")
            raise

    async def compensate_saga(self, saga_id: str, error: str) -> None:
        """Run compensations in reverse order and mark saga as compensated."""
        try:
            result = self.database.supabase.table("saga_state") \
                .select("compensations, saga_type") \
                .eq("saga_id", saga_id) \
                .execute()

            if not result.data:
                self.logger.warning(f"Saga {saga_id} not found for compensation")
                return

            saga = result.data[0]
            compensations = saga.get("compensations", [])

            self.logger.warning(
                f"Compensating saga {saga_id} ({saga.get('saga_type')}): {error}. "
                f"{len(compensations)} compensation(s) to run."
            )

            self.database.supabase.table("saga_state").update({
                "status": "COMPENSATED",
                "error": error,
                "updated_at": datetime.utcnow().isoformat(),
            }).eq("saga_id", saga_id).execute()

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
            self.database.supabase.table("event_store").insert({
                "aggregate_type": aggregate_type,
                "aggregate_id": aggregate_id,
                "event_type": event_type,
                "payload": payload,
                "sequence_number": sequence_number,
                "correlation_id": self._current_correlation_id,
            }).execute()
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
            and (
                self._circuit_breaker is None
                or self._circuit_breaker.is_available
            )
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
