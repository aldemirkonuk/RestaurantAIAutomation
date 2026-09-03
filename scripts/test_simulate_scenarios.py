"""Tests for the ADR 0093 scenario engine (scripts/simulate/scenarios.py).

Run: python3 -m pytest scripts/test_simulate_scenarios.py -q

Offline by construction. Nothing here needs Supabase, a gateway or a network:
the engine's whole job is to produce a document — the expectation — and every
property worth asserting about that document is a property of the document.

What these tests are actually protecting, in order of how expensive the failure
would be to discover later:

* **The expectation is reproducible.** Two runs of one seed must produce the same
  bytes, or a "regression" downstream is indistinguishable from a different day.
* **Time is the venue's, not the simulator's.** Every check lands inside a
  service window except the one whose entire point is to be outside, and the
  count of the exceptions is exactly one.
* **The keys match the receiver.** A line's idempotency key is recomputed here
  from the check id and the line index over ALL items, food included. If this
  drifts, a duplicate stops deduping and the run silently doubles a night's
  depletion.
* **A dry run is inert.** No socket, no write, no exception to that.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.simulate import bridge as bridge_mod  # noqa: E402
from scripts.simulate import scenarios as scn  # noqa: E402
from scripts.simulate import scenario_apply as apply_mod  # noqa: E402
from scripts.simulate.detection import looks_like_wine  # noqa: E402
from scripts.simulate.hours import is_open_at  # noqa: E402
from scripts.simulate.mappings import build_mappings  # noqa: E402
from scripts.simulate.payloads import canonical_check  # noqa: E402
from scripts.simulate.payloads import line_idempotency_key  # noqa: E402
from scripts.simulate.service import FOOD_ITEMS, WineList  # noqa: E402

MENU = REPO_ROOT / "datasets" / "sim" / "menus" / "bistro.json"
FIXTURE = REPO_ROOT / "datasets" / "sim" / "fixtures" / "operating-hours-cases.json"
POS_HUB_SERVICE = (
    REPO_ROOT / "apps" / "api-gateway" / "src" / "pos-hub" / "pos-hub.service.ts"
)

#: A Wednesday. The bistro fixture is open 12:00-23:00 on it, and closed on
#: Monday — which is what makes both `closed_day` and everything else testable
#: against ONE set of hours.
SERVICE_DATE = date(2026, 9, 2)
SEED = 7
TZ = "America/Chicago"


@pytest.fixture(scope="module")
def menu_items() -> list[dict]:
    return json.loads(MENU.read_text())["items"]


@pytest.fixture(scope="module")
def hours() -> dict:
    return json.loads(FIXTURE.read_text())["hours"]["bistro"]


@pytest.fixture(scope="module")
def wine_list(menu_items) -> WineList:
    return WineList.from_snapshot(menu_items)


def make_ctx(menu_items, hours, wine_list, *, seed=SEED, day=SERVICE_DATE, tz=TZ):
    return scn.ScenarioContext(
        archetype_id="bistro",
        wine_list=wine_list,
        operating_hours=hours,
        timezone=tz,
        service_date=day,
        seed=seed,
        inventory=scn.build_inventory_from_archetype("bistro", menu_items),
        mappings=build_mappings(wine_list),
        base_covers=80,
        hours_source="fixture",
        inventory_source="archetype",
    )


def build(menu_items, hours, wine_list, scenario, **kwargs):
    ctx = make_ctx(menu_items, hours, wine_list, **kwargs)
    expectation, outcomes = scn.build_expectation(ctx, scenario)
    return ctx, expectation, expectation.to_json(), outcomes


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


def test_same_seed_produces_identical_expectation_json(menu_items, hours, wine_list):
    a = build(menu_items, hours, wine_list, "random")[2]
    b = build(menu_items, hours, wine_list, "random")[2]
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def test_different_seed_produces_a_different_expectation(menu_items, hours, wine_list):
    a = build(menu_items, hours, wine_list, "random", seed=7)[2]
    b = build(menu_items, hours, wine_list, "random", seed=8)[2]
    assert json.dumps(a, sort_keys=True) != json.dumps(b, sort_keys=True)


def test_check_ids_are_stable_across_runs(menu_items, hours, wine_list):
    """A replay must be a no-op at the hub, not a doubled day."""
    first = [
        c["external_check_id"]
        for c in build(menu_items, hours, wine_list, "service")[2]["checks"]
    ]
    second = [
        c["external_check_id"]
        for c in build(menu_items, hours, wine_list, "service")[2]["checks"]
    ]
    assert first == second
    assert len(set(first)) == len(first), "two checks share an id"


# ---------------------------------------------------------------------------
# The contract
# ---------------------------------------------------------------------------


def test_contract_snapshot_has_every_top_level_key(menu_items, hours, wine_list):
    expected = build(menu_items, hours, wine_list, "random")[2]
    assert set(expected) == set(scn.CONTRACT_KEYS)
    assert expected["contract_version"] == 1
    assert expected["source"] == "generic_webhook"


def test_every_expect_value_is_one_the_verifier_knows(menu_items, hours, wine_list):
    for scenario in scn.SCENARIO_IDS:
        if scenario == "closed_day":
            continue
        expected = build(menu_items, hours, wine_list, scenario)[2]
        for check in expected["checks"]:
            for line in check["lines"]:
                assert (
                    line["expect"] in scn.EXPECT_VALUES
                ), f"{scenario}: unknown expect {line['expect']!r}"


def test_food_lines_carry_no_idempotency_key(menu_items, hours, wine_list):
    """The hub `continue`s past food before `idem` is ever computed."""
    expected = build(menu_items, hours, wine_list, "random")[2]
    food = [
        line
        for check in expected["checks"]
        for line in check["lines"]
        if not line["is_wine"]
    ]
    assert food, "no food lines in the composition — the assertion would be vacuous"
    assert all(line["idempotency_key"] is None for line in food)


def test_queued_lines_carry_no_idempotency_key(menu_items, hours, wine_list):
    """An unresolved line is queued BEFORE the key is computed, so it has none."""
    expected = build(menu_items, hours, wine_list, "unmapped_item")[2]
    queued = [
        line
        for check in expected["checks"]
        for line in check["lines"]
        if line["expect"].startswith("unresolved_")
    ]
    assert queued, "unmapped_item produced no queued line"
    assert all(line["idempotency_key"] is None for line in queued)


# ---------------------------------------------------------------------------
# Idempotency keys — the shape the receiver computes
# ---------------------------------------------------------------------------


def test_every_line_key_equals_what_the_receiver_computes(menu_items, hours, wine_list):
    expected = build(menu_items, hours, wine_list, "random")[2]
    checked = 0
    for check in expected["checks"]:
        for line in check["lines"]:
            if line["idempotency_key"] is None:
                continue
            assert line["idempotency_key"] == line_idempotency_key(
                check["external_check_id"],
                line["external_item_id"],
                line["name"],
                line["line_no"],
            )
            checked += 1
    assert checked > 0, "no keyed lines — the assertion would be vacuous"


def test_line_no_indexes_every_item_food_included(menu_items, hours, wine_list):
    """`applyStockEffects` loops over the FULL item list and skips food inside it.

    A wine on a check whose first two lines are food is line 2. Numbering wine
    lines from zero would predict keys the hub never writes — and the duplicate
    scenario would then look like a bug in the product.
    """
    expected = build(menu_items, hours, wine_list, "random")[2]
    saw_wine_after_food = False
    for check in expected["checks"]:
        assert [line["line_no"] for line in check["lines"]] == list(
            range(len(check["lines"]))
        )
        seen_food = False
        for line in check["lines"]:
            if not line["is_wine"]:
                seen_food = True
            elif seen_food and line["idempotency_key"]:
                assert line["idempotency_key"].endswith(f":{line['line_no']}")
                assert line["line_no"] > 0
                saw_wine_after_food = True
    assert saw_wine_after_food, "no check has wine after food — assertion vacuous"


def test_key_template_matches_the_typescript_source():
    """A drifted key silently stops deduping. Kept in lockstep, like WINE_WORDS."""
    source = POS_HUB_SERVICE.read_text()
    assert (
        "`pos:${source}:${check.externalCheckId}:${it.external_item_id ?? it.name}:${lineNo}`"
        in source
    ), "the depletion idempotency key in pos-hub.service.ts no longer matches payloads.line_idempotency_key"


def test_sale_volume_mirror_still_matches_the_typescript_constants():
    """`resolve_sale_volume` reproduces branches; these are the numbers in them."""
    source = POS_HUB_SERVICE.read_text()
    assert re.search(r"RPC_DEFAULT_BOTTLE_ML\s*=\s*750", source)
    assert re.search(r"MIN_PLAUSIBLE_SALE_ML\s*=\s*10", source)
    assert 'if (label === "bottle")' in source
    assert 'if (label === "glass")' in source
    assert scn.RPC_DEFAULT_BOTTLE_ML == 750
    assert scn.MIN_PLAUSIBLE_SALE_ML == 10


@pytest.mark.parametrize(
    "volume,unit,bottle,pour,expected_mode",
    [
        (None, "bottle", None, 150.0, "whole_bottle"),
        (None, "glass", None, 150.0, "volume"),
        (None, "glass", None, None, "unresolved"),
        (None, None, None, 150.0, "unresolved"),
        (None, "carafe", None, 150.0, "unresolved"),
        (60, "glass", None, 150.0, "volume"),
        (5, "glass", None, 150.0, "unresolved"),
        (900, "glass", None, 150.0, "unresolved"),
        (750, "glass", 750, 150.0, "whole_bottle"),
    ],
)
def test_resolve_sale_volume_mirrors_the_hub(volume, unit, bottle, pour, expected_mode):
    row = scn.InventoryRow(
        id="i",
        signature_hash="s",
        wine_name="w",
        master_wine_id=None,
        stock_live=12,
        threshold_min=5,
        bottle_size_ml=bottle,
        pour_size_ml=pour,
    )
    assert scn.resolve_sale_volume(volume, unit, row).mode == expected_mode


# ---------------------------------------------------------------------------
# Time — every instant comes from the venue's hours
# ---------------------------------------------------------------------------


def test_every_check_is_inside_a_window_except_the_after_hours_one(
    menu_items, hours, wine_list
):
    ctx = make_ctx(menu_items, hours, wine_list)
    for scenario in scn.SCENARIO_IDS:
        if scenario == "closed_day":
            continue
        expectation = scn.build_expectation(
            make_ctx(menu_items, hours, wine_list), scenario
        )[0]
        for check in expectation.checks:
            inside = ctx.is_inside_hours(check.opened_at)
            if check.scenario == "after_hours_order":
                assert not inside, "the after-hours check landed inside opening hours"
                assert check.outside_hours is True
            else:
                assert (
                    inside
                ), f"{check.scenario} opened at {check.opened_at} — outside every window"
                assert check.outside_hours is False


def test_outside_hours_count_counts_exactly_those(menu_items, hours, wine_list):
    expected = build(menu_items, hours, wine_list, "after_hours_order")[2]
    assert expected["outside_hours_count"] == 1
    assert sum(1 for c in expected["checks"] if c["outside_hours"]) == 1

    service = build(menu_items, hours, wine_list, "service")[2]
    assert service["outside_hours_count"] == 0


def test_after_hours_check_is_recorded_not_rejected(menu_items, hours, wine_list):
    """ADR 0093 D3: flagged, never dropped. It is still posted."""
    expected = build(menu_items, hours, wine_list, "after_hours_order")[2]
    check = expected["checks"][0]
    assert check["posted"] is True
    assert check["outside_hours"] is True
    assert (
        is_open_at(
            hours, TZ, datetime.fromisoformat(check["opened_at"].replace("Z", "+00:00"))
        ).open
        is False
    )


def test_opening_minute_is_one_minute_after_the_doors_open(
    menu_items, hours, wine_list
):
    ctx, _expectation, expected, _outcomes = build(
        menu_items, hours, wine_list, "opening_minute"
    )
    check = expected["checks"][0]
    opened = datetime.fromisoformat(check["opened_at"].replace("Z", "+00:00"))
    assert opened == ctx.windows[0][0] + timedelta(minutes=1)
    closed = datetime.fromisoformat(check["closed_at"].replace("Z", "+00:00"))
    assert closed - opened == timedelta(minutes=40)
    assert check["covers"] == 1


def test_opening_minute_orders_a_coffee_and_a_glass(menu_items, hours, wine_list):
    """The founder's sentence, asserted as a shape rather than as prose."""
    expected = build(menu_items, hours, wine_list, "opening_minute")[2]
    lines = expected["checks"][0]["lines"]
    assert len(lines) == 2
    coffee, wine = lines
    assert coffee["is_wine"] is False
    assert coffee["name"] in {name for name, cat, _ in FOOD_ITEMS if cat == "Coffee"}
    assert wine["is_wine"] is True
    assert wine["expect"] in ("volume", "bottle")


