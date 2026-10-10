"""Studio promotion writes only columns master_wine_library has (F-754), and the
studio paths it depends on (F-755, F-756, F-760).

The other promotion tests mock Supabase, so a row naming a column the table does
not have passed them while every real insert failed. Here the insert keys are
checked against the table as the migrations build it: the baseline CREATE TABLE,
then every later ALTER TABLE ... ADD/DROP COLUMN, in file order.
"""

import re
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from services.override_service import (
    _fc_value,
    _maybe_promote_submission,
    build_library_row,
)

MIGRATIONS = Path(__file__).resolve().parents[3] / "supabase" / "migrations"
SECRET = "studio-schema-secret"


def _library_columns() -> dict:
    """{column: {"required": bool, "generated": bool}} for master_wine_library."""
    files = sorted(p for p in MIGRATIONS.glob("*.sql") if re.match(r"\d{14}_", p.name))
    assert files, f"no migrations under {MIGRATIONS}"
    cols: dict = {}
    for path in files:
        sql = re.sub(r"--[^\n]*", "", path.read_text())
        create = re.search(
            r"CREATE TABLE (?:public\.)?master_wine_library \((.*?)\n\);", sql, re.S
        )
        if create:
            for line in create.group(1).split("\n"):
                line = line.strip().rstrip(",")
                if not line or line.startswith("CONSTRAINT"):
                    continue
                name = line.split()[0]
                cols[name] = {
                    "required": "NOT NULL" in line and "DEFAULT" not in line,
                    "generated": "GENERATED ALWAYS" in line,
                }
        for stmt in sql.split(";"):
            if not re.search(
                r"ALTER TABLE (?:ONLY )?(?:public\.)?master_wine_library\s",
                stmt,
                re.I,
            ):
                continue
            for m in re.finditer(r"DROP COLUMN (?:IF EXISTS )?(\w+)", stmt, re.I):
                cols.pop(m.group(1), None)
            parts = re.split(r"ADD COLUMN (?:IF NOT EXISTS )?", stmt, flags=re.I)[1:]
            for part in parts:
                name = part.split()[0]
                cols[name] = {
                    "required": "NOT NULL" in part and "DEFAULT" not in part,
                    "generated": "GENERATED ALWAYS" in part,
                }
            for m in re.finditer(r"ALTER COLUMN (\w+)\s+DROP NOT NULL", stmt, re.I):
                if m.group(1) in cols:
                    cols[m.group(1)]["required"] = False
    assert "wine_id" in cols and "price_reference" in cols, "parser lost the table"
    return cols


COLUMNS = _library_columns()
WRITABLE = {c for c, v in COLUMNS.items() if not v["generated"]}
REQUIRED = {c for c, v in COLUMNS.items() if v["required"] and c != "id"}

FULL_FC = {
    k: {"value": v, "confidence": 0.9, "source": "visible"}
    for k, v in {
        "wine_name": "Barolo Riserva",
        "producer": "Giacomo Conterno",
        "vintage": "2019",
        "price_bottle": "120.50",
        "price_glass": "18",
        "region": "Piedmont",
        "sub_region": "Serralunga",
        "appellation": "Barolo DOCG",
        "country": "Italy",
        "grape_variety": "Nebbiolo",
        "primary_type": "red",
        "color": "red",
        "sweetness_level": "dry",
        "tasting_notes": "tar and roses",
        "food_pairing": "braised beef",
        "description": "A long-lived Barolo",
        "producer_bio": "Family estate",
        "alcohol_pct": "14.5",
        "section_name": "Reds",
        "bin_number": "12",
    }.items()
}
FULL_SUBMISSION_JSONB = {
    "grape_family": {"name": "Nebbiolo"},
    "wine_structure": {"acidity": "high"},
    "sensory_profile": {"aromas": ["rose"]},
    "practical_attributes": {"serving_temp_c": 16},
    "region_hierarchy": {"country": "Italy"},
    "critic_scores": {"ws": 95},
    "winemaking_details": {"oak": "large botti"},
}


def _assert_insertable(row: dict):
    unknown = set(row) - WRITABLE
    assert (
        not unknown
    ), f"not writable columns of master_wine_library: {sorted(unknown)}"
    missing = REQUIRED - set(row)
    assert not missing, f"NOT NULL columns with no default left out: {sorted(missing)}"


