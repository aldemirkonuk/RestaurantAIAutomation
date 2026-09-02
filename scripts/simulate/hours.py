"""Operating hours: does the venue know when it is open, and is it open now?

The product had no answer to either question before ADR 0093. `restaurants` carried
a `timezone` and nothing else about time, and the simulator placed every cover on a
17:00–23:30 UTC curve whatever the venue. This module is the rule, in Python; the
TypeScript mirror lives in `apps/api-gateway/src/common/operating-hours/`. Both run
`datasets/sim/fixtures/operating-hours-cases.json`, so the two cannot drift silently
— the same lockstep pattern `scripts/test_simulate.py` uses for `WINE_WORDS`.

Contract (`restaurants.operating_hours`)
----------------------------------------
    {"mon": [{"open": "12:00", "close": "23:00"}], "tue": [...], ..., "sun": []}

* All seven keys are required. `[]` means closed that day. At most three ranges
  per day, non-overlapping, sorted by `open`.
* `close <= open` means the range crosses midnight into the next local day, and
  such a range must be the day's last.
* Times are local to `restaurants.timezone` (IANA). `close` is exclusive.
* `null` means the hours are unknown. Unknown is never coerced to closed — see
  `is_open_at`, which answers `None` with a reason rather than `False`.

DST is handled by `zoneinfo` with `fold=0`: a wall time that does not exist (the
spring-forward gap) resolves with the pre-transition offset, and an ambiguous wall
time (the fall-back hour) resolves to its first occurrence. The fixture pins both,
because the TypeScript side has to reproduce them by hand.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Mapping
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

WEEKDAYS: tuple[str, ...] = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
MAX_RANGES_PER_DAY = 3
_HHMM = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


class OperatingHoursError(ValueError):
    """The value is not a valid operating-hours object. `.errors` lists why."""

    def __init__(self, errors: list[str]) -> None:
        super().__init__("; ".join(errors))
        self.errors = errors


@dataclass(frozen=True)
class HourRange:
    open: str
    close: str

    @property
    def crosses_midnight(self) -> bool:
        return _minutes(self.close) <= _minutes(self.open)


OperatingHours = dict[str, list[HourRange]]


@dataclass(frozen=True)
class OpenState:
    """`open` is True / False / None. None carries a reason and is never a verdict."""

    open: bool | None
    reason: str | None = None
    window: tuple[datetime, datetime] | None = None


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def parse_operating_hours(raw: Any) -> OperatingHours:
    """Validate the JSON shape. Raises OperatingHoursError listing every fault."""
    errors: list[str] = []
    if not isinstance(raw, Mapping):
        raise OperatingHoursError(["operating_hours must be an object keyed mon..sun"])
    unknown = sorted(set(raw) - set(WEEKDAYS))
    if unknown:
        errors.append(f"unknown keys: {', '.join(unknown)}")
    missing = [d for d in WEEKDAYS if d not in raw]
    if missing:
        errors.append(f"missing keys: {', '.join(missing)}")
    out: OperatingHours = {}
    for day in WEEKDAYS:
        ranges_raw = raw.get(day)
        if day in missing:
            continue
        if not isinstance(ranges_raw, list):
            errors.append(f"{day}: must be a list of ranges")
            continue
        if len(ranges_raw) > MAX_RANGES_PER_DAY:
            errors.append(f"{day}: more than {MAX_RANGES_PER_DAY} ranges")
            continue
        ranges: list[HourRange] = []
        for i, r in enumerate(ranges_raw):
            if not isinstance(r, Mapping) or "open" not in r or "close" not in r:
                errors.append(f"{day}[{i}]: a range is {{open, close}}")
                continue
            o, c = r["open"], r["close"]
            if not (isinstance(o, str) and _HHMM.match(o)):
                errors.append(f"{day}[{i}].open: not HH:MM (00:00–23:59): {o!r}")
                continue
            if not (isinstance(c, str) and _HHMM.match(c)):
                errors.append(f"{day}[{i}].close: not HH:MM (00:00–23:59): {c!r}")
                continue
            if o == c:
                errors.append(f"{day}[{i}]: open equals close")
                continue
            ranges.append(HourRange(o, c))
        # Ordering and overlap, only over the ranges that parsed.
        for i in range(1, len(ranges)):
            prev, cur = ranges[i - 1], ranges[i]
            if prev.crosses_midnight:
                errors.append(
                    f"{day}: a range crossing midnight must be the last of the day"
                )
                break
            if _minutes(cur.open) < _minutes(prev.close):
                errors.append(
                    f"{day}: ranges overlap or are unsorted ({prev.open}-{prev.close} then {cur.open}-{cur.close})"
                )
                break
        out[day] = ranges
    if errors:
        raise OperatingHoursError(errors)
    return out


def _zone(timezone_name: str | None) -> ZoneInfo | None:
    if not timezone_name or not isinstance(timezone_name, str):
        return None
    try:
        return ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError):
        return None


def _local_wall_to_utc(day: date, hhmm: str, tz: ZoneInfo) -> datetime:
    """fold=0: gap → pre-transition offset; ambiguity → first occurrence."""
    h, m = hhmm.split(":")
    local = datetime.combine(day, time(int(h), int(m)), tzinfo=tz)  # fold defaults to 0
    return local.astimezone(timezone.utc)


def service_windows(
    hours: OperatingHours | Mapping[str, Any] | None,
    timezone_name: str | None,
    local_date: date,
) -> list[tuple[datetime, datetime]]:
    """UTC [start, end) windows whose OPEN falls on `local_date` in the venue's zone.

    Raises OperatingHoursError on an invalid shape and ValueError on an unknown
    timezone — callers that want a soft answer use `is_open_at`.
    """
    parsed = _ensure_parsed(hours)
    tz = _zone(timezone_name)
    if parsed is None:
        raise OperatingHoursError(["hours_unknown"])
    if tz is None:
        raise ValueError("timezone_unknown")
    day_key = WEEKDAYS[local_date.weekday()]
    windows: list[tuple[datetime, datetime]] = []
    for r in parsed.get(day_key, []):
        start = _local_wall_to_utc(local_date, r.open, tz)
        end_day = local_date + timedelta(days=1) if r.crosses_midnight else local_date
        end = _local_wall_to_utc(end_day, r.close, tz)
        windows.append((start, end))
    windows.sort(key=lambda w: w[0])
    return windows


def is_open_at(
    hours: OperatingHours | Mapping[str, Any] | None,
    timezone_name: str | None,
    instant: datetime,
) -> OpenState:
    """Open, closed, or unknown at `instant` (tz-aware; naive is treated as UTC).

    Reasons: `hours_unknown`, `timezone_unknown`, `closed_day` (no range opens on
    that local day and none from the previous day reaches it), `outside_hours`.
    """
    try:
        parsed = _ensure_parsed(hours)
    except OperatingHoursError:
        return OpenState(None, "hours_invalid")
    if parsed is None:
        return OpenState(None, "hours_unknown")
    tz = _zone(timezone_name)
    if tz is None:
        return OpenState(None, "timezone_unknown")
    if instant.tzinfo is None:
        instant = instant.replace(tzinfo=timezone.utc)
    instant = instant.astimezone(timezone.utc)
    local_day = instant.astimezone(tz).date()
    # A window from the previous local day may run past midnight into this one.
    candidates = service_windows(parsed, timezone_name, local_day - timedelta(days=1))
    candidates += service_windows(parsed, timezone_name, local_day)
    for start, end in candidates:
        if start <= instant < end:
            return OpenState(True, None, (start, end))
    if not parsed.get(WEEKDAYS[local_day.weekday()]):
        return OpenState(False, "closed_day")
    return OpenState(False, "outside_hours")


def _ensure_parsed(hours: Any) -> OperatingHours | None:
    if hours is None:
        return None
    if (
        isinstance(hours, dict)
        and hours
        and all(
            isinstance(v, list) and all(isinstance(r, HourRange) for r in v)
            for v in hours.values()
        )
        and set(hours) == set(WEEKDAYS)
    ):
        return hours  # already parsed
    return parse_operating_hours(hours)


def to_json(hours: OperatingHours) -> dict[str, list[dict[str, str]]]:
    """The inverse of parse — the shape stored on `restaurants.operating_hours`."""
    return {
        d: [{"open": r.open, "close": r.close} for r in hours.get(d, [])]
        for d in WEEKDAYS
    }