def test_coffee_is_on_the_menu_and_does_not_read_as_wine():
    coffees = [item for item in FOOD_ITEMS if item[1] == "Coffee"]
    assert {c[0] for c in coffees} == {"Espresso", "Cappuccino", "Filter Coffee"}
    for name, _category, _price in coffees:
        assert not looks_like_wine(name)
    names = [item[0] for item in FOOD_ITEMS]
    assert len(names) == len(set(names)), "a duplicate food name collapses two mappings"


# ---------------------------------------------------------------------------
# The individual scenarios
# ---------------------------------------------------------------------------


def test_two_tables_two_minutes_apart_with_five_bottles(menu_items, hours, wine_list):
    expected = build(menu_items, hours, wine_list, "two_tables_two_minutes")[2]
    assert len(expected["checks"]) == 2
    first, second = expected["checks"]
    assert first["table_label"] != second["table_label"]
    a = datetime.fromisoformat(first["opened_at"].replace("Z", "+00:00"))
    b = datetime.fromisoformat(second["opened_at"].replace("Z", "+00:00"))
    assert (b - a).total_seconds() == 120
    wine_lines = [line for line in second["lines"] if line["is_wine"]]
    assert len(wine_lines) == 1
    assert wine_lines[0]["qty"] == 5
    assert wine_lines[0]["expect"] == "bottle"
    assert wine_lines[0]["bottles"] == 5


