"""Tests for SpendLogger (COST-01) + Neural Footprint dual-write (P1, ADR 0008)."""

import asyncio
from unittest.mock import MagicMock, patch

import pytest

from utils.logger import clear_log_context, get_log_context, set_log_context


def _capturing_supabase():
    """Mock supabase client that records insert payloads per table name."""
    rows = {}
    client = MagicMock()

    def table(name):
        t = MagicMock()

        def insert(payload):
            rows.setdefault(name, []).append(payload)
            return t

        t.insert.side_effect = insert
        t.execute.return_value = MagicMock()
        return t

    client.table.side_effect = table
    return client, rows


@pytest.fixture(autouse=True)
def _clean_context():
    clear_log_context()
    yield
    clear_log_context()


def _patched_settings(supabase_client):
    p = patch("services.spend_logger.get_settings")
    mock = p.start()
    mock.return_value.supabase_client = supabase_client
    return p


def test_log_dual_writes_api_spend_and_neural_footprint():
    """One .log() call inserts BOTH the api_spend row and the NF row."""
    client, rows = _capturing_supabase()
    p = _patched_settings(client)
    try:
        from services.spend_logger import SpendLogger

        SpendLogger().log(
            provider="anthropic",
            model="claude-haiku-4-5-20251001",
            input_tokens=1024,
            output_tokens=256,
            cost_usd=0.00042,
            restaurant_id="7c9e6679-7425-40de-944b-e07fc1f90ae7",
            agent="provider_communication_agent",
            task_type="email_draft",
            choice="draft:parsed",
            outcome="success",
            correlation_id="corr-123",
            context={"order_id": "o-1"},
        )
    finally:
        p.stop()

    spend = rows["api_spend"][0]
    assert spend["provider"] == "anthropic"
    assert spend["model"] == "claude-haiku-4-5-20251001"
    assert spend["input_tokens"] == 1024
    assert spend["output_tokens"] == 256
    assert spend["cost_usd"] == 0.00042
    assert spend["restaurant_id"] == "7c9e6679-7425-40de-944b-e07fc1f90ae7"
    assert "timestamp" in spend

    nf = rows["neural_footprint_event"][0]
    assert nf["subject_type"] == "agent"
    assert nf["subject_id"] == "provider_communication_agent"
    assert nf["stimulus"] == "email_draft"
    assert nf["choice"] == "draft:parsed"
    assert nf["outcome"] == "success"
    assert nf["correlation_id"] == "corr-123"
    assert nf["cost_usd"] == 0.00042
    assert nf["context"]["outcome_basis"] == "call_level_v0"
    assert nf["context"]["order_id"] == "o-1"
    assert nf["context"]["provider"] == "anthropic"
    assert nf["context"]["task_type"] == "email_draft"


def test_legacy_positional_call_still_emits_both_rows():
    """The pre-P1 call shape (no keywords) breaks nothing and still emits NF."""
    client, rows = _capturing_supabase()
    p = _patched_settings(client)
    try:
        from services.spend_logger import SpendLogger

        SpendLogger().log(
            provider="google",
            model="gemini-2.5-flash",
            input_tokens=100,
            output_tokens=50,
            cost_usd=0.001,
        )
    finally:
        p.stop()

    assert len(rows["api_spend"]) == 1
    nf = rows["neural_footprint_event"][0]
    assert nf["subject_id"] == "unknown"  # no agent, no ambient, no fallback
    assert nf["stimulus"] == "google:gemini-2.5-flash"
    assert nf["choice"] == "completion"
    assert nf["outcome"] is None  # unknown, NEVER success


def test_ambient_context_supplies_subject_and_correlation():
    """Contextvars set by BaseAgent/Celery hook flow into the NF row."""
    client, rows = _capturing_supabase()
    p = _patched_settings(client)
    try:
        from services.spend_logger import SpendLogger

        set_log_context(agent_name="score_agent", correlation_id="task-42")
        SpendLogger().log(
            provider="serper",
            model="serper-search",
            input_tokens=0,
            output_tokens=0,
            cost_usd=0.001,
            agent_fallback="some_service",
        )
    finally:
        p.stop()

    nf = rows["neural_footprint_event"][0]
    assert nf["subject_id"] == "score_agent"  # ambient beats agent_fallback
    assert nf["correlation_id"] == "task-42"


