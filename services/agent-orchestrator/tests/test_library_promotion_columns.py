"""Wine Studio promotion writes master_wine_library's real columns, and says when it fails.

QA round 5 (B-1, 2026-11-07): all three promotion paths -- the Studio auto path
(`override_service._maybe_promote_submission`), the Studio's manual Promote
(`studio_routes.promote_to_library`) and the review queue
(`quality_routes.patch_review_queue`) -- inserted columns no migration defines
and never sent `wine_id`, which is NOT NULL with no default. PostgREST refused
every insert. The auto path swallowed the refusal and the contributor still
read "auto_promoted".

The column set is REPLAYED from the migrations (library_columns_util.py). Every
query each path sends is recorded and every column it names must be a real one.
This file pins the schema, the shared row builder and the review-queue path;
the Studio paths are in test_library_promotion_manual.py and
test_library_promotion_auto.py. A return-value test would pass against the
broken code -- the auto path swallowed its error -- so the assertions are about
what is sent, and then about what the contributor is told.

Run: cd services/agent-orchestrator && python -m pytest tests/test_library_promotion_columns.py -v
"""

from unittest.mock import patch

import pytest

from library_columns_util import (
    FIELD_CONFIDENCE,
    LIBRARY,
    LIBRARY_WRITABLE,
    SUBMISSION,
    SUBMISSIONS,
    _assert_real_columns,
    _DB,
)
from services.library_promotion import build_library_row, parse_vintage


class TestTheReplayIsTheSchema:
    def test_the_replay_sees_known_later_additions(self):
        # 20260906120000 adds abv_percent; 20260817050000 adds display_name.
        assert {"abv_percent", "display_name", "superseded_by"} <= set(LIBRARY)
        # 20261116101500 adds these to the submissions table only.
        assert {"ai_enriched", "enrichment_source"} <= SUBMISSIONS
        assert not {"ai_enriched", "enrichment_source"} & set(LIBRARY)

    def test_generated_sensory_columns_are_not_writable(self):
        # 20260818030000_sensory_columns_generated: a direct write errors.
        assert "acidity" in LIBRARY and "acidity" not in LIBRARY_WRITABLE

    def test_wine_id_and_primary_type_must_be_sent(self):
        for col in ("wine_id", "primary_type"):
            assert "NOT NULL" in LIBRARY[col].upper()
            assert "DEFAULT" not in LIBRARY[col].upper()

    def test_the_columns_the_old_rows_named_do_not_exist(self):
        # The defect, pinned: if a migration ever adds one of these, this
        # file's mapping decisions need revisiting rather than silently holding.
        ghosts = {
            "restaurant_id", "submission_id", "wine_type", "color",
            "alcohol_pct", "sweetness_level", "tasting_notes", "description",
            "food_pairing", "avg_price", "price", "price_glass", "section_name",
            "bin_number", "ai_enriched", "enrichment_source", "promoted_by",
            "promoted_at",
        }  # fmt: skip
        assert not ghosts & set(LIBRARY)
        assert "promoted_to_library" not in SUBMISSIONS


# =============================================================================
# The row
# =============================================================================


class TestTheRow:
    def test_only_real_columns_and_no_house_data(self):
        row = build_library_row(
            lambda f: (FIELD_CONFIDENCE.get(f) or {}).get("value"),
            SUBMISSION,
            source="studio_approved",
        )
        assert set(row) <= LIBRARY_WRITABLE
        # QA H-4: the shared library carries no house's prices, bins or id.
        assert "180" not in row.values() and "B-14" not in row.values()
        assert "rest-1" not in row.values()

    def test_values_fit_their_columns(self):
        row = build_library_row(
            lambda f: (FIELD_CONFIDENCE.get(f) or {}).get("value"),
            SUBMISSION,
            source="studio_approved",
        )
        assert row["vintage"] is None  # "NV" into an integer column is NULL
        assert row["grape_family"] == "Nebbiolo"  # varchar(100), not the object
        assert row["wine_structure"] == {"acidity": "high", "tannins": "firm"}
        assert row["sensory_profile"] is None  # empty is absent, not "{}"
        assert row["name"] == "Barolo Riserva" and row["primary_type"] == "red"

    def test_primary_type_falls_back_to_color_then_unknown(self):
        def only(fields):
            return lambda f: fields.get(f)

        row = build_library_row(only({"color": "white"}), {}, "x")
        assert row["primary_type"] == "white"
        assert build_library_row(only({}), {}, "x")["primary_type"] == "unknown"

    @pytest.mark.parametrize(
        "raw,year", [("2019", 2019), (2019, 2019), ("NV", None), ("", None), (None, None), ("19", None)]
    )  # fmt: skip
    def test_parse_vintage(self, raw, year):
        assert parse_vintage(raw) == year


# =============================================================================
# Path 3: the review queue
# =============================================================================


class TestReviewQueuePath:
    def test_writes_real_columns_and_links_the_submission(self):
        from api import quality_routes

        db = _DB(SUBMISSION)
        with patch.object(quality_routes, "_get_supabase", return_value=db):
            resp = quality_routes.patch_review_queue(
                "sub-1", quality_routes.ReviewQueuePatchRequest(), "key"
            )
        assert resp["promoted_to_library"] is True
        _assert_real_columns(db)
        (row,) = db.library_inserts()
        assert db.submission_updates()[-1]["matched_master_id"] == row["id"]