class TestBuildLibraryRow:
    def test_full_row_names_only_real_columns(self):
        row = build_library_row(
            lambda n: _fc_value(FULL_FC, n),
            source="studio_approved",
            submission=FULL_SUBMISSION_JSONB,
            audit={"submission_id": "s"},
        )
        _assert_insertable(row)
        assert row["price_reference"] == 120.5
        assert row["sensory_profile"] == {
            "aromas": ["rose"],
            "tasting_notes": "tar and roses",
            "color": "red",
        }
        assert row["practical_attributes"]["food_pairing"] == "braised beef"
        assert row["wine_structure"]["sweetness_level"] == "dry"
        assert row["data_enrichment"]["studio_promotion"] == {"submission_id": "s"}
        assert len(row["wine_id"]) <= 20

    def test_name_only_row_still_fills_every_required_column(self):
        row = build_library_row(
            lambda n: "House Red" if n == "wine_name" else None, source="x"
        )
        _assert_insertable(row)
        assert row["primary_type"] == "unknown"
        assert "price_reference" not in row


def _auth(roles):
    import jwt as pyjwt

    token = pyjwt.encode(
        {"sub": "user-001", "email": "u@example.com", "app_metadata": {"roles": roles}},
        SECRET,
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


def _settings():
    return type("S", (), {"supabase_jwt_secret": SECRET, "trust_level_threshold": 5})()


def _tables(**mocks):
    sb = MagicMock()
    sb.table.side_effect = lambda name: mocks.setdefault(name, MagicMock())
    return sb


class TestPromoteEndpoint:
    def test_promote_inserts_a_real_row_and_marks_the_submission(self, test_client):
        subs = MagicMock()
        subs.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": "sub-1",
            "status": "pending_review",
            "payload": {},
            "field_confidence": FULL_FC,
            **FULL_SUBMISSION_JSONB,
        }
        lib = MagicMock()
        lib.select.return_value.ilike.return_value.eq.return_value.ilike.return_value.limit.return_value.execute.return_value.data = (
            []
        )
        lib.insert.return_value.execute.return_value.data = [{"id": "wine-uuid"}]
        sb = _tables(master_wine_library_submissions=subs, master_wine_library=lib)
        with patch("config.settings.get_settings", return_value=_settings()), patch(
            "api.studio_routes._get_supabase", return_value=sb
        ):
            resp = test_client.post(
                "/api/v1/studio/promote",
                json={"submission_id": "sub-1"},
                headers=_auth(["review_admin"]),
            )
        assert resp.status_code == 200, resp.text
        assert resp.json()["wine_id"] == "wine-uuid"
        (row,), _ = lib.insert.call_args
        _assert_insertable(row)
        subs.update.assert_called_once_with(
            {"status": "approved", "matched_master_id": "wine-uuid"}
        )


class TestMaybePromote:
    def _sb(self, insert_raises=False):
        subs = MagicMock()
        subs.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": "sub-1",
            "status": "pending_review",
            "field_confidence": FULL_FC,
            "restaurant_id": "r-1",
            **FULL_SUBMISSION_JSONB,
        }
        queue = MagicMock()
        queue.select.return_value.eq.return_value.eq.return_value.execute.return_value.count = (
            0
        )
        lib = MagicMock()
        if insert_raises:
            lib.insert.return_value.execute.side_effect = RuntimeError("boom")
        return (
            _tables(
                master_wine_library_submissions=subs,
                field_review_queue=queue,
                master_wine_library=lib,
            ),
            lib,
        )

    def test_promotion_row_names_only_real_columns(self):
        sb, lib = self._sb()
        assert _maybe_promote_submission(sb, "sub-1") == "promoted"
        (row,), _ = lib.insert.call_args
        _assert_insertable(row)
        assert "restaurant_id" not in row

    def test_failed_write_is_reported_not_swallowed(self):
        sb, _ = self._sb(insert_raises=True)
        assert _maybe_promote_submission(sb, "sub-1") == "failed"

    def test_approve_response_carries_the_library_outcome(self, test_client):
        events = MagicMock()
        events.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": "ov-1",
            "promotion_status": "pending",
            "submission_id": "sub-1",
            "field_name": "vintage",
            "new_value": "2019",
            "actor_id": "user-002",
        }
        with patch("config.settings.get_settings", return_value=_settings()), patch(
            "api.studio_routes._get_supabase",
            return_value=_tables(override_events=events),
        ), patch("api.studio_routes._apply_override_to_submission"), patch(
            "api.studio_routes._maybe_promote_submission", return_value="failed"
        ), patch(
            "api.studio_routes._get_user_studio_roles", return_value=[]
        ):
            resp = test_client.patch(
                "/api/v1/studio/queue/ov-1",
                json={"decision": "approved"},
                headers=_auth(["review_admin"]),
            )
        assert resp.status_code == 200, resp.text
        assert resp.json()["library"] == "failed"