def test_explicit_agent_beats_ambient():
    client, rows = _capturing_supabase()
    p = _patched_settings(client)
    try:
        from services.spend_logger import SpendLogger

        set_log_context(agent_name="ambient_agent", correlation_id="c-1")
        SpendLogger().log(
            provider="serper",
            model="serper-search",
            input_tokens=0,
            output_tokens=0,
            cost_usd=0.001,
            agent="explicit_agent",
        )
    finally:
        p.stop()

    assert rows["neural_footprint_event"][0]["subject_id"] == "explicit_agent"


def test_invalid_outcome_degrades_to_null_not_success():
    """Bad outcome values must become NULL (unknown) with the raw value kept."""
    client, rows = _capturing_supabase()
    p = _patched_settings(client)
    try:
        from services.spend_logger import SpendLogger

        SpendLogger().log(
            provider="google",
            model="gemini-2.5-flash",
            input_tokens=1,
            output_tokens=1,
            cost_usd=0.0,
            outcome="great_success",  # not in the CHECK constraint
        )
    finally:
        p.stop()

    nf = rows["neural_footprint_event"][0]
    assert nf["outcome"] is None
    assert nf["context"]["outcome_invalid"] == "great_success"
    assert "outcome_basis" not in nf["context"]


def test_non_uuid_restaurant_id_diverted_to_context():
    """Garbage in the uuid column is nulled and preserved in context."""
    client, rows = _capturing_supabase()
    p = _patched_settings(client)
    try:
        from services.spend_logger import SpendLogger

        SpendLogger().log(
            provider="google",
            model="gemini-2.5-flash",
            input_tokens=1,
            output_tokens=1,
            cost_usd=0.0,
            restaurant_id="not-a-uuid",
        )
    finally:
        p.stop()

    nf = rows["neural_footprint_event"][0]
    assert nf["restaurant_id"] is None
    assert nf["context"]["restaurant_ref"] == "not-a-uuid"


def test_api_spend_failure_does_not_cost_the_nf_row_and_is_counted():
    """Each insert has its own try/except; drops are counted, never raised."""
    from services import neural_footprint as nf_mod

    rows = {}
    client = MagicMock()

    def table(name):
        t = MagicMock()
        if name == "api_spend":
            t.insert.side_effect = Exception("api_spend down")
        else:

            def insert(payload):
                rows.setdefault(name, []).append(payload)
                return t

            t.insert.side_effect = insert
            t.execute.return_value = MagicMock()
        return t

    client.table.side_effect = table

    before = nf_mod.get_drop_counts()["api_spend"]
    p = _patched_settings(client)
    try:
        from services.spend_logger import SpendLogger

        SpendLogger().log(  # must NOT raise
            provider="google",
            model="gemini-2.5-flash",
            input_tokens=1,
            output_tokens=1,
            cost_usd=0.0,
        )
    finally:
        p.stop()

    assert nf_mod.get_drop_counts()["api_spend"] == before + 1
    assert len(rows["neural_footprint_event"]) == 1  # NF row survived


def test_log_does_not_raise_when_everything_is_down():
    from services import neural_footprint as nf_mod

    client = MagicMock()
    client.table.side_effect = Exception("supabase gone")

    before = nf_mod.get_drop_counts()
    p = _patched_settings(client)
    try:
        from services.spend_logger import SpendLogger

        SpendLogger().log(
            provider="google",
            model="gemini-2.5-flash",
            input_tokens=100,
            output_tokens=50,
            cost_usd=0.001,
        )
    finally:
        p.stop()

    after = nf_mod.get_drop_counts()
    assert after["api_spend"] == before["api_spend"] + 1
    assert after["neural_footprint_event"] == before["neural_footprint_event"] + 1


def test_log_returns_none_when_supabase_not_configured():
    """SpendLogger.log() returns without raising if Supabase not configured."""
    p = _patched_settings(None)
    try:
        from services.spend_logger import SpendLogger

        result = SpendLogger().log(
            provider="anthropic",
            model="test",
            input_tokens=0,
            output_tokens=0,
            cost_usd=0.0,
        )
    finally:
        p.stop()
    assert result is None


