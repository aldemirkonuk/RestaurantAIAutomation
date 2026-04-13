"""
Observability Module
====================
Provides Prometheus metrics and OpenTelemetry tracing for the agent orchestrator.

Metrics:
- agent_messages_processed_total (Counter)
- agent_processing_duration_seconds (Histogram)
- agent_queue_depth (Gauge)
- agent_circuit_breaker_state (Gauge)
- agent_status (Gauge)
- connection_pool_size (Gauge)
- http_requests_total (Counter)
- http_request_duration_seconds (Histogram)

Tracing:
- Distributed traces across agent message processing chains
- Span per message processing
- OTLP or console exporter
"""

from __future__ import annotations

import time
import logging
from typing import Any, Dict, Optional
from contextlib import contextmanager
from functools import wraps

logger = logging.getLogger(__name__)

# ============================================================================
# PROMETHEUS METRICS
# ============================================================================

# Try to import prometheus_client; use noop metrics if not available
try:
    from prometheus_client import (
        Counter,
        Histogram,
        Gauge,
        Info,
        generate_latest,
        CONTENT_TYPE_LATEST,
        CollectorRegistry,
    )

    PROMETHEUS_AVAILABLE = True
except ImportError:
    PROMETHEUS_AVAILABLE = False
    logger.info("prometheus_client not installed; metrics will be no-ops")


class NoopMetric:
    """No-op metric placeholder when prometheus_client is not installed."""
    def inc(self, *args, **kwargs): pass
    def dec(self, *args, **kwargs): pass
    def set(self, *args, **kwargs): pass
    def observe(self, *args, **kwargs): pass
    def labels(self, *args, **kwargs): return self
    def info(self, *args, **kwargs): pass
    def time(self): return _NoopTimer()


class _NoopTimer:
    def __enter__(self): return self
    def __exit__(self, *args): pass


class MetricsCollector:
    """
    Prometheus metrics for the agent orchestrator.
    Falls back to no-op metrics if prometheus_client is not installed.
    """

    def __init__(self, prefix: str = "wineops"):
        self.prefix = prefix
        self._registry = None

        if PROMETHEUS_AVAILABLE:
            self._registry = CollectorRegistry()
            self._init_metrics()
        else:
            self._init_noop_metrics()

    def _init_metrics(self):
        """Initialize real Prometheus metrics."""
        p = self.prefix

        # Agent metrics
        self.agent_messages_total = Counter(
            f"{p}_agent_messages_processed_total",
            "Total messages processed by agents",
            ["agent_name", "status"],
            registry=self._registry,
        )
        self.agent_processing_duration = Histogram(
            f"{p}_agent_processing_duration_seconds",
            "Time spent processing agent messages",
            ["agent_name"],
            buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
            registry=self._registry,
        )
        self.agent_queue_depth = Gauge(
            f"{p}_agent_queue_depth",
            "Current queue depth per agent",
            ["agent_name"],
            registry=self._registry,
        )
        self.agent_circuit_breaker = Gauge(
            f"{p}_agent_circuit_breaker_state",
            "Circuit breaker state (0=closed, 1=open, 2=half-open)",
            ["agent_name"],
            registry=self._registry,
        )
        self.agent_status = Gauge(
            f"{p}_agent_status",
            "Agent status (0=idle, 1=active, 2=suspended, 3=failed, 4=stopped)",
            ["agent_name", "tier"],
            registry=self._registry,
        )

        # Connection pool metrics
        self.pool_connections = Gauge(
            f"{p}_connection_pool_size",
            "Connection pool size",
            ["pool_type"],
            registry=self._registry,
        )
        self.pool_errors = Counter(
            f"{p}_connection_pool_errors_total",
            "Connection pool errors",
            ["pool_type"],
            registry=self._registry,
        )

        # HTTP metrics
        self.http_requests_total = Counter(
            f"{p}_http_requests_total",
            "Total HTTP requests",
            ["method", "endpoint", "status_code"],
            registry=self._registry,
        )
        self.http_request_duration = Histogram(
            f"{p}_http_request_duration_seconds",
            "HTTP request duration",
            ["method", "endpoint"],
            buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0],
            registry=self._registry,
        )

        # System info
        self.system_info = Info(
            f"{p}_system",
            "System information",
            registry=self._registry,
        )

    def _init_noop_metrics(self):
        """Initialize no-op metrics."""
        noop = NoopMetric()
        self.agent_messages_total = noop
        self.agent_processing_duration = noop
        self.agent_queue_depth = noop
        self.agent_circuit_breaker = noop
        self.agent_status = noop
        self.pool_connections = noop
        self.pool_errors = noop
        self.http_requests_total = noop
        self.http_request_duration = noop
        self.system_info = noop

    def record_agent_message(self, agent_name: str, status: str = "success", duration: float = 0.0):
        """Record an agent message processing event."""
        self.agent_messages_total.labels(agent_name=agent_name, status=status).inc()
        if duration > 0:
            self.agent_processing_duration.labels(agent_name=agent_name).observe(duration)

    def update_agent_status(self, agent_name: str, tier: str, state: str):
        """Update agent status gauge."""
        state_map = {"idle": 0, "active": 1, "suspended": 2, "failed": 3, "stopped": 4}
        value = state_map.get(state, 0)
        self.agent_status.labels(agent_name=agent_name, tier=tier).set(value)

    def update_pool_stats(self, pool_type: str, size: int):
        """Update connection pool size."""
        self.pool_connections.labels(pool_type=pool_type).set(size)

    def record_http_request(self, method: str, endpoint: str, status_code: int, duration: float):
        """Record an HTTP request."""
        self.http_requests_total.labels(method=method, endpoint=endpoint, status_code=str(status_code)).inc()
        self.http_request_duration.labels(method=method, endpoint=endpoint).observe(duration)

    @contextmanager
    def agent_processing_timer(self, agent_name: str):
        """Context manager to time agent message processing."""
        start = time.time()
        status = "success"
        try:
            yield
        except Exception:
            status = "error"
            raise
        finally:
            duration = time.time() - start
            self.record_agent_message(agent_name, status, duration)

    def generate_metrics(self) -> str:
        """Generate Prometheus-format metrics text."""
        if PROMETHEUS_AVAILABLE and self._registry:
            return generate_latest(self._registry).decode("utf-8")
        return "# prometheus_client not installed\n"

    def get_content_type(self) -> str:
        """Get the Prometheus content type header."""
        if PROMETHEUS_AVAILABLE:
            return CONTENT_TYPE_LATEST
        return "text/plain"


