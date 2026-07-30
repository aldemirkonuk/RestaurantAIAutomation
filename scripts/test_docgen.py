"""Tests for the synthetic procurement document factory (scripts/docgen).

Run: python3 -m pytest scripts/test_docgen.py -q

Deliberately Chrome-free. Every assertion here works on composed deliveries and
rendered HTML strings, so the suite runs in about a second. Rendering pixels is
exercised by `python3 -m scripts.docgen generate`, which is a separate, slower
concern; a test suite nobody runs because it takes two minutes protects nothing.

The verdict expectations themselves are checked against the real TypeScript
engine, not here — see `apps/api-gateway/src/procurement/invoice-match.backtest.spec.ts`
and `python3 -m scripts.docgen backtest --check`.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.docgen.backtest import ALL_VERDICTS, check_fixture  # noqa: E402
from scripts.docgen.compose import build_delivery, render_context  # noqa: E402
from scripts.docgen.degrade import (  # noqa: E402
    PROFILES,
    PROFILES_BY_MEDIUM,
    IllegibleSampleError,
    Profile,
    assert_legible,
    stroke_density,
)
from scripts.docgen.errors import SCENARIOS, verdicts_covered  # noqa: E402
from scripts.docgen.houses import (  # noqa: E402
    HOUSES,
    RATCHETED_DIMENSIONS,
    SINGLETON_ENCODINGS,
    coverage_report,
    house,
)
from scripts.docgen.render import render_html  # noqa: E402
from scripts.docgen.truth import delivery_truth  # noqa: E402
from scripts.docgen.wineops_doc import build_context  # noqa: E402

MENU = REPO_ROOT / "datasets" / "sim" / "menus" / "bistro.json"

RESTAURANT = {
    "name": "Sim Bistro",
    "address": "1841 W Division St",
    "city_state_zip": "Chicago, IL 60622",
    "license_no": "IL-RL-4471903",
}


@pytest.fixture(scope="module")
def wines() -> list[dict]:
    return json.loads(MENU.read_text())["items"]


def make_delivery(wines, house_key="meridian", *, seed=4242, forced=None, lines=None):
    return build_delivery(
        seed=seed,
        house=house(house_key),
        wines=wines,
        restaurant=RESTAURANT,
        delivery_date=date(2026, 7, 22),
        sequence=7,
        line_count=lines if lines is not None else (len(forced) if forced else None),
        force_scenarios=forced,
    )


# ---------------------------------------------------------------------------
# Coverage: the design rules the modules state about themselves
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("dimension", RATCHETED_DIMENSIONS)
def test_no_encoding_is_dead_configuration(dimension):
    """Every declared encoding is actually used by some house."""
    counts = coverage_report()[dimension]
    assert all(n >= 1 for n in counts.values()), f"{dimension}: {counts}"


@pytest.mark.parametrize("dimension", RATCHETED_DIMENSIONS)
def test_singleton_encodings_match_the_declared_ratchet(dimension):
    """Thin coverage must be declared, and must not silently get thinner.

    Two-of-everything is impossible with six houses (four-valued dimensions would
    need eight), so instead the encodings carried by exactly one house are
    enumerated in `houses.SINGLETON_ENCODINGS` and pinned here. The point is that
    a fix which special-cases a singleton house looks general and is not — so the
    set may shrink when a house is added, and may never grow unnoticed.
    """
    counts = coverage_report()[dimension]
    actual = frozenset(value for value, n in counts.items() if n < 2)
    declared = SINGLETON_ENCODINGS[dimension]

    grew = actual - declared
    shrank = declared - actual
    assert not grew, (
        f"{dimension}: {sorted(grew)} became single-house. Coverage got thinner — "
        "add a house that shares the encoding, or justify it in "
        "houses.SINGLETON_ENCODINGS."
    )
    assert not shrank, (
        f"{dimension}: {sorted(shrank)} is no longer a singleton. Coverage "
        "improved — remove it from houses.SINGLETON_ENCODINGS."
    )


def test_scenarios_exercise_every_verdict():
    assert verdicts_covered() == set(ALL_VERDICTS)


def test_committed_backtest_fixture_is_current():
    """The fixture is generated; a stale one silently tests the wrong thing."""
    assert check_fixture() == [], (
        "scenario fixture is stale — run: python3 -m scripts.docgen backtest"
    )


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


def _stable_truth(payload: dict) -> dict:
    """Drop the fields that are expected to differ between two runs."""
    out = json.loads(json.dumps(payload))
    out["generator"].pop("generated_at", None)
    out["generator"].pop("git_rev", None)
    return out


def test_same_seed_produces_identical_truth(wines):
    a = delivery_truth(make_delivery(wines), [], archetype="bistro")
    b = delivery_truth(make_delivery(wines), [], archetype="bistro")
    assert _stable_truth(a) == _stable_truth(b)


def test_different_seed_produces_different_delivery(wines):
    a = make_delivery(wines, seed=1)
    b = make_delivery(wines, seed=2)
    assert (a.invoice_number, [l.wine_name for l in a.lines]) != (
        b.invoice_number,
        [l.wine_name for l in b.lines],
    )


# ---------------------------------------------------------------------------
# Coherence: no artifact may be internally contradictory
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("house_key", sorted(HOUSES))
def test_scenarios_never_contradict_the_house(wines, house_key):
    """A free-goods-with-slip scenario on a house that sends no slip is not a
    harder test case, it is an incoherent document."""
    h = house(house_key)
    by_key = {s.key: s for s in SCENARIOS}
    for seed in (1, 2, 3, 4, 5):
        d = make_delivery(wines, house_key, seed=seed)
        for line in d.lines:
            scen = by_key[line.scenario]
            if scen.requires_packing_slip:
                assert h.sends_packing_slip, (
                    f"{house_key} sends no slip but drew {scen.key}"
                )
            if scen.requires_no_packing_slip:
                assert not h.sends_packing_slip, (
                    f"{house_key} sends a slip but drew {scen.key}"
                )


@pytest.mark.parametrize("house_key", sorted(HOUSES))
def test_no_slip_houses_never_state_a_shipped_quantity(wines, house_key):
    """An inferred ship quantity is 'silence recorded as agreement' on a new axis."""
    h = house(house_key)
    if h.sends_packing_slip:
        pytest.skip(f"{house_key} does send packing slips")
    for seed in (1, 2, 3):
        for line in make_delivery(wines, house_key, seed=seed).lines:
            assert line.outcome.shipped_qty is None


@pytest.mark.parametrize("house_key", sorted(HOUSES))
def test_quantity_invariants(wines, house_key):
    for seed in (1, 2, 3):
        for line in make_delivery(wines, house_key, seed=seed).lines:
            o = line.outcome
            received = o.accepted_qty + o.rejected_qty
            billable = max(0, received - o.free_goods_qty)

            for name, value in (
                ("ordered", o.ordered_qty),
                ("accepted", o.accepted_qty),
                ("rejected", o.rejected_qty),
                ("free_goods", o.free_goods_qty),
            ):
                assert isinstance(value, int), f"{name} must be an int, got {value!r}"
                assert value >= 0, f"{name} negative: {value}"

            assert o.free_goods_qty <= received
            assert billable <= received
            assert line.bottles_per_case >= 1
            # Case/bottle split must reconstruct the billed quantity exactly, or
            # the printed document contradicts its own total.
            if o.invoice_qty is not None:
                assert (
                    line.invoice_full_cases * line.bottles_per_case
                    + line.invoice_loose_bottles
                    == o.invoice_qty
                )
                assert 0 <= line.invoice_loose_bottles < line.bottles_per_case


# ---------------------------------------------------------------------------
# Degradation guard
# ---------------------------------------------------------------------------


def _page(text_rows: int = 40) -> np.ndarray:
    """A synthetic page: white ground with dark horizontal strokes."""
    img = np.full((600, 800, 3), 250, np.uint8)
    for i in range(text_rows):
        y = 8 + i * 14
        img[y : y + 4, 40:760] = 30
    return img


def test_stroke_density_ignores_uniform_darkening():
    """The metric that replaced ink coverage must not be fooled by shadow.

    Counting dark pixels reported over 1000% 'retention' on a shadowed photo
    while text was being destroyed, because shadow pushes paper below the ink
    threshold. Edge density is invariant to a uniform gain, which is the whole
    reason for the switch — lock it in.
    """
    page = _page()
    darkened = (page.astype(np.float32) * 0.55).astype(np.uint8)
    before, after = stroke_density(page), stroke_density(darkened)
    assert after <= before * 1.15, (
        f"darkening raised stroke density {before:.4f} -> {after:.4f}; "
        "the metric is being fooled by shadow again"
    )


def test_assert_legible_passes_an_untouched_page():
    page = _page()
    assert assert_legible(page, page.copy()) == pytest.approx(1.0)


def test_assert_legible_rejects_an_erased_page():
    page = _page()
    blank = np.full_like(page, 250)
    with pytest.raises(IllegibleSampleError):
        assert_legible(page, blank)


def test_phone_bad_is_not_offered_to_low_contrast_media():
    """Measured at 22-25% stroke retention on carbon and thermal even at 300dpi.

    Degradation must make reading hard, never impossible; an unreadable artifact
    is not a hard test case, it is one no extractor could fairly be scored on.
    """
    for medium in ("carbon_copy", "thermal"):
        assert "phone_bad" not in PROFILES_BY_MEDIUM[medium]


def test_every_medium_maps_to_known_profiles():
    for medium, keys in PROFILES_BY_MEDIUM.items():
        assert keys, f"{medium} has no profiles"
        for key in keys:
            assert key in PROFILES, f"{medium} references unknown profile {key!r}"


def test_every_house_medium_has_a_profile_list():
    for h in HOUSES.values():
        assert h.medium in PROFILES_BY_MEDIUM, (
            f"{h.key} has medium {h.medium!r} with no degradation profiles"
        )


def test_profiles_are_all_reachable_from_some_medium():
    """An unreachable profile is dead configuration that looks like coverage."""
    reachable = {k for keys in PROFILES_BY_MEDIUM.values() for k in keys}
    assert set(PROFILES) - reachable == set()


# ---------------------------------------------------------------------------
# Rendering: no sentinels, no unrendered template, no ground-truth leakage
# ---------------------------------------------------------------------------

#: A Python sentinel that reached the page appears in a VALUE position — alone
#: inside an element, or straight after a currency sign.
#:
#: Do not loosen this. Three earlier versions were all false-positive machines:
#:   * bare substring "nan"           matches "prove(nan)ce"
#:   * case-insensitive "none"        matches SVG fill="none" and CSS border:none
#:   * word-boundary "None" in text   matches the copy "None issued. A claim is
#:                                    not a recovery until one lands."
#: Case-sensitive, value-position-only is what makes it precise.
SENTINEL = re.compile(r">\s*(None|nan|NaN|undefined|Infinity)\s*<|\$\s*(None|nan|NaN)\b")
UNRENDERED = re.compile(r"\{\{|\{%")

EDGE_CASES = [
    ("meridian", ["clean"] * 5),
    ("meridian", ["no_invoice_yet"] * 5),
    ("meridian", ["damaged"] * 4),
    ("meridian", ["price_creep"] * 4),
    ("harborpoint", ["overbilled_vs_ship"] * 4),
    ("cellarbrook", ["free_goods_no_slip"] * 4),
    ("tri_state", ["split_case"] * 4),
    ("goldenstate", ["freight_allocated"] * 4),
    ("vinequarter", ["qty_short"] * 3),
]


def _sentinel_hits(html: str) -> list[str]:
    return [g for m in SENTINEL.finditer(html) for g in m.groups() if g] + (
        UNRENDERED.findall(html)
    )


@pytest.mark.parametrize("house_key", sorted(HOUSES))
def test_house_template_renders_clean(wines, house_key):
    h = house(house_key)
    html = render_html(h.template, render_context(make_delivery(wines, house_key)))
    assert _sentinel_hits(html) == []


@pytest.mark.parametrize("house_key,forced", EDGE_CASES)
def test_wineops_document_renders_clean(wines, house_key, forced):
    d = make_delivery(wines, house_key, forced=forced)
    html = render_html("wineops_document.html", build_context(d))
    assert _sentinel_hits(html) == []


def visible_text(html: str) -> str:
    """The text a renderer actually puts on the page.

    Scoped to rendered text, not source, because the extractor's input is a PDF or
    a photograph — Chrome does not carry `<style>` bodies or HTML comments into
    either. The house templates DO discuss verdicts in their design comments
    (explaining why a layout is hard is the point of those comments), and stripping
    them here is correct rather than lenient: a design note that never renders
    cannot leak. What must stay clean is anything that reaches the page.
    """
    stripped = re.sub(
        r"<style.*?</style>|<script.*?</script>|<!--.*?-->", " ", html, flags=re.S
    )
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", stripped)).lower()


@pytest.mark.parametrize("house_key", sorted(HOUSES))
def test_vendor_documents_do_not_leak_ground_truth(wines, house_key):
    """The answer must not be recoverable from the extractor's input.

    Vendor documents are the input. `wineops_document.html` is our own OUTPUT and
    legitimately displays verdicts, so it is excluded — a leak there is a feature.
    """
    h = house(house_key)
    d = make_delivery(wines, house_key)
    text = visible_text(render_html(h.template, render_context(d)))

    # Only underscored machine identifiers are answer-key shaped. Single-word keys
    # and verdicts are ordinary English and match innocent prose: `damaged` is
    # inside "undamaged containers" in the returns boilerplate, `clean` and
    # `partial` are words a real invoice may legitimately use. Asserting on those
    # tests the vocabulary of commercial English, not for leakage.
    identifiers = {s.scenario for s in d.lines if "_" in s.scenario}
    identifiers |= {v for v in ALL_VERDICTS if "_" in v}
    identifiers |= {"expected_verdict", "known_failing", "ground truth"}

    for token in sorted(identifiers):
        assert token not in text, f"{token!r} reached the page"


@pytest.mark.parametrize("house_key", sorted(HOUSES))
def test_vendor_documents_carry_the_synthetic_mark(wines, house_key):
    """Non-negotiable provenance. These must never pass as genuine documents."""
    h = house(house_key)
    html = render_html(h.template, render_context(make_delivery(wines, house_key)))
    assert "SYNTHETIC" in html
    assert "NOT A GENUINE COMMERCIAL DOCUMENT" in html


# ---------------------------------------------------------------------------
# Anti-noise semantics on the WineOps document
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "house_key,forced",
    [
        ("tri_state", ["split_case"] * 4),
        ("cellarbrook", ["free_goods_no_slip"] * 4),
        ("goldenstate", ["freight_allocated"] * 4),
        ("meridian", ["clean"] * 4),
    ],
)
def test_false_alarm_scenarios_show_no_discrepancies(wines, house_key, forced):
    """Split cases, agreed free goods and allocated freight are matches.

    A document that flags any of them teaches the manager to stop reading it.
    """
    ctx = build_context(make_delivery(wines, house_key, forced=forced))
    assert ctx["summary"]["discrepancy_count"] == 0
    assert ctx["summary"]["dollars_at_risk"] == 0.0


def test_price_variance_is_a_discrepancy_but_not_a_claim(wines):
    """Being billed above the agreed price is worth a decision, not a credit."""
    ctx = build_context(make_delivery(wines, "meridian", forced=["price_creep"] * 4))
    assert ctx["summary"]["discrepancy_count"] == 4
    assert ctx["summary"]["claim_count"] == 0


def test_missing_invoice_is_never_treated_as_agreement(wines):
    ctx = build_context(make_delivery(wines, "meridian", forced=["no_invoice_yet"] * 4))
    assert ctx["summary"]["has_invoice"] is False
    assert ctx["summary"]["claim_count"] == 0
    assert ctx["summary"]["dollars_at_risk"] == 0.0
    # Absence must be a rendered state, not a blank.
    invoice_card = next(p for p in ctx["provenance"] if p["doc"] == "Vendor invoice")
    assert invoice_card["have"] is False
    assert invoice_card["absent_note"]


def test_landed_cost_reported_unknowable_rather_than_guessed(wines):
    """Cellarbrook buries carriage in the unit price and says so nowhere.

    The honest output is 'unknown', never a number that looks authoritative.
    """
    ctx = build_context(make_delivery(wines, "cellarbrook"))
    assert ctx["summary"]["landed_cost_knowable"] is False
    assert all(s.landed_unit_cost is None for s in ctx["spine"])


def test_landed_cost_equals_billed_price_when_nothing_is_allocated(wines):
    ctx = build_context(make_delivery(wines, "meridian", forced=["clean"] * 3))
    for s in ctx["spine"]:
        assert s.landed_unit_cost == pytest.approx(s.billed_unit_price, abs=0.01)


def test_landed_cost_is_free_goods_aware(wines):
    """11 for the price of 10 must LOWER cost per usable bottle, not raise it.

    Needs a house that issues no packing slip (so `free_goods_no_slip` is
    eligible) but still itemises carriage in the footer (so landed cost is
    computable at all). Vine Quarter is the only house that is both — Cellarbrook
    buries freight in the unit price and correctly reports landed cost as unknown.
    """
    ctx = build_context(
        make_delivery(wines, "vinequarter", forced=["free_goods_no_slip"] * 3)
    )
    assert ctx["summary"]["landed_cost_knowable"] is True
    checked = 0
    for s in ctx["spine"]:
        assert s.free_goods > 0, "scenario should have produced free goods"
        assert s.landed_unit_cost is not None
        assert s.landed_unit_cost < s.billed_unit_price, (
            f"free goods raised landed cost: {s.landed_unit_cost} "
            f"vs billed {s.billed_unit_price}"
        )
        # The bottles arrived, so they must be in the accepted count.
        assert s.accepted == s.billed + s.free_goods
        checked += 1
    assert checked == 3


def test_claimable_lines_are_always_discrepant(wines):
    for house_key in sorted(HOUSES):
        for s in build_context(make_delivery(wines, house_key))["spine"]:
            if s.is_claimable:
                assert s.is_discrepant