def test_new_params_are_keyword_only():
    """P1 params must be keyword-only so positional call sites can never drift."""
    import inspect

    from services.spend_logger import SpendLogger

    sig = inspect.signature(SpendLogger.log)
    for name in (
        "agent",
        "agent_fallback",
        "task_type",
        "stimulus",
        "choice",
        "outcome",
        "duration_ms",
        "correlation_id",
        "context",
    ):
        param = sig.parameters[name]
        assert param.kind is inspect.Parameter.KEYWORD_ONLY
        assert param.default is None


def test_get_spend_logger_returns_singleton():
    """get_spend_logger() returns the same instance on repeated calls.

    Restores the module global afterwards. Without this the instance built here
    leaks into every later test in the session — it made
    test_vlm_training_store_wiring fail in the full suite while passing alone,
    which is the worst shape a test failure can take.
    """
    import services.spend_logger as mod

    original = mod._spend_logger
    try:
        mod._spend_logger = None
        from services.spend_logger import get_spend_logger

        a = get_spend_logger()
        b = get_spend_logger()
        assert a is b
    finally:
        mod._spend_logger = original


def test_estimate_llm_cost_known_and_unknown_models():
    from services.spend_logger import estimate_llm_cost

    # 1.00/5.00 per 1M — verified 2026-08-24 against Anthropic's pricing page.
    # This previously asserted 0.80 + 4.00, which is Claude Haiku *3.5*'s retired
    # rate; the repo calls claude-haiku-4-5-20251001, so spend read 20% low.
    haiku = estimate_llm_cost("claude-haiku-4-5-20251001", 1_000_000, 1_000_000)
    assert haiku == pytest.approx(1.00 + 5.00)
    # 0.30/1M in — verified 2026-08-24 against ai.google.dev pricing. This
    # previously asserted 0.075, which encoded the retired 2.0-flash rate and
    # understated real 2.5-flash spend 4x on input, 8.3x on output.
    flash = estimate_llm_cost("gemini-2.5-flash", 1_000_000, 0)
    assert flash == pytest.approx(0.30)
    assert estimate_llm_cost("mystery-model-9000", 1000, 1000) == 0.0


def test_lite_models_are_not_priced_as_full_flash():
    """Longest match wins: 'gemini-2.5-flash' is a substring of the -lite id, so
    insertion-order lookup billed every lite call at full-flash rates."""
    from services.spend_logger import estimate_llm_cost

    assert estimate_llm_cost("gemini-2.5-flash-lite", 1_000_000, 0) == pytest.approx(
        0.10
    )
    assert estimate_llm_cost("gemini-2.5-flash-lite", 0, 1_000_000) == pytest.approx(
        0.40
    )
    assert estimate_llm_cost("gemini-3.5-flash-lite", 0, 1_000_000) == pytest.approx(
        2.50
    )
    # ...and the non-lite id must still resolve to the full-flash rate.
    assert estimate_llm_cost("gemini-3.5-flash", 0, 1_000_000) == pytest.approx(9.00)


def test_is_priced_model_separates_unknown_from_free():
    from services.spend_logger import is_priced_model

    assert is_priced_model("gemini-3.5-flash-lite") is True
    assert is_priced_model("claude-haiku-4-5-20251001") is True
    assert is_priced_model("gemini-9.9-unreleased") is False
    assert is_priced_model("") is False


def test_usage_tokens_counts_thinking_as_output():
    """Google bills thoughts_token_count at the output rate but reports it
    separately; reading candidates alone undercounted output up to 9x."""
    from services.spend_logger import usage_tokens

    class _Usage:
        prompt_token_count = 317
        candidates_token_count = 76
        thoughts_token_count = 606

    class _Resp:
        usage_metadata = _Usage()

    assert usage_tokens(_Resp()) == (317, 682)

    class _NoThoughts:
        prompt_token_count = 10
        candidates_token_count = 5
        thoughts_token_count = None

    class _Resp2:
        usage_metadata = _NoThoughts()

    assert usage_tokens(_Resp2()) == (10, 5)

    class _Bare:
        usage_metadata = None

    assert usage_tokens(_Bare()) == (0, 0)