class TestSessionsAndManualRecords:
    def test_photo_session_is_accepted(self, test_client):
        sessions = MagicMock()
        sessions.insert.return_value.execute.return_value.data = [{"id": "sess-1"}]
        with patch("config.settings.get_settings", return_value=_settings()), patch(
            "api.studio_routes._get_supabase",
            return_value=_tables(onboarding_sessions=sessions),
        ):
            resp = test_client.post(
                "/api/v1/studio/sessions",
                json={"source_type": "image_upload", "source_ref": "list.jpg"},
                headers=_auth(["developer"]),
            )
        assert resp.status_code == 200, resp.text
        assert sessions.insert.call_args[0][0]["source_type"] == "image_upload"

    def test_migration_allows_image_upload(self):
        sql = (
            MIGRATIONS / "20270104000000_a_photo_of_the_list_is_a_source.sql"
        ).read_text()
        assert "'image_upload'::text" in sql

    def test_empty_record_gets_a_real_submission_row(self, test_client):
        users = MagicMock()
        users.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
            {"restaurant_id": "r-1"}
        ]
        subs = MagicMock()
        subs.insert.return_value.execute.return_value.data = [{"id": "sub-real"}]
        with patch("config.settings.get_settings", return_value=_settings()), patch(
            "api.studio_routes._get_supabase",
            return_value=_tables(users=users, master_wine_library_submissions=subs),
        ):
            resp = test_client.post(
                "/api/v1/studio/submissions",
                json={"session_id": "sess-1", "wine_name": " Chianti "},
                headers=_auth(["certified_contributor"]),
            )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"submission": {"id": "sub-real"}}
        inserted = subs.insert.call_args[0][0]
        assert inserted["restaurant_id"] == "r-1"
        assert inserted["status"] == "pending_review"
        assert inserted["field_confidence"]["wine_name"]["value"] == "Chianti"

    def test_empty_record_fails_loudly_without_a_row(self, test_client):
        subs = MagicMock()
        subs.insert.return_value.execute.return_value.data = []
        with patch("config.settings.get_settings", return_value=_settings()), patch(
            "api.studio_routes._get_supabase",
            return_value=_tables(master_wine_library_submissions=subs),
        ):
            resp = test_client.post(
                "/api/v1/studio/submissions",
                json={},
                headers=_auth(["developer"]),
            )
        assert resp.status_code == 503


class TestQueueIdentity:
    @pytest.mark.parametrize(
        "sub, name",
        [
            ({"payload": {"name": "Gateway Wine"}}, "Gateway Wine"),
            ({"payload": {"wine_name": "Studio Wine"}}, "Studio Wine"),
            (
                {
                    "payload": {},
                    "field_confidence": {
                        "wine_name": {"value": "Low Wine", "confidence": 0.4}
                    },
                },
                "Low Wine",
            ),
            ({"payload": {}}, None),
        ],
    )
    def test_queue_reads_every_place_a_name_is_kept(self, sub, name):
        from api.studio_routes import _queue_identity

        assert _queue_identity(sub)["wine_name"] == name


class TestReviewQueuePromotion:
    """The quality review queue is the third path into the library (F-786)."""

    def test_review_queue_promotion_names_only_real_columns(self):
        from api.quality_routes import ReviewQueuePatchRequest, patch_review_queue

        subs = MagicMock()
        subs.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": "sub-1",
            "status": "pending_review",
            "field_confidence": FULL_FC,
            "restaurant_id": "r-1",
            **FULL_SUBMISSION_JSONB,
        }
        queue = MagicMock()
        queue.select.return_value.eq.return_value.eq.return_value.execute.return_value.count = (
            0
        )
        lib = MagicMock()
        sb = _tables(
            master_wine_library_submissions=subs,
            field_review_queue=queue,
            master_wine_library=lib,
        )
        with patch("api.quality_routes._get_supabase", return_value=sb):
            result = patch_review_queue("sub-1", ReviewQueuePatchRequest())

        assert result["promoted_to_library"] is True
        (row,), _ = lib.insert.call_args
        _assert_insertable(row)
        assert row["wine_id"].startswith("WINE_")
        assert row["price_reference"] == 120.5
        assert row["source"] == "human_reviewed"


