"""
VLM ↔ Training Data Store Wiring
================================
Regression tests for a silent-failure class: the VLM extraction service
resolved its training store through a symbol that did not exist
(`get_training_store` instead of `get_training_data_store`) and called a
method that did not exist (`save_extraction` instead of `save_scan_pair`).
Both raised inside broad `except Exception` blocks, so every VLM call
dropped its input/output pair while logging only a benign-looking warning.

These tests assert the wiring end-to-end — symbol resolves, store
constructs, and a record actually lands — plus that a genuine wiring
failure is now logged as an ERROR rather than an optional-dependency
warning.
"""

import logging
import sys
from unittest.mock import patch

import pytest

import services.training_data_store as tds_module
from services.training_data_store import TrainingDataStore, get_training_data_store
from services.vlm_extraction_service import VLMExtractionService


@pytest.fixture(autouse=True)
def reset_store_singleton():
    """The store is a module-level singleton; isolate each test from it.

    Also pins `core.database.get_supabase_client` to None for the duration.
    These tests assert the IN-MEMORY BUFFER path, which `save_scan_pair` takes
    only when `mock_mode or not self.supabase` (training_data_store.py:76). That
    made them silently dependent on no Supabase client existing in the session —
    fine until P1 had SpendLogger resolve a shared client through
    Settings.supabase_client, after which any earlier test that touched the
    logger left a live client behind and these wrote through to the database
    instead of buffering. Passing alone, failing in company. Pinning the
    dependency makes the test assert what it claims to.
    """
    tds_module._store_instance = None
    with patch("core.database.get_supabase_client", return_value=None):
        yield
    tds_module._store_instance = None


# =============================================================================
# SYMBOL / SIGNATURE
# =============================================================================


def test_factory_symbol_exists_with_expected_signature():
    """The name the VLM service imports must exist and take the documented kwargs."""
    import inspect

    params = inspect.signature(get_training_data_store).parameters
    assert set(params) == {"supabase_client", "mock_mode"}


def test_store_exposes_the_method_the_vlm_service_calls():
    """Guards against the save_extraction/save_scan_pair mismatch reappearing."""
    store = get_training_data_store(supabase_client=None, mock_mode=True)
    assert hasattr(store, "save_scan_pair")


# =============================================================================
# RESOLUTION
# =============================================================================


def test_vlm_service_resolves_a_real_training_store():
    """_get_training_store must return a live store, not None."""
    service = VLMExtractionService()

    store = service._get_training_store()

    assert store is not None, "VLM extraction is silently dropping training data"
    assert isinstance(store, TrainingDataStore)


def test_resolved_store_is_memoized():
    service = VLMExtractionService()

    assert service._get_training_store() is service._get_training_store()


# =============================================================================
# END-TO-END CAPTURE
# =============================================================================


@pytest.mark.asyncio
async def test_save_training_data_actually_buffers_a_record():
    """The whole point of the wiring: a VLM call's pair must be captured."""
    service = VLMExtractionService()

    await service._save_training_data(
        method="gemini_vision",
        prompt="extract every wine",
        response='{"wines": []}',
        document_type="menu",
        restaurant_name="Test Bistro",
    )

    store = service._get_training_store()
    buffered = store.flush_buffer()

    assert len(buffered) == 1
    record = buffered[0]
    assert record["dataset_type"] == "vlm_menu"
    assert record["input_data"]["method"] == "gemini_vision"
    assert record["input_data"]["restaurant_name"] == "Test Bistro"
    assert record["output_data"]["response"] == '{"wines": []}'


@pytest.mark.asyncio
async def test_save_training_data_reports_call_errors_as_errors(caplog):
    """A bad call into the store must not be logged as a benign warning."""
    service = VLMExtractionService()
    store = service._get_training_store()

    with patch.object(store, "save_scan_pair", side_effect=TypeError("bad kwargs")):
        with caplog.at_level(logging.DEBUG):
            await service._save_training_data(
                method="gemini_text",
                prompt="p",
                response="r",
                document_type="invoice",
                restaurant_name=None,
            )

    assert any(r.levelno >= logging.ERROR for r in caplog.records)


# =============================================================================
# FAILURE-MODE DISTINCTION
# =============================================================================


def test_import_failure_is_logged_as_an_error(caplog):
    """A missing store module is a wiring bug — ERROR, with a traceback."""
    service = VLMExtractionService()

    # A None entry in sys.modules makes `import` raise ImportError.
    with patch.dict(sys.modules, {"services.training_data_store": None}):
        with caplog.at_level(logging.DEBUG):
            store = service._get_training_store()

    assert store is None
    errors = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert errors, "an unresolvable training store must not log as a mere warning"
    assert any(r.exc_info for r in errors), "wiring errors must carry a traceback"


def test_missing_supabase_is_not_an_error(caplog):
    """No database configured is a legitimate state — the store buffers instead."""
    service = VLMExtractionService()

    with patch("core.database.get_database", return_value=None):
        with caplog.at_level(logging.DEBUG):
            store = service._get_training_store()

    assert store is not None
    assert not [r for r in caplog.records if r.levelno >= logging.WARNING]