def test_unpriced_model_books_null_cost_not_false_zero():
    """An unpriced model must not book $0.00 as if the call were free — BOTH
    ledgers record NULL, and NF additionally records why."""
    client, rows = _capturing_supabase()
    p = _patched_settings(client)
    try:
        from services.spend_logger import SpendLogger

        SpendLogger().log(
            provider="google",
            model="gemini-9.9-unreleased",
            input_tokens=100,
            output_tokens=50,
            cost_usd=0.0,
            agent="test_agent",
        )
    finally:
        p.stop()

    nf = rows["neural_footprint_event"][0]
    assert nf["cost_usd"] is None
    assert nf["context"]["cost_basis"] == "unpriced_model"
    # OD-61: api_spend.cost_usd used to be NOT NULL, so the PRIMARY ledger kept
    # the false zero after NF had stopped booking one. The column is nullable as
    # of 20260825160000_api_spend_cost_usd_nullable.sql and both agree now.
    assert rows["api_spend"][0]["cost_usd"] is None


def test_serper_flat_fee_is_never_nulled_as_unpriced():
    """Serper bills a flat configured per-query fee, not per token. Judging it
    against the LLM rate table would delete real, exactly-known spend from NF and
    label it unknown — the same defect the unpriced guard exists to prevent."""
    client, rows = _capturing_supabase()
    p = _patched_settings(client)
    try:
        from services.spend_logger import SpendLogger

        SpendLogger().log(
            provider="serper",
            model="serper-search",
            input_tokens=0,
            output_tokens=0,
            cost_usd=0.001,
            agent="score_agent",
        )
    finally:
        p.stop()

    nf = rows["neural_footprint_event"][0]
    assert nf["cost_usd"] == pytest.approx(0.001)
    assert "cost_basis" not in nf["context"]


def test_is_priced_model_is_about_the_token_table_not_the_provider():
    """Guards the predicate itself: serper ids are legitimately absent from the
    per-token table, which is why the log() guard must gate on provider."""
    from services.spend_logger import is_priced_model

    assert is_priced_model("serper-search") is False
    assert is_priced_model("search") is False
    assert is_priced_model(None) is False


def test_priced_model_keeps_cost_and_carries_no_basis_marker():
    client, rows = _capturing_supabase()
    p = _patched_settings(client)
    try:
        from services.spend_logger import SpendLogger

        SpendLogger().log(
            provider="google",
            model="gemini-3.5-flash-lite",
            input_tokens=1_000_000,
            output_tokens=0,
            cost_usd=0.30,
            agent="test_agent",
        )
    finally:
        p.stop()

    nf = rows["neural_footprint_event"][0]
    assert nf["cost_usd"] == pytest.approx(0.30)
    assert "cost_basis" not in nf["context"]


def test_log_context_is_async_task_isolated():
    """The old threading.local storage let concurrent coroutines clobber each
    other's correlation_id; ContextVar must keep per-task copies isolated."""

    seen = {}

    async def worker(name: str):
        set_log_context(agent_name=name, correlation_id=f"corr-{name}")
        await asyncio.sleep(0.01)  # force interleaving
        seen[name] = get_log_context()

    async def main():
        await asyncio.gather(worker("a"), worker("b"))

    asyncio.run(main())
    assert seen["a"] == ("a", "corr-a")
    assert seen["b"] == ("b", "corr-b")


def test_celery_prerun_hook_sets_worker_identity_and_task_id():
    from jobs.celery_app import _clear_task_log_context, _set_task_log_context

    task = MagicMock()
    task.name = "score.lookup_wine"
    _set_task_log_context(task_id="celery-task-7", task=task)
    assert get_log_context() == ("score", "celery-task-7")
    _clear_task_log_context()
    assert get_log_context() == (None, None)


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


# ---------------------------------------------------------------------------
# Unpriced models (P1 readout): a false 0.0 must never reach the NF ledger.
# ---------------------------------------------------------------------------


