"""
Transactional Outbox Publisher (INFRA-07)
=========================================
Background worker that polls the outbox table for unpublished events
and dispatches them to RabbitMQ. Ensures at-least-once delivery even
if the application crashes between DB commit and RabbitMQ publish.
"""

import asyncio
from datetime import datetime

from core.message_bus import MessageBus
from core.database import DatabaseClient
from utils.logger import setup_logger


class OutboxPublisher:
    """
    Polls the outbox table for unpublished events and publishes them
    to RabbitMQ. Designed to run as a background asyncio task.

    Usage:
        publisher = OutboxPublisher(message_bus, database)
        asyncio.create_task(publisher.run(poll_interval_seconds=5))
    """

    def __init__(self, message_bus: MessageBus, database: DatabaseClient):
        self.message_bus = message_bus
        self.database = database
        self.logger = setup_logger("outbox_publisher")
        self._shutdown = False
        self.batch_size = 50

    async def poll_and_publish(self) -> int:
        """
        Poll for unpublished outbox rows and dispatch to RabbitMQ.
        Returns the number of successfully published messages.
        """
        try:
            result = (
                self.database.supabase.table("outbox")
                .select("*")
                .eq("published", False)
                .order("created_at", desc=False)
                .limit(self.batch_size)
                .execute()
            )

            if not result.data:
                return 0

            published_count = 0

            for row in result.data:
                try:
                    success = await self.message_bus.publish(
                        exchange_name=row["exchange"],
                        routing_key=row["routing_key"],
                        message_body=row["payload"],
                    )

                    if success:
                        self.database.supabase.table("outbox").update(
                            {
                                "published": True,
                                "published_at": datetime.utcnow().isoformat(),
                            }
                        ).eq("id", row["id"]).execute()
                        published_count += 1
                    else:
                        self.logger.warning(
                            f"Outbox dispatch returned False for row {row['id']}"
                        )

                except Exception as e:
                    self.logger.error(f"Failed to dispatch outbox row {row['id']}: {e}")
                    # Continue to next row — don't block on single failure

            if published_count > 0:
                self.logger.info(
                    f"Outbox: published {published_count}/{len(result.data)} events"
                )

            return published_count

        except Exception as e:
            self.logger.error(f"Outbox poll failed: {e}")
            return 0

    async def run(self, poll_interval_seconds: float = 5.0) -> None:
        """
        Run the outbox publisher as a background loop.
        Polls every poll_interval_seconds for unpublished events.
        """
        self.logger.info(
            f"Outbox publisher started (poll interval: {poll_interval_seconds}s, "
            f"batch size: {self.batch_size})"
        )

        while not self._shutdown:
            try:
                await self.poll_and_publish()
            except Exception as e:
                self.logger.error(f"Outbox publisher loop error: {e}")

            await asyncio.sleep(poll_interval_seconds)

        self.logger.info("Outbox publisher stopped")

    def stop(self):
        """Signal the publisher to stop."""
        self._shutdown = True
