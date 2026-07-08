"""
Phase 9 Ontology Task Integration Tests
==========================================
Tests: ONTO-05, ONTO-06, ONTO-07

All Supabase, Redis, and Celery dependencies are mocked.
No live connections required.

Run: pytest services/agent-orchestrator/tests/test_ontology_tasks.py -x -q
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# Helper: create OntologyValidationService bypassing __init__
# ---------------------------------------------------------------------------


def _make_service(mock_supabase=None):
    from services.ontology_validation_service import OntologyValidationService

    svc = OntologyValidationService.__new__(OntologyValidationService)
    svc.supabase = mock_supabase or MagicMock()
    return svc


# ---------------------------------------------------------------------------
# Test: OntologyValidationResult payload structure (ONTO-06)
# ---------------------------------------------------------------------------


class TestOntologyValidationPayloadStructure:

    def test_result_serializes_to_correct_structure(self):
        """ONTO-06: OntologyValidationResult serializes to expected JSONB structure"""
        from services.ontology_validation_service import (
            OntologyValidationResult,
            OntologyCheckFailure,
        )

        failure = OntologyCheckFailure(
            check="region_country",
            severity="critical",
            expected="IT",
            found="France",
            message="Barolo requires Italy, found France",
        )
        result = OntologyValidationResult(
            checks_passed=3,
            checks_failed=1,
            checks_total=4,
            failures=[failure],
            autofills_applied=0,
            validated_at=datetime.now(timezone.utc).isoformat(),
        )
        payload = result.model_dump()

        assert payload["checks_passed"] == 3
        assert payload["checks_failed"] == 1
        assert payload["checks_total"] == 4
        assert len(payload["failures"]) == 1
        assert payload["failures"][0]["severity"] == "critical"
        assert payload["failures"][0]["check"] == "region_country"
        assert payload["failures"][0]["expected"] == "IT"
        assert payload["failures"][0]["found"] == "France"
        assert "autofills_applied" in payload
        assert "validated_at" in payload

    def test_result_with_multiple_failures(self):
        """ONTO-06: Multiple failures are serialized correctly in the failures list"""
        from services.ontology_validation_service import (
            OntologyValidationResult,
            OntologyCheckFailure,
        )

        failures = [
            OntologyCheckFailure(
                check="region_country",
                severity="critical",
                expected="IT",
                found="FR",
                message="Country mismatch",
            ),
            OntologyCheckFailure(
                check="color_grape",
                severity="warning",
                expected="red",
                found="white",
                message="Color inconsistency",
            ),
        ]
        result = OntologyValidationResult(
            checks_passed=2,
            checks_failed=2,
            checks_total=4,
            failures=failures,
            autofills_applied=1,
            validated_at=datetime.now(timezone.utc).isoformat(),
        )
        payload = result.model_dump()

        assert payload["checks_passed"] == 2
        assert payload["checks_failed"] == 2
        assert len(payload["failures"]) == 2
        severities = [f["severity"] for f in payload["failures"]]
        assert "critical" in severities
        assert "warning" in severities


# ---------------------------------------------------------------------------
# Test: CRITICAL failure routing (ONTO-07)
# ---------------------------------------------------------------------------


class TestCriticalFailureRouting:

    def test_critical_failure_inserts_into_review_queue(self):
        """ONTO-07: CRITICAL failure → field_review_queue INSERT with source='ontology'"""
        from services.ontology_validation_service import OntologyCheckFailure

        mock_supabase = MagicMock()
        service = _make_service(mock_supabase)

        failure = OntologyCheckFailure(
            check="region_country",
            severity="critical",
            expected="IT",
            found="France",
            message="Country mismatch",
        )
        fc = {"country": {"value": "France", "confidence": 0.75, "source": "inferred"}}

        service._route_failures("test-wine-uuid", [failure], fc)

        # Verify field_review_queue INSERT was called with source='ontology'
        frq_row = None
        for call_item in mock_supabase.table.return_value.insert.call_args_list:
            if call_item.args:
                row = call_item.args[0]
                if isinstance(row, dict) and row.get("source") == "ontology":
                    frq_row = row
                    break

        assert (
            frq_row is not None
        ), "No field_review_queue insert with source='ontology' found"
        assert frq_row["status"] == "pending"
        assert frq_row["submission_id"] == "test-wine-uuid"
        assert frq_row["field_name"] == "country"

    def test_critical_failure_sets_auto_blocked(self):
        """ONTO-07: CRITICAL failure → auto_blocked=True on master_wine_library_submissions"""
        from services.ontology_validation_service import OntologyCheckFailure

        mock_supabase = MagicMock()
        service = _make_service(mock_supabase)

        failure = OntologyCheckFailure(
            check="grape_appellation",
            severity="critical",
            expected="Nebbiolo",
            found="Merlot",
            message="Barolo incompatible with Merlot",
        )
        fc = {
            "grape_variety": {
                "value": "Merlot",
                "confidence": 0.85,
                "source": "visible",
            }
        }

        service._route_failures("test-wine-uuid", [failure], fc)

        # Verify auto_blocked=True update was called on submissions table
        update_calls = mock_supabase.table.return_value.update.call_args_list
        auto_blocked_set = any(
            isinstance(c.args[0], dict) and c.args[0].get("auto_blocked") is True
            for c in update_calls
            if c.args
        )
        assert auto_blocked_set, "auto_blocked=True was not set on submission"

    def test_warning_high_confidence_does_not_route(self):
        """D-03: WARNING failure + field confidence=0.9 (>=0.8) → field_review_queue NOT inserted"""
        from services.ontology_validation_service import OntologyCheckFailure

        mock_supabase = MagicMock()
        service = _make_service(mock_supabase)

        warning_failure = OntologyCheckFailure(
            check="color_grape",
            severity="warning",
            expected="red",
            found="white",
            message="Color inconsistency",
        )
        fc = {"color": {"value": "white", "confidence": 0.9, "source": "web_verified"}}

        service._route_failures("test-wine-uuid", [warning_failure], fc)

        # High confidence → WARNING should NOT trigger any supabase calls
        mock_supabase.table.assert_not_called()

    def test_warning_low_confidence_routes_without_auto_blocked(self):
        """D-03: WARNING failure + confidence=0.5 (<0.8) → routes to review queue; auto_blocked NOT set"""
        from services.ontology_validation_service import OntologyCheckFailure

        mock_supabase = MagicMock()
        service = _make_service(mock_supabase)

        warning_failure = OntologyCheckFailure(
            check="color_grape",
            severity="warning",
            expected="red",
            found="white",
            message="Color inconsistency",
        )
        fc = {"color": {"value": "white", "confidence": 0.5, "source": "inferred"}}

        service._route_failures("test-wine-uuid", [warning_failure], fc)

        # Low confidence → WARNING should route to field_review_queue
        frq_row = None
        for call_item in mock_supabase.table.return_value.insert.call_args_list:
            if call_item.args:
                row = call_item.args[0]
                if isinstance(row, dict) and row.get("source") == "ontology":
                    frq_row = row
                    break

        assert (
            frq_row is not None
        ), "Expected field_review_queue insert for low-confidence WARNING"
        assert frq_row["status"] == "pending"

        # auto_blocked must NOT be set for WARNING (only CRITICAL triggers it)
        update_calls = mock_supabase.table.return_value.update.call_args_list
        auto_blocked_set = any(
            isinstance(c.args[0], dict) and c.args[0].get("auto_blocked") is True
            for c in update_calls
            if c.args
        )
        assert not auto_blocked_set, "auto_blocked must NOT be set for WARNING failures"


# ---------------------------------------------------------------------------
# Test: Task Redis dedup (ONTO-05)
# ---------------------------------------------------------------------------


class TestTaskRedisDedup:

    def test_task_acquires_lock_and_calls_validate(self):
        """ONTO-05: Redis NX lock acquired → _validate_sync is called"""
        mock_redis = MagicMock()
        mock_redis.set.return_value = True  # Lock acquired (NX succeeds)

        expected_result = {
            "wine_id": "test-uuid",
            "checks_passed": 4,
            "checks_failed": 0,
            "checks_total": 4,
            "autofills_applied": 0,
        }

        with patch("jobs.ontology_tasks.redis_lib") as mock_redis_lib:
            mock_redis_lib.from_url.return_value = mock_redis
            with patch(
                "jobs.ontology_tasks._validate_sync", return_value=expected_result
            ) as mock_validate:
                from jobs.ontology_tasks import ontology_validate_task

                ontology_validate_task.apply(args=["test-uuid"])

        # Verify _validate_sync was called
        mock_validate.assert_called_once_with("test-uuid")

        # Verify Redis lock was acquired with NX
        mock_redis.set.assert_called_once()
        set_call = mock_redis.set.call_args
        assert set_call.kwargs.get("nx") is True or (
            len(set_call.args) > 1 and "nx" in str(set_call)
        )

    def test_task_skips_if_lock_already_held(self):
        """ONTO-05: Redis NX returns None (lock held) → task returns None without calling validate"""
        mock_redis = MagicMock()
        mock_redis.set.return_value = None  # Lock NOT acquired (already held)

        with patch("jobs.ontology_tasks.redis_lib") as mock_redis_lib:
            mock_redis_lib.from_url.return_value = mock_redis
            with patch("jobs.ontology_tasks._validate_sync") as mock_validate:
                from jobs.ontology_tasks import ontology_validate_task

                result = ontology_validate_task.apply(args=["test-uuid"])

        # _validate_sync must NOT have been called
        mock_validate.assert_not_called()
        # Task returns None when deduplicated
        assert result.result is None