def test_is_priced_model_knows_what_the_rate_table_covers():
    from services.spend_logger import is_priced_model

    assert is_priced_model("claude-haiku-4-5-20251001") is True
    assert is_priced_model("gemini-2.5-flash") is True
    # This assertion used to read `is_priced_model("gemini-3.6-flash") is False`,
    # written when the table stopped at 2.5 and every 3.x successor was unpriced.
    # ADR 0010 verified and added the 3.x rows, so 3.6-flash is now priced and the
    # id no longer stands for "unpriced" — assert the new truth, and use an id that
    # cannot ever be in the table for the negative case.
    assert is_priced_model("gemini-3.6-flash") is True
    assert is_priced_model("gemini-9.9-unreleased") is False
    assert is_priced_model("") is False


def test_unpriced_model_writes_null_nf_cost_not_a_false_zero():
    """§2 sums cost_usd. An unpriced model must land NULL + a cost_basis reason
    in NF, and — since OD-61 made the column nullable — NULL in api_spend too."""
    client, rows = _capturing_supabase()
    p = _patched_settings(client)
    try:
        from services.spend_logger import SpendLogger, estimate_llm_cost

        # Was "gemini-3.6-flash", which ADR 0010 has since given a verified rate;
        # the test needs an id the table genuinely cannot price, so it exercises
        # the guard rather than the table's coverage on a given day.
        model = "gemini-9.9-unreleased"
        SpendLogger().log(
            provider="google",
            model=model,
            input_tokens=146,
            output_tokens=53,
            cost_usd=estimate_llm_cost(model, 146, 53),
            agent="email_intel_agent",
            task_type="email_classification",
            outcome="success",
        )
    finally:
        p.stop()

    nf = rows["neural_footprint_event"][0]
    assert nf["cost_usd"] is None
    assert nf["context"]["cost_basis"] == "unpriced_model"
    assert nf["input_tokens"] == 146  # tokens are still real, cost is not
    spend = rows["api_spend"][0]
    assert spend["cost_usd"] is None
    assert spend["input_tokens"] == 146  # …and the primary ledger keeps them too,
    assert spend["output_tokens"] == 53  # so the row stays re-costable later


def test_priced_model_keeps_its_cost_and_carries_no_cost_basis_flag():
    client, rows = _capturing_supabase()
    p = _patched_settings(client)
    try:
        from services.spend_logger import SpendLogger

        SpendLogger().log(
            provider="google",
            model="gemini-2.5-flash",
            input_tokens=146,
            output_tokens=84,
            cost_usd=0.000036,
            agent="email_intel_agent",
            task_type="email_classification",
            outcome="success",
        )
    finally:
        p.stop()

    nf = rows["neural_footprint_event"][0]
    assert nf["cost_usd"] == 0.000036
    assert "cost_basis" not in nf["context"]


def test_zero_token_zero_cost_call_is_not_flagged_unpriced():
    """Search APIs log 0 tokens with a real cost; they must not be touched."""
    client, rows = _capturing_supabase()
    p = _patched_settings(client)
    try:
        from services.spend_logger import SpendLogger

        SpendLogger().log(
            provider="serper",
            model="serper-search",
            input_tokens=0,
            output_tokens=0,
            cost_usd=0.001,
            agent_fallback="web_verification_service",
            task_type="web_verify",
        )
    finally:
        p.stop()

    nf = rows["neural_footprint_event"][0]
    assert nf["cost_usd"] == 0.001
    assert "cost_basis" not in nf["context"]


# ---------------------------------------------------------------------------
# OD-61 — the two ledgers must agree about whether a cost is KNOWN
# ---------------------------------------------------------------------------


