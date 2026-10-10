"""F-502 (wave14sim settings, 2026-10-09): quiet hours are kept on the house's
clock, not the agent container's.

The image runs on UTC (no TZ in the Dockerfile), and `_is_quiet_hours` used a
naive `datetime.now()`. A house in Istanbul (UTC+3) that set 23:00-08:00 was
actually silenced 02:00-11:00 local: alerts went out at 23:30 local and the
morning was muted. The window is now read in `restaurants.timezone`.
"""

from datetime import datetime, timezone
from unittest.mock import MagicMock

from agents.notification_agent import NotificationAgent

QUIET = {
    "quiet_hours_enabled": True,
    "quiet_hours_start": "23:00:00",
    "quiet_hours_end": "08:00:00",
}


def _agent():
    agent = NotificationAgent.__new__(NotificationAgent)
    agent.logger = MagicMock()
    return agent


def _utc(hour, minute=0):
    return datetime(2026, 10, 9, hour, minute, tzinfo=timezone.utc)


class TestQuietHoursOnTheHouseClock:
    def test_istanbul_2330_local_is_quiet(self):
        # 20:30 UTC is 23:30 in Istanbul: inside the house's window. On the
        # container's UTC clock this read as 20:30 and was NOT quiet.
        prefs = {**QUIET, "house_timezone": "Europe/Istanbul"}
        assert _agent()._is_quiet_hours(prefs, now_utc=_utc(20, 30)) is True

    def test_istanbul_1000_local_is_not_quiet(self):
        # 07:00 UTC is 10:00 in Istanbul: the window ended at 08:00 local.
        # On the UTC clock this read as 07:00 and was wrongly quiet.
        prefs = {**QUIET, "house_timezone": "Europe/Istanbul"}
        assert _agent()._is_quiet_hours(prefs, now_utc=_utc(7, 0)) is False

    def test_no_zone_falls_back_to_utc_and_says_so(self):
        agent = _agent()
        assert agent._is_quiet_hours(dict(QUIET), now_utc=_utc(23, 30)) is True
        agent.logger.warning.assert_called()

    def test_unknown_zone_falls_back_to_utc(self):
        agent = _agent()
        prefs = {**QUIET, "house_timezone": "Mars/Olympus"}
        assert agent._is_quiet_hours(prefs, now_utc=_utc(10, 0)) is False
        agent.logger.warning.assert_called()


class _Query:
    def __init__(self, data):
        self._data = data

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def single(self):
        return self

    def limit(self, *_a):
        return self

    def execute(self):
        r = MagicMock()
        r.data = self._data
        return r


class TestPreferencesCarryTheHouseZone:
    async def test_zone_is_read_when_quiet_hours_are_on(self):
        agent = _agent()
        db = MagicMock()
        tables = {
            "notification_preferences": _Query(
                {"user_id": "m", "restaurant_id": "r", **QUIET}
            ),
            "restaurants": _Query([{"timezone": "Europe/Istanbul"}]),
        }
        db.supabase.table.side_effect = lambda name: tables[name]
        agent.database = db
        prefs = await agent._get_notification_preferences("m", "r")
        assert prefs["house_timezone"] == "Europe/Istanbul"

    async def test_zone_is_not_read_when_quiet_hours_are_off(self):
        agent = _agent()
        db = MagicMock()
        db.supabase.table.side_effect = lambda name: {
            "notification_preferences": _Query({"user_id": "m", "restaurant_id": "r"}),
        }[name]
        agent.database = db
        prefs = await agent._get_notification_preferences("m", "r")
        assert "house_timezone" not in prefs
