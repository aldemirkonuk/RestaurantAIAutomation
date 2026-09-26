import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  FakeDb,
  fakeDatabase,
} from "../notifications/producers/testing/fake-db";
import {
  CalendarLinksService,
  FeedUnavailableError,
  hashSecret,
} from "./calendar-links.service";
import { EXPIRED_NOTICE_TITLE, expiredNoticeFeed } from "./ical-render";
import type { PersonAreasSource } from "./feed-scope";
import { CalendarService } from "./calendar.service";

/**
 * Personal calendar links (ADR 0111, review trail 2026-09-21), run against the
 * shared in-memory store that ENFORCES the two unique indexes of migration
 * 20260926130000 (`fake-db.ts`) — so "one live link per person" and the
 * create race are measured, not assumed.
 *
 * The founder's example is the fixture: Ayse works the bar, Bora the kitchen,
 * and the owner and a manager run the house. What each link serves is read
 * back out of the real iCal text.
 */

const HOUSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_HOUSE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER = "11111111-1111-4111-8111-111111111111";
const MANAGER = "22222222-2222-4222-8222-222222222222";
const AYSE = "33333333-3333-4333-8333-333333333333";
const BORA = "44444444-4444-4444-8444-444444444444";
const LEGACY = "55555555-5555-4555-8555-555555555555";
const STRANGER = "66666666-6666-4666-8666-666666666666";

const NOW = new Date("2026-09-21T12:00:00.000Z");

function event(id: string, title: string, eventType: string, house = HOUSE) {
  return {
    id,
    restaurant_id: house,
    title,
    description: null,
    event_type: eventType,
    start_date: "2026-09-22",
    start_time: "09:00",
    end_date: "2026-09-22",
    end_time: "10:00",
    all_day: false,
    status: "approved",
    is_recurring: false,
    parent_event_id: null,
  };
}

function shift(
  id: string,
  memberId: string | null,
  over: Record<string, unknown> = {},
) {
  return {
    id,
    restaurant_id: HOUSE,
    schedule_id: "sched-published",
    member_id: memberId,
    shift_date: "2026-09-22",
    start_time: "17:00",
    end_time: "23:00",
    role: "bar",
    state: memberId ? "scheduled" : "open",
    labor_cost: 987.65,
    ...over,
  };
}

function seed(): FakeDb {
  const db = new FakeDb();
  db.tables.restaurants = [
    {
      id: HOUSE,
      name: "Meyhouse",
      timezone: "Europe/Istanbul",
      calendar_ical_token: null,
    },
    {
      id: OTHER_HOUSE,
      name: "Elsewhere",
      timezone: "UTC",
      calendar_ical_token: null,
    },
  ];
  db.tables.user_restaurant_access = [
    {
      user_id: OWNER,
      restaurant_id: HOUSE,
      role: "owner",
      is_active: true,
      valid_until: null,
    },
    {
      user_id: MANAGER,
      restaurant_id: HOUSE,
      role: "manager",
      is_active: true,
      valid_until: null,
    },
    {
      user_id: AYSE,
      restaurant_id: HOUSE,
      role: "staff",
      is_active: true,
      valid_until: null,
    },
    {
      user_id: BORA,
      restaurant_id: HOUSE,
      role: "staff",
      is_active: true,
      valid_until: null,
    },
    {
      user_id: STRANGER,
      restaurant_id: OTHER_HOUSE,
      role: "owner",
      is_active: true,
      valid_until: null,
    },
  ];
  db.tables.users = [
    {
      user_id: OWNER,
      name: "Aldemir",
      email: "owner@example.test",
      restaurant_id: null,
    },
    {
      user_id: MANAGER,
      name: "Deniz",
      email: "manager@example.test",
      restaurant_id: null,
    },
    {
      user_id: AYSE,
      name: "Ayse",
      email: "ayse@example.test",
      restaurant_id: HOUSE,
    },
    {
      user_id: BORA,
      name: "Bora",
      email: "bora@example.test",
      restaurant_id: null,
    },
    // Known only by a `users` row naming the house, and that row's role is the
    // column default `manager` — which must NOT become privilege here.
    {
      user_id: LEGACY,
      name: "Legacy",
      email: "legacy@example.test",
      restaurant_id: HOUSE,
      role: "manager",
    },
    {
      user_id: STRANGER,
      name: "Stranger",
      email: "s@example.test",
      restaurant_id: OTHER_HOUSE,
    },
  ];
  db.tables.team_members = [
    { id: "m-ayse", restaurant_id: HOUSE, user_id: AYSE, display_name: "Ayse" },
    { id: "m-bora", restaurant_id: HOUSE, user_id: BORA, display_name: "Bora" },
    {
      id: "m-legacy",
      restaurant_id: HOUSE,
      user_id: LEGACY,
      display_name: "Legacy",
    },
  ];
  db.tables.schedules = [
    { id: "sched-published", status: "published" },
    { id: "sched-draft", status: "draft" },
  ];
  db.tables.shifts = [
    shift("sh-ayse", "m-ayse"),
    shift("sh-ayse-next", "m-ayse", {
      schedule_id: "sched-draft",
      shift_date: "2026-09-29",
    }),
    shift("sh-bora", "m-bora", { role: "kitchen" }),
    shift("sh-open", null, { role: "floor" }),
    shift("sh-legacy", "m-legacy", { role: "floor" }),
  ];
  db.tables.calendar_events = [
    event("e-delivery", "Bar delivery", "delivery"),
    event("e-tasting", "Wine tasting", "tasting"),
    event("e-elsewhere", "Another house event", "meeting", OTHER_HOUSE),
  ];
  db.tables.calendar_recurrence_rules = [];
  db.tables.calendar_feed_links = [];
  db.tables.system_audit_log = [];
  return db;
}

