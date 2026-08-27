"""
`beverage_ontology_v1` reaching the footprint — and the filter bug that stopped
`ontology_v1` from reaching it at all.

No live Supabase. The client is a recording double, so the tests assert on the
QUERY that was built as well as on the verdict, which is how the JSON-path
regression below is locked.
"""

from unittest.mock import MagicMock

from services.beverage_ontology import BEVERAGE_ONTOLOGY_BASIS
from services.beverage_verdict import (
    beverage_ontology_verdict,
    extract_fields,
    grade_beverage_extractions,
)


# ---------------------------------------------------------------------------
# A recording Supabase double
# ---------------------------------------------------------------------------


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    """Records every filter applied, so a test can assert on the query shape."""

    def __init__(self, table, calls, data):
        self.table = table
        self.calls = calls
        self._data = data

    def _record(self, name, *args):
        self.calls.append((self.table, name, args))
        return self

    select = lambda self, *a: self._record("select", *a)  # noqa: E731
    eq = lambda self, *a: self._record("eq", *a)  # noqa: E731
    in_ = lambda self, *a: self._record("in_", *a)  # noqa: E731
    order = lambda self, *a, **k: self._record("order", *a)  # noqa: E731
    limit = lambda self, *a: self._record("limit", *a)  # noqa: E731

    def maybe_single(self):
        return self._record("maybe_single")

    def execute(self):
        return _Result(self._data)

    def upsert(self, row, **kwargs):
        self.calls.append((self.table, "upsert", (row,)))
        return self


class _Supabase:
    def __init__(self, submission=None, events=None):
        self.calls = []
        self.verdicts = []
        self._submission = submission
        self._events = events if events is not None else []

    def table(self, name):
        if name == "master_wine_library_submissions":
            return _Query(name, self.calls, self._submission)
        if name == "neural_footprint_event":
            return _Query(name, self.calls, self._events)
        if name == "nf_verdict":
            query = _Query(name, self.calls, None)
            original = query.upsert

            def upsert(row, **kwargs):
                self.verdicts.append(row)
                return original(row, **kwargs)

            query.upsert = upsert
            return query
        raise AssertionError(f"unexpected table {name}")


_EVENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
_WINE_ID = "11111111-1111-4111-8111-111111111111"


def _submission(**field_confidence):
    return {
        "id": _WINE_ID,
        "payload": {},
        "field_confidence": {
            key: {"value": value, "confidence": 0.9, "source": "vision"}
            for key, value in field_confidence.items()
        },
    }


# ---------------------------------------------------------------------------
# The verdict function
# ---------------------------------------------------------------------------


class TestVerdict:
    def test_all_applicable_rules_passing_is_success(self):
        assert beverage_ontology_verdict(2, 0, 2)["outcome"] == "success"

    def test_any_hard_rule_failure_is_failure(self):
        assert beverage_ontology_verdict(1, 1, 2)["outcome"] == "failure"

    def test_no_rule_applied_is_untestable_not_success(self):
        verdict = beverage_ontology_verdict(0, 0, 0)
        assert verdict["outcome"] is None
        assert verdict["evidence"]["untestable"] == "no_beverage_rule_applied"

    def test_untestable_and_passing_are_distinguishable(self):
        # The distinction the wine caller loses by passing a constant
        # checks_total of 4 (ontology_validation_service.py:585).
        assert (
            beverage_ontology_verdict(0, 0, 0)["outcome"]
            != beverage_ontology_verdict(2, 0, 2)["outcome"]
        )


# ---------------------------------------------------------------------------
# Reading a submission
# ---------------------------------------------------------------------------


class TestExtractFields:
    def test_field_confidence_values_are_unwrapped(self):
        fields = extract_fields(_submission(country="Japan", alcohol_pct=45.0))
        assert fields["country"] == "Japan"
        assert fields["alcohol_pct"] == 45.0

    def test_payload_supplies_name_which_field_confidence_never_carries(self):
        row = {"payload": {"name": "Lagavulin 16"}, "field_confidence": {}}
        assert extract_fields(row)["name"] == "Lagavulin 16"

    def test_field_confidence_wins_over_payload(self):
        row = {
            "payload": {"country": "France"},
            "field_confidence": {"country": {"value": "Japan"}},
        }
        assert extract_fields(row)["country"] == "Japan"

    def test_malformed_jsonb_does_not_raise(self):
        assert extract_fields({"payload": "not-a-dict", "field_confidence": None}) == {}


# ---------------------------------------------------------------------------
# The grading rail
# ---------------------------------------------------------------------------


