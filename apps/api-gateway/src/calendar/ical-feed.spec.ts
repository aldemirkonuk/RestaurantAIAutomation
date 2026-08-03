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
  restaurant?: { id: string; name: string } | null;
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
      events: [
        { ...EVENT, description: null, end_time: null, end_date: null },
      ],
    }).getICalFeed("tok");

    expect(out).toContain("BEGIN:VEVENT");
    expect(out).not.toMatch(/DESCRIPTION:\s*\r\n/);
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
