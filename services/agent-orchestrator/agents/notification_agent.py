"""
Notification Agent - Complete Production-Ready Multi-Channel Notification System

Handles:
- SMS via Plivo (high priority alerts)
- Email via Gmail/SendGrid (reports, summaries)
- Push notifications (Web Push + FCM) with action buttons
- Smart channel selection based on urgency
- Rate limiting and delivery tracking
- Template rendering
- Notification preferences
"""

from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
import asyncio
import uuid

import redis.asyncio as aioredis

from core.base_agent import BaseAgent
from core.message_bus import MessageBus
from core.database import DatabaseClient
from services.plivo_client import PlivoSMSClient
from services.email_client import EmailClient
from services.push_notification_service import PushNotificationService


class NotificationAgent(BaseAgent):
    """
    Production-Ready Notification Agent
    
    Features:
    ✅ Multi-channel (SMS, Email, Push)
    ✅ Smart channel selection
    ✅ Rate limiting
    ✅ Template system
    ✅ Delivery tracking
    ✅ Retry logic
    ✅ Action buttons for one-tap approvals
    ✅ Notification preferences
    """
    
    def __init__(
        self,
        agent_name: str,
        message_bus: MessageBus,
        database: DatabaseClient,
        config: Dict[str, Any]
    ):
        super().__init__(agent_name, message_bus, database, config)
        
        # Configuration
        self.mock_mode = config.get("mock_mode", True)
        
        # Initialize service clients
        self.sms_client = PlivoSMSClient(
            auth_id=config.get("plivo_auth_id"),
            auth_token=config.get("plivo_auth_token"),
            from_number=config.get("plivo_phone_number"),
            mock_mode=self.mock_mode
        )
        
        self.email_client = EmailClient(
            backend=config.get("email_backend", "gmail"),
            gmail_user=config.get("gmail_user"),
            gmail_password=config.get("gmail_password"),
            sendgrid_api_key=config.get("sendgrid_api_key"),
            from_email=config.get("from_email"),
            from_name="WineOps AI",
            mock_mode=self.mock_mode
        )
        
        self.push_service = PushNotificationService(
            vapid_private_key=config.get("vapid_private_key"),
            vapid_public_key=config.get("vapid_public_key"),
            vapid_email=config.get("vapid_email"),
            fcm_server_key=config.get("fcm_server_key"),
            mock_mode=self.mock_mode
        )
        
        # Rate limiting
        self.rate_limits = {
            "sms": {"per_hour": 10, "per_day": 50},
            "email": {"per_hour": 50, "per_day": 200},
            "push": {"per_hour": 100, "per_day": 500}
        }
        # BUG-07: Redis client for persistent rate limiting (initialised in initialize())
        self._redis = None

        # BUG-08: Store batch processor task reference for health monitoring
        self._batch_task: Optional[asyncio.Task] = None

        # HARD-03: Retry counter for DLQ escalation (event_id -> failure count)
        self._notification_retry_counts: Dict[str, int] = {}

        # Notification queue (for batching)
        self.notification_queue: Dict[str, List[Dict]] = {}  # manager_id -> notifications
        self.batch_interval_seconds = 300  # 5 minutes
    
    async def initialize(self) -> None:
        """Initialize the agent"""
        self.logger.info("Initializing Notification Agent...")

        if self.mock_mode:
            self.logger.warning("Running in MOCK mode (no real notifications sent)")

        # BUG-07: Initialise Redis client for persistent rate limit counters
        try:
            self._redis = await aioredis.from_url(
                self.config.get("redis_url", "redis://localhost:6379"),
                encoding="utf-8",
                decode_responses=True,
            )
            await self._redis.ping()
            self.logger.info("Redis connected for rate limit persistence")
        except Exception as e:
            self.logger.warning(
                f"Redis unavailable ({e}) — rate limits will be in-memory this session"
            )
            self._redis = None

        # BUG-08: Store task reference so health_check can monitor it
        self._batch_task = asyncio.create_task(self._batch_processor())

        self.logger.info("Notification Agent initialized")
    
    # =========================================================================
    # NOTIFICATION TEMPLATES
    # =========================================================================
    
    NOTIFICATION_TEMPLATES = {
        # Recurring Order Templates
        'recurring_order_reminder': {
            'title': 'Recurring Order Reminder: {wine_name}',
            'message': '''Your {frequency} recurring order for {wine_name} is coming up in {days} days.
            
Details:
- Wine: {wine_name}
- Quantity: {quantity} {unit_type}
- Scheduled Date: {date}
- Providers: {providers}

Please review and confirm or make changes as needed.''',
            'channels': ['push', 'email'],
            'priority': 'high',
            'actions': [
                {'label': 'Confirm', 'action': 'confirm_recurring_order'},
                {'label': 'Edit', 'action': 'edit_recurring_order'},
                {'label': 'Cancel This Instance', 'action': 'skip_recurring_order'}
            ]
        },
        
        'recurring_order_executed': {
            'title': 'Order Placed: {wine_name}',
            'message': '''Your recurring order for {wine_name} has been automatically placed.

Details:
- Wine: {wine_name}
- Quantity: {quantity} {unit_type}
- Provider: {provider_name}
- Total: ${total_price}
- Order ID: {order_id}

The order has been submitted and you'll receive updates on delivery.''',
            'channels': ['push', 'email'],
            'priority': 'medium'
        },
        
        'recurring_order_approval_needed': {
            'title': 'Recurring Order Ready: {wine_name}',
            'message': '''Your scheduled order for {wine_name} is ready for approval.

Details:
- Wine: {wine_name}
- Quantity: {quantity} {unit_type}
- Preferred Providers: {providers}
- Next Order Date: {date}

This order requires your approval before it will be placed.''',
            'channels': ['push', 'in_app'],
            'priority': 'high',
            'actions': [
                {'label': 'Approve & Order Now', 'action': 'approve_recurring_order'},
                {'label': 'Edit Quantity', 'action': 'edit_recurring_order'},
                {'label': 'Skip This Time', 'action': 'skip_recurring_order'}
            ]
        },
        
        # Vendor Deadline Templates
        'vendor_deadline_reminder': {
            'title': 'Order Deadline Approaching: {provider_name}',
            'message': '''Reminder: {provider_name} order deadline is approaching!

Deadline: Every {deadline_day} at {deadline_time}
Time remaining: {hours_remaining} hours

Make sure to place your orders before the cutoff time to ensure timely delivery.''',
            'channels': ['push', 'email', 'sms'],
            'priority': 'high',
            'actions': [
                {'label': 'Review Current Orders', 'action': 'view_orders'},
                {'label': 'Create New Order', 'action': 'create_order'},
                {'label': 'Dismiss', 'action': 'dismiss'}
            ]
        },
        
        'vendor_deadline_missed': {
            'title': 'Deadline Passed: {provider_name}',
            'message': '''The order deadline for {provider_name} has passed.

Missed Deadline: {deadline_day} at {deadline_time}
Next Deadline: {next_deadline}

Any pending orders may experience delays. Contact the provider directly if urgent.''',
            'channels': ['push', 'email'],
            'priority': 'medium'
        },
        
        # Auction Purchase Templates
        'auction_purchase_recorded': {
            'title': 'Auction Purchase Recorded: {wine_name}',
            'message': '''Your auction purchase has been successfully recorded.

Wine: {wine_name} ({vintage})
Quantity: {quantity} {unit_type}
Auction House: {auction_house}
Total Cost: ${total_cost}

The wine has been added to your inventory.''',
            'channels': ['push', 'email'],
            'priority': 'medium'
        },
        
        # Invoice Scanning Templates
        'invoice_processed': {
            'title': 'Invoice Processed: {invoice_number}',
            'message': '''Invoice has been scanned and processed.

Invoice: {invoice_number}
Provider: {provider_name}
Wines Extracted: {wine_count}
Total Amount: ${total_amount}

Review the extracted items and add to inventory when ready.''',
            'channels': ['push', 'in_app'],
            'priority': 'medium',
            'actions': [
                {'label': 'Review & Add to Inventory', 'action': 'review_invoice'},
                {'label': 'Dismiss', 'action': 'dismiss'}
            ]
        },
        
        'invoice_scan_failed': {
            'title': 'Invoice Scan Failed',
            'message': '''Failed to process invoice {invoice_number}.

Error: {error_message}

Please try again or add items to inventory manually.''',
            'channels': ['push', 'in_app'],
            'priority': 'low'
        },
    }
    
    def get_subscribed_routing_keys(self) -> List[tuple[str, str]]:
        """Define routing keys this agent subscribes to"""
        return [
            # Low stock alerts
            ("stock.events", "stock.threshold.breached"),
            ("stock.events", "stock.critical"),
            
            # Procurement alerts
            ("procurement.events", "procurement.order.requires_approval"),
            ("procurement.events", "procurement.negotiation.completed"),
            ("procurement.events", "procurement.order.delivered"),
            
            # Recurring order events
            ("recurring.events", "recurring.order.reminder"),
            ("recurring.events", "recurring.order.executed"),
            ("recurring.events", "recurring.order.approval_needed"),
            
            # Vendor deadline events
            ("vendor.events", "vendor.deadline.reminder"),
            ("vendor.events", "vendor.deadline.missed"),
            
            # Invoice scanning events
            ("invoice.events", "invoice.processed"),
            ("invoice.events", "invoice.scan_failed"),
            
            # Auction events
            ("auction.events", "auction.purchase.recorded"),
            
            # General alerts
            ("notifications", "alert.high_priority"),
            ("notifications", "alert.fraud"),
            ("notifications", "alert.anomaly"),
            
            # Reports
            ("reports", "report.daily"),
            ("reports", "report.weekly"),
            ("reports", "report.monthly"),
        ]
    
    async def _track_notification_delivery(
        self,
        event_id: str,
        restaurant_id: Optional[str],
        channel: str,
    ) -> Optional[str]:
        """
        Insert a pending delivery record into notification_deliveries.
        Returns the notification_id for subsequent status updates.
        HARD-03: delivery tracking.
        """
        try:
            result = self.database.supabase.table("notification_deliveries").insert({
                "event_id": event_id,
                "restaurant_id": restaurant_id,
                "channel": channel,
                "status": "pending",
            }).execute()
            rows = result.data or []
            if rows:
                return rows[0].get("notification_id")
        except Exception as e:
            self.logger.warning(f"Failed to insert notification_deliveries pending row: {e}")
        return None

    async def _mark_delivery_sent(self, notification_id: str) -> None:
        """Update notification_deliveries row to status='sent'. HARD-03."""
        try:
            self.database.supabase.table("notification_deliveries").update({
                "status": "sent",
                "delivered_at": datetime.utcnow().isoformat(),
            }).eq("notification_id", notification_id).execute()
        except Exception as e:
            self.logger.warning(f"Failed to update notification_deliveries to sent: {e}")

    async def _mark_delivery_failed(self, notification_id: str, error: str) -> None:
        """Update notification_deliveries row to status='failed'. HARD-03."""
        try:
            self.database.supabase.table("notification_deliveries").update({
                "status": "failed",
                "error": error,
            }).eq("notification_id", notification_id).execute()
        except Exception as e:
            self.logger.warning(f"Failed to update notification_deliveries to failed: {e}")

    async def process_message(self, message: Dict[str, Any]) -> None:
        """Process incoming notification requests"""
        try:
            routing_key = message.get("routing_key") or ""
            payload = message.get("payload", {})

            # HARD-03: Idempotency gate — skip if this event_id was already processed
            event_id = message.get("event_id", "") or payload.get("event_id", "")
            if event_id and await self._check_idempotency(event_id):
                self.logger.info(f"Duplicate notification skipped: {event_id}")
                return

            restaurant_id = payload.get("restaurant_id")
            # Determine primary channel from routing key for delivery tracking
            if "sms" in routing_key:
                _primary_channel = "sms"
            elif "email" in routing_key or "report" in routing_key:
                _primary_channel = "email"
            else:
                _primary_channel = "sms"  # default for stock/fraud alerts

            # HARD-03: Insert pending delivery record before dispatching
            _effective_event_id = event_id or str(uuid.uuid4())
            notification_id = await self._track_notification_delivery(
                event_id=_effective_event_id,
                restaurant_id=restaurant_id,
                channel=_primary_channel,
            )

            try:
                # Route to appropriate handler
                if "stock.threshold.breached" in routing_key:
                    await self.send_low_stock_alert(payload)

                elif "stock.critical" in routing_key:
                    await self.send_critical_stock_alert(payload)

                elif "procurement.order.requires_approval" in routing_key:
                    await self.send_order_approval_request(payload)

                elif "procurement.negotiation.completed" in routing_key:
                    await self.send_negotiation_complete_notification(payload)

                elif "procurement.order.delivered" in routing_key:
                    await self.send_delivery_confirmation_request(payload)

                elif "alert.high_priority" in routing_key:
                    await self.send_high_priority_alert(payload)

                elif "alert.fraud" in routing_key:
                    await self.send_fraud_alert(payload)

                elif "report.daily" in routing_key:
                    await self.send_daily_report(payload)

                elif "report.weekly" in routing_key:
                    await self.send_weekly_report(payload)

                # Recurring order events
                elif "recurring.order.reminder" in routing_key:
                    await self.send_recurring_order_reminder(payload)

                elif "recurring.order.executed" in routing_key:
                    await self.send_recurring_order_executed(payload)

                elif "recurring.order.approval_needed" in routing_key:
                    await self.send_recurring_order_approval(payload)

                # Vendor deadline events
                elif "vendor.deadline.reminder" in routing_key:
                    await self.send_vendor_deadline_reminder(payload)

                elif "vendor.deadline.missed" in routing_key:
                    await self.send_vendor_deadline_missed(payload)

                # Invoice events
                elif "invoice.processed" in routing_key:
                    await self.send_invoice_processed(payload)

                elif "invoice.scan_failed" in routing_key:
                    await self.send_invoice_scan_failed(payload)

                # Auction events
                elif "auction.purchase.recorded" in routing_key:
                    await self.send_auction_purchase_recorded(payload)

                else:
                    self.logger.warning(f"No handler for routing key: {routing_key}")

                # HARD-03: Mark delivery as sent and record idempotency
                if notification_id:
                    await self._mark_delivery_sent(notification_id)
                if event_id:
                    await self._mark_processed(event_id, result={"status": "sent", "channel": _primary_channel})

            except Exception as dispatch_exc:
                # HARD-03: Track failure and escalate to DLQ after 3 retries
                self._notification_retry_counts[_effective_event_id] = (
                    self._notification_retry_counts.get(_effective_event_id, 0) + 1
                )
                if notification_id:
                    await self._mark_delivery_failed(notification_id, str(dispatch_exc))
                if self._notification_retry_counts.get(_effective_event_id, 0) >= 3:
                    await self._send_to_dlq(
                        message,
                        error=str(dispatch_exc),
                        retry_count=3,
                        original_exchange="notification.events",
                        original_routing_key="notification.send",
                    )
                raise

        except Exception as e:
            self.logger.error(f"Error processing notification message: {e}", exc_info=True)
            raise
    
    # =========================================================================
    # NOTIFICATION HANDLERS
    # =========================================================================
    
    async def send_low_stock_alert(self, payload: Dict[str, Any]) -> None:
        """
        Send low stock alert
        
        Channels used based on urgency:
        - Critical (< 1 day): SMS + Push + Email
        - High (1-2 days): Push + Email
        - Medium (2-5 days): Push only
        - Low (> 5 days): Email digest
        """
        wine_name = payload.get("wine_name", "Unknown Wine")
        current_stock = payload.get("stock_after", 0)
        threshold = payload.get("threshold", 0)
        estimated_stockout_days = payload.get("estimated_stockout_days", 999)
        restaurant_id = payload.get("restaurant_id")
        
        # Get manager details
        manager = await self._get_manager_for_restaurant(restaurant_id)
        if not manager:
            self.logger.error(f"No manager found for restaurant {restaurant_id}")
            return
        
        # Get notification preferences
        prefs = await self._get_notification_preferences(manager["id"])
        
        # Determine urgency and channels
        urgency = self._calculate_urgency(estimated_stockout_days)
        channels = await self._select_channels(urgency, prefs, "low_stock_alert")
        
        # Send via selected channels
        results = []
        
        if "sms" in channels and manager.get("phone"):
            sms_body = (
                f"🚨 LOW STOCK: {wine_name}\n"
                f"Stock: {current_stock} bottles\n"
                f"Est. stockout: {estimated_stockout_days:.1f} days\n"
                f"Tap to reorder: {self._get_reorder_url(restaurant_id, wine_name)}"
            )
            result = await self.sms_client.send_sms(manager["phone"], sms_body, priority="high")
            results.append(("sms", result))
        
        if "push" in channels:
            # Get push subscriptions
            subscriptions = await self._get_push_subscriptions(manager["id"])
            for sub in subscriptions:
                result = await self.push_service.send_low_stock_notification(
                    subscription_or_token=sub["subscription_data"],
                    notification_type=sub["type"],
                    wine_name=wine_name,
                    current_stock=current_stock,
                    threshold=threshold,
                    estimated_stockout_days=estimated_stockout_days,
                    reorder_url=self._get_reorder_url(restaurant_id, wine_name)
                )
                results.append(("push", result))
        
        if "email" in channels and manager.get("email"):
            result = await self.email_client.send_template_email(
                to_email=manager["email"],
                template_name="low_stock_alert",
                template_data={
                    "manager_name": manager.get("name", "Manager"),
                    "wine_name": wine_name,
                    "current_stock": current_stock,
                    "threshold": threshold,
                    "stockout_days": f"{estimated_stockout_days:.1f}",
                    "approval_url": self._get_reorder_url(restaurant_id, wine_name)
                },
                subject=f"🚨 Low Stock Alert: {wine_name}"
            )
            results.append(("email", result))
        
        # Log notification
        await self._log_notification(
            restaurant_id=restaurant_id,
            manager_id=manager["id"],
            notification_type="low_stock_alert",
            channels=channels,
            payload=payload,
            results=results
        )
        
        self.logger.info(f"Sent low stock alert for {wine_name} via {channels}")
    
    async def send_critical_stock_alert(self, payload: Dict[str, Any]) -> None:
        """Send critical stock alert (< 24 hours to stockout)"""
        # Similar to low_stock_alert but always uses all channels
        payload["urgency"] = "critical"
        await self.send_low_stock_alert(payload)
    
    async def send_order_approval_request(self, payload: Dict[str, Any]) -> None:
        """
        Send order approval request with one-tap action buttons
        
        This is the core notification for procurement approvals
        """
        order_id = payload.get("order_id")
        wine_name = payload.get("wine_name")
        quantity = payload.get("quantity")
        provider_name = payload.get("provider_name")
        final_price = payload.get("final_price")
        total_cost = final_price * quantity
        delivery_estimate = payload.get("delivery_estimate", "3-5 business days")
        conversation_summary = payload.get("conversation_summary", "")
        restaurant_id = payload.get("restaurant_id")
        
        # Get manager
        manager = await self._get_manager_for_restaurant(restaurant_id)
        if not manager:
            return
        
        # Generate action URLs
        approve_url = f"{self._get_base_url()}/api/orders/{order_id}/approve?token={self._generate_action_token(order_id, 'approve')}"
        reject_url = f"{self._get_base_url()}/api/orders/{order_id}/reject?token={self._generate_action_token(order_id, 'reject')}"
        
        # Get preferences
        prefs = await self._get_notification_preferences(manager["id"])
        channels = prefs.get("order_approval_channels", ["push", "email", "sms"])
        
        # Send via selected channels
        results = []
        
        # Push notification (PRIORITY - for one-tap approval)
        if "push" in channels:
            subscriptions = await self._get_push_subscriptions(manager["id"])
            for sub in subscriptions:
                result = await self.push_service.send_approval_notification(
                    subscription_or_token=sub["subscription_data"],
                    notification_type=sub["type"],
                    order_id=order_id,
                    wine_name=wine_name,
                    provider_name=provider_name,
                    quantity=quantity,
                    final_price=final_price,
                    approve_url=approve_url,
                    reject_url=reject_url,
                    conversation_summary=conversation_summary
                )
                results.append(("push", result))
        
        # SMS with action links
        if "sms" in channels and manager.get("phone"):
            sms_body = (
                f"🍷 ORDER APPROVAL NEEDED\n"
                f"{wine_name}\n"
                f"{quantity} bottles from {provider_name}\n"
                f"${final_price}/bottle (Total: ${total_cost})\n"
                f"Approve: {approve_url[:40]}..."
            )
            result = await self.sms_client.send_sms_with_action_buttons(
                to_number=manager["phone"],
                message=sms_body,
                approve_url=approve_url,
                reject_url=reject_url
            )
            results.append(("sms", result))
        
        # Email with full details
        if "email" in channels and manager.get("email"):
            result = await self.email_client.send_template_email(
                to_email=manager["email"],
                template_name="order_approval",
                template_data={
                    "manager_name": manager.get("name", "Manager"),
                    "wine_name": wine_name,
                    "quantity": quantity,
                    "provider_name": provider_name,
                    "final_price": f"{final_price:.2f}",
                    "total_cost": f"{total_cost:.2f}",
                    "delivery_estimate": delivery_estimate,
                    "approve_url": approve_url,
                    "reject_url": reject_url
                },
                subject=f"📦 Order Approval Required: {wine_name}"
            )
            results.append(("email", result))
        
        # Log notification
        await self._log_notification(
            restaurant_id=restaurant_id,
            manager_id=manager["id"],
            notification_type="order_approval",
            channels=channels,
            payload=payload,
            results=results
        )
        
        self.logger.info(f"Sent order approval request for {order_id} via {channels}")
    
    async def send_negotiation_complete_notification(self, payload: Dict[str, Any]) -> None:
        """Notify manager that AI has completed price negotiation"""
        restaurant_id = payload.get("restaurant_id")
        order_id = payload.get("order_id", "")
        wine_name = payload.get("wine_name", "Unknown Wine")
        provider_name = payload.get("provider_name", "Vendor")
        negotiated_price = payload.get("negotiated_price", 0)
        target_price = payload.get("target_price", 0)
        conversation_summary = payload.get("summary", "Negotiation completed.")
        
        manager = await self._get_manager_for_restaurant(restaurant_id)
        if not manager:
            return
        
        prefs = await self._get_notification_preferences(manager["id"])
        channels = await self._select_channels("high", prefs, "negotiation_complete")
        results = []
        
        if "push" in channels:
            subscriptions = await self._get_push_subscriptions(manager["id"])
            for sub in subscriptions:
                result = await self.push_service.send_push_notification(
                    user_id=manager.get("id"),
                    title=f"Negotiation Complete: {wine_name}",
                    body=f"{provider_name} offered ${negotiated_price:.2f}/bottle (target: ${target_price:.2f}). {conversation_summary[:80]}",
                    data={"order_id": order_id, "type": "negotiation_complete"},
                    actions=[
                        {"action": "approve", "title": "Approve"},
                        {"action": "reject", "title": "Reject"},
                        {"action": "view", "title": "View Details"},
                    ],
                )
                results.append(("push", result))
        
        if "email" in channels and manager.get("email"):
            result = await self.email_client.send_template_email(
                to_email=manager["email"],
                template_name="negotiation_complete",
                template_data={
                    "manager_name": manager.get("name", "Manager"),
                    "wine_name": wine_name,
                    "provider_name": provider_name,
                    "negotiated_price": f"{negotiated_price:.2f}",
                    "target_price": f"{target_price:.2f}",
                    "summary": conversation_summary,
                    "approve_url": f"{self._get_base_url()}/orders/{order_id}?action=approve",
                },
                subject=f"Negotiation Complete: {wine_name} with {provider_name}",
            )
            results.append(("email", result))
        
        await self._log_notification(
            restaurant_id=restaurant_id,
            manager_id=manager["id"],
            notification_type="negotiation_complete",
            channels=channels,
            payload=payload,
            results=results,
        )
        self.logger.info(f"Sent negotiation complete notification for order {order_id} via {channels}")
    
    async def send_delivery_confirmation_request(self, payload: Dict[str, Any]) -> None:
        """Request manager to confirm delivery -- push + SMS"""
        restaurant_id = payload.get("restaurant_id")
        order_id = payload.get("order_id", "")
        wine_name = payload.get("wine_name", "Unknown Wine")
        provider_name = payload.get("provider_name", "Vendor")
        quantity = payload.get("quantity", 0)
        
        manager = await self._get_manager_for_restaurant(restaurant_id)
        if not manager:
            return
        
        prefs = await self._get_notification_preferences(manager["id"])
        channels = await self._select_channels("high", prefs, "delivery_confirmation")
        results = []
        
        if "sms" in channels and manager.get("phone"):
            sms_body = (
                f"📦 DELIVERY ARRIVED: {wine_name} x{quantity} from {provider_name}\n"
                f"Please verify and confirm: {self._get_base_url()}/orders/{order_id}"
            )
            result = await self.sms_client.send_sms(manager["phone"], sms_body, priority="high")
            results.append(("sms", result))
        
        if "push" in channels:
            subscriptions = await self._get_push_subscriptions(manager["id"])
            for sub in subscriptions:
                result = await self.push_service.send_push_notification(
                    user_id=manager.get("id"),
                    title=f"Delivery Arrived: {wine_name}",
                    body=f"{quantity} bottles from {provider_name}. Tap to verify and confirm.",
                    data={"order_id": order_id, "type": "delivery_confirmation"},
                    actions=[
                        {"action": "confirm", "title": "Confirm Delivery"},
                        {"action": "issue", "title": "Report Issue"},
                    ],
                )
                results.append(("push", result))
        
        if "email" in channels and manager.get("email"):
            result = await self.email_client.send_template_email(
                to_email=manager["email"],
                template_name="delivery_confirmation",
                template_data={
                    "manager_name": manager.get("name", "Manager"),
                    "wine_name": wine_name,
                    "provider_name": provider_name,
                    "quantity": quantity,
                    "confirm_url": f"{self._get_base_url()}/orders/{order_id}?action=confirm",
                },
                subject=f"📦 Delivery Arrived: {wine_name} x{quantity}",
            )
            results.append(("email", result))
        
        await self._log_notification(
            restaurant_id=restaurant_id,
            manager_id=manager["id"],
            notification_type="delivery_confirmation",
            channels=channels,
            payload=payload,
            results=results,
        )
        self.logger.info(f"Sent delivery confirmation request for order {order_id} via {channels}")
    
    async def send_high_priority_alert(self, payload: Dict[str, Any]) -> None:
        """Send high priority alert (anomaly, large correction, etc.) -- all channels"""
        restaurant_id = payload.get("restaurant_id")
        title = payload.get("title", "High Priority Alert")
        message = payload.get("message", "An anomaly has been detected that requires your attention.")
        alert_type = payload.get("alert_type", "anomaly")
        
        manager = await self._get_manager_for_restaurant(restaurant_id)
        if not manager:
            return
        
        # High priority always uses SMS + Push + Email
        results = []
        
        if manager.get("phone"):
            sms_body = f"⚠️ {title}\n{message[:140]}\n{self._get_base_url()}/alerts"
            result = await self.sms_client.send_sms(manager["phone"], sms_body, priority="urgent")
            results.append(("sms", result))
        
        subscriptions = await self._get_push_subscriptions(manager["id"])
        for sub in subscriptions:
            result = await self.push_service.send_push_notification(
                user_id=manager.get("id"),
                title=title,
                body=message[:200],
                data={"type": "high_priority", "alert_type": alert_type},
                actions=[{"action": "view", "title": "View Details"}],
            )
            results.append(("push", result))
        
        if manager.get("email"):
            result = await self.email_client.send_template_email(
                to_email=manager["email"],
                template_name="high_priority_alert",
                template_data={
                    "manager_name": manager.get("name", "Manager"),
                    "title": title,
                    "message": message,
                    "alert_type": alert_type,
                    "dashboard_url": f"{self._get_base_url()}/dashboard",
                },
                subject=f"⚠️ {title}",
            )
            results.append(("email", result))
        
        await self._log_notification(
            restaurant_id=restaurant_id,
            manager_id=manager["id"],
            notification_type="high_priority_alert",
            channels=["sms", "push", "email"],
            payload=payload,
            results=results,
        )
        self.logger.info(f"Sent high priority alert: {title} via all channels")
    
    async def send_fraud_alert(self, payload: Dict[str, Any]) -> None:
        """Send fraud detection alert -- always all channels, always immediate"""
        restaurant_id = payload.get("restaurant_id")
        alert_details = payload.get("details", "Suspicious activity detected.")
        affected_entity = payload.get("entity", "Unknown")
        severity = payload.get("severity", "high")
        
        manager = await self._get_manager_for_restaurant(restaurant_id)
        if not manager:
            return
        
        results = []
        
        if manager.get("phone"):
            sms_body = (
                f"🚨 FRAUD ALERT: {affected_entity}\n"
                f"{alert_details[:120]}\n"
                f"Review immediately: {self._get_base_url()}/audit"
            )
            result = await self.sms_client.send_sms(manager["phone"], sms_body, priority="urgent")
            results.append(("sms", result))
        
        subscriptions = await self._get_push_subscriptions(manager["id"])
        for sub in subscriptions:
            result = await self.push_service.send_push_notification(
                user_id=manager.get("id"),
                title=f"Fraud Alert: {affected_entity}",
                body=alert_details[:200],
                data={"type": "fraud_alert", "severity": severity},
                actions=[
                    {"action": "review", "title": "Review Now"},
                    {"action": "lock", "title": "Lock Account"},
                ],
            )
            results.append(("push", result))
        
        if manager.get("email"):
            result = await self.email_client.send_template_email(
                to_email=manager["email"],
                template_name="fraud_alert",
                template_data={
                    "manager_name": manager.get("name", "Manager"),
                    "entity": affected_entity,
                    "details": alert_details,
                    "severity": severity,
                    "audit_url": f"{self._get_base_url()}/audit",
                },
                subject=f"🚨 Fraud Alert: {affected_entity}",
            )
            results.append(("email", result))
        
        await self._log_notification(
            restaurant_id=restaurant_id,
            manager_id=manager["id"],
            notification_type="fraud_alert",
            channels=["sms", "push", "email"],
            payload=payload,
            results=results,
        )
        self.logger.info(f"Sent fraud alert for {affected_entity} via all channels")
    
    async def send_daily_report(self, payload: Dict[str, Any]) -> None:
        """Send daily operations report via email"""
        restaurant_id = payload.get("restaurant_id")
        report_data = payload.get("report_data", {})
        
        manager = await self._get_manager_for_restaurant(restaurant_id)
        if not manager or not manager.get("email"):
            return
        
        # Send daily report email
        result = await self.email_client.send_template_email(
            to_email=manager["email"],
            template_name="daily_report",
            template_data={
                "manager_name": manager.get("name", "Manager"),
                "date": datetime.now().strftime("%B %d, %Y"),
                "total_revenue": report_data.get("total_revenue", 0),
                "bottles_sold": report_data.get("bottles_sold", 0),
                "top_wine": report_data.get("top_wine", "N/A"),
                "low_stock_count": report_data.get("low_stock_count", 0),
                "pending_orders": report_data.get("pending_orders", 0),
                "dashboard_url": f"{self._get_base_url()}/dashboard"
            },
            subject=f"📊 Daily Report - {datetime.now().strftime('%B %d, %Y')}"
        )
        
        self.logger.info(f"Sent daily report to {manager['email']}")
    
    async def send_weekly_report(self, payload: Dict[str, Any]) -> None:
        """Send weekly operations summary report via email + push"""
        restaurant_id = payload.get("restaurant_id")
        report_data = payload.get("report_data", {})
        week_start = payload.get("week_start", "")
        week_end = payload.get("week_end", "")
        
        manager = await self._get_manager_for_restaurant(restaurant_id)
        if not manager or not manager.get("email"):
            return
        
        results = []
        
        # Email (primary channel for reports)
        result = await self.email_client.send_template_email(
            to_email=manager["email"],
            template_name="weekly_report",
            template_data={
                "manager_name": manager.get("name", "Manager"),
                "week_start": week_start,
                "week_end": week_end,
                "total_revenue": report_data.get("total_revenue", 0),
                "bottles_sold": report_data.get("bottles_sold", 0),
                "total_orders": report_data.get("total_orders", 0),
                "avg_order_value": report_data.get("avg_order_value", 0),
                "top_wines": report_data.get("top_wines", []),
                "low_stock_count": report_data.get("low_stock_count", 0),
                "cost_savings": report_data.get("cost_savings", 0),
                "dashboard_url": f"{self._get_base_url()}/reports",
            },
            subject=f"📊 Weekly Report: {week_start} - {week_end}",
        )
        results.append(("email", result))
        
        # Push notification that report is ready
        subscriptions = await self._get_push_subscriptions(manager["id"])
        for sub in subscriptions:
            result = await self.push_service.send_push_notification(
                user_id=manager.get("id"),
                title="Weekly Report Ready",
                body=f"Your weekly report for {week_start} - {week_end} is ready.",
                data={"type": "weekly_report"},
                actions=[{"action": "view", "title": "View Report"}],
            )
            results.append(("push", result))
        
        await self._log_notification(
            restaurant_id=restaurant_id,
            manager_id=manager["id"],
            notification_type="weekly_report",
            channels=["email", "push"],
            payload=payload,
            results=results,
        )
        self.logger.info(f"Sent weekly report to {manager['email']}")
    
    # =========================================================================
    # REALTIME WEEK DEMO - NEW NOTIFICATION TYPES
    # =========================================================================
    
    async def send_vintage_mismatch_alert(self, payload: Dict[str, Any]) -> None:
        """
        Send vintage mismatch alert
        
        Message: "SKU is 2019 but they sent 2020. Update?"
        """
        order_id = payload.get("order_id")
        wine_name = payload.get("wine_name", "Unknown Wine")
        expected_vintage = payload.get("expected_vintage")
        received_vintage = payload.get("received_vintage")
        restaurant_id = payload.get("restaurant_id")
        
        self.logger.info(f"📱 Sending vintage mismatch alert for {wine_name}")
        
        # Get manager
        manager = await self._get_manager_for_restaurant(restaurant_id) if restaurant_id else None
        
        # Build message
        title = "⚠️ Vintage Mismatch Detected"
        message = (
            f"SKU is {expected_vintage} but they sent {received_vintage}.\n"
            f"Wine: {wine_name}\n"
            f"Do you want to update the inventory?"
        )
        
        # Action buttons for one-tap
        actions = [
            {"id": "approve", "label": f"Accept {received_vintage}", "url": f"/orders/{order_id}/approve-vintage"},
            {"id": "reject", "label": "Reject Delivery", "url": f"/orders/{order_id}/reject"},
            {"id": "contact", "label": "Contact Vendor", "url": f"/orders/{order_id}/contact"},
        ]
        
        # Send push notification
        if manager:
            try:
                await self.push_service.send_push_notification(
                    user_id=manager.get("id"),
                    title=title,
                    body=message,
                    data={
                        "type": "vintage_mismatch",
                        "order_id": order_id,
                        "actions": actions,
                    },
                    actions=actions,
                )
                self.logger.info(f"✓ Push notification sent for vintage mismatch")
            except Exception as e:
                self.logger.error(f"Push notification failed: {e}")
        
        # Send SMS
        if manager and manager.get("phone"):
            try:
                sms_message = (
                    f"⚠️ VINTAGE MISMATCH\n"
                    f"{wine_name}\n"
                    f"Ordered: {expected_vintage}\n"
                    f"Received: {received_vintage}\n"
                    f"Reply ACCEPT or REJECT"
                )
                await self.sms_client.send_sms(
                    to_number=manager["phone"],
                    message=sms_message,
                )
                self.logger.info(f"✓ SMS sent for vintage mismatch")
            except Exception as e:
                self.logger.error(f"SMS failed: {e}")
    
    async def send_inventory_discrepancy_alert(self, payload: Dict[str, Any]) -> None:
        """
        Send inventory discrepancy alert
        
        Message: "[Wine1] sold 2 bottles but we're down 3"
        """
        wine_name = payload.get("wine_name", "Unknown Wine")
        expected_stock = payload.get("expected_stock", 0)
        physical_count = payload.get("physical_count", 0)
        discrepancy = payload.get("discrepancy", 0)
        discrepancy_type = payload.get("discrepancy_type", "unknown")
        restaurant_id = payload.get("restaurant_id")
        inventory_id = payload.get("inventory_id")
        
        self.logger.info(f"📱 Sending inventory discrepancy alert for {wine_name}")
        
        # Get manager
        manager = await self._get_manager_for_restaurant(restaurant_id) if restaurant_id else None
        
        # Build message
        if discrepancy < 0:
            title = f"⚠️ Inventory Shortage: {wine_name}"
            message = (
                f"[{wine_name}] has {abs(discrepancy)} fewer bottles than expected.\n"
                f"Expected: {expected_stock}\n"
                f"Counted: {physical_count}\n"
                f"Missing: {abs(discrepancy)} bottle(s)"
            )
        else:
            title = f"📦 Inventory Surplus: {wine_name}"
            message = (
                f"[{wine_name}] has {discrepancy} more bottles than expected.\n"
                f"Expected: {expected_stock}\n"
                f"Counted: {physical_count}\n"
                f"Extra: {discrepancy} bottle(s)"
            )
        
        # Action buttons
        actions = [
            {"id": "investigate", "label": "Investigate", "url": f"/inventory/{inventory_id}/investigate"},
            {"id": "adjust", "label": "Adjust Stock", "url": f"/inventory/{inventory_id}/adjust"},
            {"id": "recount", "label": "Recount", "url": f"/inventory/{inventory_id}/recount"},
        ]
        
        # Send push notification
        if manager:
            try:
                await self.push_service.send_push_notification(
                    user_id=manager.get("id"),
                    title=title,
                    body=message,
                    data={
                        "type": "inventory_discrepancy",
                        "inventory_id": inventory_id,
                        "discrepancy": discrepancy,
                        "actions": actions,
                    },
                    actions=actions,
                )
                self.logger.info(f"✓ Push notification sent for discrepancy")
            except Exception as e:
                self.logger.error(f"Push notification failed: {e}")
        
        # Send SMS for moderate/major discrepancies
        if manager and manager.get("phone") and discrepancy_type in ["moderate", "major"]:
            try:
                sms_message = (
                    f"⚠️ INVENTORY DISCREPANCY\n"
                    f"{wine_name}\n"
                    f"Expected: {expected_stock}\n"
                    f"Counted: {physical_count}\n"
                    f"Diff: {discrepancy:+d}\n"
                    f"Reply ADJUST or INVESTIGATE"
                )
                await self.sms_client.send_sms(
                    to_number=manager["phone"],
                    message=sms_message,
                )
                self.logger.info(f"✓ SMS sent for discrepancy")
            except Exception as e:
                self.logger.error(f"SMS failed: {e}")
    
    async def send_one_tap_order_alert(self, payload: Dict[str, Any]) -> None:
        """
        Send low stock alert with one-tap order button
        
        Message: "Low stock. Tap to order 12 bottles from Vendor X"
        """
        wine_name = payload.get("wine_name", "Unknown Wine")
        current_stock = payload.get("current_stock", 0)
        threshold = payload.get("threshold", 3)
        suggested_quantity = payload.get("suggested_quantity", 12)
        provider_name = payload.get("provider_name", "Default Vendor")
        estimated_cost = payload.get("estimated_cost", 0)
        restaurant_id = payload.get("restaurant_id")
        inventory_id = payload.get("inventory_id")
        
        self.logger.info(f"📱 Sending one-tap order alert for {wine_name}")
        
        # Get manager
        manager = await self._get_manager_for_restaurant(restaurant_id) if restaurant_id else None
        
        # Build message
        title = f"⚠️ Low Stock: {wine_name}"
        message = (
            f"{wine_name} is running low ({current_stock}/{threshold}).\n"
            f"Tap to order {suggested_quantity} bottles from {provider_name}.\n"
            f"Est. cost: ${estimated_cost:.2f}"
        )
        
        # One-tap action buttons
        actions = [
            {
                "id": "order_now",
                "label": f"Order {suggested_quantity} bottles",
                "url": f"/inventory/{inventory_id}/quick-order?qty={suggested_quantity}",
                "primary": True,
            },
            {
                "id": "customize",
                "label": "Customize Order",
                "url": f"/inventory/{inventory_id}/order",
            },
            {
                "id": "dismiss",
                "label": "Dismiss",
                "url": f"/inventory/{inventory_id}/dismiss-alert",
            },
        ]
        
        # Send push notification with one-tap
        if manager:
            try:
                await self.push_service.send_push_notification(
                    user_id=manager.get("id"),
                    title=title,
                    body=message,
                    data={
                        "type": "low_stock_one_tap",
                        "inventory_id": inventory_id,
                        "suggested_quantity": suggested_quantity,
                        "provider_name": provider_name,
                        "one_tap_enabled": True,
                        "actions": actions,
                    },
                    actions=actions,
                )
                self.logger.info(f"✓ One-tap order notification sent")
            except Exception as e:
                self.logger.error(f"Push notification failed: {e}")
        
        # Send SMS with quick reply options
        if manager and manager.get("phone"):
            try:
                sms_message = (
                    f"⚠️ LOW STOCK: {wine_name}\n"
                    f"Stock: {current_stock}/{threshold}\n"
                    f"Order {suggested_quantity} from {provider_name}?\n"
                    f"Est: ${estimated_cost:.2f}\n\n"
                    f"Reply:\n"
                    f"✅ YES - Place order\n"
                    f"📝 EDIT - Change qty\n"
                    f"❌ NO - Dismiss"
                )
                await self.sms_client.send_sms(
                    to_number=manager["phone"],
                    message=sms_message,
                )
                self.logger.info(f"✓ One-tap SMS sent")
            except Exception as e:
                self.logger.error(f"SMS failed: {e}")
    
    async def send_wine_type_mismatch_alert(self, payload: Dict[str, Any]) -> None:
        """
        Send wine type mismatch alert
        
        Message: "Ordered 2021 red, got 2021 white"
        """
        order_id = payload.get("order_id")
        wine_name = payload.get("wine_name", "Unknown Wine")
        vintage = payload.get("vintage")
        expected_type = payload.get("expected_type")
        received_type = payload.get("received_type")
        restaurant_id = payload.get("restaurant_id")
        
        self.logger.info(f"📱 Sending wine type mismatch alert for {wine_name}")
        
        # Get manager
        manager = await self._get_manager_for_restaurant(restaurant_id) if restaurant_id else None
        
        # Build message
        title = "🚨 Wrong Wine Delivered"
        message = (
            f"An order has been delivered wrong!\n"
            f"Ordered: {vintage} {expected_type}\n"
            f"Received: {vintage} {received_type}\n"
            f"Wine: {wine_name}"
        )
        
        # Action buttons
        actions = [
            {"id": "accept", "label": f"Accept {received_type}", "url": f"/orders/{order_id}/accept-substitute"},
            {"id": "reject", "label": "Reject & Return", "url": f"/orders/{order_id}/reject"},
            {"id": "call", "label": "Call Vendor", "url": f"/orders/{order_id}/call-vendor"},
        ]
        
        # Send push notification (high priority)
        if manager:
            try:
                await self.push_service.send_push_notification(
                    user_id=manager.get("id"),
                    title=title,
                    body=message,
                    data={
                        "type": "wine_type_mismatch",
                        "order_id": order_id,
                        "priority": "critical",
                        "actions": actions,
                    },
                    actions=actions,
                )
                self.logger.info(f"✓ Push notification sent for wine type mismatch")
            except Exception as e:
                self.logger.error(f"Push notification failed: {e}")
        
        # Send SMS (always for this critical alert)
        if manager and manager.get("phone"):
            try:
                sms_message = (
                    f"🚨 WRONG WINE DELIVERED\n"
                    f"{wine_name}\n"
                    f"Ordered: {vintage} {expected_type}\n"
                    f"Got: {vintage} {received_type}\n\n"
                    f"Reply ACCEPT, REJECT, or CALL"
                )
                await self.sms_client.send_sms(
                    to_number=manager["phone"],
                    message=sms_message,
                )
                self.logger.info(f"✓ SMS sent for wine type mismatch")
            except Exception as e:
                self.logger.error(f"SMS failed: {e}")
    
    # =========================================================================
    # HELPER METHODS
    # =========================================================================
    
    def _calculate_urgency(self, estimated_stockout_days: float) -> str:
        """Calculate urgency level based on stockout estimate"""
        if estimated_stockout_days < 1:
            return "critical"
        elif estimated_stockout_days < 2:
            return "high"
        elif estimated_stockout_days < 5:
            return "medium"
        else:
            return "low"
    
    async def _select_channels(
        self,
        urgency: str,
        preferences: Dict[str, Any],
        notification_type: str
    ) -> List[str]:
        """
        Select notification channels based on urgency and preferences.

        Priority matrix:
        - Critical: SMS + Push + Email
        - High: Push + Email
        - Medium: Push
        - Low: Email (digest)
        """
        # Check quiet hours
        if self._is_quiet_hours(preferences):
            # Only send critical alerts during quiet hours
            if urgency != "critical":
                return []

        # Get channel preferences for this notification type
        type_prefs = preferences.get(f"{notification_type}_channels", [])

        # Default channels by urgency
        urgency_channels = {
            "critical": ["sms", "push", "email"],
            "high": ["push", "email"],
            "medium": ["push"],
            "low": ["email"]
        }

        default_channels = urgency_channels.get(urgency, ["email"])

        # Intersect with preferences
        if type_prefs:
            channels = [ch for ch in default_channels if ch in type_prefs]
        else:
            channels = default_channels

        # Apply rate limiting: remove channels that exceeded limits
        # BUG-07: _check_rate_limit and _increment_rate_limit are now async (Redis-backed)
        restaurant_id = preferences.get("restaurant_id", "unknown")
        filtered = []
        for ch in channels:
            if await self._check_rate_limit(restaurant_id, ch):
                filtered.append(ch)
                await self._increment_rate_limit(restaurant_id, ch)
            else:
                self.logger.warning(f"Rate limit exceeded for {ch} on restaurant {restaurant_id}")

        return filtered
    
    def _is_quiet_hours(self, preferences: Dict[str, Any]) -> bool:
        """Check if current time is within quiet hours (e.g., 22:00 - 08:00)"""
        if not preferences.get("quiet_hours_enabled", False):
            return False
        
        now = datetime.now().time()
        start_str = preferences.get("quiet_hours_start", "22:00")
        end_str = preferences.get("quiet_hours_end", "08:00")
        
        try:
            start_parts = start_str.split(":")
            end_parts = end_str.split(":")
            from datetime import time as dt_time
            start_time = dt_time(int(start_parts[0]), int(start_parts[1]))
            end_time = dt_time(int(end_parts[0]), int(end_parts[1]))
            
            if start_time <= end_time:
                # Same-day range (e.g., 09:00 - 17:00)
                return start_time <= now <= end_time
            else:
                # Overnight range (e.g., 22:00 - 08:00)
                return now >= start_time or now <= end_time
        except (ValueError, IndexError):
            self.logger.warning(f"Invalid quiet hours format: {start_str} - {end_str}")
            return False
    
    async def _check_rate_limit(self, restaurant_id: str, channel: str) -> bool:
        """
        Check if the channel hasn't exceeded hourly rate limits for this restaurant.

        BUG-07 fix: counter stored in Redis so it survives restarts.
        Falls back to always-allow when Redis is unavailable (fail open).
        """
        limits = self.rate_limits.get(channel, {"per_hour": 100, "per_day": 500})
        per_hour = limits["per_hour"]

        if self._redis is None:
            # Redis not available — fail open (allow the notification)
            self.logger.warning(
                f"Redis unavailable — rate limit check skipped for {channel}@{restaurant_id}"
            )
            return True

        try:
            key = f"wineops:ratelimit:{restaurant_id}:{channel}:hour"
            current = await self._redis.get(key)
            count = int(current) if current is not None else 0
            return count < per_hour
        except Exception as e:
            self.logger.warning(f"Redis rate limit check failed ({e}) — failing open")
            return True

    async def _increment_rate_limit(self, restaurant_id: str, channel: str) -> None:
        """
        Increment hourly rate limit counter for restaurant+channel in Redis.

        BUG-07 fix: INCR with TTL 3600 so counter auto-expires after one hour.
        TTL is only set on the first increment (INCR returns 1) so the window
        starts when the first notification is sent.
        """
        if self._redis is None:
            return

        try:
            key = f"wineops:ratelimit:{restaurant_id}:{channel}:hour"
            new_count = await self._redis.incr(key)
            if new_count == 1:
                # First notification in this hour window — set TTL
                await self._redis.expire(key, 3600)
        except Exception as e:
            self.logger.warning(f"Redis rate limit increment failed ({e}) — continuing")
    
    async def _get_manager_for_restaurant(self, restaurant_id: str) -> Optional[Dict[str, Any]]:
        """Get primary manager for restaurant"""
        try:
            response = self.database.supabase.table("restaurants") \
                .select("*, users!restaurants_manager_id_fkey(*)") \
                .eq("id", restaurant_id) \
                .single() \
                .execute()
            
            if response.data:
                return response.data.get("users")
            return None
        except Exception as e:
            self.logger.error(f"Failed to get manager: {e}")
            return None
    
    async def _get_notification_preferences(self, manager_id: str) -> Dict[str, Any]:
        """Get notification preferences for manager"""
        try:
            response = self.database.supabase.table("notification_preferences") \
                .select("*") \
                .eq("user_id", manager_id) \
                .single() \
                .execute()
            
            return response.data if response.data else {}
        except Exception as e:
            self.logger.warning(f"No preferences found for manager {manager_id}: {e}")
            return {}
    
    async def _get_push_subscriptions(self, manager_id: str) -> List[Dict[str, Any]]:
        """Get all push subscriptions for manager"""
        try:
            response = self.database.supabase.table("push_subscriptions") \
                .select("*") \
                .eq("user_id", manager_id) \
                .eq("active", True) \
                .execute()
            
            return response.data or []
        except Exception as e:
            self.logger.error(f"Failed to get push subscriptions: {e}")
            return []
    
    async def _log_notification(
        self,
        restaurant_id: str,
        manager_id: str,
        notification_type: str,
        channels: List[str],
        payload: Dict[str, Any],
        results: List[tuple]
    ) -> None:
        """Log notification to database"""
        try:
            await self.database.supabase.table("notification_logs").insert({
                "restaurant_id": restaurant_id,
                "user_id": manager_id,
                "notification_type": notification_type,
                "channels": channels,
                "payload": payload,
                "results": dict(results),
                "sent_at": datetime.utcnow().isoformat(),
                "success": all(r[1].get("success", False) for r in results)
            }).execute()
        except Exception as e:
            self.logger.warning(f"Failed to log notification: {e}")
    
    def _get_reorder_url(self, restaurant_id: str, wine_name: str) -> str:
        """Generate reorder URL"""
        return f"{self._get_base_url()}/inventory?wine={wine_name}&action=reorder"
    
    def _get_base_url(self) -> str:
        """Get base URL for links"""
        return "https://app.wineops.ai"  # From config
    
    def _generate_action_token(self, order_id: str, action: str) -> str:
        """Generate secure token for one-tap actions"""
        # In real implementation, use proper JWT/HMAC signing
        import hashlib
        import time
        data = f"{order_id}:{action}:{int(time.time())}"
        return hashlib.sha256(data.encode()).hexdigest()[:16]
    
    async def _batch_processor(self) -> None:
        """Background task to process batched notifications"""
        while True:
            try:
                await asyncio.sleep(self.batch_interval_seconds)
                # Process batched notifications (email digests)
                # Implementation placeholder
            except Exception as e:
                self.logger.error(f"Batch processor error: {e}")

    async def health_check(self) -> Dict[str, Any]:
        """
        Extended health check that monitors the batch processor task (BUG-08 fix).
        """
        base = await super().health_check()

        # BUG-08: Check if batch processor task is still running
        if self._batch_task is None:
            base["batch_processor_running"] = False
            base["batch_processor_error"] = "task_never_started"
            base["healthy"] = False
        elif self._batch_task.done():
            base["batch_processor_running"] = False
            exc = self._batch_task.exception()
            base["batch_processor_error"] = str(exc) if exc else "exited_unexpectedly"
            base["healthy"] = False
            # Attempt restart
            self.logger.warning(
                "Batch processor task has stopped — restarting. "
                f"Error: {base['batch_processor_error']}"
            )
            self._batch_task = asyncio.create_task(self._batch_processor())
        else:
            base["batch_processor_running"] = True

        # BUG-07: Check Redis connectivity
        if self._redis is not None:
            try:
                await self._redis.ping()
                base["redis_connected"] = True
            except Exception as e:
                base["redis_connected"] = False
                base["redis_error"] = str(e)

        return base

    # =========================================================================
    # NEW NOTIFICATION HANDLERS - RECURRING ORDERS & VENDOR DEADLINES
    # =========================================================================
    
    async def send_recurring_order_reminder(self, payload: Dict[str, Any]) -> None:
        """Send 2-day advance reminder for recurring order"""
        template = self.NOTIFICATION_TEMPLATES['recurring_order_reminder']
        
        wine_name = payload.get("wine_name", "Unknown Wine")
        frequency = payload.get("frequency", "scheduled")
        days = payload.get("days_until", 2)
        quantity = payload.get("quantity", 0)
        unit_type = payload.get("unit_type", "bottles")
        date = payload.get("next_order_date", "")
        providers = ", ".join(payload.get("preferred_providers", ["Default provider"]))
        restaurant_id = payload.get("restaurant_id")
        recurring_order_id = payload.get("recurring_order_id")
        
        manager = await self._get_manager_for_restaurant(restaurant_id)
        if not manager:
            return
        
        message = template['message'].format(
            wine_name=wine_name,
            frequency=frequency,
            days=days,
            quantity=quantity,
            unit_type=unit_type,
            date=date,
            providers=providers
        )
        
        # Send push notification
        if self.push_service:
            await self.push_service.send_notification(
                user_id=manager["id"],
                title=template['title'].format(wine_name=wine_name),
                body=message,
                data={
                    'type': 'recurring_order_reminder',
                    'recurring_order_id': recurring_order_id,
                    'actions': template.get('actions', [])
                }
            )
        
        # Send email
        if self.email_client:
            await self.email_client.send_template_email(
                to_email=manager["email"],
                template_name="recurring_order_reminder",
                template_data={
                    "wine_name": wine_name,
                    "frequency": frequency,
                    "days": days,
                    "quantity": quantity,
                    "unit_type": unit_type,
                    "date": date,
                    "providers": providers
                }
            )
        
        self.logger.info(f"Sent recurring order reminder for {wine_name}")
    
    async def send_recurring_order_executed(self, payload: Dict[str, Any]) -> None:
        """Notify manager that recurring order was automatically placed"""
        template = self.NOTIFICATION_TEMPLATES['recurring_order_executed']
        
        wine_name = payload.get("wine_name", "Unknown Wine")
        quantity = payload.get("quantity", 0)
        unit_type = payload.get("unit_type", "bottles")
        provider_name = payload.get("provider_name", "Provider")
        total_price = payload.get("total_price", 0.0)
        order_id = payload.get("order_id", "")
        restaurant_id = payload.get("restaurant_id")
        
        manager = await self._get_manager_for_restaurant(restaurant_id)
        if not manager:
            return
        
        message = template['message'].format(
            wine_name=wine_name,
            quantity=quantity,
            unit_type=unit_type,
            provider_name=provider_name,
            total_price=total_price,
            order_id=order_id
        )
        
        # Send push notification
        if self.push_service:
            await self.push_service.send_notification(
                user_id=manager["id"],
                title=template['title'].format(wine_name=wine_name),
                body=message,
                data={
                    'type': 'recurring_order_executed',
                    'order_id': order_id
                }
            )
        
        self.logger.info(f"Sent recurring order executed notification for {order_id}")
    
    async def send_recurring_order_approval(self, payload: Dict[str, Any]) -> None:
        """Request manager approval for recurring order"""
        template = self.NOTIFICATION_TEMPLATES['recurring_order_approval_needed']
        
        wine_name = payload.get("wine_name", "Unknown Wine")
        quantity = payload.get("quantity", 0)
        unit_type = payload.get("unit_type", "bottles")
        providers = ", ".join(payload.get("preferred_providers", ["Default provider"]))
        date = payload.get("next_order_date", "")
        restaurant_id = payload.get("restaurant_id")
        recurring_order_id = payload.get("recurring_order_id")
        
        manager = await self._get_manager_for_restaurant(restaurant_id)
        if not manager:
            return
        
        message = template['message'].format(
            wine_name=wine_name,
            quantity=quantity,
            unit_type=unit_type,
            providers=providers,
            date=date
        )
        
        # Send push notification with action buttons
        if self.push_service:
            await self.push_service.send_notification(
                user_id=manager["id"],
                title=template['title'].format(wine_name=wine_name),
                body=message,
                data={
                    'type': 'recurring_order_approval',
                    'recurring_order_id': recurring_order_id,
                    'actions': template.get('actions', [])
                },
                priority='high'
            )
        
        self.logger.info(f"Sent recurring order approval request for {recurring_order_id}")
    
    async def send_vendor_deadline_reminder(self, payload: Dict[str, Any]) -> None:
        """Send vendor order deadline reminder"""
        template = self.NOTIFICATION_TEMPLATES['vendor_deadline_reminder']
        
        provider_name = payload.get("provider_name", "Provider")
        deadline_day = payload.get("deadline_day", "Monday")
        deadline_time = payload.get("deadline_time", "12:00 PM")
        hours_remaining = payload.get("hours_remaining", 48)
        restaurant_id = payload.get("restaurant_id")
        
        manager = await self._get_manager_for_restaurant(restaurant_id)
        if not manager:
            return
        
        message = template['message'].format(
            provider_name=provider_name,
            deadline_day=deadline_day,
            deadline_time=deadline_time,
            hours_remaining=hours_remaining
        )
        
        # Send via multiple channels for high-priority deadline
        results = []
        
        if self.push_service:
            result = await self.push_service.send_notification(
                user_id=manager["id"],
                title=template['title'].format(provider_name=provider_name),
                body=message,
                data={
                    'type': 'vendor_deadline_reminder',
                    'provider_name': provider_name,
                    'actions': template.get('actions', [])
                },
                priority='high'
            )
            results.append(("push", result))
        
        if self.email_client:
            result = await self.email_client.send_template_email(
                to_email=manager["email"],
                template_name="vendor_deadline_reminder",
                template_data={
                    "provider_name": provider_name,
                    "deadline_day": deadline_day,
                    "deadline_time": deadline_time,
                    "hours_remaining": hours_remaining
                }
            )
            results.append(("email", result))
        
        # SMS for critical deadlines (< 24 hours)
        if hours_remaining < 24 and self.sms_client and manager.get("phone"):
            sms_message = f"⚠️ {provider_name} order deadline in {hours_remaining}h! Place orders soon."
            result = await self.sms_client.send_sms(
                to_number=manager["phone"],
                message=sms_message
            )
            results.append(("sms", result))
        
        self.logger.info(f"Sent vendor deadline reminder for {provider_name}")
    
    async def send_vendor_deadline_missed(self, payload: Dict[str, Any]) -> None:
        """Notify that vendor deadline was missed"""
        template = self.NOTIFICATION_TEMPLATES['vendor_deadline_missed']
        
        provider_name = payload.get("provider_name", "Provider")
        deadline_day = payload.get("deadline_day", "Monday")
        deadline_time = payload.get("deadline_time", "12:00 PM")
        next_deadline = payload.get("next_deadline", "Next week")
        restaurant_id = payload.get("restaurant_id")
        
        manager = await self._get_manager_for_restaurant(restaurant_id)
        if not manager:
            return
        
        message = template['message'].format(
            provider_name=provider_name,
            deadline_day=deadline_day,
            deadline_time=deadline_time,
            next_deadline=next_deadline
        )
        
        if self.push_service:
            await self.push_service.send_notification(
                user_id=manager["id"],
                title=template['title'].format(provider_name=provider_name),
                body=message,
                data={'type': 'vendor_deadline_missed'}
            )
        
        self.logger.info(f"Sent vendor deadline missed notification for {provider_name}")
    
    async def send_invoice_processed(self, payload: Dict[str, Any]) -> None:
        """Notify that invoice was successfully processed"""
        template = self.NOTIFICATION_TEMPLATES['invoice_processed']
        
        invoice_number = payload.get("invoice_number", "Unknown")
        provider_name = payload.get("provider_name", "Provider")
        wine_count = payload.get("wine_count", 0)
        total_amount = payload.get("total_amount", 0.0)
        invoice_id = payload.get("invoice_id")
        restaurant_id = payload.get("restaurant_id")
        
        manager = await self._get_manager_for_restaurant(restaurant_id)
        if not manager:
            return
        
        message = template['message'].format(
            invoice_number=invoice_number,
            provider_name=provider_name,
            wine_count=wine_count,
            total_amount=total_amount
        )
        
        if self.push_service:
            await self.push_service.send_notification(
                user_id=manager["id"],
                title=template['title'].format(invoice_number=invoice_number),
                body=message,
                data={
                    'type': 'invoice_processed',
                    'invoice_id': invoice_id,
                    'actions': template.get('actions', [])
                }
            )
        
        self.logger.info(f"Sent invoice processed notification for {invoice_number}")
    
    async def send_invoice_scan_failed(self, payload: Dict[str, Any]) -> None:
        """Notify that invoice scan failed"""
        template = self.NOTIFICATION_TEMPLATES['invoice_scan_failed']
        
        invoice_number = payload.get("invoice_number", "Unknown")
        error_message = payload.get("error_message", "Unknown error")
        restaurant_id = payload.get("restaurant_id")
        
        manager = await self._get_manager_for_restaurant(restaurant_id)
        if not manager:
            return
        
        message = template['message'].format(
            invoice_number=invoice_number,
            error_message=error_message
        )
        
        if self.push_service:
            await self.push_service.send_notification(
                user_id=manager["id"],
                title=template['title'],
                body=message,
                data={'type': 'invoice_scan_failed'}
            )
        
        self.logger.info(f"Sent invoice scan failed notification")
    
    async def send_auction_purchase_recorded(self, payload: Dict[str, Any]) -> None:
        """Notify that auction purchase was recorded"""
        template = self.NOTIFICATION_TEMPLATES['auction_purchase_recorded']
        
        wine_name = payload.get("wine_name", "Unknown Wine")
        vintage = payload.get("vintage", "NV")
        quantity = payload.get("quantity", 0)
        unit_type = payload.get("unit_type", "bottles")
        auction_house = payload.get("auction_house", "Auction")
        total_cost = payload.get("total_cost", 0.0)
        restaurant_id = payload.get("restaurant_id")
        
        manager = await self._get_manager_for_restaurant(restaurant_id)
        if not manager:
            return
        
        message = template['message'].format(
            wine_name=wine_name,
            vintage=vintage,
            quantity=quantity,
            unit_type=unit_type,
            auction_house=auction_house,
            total_cost=total_cost
        )
        
        if self.push_service:
            await self.push_service.send_notification(
                user_id=manager["id"],
                title=template['title'].format(wine_name=wine_name),
                body=message,
                data={'type': 'auction_purchase_recorded'}
            )
        
        self.logger.info(f"Sent auction purchase recorded notification for {wine_name}")
    
    def get_stats(self) -> Dict[str, Any]:
        """Get notification statistics"""
        return {
            "sms": self.sms_client.get_stats(),
            "email": self.email_client.get_stats(),
            "push": self.push_service.get_stats()
        }
