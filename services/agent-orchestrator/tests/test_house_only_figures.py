"""The house's price ceiling (max_acceptable_price in the intent passed to
the drafting call) is kept out of the prompt, and a draft that states its
figure in a covered form is replaced.

Found by the F-106 production dry run, 2026-10-08: a waiting draft said
"My target price ... is around $1,090 per bottle, with a maximum acceptable
price of $1,199." It was never sent. The cause was that
RESPONSE_SYSTEM_PROMPT received the whole intent, max_acceptable_price
included (tech-debt.d 2026-10-08-data-f106-reconcile-pending-drafts).
"""

import logging
import sys
import types
import unicodedata
from unittest.mock import MagicMock

import pytest

import agents.provider_conversation_agent as pca
from agents.provider_conversation_agent import ProviderConversationAgent
import core.house_only_figures as hof
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
    "char",
    [
        "\u200b",  # ZERO WIDTH SPACE
        "\u2060",  # WORD JOINER
        "\ufeff",  # ZERO WIDTH NO-BREAK SPACE (BOM)
        "\u00ad",  # SOFT HYPHEN
    ],
)
def test_an_invisible_format_character_between_groups_is_deleted(char):
    # category Cf: deleted, so the text reads "$1199"
    text = f"Our maximum is $1{char}199 per bottle."
    assert withheld_figures_in(text, INTENT) == ["max_acceptable_price"]
    assert withheld_figures_in(f"$11{char}99", INTENT) == ["max_acceptable_price"]


@pytest.mark.parametrize("char", ["\u2028", "\u2029"])
def test_the_line_and_paragraph_separators_are_read_as_a_space(char):
    # category Zl / Zp: read like " ", unlike LF, CR and tab (category Cc)
    text = f"Our maximum is $1{char}199 per bottle."
    assert withheld_figures_in(text, INTENT) == ["max_acceptable_price"]


def _every(predicate):
    return [
        chr(cp)
        for cp in range(sys.maxunicode + 1)
        if predicate(cp, unicodedata.category(chr(cp)))
    ]


def _missed_between_groups(chars):
    return [
        f"U+{ord(c):04X}"
        for c in chars
        if withheld_figures_in(f"$1{c}199 per bottle", INTENT)
        != ["max_acceptable_price"]
    ]


def test_no_character_the_build_reads_lies_outside_the_walk():
    # The table build walks only hof._WALKED; this walks every code point.
    def outside(cp):
        return not any(start <= cp < stop for start, stop in hof._WALKED)

    read = {"Cf", "Mn", "Me", "Cc", "Zs", "Zl", "Zp", "Sc"}
    assert _every(lambda cp, cat: outside(cp) and cat in read) == []


def test_every_format_character_and_combining_mark_is_deleted_between_groups():
    chars = _every(lambda cp, cat: cat in ("Cf", "Mn", "Me"))
    assert len(chars) > 2000  # 2,126 in Python 3.11's Unicode 14 tables
    assert any(ord(c) > 0xFFFF for c in chars)  # the walk leaves the BMP
    assert _missed_between_groups(chars) == []


def test_every_control_character_that_is_not_whitespace_is_deleted():
    chars = _every(lambda cp, cat: cat == "Cc" and not chr(cp).isspace())
    assert len(chars) == 55  # 65 Cc minus the 10 whitespace controls
    assert _missed_between_groups(chars) == []


@pytest.mark.parametrize("char", ["\u115f", "\u1160", "\u3164", "\uffa0", "\u2800"])
def test_the_five_blank_fillers_are_deleted_between_groups(char):
    assert withheld_figures_in(f"$1{char}199", INTENT) == ["max_acceptable_price"]


@pytest.mark.parametrize("dot", ["\u00b7", "\u2027", "\u30fb", "\uff65"])
def test_a_middle_dot_groups_digits_like_a_full_stop(dot):
    assert withheld_figures_in(f"$1{dot}199", INTENT) == ["max_acceptable_price"]
    assert withheld_figures_in(f"11{dot}99", INTENT) == []


def test_every_separator_character_is_read_as_a_space():
    chars = _every(lambda cp, cat: cat.startswith("Z"))
    assert len(chars) > 15
    assert _missed_between_groups(chars) == []
    # mapped to a space, not deleted: two figures stay two figures
    for c in chars:
        assert withheld_figures_in(f"11{c}99", INTENT) == []


