"""
Unit tests for ConstraintEngine (D-32-14).
Tests validate all hard constraint categories and annotating constraints.
"""
import pytest
from services.constraint_engine import get_constraint_engine, ConstraintResult


@pytest.fixture
def ce():
    return get_constraint_engine()


def test_hard_c01_topic_lock_blocks_off_topic(ce):
    r = ce.check_hard_constraints("What's your favorite restaurant?")
    assert r.blocked is True
    assert "C-01" in r.triggered_hard


def test_hard_c01_wine_topic_passes(ce):
    r = ce.check_hard_constraints("We're interested in 4 cases of Burgundy Pinot Noir.")
    assert "C-01" not in r.triggered_hard


def test_hard_c02_commitment_guard_blocks(ce):
    r = ce.check_hard_constraints("We agree to buy 6 cases at the offered price.")
    assert r.blocked is True
    assert "C-02" in r.triggered_hard


def test_hard_c02_interest_not_commitment_passes(ce):
    r = ce.check_hard_constraints("We're interested in 6 cases of Burgundy — what's your price?")
    assert "C-02" not in r.triggered_hard


def test_hard_c21_pii_ssn_blocks_sensitive(ce):
    r = ce.check_hard_constraints("My SSN is 123-45-6789")
    assert r.blocked is True
    assert r.is_sensitive is True
    assert "C-21" in r.triggered_hard


def test_hard_c19_three_tier_blocks(ce):
    r = ce.check_hard_constraints("Can we go direct-from-winery on this allocation?")
    assert r.blocked is True
    assert "C-19" in r.triggered_hard


def test_hard_c03_quantity_cap_blocks(ce):
    r = ce.check_hard_constraints("Interested in wine", quantity=10.0, order_quantity=4.0)
    assert r.blocked is True
    assert "C-03" in r.triggered_hard


def test_hard_c03_quantity_within_cap_passes(ce):
    r = ce.check_hard_constraints("Interested in wine", quantity=5.0, order_quantity=4.0)
    assert "C-03" not in r.triggered_hard


def test_hard_c05_round_limit_blocks(ce):
    r = ce.check_hard_constraints("Interested in wine delivery", round_count=6, max_rounds=6)
    assert r.blocked is True
    assert "C-05" in r.triggered_hard


def test_annotating_c09_stale_price(ce):
    r = ce.check_annotating_constraints(stale_price=True, stale_price_date="2026-04-01", last_price=45.0)
    assert r.blocked is False
    assert "C-09" in r.triggered_annotating
    assert any("C-09" in a["code"] for a in r.annotations)


def test_annotating_c14_outstanding_invoice(ce):
    r = ce.check_annotating_constraints(outstanding_invoice=True, invoice_number="INV-1042")
    assert r.blocked is False
    assert "C-14" in r.triggered_annotating


def test_length_cap_180_words_blocks(ce):
    long_text = "wine " * 200
    r = ce.check_length_cap(long_text)
    assert r.blocked is True
    assert "C-06" in r.triggered_hard


def test_length_cap_short_passes(ce):
    r = ce.check_length_cap("Short inquiry about 2 cases of Burgundy.")
    assert r.blocked is False
