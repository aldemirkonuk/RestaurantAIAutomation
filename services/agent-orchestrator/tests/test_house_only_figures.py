"""The house's price ceiling (max_acceptable_price in the intent passed to
the drafting call) is kept out of the prompt, and a draft that states its
exact figure in a covered form is replaced.

Found by the F-106 production dry run, 2026-10-08: a waiting draft said
"My target price ... is around $1,090 per bottle, with a maximum acceptable
price of $1,199." It was never sent. The cause was that
RESPONSE_SYSTEM_PROMPT received the whole intent, max_acceptable_price
included (tech-debt.d 2026-10-08-data-f106-reconcile-pending-drafts).
"""

import types
from unittest.mock import MagicMock

import pytest

import agents.provider_conversation_agent as pca
from agents.provider_conversation_agent import ProviderConversationAgent
from core.house_only_figures import (
    HOUSE_ONLY_INTENT_KEYS,
    order_letter_without_ceiling,
    vendor_safe_intent,
    withheld_figures_in,
)

INTENT = {
    "intent_type": "order_inquiry",
    "wine_name": "Example Riserva 2010",
    "quantity": 6,
    "target_price": 1090,
    "max_acceptable_price": 1199,
}


# ── the module ──────────────────────────────────────────────────────────────


def test_the_ceiling_is_a_house_only_key():
    assert "max_acceptable_price" in HOUSE_ONLY_INTENT_KEYS


def test_vendor_safe_intent_drops_the_ceiling_and_keeps_the_rest():
    safe = vendor_safe_intent(INTENT)
    assert "max_acceptable_price" not in safe
    assert safe["target_price"] == 1090 and safe["wine_name"] == INTENT["wine_name"]
    assert "max_acceptable_price" in INTENT  # the caller's intent is untouched
    assert vendor_safe_intent(None) == {}


@pytest.mark.parametrize(
    "text",
    [
        "a maximum acceptable price of $1,199.",
        "up to 1199 per bottle",
        "up to 1.199 per bottle",
        "up to 1 199 per bottle",
        "up to 1 199 per bottle",
        "up to $1199.00",
        "en fazla 1.199,00 EUR",
        "up to 1'199 per bottle",
        "up to 1,199,- per bottle",
        # another number in the same sentence (gate review of f16882e)
        "Our maximum is $1,199. 6 bottles would suit us.",
        "We could go to $1,199. 2 weeks delivery?",
        "up to $1,199, 6 bottles",
        "1199, 1090",
        "1,199, 1,090",
        "1 199 1 090",
        "6 1199",
    ],
)
def test_the_ceiling_figure_is_found_in_every_form(text):
    assert withheld_figures_in(text, INTENT) == ["max_acceptable_price"]


@pytest.mark.parametrize(
    "text",
    [
        "Could you do $1,090 per bottle?",
        "6 bottles of the 2010",
        "11,99 a glass",  # 11.99, not 1199
        "1 1 9 9",
        "11 99",
        "",
    ],
)
def test_other_figures_are_not_the_ceiling(text):
    assert withheld_figures_in(text, INTENT) == []


@pytest.mark.parametrize(
    "space",
    [
        "\u2009",  # THIN SPACE
        "\u2007",  # FIGURE SPACE
        "\u200a",  # HAIR SPACE
        "\u2008",  # PUNCTUATION SPACE
        "\u205f",  # MEDIUM MATHEMATICAL SPACE
        "\u3000",  # IDEOGRAPHIC SPACE
        "\u202f",  # NARROW NO-BREAK SPACE
    ],
)
def test_any_unicode_space_between_groups_is_read_as_a_space(space):
    text = f"Our maximum is $1{space}199 per bottle."
    assert withheld_figures_in(text, INTENT) == ["max_acceptable_price"]


@pytest.mark.parametrize(
    "text",
    ["1, 199", "1\n199", "1\t199", "1.199.00", "6,1199", "1 1 99", "1\u066c199"],
)
def test_the_disclosed_misses_are_still_misses(text):
    # Listed under "Not covered" in the module docstring and the tech-debt
    # fragment; if one starts matching, update both.
    assert withheld_figures_in(text, INTENT) == []


def test_a_ceiling_equal_to_the_target_is_meant_to_be_said():
    same = dict(INTENT, max_acceptable_price=1090)
    assert withheld_figures_in("Would $1,090 work?", same) == []


