"""
Regression tests for the security fixes recorded in ADR 0100.

Each test names the CodeQL alert it closes. They are written to fail against
the pre-fix tree: a guard that passes whether or not the fix is present proves
nothing about the fix.
"""

import time

import pytest

from services.log_safety import sanitize_for_log
from utils.safe_fetch import SsrfBlocked, assert_url_is_safe
from services.template_engine import TemplateEngine


# ---------------------------------------------------------------------------
# CodeQL 1, 2 — py/full-ssrf (critical)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        # The payload that motivated the fix: AWS/GCP link-local metadata.
        "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
        "http://127.0.0.1:8000/internal",
        "http://localhost/admin",
        "http://[::1]/admin",
        "http://10.0.0.5/",
        "http://192.168.1.1/",
        "http://172.16.0.1/",
        "http://0.0.0.0/",
        # IPv4-mapped IPv6 form of the metadata address — plain `is_global`
        # on the v6 object does not catch this one.
        "http://[::ffff:169.254.169.254]/",
    ],
)
def test_ssrf_guard_blocks_internal_targets(url):
    with pytest.raises(SsrfBlocked):
        assert_url_is_safe(url)


@pytest.mark.parametrize(
    "url",
    ["file:///etc/passwd", "gopher://x/", "ftp://x/", "data:text/plain,x"],
)
def test_ssrf_guard_blocks_non_http_schemes(url):
    with pytest.raises(SsrfBlocked):
        assert_url_is_safe(url)


def test_ssrf_guard_allows_public_https():
    # example.com is IANA-reserved for documentation and resolves publicly.
    assert_url_is_safe("https://example.com/menu.png")


# ---------------------------------------------------------------------------
# CodeQL 855 — py/template-injection (critical)
# ---------------------------------------------------------------------------


def test_jinja_environment_is_sandboxed():
    """
    The classic SSTI escape must be refused. `render(use_jinja=True)` compiles
    a caller-supplied template string, so an unsandboxed Environment here is
    remote code execution, not merely information disclosure.
    """
    engine = TemplateEngine()
    payload = "{{ ''.__class__.__mro__[1].__subclasses__() }}"

    with pytest.raises(Exception) as excinfo:
        engine.render(payload, {}, use_jinja=True, strict=True)

    # SecurityError is what the sandbox raises for a blocked attribute walk.
    assert (
        "SecurityError" in type(excinfo.value).__name__
        or "unsafe" in str(excinfo.value).lower()
    )


def test_sandbox_still_renders_ordinary_templates():
    """The sandbox must not break legitimate provider-communication templates."""
    engine = TemplateEngine()
    out = engine.render(
        "Hello {{ name }}, {{ n }} cases ready.",
        {"name": "Vine Quarter", "n": 3},
        use_jinja=True,
    )
    assert out == "Hello Vine Quarter, 3 cases ready."


# ---------------------------------------------------------------------------
# CodeQL 853, 854 — py/polynomial-redos
# ---------------------------------------------------------------------------


def test_variable_pattern_is_linear_on_unmatched_braces():
    """
    The old pattern `\\{([^}]+)\\}` rescanned to end-of-string from every `{`,
    so work grew ~4x per doubling of input. Assert the growth is flat, not the
    absolute time, so the test is not a machine-speed benchmark.
    """
    engine = TemplateEngine()

    def elapsed(n):
        payload = "{" * n
        start = time.perf_counter()
        engine.validate_template(payload)
        return time.perf_counter() - start

    small = elapsed(4000)
    large = elapsed(16000)

    # 4x the input. Quadratic would be ~16x; linear is ~4x. Allow generous
    # slack for timer noise while still failing the pre-fix quadratic curve.
    assert large < max(small * 8, 0.05), (
        f"validate_template looks super-linear: 4000 chars {small:.4f}s, "
        f"16000 chars {large:.4f}s"
    )


def test_variable_pattern_still_extracts_variables():
    engine = TemplateEngine()
    result = engine.validate_template("Hi {name}, order {order_id|none} ready")
    assert set(result["variables"]) == {"name", "order_id"}


# ---------------------------------------------------------------------------
# CodeQL 1214-1216, 1188, 1035, 1036 — py/log-injection
# ---------------------------------------------------------------------------


def test_sanitize_for_log_escapes_newlines():
    forged = "ok\n2026-01-01 00:00:00 - x - INFO - Deleted template: production"
    out = sanitize_for_log(forged)
    assert "\n" not in out
    assert "\\n" in out
    assert "\r" not in sanitize_for_log("a\rb")


def test_sanitize_for_log_truncates():
    assert len(sanitize_for_log("x" * 5000)) == 128


def test_sanitize_for_log_leaves_ordinary_values_intact():
    assert sanitize_for_log("Vine Quarter") == "Vine Quarter"
    assert sanitize_for_log(42) == "42"


def test_template_engine_sanitizes_the_names_it_logs():
    """
    The three logger.info calls in MessageTemplateManager interpolate
    caller-supplied `name`, `category` and `template_id`. Assert the module
    routes them through the shared sanitiser rather than f-stringing them raw,
    so a later edit that drops the call is visible here.
    """
    import inspect

    from services import template_engine as te

    source = inspect.getsource(te)
    for fragment in (
        "Created template: {sanitize_for_log(name)}",
        "(category: {sanitize_for_log(category)})",
        "Updated template: {sanitize_for_log(template_id)}",
        "Deleted template: {sanitize_for_log(template_id)}",
    ):
        assert fragment in source, f"unsanitised log interpolation: {fragment}"