def test_both_ledgers_agree_on_cost_for_every_shape_of_call():
    """
    api_spend and neural_footprint_event are written from one determination, so
    they cannot disagree about whether a call's cost is known.

    The regression this pins is the ledgers DRIFTING: OD-61 existed because NF
    was fixed to book NULL for an unpriced model while api_spend, being NOT
    NULL, kept booking a false 0.0 — the primary ledger lying while the
    secondary one told the truth. Asserting equality across every shape of call
    catches a future fix applied to only one of them again.
    """
    from services.spend_logger import SpendLogger

    cases = [
        # (label, provider, model, in_tok, out_tok, cost, expected_ledger_cost)
        (
            "unpriced model, real tokens",
            "google",
            "gemini-9.9-unreleased",
            100,
            50,
            0.0,
            None,
        ),
        (
            "priced model, real tokens",
            "google",
            "gemini-2.5-flash",
            100,
            50,
            0.000155,
            0.000155,
        ),
        (
            "priced model, zero tokens",
            "anthropic",
            "claude-haiku-4-5-20251001",
            0,
            0,
            0.0,
            0.0,
        ),
        ("unpriced model, zero tokens", "openai", "gpt-9-imaginary", 0, 0, 0.0, 0.0),
        ("flat-fee provider", "serper", "serper-search", 0, 0, 0.001, 0.001),
    ]

    for label, provider, model, in_tok, out_tok, cost, expected in cases:
        client, rows = _capturing_supabase()
        p = _patched_settings(client)
        try:
            SpendLogger().log(
                provider=provider,
                model=model,
                input_tokens=in_tok,
                output_tokens=out_tok,
                cost_usd=cost,
                agent="test_agent",
            )
        finally:
            p.stop()

        spend_cost = rows["api_spend"][0]["cost_usd"]
        nf_cost = rows["neural_footprint_event"][0]["cost_usd"]
        assert spend_cost == nf_cost, f"{label}: ledgers disagree"
        if expected is None:
            assert spend_cost is None, f"{label}: expected NULL, got {spend_cost}"
        else:
            assert spend_cost == pytest.approx(expected), label


def test_zero_token_call_keeps_its_true_zero_rather_than_going_unknown():
    """
    A call that consumed no tokens costs zero at ANY rate, so 0.0 is a measured
    fact, not a gap. Nulling it would invent an unknown and — because the sole
    genuinely-free row in production is exactly this shape — would make the
    ledger less accurate, not more.
    """
    client, rows = _capturing_supabase()
    p = _patched_settings(client)
    try:
        from services.spend_logger import SpendLogger

        SpendLogger().log(
            provider="anthropic",
            model="claude-haiku-4-5-20251001",
            input_tokens=0,
            output_tokens=0,
            cost_usd=0.0,
            agent="test_agent",
        )
    finally:
        p.stop()

    assert rows["api_spend"][0]["cost_usd"] == 0.0
    assert rows["neural_footprint_event"][0]["cost_usd"] == 0.0
    assert "cost_basis" not in rows["neural_footprint_event"][0]["context"]


# ---------------------------------------------------------------------------
# OD-62 — dated-source discipline for the rate table
# ---------------------------------------------------------------------------


def test_rate_rows_all_carry_a_dated_verified_source():
    """
    Every row in _RATES_PER_M must name WHEN its price was checked and AGAINST
    WHAT.

    This is the durable half of OD-62. The table has now been wrong twice the
    same way — a superseded model's published price frozen in and silently
    inherited by its successor (Gemini in ADR 0010, then Claude Haiku 3.5's
    0.80/4.00 applied to the 4.5 model this repo actually calls). Both were
    caught by a human reading the table months later. Two occurrences of one
    failure mode is not coincidence, and the fix for it is not a third careful
    read — it is making an undated rate impossible to ship.

    A third recurrence now breaks the build here instead of being discovered by
    inspection.
    """
    from datetime import date

    from services.spend_logger import _RATES_PER_M, Rate

    today = date.today()
    placeholders = {"", "unknown", "todo", "tbd", "unverified", "n/a", "none"}

    for model, rate in _RATES_PER_M.items():
        assert isinstance(rate, Rate), f"{model}: rate is not a Rate (got {type(rate)})"

        assert (
            rate.verified.strip().lower() not in placeholders
        ), f"{model}: verification date is a placeholder ({rate.verified!r})"
        try:
            checked = date.fromisoformat(rate.verified)
        except ValueError:
            raise AssertionError(
                f"{model}: verified={rate.verified!r} is not an ISO YYYY-MM-DD date"
            )
        assert checked <= today, (
            f"{model}: verified={rate.verified} is in the future — a date nobody "
            f"could have checked on is worse than no date at all"
        )

        assert (
            rate.source.strip().lower() not in placeholders
        ), f"{model}: source is a placeholder ({rate.source!r})"
        assert "." in rate.source, (
            f"{model}: source={rate.source!r} does not look like a published page; "
            f"it must be somewhere a reviewer can go and re-read the number"
        )

        assert (
            rate.input_per_m >= 0 and rate.output_per_m >= 0
        ), f"{model}: negative rate"


