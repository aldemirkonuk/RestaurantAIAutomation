A house's time zone is now kept with its source, and Settings says where it came from (ADR 0304, PR-1 of 5).

**What changed**
- **Migration `a_house_zone_says_where_it_came_from` (20261223030000).** It adds `restaurants.timezone_source` (`address`, `device` or `stated`) and `restaurants.timezone_source_zone`, the zone that source vouches for, under the CHECK `restaurants_timezone_source_known`. It changes no row.
- **The source counts only while it is bound.** It counts only while `timezone_source_zone = timezone`. A writer that rewrites `timezone` blind unbinds it, so a source is never shown against a zone it did not vouch for.
- **`house-time-zone.service.ts` reads the bound source** and applies the witness rule. A person is named only when the newest `house_time_zone_changed` row says `to` = the zone the house keeps now: the founder's 2026-10-06 ruling, "Credit the old record".
- **The override writes `stated`.** The existing `PUT /settings/time-zone` (owner or manager) now writes source `stated`. It files an audit row when the zone or its effective source moves, and none when neither moves.
- **Settings → Time zone names the source.** It says "from the address", "from the device", "stated · {date}" (with "stated by · {name}" when the witness can be read), or "source not recorded". The Hours tab's clock row points at it. That row is tagged `manual` only when a person stands behind the zone: a bound `stated` source, or a witnessed zone.

**What did not change:** PR-1 derives nothing. No zone is worked out from an address or a device yet (PR-2), and no existing house's zone is filled in (PR-3 is a dry run, and it needs the founder's yes).

**Founder rulings this records:** F1–F4 (2026-10-05), "Credit the old record" (2026-10-06), and Reading 3, "from the device" (2026-10-07 04:15:17Z). All are quoted verbatim in ADR 0304. Readings 1 and 2 are the lane's until he confirms them (F2, not yet asked).

**Evidence**
- Local Postgres: the migration test PASSES with the migration and FAILS without it, at T0 (`timezone_source is absent`).
- Web: 47/47. Gateway `house-time-zone` jest: 20/20.
- Decision claims hold 918/918.
- The ADR 0090 audit PASSED at `64e967fc4`, and its delta re-audit PASSED at `c8b7761ce`.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
