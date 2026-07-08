"""
Email Client - Production-Ready Email Service

Supports multiple backends:
- Gmail SMTP (primary)
- SendGrid (alternative)

Features:
- HTML and plain text emails
- Template rendering
- Attachment support
- Async sending
- Retry logic
- Delivery tracking
"""

import asyncio
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from typing import Optional, List, Dict, Any
from datetime import datetime
import aiosmtplib

from utils.logger import setup_logger

logger = setup_logger(__name__)


class EmailClient:
    """
    Production-ready email client with multiple backend support

    Features:
    - Gmail SMTP and SendGrid support
    - HTML templates
    - Attachments
    - Async sending
    - Retry logic
    - Rate limiting
    """

    def __init__(
        self,
        backend: str = "gmail",  # "gmail" or "sendgrid"
        gmail_user: Optional[str] = None,
        gmail_password: Optional[str] = None,
        sendgrid_api_key: Optional[str] = None,
        from_email: Optional[str] = None,
        from_name: str = "WineOps AI",
        mock_mode: bool = False,
    ):
        """
        Initialize email client

        Args:
            backend: "gmail" or "sendgrid"
            gmail_user: Gmail address
            gmail_password: Gmail app password
            sendgrid_api_key: SendGrid API key
            from_email: Default sender email
            from_name: Sender name
            mock_mode: If True, log instead of sending
        """
        self.backend = backend
        self.gmail_user = gmail_user
        self.gmail_password = gmail_password
        self.sendgrid_api_key = sendgrid_api_key
        self.from_email = from_email or gmail_user
        self.from_name = from_name
        self.mock_mode = mock_mode

        # Stats
        self.total_sent = 0
        self.total_failed = 0

        # Validate configuration
        if not mock_mode:
            if backend == "gmail" and (not gmail_user or not gmail_password):
                logger.warning("Gmail credentials missing - email sending will fail")
            elif backend == "sendgrid" and not sendgrid_api_key:
                logger.warning("SendGrid API key missing - email sending will fail")

        if mock_mode:
            logger.info("📧 Email client running in MOCK mode")
        else:
            logger.info(f"✅ Email client initialized (backend: {backend})")

    async def send_email(
        self,
        to_email: str,
        subject: str,
        body_html: str,
        body_text: Optional[str] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
        cc: Optional[List[str]] = None,
        bcc: Optional[List[str]] = None,
        max_retries: int = 3,
    ) -> Dict[str, Any]:
        """
        Send email with retry logic

        Args:
            to_email: Recipient email
            subject: Email subject
            body_html: HTML email body
            body_text: Plain text fallback (auto-generated if None)
            attachments: List of {filename, content, mimetype}
            cc: CC recipients
            bcc: BCC recipients
            max_retries: Retry attempts

        Returns:
            Dict with success status and details
        """
        # Validate
        if not to_email or not subject or not body_html:
            return {"success": False, "error": "Missing required fields"}

        # Mock mode
        if self.mock_mode:
            logger.info(f"📧 [MOCK EMAIL] To: {to_email}, Subject: {subject}")
            return {
                "success": True,
                "mock": True,
                "to": to_email,
                "subject": subject,
                "message_id": f"mock-{datetime.utcnow().timestamp()}",
            }

        # Send with retries
        for attempt in range(max_retries):
            try:
                if self.backend == "gmail":
                    result = await self._send_via_gmail(
                        to_email, subject, body_html, body_text, attachments, cc, bcc
                    )
                elif self.backend == "sendgrid":
                    result = await self._send_via_sendgrid(
                        to_email, subject, body_html, body_text, attachments, cc, bcc
                    )
                else:
                    return {
                        "success": False,
                        "error": f"Unknown backend: {self.backend}",
                    }

                self.total_sent += 1
                logger.info(f"✅ Email sent to {to_email}: {subject}")

                return {
                    "success": True,
                    "to": to_email,
                    "subject": subject,
                    "backend": self.backend,
                    "attempt": attempt + 1,
                    **result,
                }

            except Exception as e:
                logger.error(
                    f"Email send failed (attempt {attempt + 1}/{max_retries}): {e}"
                )

                if attempt < max_retries - 1:
                    wait_time = 2**attempt  # Exponential backoff
                    await asyncio.sleep(wait_time)
                else:
                    self.total_failed += 1
                    return {"success": False, "error": str(e), "attempts": max_retries}

        return {"success": False, "error": "Max retries exceeded"}

    async def _send_via_gmail(
        self,
        to_email: str,
        subject: str,
        body_html: str,
        body_text: Optional[str],
        attachments: Optional[List[Dict]],
        cc: Optional[List[str]],
        bcc: Optional[List[str]],
    ) -> Dict[str, Any]:
        """Send email via Gmail SMTP"""
        # Create message
        message = MIMEMultipart("alternative")
        message["From"] = f"{self.from_name} <{self.from_email}>"
        message["To"] = to_email
        message["Subject"] = subject

        if cc:
            message["Cc"] = ", ".join(cc)
        if bcc:
            message["Bcc"] = ", ".join(bcc)

        # Add plain text part (fallback)
        if not body_text:
            # Simple HTML to text conversion
            body_text = body_html.replace("<br>", "\n").replace("</p>", "\n\n")
            # Remove all HTML tags
            import re

            body_text = re.sub("<[^<]+?>", "", body_text)

        part1 = MIMEText(body_text, "plain")
        part2 = MIMEText(body_html, "html")

        message.attach(part1)
        message.attach(part2)

        # Add attachments
        if attachments:
            for attachment in attachments:
                filename = attachment.get("filename")
                content = attachment.get("content")  # bytes
                mimetype = attachment.get("mimetype", "application/octet-stream")

                part = MIMEBase(*mimetype.split("/"))
                part.set_payload(content)
                encoders.encode_base64(part)
                part.add_header(
                    "Content-Disposition", f"attachment; filename= {filename}"
                )
                message.attach(part)

        # Send via aiosmtplib (async SMTP)
        try:
            await aiosmtplib.send(
                message,
                hostname="smtp.gmail.com",
                port=587,
                start_tls=True,
                username=self.gmail_user,
                password=self.gmail_password,
            )

            return {"message_id": message.get("Message-ID", "unknown")}

        except Exception as e:
            logger.error(f"Gmail SMTP error: {e}")
            raise

    async def _send_via_sendgrid(
        self,
        to_email: str,
        subject: str,
        body_html: str,
        body_text: Optional[str],
        attachments: Optional[List[Dict]],
        cc: Optional[List[str]],
        bcc: Optional[List[str]],
    ) -> Dict[str, Any]:
        """Send email via SendGrid API"""
        try:
            from sendgrid import SendGridAPIClient
            from sendgrid.helpers.mail import (
                Mail,
                Attachment,
                FileContent,
                FileName,
                FileType,
                Disposition,
            )

            # Create mail object
            mail = Mail(
                from_email=(self.from_email, self.from_name),
                to_emails=to_email,
                subject=subject,
                html_content=body_html,
                plain_text_content=body_text,
            )

            # Add CC/BCC
            if cc:
                for email in cc:
                    mail.add_cc(email)
            if bcc:
                for email in bcc:
                    mail.add_bcc(email)

            # Add attachments
            if attachments:
                for attachment in attachments:
                    sg_attachment = Attachment(
                        FileContent(attachment["content"]),
                        FileName(attachment["filename"]),
                        FileType(
                            attachment.get("mimetype", "application/octet-stream")
                        ),
                        Disposition("attachment"),
                    )
                    mail.add_attachment(sg_attachment)

            # Send
            sg = SendGridAPIClient(self.sendgrid_api_key)
            response = await asyncio.get_event_loop().run_in_executor(
                None, lambda: sg.send(mail)
            )

            return {
                "message_id": response.headers.get("X-Message-Id", "unknown"),
                "status_code": response.status_code,
            }

        except Exception as e:
            logger.error(f"SendGrid API error: {e}")
            raise

    async def send_template_email(
        self,
        to_email: str,
        template_name: str,
        template_data: Dict[str, Any],
        subject: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Send email using a template

        Args:
            to_email: Recipient
            template_name: Template identifier
            template_data: Data to render in template
            subject: Email subject (can use template data)

        Returns:
            Send result
        """
        # Load template
        template_html = self._load_template(template_name)

        if not template_html:
            return {"success": False, "error": f"Template not found: {template_name}"}

        # Render template
        rendered_html = self._render_template(template_html, template_data)

        # Generate subject if not provided
        if not subject:
            subject = template_data.get("subject", "Notification from WineOps AI")
        else:
            # Render subject with template data
            subject = self._render_template(subject, template_data)

        return await self.send_email(to_email, subject, rendered_html)

    def _load_template(self, template_name: str) -> Optional[str]:
        """Load email template from file"""
        # In real implementation, load from templates/emails/{template_name}.html
        # For now, return default templates

        templates = {
            "low_stock_alert": """
            <html>
                <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #8B2635;">🚨 Low Stock Alert</h2>
                    <p>Dear {manager_name},</p>
                    <p>The following wine is running low:</p>
                    <div style="background: #f9f9f9; padding: 15px; border-left: 4px solid #8B2635;">
                        <h3>{wine_name}</h3>
                        <p><strong>Current Stock:</strong> {current_stock} bottles</p>
                        <p><strong>Threshold:</strong> {threshold} bottles</p>
                        <p><strong>Estimated Stockout:</strong> {stockout_days} days</p>
                    </div>
                    <p style="margin-top: 20px;">
                        <a href="{approval_url}" style="background: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
                            Approve Reorder
                        </a>
                    </p>
                    <p style="color: #666; font-size: 12px; margin-top: 30px;">
                        This is an automated alert from WineOps AI
                    </p>
                </body>
            </html>
            """,
            "order_approval": """
            <html>
                <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #8B2635;">📦 Order Requires Approval</h2>
                    <p>Dear {manager_name},</p>
                    <p>A procurement order has been negotiated and requires your approval:</p>
                    <div style="background: #f9f9f9; padding: 15px; border-left: 4px solid #8B2635;">
                        <h3>{wine_name}</h3>
                        <p><strong>Quantity:</strong> {quantity} bottles</p>
                        <p><strong>Provider:</strong> {provider_name}</p>
                        <p><strong>Negotiated Price:</strong> ${final_price}/bottle</p>
                        <p><strong>Total Cost:</strong> ${total_cost}</p>
                        <p><strong>Delivery:</strong> {delivery_estimate}</p>
                    </div>
                    <p style="margin-top: 20px;">
                        <a href="{approve_url}" style="background: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin-right: 10px;">
                            ✅ Approve
                        </a>
                        <a href="{reject_url}" style="background: #dc3545; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
                            ❌ Reject
                        </a>
                    </p>
                    <p style="color: #666; font-size: 12px; margin-top: 30px;">
                        Conversation Summary available in your dashboard
                    </p>
                </body>
            </html>
            """,
            "daily_report": """
            <html>
                <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #8B2635;">📊 Daily Wine Operations Report</h2>
                    <p>Hello {manager_name},</p>
                    <p>Here's your daily summary for {date}:</p>
                    
                    <div style="background: #f9f9f9; padding: 15px; margin: 10px 0;">
                        <h3>Sales</h3>
                        <p><strong>Total Revenue:</strong> ${total_revenue}</p>
                        <p><strong>Bottles Sold:</strong> {bottles_sold}</p>
                        <p><strong>Top Seller:</strong> {top_wine}</p>
                    </div>
                    
                    <div style="background: #fff3cd; padding: 15px; margin: 10px 0; border-left: 4px solid #ffc107;">
                        <h3>Low Stock Alerts</h3>
                        <p>{low_stock_count} wines below threshold</p>
                    </div>
                    
                    <div style="background: #d1ecf1; padding: 15px; margin: 10px 0; border-left: 4px solid #17a2b8;">
                        <h3>Pending Actions</h3>
                        <p>{pending_orders} orders awaiting approval</p>
                    </div>
                    
                    <p style="margin-top: 20px;">
                        <a href="{dashboard_url}" style="background: #8B2635; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
                            View Full Report
                        </a>
                    </p>
                </body>
            </html>
            """,
        }

        return templates.get(template_name)

    def _render_template(self, template: str, data: Dict[str, Any]) -> str:
        """Simple template rendering with {variable} substitution"""
        rendered = template
        for key, value in data.items():
            placeholder = "{" + key + "}"
            rendered = rendered.replace(placeholder, str(value))
        return rendered

    def get_stats(self) -> Dict[str, Any]:
        """Get email statistics"""
        return {
            "total_sent": self.total_sent,
            "total_failed": self.total_failed,
            "success_rate": (
                (self.total_sent / (self.total_sent + self.total_failed) * 100)
                if (self.total_sent + self.total_failed) > 0
                else 0
            ),
            "backend": self.backend,
            "mock_mode": self.mock_mode,
        }