def test_a_rate_cannot_be_constructed_without_its_provenance():
    """
    The dated source is a REQUIRED field, not a convention the above test polices
    after the fact. An undated rate fails at import, before any test runs — which
    is the only version of this discipline that cannot be forgotten.
    """
    from services.spend_logger import Rate

    with pytest.raises(TypeError):
        Rate(10.00, 30.00)  # no verified date, no source

    ok = Rate(10.00, 30.00, "2026-08-25", "developers.openai.com/api/docs/pricing")
    assert ok.input_per_m == 10.00
    assert ok.output_per_m == 30.00
    assert ok.note == ""  # only `note` may be omitted


def test_gpt_4_turbo_rate_matches_openais_published_pricing():
    """
    OD-62's last unverified row. Checked 2026-08-25 against OpenAI's published
    pricing (developers.openai.com/api/docs/pricing and the gpt-4-turbo model
    page): gpt-4-turbo-2024-04-09 is "$10" input / "$30" output per 1M tokens.

    The suspicion did not hold — unlike claude-haiku and the Gemini rows, this
    number was right. It is pinned anyway because the row now has NO live call
    site (auction_wine_service moved to gpt-4o), which makes it exactly the kind
    of row that rots unnoticed while still pricing historical api_spend rows.
    """
    from services.spend_logger import _RATES_PER_M, estimate_llm_cost

    rate = _RATES_PER_M["gpt-4-turbo"]
    assert (rate.input_per_m, rate.output_per_m) == (10.00, 30.00)
    assert rate.verified == "2026-08-25"
    assert "openai" in rate.source

    # The ids that call site actually used to pass still resolve to this row.
    assert estimate_llm_cost("gpt-4-turbo-preview", 1_000_000, 0) == pytest.approx(
        10.00
    )
    assert estimate_llm_cost("gpt-4-turbo-2024-04-09", 0, 1_000_000) == pytest.approx(
        30.00
    )


# ---------------------------------------------------------------------------
# OD-74 — the emit returns the row id, so a verdict can attach to it later.
#
# Before this, insert_event returned a bare bool and log() returned None, which
# discarded the only handle a grader could use. ADR 0017's doneability verdicts
# key on the event id, so without this the entire Python runtime — 43 of the
# instrument's 50 emit points — was structurally unreachable by any verdict.
# ---------------------------------------------------------------------------


def test_build_agent_event_mints_a_unique_id():
    """The id exists BEFORE the insert, and two events never share one."""
    import uuid as _uuid

    from services.neural_footprint import build_agent_event

    a = build_agent_event(subject_id="agent", stimulus="s", choice="c")
    b = build_agent_event(subject_id="agent", stimulus="s", choice="c")

    # Must parse as a real uuid — the column is uuid-typed, so a non-uuid
    # string would be rejected by Postgres at insert time, not here.
    _uuid.UUID(a["id"])
    assert a["id"] != b["id"]


def test_insert_event_returns_the_row_id_on_success():
    client, rows = _capturing_supabase()

    from services.neural_footprint import build_agent_event, insert_event

    row = build_agent_event(subject_id="agent", stimulus="s", choice="c")
    returned = insert_event(client, row)

    assert returned == row["id"]
    assert rows["neural_footprint_event"][0]["id"] == row["id"]


def test_insert_event_returns_none_when_the_write_fails():
    """An id whose row does not exist would produce a verdict grading nothing."""
    from services.neural_footprint import build_agent_event, insert_event

    client = MagicMock()
    client.table.side_effect = RuntimeError("db down")

    row = build_agent_event(subject_id="agent", stimulus="s", choice="c")
    assert insert_event(client, row) is None


