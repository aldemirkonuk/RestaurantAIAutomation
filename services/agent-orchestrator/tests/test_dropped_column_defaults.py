"""A dropped column default must not become a ValidationError.

ADR 0116 dropped five column defaults and NULLed every row that carried one.
Four Pydantic fields in `core/database.py` mirrored those defaults, and two of
them were declared NON-Optional. That combination is not a cosmetic mismatch —
it is an outage with no visible symptom:

    providers row with lead_time_days = NULL
      -> Provider.model_validate  raises pydantic.ValidationError
      -> BaseRepository.find_many catches only APIError, so it escapes
      -> RFQAgent._select_competitor_vendors catches bare Exception and returns []
      -> "this house has no active vendors", for every restaurant, forever

One ERROR line, an empty list, and nothing else. Absence reported as health,
one type annotation deep.

These tests pin the four fields and the two repository behaviours. The
repository cases matter as much as the model ones: making the model tolerant
fixes today's NULL, while making `find_many` per-row tolerant fixes the SHAPE —
the next column that disagrees with the next model costs one row instead of the
whole query.
"""

import sys
from pathlib import Path

import pytest
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.database import ManagerPreferences, Provider  # noqa: E402


class TestProviderToleratesDroppedDefaults:
    def test_null_lead_time_and_payment_terms_validate(self):
        """The exact row shape the migration leaves behind."""
        p = Provider.model_validate(
            {
                "id": "11111111-1111-4111-8111-111111111111",
                "name": "Anadolu",
                "lead_time_days": None,
                "payment_terms": None,
                "is_active": True,
            }
        )
        assert p.lead_time_days is None
        assert p.payment_terms is None

    def test_a_missing_key_is_unknown_not_seven(self):
        """The field must not re-assert the default the migration removed."""
        p = Provider.model_validate({"id": "p1", "name": "Anadolu"})
        assert p.lead_time_days is None, "lead_time_days re-invented a default"
        assert p.payment_terms is None
        # `minimum_order_quantity` names a column that does not exist at all
        # (`providers` has `minimum_order`), so its old `= 12` was fabricated
        # for every provider ever loaded, and nothing in the repo reads it.
        assert p.minimum_order_quantity is None

    def test_a_real_value_still_arrives_intact(self):
        """Tolerating the unknown must not discard the known."""
        p = Provider.model_validate(
            {
                "id": "p1",
                "name": "Anadolu",
                "lead_time_days": 21,
                "payment_terms": "Net 45",
            }
        )
        assert p.lead_time_days == 21
        assert p.payment_terms == "Net 45"

    def test_a_seven_that_survived_the_migration_is_a_term(self):
        """Post-migration, a 7 is a 7 somebody typed — not a default."""
        p = Provider.model_validate(
            {"id": "p1", "name": "Anadolu", "lead_time_days": 7}
        )
        assert p.lead_time_days == 7


class TestManagerPreferencesToleratesDroppedDefault:
    def test_null_report_timezone_validates(self):
        m = ManagerPreferences.model_validate(
            {"id": "m1", "manager_id": "u1", "report_timezone": None}
        )
        assert m.report_timezone is None

    def test_a_missing_key_is_unknown_not_los_angeles(self):
        m = ManagerPreferences.model_validate({"id": "m1", "manager_id": "u1"})
        assert m.report_timezone is None, "report_timezone re-invented California"

    def test_a_real_zone_still_arrives_intact(self):
        m = ManagerPreferences.model_validate(
            {"id": "m1", "manager_id": "u1", "report_timezone": "Europe/Istanbul"}
        )
        assert m.report_timezone == "Europe/Istanbul"


class TestNoModelReAssertsADroppedDefault:
    """The sweep, as an assertion rather than a claim in a report.

    Every field that mirrors a column whose default ADR 0116 dropped must be
    Optional with a `None` default. Stated as data so that adding a sixth
    dropped default and forgetting its model is a test failure, not a discovery.
    """

    DROPPED = [
        (Provider, "lead_time_days"),
        (Provider, "payment_terms"),
        (Provider, "minimum_order_quantity"),
        (ManagerPreferences, "report_timezone"),
    ]

    @pytest.mark.parametrize("model,field", DROPPED)
    def test_field_defaults_to_none(self, model: type[BaseModel], field: str):
        info = model.model_fields[field]
        assert info.default is None, (
            f"{model.__name__}.{field} defaults to {info.default!r}. That value "
            "mirrors a column default ADR 0116 dropped, so it re-asserts an "
            "answer nobody gave."
        )

    @pytest.mark.parametrize("model,field", DROPPED)
    def test_field_accepts_none(self, model: type[BaseModel], field: str):
        """Non-Optional is the half that turns a fabricated value into a crash."""
        base = (
            {"id": "x", "name": "n"}
            if model is Provider
            else {"id": "x", "manager_id": "u"}
        )
        model.model_validate({**base, field: None})


class TestRepositoryDoesNotLoseTheWholeQuery:
    """One unreadable row must not read to the caller as an empty table.

    Driven through the real `BaseRepository.find_many` with a stub client, so it
    exercises the actual `except ValidationError` placement rather than a
    paraphrase of it.
    """

    @staticmethod
    def _repo(rows):
        from core.database import BaseRepository

        class _Query:
            def select(self, *a, **k):
                return self

            def eq(self, *a, **k):
                return self

            def in_(self, *a, **k):
                return self

            def is_(self, *a, **k):
                return self

            def order(self, *a, **k):
                return self

            def range(self, *a, **k):
                return self

            def execute(self):
                return type("R", (), {"data": rows})()

        class _Client:
            def table(self, _name):
                return _Query()

        return BaseRepository(_Client(), "providers", Provider)

    @pytest.mark.asyncio
    async def test_a_bad_row_costs_one_row_not_all_of_them(self, caplog):
        rows = [
            {"id": "p1", "name": "Good one"},
            # `name` is required, so this row cannot be validated at all — a
            # stand-in for any future model/schema disagreement.
            {"id": "p2"},
            {"id": "p3", "name": "Good two"},
        ]
        out = await self._repo(rows).find_many({"is_active": True})

        assert [p.id for p in out] == ["p1", "p3"], (
            "one unreadable row erased the readable ones — the exact failure "
            "that reported every house as having no vendors"
        )
        # And the loss is stated, with the id, rather than being silent.
        assert "p2" in caplog.text
        assert "INCOMPLETE" in caplog.text

    @pytest.mark.asyncio
    async def test_an_all_null_provider_row_survives_end_to_end(self):
        """The post-migration row, through the repository rather than the model."""
        rows = [
            {
                "id": "p1",
                "name": "Anadolu",
                "lead_time_days": None,
                "payment_terms": None,
            }
        ]
        out = await self._repo(rows).find_many({"is_active": True})
        assert len(out) == 1
        assert out[0].lead_time_days is None
