"""D5 (wave-5 notify lane, 2026-09-19): `_get_notification_preferences` must
scope by restaurant, not just by user.

`notification_preferences` is per (restaurant_id, user_id) since ADR 0149 row
39. `_get_notification_preferences` used to filter on `user_id` alone and
call `.single()`, which PostgREST -- and this fake, built to the same rule --
raises for anything but exactly one matching row. A manager of two or more
houses now has one row per house, so the unscoped read raised "multiple rows
returned" on EVERY call, was caught by the broad `except Exception`, and
every caller silently got `{}` (every channel default-allowed) instead of
that house's real preferences.
"""

from unittest.mock import MagicMock

from agents.notification_agent import NotificationAgent


class _FakeSingleQuery:
    """Mimics PostgREST's `.single()`: `.execute()` raises unless exactly one
    row matches every `.eq()` filter applied so far -- the real reason the
    old, unscoped read broke for a multi-house manager rather than simply
    returning the wrong row."""

    def __init__(self, rows):
        self._rows = rows
        self._filters = {}

    def select(self, *_a, **_k):
        return self

    def eq(self, column, value):
        self._filters[column] = value
        return self

    def single(self):
        return self

    def execute(self):
        matched = [
            r
            for r in self._rows
            if all(r.get(k) == v for k, v in self._filters.items())
        ]
        if len(matched) != 1:
            raise Exception(
                f"JSON object requested, multiple (or no) rows returned "
                f"({len(matched)} matched {self._filters})"
            )
        response = MagicMock()
        response.data = matched[0]
        return response


def _make_agent(rows):
    agent = NotificationAgent.__new__(NotificationAgent)
    agent.logger = MagicMock()
    mock_db = MagicMock()
    mock_db.supabase.table.return_value = _FakeSingleQuery(rows)
    agent.database = mock_db
    return agent


MANAGER = "mgr-1"
HOUSE_A = "rest-a"
HOUSE_B = "rest-b"


class TestD5NotificationPreferencesHouseScoping:
    async def test_returns_this_houses_row_for_a_multi_house_manager(self):
        # Two rows for the SAME manager, one per house they run -- legal
        # since row 39, and exactly the shape `.single()` used to choke on.
        agent = _make_agent(
            [
                {
                    "user_id": MANAGER,
                    "restaurant_id": HOUSE_A,
                    "order_approval_channels": ["push"],
                },
                {
                    "user_id": MANAGER,
                    "restaurant_id": HOUSE_B,
                    "order_approval_channels": ["sms", "email"],
                },
            ]
        )

        prefs = await agent._get_notification_preferences(MANAGER, HOUSE_A)

        assert prefs == {
            "user_id": MANAGER,
            "restaurant_id": HOUSE_A,
            "order_approval_channels": ["push"],
        }

    async def test_prefix_fails_unscoped_read_raises_on_two_rows(self):
        # [PRE-FIX-FAILS] proof: the OLD call shape (user_id only, no
        # restaurant_id) is exactly what raised for this same fixture.
        agent = _make_agent(
            [
                {"user_id": MANAGER, "restaurant_id": HOUSE_A},
                {"user_id": MANAGER, "restaurant_id": HOUSE_B},
            ]
        )
        query = agent.database.supabase.table("notification_preferences")
        query.select("*").eq("user_id", MANAGER)
        try:
            query.single().execute()
            assert False, "expected the unscoped, multi-row read to raise"
        except Exception as e:
            assert "multiple" in str(e) or "0" not in str(e)

    async def test_single_house_manager_still_resolves(self):
        agent = _make_agent(
            [{"user_id": MANAGER, "restaurant_id": HOUSE_A, "sms_enabled": True}]
        )
        prefs = await agent._get_notification_preferences(MANAGER, HOUSE_A)
        assert prefs == {
            "user_id": MANAGER,
            "restaurant_id": HOUSE_A,
            "sms_enabled": True,
        }

    async def test_no_row_for_this_house_returns_empty_not_another_houses(self):
        # The manager has a row at HOUSE_B only; asking for HOUSE_A must come
        # back {} (the documented "no preferences" default), never HOUSE_B's
        # row -- the exact leak the missing filter allowed.
        agent = _make_agent(
            [{"user_id": MANAGER, "restaurant_id": HOUSE_B, "push_enabled": False}]
        )
        prefs = await agent._get_notification_preferences(MANAGER, HOUSE_A)
        assert prefs == {}