function service(db: FakeDb, areas?: PersonAreasSource) {
  const svc = new CalendarLinksService(fakeDatabase(db, []) as never, areas);
  svc.clock = () => NOW;
  return svc;
}

/** RFC 5545 folds long lines; assertions read the unfolded text. */
function unfold(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, "");
}

function summaries(ics: string): string[] {
  return unfold(ics)
    .split("\r\n")
    .filter((l) => l.startsWith("SUMMARY:"))
    .map((l) => l.slice("SUMMARY:".length));
}

describe("a page view never makes a link", () => {
  it("getMine on a person with no link writes NOTHING to any table", async () => {
    const db = seed();
    const before = JSON.stringify(db.tables);
    const mine = await service(db).getMine(HOUSE, AYSE);
    await service(db).getMine(HOUSE, AYSE);
    expect(mine.connected).toBe(false);
    expect(JSON.stringify(db.tables)).toBe(before);
  });

  it("getMine on a person WITH a link still writes nothing, and never returns the secret", async () => {
    const db = seed();
    const svc = service(db);
    const { secret } = await svc.create(HOUSE, AYSE);
    const before = JSON.stringify(db.tables);
    const mine = await svc.getMine(HOUSE, AYSE);
    expect(mine.connected).toBe(true);
    expect(JSON.stringify(mine)).not.toContain(secret as string);
    expect(JSON.stringify(mine)).not.toContain(hashSecret(secret as string));
    expect(JSON.stringify(db.tables)).toBe(before);
  });

  it("a failed read is an error, never 'not connected'", async () => {
    const db = seed();
    db.failures.calendar_feed_links = "connection reset";
    await expect(service(db).getMine(HOUSE, AYSE)).rejects.toThrow(
      /connection reset/,
    );
  });

  it("someone who is not a member of the house is refused", async () => {
    await expect(
      service(seed()).getMine(HOUSE, STRANGER),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("connecting: one live link per person, the secret shown once", () => {
  it("stores only the hash, returns the secret once, and audits under the person's own id", async () => {
    const db = seed();
    const { link, secret } = await service(db).create(HOUSE, AYSE);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(link.connected).toBe(true);

    const rows = db.tables.calendar_feed_links;
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(hashSecret(secret as string));
    expect(JSON.stringify(rows)).not.toContain(secret as string);

    const audit = db.tables.system_audit_log;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_type: "user",
      actor_id: AYSE,
      action: "calendar_link_created",
      entity_type: "calendar_link",
      restaurant_id: HOUSE,
    });
    expect(JSON.stringify(audit)).not.toContain(secret as string);
    expect(JSON.stringify(audit)).not.toContain(hashSecret(secret as string));
  });

  it("a second press finds the link: no second row, no secret, no second audit row", async () => {
    const db = seed();
    const svc = service(db);
    await svc.create(HOUSE, AYSE);
    const again = await svc.create(HOUSE, AYSE);
    expect(again.secret).toBeNull();
    expect(again.link.connected).toBe(true);
    expect(db.tables.calendar_feed_links).toHaveLength(1);
    expect(db.tables.system_audit_log).toHaveLength(1);
  });

  it("two presses racing: exactly one link and one secret survive", async () => {
    const db = seed();
    const svc = service(db);
    const [a, b] = await Promise.all([
      svc.create(HOUSE, AYSE),
      svc.create(HOUSE, AYSE),
    ]);
    const secrets = [a.secret, b.secret].filter(Boolean);
    expect(secrets).toHaveLength(1);
    expect(
      db.tables.calendar_feed_links.filter((r) => !r.revoked_at),
    ).toHaveLength(1);
    expect(db.tables.calendar_feed_links[0].token_hash).toBe(
      hashSecret(secrets[0] as string),
    );
    expect(db.tables.system_audit_log).toHaveLength(1);
  });

  it("each person's link is their own: two people, two rows", async () => {
    const db = seed();
    const svc = service(db);
    const a = await svc.create(HOUSE, AYSE);
    const o = await svc.create(HOUSE, OWNER);
    expect(a.secret).not.toBe(o.secret);
    expect(db.tables.calendar_feed_links.map((r) => r.user_id).sort()).toEqual(
      [AYSE, OWNER].sort(),
    );
  });
});

describe("what each person's link shows", () => {
  async function feedFor(
    db: FakeDb,
    userId: string,
    areas?: PersonAreasSource,
  ) {
    const svc = service(db, areas);
    const { secret } = await svc.create(HOUSE, userId);
    return summaries(await svc.renderFor(secret as string));
  }

  it("OWNER: every event of this house and every shift — never another house's", async () => {
    const shown = await feedFor(seed(), OWNER);
    expect(shown).toEqual(
      expect.arrayContaining([
        "Bar delivery",
        "Wine tasting",
        "Ayse — shift · bar",
        "Bora — shift · kitchen",
        "Open shift · floor",
      ]),
    );
    expect(shown).not.toContain("Another house event");
  });

  it("MANAGER: the house calendar and every shift", async () => {
    const shown = await feedFor(seed(), MANAGER);
    expect(shown).toEqual(
      expect.arrayContaining([
        "Bar delivery",
        "Wine tasting",
        "Bora — shift · kitchen",
      ]),
    );
  });

  it("STAFF (Ayse): her own shifts and the house calendar — never Bora's shift or the open one", async () => {
    const shown = await feedFor(seed(), AYSE);
    expect(shown).toEqual(
      expect.arrayContaining([
        "Your shift · bar",
        "Your shift · bar (draft)",
        "Bar delivery",
      ]),
    );
    expect(shown.join("|")).not.toMatch(/Bora|kitchen|Open shift/);
  });

  // The founder, 2026-09-21 (round 6t): "Same as the app (Recommended)" —
  // until areas bind PERSON_AREAS, a staff link carries exactly the house
  // events that person sees in the app plus their shifts, never more.
  it("STAFF before areas exist: exactly the events GET /calendar/events gives her, plus her own shifts — never more", async () => {
    const db = seed();
    db.tables.calendar_events.push(
      {
        ...event("e-cancelled", "Cancelled meeting", "meeting"),
        status: "cancelled",
      },
      { ...event("e-weekly", "Weekly order", "order"), is_recurring: true },
      // A generated occurrence: the app's list leaves it out by default, and
      // the feed carries its series once, as an RRULE.
      {
        ...event("e-weekly-occurrence", "Weekly order", "order"),
        parent_event_id: "e-weekly",
      },
    );
    db.tables.calendar_recurrence_rules.push({
      calendar_event_id: "e-weekly",
      frequency: "weekly",
      interval_value: 1,
      end_on_date: null,
      end_after_count: null,
      days_of_week: null,
    });

    // The app's read, the real one, over the same rows. Her role does not
    // enter it: `GET /calendar/events` has no role filter.
    const app = await new CalendarService(
      fakeDatabase(db, []) as never,
      {} as never,
    ).listEvents(HOUSE, {});

    const svc = service(db);
    const { secret } = await svc.create(HOUSE, AYSE);
    const uids = unfold(await svc.renderFor(secret as string))
      .split("\r\n")
      .filter((l) => l.startsWith("UID:"))
      .map((l) => l.slice("UID:".length));
    const eventIds = uids
      .filter((u) => !u.startsWith("shift-"))
      .map((u) => u.replace(/@wineops\.app$/, ""));
    expect(eventIds.sort()).toEqual(app.events.map((e) => e.id).sort());
    expect(eventIds).not.toContain("e-elsewhere");
    expect(uids.filter((u) => u.startsWith("shift-")).sort()).toEqual([
      "shift-sh-ayse-next@wineops.app",
      "shift-sh-ayse@wineops.app",
    ]);
  });

  it("a shift in an unpublished week is marked a draft and TENTATIVE", async () => {
    const db = seed();
    const svc = service(db);
    const { secret } = await svc.create(HOUSE, AYSE);
    const ics = unfold(await svc.renderFor(secret as string));
    const draft = ics.slice(ics.indexOf("UID:shift-sh-ayse-next@"));
    expect(draft.slice(0, draft.indexOf("END:VEVENT"))).toContain(
      "STATUS:TENTATIVE",
    );
  });

  // ADR 0164, membership only; ADR 0111 review trail 2026-09-26. A `users`
  // row naming the house, with no access row, is not membership on this
  // public surface, whatever its role column says.
  it("a person known only by a users row is not a member: they cannot connect a link", async () => {
    const db = seed();
    const svc = service(db);
    await expect(svc.create(HOUSE, LEGACY)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.tables.calendar_feed_links).toHaveLength(0);
  });

  it("labor cost never reaches any feed", async () => {
    const db = seed();
    const svc = service(db);
    const { secret } = await svc.create(HOUSE, OWNER);
    expect(await svc.renderFor(secret as string)).not.toContain("987");
  });

  it("an owner's pick narrows the link", async () => {
    const db = seed();
    const svc = service(db);
    const { secret } = await svc.create(HOUSE, OWNER, ["deliveries"]);
    expect(summaries(await svc.renderFor(secret as string))).toEqual([
      "Bar delivery",
    ]);

    await svc.setCategories(HOUSE, OWNER, ["shifts"]);
    const shiftsOnly = summaries(await svc.renderFor(secret as string));
    expect(shiftsOnly).not.toContain("Bar delivery");
    expect(shiftsOnly).toContain("Ayse — shift · bar");
    expect(
      db.tables.system_audit_log.some(
        (r) => r.action === "calendar_link_categories_changed",
      ),
    ).toBe(true);

    await svc.setCategories(HOUSE, OWNER, null);
    expect(summaries(await svc.renderFor(secret as string))).toContain(
      "Bar delivery",
    );
  });

  // The founder, 2026-09-21 (round 6t): "Everyone can narrow (Recommended)".
  it("staff and managers may narrow their own link, audited under their own id", async () => {
    const db = seed();
    const svc = service(db);
    const ayse = await svc.create(HOUSE, AYSE, ["deliveries"]);
    expect(summaries(await svc.renderFor(ayse.secret as string))).toEqual([
      "Bar delivery",
    ]);
    expect((await svc.getMine(HOUSE, AYSE)).canPickCategories).toBe(true);

    const manager = await svc.create(HOUSE, MANAGER);
    const mine = await svc.setCategories(HOUSE, MANAGER, ["tastings"]);
    expect(mine.categories).toEqual(["tastings"]);
    expect(summaries(await svc.renderFor(manager.secret as string))).toEqual([
      "Wine tasting",
    ]);
    const audit = db.tables.system_audit_log.find(
      (r) => r.action === "calendar_link_categories_changed",
    )!;
    expect(audit).toMatchObject({
      actor_id: MANAGER,
      changes: { for_user_id: MANAGER, from: null, to: ["tastings"] },
    });
  });

  it("narrowing never shows more than the role allows: staff picking every category still gets only her own shifts", async () => {
    const db = seed();
    const svc = service(db);
    const all = await svc.create(HOUSE, AYSE);
    const ceiling = summaries(await svc.renderFor(all.secret as string));
    await svc.setCategories(HOUSE, AYSE, [
      "shifts",
      "deliveries",
      "orders",
      "meetings",
      "stock_counts",
      "tastings",
      "reminders",
      "suppliers",
      "holidays",
      "other",
    ]);
    const everyCategory = summaries(await svc.renderFor(all.secret as string));
    expect(everyCategory.sort()).toEqual([...ceiling].sort());
    expect(everyCategory.join("|")).not.toMatch(/Bora|Open shift|Legacy/);

    await svc.setCategories(HOUSE, AYSE, ["shifts"]);
    const shifts = summaries(await svc.renderFor(all.secret as string));
    expect(shifts.every((l) => ceiling.includes(l))).toBe(true);
    expect(shifts).toEqual(["Your shift · bar", "Your shift · bar (draft)"]);
  });

  it("a pick saved as an owner still narrows after a demotion — never more than the new role allows", async () => {
    const db = seed();
    const svc = service(db);
    const { secret } = await svc.create(HOUSE, OWNER, ["deliveries", "shifts"]);
    const access = db.tables.user_restaurant_access.find(
      (r) => r.user_id === OWNER,
    )!;

    access.role = "manager";
    const asManager = summaries(await svc.renderFor(secret as string));
    expect(asManager).toContain("Bar delivery");
    expect(asManager).toContain("Bora — shift · kitchen");
    expect(asManager).not.toContain("Wine tasting");

    access.role = "staff";
    const asStaff = summaries(await svc.renderFor(secret as string));
    // The owner has no roster profile, so as staff there are no own shifts.
    expect(asStaff).toEqual(["Bar delivery"]);
  });

  it("an unknown category is refused", async () => {
    await expect(
      service(seed()).create(HOUSE, OWNER, ["everything"]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("a promotion changes the link at once — the role is read at every request", async () => {
    const db = seed();
    const svc = service(db);
    const { secret } = await svc.create(HOUSE, AYSE);
    expect(
      summaries(await svc.renderFor(secret as string)).join("|"),
    ).not.toContain("Bora");
    db.tables.user_restaurant_access.find((r) => r.user_id === AYSE)!.role =
      "manager";
    expect(summaries(await svc.renderFor(secret as string))).toContain(
      "Bora — shift · kitchen",
    );
  });

  it("the areas hook is asked for staff, and the page says whether areas exist", async () => {
    const db = seed();
    const asked: string[] = [];
    const areas: PersonAreasSource = {
      async areasOf(_house, user) {
        asked.push(user);
        return { modelled: true, kinds: ["bar"] };
      },
    };
    const svc = service(db, areas);
    const { secret } = await svc.create(HOUSE, AYSE);
    await svc.renderFor(secret as string);
    expect(asked).toContain(AYSE);
    expect((await svc.getMine(HOUSE, AYSE)).areasModelled).toBe(true);
    expect((await service(seed()).getMine(HOUSE, AYSE)).areasModelled).toBe(
      false,
    );
  });
});

describe("a person removed from the house: their link stops, nobody else's", () => {
  it("the link serves, removal happens, the same link answers the expired notice; the owner's still serves", async () => {
    const db = seed();
    const svc = service(db);
    const ayse = await svc.create(HOUSE, AYSE);
    const owner = await svc.create(HOUSE, OWNER);
    expect(summaries(await svc.renderFor(ayse.secret as string))).toContain(
      "Your shift · bar",
    );

    // What MembersService.removeMember does: the users row stops naming the
    // house, then the access row is deleted.
    db.tables.users.find((u) => u.user_id === AYSE)!.restaurant_id = null;
    db.tables.user_restaurant_access = db.tables.user_restaurant_access.filter(
      (r) => r.user_id !== AYSE,
    );

    expect(await svc.renderFor(ayse.secret as string)).toBe(
      expiredNoticeFeed(NOW),
    );
    expect(summaries(await svc.renderFor(owner.secret as string))).toContain(
      "Bar delivery",
    );
  });

  // The founder, 2026-09-21 (round 6t): "Yes, revoke on leaving
  // (Recommended)" — a returning person connects again; no dormant revival.
  // The doors that end a membership stop the link themselves
  // (`calendar-links-leaving.spec.ts`); this is the feed's own catch for a
  // membership that ended outside them.
  it("a membership that ended outside the doors: the feed stops the link for good, audited as the system", async () => {
    const db = seed();
    const svc = service(db);
    const { secret } = await svc.create(HOUSE, BORA);
    const access = db.tables.user_restaurant_access.find(
      (r) => r.user_id === BORA,
    )!;
    access.valid_until = "2026-09-20T00:00:00.000Z";

    expect(await svc.renderFor(secret as string)).toBe(expiredNoticeFeed(NOW));
    const row = db.tables.calendar_feed_links.find((r) => r.user_id === BORA)!;
    expect(row).toMatchObject({
      revoked_at: NOW.toISOString(),
      revoked_by: null,
      revoke_reason: "left_house",
    });
    expect(
      db.tables.system_audit_log.find(
        (r) => r.action === "calendar_link_revoked",
      ),
    ).toMatchObject({
      actor_type: "system",
      actor_id: null,
      entity_id: row.id,
      restaurant_id: HOUSE,
      changes: {
        for_user_id: BORA,
        by: "leaving_house",
        via: "feed_found_no_membership",
      },
    });

    // Let back in: the old address does NOT serve again.
    access.valid_until = null;
    expect(await svc.renderFor(secret as string)).toBe(expiredNoticeFeed(NOW));
    expect((await svc.getMine(HOUSE, BORA)).connected).toBe(false);
    // Connecting again makes a new address, and it serves.
    const again = await svc.create(HOUSE, BORA);
    expect(again.secret).not.toBe(secret);
    expect(summaries(await svc.renderFor(again.secret as string))).toContain(
      "Your shift · kitchen",
    );
  });

  // The stale-row case (ADR 0111 review trail 2026-09-26): a hand-run delete
  // or deactivation of the access row that leaves `users.restaurant_id`
  // naming the house. Ayse's users row is seeded naming HOUSE, so this is the
  // hazard itself, not a row that already stopped naming it.
  for (const how of ["deleted", "deactivated"] as const) {
    it(`an access row ${how} by hand, users.restaurant_id left naming the house: the feed stops the link`, async () => {
      const db = seed();
      const svc = service(db);
      const { secret } = await svc.create(HOUSE, AYSE);
      expect(summaries(await svc.renderFor(secret as string))).toContain(
        "Your shift · bar",
      );
      expect(
        db.tables.users.find((u) => u.user_id === AYSE)!.restaurant_id,
      ).toBe(HOUSE);
      if (how === "deleted") {
        db.tables.user_restaurant_access =
          db.tables.user_restaurant_access.filter((r) => r.user_id !== AYSE);
      } else {
        db.tables.user_restaurant_access.find(
          (r) => r.user_id === AYSE,
        )!.is_active = false;
      }

      expect(await svc.renderFor(secret as string)).toBe(
        expiredNoticeFeed(NOW),
      );
      expect(
        db.tables.calendar_feed_links.find((r) => r.user_id === AYSE),
      ).toMatchObject({
        revoked_at: NOW.toISOString(),
        revoke_reason: "left_house",
      });
    });
  }

  it("a failed stop by the feed is logged, never a 503: the dead address still answers the notice", async () => {
    const db = seed();
    const svc = service(db);
    const { secret } = await svc.create(HOUSE, BORA);
    db.tables.user_restaurant_access = db.tables.user_restaurant_access.filter(
      (r) => r.user_id !== BORA,
    );
    const update = db.from.bind(db);
    // Fail only the stop (an UPDATE on calendar_feed_links); the lookup still reads.
    db.from = ((table: string) => {
      const q = update(table);
      if (table !== "calendar_feed_links") return q;
      const realUpdate = q.update.bind(q);
      q.update = (patch: Record<string, unknown>) => {
        if ("revoke_reason" in patch) {
          db.failures.calendar_feed_links = "write refused";
        }
        return realUpdate(patch);
      };
      return q;
    }) as typeof db.from;
    expect(await svc.renderFor(secret as string)).toBe(expiredNoticeFeed(NOW));
  });

  it("a deactivated access row stops the link too", async () => {
    const db = seed();
    const svc = service(db);
    const { secret } = await svc.create(HOUSE, BORA);
    db.tables.user_restaurant_access.find(
      (r) => r.user_id === BORA,
    )!.is_active = false;
    expect(await svc.renderFor(secret as string)).toBe(expiredNoticeFeed(NOW));
  });

  it("an access row whose valid_until has passed stops the link", async () => {
    const db = seed();
    const svc = service(db);
    const { secret } = await svc.create(HOUSE, BORA);
    db.tables.user_restaurant_access.find(
      (r) => r.user_id === BORA,
    )!.valid_until = "2026-09-20T00:00:00.000Z";
    expect(await svc.renderFor(secret as string)).toBe(expiredNoticeFeed(NOW));
  });
});

describe("a dead address answers one notice, the same for every cause", () => {
  it("the notice is exactly one all-day event with the founder's words and no data", () => {
    const ics = unfold(expiredNoticeFeed(NOW));
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(summaries(ics)).toEqual([EXPIRED_NOTICE_TITLE]);
    expect(EXPIRED_NOTICE_TITLE).toBe("Calendar link expired - connect again");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260920");
    expect(ics).toContain("DTEND;VALUE=DATE:20260923");
    expect(ics).not.toMatch(/Meyhouse|delivery|shift/i);
  });

  it("revoked, rotated away, never existed, malformed and the retired house link are byte-identical", async () => {
    const db = seed();
    const svc = service(db);

    const revoked = await svc.create(HOUSE, AYSE);
    expect(summaries(await svc.renderFor(revoked.secret as string))).toContain(
      "Bar delivery",
    );
    expect(await svc.revokeMine(HOUSE, AYSE)).toEqual({ revoked: true });

    const rotated = await svc.create(HOUSE, OWNER);
    const renewed = await svc.rotate(HOUSE, OWNER);
    expect(renewed.secret).not.toBe(rotated.secret);

    // The shared house link the migration switched off: the column may still
    // hold a value on an unmigrated copy; the feed never reads it.
    const houseLink = "c".repeat(64);
    db.tables.restaurants.find((r) => r.id === HOUSE)!.calendar_ical_token =
      houseLink;

    const answers = [
      await svc.renderFor(revoked.secret as string),
      await svc.renderFor(rotated.secret as string),
      await svc.renderFor("d".repeat(64)),
      await svc.renderFor("not-a-link"),
      await svc.renderFor(houseLink),
    ];
    for (const a of answers) expect(a).toBe(expiredNoticeFeed(NOW));

    // …and the new secret serves.
    expect(summaries(await svc.renderFor(renewed.secret))).toContain(
      "Bar delivery",
    );
  });

  it("rotating keeps one row, replaces the hash, resets last-read, and is audited", async () => {
    const db = seed();
    const svc = service(db);
    const first = await svc.create(HOUSE, AYSE);
    await svc.renderFor(first.secret as string);
    expect((await svc.getMine(HOUSE, AYSE)).lastFetchedAt).toBe(
      NOW.toISOString(),
    );

    const next = await svc.rotate(HOUSE, AYSE);
    expect(db.tables.calendar_feed_links).toHaveLength(1);
    expect(db.tables.calendar_feed_links[0].token_hash).toBe(
      hashSecret(next.secret),
    );
    expect(next.link.lastFetchedAt).toBeNull();
    expect(db.tables.system_audit_log.map((r) => r.action)).toEqual([
      "calendar_link_created",
      "calendar_link_rotated",
    ]);
  });

  it("stopping your own link twice: the second is a no-op with no audit row", async () => {
    const db = seed();
    const svc = service(db);
    await svc.create(HOUSE, AYSE);
    await svc.revokeMine(HOUSE, AYSE);
    expect(await svc.revokeMine(HOUSE, AYSE)).toEqual({ revoked: false });
    expect(
      db.tables.system_audit_log.filter(
        (r) => r.action === "calendar_link_revoked",
      ),
    ).toHaveLength(1);
    // …and connecting again makes a fresh live row beside the stopped one.
    const again = await svc.create(HOUSE, AYSE);
    expect(again.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(
      db.tables.calendar_feed_links.filter((r) => !r.revoked_at),
    ).toHaveLength(1);
  });
});

describe("an owner or manager stops someone's link", () => {
  it("only the target's link stops, and the audit row names both people", async () => {
    const db = seed();
    const svc = service(db);
    const ayse = await svc.create(HOUSE, AYSE);
    const manager = await svc.create(HOUSE, MANAGER);

    expect(await svc.revokeFor(HOUSE, MANAGER, AYSE)).toEqual({
      revoked: true,
    });
    expect(await svc.renderFor(ayse.secret as string)).toBe(
      expiredNoticeFeed(NOW),
    );
    expect(summaries(await svc.renderFor(manager.secret as string))).toContain(
      "Bar delivery",
    );

    const row = db.tables.calendar_feed_links.find((r) => r.user_id === AYSE)!;
    expect(row).toMatchObject({
      revoked_by: MANAGER,
      revoke_reason: "revoked_by_manager",
    });
    const audit = db.tables.system_audit_log.find(
      (r) => r.action === "calendar_link_revoked",
    )!;
    expect(audit).toMatchObject({
      actor_id: MANAGER,
      changes: { for_user_id: AYSE },
    });
  });

  it("a person in another house cannot be reached through this house", async () => {
    const db = seed();
    const svc = service(db);
    const stranger = await svc.create(OTHER_HOUSE, STRANGER);
    expect(await svc.revokeFor(HOUSE, OWNER, STRANGER)).toEqual({
      revoked: false,
    });
    expect(summaries(await svc.renderFor(stranger.secret as string))).toContain(
      "Another house event",
    );
  });

  it("the register lists who has connected, by name, and never a secret or hash", async () => {
    const db = seed();
    const svc = service(db);
    const ayse = await svc.create(HOUSE, AYSE);
    await svc.create(OTHER_HOUSE, STRANGER);
    const list = await svc.listHouse(HOUSE, OWNER);
    expect(list.map((r) => [r.userId, r.name])).toEqual([[AYSE, "Ayse"]]);
    expect(JSON.stringify(list)).not.toContain(ayse.secret as string);
    expect(JSON.stringify(list)).not.toContain(
      hashSecret(ayse.secret as string),
    );
  });
});

/**
 * Owners manage owners (ADR 0162's owner rule). The founder, 2026-09-21
 * (round 6t): "No, owners only (Recommended)" — a manager can stop manager
 * and staff links, never an owner's; only an owner stops an owner's link.
 * The gate is in the service, on both roles, before any write; tested both
 * ways.
 */
describe("stopping someone's link: owners manage owners", () => {
  const OWNER2 = "77777777-7777-4777-8777-777777777777";
  const MANAGER2 = "88888888-8888-4888-8888-888888888888";

  function house(): FakeDb {
    const db = seed();
    db.tables.user_restaurant_access.push(
      {
        user_id: OWNER2,
        restaurant_id: HOUSE,
        role: "owner",
        is_active: true,
        valid_until: null,
      },
      {
        user_id: MANAGER2,
        restaurant_id: HOUSE,
        role: "manager",
        is_active: true,
        valid_until: null,
      },
    );
    db.tables.users.push(
      { user_id: OWNER2, name: "Co-owner", restaurant_id: null },
      { user_id: MANAGER2, name: "Second manager", restaurant_id: null },
    );
    return db;
  }

  async function linkOf(svc: CalendarLinksService, user: string) {
    return (await svc.create(HOUSE, user)).secret as string;
  }

  it.each([["an owner's", OWNER]])(
    "a manager may NOT stop %s link: refused, nothing written, and it still serves",
    async (_label, target) => {
      const db = house();
      const svc = service(db);
      const secret = await linkOf(svc, target);
      const before = JSON.stringify(db.tables.calendar_feed_links);
      const audits = db.tables.system_audit_log.length;

      await expect(svc.revokeFor(HOUSE, MANAGER, target)).rejects.toThrow(
        "Only an owner can stop an owner's calendar link.",
      );
      await expect(
        svc.revokeFor(HOUSE, MANAGER, target),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(JSON.stringify(db.tables.calendar_feed_links)).toBe(before);
      expect(db.tables.system_audit_log).toHaveLength(audits);
      expect(await svc.renderFor(secret)).not.toBe(expiredNoticeFeed(NOW));
    },
  );

  it.each([
    ["another manager's", MANAGER2, "manager"],
    ["a staff member's", AYSE, "staff"],
  ])(
    "a manager MAY stop %s link, audited with both roles",
    async (_label, target, targetRole) => {
      const db = house();
      const svc = service(db);
      const secret = await linkOf(svc, target);
      expect(await svc.revokeFor(HOUSE, MANAGER, target)).toEqual({
        revoked: true,
      });
      expect(await svc.renderFor(secret)).toBe(expiredNoticeFeed(NOW));
      expect(
        db.tables.system_audit_log.find(
          (r) => r.action === "calendar_link_revoked",
        ),
      ).toMatchObject({
        actor_id: MANAGER,
        changes: {
          for_user_id: target,
          by: "owner_or_manager",
          actor_role: "manager",
          target_role: targetRole,
        },
      });
    },
  );

  it.each([
    ["a co-owner's", OWNER2, "owner"],
    ["a manager's", MANAGER, "manager"],
    ["a staff member's", AYSE, "staff"],
  ])("an owner MAY stop %s link", async (_label, target, targetRole) => {
    const db = house();
    const svc = service(db);
    const secret = await linkOf(svc, target);
    expect(await svc.revokeFor(HOUSE, OWNER, target)).toEqual({
      revoked: true,
    });
    expect(await svc.renderFor(secret)).toBe(expiredNoticeFeed(NOW));
    expect(
      db.tables.system_audit_log.find(
        (r) => r.action === "calendar_link_revoked",
      )?.changes,
    ).toMatchObject({ actor_role: "owner", target_role: targetRole });
  });

  it("CalendarLinksService.mayStop: owners manage owners, both ways", () => {
    const mayStop = CalendarLinksService.mayStop;
    const roles = ["owner", "manager", "staff", null] as const;
    const table: Record<string, boolean> = {};
    for (const a of roles) {
      for (const t of roles) table[`${a}->${t}`] = mayStop(a, t, false);
    }
    expect(table).toEqual({
      "owner->owner": true,
      "owner->manager": true,
      "owner->staff": true,
      "owner->null": true,
      "manager->owner": false,
      "manager->manager": true,
      "manager->staff": true,
      "manager->null": true,
      "staff->owner": false,
      "staff->manager": false,
      "staff->staff": false,
      "staff->null": false,
      "null->owner": false,
      "null->manager": false,
      "null->staff": false,
      "null->null": false,
    });
    // Your own link is yours to stop, whatever your role — if you have one.
    expect(mayStop("staff", "staff", true)).toBe(true);
    expect(mayStop("manager", "manager", true)).toBe(true);
    expect(mayStop(null, null, true)).toBe(false);
  });

  it("a manager may stop their own link through the register", async () => {
    const db = house();
    const svc = service(db);
    await linkOf(svc, MANAGER);
    expect(await svc.revokeFor(HOUSE, MANAGER, MANAGER)).toEqual({
      revoked: true,
    });
  });

  it("staff, and someone not in the house, stop nobody else's link — refused before any write", async () => {
    const db = house();
    const svc = service(db);
    await linkOf(svc, BORA);
    const before = JSON.stringify(db.tables);
    for (const actor of [AYSE, STRANGER]) {
      await expect(svc.revokeFor(HOUSE, actor, BORA)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(svc.revokeFor(HOUSE, actor, BORA)).rejects.toThrow(
        "Only an owner or a manager can stop someone else's calendar link.",
      );
    }
    expect(JSON.stringify(db.tables)).toBe(before);
  });

  it("a failed role read refuses the stop and writes nothing — never read as 'not an owner'", async () => {
    const db = house();
    const svc = service(db);
    await linkOf(svc, OWNER);
    const before = JSON.stringify(db.tables.calendar_feed_links);
    db.failures.user_restaurant_access = "connection reset";
    await expect(svc.revokeFor(HOUSE, MANAGER, OWNER)).rejects.toThrow(
      /Could not read a role in this house/,
    );
    delete db.failures.user_restaurant_access;
    expect(JSON.stringify(db.tables.calendar_feed_links)).toBe(before);
  });

  it("the register says, per row and per caller, who may stop what", async () => {
    const db = house();
    const svc = service(db);
    for (const u of [OWNER, OWNER2, MANAGER, MANAGER2, AYSE]) {
      await linkOf(svc, u);
    }
    const byManager = new Map(
      (await svc.listHouse(HOUSE, MANAGER)).map((r) => [
        r.userId,
        [r.role, r.canStop],
      ]),
    );
    expect(Object.fromEntries(byManager)).toEqual({
      [OWNER]: ["owner", false],
      [OWNER2]: ["owner", false],
      [MANAGER]: ["manager", true],
      [MANAGER2]: ["manager", true],
      [AYSE]: ["staff", true],
    });
    const byOwner = await svc.listHouse(HOUSE, OWNER);
    expect(byOwner.every((r) => r.canStop)).toBe(true);
  });

  it("the register shows a person with no role here as no longer a member", async () => {
    const db = house();
    const svc = service(db);
    await linkOf(svc, BORA);
    // Left by a hand-run delete: no door stopped the link.
    db.tables.user_restaurant_access = db.tables.user_restaurant_access.filter(
      (r) => r.user_id !== BORA,
    );
    const row = (await svc.listHouse(HOUSE, MANAGER)).find(
      (r) => r.userId === BORA,
    )!;
    expect(row).toMatchObject({ role: null, canStop: true });
  });

  it("an active access row with a NULL role is a member (staff), not someone who left", async () => {
    const db = house();
    const svc = service(db);
    await linkOf(svc, BORA);
    db.tables.user_restaurant_access.find((r) => r.user_id === BORA)!.role =
      null;
    const row = (await svc.listHouse(HOUSE, MANAGER)).find(
      (r) => r.userId === BORA,
    )!;
    expect(row).toMatchObject({ role: "staff", canStop: true });
  });
});

describe("a failed read is never shown as an expired link or an empty calendar", () => {
  for (const table of [
    "calendar_feed_links",
    "user_restaurant_access",
    "restaurants",
    "calendar_events",
    "team_members",
    "shifts",
    "schedules",
  ]) {
    it(`${table} unreadable → FeedUnavailableError`, async () => {
      const db = seed();
      const svc = service(db);
      const { secret } = await svc.create(HOUSE, OWNER);
      db.failures[table] = "connection reset";
      await expect(svc.renderFor(secret as string)).rejects.toBeInstanceOf(
        FeedUnavailableError,
      );
    });
  }
});

describe("the shared house link was retired: owners and managers are told", () => {
  it("true for the house's owner and manager, false for staff and for another house", async () => {
    const db = seed();
    db.tables.system_audit_log.push({
      actor_type: "system",
      action: "calendar_ical_house_link_retired",
      entity_type: "restaurant",
      entity_id: HOUSE,
      restaurant_id: HOUSE,
    });
    const svc = service(db);
    expect((await svc.getMine(HOUSE, OWNER)).houseLinkRetired).toBe(true);
    expect((await svc.getMine(HOUSE, MANAGER)).houseLinkRetired).toBe(true);
    expect((await svc.getMine(HOUSE, AYSE)).houseLinkRetired).toBe(false);
    expect((await svc.getMine(OTHER_HOUSE, STRANGER)).houseLinkRetired).toBe(
      false,
    );
  });
});