def test_two_tables_records_its_placement(menu_items, hours, wine_list):
    expected = build(menu_items, hours, wine_list, "two_tables_two_minutes")[2]
    params = expected["scenarios"][0]["params"]
    assert params["placement"] in (
        "14:00_local",
        "first_open_minute_after_1400",
        "fallback_open_plus_2h",
    )


def test_two_tables_falls_back_and_says_so_on_a_lunch_only_venue(menu_items, wine_list):
    """A venue shut by 14:00 gets open+2h — and `params` says which rule fired."""
    lunch_only = {
        day: [{"open": "11:00", "close": "13:30"}]
        for day in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
    }
    expected = build(menu_items, lunch_only, wine_list, "two_tables_two_minutes")[2]
    params = expected["scenarios"][0]["params"]
    assert params["placement"] == "fallback_open_plus_2h"
    assert "placement_reason" in params


def test_sell_through_crosses_par_and_appears_in_low_stock(
    menu_items, hours, wine_list
):
    expected = build(menu_items, hours, wine_list, "sell_through_to_par")[2]
    params = expected["scenarios"][0]["params"]
    assert 2 <= params["checks"] <= 4

    target = [
        row
        for row in expected["depletion"]
        if row["inventory_id"] == params["inventory_id"]
    ]
    assert len(target) == 1
    row = target[0]
    assert (
        row["expected_stock_live"] < row["threshold_min"]
    ), "the scenario did not actually cross par"
    assert params["inventory_id"] in {r["inventory_id"] for r in expected["low_stock"]}


def test_unmapped_item_queues_one_line_as_unmapped(menu_items, hours, wine_list):
    expected = build(menu_items, hours, wine_list, "unmapped_item")[2]
    assert expected["unresolved"] == {"count": 1, "by_reason": {"unmapped": 1}}
    line = [
        line
        for check in expected["checks"]
        for line in check["lines"]
        if line["expect"] == "unresolved_unmapped"
    ][0]
    # The hub's heuristic must still read it as wine, or it lands as food and
    # never reaches the queue at all.
    assert looks_like_wine(line["name"])
    assert line["is_wine"] is True
    assert line["inventory_id"] is None


def test_unmapped_line_matches_no_mapping_by_id_or_by_name(
    menu_items, hours, wine_list
):
    """`resolveWine` tries the external id AND an exact lowercased name."""
    ctx, _expectation, expected, _outcomes = build(
        menu_items, hours, wine_list, "unmapped_item"
    )
    line = [
        line
        for check in expected["checks"]
        for line in check["lines"]
        if line["expect"] == "unresolved_unmapped"
    ][0]
    assert ctx.mapping_for(line["external_item_id"], line["name"]) is None


def test_void_posts_twice_and_nets_to_zero(menu_items, hours, wine_list):
    ctx, expectation, expected, _outcomes = build(
        menu_items, hours, wine_list, "void_after_close"
    )
    assert expected["voided_check_ids"] == [expected["checks"][0]["external_check_id"]]
    line = expected["checks"][0]["lines"][0]
    assert line["expect"] == "void_return"

    posts = expectation.checks[0].posts()
    assert [p.voided for p in posts] == [False, True]
    assert posts[0].external_check_id == posts[1].external_check_id

    row = [
        r for r in expected["depletion"] if r["inventory_id"] == line["inventory_id"]
    ][0]
    assert row["bottles"] == 0
    assert row["expected_stock_live"] == row["opening_stock_live"]
    assert row["void_return"] is True


