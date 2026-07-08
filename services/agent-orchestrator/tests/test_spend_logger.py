"""Tests for SpendLogger service (COST-01)."""

from unittest.mock import MagicMock, patch


def test_log_calls_supabase_insert_with_correct_payload():
    """SpendLogger.log() inserts row with all required fields."""
    mock_supabase = MagicMock()
    mock_supabase.table.return_value.insert.return_value.execute.return_value = (
        MagicMock()
    )

    with patch("services.spend_logger.get_settings") as mock_settings, patch(
        "supabase.create_client", return_value=mock_supabase
    ):
        mock_settings.return_value.supabase_url = "https://test.supabase.co"
        mock_settings.return_value.supabase_key = "test-key"

        from services.spend_logger import SpendLogger

        logger = SpendLogger()
        logger.log(
            provider="anthropic",
            model="claude-haiku-4-5-20251001",
            input_tokens=1024,
            output_tokens=256,
            cost_usd=0.00042,
            restaurant_id="abc-123",
        )

    call_args = mock_supabase.table.return_value.insert.call_args[0][0]
    assert call_args["provider"] == "anthropic"
    assert call_args["model"] == "claude-haiku-4-5-20251001"
    assert call_args["input_tokens"] == 1024
    assert call_args["output_tokens"] == 256
    assert call_args["cost_usd"] == 0.00042
    assert call_args["restaurant_id"] == "abc-123"
    assert "timestamp" in call_args


def test_log_returns_none_when_supabase_not_configured():
    """SpendLogger.log() returns without raising if Supabase not configured."""
    with patch("services.spend_logger.get_settings") as mock_settings:
        mock_settings.return_value.supabase_url = None
        mock_settings.return_value.supabase_key = None

        from services.spend_logger import SpendLogger

        logger = SpendLogger()
        result = logger.log(
            provider="anthropic",
            model="test",
            input_tokens=0,
            output_tokens=0,
            cost_usd=0.0,
        )
    assert result is None


def test_log_does_not_raise_on_supabase_exception():
    """SpendLogger.log() catches all exceptions — never crashes the pipeline."""
    with patch("services.spend_logger.get_settings") as mock_settings, patch(
        "supabase.create_client"
    ) as mock_create:
        mock_settings.return_value.supabase_url = "https://test.supabase.co"
        mock_settings.return_value.supabase_key = "test-key"
        mock_create.side_effect = Exception("Supabase connection refused")

        from services.spend_logger import SpendLogger

        logger = SpendLogger()
        # Must NOT raise
        logger.log(
            provider="google",
            model="gemini-2.5-flash",
            input_tokens=100,
            output_tokens=50,
            cost_usd=0.001,
        )


def test_get_spend_logger_returns_singleton():
    """get_spend_logger() returns the same instance on repeated calls."""
    import services.spend_logger as mod

    # Reset singleton
    mod._spend_logger = None

    from services.spend_logger import get_spend_logger

    a = get_spend_logger()
    b = get_spend_logger()
    assert a is b


def test_settings_has_manager_email_attribute():
    """Settings exposes manager_email, gmail_user, gmail_password from env vars."""
    import os

    os.environ["MANAGER_EMAIL"] = "manager@test.com"
    os.environ["GMAIL_USER"] = "sender@test.com"
    os.environ["GMAIL_PASSWORD"] = "secret"

    import importlib
    import config.settings as mod

    importlib.reload(mod)
    from config.settings import Settings

    s = Settings()
    assert s.manager_email == "manager@test.com"
    assert s.gmail_user == "sender@test.com"
    assert s.gmail_password == "secret"
