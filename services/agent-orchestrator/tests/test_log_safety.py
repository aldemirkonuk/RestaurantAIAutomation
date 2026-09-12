"""CodeQL py/log-injection — request-derived values must not be able to forge log entries."""

import logging

from services.log_safety import sanitize_for_log


class TestSanitizeForLog:
    def test_newline_cannot_open_a_second_entry(self):
        forged = "victim\nERROR:root:cap bypassed for attacker"
        cleaned = sanitize_for_log(forged)
        assert "\n" not in cleaned
        assert cleaned.startswith("victim\\n")

    def test_carriage_return_is_escaped(self):
        assert "\r" not in sanitize_for_log("a\rb")

    def test_backslash_escaped_first_so_literal_n_is_not_spoofable(self):
        # Without escaping the backslash first, an input containing a literal
        # backslash-n would be indistinguishable from an escaped real newline.
        assert sanitize_for_log("a\\nb") == "a\\\\nb"

    def test_truncates(self):
        assert len(sanitize_for_log("x" * 1000)) == 128
        assert len(sanitize_for_log("x" * 1000, max_len=10)) == 10

    def test_accepts_non_strings(self):
        assert sanitize_for_log(None) == "None"
        assert sanitize_for_log(42) == "42"


class TestOnboardingCallSites:
    """The three sites CodeQL flagged in api/onboarding_routes.py."""

    def test_all_flagged_sites_are_sanitized(self):
        import inspect
        import api.onboarding_routes as mod

        src = inspect.getsource(mod)
        # Each flagged logger call must pass its request-derived value through the helper.
        assert "sanitize_for_log(cap_key)" in src
        assert "sanitize_for_log(subject)" in src
        # And the f-string form — which cannot be sanitized by %-args — must be gone.
        assert 'f"All pages failed for restaurant {cap_key}' not in src

    def test_logger_output_is_single_line(self, caplog):
        logger = logging.getLogger("onboarding-test")
        with caplog.at_level(logging.ERROR):
            logger.error(
                "cap key lookup failed for user %s — failing CLOSED: %s",
                sanitize_for_log("evil\nERROR:root:forged"),
                "boom",
            )
        assert "\n" not in caplog.records[0].getMessage()
