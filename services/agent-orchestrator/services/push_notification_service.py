"""
Push Notification Service - Production-Ready Web Push & Firebase

Supports:
- Web Push API (for browser notifications)
- Firebase Cloud Messaging (for mobile apps)
- Action buttons for one-tap approvals
- Rich notifications with images
- Deep linking

Features:
- Async sending
- Retry logic
- Subscription management
- Delivery tracking
"""

import asyncio
import json
from typing import Optional, Dict, Any, List
from datetime import datetime
import httpx
from pywebpush import webpush, WebPushException

from utils.logger import setup_logger

logger = setup_logger(__name__)


class PushNotificationService:
    """
    Production-ready push notification service
    
    Supports:
    - Web Push (browser notifications)
    - Firebase Cloud Messaging (mobile apps)
    - Action buttons for one-tap approvals
    - Rich notifications
    """
    
    def __init__(
        self,
        vapid_private_key: Optional[str] = None,
        vapid_public_key: Optional[str] = None,
        vapid_email: Optional[str] = None,
        fcm_server_key: Optional[str] = None,
        mock_mode: bool = False
    ):
        """
        Initialize push notification service
        
        Args:
            vapid_private_key: VAPID private key for Web Push
            vapid_public_key: VAPID public key for Web Push
            vapid_email: Contact email for VAPID (e.g., mailto:admin@example.com)
            fcm_server_key: Firebase Cloud Messaging server key
            mock_mode: If True, log instead of sending
        """
        self.vapid_private_key = vapid_private_key
        self.vapid_public_key = vapid_public_key
        self.vapid_email = vapid_email
        self.fcm_server_key = fcm_server_key
        self.mock_mode = mock_mode
        
        # HTTP client for FCM
        self.http_client = httpx.AsyncClient(timeout=30.0)
        
        # Stats
        self.total_sent = 0
        self.total_failed = 0
        
        # Validate configuration
        if not mock_mode:
            if vapid_private_key and vapid_public_key:
                logger.info("✅ Web Push configured")
            else:
                logger.warning("⚠️ Web Push not configured (missing VAPID keys)")
            
            if fcm_server_key:
                logger.info("✅ Firebase Cloud Messaging configured")
            else:
                logger.warning("⚠️ FCM not configured (missing server key)")
        
        if mock_mode:
            logger.info("📲 Push notifications running in MOCK mode")
    
    async def send_web_push(
        self,
        subscription_info: Dict[str, Any],
        title: str,
        body: str,
        icon: Optional[str] = None,
        badge: Optional[str] = None,
        image: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None,
        actions: Optional[List[Dict[str, str]]] = None,
        max_retries: int = 3
    ) -> Dict[str, Any]:
        """
        Send Web Push notification (for browsers)
        
        Args:
            subscription_info: Push subscription object from browser
                {
                    "endpoint": "https://...",
                    "keys": {
                        "p256dh": "...",
                        "auth": "..."
                    }
                }
            title: Notification title
            body: Notification body
            icon: Icon URL
            badge: Badge icon URL
            image: Large image URL
            data: Custom data payload
            actions: Action buttons [{action, title, icon}]
            max_retries: Retry attempts
        
        Returns:
            Send result
        """
        # Validate
        if not subscription_info or not title or not body:
            return {"success": False, "error": "Missing required fields"}
        
        # Mock mode
        if self.mock_mode:
            logger.info(f"📲 [MOCK WEB PUSH] Title: {title}, Body: {body[:50]}...")
            return {
                "success": True,
                "mock": True,
                "title": title,
                "body": body,
                "actions": actions
            }
        
        # Prepare notification payload
        notification_payload = {
            "title": title,
            "body": body,
            "icon": icon or "/static/icons/icon-192x192.png",
            "badge": badge or "/static/icons/badge-72x72.png",
            "data": data or {},
            "requireInteraction": True,  # Keep notification visible
            "tag": data.get("tag", "wineops-notification") if data else "wineops-notification"
        }
        
        # Add image if provided
        if image:
            notification_payload["image"] = image
        
        # Add action buttons if provided
        if actions:
            notification_payload["actions"] = actions
        
        # Send with retries
        for attempt in range(max_retries):
            try:
                # Send via pywebpush
                response = await self._send_webpush(
                    subscription_info,
                    json.dumps(notification_payload)
                )
                
                self.total_sent += 1
                logger.info(f"✅ Web Push sent: {title}")
                
                return {
                    "success": True,
                    "title": title,
                    "attempt": attempt + 1,
                    "response": response
                }
                
            except WebPushException as e:
                logger.error(f"Web Push error (attempt {attempt + 1}/{max_retries}): {e}")
                
                # Check if subscription is invalid/expired
                if e.response and e.response.status_code in [404, 410]:
                    # Subscription no longer valid
                    return {
                        "success": False,
                        "error": "Subscription expired or invalid",
                        "status_code": e.response.status_code,
                        "should_unsubscribe": True
                    }
                
                # Retry on temporary errors
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    self.total_failed += 1
                    return {
                        "success": False,
                        "error": str(e),
                        "attempts": max_retries
                    }
            
            except Exception as e:
                logger.error(f"Unexpected error sending Web Push: {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    self.total_failed += 1
                    return {"success": False, "error": str(e)}
        
        return {"success": False, "error": "Max retries exceeded"}
    
    async def _send_webpush(
        self,
        subscription_info: Dict[str, Any],
        payload: str
    ) -> Dict[str, Any]:
        """Send Web Push via pywebpush (async wrapper)"""
        if not self.vapid_private_key or not self.vapid_public_key:
            raise Exception("VAPID keys not configured")
        
        # Run synchronous webpush in executor
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: webpush(
                subscription_info=subscription_info,
                data=payload,
                vapid_private_key=self.vapid_private_key,
                vapid_claims={
                    "sub": self.vapid_email or "mailto:admin@wineops.ai"
                }
            )
        )
        
        return {"status": "sent"}
    
    async def send_fcm_notification(
        self,
        device_token: str,
        title: str,
        body: str,
        data: Optional[Dict[str, Any]] = None,
        image: Optional[str] = None,
        actions: Optional[List[Dict[str, str]]] = None,
        max_retries: int = 3
    ) -> Dict[str, Any]:
        """
        Send Firebase Cloud Messaging notification (for mobile apps)
        
        Args:
            device_token: FCM device registration token
            title: Notification title
            body: Notification body
            data: Custom data payload
            image: Image URL
            actions: Action buttons (iOS/Android support varies)
            max_retries: Retry attempts
        
        Returns:
            Send result
        """
        # Validate
        if not device_token or not title or not body:
            return {"success": False, "error": "Missing required fields"}
        
        # Mock mode
        if self.mock_mode:
            logger.info(f"📲 [MOCK FCM] Title: {title}, Body: {body[:50]}...")
            return {
                "success": True,
                "mock": True,
                "title": title,
                "body": body,
                "device_token": device_token
            }
        
        if not self.fcm_server_key:
            return {"success": False, "error": "FCM not configured"}
        
        # Prepare FCM payload
        fcm_payload = {
            "to": device_token,
            "notification": {
                "title": title,
                "body": body,
                "sound": "default",
                "priority": "high"
            },
            "data": data or {},
            "priority": "high"
        }
        
        # Add image for Android
        if image:
            fcm_payload["notification"]["image"] = image
        
        # Send with retries
        for attempt in range(max_retries):
            try:
                response = await self.http_client.post(
                    "https://fcm.googleapis.com/fcm/send",
                    headers={
                        "Authorization": f"key={self.fcm_server_key}",
                        "Content-Type": "application/json"
                    },
                    json=fcm_payload
                )
                
                response.raise_for_status()
                result = response.json()
                
                # Check if device token is invalid
                if result.get("failure") == 1:
                    error_result = result.get("results", [{}])[0]
                    error = error_result.get("error")
                    
                    if error in ["NotRegistered", "InvalidRegistration"]:
                        return {
                            "success": False,
                            "error": error,
                            "should_unregister": True
                        }
                
                self.total_sent += 1
                logger.info(f"✅ FCM notification sent: {title}")
                
                return {
                    "success": True,
                    "title": title,
                    "message_id": result.get("results", [{}])[0].get("message_id"),
                    "attempt": attempt + 1
                }
                
            except httpx.HTTPStatusError as e:
                logger.error(f"FCM HTTP error (attempt {attempt + 1}/{max_retries}): {e}")
                
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    self.total_failed += 1
                    return {
                        "success": False,
                        "error": str(e),
                        "status_code": e.response.status_code
                    }
            
            except Exception as e:
                logger.error(f"FCM error: {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    self.total_failed += 1
                    return {"success": False, "error": str(e)}
        
        return {"success": False, "error": "Max retries exceeded"}
    
    async def send_approval_notification(
        self,
        subscription_or_token: Dict[str, Any],
        notification_type: str,  # "web_push" or "fcm"
        order_id: str,
        wine_name: str,
        provider_name: str,
        quantity: int,
        final_price: float,
        approve_url: str,
        reject_url: str,
        conversation_summary: str
    ) -> Dict[str, Any]:
        """
        Send order approval notification with action buttons
        
        This is the core one-tap approval notification
        
        Args:
            subscription_or_token: Push subscription (Web Push) or device token (FCM)
            notification_type: "web_push" or "fcm"
            order_id: Order ID
            wine_name: Wine name
            provider_name: Provider name
            quantity: Quantity
            final_price: Final negotiated price
            approve_url: Approval action URL
            reject_url: Rejection action URL
            conversation_summary: Summary text
        
        Returns:
            Send result
        """
        title = "🍷 Order Requires Approval"
        body = f"{wine_name} - {quantity} bottles from {provider_name} at ${final_price}/bottle"
        
        # Define action buttons
        actions = [
            {
                "action": "approve",
                "title": "✅ Approve",
                "icon": "/static/icons/approve.png"
            },
            {
                "action": "reject",
                "title": "❌ Reject",
                "icon": "/static/icons/reject.png"
            },
            {
                "action": "view",
                "title": "👁️ View Details",
                "icon": "/static/icons/view.png"
            }
        ]
        
        # Custom data payload
        data = {
            "type": "order_approval",
            "order_id": order_id,
            "wine_name": wine_name,
            "provider_name": provider_name,
            "quantity": quantity,
            "final_price": final_price,
            "approve_url": approve_url,
            "reject_url": reject_url,
            "conversation_summary": conversation_summary[:200] + "..." if len(conversation_summary) > 200 else conversation_summary,
            "tag": f"order-{order_id}"
        }
        
        if notification_type == "web_push":
            return await self.send_web_push(
                subscription_info=subscription_or_token,
                title=title,
                body=body,
                icon="/static/icons/wine-icon.png",
                data=data,
                actions=actions
            )
        elif notification_type == "fcm":
            return await self.send_fcm_notification(
                device_token=subscription_or_token,
                title=title,
                body=body,
                data=data,
                actions=actions
            )
        else:
            return {"success": False, "error": f"Unknown notification type: {notification_type}"}
    
    async def send_low_stock_notification(
        self,
        subscription_or_token: Dict[str, Any],
        notification_type: str,
        wine_name: str,
        current_stock: int,
        threshold: int,
        estimated_stockout_days: float,
        reorder_url: str
    ) -> Dict[str, Any]:
        """Send low stock alert notification"""
        title = "🚨 Low Stock Alert"
        body = f"{wine_name} - Only {current_stock} bottles left (Est. stockout: {estimated_stockout_days:.1f} days)"
        
        actions = [
            {
                "action": "reorder",
                "title": "🛒 Reorder Now",
                "icon": "/static/icons/cart.png"
            },
            {
                "action": "view",
                "title": "👁️ View Inventory",
                "icon": "/static/icons/view.png"
            }
        ]
        
        data = {
            "type": "low_stock_alert",
            "wine_name": wine_name,
            "current_stock": current_stock,
            "threshold": threshold,
            "estimated_stockout_days": estimated_stockout_days,
            "reorder_url": reorder_url,
            "tag": f"low-stock-{wine_name}"
        }
        
        if notification_type == "web_push":
            return await self.send_web_push(
                subscription_info=subscription_or_token,
                title=title,
                body=body,
                icon="/static/icons/alert.png",
                badge="/static/icons/badge-alert.png",
                data=data,
                actions=actions
            )
        else:
            return await self.send_fcm_notification(
                device_token=subscription_or_token,
                title=title,
                body=body,
                data=data,
                actions=actions
            )
    
    def get_stats(self) -> Dict[str, Any]:
        """Get push notification statistics"""
        return {
            "total_sent": self.total_sent,
            "total_failed": self.total_failed,
            "success_rate": (self.total_sent / (self.total_sent + self.total_failed) * 100) if (self.total_sent + self.total_failed) > 0 else 0,
            "web_push_configured": bool(self.vapid_private_key and self.vapid_public_key),
            "fcm_configured": bool(self.fcm_server_key),
            "mock_mode": self.mock_mode
        }
    
    async def cleanup(self):
        """Cleanup resources"""
        await self.http_client.aclose()