def test_void_scenario_records_the_dedupe_risk_rather_than_assuming_it_works(
    menu_items, hours, wine_list
):
    """The expectation says what a void SHOULD do; the risk is named, not hidden."""
    expected = build(menu_items, hours, wine_list, "void_after_close")[2]
    risks = expected["scenarios"][0]["params"]["known_risks"]
    assert any("idempotency key" in risk for risk in risks)


def test_duplicate_posts_twice_but_depletes_once(menu_items, hours, wine_list):
    ctx, expectation, expected, _outcomes = build(
        menu_items, hours, wine_list, "duplicate_webhook"
    )
    check = expectation.checks[0]
    assert check.post_count == 2
    posts = check.posts()
    assert len(posts) == 2
    # Byte-identical, or the hub sees two different checks rather than a replay.
    assert bridge_mod._encode(canonical_check(posts[0])) == bridge_mod._encode(
        canonical_check(posts[1])
    )
    assert expected["duplicate_check_ids"] == [check.external_check_id]

    bottle_line = [
        line for line in expected["checks"][0]["lines"] if line["expect"] == "bottle"
    ][0]
    row = [
        r
        for r in expected["depletion"]
        if r["inventory_id"] == bottle_line["inventory_id"]
    ][0]
    assert row["bottles"] == bottle_line["bottles"], "a duplicate was counted twice"


def test_dropped_check_is_absent_from_depletion_and_posted_totals(
    menu_items, hours, wine_list
):
    ctx, expectation, expected, _outcomes = build(
        menu_items, hours, wine_list, "dropped_webhook"
    )
    check = expectation.checks[0]
    assert check.posts() == []
    assert expected["dropped_check_ids"] == [check.external_check_id]
    assert expected["totals"]["checks"] == 1
    assert expected["totals"]["posted_checks"] == 0
    assert expected["totals"]["wine_lines"] == 0
    assert expected["depletion"] == []
    assert expected["scenarios"][0]["unverifiable"]


def test_closed_day_generates_nothing(menu_items, hours, wine_list):
    day, reason = scn.resolve_service_date("closed_day", hours, SERVICE_DATE)
    assert reason.startswith("moved_to_next_") or reason == "requested"
    expected = build(menu_items, hours, wine_list, "closed_day", day=day)[2]
    entry = expected["scenarios"][0]
    if "unverifiable" in entry:
        assert entry["params"].get("reason")
    else:
        assert entry["params"]["closed_day"] is True
        assert expected["checks"] == []
        assert expected["totals"]["checks"] == 0


def test_closed_day_declares_itself_unverifiable_on_an_always_open_venue(
    menu_items, wine_list
):
    always_open = {
        day: [{"open": "00:00", "close": "23:59"}]
        for day in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
    }
    expected = build(menu_items, always_open, wine_list, "closed_day")[2]
    entry = expected["scenarios"][0]
    assert entry["unverifiable"]
    assert entry["params"]["reason"]


# ---------------------------------------------------------------------------
# Composition
# ---------------------------------------------------------------------------


def test_random_is_service_plus_two_to_five_others(menu_items, hours, wine_list):
    for seed in range(1, 12):
        composed = scn.compose("random", seed)
        assert composed[0] == "service"
        assert 2 <= len(composed) - 1 <= 5
        assert "closed_day" not in composed, "closed_day would move the run's date"
        assert len(set(composed)) == len(composed)


def test_random_gives_every_composed_scenario_at_least_one_check(
    menu_items, hours, wine_list
):
    for seed in (1, 7, 13):
        expected = build(menu_items, hours, wine_list, "random", seed=seed)[2]
        composed = scn.compose("random", seed)
        assert [entry["id"] for entry in expected["scenarios"]] == composed
        for entry in expected["scenarios"]:
            if entry.get("unverifiable"):
                continue
            assert entry["check_ids"], f"{entry['id']} contributed no checks"


def test_every_scenario_in_the_library_builds_on_the_bistro(
    menu_items, hours, wine_list
):
    """A scenario that raises is a scenario nobody can run. It may decline; not throw."""
    for definition in scn.LIBRARY:
        day = SERVICE_DATE
        if definition.changes_date:
            day = scn.resolve_service_date(definition.id, hours, SERVICE_DATE)[0]
        ctx = make_ctx(menu_items, hours, wine_list, day=day)
        outcome = definition.build(ctx)
        assert outcome.checks or outcome.unverifiable or definition.id == "closed_day"


def test_tables_lists_every_label_the_day_uses(menu_items, hours, wine_list):
    expected = build(menu_items, hours, wine_list, "random")[2]
    used = {check["table_label"] for check in expected["checks"]}
    assert {table["label"] for table in expected["tables"]} == used
    assert all(table["seats"] >= 2 for table in expected["tables"])


def test_service_fills_every_open_window(menu_items, wine_list):
    """A lunch and a dinner service each get their own peak — the 17:00 UTC curve could not."""
    split = {
        day: [
            {"open": "11:30", "close": "14:30"},
            {"open": "17:30", "close": "22:00"},
        ]
        for day in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
    }
    ctx, expectation, _expected, _outcomes = build(
        menu_items, split, wine_list, "service"
    )
    assert len(ctx.windows) == 2
    per_window = [0, 0]
    for check in expectation.checks:
        for index, (start, end) in enumerate(ctx.windows):
            if start <= check.opened_at < end:
                per_window[index] += 1
    assert all(
        count > 0 for count in per_window
    ), f"a window got no traffic: {per_window}"