def _fc(**fields):
    return {
        k: {"value": v, "confidence": 1.0, "source": "human_override"}
        for k, v in fields.items()
    }


class TestManualRecordStaysADraft:
    """F-810: a hand-typed name alone must not join the shared library."""

    def _sb(self, fc, insert_data=None):
        subs = MagicMock()
        subs.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
            "id": "sub-1",
            "status": "pending_review",
            "field_confidence": fc,
            "restaurant_id": "r-1",
        }
        queue = MagicMock()
        queue.select.return_value.eq.return_value.eq.return_value.execute.return_value.count = (
            0
        )
        lib = MagicMock()
        lib.insert.return_value.execute.return_value.data = insert_data
        sb = _tables(
            master_wine_library_submissions=subs,
            field_review_queue=queue,
            master_wine_library=lib,
        )
        return sb, subs, lib

    @pytest.mark.parametrize(
        "fields",
        [
            {"wine_name": "Chianti Classico"},
            {"wine_name": "Chianti Classico", "producer": "  -- "},
            {"wine_name": "Chianti Classico", "vintage": "2019"},
            {"wine_name": "Chianti Classico", "region": "Tuscany"},
            {"wine_name": "Chianti Classico", "vintage": "MMXIX", "region": "Tuscany"},
        ],
    )
    def test_a_generic_identity_stays_a_submission(self, fields):
        sb, subs, lib = self._sb(_fc(**fields))
        assert _maybe_promote_submission(sb, "sub-1") == "not_specific"
        lib.insert.assert_not_called()
        subs.update.assert_not_called()

    @pytest.mark.parametrize(
        "fields",
        [
            {"wine_name": "Chianti Classico", "producer": "Fontodi"},
            {"wine_name": "Chianti Classico", "vintage": "2019", "region": "Tuscany"},
        ],
    )
    def test_a_specific_identity_is_promoted_and_linked(self, fields):
        sb, subs, lib = self._sb(_fc(**fields), insert_data=[{"id": "wine-uuid"}])
        assert _maybe_promote_submission(sb, "sub-1") == "promoted"
        lib.insert.assert_called_once()
        subs.update.assert_called_once_with(
            {"status": "approved", "matched_master_id": "wine-uuid"}
        )


class TestPromoteDedup:
    """F-810: Promote neither duplicates a linked wine nor matches on a missing field."""

    def _post(self, test_client, submission, lib):
        subs = MagicMock()
        subs.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = (
            submission
        )
        sb = _tables(master_wine_library_submissions=subs, master_wine_library=lib)
        with patch("config.settings.get_settings", return_value=_settings()), patch(
            "api.studio_routes._get_supabase", return_value=sb
        ):
            return test_client.post(
                "/api/v1/studio/promote",
                json={"submission_id": "sub-1"},
                headers=_auth(["review_admin"]),
            )

    def test_a_submission_already_in_the_library_is_not_inserted_again(
        self, test_client
    ):
        lib = MagicMock()
        resp = self._post(
            test_client,
            {
                "id": "sub-1",
                "status": "approved",
                "matched_master_id": "wine-first",
                "payload": {},
                "field_confidence": _fc(
                    wine_name="Chianti Classico", producer="Fontodi", vintage="2019"
                ),
            },
            lib,
        )
        assert resp.status_code == 409, resp.text
        assert resp.headers["X-Existing-Wine-Id"] == "wine-first"
        lib.insert.assert_not_called()

    def test_a_missing_producer_and_vintage_match_only_rows_missing_them(
        self, test_client
    ):
        lib = MagicMock()
        q = lib.select.return_value.ilike.return_value
        q.is_.return_value.is_.return_value.limit.return_value.execute.return_value.data = (
            []
        )
        lib.insert.return_value.execute.return_value.data = [{"id": "wine-uuid"}]
        resp = self._post(
            test_client,
            {
                "id": "sub-1",
                "status": "pending_review",
                "payload": {},
                "field_confidence": _fc(wine_name="Chianti Classico"),
            },
            lib,
        )
        assert resp.status_code == 200, resp.text
        assert q.is_.call_args_list[0].args == ("vintage", "null")
        assert q.is_.return_value.is_.call_args.args == ("producer", "null")
