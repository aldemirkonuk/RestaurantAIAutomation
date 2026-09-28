import { CalendarService } from "./calendar.service";

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

/** Supabase stub: restaurant lookup, then events, then recurrence rules. */
function makeDb(opts: {
  /**
   * `timezone` is optional on purpose: production holds it on all 14 rows, but
   * the feed has to keep working for a row that does not, and the tests below
   * exercise both.
   */
  restaurant?: { id: string; name: string; timezone?: string | null } | null;
  events?: any[];
  rules?: any[];
}) {
  const client: any = {
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        is: () => q,
        in: async () => ({ data: opts.rules ?? [], error: null }),
        order: async () => ({ data: opts.events ?? [], error: null }),
        single: async () =>
          opts.restaurant
            ? { data: opts.restaurant, error: null }
            : { data: null, error: { message: "no rows" } },
      };
      if (table === "calendar_recurrence_rules")
        q.in = async () => ({ data: opts.rules ?? [], error: null });
      return q;
    },
  };
  return { supabase: client } as any;
}

const svc = (opts: Parameters<typeof makeDb>[0]) =>
  new CalendarService(makeDb(opts), {} as any);

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
    const out = await svc({
      restaurant: { id: "r1", name: "Aldemir Wine Bar" },
      events: [EVENT],
    }).getICalFeed("tok");

    expect(out).toMatch(/^BEGIN:VCALENDAR/);
    expect(out.trimEnd()).toMatch(/END:VCALENDAR$/);
    expect(out).toContain("VERSION:2.0");
    expect(out).toContain("PRODID:-//WineOps//Restaurant Calendar//EN");
  });

  it("uses CRLF line endings, as RFC 5545 requires", async () => {
    // Bare \n parses in some clients and is rejected outright by others, which
    // presents as "works on my phone, not in Outlook" — the least debuggable
    // possible bug report.
    const out = await svc({
      restaurant: { id: "r1", name: "Aldemir Wine Bar" },
      events: [EVENT],
    }).getICalFeed("tok");

    expect(out).toContain("\r\n");
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("gives every event a globally unique UID", async () => {
    // Clients de-duplicate on UID. Reused ids across restaurants would make one
    // subscriber's events overwrite another's inside the same calendar app.
    const out = await svc({
      restaurant: { id: "r1", name: "Aldemir Wine Bar" },
      events: [EVENT],
    }).getICalFeed("tok");

    expect(out).toContain(`UID:${EVENT.id}@wineops.app`);
  });

  it("carries the summary and a start time", async () => {
    const out = await svc({
      restaurant: { id: "r1", name: "Aldemir Wine Bar" },
      events: [EVENT],
    }).getICalFeed("tok");

    expect(out).toContain("BEGIN:VEVENT");
    expect(out).toMatch(/SUMMARY:.*Southern Glazers delivery/);
    expect(out).toMatch(/DTSTART[;:]/);
  });

  it("maps cancelled and pending onto the RFC status vocabulary", async () => {
    // "dismissed" and "pending" are ours; a client only understands CONFIRMED,
    // TENTATIVE and CANCELLED, and drops the property otherwise.
    const cancelled = await svc({
      restaurant: { id: "r1", name: "R" },
      events: [{ ...EVENT, status: "dismissed" }],
    }).getICalFeed("tok");
    expect(cancelled).toContain("STATUS:CANCELLED");

    const pending = await svc({
      restaurant: { id: "r1", name: "R" },
      events: [{ ...EVENT, status: "pending" }],
    }).getICalFeed("tok");
    expect(pending).toContain("STATUS:TENTATIVE");
  });

  it("returns an empty calendar for an unknown token, not an error", async () => {
    // T-30-09: answering 404 for a bad token and 200 for a good one turns the feed
    // URL into an oracle for guessing valid tokens. It must be indistinguishable.
    const out = await svc({ restaurant: null }).getICalFeed("not-a-real-token");

    expect(out).toMatch(/^BEGIN:VCALENDAR/);
    expect(out).not.toContain("BEGIN:VEVENT");
  });

  it("survives an event with no description or end time", async () => {
    // Real rows have nulls; an undefined reaching the generator produces a
    // property with an empty value, which some clients reject for the whole feed.
    const out = await svc({
      restaurant: { id: "r1", name: "R" },
      events: [{ ...EVENT, description: null, end_time: null, end_date: null }],
    }).getICalFeed("tok");

    expect(out).toContain("BEGIN:VEVENT");
    expect(out).not.toMatch(/DESCRIPTION:\s*\r\n/);
  });

  /* ── The four subscribe suspects, closed 2026-09-03 (ADR 0111 §5) ──────── */

  it("tells a client how often to come back", async () => {
    // Without REFRESH-INTERVAL / X-PUBLISHED-TTL every client picks its own
    // poll interval, and a delivery moved this morning surfaces tomorrow. The
    // feed reading correctly and the feed being USEFUL are different things.
    const out = await svc({
      restaurant: { id: "r1", name: "R", timezone: "America/Los_Angeles" },
      events: [EVENT],
    }).getICalFeed("tok");

    expect(out).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H");
    expect(out).toContain("X-PUBLISHED-TTL:PT1H");
  });

  it("carries the refresh hint on the empty answer too", async () => {
    // A subscriber whose first request hits an unknown token still has to be
    // told when to retry; the empty calendar is a real answer, not a stub.
    const out = await svc({ restaurant: null }).getICalFeed("nope");
    expect(out).toContain("X-PUBLISHED-TTL:PT1H");
  });

  it("publishes a timed event in the RESTAURANT's zone, not the server's", async () => {
    // The defect: `new Date('2026-08-03T09:00:00')` resolves on the process
    // clock, so a 09:00 Palo Alto delivery published as 09:00Z — 02:00 local —
    // for every subscriber. 09:00 PDT is 16:00Z, and this assertion is
    // independent of the TZ the test runner happens to have.
    const out = await svc({
      restaurant: { id: "r1", name: "R", timezone: "America/Los_Angeles" },
      events: [EVENT],
    }).getICalFeed("tok");

    expect(out).toContain("DTSTART:20260803T160000Z");
    expect(out).toContain("DTEND:20260803T170000Z");
  });

  it("uses the same restaurant's zone for a house that is not in the US", async () => {
    const out = await svc({
      restaurant: { id: "r1", name: "R", timezone: "Europe/Istanbul" },
      events: [{ ...EVENT, start_time: "19:30", end_time: "21:00" }],
    }).getICalFeed("tok");

    expect(out).toContain("DTSTART:20260803T163000Z");
    expect(out).toContain("DTEND:20260803T180000Z");
  });

  it("publishes a floating time when the restaurant has no zone, never a false UTC", async () => {
    // A wall clock with no zone is RFC 5545 form one: no Z, no TZID. Stamping
    // it UTC would assert an offset nobody recorded — the ADR 0020 fault in a
    // date field.
    const out = await svc({
      restaurant: { id: "r1", name: "R", timezone: null },
      events: [EVENT],
    }).getICalFeed("tok");

    expect(out).toContain("DTSTART:20260803T090000");
    expect(out).not.toContain("DTSTART:20260803T090000Z");
  });

  it("falls back to floating for a timezone string it cannot resolve", async () => {
    // A human-readable label is what a settings form would collect if nobody
    // constrained it, and it is not an IANA name. (Legacy aliases like "PST"
    // and "US/Pacific" ARE resolvable in Node's ICU and are deliberately let
    // through — resolving an alias is a lookup, not a guess.)
    const out = await svc({
      restaurant: { id: "r1", name: "R", timezone: "Pacific Time" },
      events: [EVENT],
    }).getICalFeed("tok");

    expect(out).toContain("DTSTART:20260803T090000");
    expect(out).not.toContain("DTSTART:20260803T090000Z");
  });

  it("keeps an all-day event's calendar date whatever the server's clock is", async () => {
    // VALUE=DATE is rendered from the Date's UTC fields, so a Date built at
    // server-local midnight shifts the published date by a day east of UTC.
    const out = await svc({
      restaurant: { id: "r1", name: "R", timezone: "America/Los_Angeles" },
      events: [
        { ...EVENT, all_day: true, start_time: null, end_time: null },
      ],
    }).getICalFeed("tok");

    expect(out).toContain("DTSTART;VALUE=DATE:20260803");
    // DTEND on an all-day event is exclusive: the day after.
    expect(out).toContain("DTEND;VALUE=DATE:20260804");
  });

  it("expands a weekly recurrence into an RRULE with day codes", async () => {
    // BYDAY indices are ours (0=Sunday); RFC 5545 wants SU/MO/TU. A wrong map
    // silently shifts every occurrence by days — visible only in the client.
    const out = await svc({
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
    }).getICalFeed("tok");

    expect(out).toMatch(/RRULE:.*FREQ=WEEKLY/);
    expect(out).toMatch(/BYDAY=MO,WE/);
    expect(out).toMatch(/COUNT=10/);
  });
});