def test_weekend_service_is_heavier_than_monday(menu_items, hours, wine_list):
    """`covers_for` still drives the day, so the shape of a week survives."""
    open_all_week = {**hours, "mon": hours["tue"]}
    saturday = build(
        menu_items, open_all_week, wine_list, "service", day=date(2026, 9, 5)
    )[2]
    monday = build(
        menu_items, open_all_week, wine_list, "service", day=date(2026, 9, 7)
    )[2]
    assert saturday["totals"]["checks"] > monday["totals"]["checks"]


# ---------------------------------------------------------------------------
# Depletion arithmetic
# ---------------------------------------------------------------------------


def test_glass_pours_are_recorded_as_a_bound_not_as_a_certainty(
    menu_items, hours, wine_list
):
    """`record_glass_pour` opens a bottle only when the open one runs out."""
    expected = build(menu_items, hours, wine_list, "random")[2]
    poured = [row for row in expected["depletion"] if row["pour_ml"] > 0]
    assert poured, "no glass pours in the composition — the assertion would be vacuous"
    for row in poured:
        assert row["stock_live_is_upper_bound"] is True
        assert "bound_note" in row
        import math

        opened = math.ceil(row["pour_ml"] / row["bottle_size_ml"])
        assert row["expected_stock_live"] == max(
            0, row["opening_stock_live"] - row["bottles"] - opened
        )


def test_bottle_only_depletion_is_exact(menu_items, hours, wine_list):
    expected = build(menu_items, hours, wine_list, "sell_through_to_par")[2]
    row = expected["depletion"][0]
    assert row["pour_ml"] == 0
    assert "stock_live_is_upper_bound" not in row
    assert row["expected_stock_live"] == row["opening_stock_live"] - row["bottles"]


def test_expected_stock_never_goes_negative_and_says_when_it_would(
    menu_items, hours, wine_list
):
    expected = build(menu_items, hours, wine_list, "random")[2]
    for row in expected["depletion"]:
        assert row["expected_stock_live"] >= 0
        if row.get("oversold"):
            assert row["expected_stock_live_raw"] < 0


# ---------------------------------------------------------------------------
# The CLI: dry run is inert, --apply refuses what it cannot establish
# ---------------------------------------------------------------------------


def test_dry_run_opens_no_socket(monkeypatch, capsys):
    called: list[str] = []

    def explode(*args, **kwargs):  # pragma: no cover — must never run
        called.append("urlopen")
        raise AssertionError("dry run attempted a network call")

    monkeypatch.setattr(bridge_mod.urllib.request, "urlopen", explode)
    monkeypatch.setattr(apply_mod.urllib.request, "urlopen", explode)

    from scripts.simulate.cli import main

    code = main(
        [
            "scenario",
            "--archetype",
            "bistro",
            "--scenario",
            "random",
            "--seed",
            "7",
            "--date",
            "2026-09-02",
        ]
    )
    assert code == 0
    assert called == []
    out = capsys.readouterr().out
    assert "Dry run" in out
    assert "expected depletion" in out


def test_dry_run_writes_the_expectation_when_asked(monkeypatch, tmp_path, capsys):
    def explode(*args, **kwargs):  # pragma: no cover
        raise AssertionError("dry run attempted a network call")

    monkeypatch.setattr(bridge_mod.urllib.request, "urlopen", explode)
    from scripts.simulate.cli import main

    out_file = tmp_path / "expected.json"
    assert (
        main(
            [
                "scenario",
                "--archetype",
                "bistro",
                "--scenario",
                "opening_minute",
                "--date",
                "2026-09-02",
                "--out",
                str(out_file),
            ]
        )
        == 0
    )
    capsys.readouterr()
    document = json.loads(out_file.read_text())
    assert set(document) == set(scn.CONTRACT_KEYS)
    assert document["scenario"] == "opening_minute"


def test_list_prints_the_library_and_exits(capsys):
    from scripts.simulate.cli import main

    assert main(["scenario", "--list"]) == 0
    out = capsys.readouterr().out
    for definition in scn.LIBRARY:
        assert definition.id in out


def test_apply_refuses_without_a_restaurant(monkeypatch):
    from scripts.simulate.cli import main

    monkeypatch.setenv("SIM_OWNER_EMAIL", "owner@example.test")
    monkeypatch.setenv("SIM_OWNER_PASSWORD", "x")
    with pytest.raises(SystemExit) as exc:
        main(["scenario", "--archetype", "bistro", "--apply"])
    assert "--restaurant" in str(exc.value)


def test_apply_refuses_without_owner_credentials(monkeypatch):
    from scripts.simulate.cli import main

    monkeypatch.delenv("SIM_OWNER_EMAIL", raising=False)
    monkeypatch.delenv("SIM_OWNER_PASSWORD", raising=False)
    with pytest.raises(SystemExit) as exc:
        main(
            [
                "scenario",
                "--archetype",
                "bistro",
                "--apply",
                "--restaurant",
                "11111111-1111-1111-1111-111111111111",
            ]
        )
    assert "SIM_OWNER_EMAIL" in str(exc.value)


def test_apply_refuses_when_the_venue_has_no_hours(monkeypatch):
    """ADR 0020: unknown hours are unknown, not a plausible day."""
    from scripts.simulate import cli as cli_mod

    monkeypatch.setenv("SIM_OWNER_EMAIL", "owner@example.test")
    monkeypatch.setenv("SIM_OWNER_PASSWORD", "x")
    monkeypatch.setattr(apply_mod, "login", lambda *a, **k: "token")
    monkeypatch.setattr(
        apply_mod, "fetch_operating_hours", lambda *a, **k: (None, "America/Chicago")
    )
    with pytest.raises(SystemExit) as exc:
        cli_mod.main(
            [
                "scenario",
                "--archetype",
                "bistro",
                "--apply",
                "--restaurant",
                "11111111-1111-1111-1111-111111111111",
            ]
        )
    assert "venue hours unknown" in str(exc.value)


