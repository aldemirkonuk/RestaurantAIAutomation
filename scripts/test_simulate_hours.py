"""`scripts/simulate/hours.py` against the shared fixture.

The same file drives the TypeScript mirror's jest suite
(`apps/api-gateway/src/common/operating-hours/operating-hours.spec.ts`). A case
added here without the other side is a drift waiting to happen — add cases to the
fixture, not to this file.

    pytest scripts/test_simulate_hours.py -q
"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from scripts.simulate.hours import (
    OperatingHoursError,
    is_open_at,
    parse_operating_hours,
    service_windows,
    to_json,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
FIXTURE = REPO_ROOT / "datasets" / "sim" / "fixtures" / "operating-hours-cases.json"


@pytest.fixture(scope="module")
def cases() -> dict:
    with FIXTURE.open() as f:
        return json.load(f)


def _hours(cases: dict, ref):
    if ref is None:
        return None
    if isinstance(ref, str):
        return cases["hours"][ref]
    return ref


def _iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)


def test_fixture_is_not_vacuous(cases):
    assert len(cases["parse_cases"]) >= 10
    assert len(cases["open_cases"]) >= 20
    assert len(cases["window_cases"]) >= 6


def test_parse_cases(cases):
    for c in cases["parse_cases"]:
        raw = _hours(cases, c.get("hours")) if "hours" in c else c["raw"]
        if c["valid"]:
            parsed = parse_operating_hours(raw)
            assert to_json(parsed) == raw, c["name"]
        else:
            with pytest.raises(OperatingHoursError):
                parse_operating_hours(raw)


def test_open_cases(cases):
    for c in cases["open_cases"]:
        state = is_open_at(_hours(cases, c["hours"]), c["timezone"], _iso(c["instant"]))
        assert state.open is c["open"], f"{c['name']}: got {state}"
        if c.get("reason") is not None:
            assert state.reason == c["reason"], f"{c['name']}: got {state}"
        if state.open:
            assert (
                state.window is not None
                and state.window[0] <= _iso(c["instant"]) < state.window[1]
            )


def test_window_cases(cases):
    for c in cases["window_cases"]:
        got = service_windows(
            _hours(cases, c["hours"]), c["timezone"], date.fromisoformat(c["date"])
        )
        want = [(_iso(a), _iso(b)) for a, b in c["windows"]]
        assert (
            got == want
        ), f"{c['name']}: got {[(a.isoformat(), b.isoformat()) for a, b in got]}"


def test_unknown_is_never_false():
    assert (
        is_open_at(None, "UTC", datetime(2026, 9, 2, tzinfo=timezone.utc)).open is None
    )
    assert (
        is_open_at({"mon": []}, "UTC", datetime(2026, 9, 2, tzinfo=timezone.utc)).open
        is None
    )


def test_naive_instant_is_read_as_utc(cases):
    hours = cases["hours"]["bistro"]
    assert (
        is_open_at(hours, "America/Chicago", datetime(2026, 9, 2, 17, 1)).open is True
    )


def test_service_windows_refuses_unknown_timezone(cases):
    with pytest.raises(ValueError):
        service_windows(cases["hours"]["bistro"], "Mars/Olympus", date(2026, 9, 2))
