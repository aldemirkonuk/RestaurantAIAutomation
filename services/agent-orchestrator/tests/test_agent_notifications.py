"""
Agent notification writes must satisfy the live table's NOT NULL columns.

The defect these pin down, verified against the live database rather than the
migrations:

    INSERT INTO notifications (restaurant_id, type, title, message, status, metadata)
    ERROR: 23502: null value in column "recipient_id" violates not-null constraint

`notifications` carries two generations of columns. The app reads user_id/type/
status, but recipient_id, notification_type and channels are still NOT NULL with
no defaults. Both Python agents omitted all three, so every insert was rejected
inside a try/except that only logged — provider notices and PROVINT-04
unknown-sender alerts reached nobody, and the failure was invisible because a
caught exception around a write that always fails looks like a feature nobody uses.
"""

from typing import Any, Dict, List

import pytest

from core.notifications import notify_restaurant, resolve_restaurant_member_ids

# The three legacy columns that are NOT NULL with no default on the live table.
REQUIRED_LEGACY_COLUMNS = ("recipient_id", "notification_type", "channels")
# Plus the ones that were always required.
REQUIRED_COLUMNS = REQUIRED_LEGACY_COLUMNS + (
    "restaurant_id",
    "title",
    "message",
)


class _Table:
    def __init__(self, store: Dict[str, Any], name: str):
        self._store = store
        self._name = name
        self._filters: Dict[str, Any] = {}

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self._filters[col] = val
        return self

    def limit(self, *_a, **_k):
        return self

    def insert(self, rows):
        self._store.setdefault("inserted", []).extend(
            rows if isinstance(rows, list) else [rows]
        )
        return self

    def execute(self):
        if self._name == "user_restaurant_access":
            return type("R", (), {"data": self._store.get("members", [])})()
        if self._name == "restaurants":
            return type("R", (), {"data": self._store.get("restaurants", [])})()
        return type("R", (), {"data": []})()


class _DB:
    def __init__(self, store: Dict[str, Any]):
        self._store = store
        self.supabase = self

    def table(self, name: str):
        return _Table(self._store, name)


class _Logger:
    def __init__(self):
        self.warnings: List[str] = []
        self.errors: List[str] = []

    def warning(self, msg, **_k):
        self.warnings.append(str(msg))

    def error(self, msg, **_k):
        self.errors.append(str(msg))


@pytest.fixture
def store():
    return {
        "members": [{"user_id": "user-1"}, {"user_id": "user-2"}],
        "restaurants": [],
    }


class TestRequiredColumns:
    async def test_every_required_not_null_column_is_populated(self, store):
        """The exact regression: a row missing any of these is rejected by Postgres."""
        await notify_restaurant(
            _DB(store), _Logger(), "rest-1", "unknown_sender", "t", "m"
        )

        rows = store["inserted"]
        assert rows, "nothing was inserted"
        for row in rows:
            for col in REQUIRED_COLUMNS:
                assert row.get(col) is not None, f"{col} would violate NOT NULL"

    async def test_channels_is_a_non_empty_array(self, store):
        # text[] NOT NULL — an empty list satisfies the constraint but means the
        # notification targets no channel, so the bell never shows it.
        await notify_restaurant(_DB(store), _Logger(), "rest-1", "t", "t", "m")

        assert store["inserted"][0]["channels"] == ["in_app"]

    async def test_recipient_id_mirrors_user_id(self, store):
        # The app reads user_id; recipient_id exists only to satisfy the old
        # constraint. They must agree or the row is addressed to two people.
        await notify_restaurant(_DB(store), _Logger(), "rest-1", "t", "t", "m")

        row = store["inserted"][0]
        assert row["recipient_id"] == row["user_id"]

    async def test_notification_type_mirrors_type(self, store):
        await notify_restaurant(_DB(store), _Logger(), "rest-1", "low_stock", "t", "m")

        row = store["inserted"][0]
        assert row["notification_type"] == row["type"] == "low_stock"

    async def test_status_is_unread_not_is_read(self, store):
        # `is_read` does not exist on the live table; `status` does, defaulting to
        # 'unread'. An earlier draft of one agent inserted is_read=False.
        await notify_restaurant(_DB(store), _Logger(), "rest-1", "t", "t", "m")

        row = store["inserted"][0]
        assert row["status"] == "unread"
        assert "is_read" not in row


class TestFanOutAndFailure:
    async def test_one_row_per_restaurant_member(self, store):
        await notify_restaurant(_DB(store), _Logger(), "rest-1", "t", "t", "m")

        assert len(store["inserted"]) == 2

    async def test_returns_zero_and_warns_when_no_members_resolve(self):
        # Must not report success. The previous code could not tell "no recipients"
        # from "written", because it never checked either.
        empty = {"members": [], "restaurants": []}
        logger = _Logger()

        inserted = await notify_restaurant(_DB(empty), logger, "rest-1", "t", "t", "m")

        assert inserted == 0
        assert logger.warnings, "a notification that reached nobody must be logged"

    async def test_falls_back_to_the_restaurant_owner(self):
        no_membership = {"members": [], "restaurants": [{"owner_id": "owner-9"}]}

        ids = await resolve_restaurant_member_ids(_DB(no_membership), "rest-1")

        assert ids == ["owner-9"]

    async def test_title_is_truncated_to_the_column_width(self, store):
        # title is varchar; an over-long value is a 22001 error, which would fail
        # the whole batch.
        await notify_restaurant(_DB(store), _Logger(), "rest-1", "t", "x" * 900, "m")

        assert len(store["inserted"][0]["title"]) == 500