class TestGrading:
    def test_a_wine_is_declined_with_none_not_zero(self):
        # None means "correctly declined"; 0 means "ran and found nothing".
        # Collapsing them would make "we grade beverages" indistinguishable
        # from "we grade nothing".
        supabase = _Supabase(submission=_submission(grape_variety="Nebbiolo"))
        assert grade_beverage_extractions(supabase, _WINE_ID) is None
        assert supabase.verdicts == []

    def test_a_violating_spirit_is_graded_failure(self):
        # `menu_category` is a DECLARED type, so it may assert the designation.
        # A name may not — cask-finish naming defeats every designation token.
        supabase = _Supabase(
            submission=_submission(
                name="Blanton's Single Barrel",
                menu_category="Bourbon",
                country="Japan",
                alcohol_pct=45.0,
            ),
            events=[{"id": _EVENT_ID}],
        )
        written = grade_beverage_extractions(supabase, _WINE_ID)

        assert written == 1
        verdict = supabase.verdicts[0]
        assert verdict["basis"] == BEVERAGE_ONTOLOGY_BASIS
        assert verdict["outcome"] == "failure"
        assert verdict["evidence"]["failures"][0]["check"] == "protected_origin"

    def test_the_scotch_that_ontology_v1_calls_success_is_graded_untestable(self):
        # The measured defect, restated as a lock: "Lagavulin 16 Year Old" has
        # no appellation, grape, vintage or colour, so all four wine rules skip
        # and ontology_verdict(4, 0, 4) returns success. This grader examined
        # the same row, could apply no rule, and says so.
        supabase = _Supabase(
            submission=_submission(name="Lagavulin 16 Year Old", producer="Lagavulin"),
            events=[{"id": _EVENT_ID}],
        )
        written = grade_beverage_extractions(supabase, _WINE_ID)

        assert written == 1
        verdict = supabase.verdicts[0]
        assert verdict["outcome"] is None
        assert verdict["evidence"]["untestable"] == "no_beverage_rule_applied"
        assert verdict["evidence"]["checks_total"] == 0

    def test_evidence_names_which_rules_ran_and_which_did_not(self):
        supabase = _Supabase(
            submission=_submission(
                name="Blanton's Single Barrel",
                menu_category="Bourbon",
                country="USA",
                alcohol_pct=45.0,
            ),
            events=[{"id": _EVENT_ID}],
        )
        grade_beverage_extractions(supabase, _WINE_ID)
        evidence = supabase.verdicts[0]["evidence"]

        assert sorted(evidence["checks_applied"]) == [
            "abv_category",
            "protected_origin",
        ]
        assert "abv_proof" in evidence["checks_skipped"]

    def test_a_missing_submission_writes_nothing(self):
        supabase = _Supabase(submission=None)
        assert grade_beverage_extractions(supabase, _WINE_ID) == 0
        assert supabase.verdicts == []

    def test_a_fetch_failure_is_swallowed_not_raised(self):
        # The instrument must never kill the validation run it rides on.
        supabase = MagicMock()
        supabase.table.side_effect = RuntimeError("supabase down")
        assert grade_beverage_extractions(supabase, _WINE_ID) == 0


# ---------------------------------------------------------------------------
# The regression that made `ontology_v1` a silent no-op
# ---------------------------------------------------------------------------


class TestTaskTypeFilterIsAJsonPath:
    """`task_type` has never been a column on `neural_footprint_event`.

    The table defines id / subject_type / subject_id / stimulus / context /
    internal_state / choice / outcome / cost_usd / tokens / duration_ms /
    correlation_id / restaurant_id / occurred_at and nothing else
    (`20260824141116_neural_footprint_event.sql`). `spend_logger.py:395` writes
    the task type INTO `context`, and `nf_a_verdict_coverage` reads it back as
    `e.context->>'task_type'`.

    `ontology_verdict.grade_wine_extractions` filtered the bare name, so
    PostgREST rejected the request and the surrounding try/except logged it as a
    non-fatal warning — the grader wrote zero verdicts and reported nothing
    wrong. Both graders are locked here so the shape cannot regress.
    """

    def _task_type_filters(self, supabase):
        return [
            call
            for call in supabase.calls
            if call[0] == "neural_footprint_event"
            and call[1] == "in_"
            and "task_type" in call[2][0]
        ]

    def test_beverage_grader_filters_the_json_path(self):
        supabase = _Supabase(
            submission=_submission(name="Islay Single Malt", alcohol_pct=46.0),
            events=[{"id": _EVENT_ID}],
        )
        grade_beverage_extractions(supabase, _WINE_ID)

        filters = self._task_type_filters(supabase)
        assert filters, "the grader must filter by task type"
        assert filters[0][2][0] == "context->>task_type"

    def test_wine_grader_filters_the_json_path(self):
        from services.ontology_verdict import grade_wine_extractions

        supabase = _Supabase(events=[{"id": _EVENT_ID}])
        grade_wine_extractions(supabase, _WINE_ID, 4, 0, 4)

        filters = self._task_type_filters(supabase)
        assert filters, "the grader must filter by task type"
        assert filters[0][2][0] == "context->>task_type"

    def test_neither_grader_filters_a_bare_task_type_column(self):
        from services.ontology_verdict import grade_wine_extractions

        for run in (
            lambda sb: grade_wine_extractions(sb, _WINE_ID, 4, 0, 4),
            lambda sb: grade_beverage_extractions(sb, _WINE_ID),
        ):
            supabase = _Supabase(
                submission=_submission(name="Islay Single Malt", alcohol_pct=46.0),
                events=[{"id": _EVENT_ID}],
            )
            run(supabase)
            assert not [
                call
                for call in supabase.calls
                if call[1] == "in_" and call[2][0] == "task_type"
            ]