@pytest.mark.parametrize(
    "text",
    [
        "up to 1\uff0c199 per bottle",  # FULLWIDTH COMMA, NFKC -> ","
        "up to \uff11\uff0c\uff11\uff19\uff19 per bottle",  # full-width digits
    ],
)
def test_compatibility_forms_are_folded_by_nfkc(text):
    assert withheld_figures_in(text, INTENT) == ["max_acceptable_price"]


@pytest.mark.parametrize("apostrophe", ["'", "\u2019", "\u2018", "\u02bc"])
def test_swiss_grouping_with_any_of_the_apostrophes(apostrophe):
    assert withheld_figures_in(f"CHF 1{apostrophe}199.00", INTENT) == [
        "max_acceptable_price"
    ]
    # still only before exactly three digits
    assert withheld_figures_in(f"11{apostrophe}99", INTENT) == []
    assert withheld_figures_in(f"1{apostrophe}1990", INTENT) == []


@pytest.mark.parametrize(
    "text",
    [
        "1, 199",
        "1\n199",
        "1\r199",
        "1\u0085199",
        "1\t199",
        "1_199",
        "1.199.00",
        "6,1199",
        "1 1 99",
        "1\u066c199",  # ARABIC THOUSANDS SEPARATOR
        "1\u066b199",  # ARABIC DECIMAL SEPARATOR
        "1\x0b199",  # VT
        "1\x0c199",  # FF
        "1\x1c199",  # U+001C, a whitespace control
        "1-199",
        "1\u2010199",  # HYPHEN
        "1\u2011199",  # NON-BREAKING HYPHEN
        "1\u2212199",  # MINUS SIGN
        "1\u0903199",  # Mc, a spacing mark
        "1\ue000199",  # Co, private use
        "1\u0378199",  # Cn, unassigned in Unicode 14
        "1\ud800199",  # Cs, a lone surrogate
    ],
)
def test_the_disclosed_misses_are_still_misses(text):
    # Listed under "Not covered" in the module docstring and the tech-debt
    # fragment; if one starts matching, update both.
    assert withheld_figures_in(text, INTENT) == []


def test_a_ceiling_equal_to_the_target_is_meant_to_be_said():
    same = dict(INTENT, max_acceptable_price=1090)
    assert withheld_figures_in("Would $1,090 work?", same) == []


def test_no_ceiling_finds_nothing():
    assert withheld_figures_in("1199", {"target_price": 1090}) == []
    assert withheld_figures_in("1199", dict(INTENT, max_acceptable_price="")) == []
    assert withheld_figures_in("1199", None) == []


@pytest.mark.parametrize("ceiling", [0, 0.0, -0.0, -5, -1.5])
def test_a_numeric_ceiling_of_zero_or_less_is_unset_and_not_logged(ceiling, caplog):
    # the gateway writers send (price || 0) * 1.1: 0 is their "no price"
    with caplog.at_level(logging.WARNING, logger="core.house_only_figures"):
        found = withheld_figures_in(
            "0 1199", dict(INTENT, max_acceptable_price=ceiling)
        )
    assert found == []
    assert caplog.text == ""


@pytest.mark.parametrize("target_key", ["target_price", "target_price_per_bottle"])
def test_the_target_may_be_given_per_bottle(target_key):
    intent = {"max_acceptable_price": 12.0, target_key: 12.0}
    assert withheld_figures_in("12.00 per bottle", intent) == []
    intent = {"max_acceptable_price": 13.2, target_key: 12.0}
    assert withheld_figures_in("13.20 per bottle", intent) == ["max_acceptable_price"]


def test_target_price_wins_over_the_per_bottle_target():
    intent = {
        "max_acceptable_price": 12.0,
        "target_price": 11.0,
        "target_price_per_bottle": 12.0,
    }
    assert withheld_figures_in("12.00", intent) == ["max_acceptable_price"]


@pytest.mark.parametrize(
    "ceiling", ["n/a", "0", "-5", float("nan"), float("inf"), True, [1199]]
)
def test_a_set_ceiling_that_cannot_be_read_is_logged(ceiling, caplog):
    with caplog.at_level(logging.WARNING, logger="core.house_only_figures"):
        found = withheld_figures_in("1199", dict(INTENT, max_acceptable_price=ceiling))
    assert found == []
    assert "could not be read as a figure" in caplog.text