# ============================================================================
# OPENTELEMETRY TRACING
# ============================================================================

# Try to import OpenTelemetry; use noop tracer if not available
try:
    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import (
        BatchSpanProcessor,
        ConsoleSpanExporter,
    )
    from opentelemetry.sdk.resources import Resource

    OTEL_AVAILABLE = True
except ImportError:
    OTEL_AVAILABLE = False
    logger.info("opentelemetry not installed; tracing will be no-ops")


class TracingManager:
    """
    OpenTelemetry tracing for distributed message processing.
    Falls back to no-op tracer if opentelemetry is not installed.
    """

    def __init__(
        self,
        service_name: str = "wineops-agent-orchestrator",
        exporter: str = "console",  # "console", "otlp", or "none"
        otlp_endpoint: Optional[str] = None,
    ):
        self.service_name = service_name
        self._tracer = None

        if OTEL_AVAILABLE and exporter != "none":
            self._init_tracer(exporter, otlp_endpoint)
        else:
            logger.info("Tracing disabled (no exporter or opentelemetry not installed)")

    def _init_tracer(self, exporter: str, otlp_endpoint: Optional[str]):
        """Initialize the OpenTelemetry tracer."""
        try:
            resource = Resource.create({
                "service.name": self.service_name,
                "service.version": "2.6.0",
            })

            provider = TracerProvider(resource=resource)

            if exporter == "otlp" and otlp_endpoint:
                try:
                    from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (
                        OTLPSpanExporter,
                    )
                    span_exporter = OTLPSpanExporter(endpoint=otlp_endpoint)
                except ImportError:
                    logger.warning("OTLP exporter not installed, falling back to console")
                    span_exporter = ConsoleSpanExporter()
            else:
                span_exporter = ConsoleSpanExporter()

            provider.add_span_processor(BatchSpanProcessor(span_exporter))
            trace.set_tracer_provider(provider)
            self._tracer = trace.get_tracer(self.service_name)
            logger.info(f"OpenTelemetry tracing initialized (exporter={exporter})")

        except Exception as e:
            logger.warning(f"Failed to initialize tracing: {e}")

    @property
    def tracer(self):
        """Get the tracer instance (or None)."""
        return self._tracer

    @contextmanager
    def start_span(self, name: str, attributes: Optional[Dict[str, Any]] = None):
        """Start a trace span (no-op if tracing is not available)."""
        if self._tracer:
            with self._tracer.start_as_current_span(name) as span:
                if attributes:
                    for k, v in attributes.items():
                        span.set_attribute(k, str(v) if not isinstance(v, (int, float, bool)) else v)
                yield span
        else:
            yield None

    def instrument_fastapi(self, app):
        """Instrument FastAPI app with OpenTelemetry (if available)."""
        if not OTEL_AVAILABLE:
            return
        try:
            from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
            FastAPIInstrumentor.instrument_app(app)
            logger.info("FastAPI instrumented with OpenTelemetry")
        except ImportError:
            logger.debug("FastAPI OpenTelemetry instrumentor not available")


# ============================================================================
# SINGLETON ACCESS
# ============================================================================

_metrics: Optional[MetricsCollector] = None
_tracing: Optional[TracingManager] = None


def get_metrics() -> MetricsCollector:
    """Get or create the global MetricsCollector instance."""
    global _metrics
    if _metrics is None:
        _metrics = MetricsCollector()
    return _metrics


def get_tracing(
    service_name: str = "wineops-agent-orchestrator",
    exporter: str = "console",
    otlp_endpoint: Optional[str] = None,
) -> TracingManager:
    """Get or create the global TracingManager instance."""
    global _tracing
    if _tracing is None:
        _tracing = TracingManager(
            service_name=service_name,
            exporter=exporter,
            otlp_endpoint=otlp_endpoint,
        )
    return _tracing