def test_apply_refuses_without_supabase_credentials(monkeypatch, hours):
    """The opening stock is read, never guessed — no key, no run."""
    from scripts.simulate import cli as cli_mod

    monkeypatch.setenv("SIM_OWNER_EMAIL", "owner@example.test")
    monkeypatch.setenv("SIM_OWNER_PASSWORD", "x")
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.setattr(apply_mod, "login", lambda *a, **k: "token")
    monkeypatch.setattr(
        apply_mod, "fetch_operating_hours", lambda *a, **k: (hours, "America/Chicago")
    )
    with pytest.raises(SystemExit) as exc:
        cli_mod.main(
            [
                "scenario",
                "--archetype",
                "bistro",
                "--apply",
                "--restaurant",
                "11111111-1111-1111-1111-111111111111",
            ]
        )
    assert "SUPABASE_SERVICE_ROLE_KEY" in str(exc.value)


def test_unknown_scenario_is_refused_by_name():
    from scripts.simulate.cli import main

    with pytest.raises(SystemExit) as exc:
        main(["scenario", "--scenario", "nope"])
    assert "Unknown scenario" in str(exc.value)


# ---------------------------------------------------------------------------
# Reads that fail must say so (ADR 0067)
# ---------------------------------------------------------------------------


def test_a_failed_inventory_read_raises_rather_than_returning_empty(monkeypatch):
    """An empty list here would be read as "this tenant has no wine"."""

    def boom(*args, **kwargs):
        raise apply_mod.urllib.error.URLError("connection refused")

    monkeypatch.setattr(apply_mod.urllib.request, "urlopen", boom)
    with pytest.raises(apply_mod.ScenarioApplyError):
        apply_mod.fetch_inventory("https://example.test", "key", "r-1")


def test_a_failed_login_raises_rather_than_returning_an_empty_token(monkeypatch):
    class _Response:
        status = 200

        def read(self):
            return b'{"success": true}'

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(
        apply_mod.urllib.request, "urlopen", lambda *a, **k: _Response()
    )
    with pytest.raises(apply_mod.ScenarioApplyError) as exc:
        apply_mod.login("https://example.test", "a@b.c", "x")
    assert "accessToken" in str(exc.value)


def test_the_only_non_product_write_is_the_run_row():
    """Every other write goes through the gateway. Asserted so it stays that way."""
    source = (REPO_ROOT / "scripts" / "simulate" / "scenario_apply.py").read_text()
    writes = re.findall(r'method="POST"', source)
    # login, upsert_tables, persist_run — and nothing else.
    assert len(writes) == 3
    assert "/rest/v1/sim_scenario_runs" in source
    assert source.count("/rest/v1/") == 2  # the inventory read and the run row


# ---------------------------------------------------------------------------
# The --apply path, driven end to end with a fake transport
#
# Nothing here touches a network — `urlopen` is replaced in both modules that
# hold one — but every other line of the apply path runs for real: the bridge,
# the signing, the ordering, the row that gets persisted. An apply path that is
# only ever exercised against a live gateway is an apply path whose NameErrors
# are found by the integrator.
# ---------------------------------------------------------------------------


class _FakeResponse:
    def __init__(self, payload: bytes, status: int = 200) -> None:
        self._payload = payload
        self.status = status

    def read(self) -> bytes:
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class _Transport:
    """Records every request and answers each route the run touches."""

    def __init__(self, fail_checks: bool = False) -> None:
        self.requests: list[tuple[str, str, dict, bytes]] = []
        self.fail_checks = fail_checks

    def __call__(self, request, timeout=None):  # noqa: ARG002 — urlopen's shape
        url = request.full_url
        body = request.data or b""
        self.requests.append((request.get_method(), url, dict(request.headers), body))
        if url.endswith("/auth/login"):
            return _FakeResponse(
                b'{"success":true,"accessToken":"tok","refreshToken":"r"}'
            )
        if "/operating-hours" in url:
            return _FakeResponse(
                json.dumps(
                    {
                        "timezone": TZ,
                        "operatingHours": json.loads(FIXTURE.read_text())["hours"][
                            "bistro"
                        ],
                    }
                ).encode()
            )
        if "/restaurant_inventory" in url:
            return _FakeResponse(json.dumps(self._inventory_rows()).encode())
        if "/sim_scenario_runs" in url:
            return _FakeResponse(b'[{"id":"run-1"}]')
        if "/analytics/tables/" in url:
            return _FakeResponse(b'{"ok":true}')
        if "/pos-hub/mappings/" in url:
            return _FakeResponse(b'{"ok":true}')
        if "/pos-hub/webhook/" in url:
            if self.fail_checks:
                raise apply_mod.urllib.error.HTTPError(url, 500, "boom", None, None)
            return _FakeResponse(b'{"upserted":1}')
        raise AssertionError(f"unexpected request to {url}")

    def _inventory_rows(self) -> list[dict]:
        from scripts.synth.seed import sim_inventory_id

        items = json.loads(MENU.read_text())["items"]
        rows, seen = [], set()
        for item in items:
            sig = item["signature_hash"]
            if sig in seen:
                continue
            seen.add(sig)
            rows.append(
                {
                    "id": sim_inventory_id("bistro", sig),
                    "master_wine_id": None,
                    "wine_name": item.get("wine_name"),
                    "stock_live": 12,
                    "threshold_min": 5,
                    "bottle_size_ml": None,
                    "pour_size_ml": 150,
                    "sale_type": "bottle",
                    "is_active": True,
                }
            )
        return rows

    def urls(self, fragment: str) -> list[str]:
        return [url for _m, url, _h, _b in self.requests if fragment in url]