@pytest.mark.parametrize(
    "ceiling",
    [
        "1199",
        "1,199",
        "$1199",
        "$1,199.00",
        "1.199,00",
        "1.199,00 EUR",
        "1 199",
        "CHF 1\u2019199",
        "\u20ac1199",
        "1\uff0c199",
        " 1199 ",
    ],
)
def test_a_ceiling_given_as_text_is_read(ceiling):
    intent = dict(INTENT, max_acceptable_price=ceiling)
    assert withheld_figures_in("up to $1,199 per bottle", intent) == [
        "max_acceptable_price"
    ]


def test_a_text_ceiling_read_two_ways_is_looked_for_both_ways():
    intent = {"max_acceptable_price": "1,199"}  # 1199, or 1.199
    assert withheld_figures_in("1199", intent) == ["max_acceptable_price"]
    assert withheld_figures_in("1.199", intent) == ["max_acceptable_price"]


@pytest.mark.parametrize(
    "ceiling, text",
    [
        (8.305, "$8.31"),  # rounded half-up; 8.305 - 8.31 is 0.005 in float
        (13.607, "13.607"),
        (13.607, "13.60"),  # cut to the cent
        (13.607, "13.61"),  # rounded to the cent
        (13.585, "13.58"),
        (13.585, "13.59"),
        (1199.0, "1,199.00"),
    ],
)
def test_the_ceiling_is_found_cut_or_rounded_to_the_cent(ceiling, text):
    assert withheld_figures_in(text, {"max_acceptable_price": ceiling}) == [
        "max_acceptable_price"
    ]


def test_a_cent_form_equal_to_the_target_is_meant_to_be_said():
    intent = {"max_acceptable_price": 13.607, "target_price": 13.6}
    assert withheld_figures_in("13.60", intent) == []
    assert withheld_figures_in("13.61", intent) == ["max_acceptable_price"]


def test_a_ceiling_cut_to_whole_units_is_a_disclosed_miss():
    assert withheld_figures_in("13 per bottle", {"max_acceptable_price": 13.6}) == []


@pytest.mark.parametrize("ceiling", [1e25, 1e26, 1e30, 1e300])
def test_a_huge_ceiling_does_not_raise(ceiling):
    assert withheld_figures_in("1199", {"max_acceptable_price": ceiling}) == []


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
async def test_the_intent_in_the_prompt_never_carries_the_ceiling():
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


# Linear time is checked by scaling, not by a wall-clock bound: each shape
# is timed at n and at 4n repeats, in this thread's CPU time (so time spent
# preempted on a busy machine is not counted), best of five, interleaved.
# Linear work grows about 4x; quadratic work grows about 16x, so the ratio
# must stay under 8. Any single run over 2 s of CPU fails at once, so a
# quadratic mutation fails fast instead of hanging.
_SHAPES = (
    "1 ",
    "123 ",  # one long space-grouped token
    "1 199 ",
    "1, ",  # many short numbers: one match each
    "1 a ",
    "1\u200b\u2009",  # digits, Cf and Zs
    "123\u2060\u202f\u00ad",
    "\u200b\u2028\u3000",
)


def _best_of_five(texts):
    import gc
    import time

    best = [float("inf")] * len(texts)
    gc.disable()
    try:
        for _ in range(5):
            for k, text in enumerate(texts):
                t0 = time.thread_time()
                withheld_figures_in(text, INTENT)
                took = time.thread_time() - t0
                assert took < 2.0, f"{len(text)} chars took {took:.2f} s of CPU"
                best[k] = min(best[k], took)
    finally:
        gc.enable()
    return best


@pytest.mark.parametrize("shape", _SHAPES)
def test_reading_time_grows_linearly_with_the_text(shape):
    small, large = _best_of_five((shape * 5_000, shape * 20_000))
    assert large / small < 8.0, f"x4 text took x{large / small:.1f} time"


def test_reading_time_grows_linearly_with_distinct_numbers():
    # every number different, so work per match that scans earlier values
    # (a dedupe or a membership test) shows up as quadratic
    def numbers(n):
        return ", ".join(str(k) for k in range(2_000, 2_000 + n))

    small, large = _best_of_five((numbers(5_000), numbers(20_000)))
    assert large / small < 8.0, f"x4 text took x{large / small:.1f} time"


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
