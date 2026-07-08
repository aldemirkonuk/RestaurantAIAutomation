"""
Structured JSON Logging with Agent Context (INFRA-03)
=====================================================
Two output modes:
- Console (stdout): human-readable by default; set LOG_JSON_STDOUT=1 for JSON (CI/production)
- File (logs/agent-orchestrator.log): always structured JSON for log aggregation

Both modes include: timestamp, level, logger, message, agent_name, correlation_id.
"""

import logging
import os
import sys
import threading
from pathlib import Path
from pythonjsonlogger import jsonlogger


# Thread-local storage for correlation context
_context = threading.local()


def set_log_context(agent_name: str = None, correlation_id: str = None):
    """Set logging context for the current thread/task."""
    if agent_name is not None:
        _context.agent_name = agent_name
    if correlation_id is not None:
        _context.correlation_id = correlation_id


def clear_log_context():
    """Clear logging context."""
    _context.agent_name = None
    _context.correlation_id = None


class AgentContextFilter(logging.Filter):
    """Injects agent_name and correlation_id into every log record."""

    def filter(self, record):
        record.agent_name = (
            getattr(_context, "agent_name", None)
            or getattr(record, "agent_name", None)
            or ""
        )
        record.correlation_id = (
            getattr(_context, "correlation_id", None)
            or getattr(record, "correlation_id", None)
            or ""
        )
        return True


class AgentJsonFormatter(jsonlogger.JsonFormatter):
    """JSON formatter that always includes agent_name and correlation_id."""

    def add_fields(self, log_record, record, message_dict):
        super().add_fields(log_record, record, message_dict)
        log_record["timestamp"] = log_record.get("asctime", record.created)
        log_record["level"] = record.levelname
        log_record["logger"] = record.name
        log_record["agent_name"] = getattr(record, "agent_name", "")
        log_record["correlation_id"] = getattr(record, "correlation_id", "")


def setup_logger(name: str) -> logging.Logger:
    """
    Setup structured JSON logger with agent context injection.

    Console: human-readable (development)
    File: structured JSON with timestamp, level, logger, message, agent_name, correlation_id (production)
    """
    logger = logging.getLogger(name)

    # Avoid duplicate handlers
    if logger.handlers:
        return logger

    logger.setLevel(logging.INFO)

    # Add context filter to inject agent_name + correlation_id
    context_filter = AgentContextFilter()
    logger.addFilter(context_filter)

    # Console Handler (human-readable by default; JSON when LOG_JSON_STDOUT=1)
    console_handler = logging.StreamHandler(sys.stdout)
    if os.environ.get("LOG_JSON_STDOUT"):
        console_formatter = AgentJsonFormatter(
            "%(asctime)s %(name)s %(levelname)s %(message)s %(agent_name)s %(correlation_id)s"
        )
    else:
        console_formatter = logging.Formatter(
            "%(asctime)s - %(name)s - %(levelname)s - [%(agent_name)s] [%(correlation_id)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    console_handler.setFormatter(console_formatter)
    console_handler.addFilter(context_filter)
    logger.addHandler(console_handler)

    # File Handler (JSON for production)
    log_dir = Path("logs")
    log_dir.mkdir(exist_ok=True)

    file_handler = logging.FileHandler(log_dir / "agent-orchestrator.log")
    json_formatter = AgentJsonFormatter(
        "%(asctime)s %(name)s %(levelname)s %(message)s %(agent_name)s %(correlation_id)s"
    )
    file_handler.setFormatter(json_formatter)
    file_handler.addFilter(context_filter)
    logger.addHandler(file_handler)

    return logger