@pytest.fixture
def applied(monkeypatch):
    from scripts.simulate import cli as cli_mod

    transport = _Transport()
    monkeypatch.setattr(bridge_mod.urllib.request, "urlopen", transport)
    monkeypatch.setattr(apply_mod.urllib.request, "urlopen", transport)
    monkeypatch.setenv("SIM_OWNER_EMAIL", "owner@example.test")
    monkeypatch.setenv("SIM_OWNER_PASSWORD", "x")
    monkeypatch.setenv("SUPABASE_URL", "http://localhost:54321")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setenv("POS_HUB_WEBHOOK_SECRET", "hmac-secret")
    code = cli_mod.main(
        [
            "scenario",
            "--archetype",
            "bistro",
            "--scenario",
            "random",
            "--seed",
            "7",
            "--date",
            "2026-09-02",
            "--restaurant",
            "11111111-1111-1111-1111-111111111111",
            "--apply",
        ]
    )
    return code, transport


def test_apply_runs_the_whole_path_and_reports_no_failure(applied, capsys):
    code, transport = applied
    capsys.readouterr()
    assert code == 0
    assert transport.urls("/auth/login")
    assert transport.urls("/operating-hours")
    assert transport.urls("/analytics/tables/")
    assert transport.urls("/pos-hub/mappings/")
    assert transport.urls("/pos-hub/webhook/generic_webhook/")
    assert transport.urls("/sim_scenario_runs")


def test_apply_seeds_tables_and_mappings_before_any_check(applied, capsys):
    """resolveWine and resolveTable both run at ingest; late rows do not backfill."""
    _code, transport = applied
    capsys.readouterr()
    order = [url for _m, url, _h, _b in transport.requests]
    first_check = next(i for i, u in enumerate(order) if "/pos-hub/webhook/" in u)
    last_table = max(i for i, u in enumerate(order) if "/analytics/tables/" in u)
    last_mapping = max(i for i, u in enumerate(order) if "/pos-hub/mappings/" in u)
    assert last_table < first_check
    assert last_mapping < first_check


def test_apply_sends_the_bearer_on_mappings_and_never_on_the_webhook(applied, capsys):
    _code, transport = applied
    capsys.readouterr()
    for method, url, headers, _body in transport.requests:
        lowered = {k.lower(): v for k, v in headers.items()}
        if "/pos-hub/mappings/" in url:
            assert lowered.get("Authorization".lower()) == "Bearer tok"
        if "/pos-hub/webhook/" in url:
            assert "authorization" not in lowered, "the webhook is @Public(); it signs"
            assert "x-pos-hub-signature" in lowered


def test_apply_sends_mappings_carrying_inventory_ids(applied, capsys):
    """Without one, every wine line queues as unmapped and nothing depletes."""
    _code, transport = applied
    capsys.readouterr()
    bodies = [
        json.loads(body)
        for _m, url, _h, body in transport.requests
        if "/pos-hub/mappings/" in url
    ]
    wine_rows = [row for row in bodies if row.get("is_wine")]
    assert wine_rows
    assert all(row.get("inventory_id") for row in wine_rows)
    assert all(row.get("sale_unit") in ("bottle", "glass") for row in wine_rows)


def test_apply_posts_checks_in_opened_at_order(applied, capsys):
    _code, transport = applied
    capsys.readouterr()
    posted = [
        json.loads(body)
        for _m, url, _h, body in transport.requests
        if "/pos-hub/webhook/" in url
    ]
    opened = [p["openedAt"] for p in posted]
    assert opened == sorted(opened)


def test_apply_posts_the_duplicate_twice_and_the_void_as_two_states(applied, capsys):
    _code, transport = applied
    capsys.readouterr()
    posted = [
        json.loads(body)
        for _m, url, _h, body in transport.requests
        if "/pos-hub/webhook/" in url
    ]
    by_id: dict[str, list[dict]] = {}
    for payload in posted:
        by_id.setdefault(payload["externalCheckId"], []).append(payload)

    twice = {cid: rows for cid, rows in by_id.items() if len(rows) == 2}
    assert twice, "neither the duplicate nor the void posted twice"
    voided = [rows for rows in twice.values() if rows[1]["voided"] is True]
    duplicated = [rows for rows in twice.values() if rows[1]["voided"] is False]
    assert voided, "the void scenario did not post a voided second state"
    assert voided[0][0]["voided"] is False, "the void must post the close first"
    assert duplicated, "the duplicate scenario did not post twice"
    assert duplicated[0][0] == duplicated[0][1], "a duplicate must be byte-identical"


def test_apply_never_posts_the_dropped_check(monkeypatch, capsys):
    """The one scenario whose whole point is that nothing goes on the wire."""
    from scripts.simulate import cli as cli_mod

    transport = _Transport()
    monkeypatch.setattr(bridge_mod.urllib.request, "urlopen", transport)
    monkeypatch.setattr(apply_mod.urllib.request, "urlopen", transport)
    monkeypatch.setenv("SIM_OWNER_EMAIL", "owner@example.test")
    monkeypatch.setenv("SIM_OWNER_PASSWORD", "x")
    monkeypatch.setenv("SUPABASE_URL", "http://localhost:54321")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setenv("POS_HUB_WEBHOOK_SECRET", "hmac-secret")
    code = cli_mod.main(
        [
            "scenario",
            "--archetype",
            "bistro",
            "--scenario",
            "dropped_webhook",
            "--date",
            "2026-09-02",
            "--restaurant",
            "11111111-1111-1111-1111-111111111111",
            "--apply",
        ]
    )
    capsys.readouterr()
    assert code == 0
    assert transport.urls("/pos-hub/webhook/") == [], "a dropped check was posted"
    # The run is still recorded — the expectation is what makes the absence
    # readable later, and `unverifiable` is the verdict, not silence.
    row = [
        json.loads(body)
        for _m, url, _h, body in transport.requests
        if "/sim_scenario_runs" in url
    ][0]
    assert row["expected"]["dropped_check_ids"]
    assert row["expected"]["totals"]["posted_checks"] == 0


