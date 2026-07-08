"""
Spend monitoring Celery tasks (COST-02).
Hourly Celery beat task — checks monthly cumulative spend against provider caps.

Thresholds (80% of hard caps per CONTEXT.md):
  - Anthropic: $40.00  (80% of $50)
  - Google:    $16.00  (80% of $20)

On breach: sends alert email to MANAGER_EMAIL and records alert in spend_alert_state
to suppress duplicate alerts for the same provider+month.
"""

import logging
import smtplib
from datetime import datetime, timezone
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from jobs.celery_app import celery_app

logger = logging.getLogger(__name__)

# Monthly spend cap thresholds (80% of hard cap)
MONTHLY_CAP_THRESHOLDS = {
    "anthropic": 40.00,
    "google": 16.00,
}


def _get_current_month() -> str:
    """Return current UTC month as 'YYYY-MM' string."""
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _get_monthly_spend(supabase, provider: str, month: str) -> float:
    """Sum cost_usd from api_spend for a given provider in a given month."""
    try:
        month_start = f"{month}-01T00:00:00+00:00"
        # Get next month start
        year, mon = map(int, month.split("-"))
        if mon == 12:
            next_month = f"{year + 1}-01-01T00:00:00+00:00"
        else:
            next_month = f"{year}-{mon + 1:02d}-01T00:00:00+00:00"

        resp = (
            supabase.table("api_spend")
            .select("cost_usd")
            .eq("provider", provider)
            .gte("timestamp", month_start)
            .lt("timestamp", next_month)
            .execute()
        )
        if resp.data:
            return sum(row.get("cost_usd", 0.0) or 0.0 for row in resp.data)
        return 0.0
    except Exception as exc:
        logger.warning("Could not query monthly spend for %s: %s", provider, exc)
        return 0.0


def _already_alerted(supabase, provider: str, month: str) -> bool:
    """Return True if an alert was already sent for this provider+month."""
    try:
        resp = (
            supabase.table("spend_alert_state")
            .select("last_alert_month")
            .eq("provider", provider)
            .maybe_single()
            .execute()
        )
        if resp.data and resp.data.get("last_alert_month") == month:
            return True
        return False
    except Exception as exc:
        logger.warning("Could not check alert state for %s: %s", provider, exc)
        return False


def _record_alert(supabase, provider: str, month: str) -> None:
    """Upsert spend_alert_state row to suppress duplicate alerts."""
    try:
        supabase.table("spend_alert_state").upsert(
            {
                "provider": provider,
                "last_alert_month": month,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="provider",
        ).execute()
    except Exception as exc:
        logger.warning("Could not record alert state for %s: %s", provider, exc)


def _send_alert_email(
    settings,
    provider: str,
    month: str,
    spend: float,
    threshold: float,
) -> None:
    """Send cap alert email via Gmail SMTP. Non-fatal."""
    if not all([settings.manager_email, settings.gmail_user, settings.gmail_password]):
        logger.info("Email credentials not configured — skipping alert email")
        return
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"[WineOps] API Spend Alert — {provider.capitalize()} {month}"
        msg["From"] = settings.gmail_user
        msg["To"] = settings.manager_email

        body = (
            f"Monthly API spend alert for {provider.capitalize()}.\n\n"
            f"Month: {month}\n"
            f"Current spend: ${spend:.4f}\n"
            f"Threshold (80% cap): ${threshold:.2f}\n\n"
            f"Action: Review usage at Supabase → api_spend table.\n"
            f"Hard cap is ${threshold / 0.8:.2f}. Spending will continue until hard cap.\n"
        )
        msg.attach(MIMEText(body, "plain"))

        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=10) as server:
            server.login(settings.gmail_user, settings.gmail_password)
            server.sendmail(
                settings.gmail_user, settings.manager_email, msg.as_string()
            )

        logger.info(
            "Cap alert email sent for %s/%s (spend=%.4f)", provider, month, spend
        )
    except Exception as exc:
        logger.warning("Failed to send cap alert email: %s", exc)


@celery_app.task(name="spend.monthly_cap_check", bind=True, max_retries=0)
def monthly_cap_check_task(self):
    """
    Hourly Celery beat task — checks monthly cumulative spend against provider caps.
    Idempotent: sends at most one alert per provider per calendar month.
    """
    try:
        from config.settings import get_settings

        settings = get_settings()
        if not settings.supabase_url or not settings.supabase_key:
            logger.debug("Supabase not configured — skipping monthly cap check")
            return

        from supabase import create_client

        supabase = create_client(settings.supabase_url, settings.supabase_key)

        month = _get_current_month()

        for provider, threshold in MONTHLY_CAP_THRESHOLDS.items():
            spend = _get_monthly_spend(supabase, provider, month)
            logger.debug(
                "Monthly spend check: provider=%s month=%s spend=%.4f threshold=%.2f",
                provider,
                month,
                spend,
                threshold,
            )

            if spend >= threshold:
                if _already_alerted(supabase, provider, month):
                    logger.debug(
                        "Alert already sent for %s/%s — suppressing", provider, month
                    )
                    continue

                logger.warning(
                    "COST CAP BREACH: provider=%s month=%s spend=%.4f >= threshold=%.2f",
                    provider,
                    month,
                    spend,
                    threshold,
                )
                _send_alert_email(settings, provider, month, spend, threshold)
                _record_alert(supabase, provider, month)

    except Exception as exc:
        logger.error("monthly_cap_check_task failed (non-fatal): %s", exc)
