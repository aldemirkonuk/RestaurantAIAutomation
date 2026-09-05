"""The weekday matcher, and the payload the move writes (ADR 0116).

Ticking "Monday, Wednesday, Friday" in the Add/Edit Provider dialog used to put
three weekday names into `providers.regions_covered` — the geography column the
provider map and the territory filters read. The form was repointed at the
vendor-terms register on 2026-09-03; this script finds the rows already written
and, since the founder's decision of 2026-09-04, moves them.

Two things are tested here because two things can silently ruin the move:

  1. THE MATCHER. It decides which strings are picker artefacts. Too loose and
     the move deletes real territories — "Sunday River, Maine" is a place, and
     an over-eager rule would strip it out of a vendor's coverage and file a
     Sunday delivery the vendor never offered. Too strict and the move is a
     no-op that reports success.
  2. THE PAYLOAD. It decides what lands in `restaurant_vendor_terms`. An upsert
     carrying a key it should not carry would erase a cutoff or a minimum that
     somebody recorded on the settings register — a silent loss on a table whose
     entire purpose is to record what a person said.

    python3 -m pytest scripts/test_weekdays_in_regions_covered.py -q
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "weekday_regions",
    Path(__file__).resolve().parent / "list_weekdays_in_regions_covered.py",
)
mod = importlib.util.module_from_spec(_SPEC)
assert _SPEC.loader is not None
_SPEC.loader.exec_module(mod)


class TestMatcher:
    @pytest.mark.parametrize(
        "value,expected",
        [
            ("Sunday", 0),
            ("Monday", 1),
            ("Saturday", 6),
            ("  friday ", 5),
            ("WEDNESDAY", 3),
        ],
    )
    def test_names_map_to_postgres_dow(self, value, expected):
        """0 = Sunday .. 6 = Saturday — `extract(dow)` and JS `Date#getDay()`.

        The dialog displays Monday first and the column counts from Sunday. If
        these two ever disagree every stored day shifts by one and nothing
        errors, which is why the numbers are asserted and not just the count.
        """
        assert mod.weekday_index(value) == expected

    @pytest.mark.parametrize(
        "value",
        [
            "Sunday River",      # a place in Maine
            "Fridays Harbor",    # a place
            "Mon",               # an abbreviation the picker never wrote
            "Mondays",
            "California",
            "",
            None,
            7,
        ],
    )
    def test_anything_that_is_not_exactly_a_weekday_is_left_alone(self, value):
        """Exact match only. A substring rule would delete real territories."""
        assert mod.weekday_index(value) is None

    def test_split_keeps_order_and_separates_the_two_kinds(self):
        regions = ["California", "Monday", "Sunday River", "friday ", "Oregon"]
        weekdays, others = mod.split_regions(regions)
        assert weekdays == ["Monday", "friday "]
        # Order preserved, so the proposed value is the original minus entries
        # and never a reshuffle a reviewer would have to diff by eye.
        assert others == ["California", "Sunday River", "Oregon"]

    def test_a_non_list_is_not_a_finding(self):
        assert mod.split_regions(None) == ([], [])
        assert mod.split_regions([]) == ([], [])
        assert mod.split_regions("Monday") == ([], [])

    def test_a_non_string_entry_is_kept_never_dropped(self):
        weekdays, others = mod.split_regions(["Monday", 42])
        assert weekdays == ["Monday"]
        assert others == ["42"], "a non-string entry was silently discarded"


class TestPayload:
    RID = "11111111-1111-4111-8111-111111111111"
    PID = "22222222-2222-4222-8222-222222222222"

    def test_carries_the_pair_the_days_and_the_provenance_and_nothing_else(self):
        payload = mod.term_payload(self.RID, self.PID, ["Monday", "Friday"])
        assert payload == {
            "restaurant_id": self.RID,
            "provider_id": self.PID,
            "delivery_weekdays": [1, 5],
            "notes": mod.MOVE_PROVENANCE,
        }

    def test_never_carries_a_term_it_could_erase(self):
        """The load-bearing assertion.

        `restaurant_vendor_terms` holds five independent statements. An upsert
        that named `order_cutoff_time`, `minimum_order_amount`, `lead_time_days`
        or `payment_terms` would overwrite whatever a person recorded on the
        settings register with a NULL this script never intended to send.
        """
        payload = mod.term_payload(self.RID, self.PID, ["Monday"])
        for forbidden in (
            "order_cutoff_time",
            "order_cutoff_offset_days",
            "minimum_order_amount",
            "lead_time_days",
            "payment_terms",
        ):
            assert forbidden not in payload, f"the move would clear {forbidden}"

    def test_stated_by_is_absent_not_null(self):
        """Nobody said this; it was mined out of a column.

        Absent leaves the column NULL on an insert and UNTOUCHED on an update.
        An explicit None would erase a real author if one ever existed on the
        row — and `stated_by` carries a FK to `public.users(user_id)`, so it is
        the column that answers "who told us".
        """
        assert "stated_by" not in mod.term_payload(self.RID, self.PID, ["Monday"])

    def test_days_are_sorted_and_deduplicated(self):
        payload = mod.term_payload(self.RID, self.PID, ["Friday", "Monday", "friday", "MONDAY"])
        assert payload["delivery_weekdays"] == [1, 5]

    def test_a_non_weekday_never_becomes_sunday(self):
        """0 is a real day. An unknown string mapped to 0 would invent one."""
        payload = mod.term_payload(self.RID, self.PID, ["California", "Mon"])
        assert payload["delivery_weekdays"] == []

    def test_provenance_says_where_it_came_from(self):
        assert mod.MOVE_PROVENANCE == "recovered from the regions column"


class TestDryRunIsTheDefault:
    def test_apply_move_is_opt_in(self):
        """A flag that defaults to writing is the accident this guards against."""
        import argparse

        parser = argparse.ArgumentParser()
        parser.add_argument("--restaurant")
        parser.add_argument("--json", action="store_true")
        parser.add_argument("--apply-move", action="store_true")
        assert parser.parse_args([]).apply_move is False
        assert parser.parse_args(["--apply-move"]).apply_move is True

    def test_the_source_declares_the_flag_as_store_true(self):
        src = (Path(__file__).resolve().parent / "list_weekdays_in_regions_covered.py").read_text()
        assert '"--apply-move",\n        action="store_true"' in src, (
            "--apply-move must be a store_true flag; a valued option could be "
            "satisfied by a stray argument"
        )