def test_no_ceiling_or_a_bad_one_finds_nothing():
    assert withheld_figures_in("1199", {"target_price": 1090}) == []
    assert withheld_figures_in("1199", dict(INTENT, max_acceptable_price="n/a")) == []
    assert withheld_figures_in("1199", None) == []


# ── the agent's drafting path ───────────────────────────────────────────────


class _Settings:
    prov_agent_level4_enabled = False


def _agent(model_text):
    agent = object.__new__(ProviderConversationAgent)
    agent.mock_mode = False
    agent.logger = MagicMock()
    agent.llm_temperature = 0.2
    agent._log_gemini_spend = MagicMock()
    agent.llm_client = MagicMock()
    agent.llm_client.generate_content.return_value = types.SimpleNamespace(
        text=model_text
    )
    return agent


async def _draft(agent):
    return await agent._generate_response(
        provider_id="p-1",
        digital_twin={},
        style_profile={},
        recent_messages=[],
        memories=[],
        intent=dict(INTENT),
        active_promos=[],
        restaurant_id="r-1",
    )


@pytest.fixture(autouse=True)
def _no_level4(monkeypatch):
    monkeypatch.setattr(pca, "Settings", _Settings)


@pytest.mark.asyncio
async def test_the_prompt_never_carries_the_ceiling():
    agent = _agent("Could you do $1,090 per bottle?")
    text, audit = await _draft(agent)
    prompt = agent.llm_client.generate_content.call_args.args[0]
    assert "max_acceptable_price" not in prompt
    assert "1199" not in prompt
    assert '"target_price": 1090' in prompt  # the target is still there to propose
    assert text == "Could you do $1,090 per bottle?"
    assert audit.withheld_figure_dropped is False


@pytest.mark.asyncio
async def test_a_draft_that_states_the_ceiling_is_replaced_by_the_order_letter():
    leaky = "Target $1,090, with a maximum acceptable price of $1,199."
    agent = _agent(leaky)
    text, audit = await _draft(agent)
    assert audit.withheld_figure_dropped is True
    assert withheld_figures_in(text, INTENT) == []
    assert "1,199" not in text and "1199" not in text
    # the replacement still says what the order needs
    assert INTENT["wine_name"] in text and "6" in text and "1,090.00" in text


# ── the replacement letter ──────────────────────────────────────────────────


def test_the_order_letter_names_the_order_and_not_the_ceiling():
    text = order_letter_without_ceiling(INTENT)
    assert text.startswith("Hello, could you quote us for 6 of Example Riserva 2010?")
    assert "1,090.00" in text and withheld_figures_in(text, INTENT) == []


def test_the_order_letter_is_not_commitment_language():
    from core.commitment_patterns import COMPILED_COMMITMENT_PATTERNS

    text = order_letter_without_ceiling(INTENT)
    assert not any(p.search(text) for p in COMPILED_COMMITMENT_PATTERNS)


def test_a_long_run_of_spaced_numbers_reads_quickly():
    import time

    t0 = time.perf_counter()
    for text in ("1 " * 2000, "123 " * 2000, "1 199 " * 1000):
        withheld_figures_in(text, INTENT)
    assert time.perf_counter() - t0 < 1.0


@pytest.mark.parametrize(
    "intent",
    [
        {},
        None,
        {"wine_name": "X"},
        {"quantity": 3, "target_price": "n/a"},
        {"target_price_per_bottle": 12.5},
    ],
)
def test_the_order_letter_never_raises_on_a_thin_intent(intent):
    text = order_letter_without_ceiling(intent)
    assert text.startswith("Hello, could you quote us for")


@pytest.mark.parametrize("target", [None, "1090", "", "n/a"])
def test_the_negotiate_template_survives_a_missing_or_text_target(target):
    agent = object.__new__(ProviderConversationAgent)
    intent = {"intent_type": "negotiate_price", "wine_name": "X", "quantity": 6}
    if target is not None:
        intent["target_price"] = target
    for formality in ("casual", "semi-formal"):
        text = agent._mock_generate_response(intent, {"formality": formality})
        assert "X" in text


@pytest.mark.asyncio
async def test_the_replacement_letter_gets_the_commitment_check():
    agent = _agent("Target $1,090, with a maximum acceptable price of $1,199.")
    checked = []
    agent._check_commitment_language = lambda t: checked.append(t) or True
    text, audit = await _draft(agent)
    assert checked == [text]
    assert audit.commitment_language_detected is True


def test_the_drop_flag_is_written_into_the_audit_trail_source():
    import inspect

    src = inspect.getsource(pca)
    assert '"withheld_figure_dropped": audit.withheld_figure_dropped' in src