def test_insert_event_return_stays_truthy_for_existing_callers():
    """Callers written against the old bool contract must read the same."""
    client, _ = _capturing_supabase()

    from services.neural_footprint import build_agent_event, insert_event

    row = build_agent_event(subject_id="agent", stimulus="s", choice="c")
    assert bool(insert_event(client, row)) is True

    failing = MagicMock()
    failing.table.side_effect = RuntimeError("db down")
    assert bool(insert_event(failing, row)) is False


def test_log_returns_the_nf_event_id():
    client, rows = _capturing_supabase()
    p = _patched_settings(client)
    try:
        from services.spend_logger import SpendLogger

        event_id = SpendLogger().log(
            provider="anthropic",
            model="claude-haiku-4-5",
            input_tokens=10,
            output_tokens=5,
            cost_usd=0.0001,
            agent="visual_verification_agent",
            task_type="invoice_extraction",
            outcome="success",
        )
    finally:
        p.stop()

    assert event_id is not None
    assert event_id == rows["neural_footprint_event"][0]["id"]


def test_log_returns_none_when_supabase_is_unconfigured():
    """The early return must not leave the name unbound — log() never raises."""
    p = _patched_settings(None)
    try:
        from services.spend_logger import SpendLogger

        assert (
            SpendLogger().log(
                provider="anthropic",
                model="claude-haiku-4-5",
                input_tokens=1,
                output_tokens=1,
                cost_usd=0.0,
            )
            is None
        )
    finally:
        p.stop()


# ---------------------------------------------------------------------------
# ADR 0039 A4 — skill_id passthrough.
#
# `nf_a.skill_id` is the single blocking dependency for skill-firing telemetry:
# run_card.py's staleness-reaper reports skills.firing_rate_30d as
# "unmeasurable" because the column did not exist. It does now
# (20260828103059_nf_skill_id.sql), nullable forever, and the emitters pass it
# through optionally.
#
# The absence case is the load-bearing one. The key must be OMITTED, not written
# as None: this insert goes through PostgREST, which rejects the whole row for an
# unknown column, so an unconditional `skill_id: None` would drop every NF row in
# any environment where the migration has not landed yet.
# ---------------------------------------------------------------------------


def test_skill_id_lands_in_the_nf_row_when_passed():
    client, rows = _capturing_supabase()
    p = _patched_settings(client)
    try:
        from services.spend_logger import SpendLogger

        SpendLogger().log(
            provider="anthropic",
            model="claude-haiku-4-5",
            input_tokens=10,
            output_tokens=5,
            cost_usd=0.0001,
            agent="provider_communication_agent",
            task_type="email_draft",
            skill_id="supabase-postgres-best-practices",
        )
    finally:
        p.stop()

    nf = rows["neural_footprint_event"][0]
    assert nf["skill_id"] == "supabase-postgres-best-practices"
    # NF only. api_spend has no such column, and adding one there would be a
    # second, disagreeing home for the same fact.
    assert "skill_id" not in rows["api_spend"][0]


def test_skill_id_key_is_absent_when_not_passed():
    """Not "None" — ABSENT. A null for an unmigrated column drops the row."""
    client, rows = _capturing_supabase()
    p = _patched_settings(client)
    try:
        from services.spend_logger import SpendLogger

        SpendLogger().log(
            provider="google",
            model="gemini-2.5-flash",
            input_tokens=100,
            output_tokens=50,
            cost_usd=0.001,
        )
    finally:
        p.stop()

    nf = rows["neural_footprint_event"][0]
    assert "skill_id" not in nf
    # Not smuggled into context either — attribution is a column here.
    assert "skill_id" not in nf["context"]


def test_build_agent_event_omits_skill_id_for_empty_values():
    """Empty string and None are both 'not a skill task' — neither writes it."""
    from services.neural_footprint import build_agent_event

    for empty in (None, ""):
        row = build_agent_event(
            subject_id="agent", stimulus="s", choice="c", skill_id=empty
        )
        assert "skill_id" not in row

    row = build_agent_event(
        subject_id="agent", stimulus="s", choice="c", skill_id="registry-clerk"
    )
    assert row["skill_id"] == "registry-clerk"
