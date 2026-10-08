"""The house's price ceiling never reaches a vendor-facing draft.

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
        "",
    ],
)
def test_other_figures_are_not_the_ceiling(text):
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
async def test_a_draft_that_states_the_ceiling_is_replaced():
    leaky = "Target $1,090, with a maximum acceptable price of $1,199."
    agent = _agent(leaky)
    text, audit = await _draft(agent)
    assert audit.withheld_figure_dropped is True
    assert withheld_figures_in(text, INTENT) == []
    assert text != leaky
    assert "1,199" not in text and "1199" not in text
