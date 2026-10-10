import { expiredNoticeFeed, renderFeed } from "./ical-render";
import { resolveZone } from "./zoned-time";

/**
 * iCal subscription feed — the machine-checkable half of Phase 30 UAT test 2.
 *
 * That test ("iCal subscription URL works in external calendar client") has sat
 * [pending] since 2026-05-12 while the ROADMAP described the phase as complete, so
 * the feature most exposed to a silent format bug is the one nobody has exercised.
 *
 * Subscribing from Outlook/Apple/Google genuinely needs a human. But the failure
 * that would make every client refuse — a malformed VCALENDAR — does not. If the
 * envelope is wrong, no client subscribes and no amount of clicking diagnoses why.
 * These tests pin the structure so a human UAT is left testing what only a human
 * can: whether the events look right in their calendar.
 */

/**
 * The rendering half of the feed, pure since 2026-09-21: `renderFeed` takes
 * the rows a person's link may show (`feed-scope.ts` decides which) and
 * returns the VCALENDAR. `timezone` is optional on purpose: production holds
 * it on all 14 rows, but the feed has to keep working for a row that does not,
 * and the tests below exercise both.
 */
function feed(opts: {
  restaurant: { id: string; name: string; timezone?: string | null };
  events?: any[];
  rules?: any[];
  shifts?: any[];
}): string {
  return renderFeed({
    calendarName: `${opts.restaurant.name || "Mudavym"} Calendar`,
    zone: resolveZone(opts.restaurant.timezone),
    events: opts.events ?? [],
    rules: opts.rules ?? [],
    shifts: opts.shifts ?? [],
  });
}

const EVENT = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Southern Glazers delivery",
  description: "Barolo + Sancerre",
  start_date: "2026-08-03",
  start_time: "09:00",
  end_date: "2026-08-03",
  end_time: "10:00",
  all_day: false,
  status: "confirmed",
  is_recurring: false,
  parent_event_id: null,
};

