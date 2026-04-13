"""
Connection Pool Manager
=======================
Provides pooled connections for Supabase, Redis, and RabbitMQ.
Agents share connections from the pool instead of creating their own.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Dict, List, Optional
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


# =============================================================================
# SUPABASE CONNECTION POOL
# =============================================================================

class SupabasePool:
    """
    Wraps Supabase client with connection retry logic.
    Supabase REST API is stateless, so 'pooling' here means
    reusing a single client instance with retry and health checks.
    """

    def __init__(
        self,
        supabase_url: str,
        supabase_key: str,
        max_retries: int = 3,
        retry_delay: float = 1.0,
    ):
        self._url = supabase_url
        self._key = supabase_key
        self._max_retries = max_retries
        self._retry_delay = retry_delay
        self._client = None
        self._request_count = 0
        self._error_count = 0
        self._last_health_check: float = 0

    @property
    def client(self):
        """Get or create the Supabase client."""
        if self._client is None:
            from supabase import create_client
            self._client = create_client(self._url, self._key)
        return self._client

    async def execute_with_retry(self, operation, *args, **kwargs):
        """Execute a Supabase operation with retry logic."""
        last_error = None
        for attempt in range(1, self._max_retries + 1):
            try:
                self._request_count += 1
                result = operation(*args, **kwargs)
                # If it's a query builder, execute it
                if hasattr(result, 'execute'):
                    result = result.execute()
                return result
            except Exception as e:
                self._error_count += 1
                last_error = e
                if attempt < self._max_retries:
                    delay = self._retry_delay * (2 ** (attempt - 1))
                    logger.warning(
                        f"Supabase operation failed (attempt {attempt}/{self._max_retries}): {e}. "
                        f"Retrying in {delay}s..."
                    )
                    await asyncio.sleep(delay)
                    # Reset client on error
                    self._client = None
        raise last_error

    async def health_check(self) -> bool:
        """Check if Supabase is reachable."""
        try:
            # Simple query to verify connection
            self.client.table("restaurants").select("id").limit(1).execute()
            self._last_health_check = time.time()
            return True
        except Exception as e:
            logger.warning(f"Supabase health check failed: {e}")
            return False

    def get_stats(self) -> Dict[str, Any]:
        return {
            "type": "supabase",
            "requests": self._request_count,
            "errors": self._error_count,
            "error_rate": round(self._error_count / max(self._request_count, 1), 4),
            "connected": self._client is not None,
            "last_health_check": self._last_health_check,
        }


# =============================================================================
# REDIS CONNECTION POOL
# =============================================================================

class RedisPool:
    """
    Wraps Redis with connection pooling.
    Uses redis.asyncio connection pool for efficient connection reuse.
    """

    def __init__(
        self,
        redis_url: str,
        max_connections: int = 20,
        socket_timeout: float = 5.0,
    ):
        self._url = redis_url
        self._max_connections = max_connections
        self._socket_timeout = socket_timeout
        self._pool = None
        self._client = None
        self._request_count = 0
        self._error_count = 0

    async def connect(self):
        """Initialize the Redis connection pool."""
        try:
            import redis.asyncio as aioredis
            self._pool = aioredis.ConnectionPool.from_url(
                self._url,
                max_connections=self._max_connections,
                socket_timeout=self._socket_timeout,
                decode_responses=True,
            )
            self._client = aioredis.Redis(connection_pool=self._pool)
            # Test connection
            await self._client.ping()
            logger.info(f"Redis pool connected (max_connections={self._max_connections})")
        except Exception as e:
            logger.error(f"Failed to connect Redis pool: {e}")
            self._pool = None
            self._client = None

    @property
    def client(self):
        """Get the pooled Redis client."""
        return self._client

    async def get(self, key: str, default=None):
        """Get a value from Redis with error handling."""
        if not self._client:
            return default
        try:
            self._request_count += 1
            result = await self._client.get(key)
            return result if result is not None else default
        except Exception as e:
            self._error_count += 1
            logger.debug(f"Redis GET failed for {key}: {e}")
            return default

    async def set(self, key: str, value: str, ttl: Optional[int] = None):
        """Set a value in Redis with error handling."""
        if not self._client:
            return False
        try:
            self._request_count += 1
            if ttl:
                await self._client.setex(key, ttl, value)
            else:
                await self._client.set(key, value)
            return True
        except Exception as e:
            self._error_count += 1
            logger.debug(f"Redis SET failed for {key}: {e}")
            return False

    async def health_check(self) -> bool:
        """Check Redis connectivity."""
        if not self._client:
            return False
        try:
            await self._client.ping()
            return True
        except Exception:
            return False

    async def disconnect(self):
        """Close the Redis pool."""
        if self._client:
            await self._client.close()
        if self._pool:
            await self._pool.disconnect()
        logger.info("Redis pool disconnected")

    def get_stats(self) -> Dict[str, Any]:
        pool_info = {}
        if self._pool:
            pool_info = {
                "max_connections": self._max_connections,
            }
        return {
            "type": "redis",
            "connected": self._client is not None,
            "requests": self._request_count,
            "errors": self._error_count,
            "error_rate": round(self._error_count / max(self._request_count, 1), 4),
            **pool_info,
        }


# =============================================================================
# RABBITMQ CHANNEL POOL
# =============================================================================

class RabbitMQChannelPool:
    """
    Reuses AMQP channels across agents instead of creating new ones.
    Each agent gets a channel from the pool, returned when done.
    """

    def __init__(
        self,
        rabbitmq_url: str,
        pool_size: int = 10,
    ):
        self._url = rabbitmq_url
        self._pool_size = pool_size
        self._connection = None
        self._available_channels: asyncio.Queue = asyncio.Queue()
        self._created_channels: int = 0
        self._checkouts: int = 0
        self._checkins: int = 0

    async def connect(self):
        """Initialize the RabbitMQ connection and pre-create channels."""
        try:
            import aio_pika
            self._connection = await aio_pika.connect_robust(
                self._url,
                timeout=30,
            )
            # Pre-create a few channels
            initial_channels = min(3, self._pool_size)
            for _ in range(initial_channels):
                channel = await self._connection.channel()
                await self._available_channels.put(channel)
                self._created_channels += 1
            
            logger.info(
                f"RabbitMQ channel pool connected "
                f"(initial={initial_channels}, max={self._pool_size})"
            )
        except Exception as e:
            logger.error(f"Failed to connect RabbitMQ pool: {e}")
            self._connection = None

    @asynccontextmanager
    async def acquire(self):
        """Acquire a channel from the pool (context manager)."""
        channel = None
        try:
            # Try to get an existing channel
            try:
                channel = self._available_channels.get_nowait()
            except asyncio.QueueEmpty:
                # Create a new channel if under the limit
                if self._created_channels < self._pool_size and self._connection:
                    channel = await self._connection.channel()
                    self._created_channels += 1
                else:
                    # Wait for a channel to become available
                    channel = await asyncio.wait_for(
                        self._available_channels.get(), timeout=10.0
                    )
            
            self._checkouts += 1
            yield channel
            
        except Exception as e:
            logger.error(f"RabbitMQ channel pool error: {e}")
            # If channel is broken, don't return it
            if channel and not channel.is_closed:
                await self._available_channels.put(channel)
                self._checkins += 1
            channel = None
            raise
        else:
            # Return channel to pool
            if channel and not channel.is_closed:
                await self._available_channels.put(channel)
                self._checkins += 1

    async def health_check(self) -> bool:
        """Check RabbitMQ connectivity."""
        if not self._connection:
            return False
        try:
            return not self._connection.is_closed
        except Exception:
            return False

    async def disconnect(self):
        """Close all channels and the connection."""
        # Drain and close all channels
        while not self._available_channels.empty():
            try:
                channel = self._available_channels.get_nowait()
                if not channel.is_closed:
                    await channel.close()
            except Exception:
                pass
        
        if self._connection and not self._connection.is_closed:
            await self._connection.close()
        
        logger.info("RabbitMQ channel pool disconnected")

    def get_stats(self) -> Dict[str, Any]:
        return {
            "type": "rabbitmq",
            "connected": self._connection is not None and not (self._connection.is_closed if self._connection else True),
            "pool_size": self._pool_size,
            "created_channels": self._created_channels,
            "available_channels": self._available_channels.qsize(),
            "checkouts": self._checkouts,
            "checkins": self._checkins,
        }


# =============================================================================
# UNIFIED POOL MANAGER
# =============================================================================

class ConnectionPoolManager:
    """
    Unified manager for all connection pools.
    Provides a single interface for health checks and statistics.
    """

    def __init__(
        self,
        supabase_url: Optional[str] = None,
        supabase_key: Optional[str] = None,
        redis_url: Optional[str] = None,
        rabbitmq_url: Optional[str] = None,
    ):
        self.supabase: Optional[SupabasePool] = None
        self.redis: Optional[RedisPool] = None
        self.rabbitmq: Optional[RabbitMQChannelPool] = None

        if supabase_url and supabase_key:
            self.supabase = SupabasePool(supabase_url, supabase_key)
        if redis_url:
            self.redis = RedisPool(redis_url)
        if rabbitmq_url:
            self.rabbitmq = RabbitMQChannelPool(rabbitmq_url)

    async def connect_all(self):
        """Connect all configured pools."""
        tasks = []
        if self.redis:
            tasks.append(self.redis.connect())
        if self.rabbitmq:
            tasks.append(self.rabbitmq.connect())
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def disconnect_all(self):
        """Disconnect all pools."""
        tasks = []
        if self.redis:
            tasks.append(self.redis.disconnect())
        if self.rabbitmq:
            tasks.append(self.rabbitmq.disconnect())
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def health_check(self) -> Dict[str, bool]:
        """Run health checks on all pools."""
        results = {}
        if self.supabase:
            results["supabase"] = await self.supabase.health_check()
        if self.redis:
            results["redis"] = await self.redis.health_check()
        if self.rabbitmq:
            results["rabbitmq"] = await self.rabbitmq.health_check()
        return results

    def get_all_stats(self) -> Dict[str, Any]:
        """Get statistics from all pools."""
        stats = {}
        if self.supabase:
            stats["supabase"] = self.supabase.get_stats()
        if self.redis:
            stats["redis"] = self.redis.get_stats()
        if self.rabbitmq:
            stats["rabbitmq"] = self.rabbitmq.get_stats()
        return stats
