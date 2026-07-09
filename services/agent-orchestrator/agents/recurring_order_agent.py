"""
Recurring Order Agent
Manages scheduled wine orders with automatic execution and notifications
"""

import logging
from datetime import datetime, timedelta, date
from typing import Dict, Optional
import asyncio

logger = logging.getLogger(__name__)


class RecurringOrderAgent:
    """
    Agent responsible for managing recurring wine orders.

    Standalone scheduler — not a message-bus agent.  Lifecycle is managed
    through the explicit start() / stop() methods rather than the BaseAgent
    subscribe-and-process loop.

    Features:
    - Daily checks for due orders
    - 2-day advance notifications
    - Auto-execution with manager approval
    - Frequency management (daily, weekly, biweekly, monthly)
    """

    def __init__(self, db_client, notification_agent):
        """
        Initialize recurring order agent

        Args:
            db_client: Database client for order queries
            notification_agent: Agent for sending notifications
        """
        self.db = db_client
        self.notification_agent = notification_agent
        self.running = False

    async def start(self):
        """Start the recurring order scheduler"""
        self.running = True
        logger.info("Recurring Order Agent started")

        # Run daily check loop
        while self.running:
            try:
                await self.check_scheduled_orders()
                # Sleep until next day at midnight
                await self._sleep_until_next_check()
            except Exception as e:
                logger.error(f"Error in recurring order check: {e}")
                await asyncio.sleep(3600)  # Retry in 1 hour on error

    async def stop(self):
        """Stop the recurring order scheduler"""
        self.running = False
        logger.info("Recurring Order Agent stopped")

    async def check_scheduled_orders(self):
        """Run daily check for recurring orders due today"""
        try:
            logger.info("Checking for due recurring orders...")

            # Fetch all active recurring orders
            recurring_orders = await self.db.fetch_active_recurring_orders()

            today = date.today()

            for order in recurring_orders:
                try:
                    next_date = self._parse_date(order["next_order_date"])

                    # Check if 2-day reminder needed
                    if (next_date - today).days == 2:
                        await self._send_reminder_notification(order)

                    # Check if order is due today
                    elif next_date == today:
                        await self._process_due_order(order)

                except Exception as e:
                    logger.error(
                        f"Error processing recurring order {order.get('id')}: {e}"
                    )

            logger.info(f"Processed {len(recurring_orders)} recurring orders")

        except Exception as e:
            logger.error(f"Error checking scheduled orders: {e}")

    async def _process_due_order(self, order: Dict):
        """
        Process an order that is due today

        Args:
            order: Recurring order dict
        """
        try:
            if order.get("auto_approve"):
                # Auto-execute order
                await self._create_order(order)
                await self._send_executed_notification(order)
            else:
                # Send approval request
                await self._send_approval_request(order)

            # Update next order date
            await self._update_next_order_date(order)

        except Exception as e:
            logger.error(f"Error processing due order {order.get('id')}: {e}")

    async def _create_order(self, order: Dict):
        """
        Create an actual order from recurring order

        Args:
            order: Recurring order dict
        """
        try:
            wine_id = order["wine_id"]
            quantity = order["quantity"]
            unit_type = order["unit_type"]
            preferred_providers = order.get("preferred_providers", [])

            # Create order through procurement agent
            order_data = {
                "wine_id": wine_id,
                "quantity": quantity,
                "unit_type": unit_type,
                "provider_ids": preferred_providers,
                "source": "recurring_order",
                "recurring_order_id": order["id"],
                "auto_approved": True,
            }

            result = await self.db.create_order(order_data)

            logger.info(f"Created recurring order: {result.get('order_id')}")

            # Update last order date
            await self.db.update_recurring_order(
                order["id"], {"last_order_date": datetime.now().isoformat()}
            )

        except Exception as e:
            logger.error(f"Error creating order: {e}")
            raise

    async def _send_reminder_notification(self, order: Dict):
        """
        Send 2-day advance reminder notification

        Args:
            order: Recurring order dict
        """
        try:
            # Fetch wine details
            wine = await self.db.get_wine_by_id(order["wine_id"])

            notification_data = {
                "type": "recurring_order_reminder",
                "title": f"Recurring Order Reminder: {wine['name']}",
                "message": f"Your {order['frequency']} recurring order for {wine['name']} is scheduled in 2 days.",
                "data": {
                    "wine_id": order["wine_id"],
                    "wine_name": wine["name"],
                    "quantity": order["quantity"],
                    "unit_type": order["unit_type"],
                    "scheduled_date": order["next_order_date"],
                    "frequency": order["frequency"],
                    "recurring_order_id": order["id"],
                },
                "actions": [
                    {
                        "label": "Confirm",
                        "action": "confirm_recurring_order",
                        "data": {"order_id": order["id"]},
                    },
                    {
                        "label": "Edit",
                        "action": "edit_recurring_order",
                        "data": {"order_id": order["id"]},
                    },
                    {
                        "label": "Cancel This Instance",
                        "action": "skip_recurring_order",
                        "data": {"order_id": order["id"]},
                    },
                ],
                "priority": "high",
                "channels": ["push", "email"],
            }

            await self.notification_agent.send_notification(notification_data)
            logger.info(f"Sent reminder notification for recurring order {order['id']}")

        except Exception as e:
            logger.error(f"Error sending reminder notification: {e}")

    async def _send_approval_request(self, order: Dict):
        """
        Send approval request for non-auto-approved orders

        Args:
            order: Recurring order dict
        """
        try:
            wine = await self.db.get_wine_by_id(order["wine_id"])

            notification_data = {
                "type": "recurring_order_approval",
                "title": f"Recurring Order Ready: {wine['name']}",
                "message": f"Your scheduled order for {wine['name']} is ready for approval.",
                "data": {
                    "wine_id": order["wine_id"],
                    "wine_name": wine["name"],
                    "quantity": order["quantity"],
                    "unit_type": order["unit_type"],
                    "recurring_order_id": order["id"],
                },
                "actions": [
                    {
                        "label": "Approve & Order Now",
                        "action": "approve_recurring_order",
                        "data": {"order_id": order["id"]},
                    },
                    {
                        "label": "Edit Quantity",
                        "action": "edit_recurring_order",
                        "data": {"order_id": order["id"]},
                    },
                    {
                        "label": "Skip This Time",
                        "action": "skip_recurring_order",
                        "data": {"order_id": order["id"]},
                    },
                ],
                "priority": "high",
                "channels": ["push", "in_app"],
            }

            await self.notification_agent.send_notification(notification_data)
            logger.info(f"Sent approval request for recurring order {order['id']}")

        except Exception as e:
            logger.error(f"Error sending approval request: {e}")

    async def _send_executed_notification(self, order: Dict):
        """
        Send confirmation that order was auto-executed

        Args:
            order: Recurring order dict
        """
        try:
            wine = await self.db.get_wine_by_id(order["wine_id"])

            notification_data = {
                "type": "recurring_order_executed",
                "title": f"Order Placed: {wine['name']}",
                "message": f"Your recurring order for {order['quantity']} {order['unit_type']}(s) of {wine['name']} has been automatically placed.",
                "data": {
                    "wine_id": order["wine_id"],
                    "wine_name": wine["name"],
                    "quantity": order["quantity"],
                    "unit_type": order["unit_type"],
                    "recurring_order_id": order["id"],
                },
                "priority": "medium",
                "channels": ["push", "email"],
            }

            await self.notification_agent.send_notification(notification_data)
            logger.info(
                f"Sent execution notification for recurring order {order['id']}"
            )

        except Exception as e:
            logger.error(f"Error sending execution notification: {e}")

    async def _update_next_order_date(self, order: Dict):
        """
        Calculate and update the next order date based on frequency

        Args:
            order: Recurring order dict
        """
        try:
            current_date = self._parse_date(order["next_order_date"])
            frequency = order["frequency"]
            frequency_day = order.get("frequency_day")

            next_date = self._calculate_next_date(
                current_date, frequency, frequency_day
            )

            await self.db.update_recurring_order(
                order["id"], {"next_order_date": next_date.isoformat()}
            )

            logger.info(f"Updated next order date for {order['id']}: {next_date}")

        except Exception as e:
            logger.error(f"Error updating next order date: {e}")

    def _calculate_next_date(
        self, current_date: date, frequency: str, frequency_day: Optional[int]
    ) -> date:
        """
        Calculate next occurrence based on frequency

        Args:
            current_date: Current scheduled date
            frequency: 'daily', 'weekly', 'biweekly', or 'monthly'
            frequency_day: Day of week (0-6) for weekly, day of month (1-31) for monthly

        Returns:
            Next scheduled date
        """
        if frequency == "daily":
            return current_date + timedelta(days=1)

        elif frequency == "weekly":
            # Next occurrence of specific weekday
            days_ahead = frequency_day - current_date.weekday()
            if days_ahead <= 0:  # Target day already happened this week
                days_ahead += 7
            return current_date + timedelta(days=days_ahead)

        elif frequency == "biweekly":
            # Every 2 weeks on same weekday
            return current_date + timedelta(weeks=2)

        elif frequency == "monthly":
            # Next occurrence of specific day of month
            if frequency_day:
                # Move to next month
                if current_date.month == 12:
                    next_month = date(current_date.year + 1, 1, 1)
                else:
                    next_month = date(current_date.year, current_date.month + 1, 1)

                # Try to set to frequency_day, handle month-end edge cases
                try:
                    return date(next_month.year, next_month.month, frequency_day)
                except ValueError:
                    # Day doesn't exist in month (e.g., Feb 30), use last day of month
                    if next_month.month == 12:
                        last_day = date(next_month.year + 1, 1, 1) - timedelta(days=1)
                    else:
                        last_day = date(
                            next_month.year, next_month.month + 1, 1
                        ) - timedelta(days=1)
                    return last_day
            else:
                # Default to 30 days
                return current_date + timedelta(days=30)

        # Default fallback
        return current_date + timedelta(days=7)

    def _parse_date(self, date_str: str) -> date:
        """Parse ISO date string to date object"""
        if isinstance(date_str, date):
            return date_str
        return datetime.fromisoformat(date_str).date()

    async def _sleep_until_next_check(self):
        """Sleep until next day at midnight (with small offset for safety)"""
        now = datetime.now()
        tomorrow = now + timedelta(days=1)
        next_check = tomorrow.replace(hour=0, minute=5, second=0, microsecond=0)

        sleep_seconds = (next_check - now).total_seconds()
        logger.info(f"Sleeping for {sleep_seconds/3600:.1f} hours until next check")

        await asyncio.sleep(sleep_seconds)


# Singleton instance
_recurring_order_agent = None


def get_recurring_order_agent(db_client, notification_agent) -> RecurringOrderAgent:
    """Get singleton instance of RecurringOrderAgent"""
    global _recurring_order_agent
    if _recurring_order_agent is None:
        _recurring_order_agent = RecurringOrderAgent(db_client, notification_agent)
    return _recurring_order_agent