describe("iCal feed structure", () => {
  it("emits a well-formed VCALENDAR envelope", async () => {
    // If this is wrong every client refuses the subscription, and the user sees
    // only "could not fetch calendar" with nothing to act on.
    const out = feed({
      restaurant: { id: "r1", name: "Aldemir Wine Bar" },
      events: [EVENT],
    });

    expect(out).toMatch(/^BEGIN:VCALENDAR/);
    expect(out.trimEnd()).toMatch(/END:VCALENDAR$/);
    expect(out).toContain("VERSION:2.0");
    expect(out).toContain("PRODID:-//WineOps//Restaurant Calendar//EN");
  });

  it("uses CRLF line endings, as RFC 5545 requires", async () => {
    // Bare \n parses in some clients and is rejected outright by others, which
    // presents as "works on my phone, not in Outlook" — the least debuggable
    // possible bug report.
    const out = feed({
      restaurant: { id: "r1", name: "Aldemir Wine Bar" },
      events: [EVENT],
    });

    expect(out).toContain("\r\n");
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("gives every event a globally unique UID", async () => {
    // Clients de-duplicate on UID. Reused ids across restaurants would make one
    // subscriber's events overwrite another's inside the same calendar app.
    const out = feed({
      restaurant: { id: "r1", name: "Aldemir Wine Bar" },
      events: [EVENT],
    });

    expect(out).toContain(`UID:${EVENT.id}@wineops.app`);
  });

  it("carries the summary and a start time", async () => {
    const out = feed({
      restaurant: { id: "r1", name: "Aldemir Wine Bar" },
      events: [EVENT],
    });

    expect(out).toContain("BEGIN:VEVENT");
    expect(out).toMatch(/SUMMARY:.*Southern Glazers delivery/);
    expect(out).toMatch(/DTSTART[;:]/);
  });

  it("maps cancelled and pending onto the RFC status vocabulary", async () => {
    // "dismissed" and "pending" are ours; a client only understands CONFIRMED,
    // TENTATIVE and CANCELLED, and drops the property otherwise.
    const cancelled = feed({
      restaurant: { id: "r1", name: "R" },
      events: [{ ...EVENT, status: "dismissed" }],
    });
    expect(cancelled).toContain("STATUS:CANCELLED");

    const pending = feed({
      restaurant: { id: "r1", name: "R" },
      events: [{ ...EVENT, status: "pending" }],
    });
    expect(pending).toContain("STATUS:TENTATIVE");
  });

  it("a dead link gets one notice event and nothing else — not an error, not a 404", () => {
    // T-30-09: answering 404 for a bad token and 200 for a good one turns the feed
    // URL into an oracle for guessing valid tokens. The founder's 2026-09-21
    // answer adds what the subscriber SEES: "calendar link expired, connect
    // again" — as one event, carrying no data.
    const out = expiredNoticeFeed(new Date("2026-09-21T12:00:00Z"));

    expect(out).toMatch(/^BEGIN:VCALENDAR/);
    expect(out.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(out).toContain("SUMMARY:Calendar link expired - connect again");
  });

  it("survives an event with no description or end time", async () => {
    // Real rows have nulls; an undefined reaching the generator produces a
    // property with an empty value, which some clients reject for the whole feed.
    const out = feed({
      restaurant: { id: "r1", name: "R" },
      events: [{ ...EVENT, description: null, end_time: null, end_date: null }],
    });

    expect(out).toContain("BEGIN:VEVENT");
    expect(out).not.toMatch(/DESCRIPTION:\s*\r\n/);
  });

  /* ── The four subscribe suspects, closed 2026-09-03 (ADR 0111 §5) ──────── */

  it("tells a client how often to come back", async () => {
    // Without REFRESH-INTERVAL / X-PUBLISHED-TTL every client picks its own
    // poll interval, and a delivery moved this morning surfaces tomorrow. The
    // feed reading correctly and the feed being USEFUL are different things.
    const out = feed({
      restaurant: { id: "r1", name: "R", timezone: "America/Los_Angeles" },
      events: [EVENT],
    });

    expect(out).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H");
    expect(out).toContain("X-PUBLISHED-TTL:PT1H");
  });

  it("carries the refresh hint on the expired notice too", () => {
    // A subscriber whose link is dead still has to be told when to come back,
    // so a reconnect shows up within the hour rather than tomorrow.
    const out = expiredNoticeFeed(new Date("2026-09-21T12:00:00Z"));
    expect(out).toContain("X-PUBLISHED-TTL:PT1H");
  });

  it("publishes a timed event in the RESTAURANT's zone, not the server's", async () => {
    // The defect: `new Date('2026-08-03T09:00:00')` resolves on the process
    // clock, so a 09:00 Palo Alto delivery published as 09:00Z — 02:00 local —
    // for every subscriber. Since F-376 the wall clock is published with the
    // house's TZID (a UTC instant drifts an hour across DST in a repeat), and
    // this assertion is independent of the TZ the test runner happens to have.
    const out = feed({
      restaurant: { id: "r1", name: "R", timezone: "America/Los_Angeles" },
      events: [EVENT],
    });

    expect(out).toContain("DTSTART;TZID=America/Los_Angeles:20260803T090000");
    expect(out).toContain("DTEND;TZID=America/Los_Angeles:20260803T100000");
    expect(out).toContain("BEGIN:VTIMEZONE\r\nTZID:America/Los_Angeles");
    // DTSTAMP is still a UTC instant.
    expect(out).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
  });

  it("uses the same restaurant's zone for a house that is not in the US", async () => {
    const out = feed({
      restaurant: { id: "r1", name: "R", timezone: "Europe/Istanbul" },
      events: [{ ...EVENT, start_time: "19:30", end_time: "21:00" }],
    });

    expect(out).toContain("DTSTART;TZID=Europe/Istanbul:20260803T193000");
    expect(out).toContain("DTEND;TZID=Europe/Istanbul:20260803T210000");
    // Istanbul has no DST: one observance, +0300 throughout.
    expect(out).toContain("TZOFFSETFROM:+0300\r\nTZOFFSETTO:+0300");
    expect(out).not.toContain("BEGIN:DAYLIGHT");
  });

  it("publishes a floating time when the restaurant has no zone, never a false UTC", async () => {
    // A wall clock with no zone is RFC 5545 form one: no Z, no TZID. Stamping
    // it UTC would assert an offset nobody recorded — the ADR 0020 fault in a
    // date field.
    const out = feed({
      restaurant: { id: "r1", name: "R", timezone: null },
      events: [EVENT],
    });

    expect(out).toContain("DTSTART:20260803T090000");
    expect(out).not.toContain("DTSTART:20260803T090000Z");
  });

  it("falls back to floating for a timezone string it cannot resolve", async () => {
    // A human-readable label is what a settings form would collect if nobody
    // constrained it, and it is not an IANA name. (Legacy aliases like "PST"
    // and "US/Pacific" ARE resolvable in Node's ICU and are deliberately let
    // through — resolving an alias is a lookup, not a guess.)
    const out = feed({
      restaurant: { id: "r1", name: "R", timezone: "Pacific Time" },
      events: [EVENT],
    });

    expect(out).toContain("DTSTART:20260803T090000");
    expect(out).not.toContain("DTSTART:20260803T090000Z");
  });

  it("keeps an all-day event's calendar date whatever the server's clock is", async () => {
    // VALUE=DATE is rendered from the Date's UTC fields, so a Date built at
    // server-local midnight shifts the published date by a day east of UTC.
    const out = feed({
      restaurant: { id: "r1", name: "R", timezone: "America/Los_Angeles" },
      events: [{ ...EVENT, all_day: true, start_time: null, end_time: null }],
    });

    expect(out).toContain("DTSTART;VALUE=DATE:20260803");
    // DTEND on an all-day event is exclusive: the day after.
    expect(out).toContain("DTEND;VALUE=DATE:20260804");
  });

  it("expands a weekly recurrence into an RRULE with day codes", async () => {
    // BYDAY indices are ours (0=Sunday); RFC 5545 wants SU/MO/TU. A wrong map
    // silently shifts every occurrence by days — visible only in the client.
    const out = feed({
      restaurant: { id: "r1", name: "R" },
      events: [{ ...EVENT, is_recurring: true }],
      rules: [
        {
          calendar_event_id: EVENT.id,
          frequency: "weekly",
          interval_value: 1,
          days_of_week: [1, 3],
          end_after_count: 10,
        },
      ],
    });

    expect(out).toMatch(/RRULE:.*FREQ=WEEKLY/);
    expect(out).toMatch(/BYDAY=MO,WE/);
    expect(out).toMatch(/COUNT=10/);
  });

  it("ends an entry that runs past midnight on the next morning (F-790)", () => {
    const out = feed({
      restaurant: { id: "r1", name: "R", timezone: "UTC" },
      events: [
        {
          ...EVENT,
          start_time: "21:00",
          end_date: null,
          end_time: "02:00",
        },
      ],
    });

    expect(out).toContain("DTSTART:20260803T210000Z");
    expect(out).toContain("DTEND:20260804T020000Z");
  });

  it("ends an entry whose end date is its start date on the next morning when it ends before it starts (F-820)", () => {
    const out = feed({
      restaurant: { id: "r1", name: "R", timezone: "Europe/Istanbul" },
      events: [
        {
          ...EVENT,
          start_date: "2026-10-11",
          start_time: "22:00",
          end_date: "2026-10-11",
          end_time: "02:00",
        },
      ],
    });

    // On the house clock since F-376 (TZID form): 22:00 to 02:00 next morning.
    expect(out).toContain("DTSTART;TZID=Europe/Istanbul:20261011T220000");
    expect(out).toContain("DTEND;TZID=Europe/Istanbul:20261012T020000");
  });

  it("keeps an entry that ends when it starts as a zero-length moment that day (F-820)", () => {
    const out = feed({
      restaurant: { id: "r1", name: "R", timezone: "UTC" },
      events: [
        { ...EVENT, start_time: "10:00", end_date: null, end_time: "10:00" },
      ],
    });

    expect(out).toContain("DTSTART:20260803T100000Z");
    expect(out).toContain("DTEND:20260803T100000Z");
  });

  it("keeps a later end date as written when the end time is before the start time", () => {
    const out = feed({
      restaurant: { id: "r1", name: "R", timezone: "UTC" },
      events: [
        {
          ...EVENT,
          start_time: "22:00",
          end_date: "2026-08-05",
          end_time: "02:00",
        },
      ],
    });

    expect(out).toContain("DTSTART:20260803T220000Z");
    expect(out).toContain("DTEND:20260805T020000Z");
  });

  it("ends a shift that ends before it starts on the next morning, and keeps equal times a moment, as entries do (F-821)", () => {
    const SHIFT = {
      id: "s1",
      shift_date: "2026-08-03",
      summary: "Bar",
      draft: false,
      calledOut: false,
    };
    const out = feed({
      restaurant: { id: "r1", name: "R", timezone: "UTC" },
      shifts: [
        { ...SHIFT, id: "late", start_time: "22:00", end_time: "02:00" },
        { ...SHIFT, id: "moment", start_time: "10:00", end_time: "10:00" },
      ],
    });
    const vevent = (uid: string) =>
      out.split("BEGIN:VEVENT").find((b) => b.includes(`UID:shift-${uid}@`)) ??
      "";

    expect(vevent("late")).toContain("DTSTART:20260803T220000Z");
    expect(vevent("late")).toContain("DTEND:20260804T020000Z");
    expect(vevent("moment")).toContain("DTSTART:20260803T100000Z");
    expect(vevent("moment")).toContain("DTEND:20260803T100000Z");
  });

  it("keeps a monthly entry on the 31st on the last day of shorter months (F-791)", () => {
    const out = feed({
      restaurant: { id: "r1", name: "R", timezone: "UTC" },
      events: [
        {
          ...EVENT,
          start_date: "2026-08-31",
          end_date: "2026-08-31",
          is_recurring: true,
        },
      ],
      rules: [
        {
          calendar_event_id: EVENT.id,
          frequency: "monthly",
          interval_value: 1,
        },
      ],
    });

    expect(out).toMatch(
      /RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1/,
    );
  });

  it("names only the days up to a monthly 30th, so a 31-day month keeps the 30th (F-791)", () => {
    const out = feed({
      restaurant: { id: "r1", name: "R", timezone: "UTC" },
      events: [
        {
          ...EVENT,
          start_date: "2026-09-30",
          end_date: "2026-09-30",
          is_recurring: true,
        },
      ],
      rules: [
        {
          calendar_event_id: EVENT.id,
          frequency: "monthly",
          interval_value: 1,
        },
      ],
    });

    expect(out).toMatch(/BYMONTHDAY=28,29,30;BYSETPOS=-1/);
  });

  it("leaves a monthly entry on the 15th as a plain monthly rule", () => {
    const out = feed({
      restaurant: { id: "r1", name: "R", timezone: "UTC" },
      events: [
        {
          ...EVENT,
          start_date: "2026-08-15",
          end_date: "2026-08-15",
          is_recurring: true,
        },
      ],
      rules: [
        {
          calendar_event_id: EVENT.id,
          frequency: "monthly",
          interval_value: 1,
        },
      ],
    });

    expect(out).toMatch(/RRULE:FREQ=MONTHLY\r?\n/);
    expect(out).not.toMatch(/BYMONTHDAY/);
  });

  it("keeps the last kept day in the feed when a series ends on a date (F-792)", () => {
    // America/Chicago in October is UTC-5: the day ends at 04:59:59Z the next
    // morning, after the 06:00 local (11:00Z) occurrence on Oct 14.
    const out = feed({
      restaurant: { id: "r1", name: "R", timezone: "America/Chicago" },
      events: [
        {
          ...EVENT,
          start_date: "2026-10-01",
          end_date: "2026-10-01",
          start_time: "06:00",
          end_time: "07:00",
          is_recurring: true,
        },
      ],
      rules: [
        {
          calendar_event_id: EVENT.id,
          frequency: "daily",
          interval_value: 1,
          end_on_date: "2026-10-14",
        },
      ],
    });

    expect(out).toContain("UNTIL=20261015T045959Z");
  });

  it("ends an all-day series on the date itself, and a floating one on a floating time (F-792)", () => {
    const rule = {
      calendar_event_id: EVENT.id,
      frequency: "daily",
      interval_value: 1,
      end_on_date: "2026-10-14",
    };
    const allDay = feed({
      restaurant: { id: "r1", name: "R", timezone: "America/Chicago" },
      events: [{ ...EVENT, all_day: true, is_recurring: true }],
      rules: [rule],
    });
    const floating = feed({
      restaurant: { id: "r1", name: "R" },
      events: [{ ...EVENT, is_recurring: true }],
      rules: [rule],
    });

    expect(allDay).toMatch(/UNTIL=20261014(\r?\n|;)/);
    expect(floating).toMatch(/UNTIL=20261014T235959(\r?\n|;)/);
  });

  // F-376: a repeat must keep the house's wall clock across a DST change.
  // With a UTC DTSTART every client expands in UTC, so a Thursday 18:30
  // tasting showed at 17:30 from 5 November.
  const TASTING = {
    ...EVENT,
    start_date: "2026-10-22",
    start_time: "18:30",
    end_date: "2026-10-22",
    end_time: "20:00",
    is_recurring: true,
  };

  it("keeps a weekly evening repeat on the house clock across the fall-back", () => {
    const out = feed({
      restaurant: { id: "r1", name: "R", timezone: "America/Los_Angeles" },
      events: [TASTING],
      rules: [
        {
          calendar_event_id: EVENT.id,
          frequency: "weekly",
          end_type: "never",
          days_of_week: [4],
        },
      ],
    });

    expect(out).toContain("DTSTART;TZID=America/Los_Angeles:20261022T183000");
    expect(out).not.toContain("DTSTART:20261023T013000Z");
    // BYDAY is read against the TZID start, so Thursday stays Thursday.
    expect(out).toMatch(/RRULE:FREQ=WEEKLY;BYDAY=TH\r\n/);
    // The zone's own change on 1 Nov 2026 is in the VTIMEZONE.
    expect(out).toContain(
      "BEGIN:STANDARD\r\nDTSTART:20261101T020000\r\nTZOFFSETFROM:-0700\r\nTZOFFSETTO:-0800",
    );
  });

  it("ends a series at the end of its last house day, never with COUNT as well", () => {
    // A this-and-future split leaves end_after_count on the row and sets
    // end_on_date + end_type 'on_date'. T000000Z cut the last evening off,
    // and UNTIL with COUNT is forbidden (RFC 5545 §3.3.10).
    const out = feed({
      restaurant: { id: "r1", name: "R", timezone: "America/Los_Angeles" },
      events: [TASTING],
      rules: [
        {
          calendar_event_id: EVENT.id,
          frequency: "weekly",
          end_type: "on_date",
          end_on_date: "2026-11-26",
          end_after_count: 10,
          days_of_week: [4],
        },
      ],
    });

    // 26 Nov 23:59:59 PST is 27 Nov 07:59:59Z — after the 18:30 that night.
    expect(out).toContain("UNTIL=20261127T075959Z");
    expect(out).not.toMatch(/COUNT=/);
  });

  it("writes UNTIL as a date for an all-day repeat and as local for a floating one", () => {
    const allDay = feed({
      restaurant: { id: "r1", name: "R", timezone: "America/Los_Angeles" },
      events: [{ ...TASTING, all_day: true }],
      rules: [
        {
          calendar_event_id: EVENT.id,
          frequency: "daily",
          end_type: "on_date",
          end_on_date: "2026-11-26",
        },
      ],
    });
    expect(allDay).toMatch(/UNTIL=20261126(;|\r\n)/);

    const floating = feed({
      restaurant: { id: "r1", name: "R", timezone: null },
      events: [TASTING],
      rules: [
        {
          calendar_event_id: EVENT.id,
          frequency: "daily",
          end_type: "on_date",
          end_on_date: "2026-11-26",
        },
      ],
    });
    expect(floating).toContain("UNTIL=20261126T235959");
    expect(floating).not.toContain("UNTIL=20261126T235959Z");
    expect(floating).not.toContain("BEGIN:VTIMEZONE");
  });
});