def test_apply_persists_the_run_with_the_agreed_columns(applied, capsys):
    _code, transport = applied
    capsys.readouterr()
    body = [
        json.loads(body)
        for _m, url, _h, body in transport.requests
        if "/sim_scenario_runs" in url
    ][0]
    assert set(body) == {
        "restaurant_id",
        "archetype_id",
        "scenario",
        "seed",
        "service_date",
        "timezone",
        "operating_hours",
        "params",
        "expected",
        "posted_at",
    }
    assert set(body["expected"]) == set(scn.CONTRACT_KEYS)
    assert body["params"]["hours_source"] == "product_api"
    assert body["params"]["inventory_source"] == "restaurant_inventory"
    assert body["params"]["post_failures"] == []


def test_a_rejected_check_is_a_run_failure_not_a_silent_one(monkeypatch, capsys):
    """A non-2xx is reported at the end, never hidden behind a zero exit."""
    from scripts.simulate import cli as cli_mod

    transport = _Transport(fail_checks=True)
    monkeypatch.setattr(bridge_mod.urllib.request, "urlopen", transport)
    monkeypatch.setattr(apply_mod.urllib.request, "urlopen", transport)
    monkeypatch.setenv("SIM_OWNER_EMAIL", "owner@example.test")
    monkeypatch.setenv("SIM_OWNER_PASSWORD", "x")
    monkeypatch.setenv("SUPABASE_URL", "http://localhost:54321")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setenv("POS_HUB_WEBHOOK_SECRET", "hmac-secret")
    code = cli_mod.main(
        [
            "scenario",
            "--archetype",
            "bistro",
            "--scenario",
            "opening_minute",
            "--seed",
            "7",
            "--date",
            "2026-09-02",
            "--restaurant",
            "11111111-1111-1111-1111-111111111111",
            "--apply",
        ]
    )
    out = capsys.readouterr().out
    assert code == 1
    assert "failure(s) in this run" in out
    # And the run is still recorded, carrying the failures — a run that vanished
    # because it failed would be the worst of both.
    body = [
        json.loads(body)
        for _m, url, _h, body in transport.requests
        if "/sim_scenario_runs" in url
    ][0]
    assert body["params"]["post_failures"]


def test_apply_refuses_a_remote_gateway_without_allow_remote(monkeypatch):
    from scripts.simulate import cli as cli_mod

    transport = _Transport()
    monkeypatch.setattr(bridge_mod.urllib.request, "urlopen", transport)
    monkeypatch.setattr(apply_mod.urllib.request, "urlopen", transport)
    monkeypatch.setenv("SIM_OWNER_EMAIL", "owner@example.test")
    monkeypatch.setenv("SIM_OWNER_PASSWORD", "x")
    monkeypatch.setenv("SUPABASE_URL", "http://localhost:54321")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setenv("POS_HUB_WEBHOOK_SECRET", "hmac-secret")
    with pytest.raises(SystemExit) as exc:
        cli_mod.main(
            [
                "scenario",
                "--archetype",
                "bistro",
                "--scenario",
                "opening_minute",
                "--date",
                "2026-09-02",
                "--restaurant",
                "11111111-1111-1111-1111-111111111111",
                "--analytics-base",
                "https://mudavym.example.com",
                "--apply",
            ]
        )
    assert "not localhost" in str(exc.value)
    # And it refused BEFORE anything left: the login would otherwise have POSTed
    # the owner's password to whatever host --analytics-base named, which is the
    # half of the 2026-08-05 incident that cannot be taken back.
    assert transport.requests == []


# ---------------------------------------------------------------------------
# Edges of the clock
# ---------------------------------------------------------------------------


def test_a_very_short_window_still_places_every_check_inside_it(menu_items, wine_list):
    """A window is half-open: a seat exactly ON close is out of hours."""
    tiny = {
        day: [{"open": "12:00", "close": "12:20"}]
        for day in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
    }
    ctx, expectation, _expected, _outcomes = build(
        menu_items, tiny, wine_list, "service"
    )
    assert expectation.checks, "a 20-minute service produced nothing to check"
    for check in expectation.checks:
        assert ctx.is_inside_hours(
            check.opened_at
        ), f"a check opened at {check.opened_at}, on or past close"
        assert check.outside_hours is False


def test_a_window_crossing_midnight_is_one_window_not_two(menu_items, wine_list):
    late = {
        day: [{"open": "18:00", "close": "02:00"}]
        for day in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
    }
    ctx, expectation, expected, _outcomes = build(
        menu_items, late, wine_list, "service"
    )
    assert len(ctx.windows) == 1
    start, end = ctx.windows[0]
    assert (end - start) == timedelta(hours=8)
    assert expected["outside_hours_count"] == 0
    assert any(
        check.opened_at.astimezone(bridge_tz()).hour < 3 for check in expectation.checks
    ), "no check landed after midnight — the crossing was not exercised"


def bridge_tz():
    from zoneinfo import ZoneInfo

    return ZoneInfo(TZ)


def test_a_spring_forward_day_keeps_every_check_inside_hours(
    menu_items, hours, wine_list
):
    """2027-03-14 is a spring-forward Sunday in America/Chicago: 02:00 does not exist.

    `hours.service_windows` resolves a wall time with `fold=0`, and this asserts
    the scenario engine inherits that rather than doing its own arithmetic on a
    day that is 23 hours long.
    """
    ctx, expectation, expected, _outcomes = build(
        menu_items, hours, wine_list, "service", day=date(2027, 3, 14)
    )
    assert ctx.windows, "the venue is open on Sunday in the fixture"
    assert expectation.checks
    assert expected["outside_hours_count"] == 0
    for check in expectation.checks:
        assert ctx.is_inside_hours(check.opened_at)


def test_a_fall_back_day_keeps_every_check_inside_hours(menu_items, hours, wine_list):
    """2026-11-01: 01:00-02:00 happens twice. Ambiguity resolves to the first."""
    ctx, expectation, expected, _outcomes = build(
        menu_items, hours, wine_list, "service", day=date(2026, 11, 1)
    )
    assert expectation.checks
    assert expected["outside_hours_count"] == 0
    for check in expectation.checks:
        assert ctx.is_inside_hours(check.opened_at)
