import {
  FEED_CATEGORIES,
  categoryOfEventType,
  feedRoleOf,
  feedScopeFor,
  scopeSentence,
  selectEvents,
  selectShifts,
  type AreaKind,
} from "./feed-scope";
import * as fs from "fs";
import * as path from "path";

/**
 * The pure rule behind every personal calendar link (ADR 0111, review trail
 * 2026-09-21). `calendar-links.service.spec.ts` proves it end to end through
 * the iCal text; this file pins the branches one at a time, including the
 * areas branch the service cannot reach until the areas lane binds its hook.
 */

const HOUSE = "house-1";
const NOW = new Date("2026-09-21T12:00:00.000Z");

describe("feedRoleOf — who the person is in this house, right now", () => {
  it("an active access row decides; owner and manager are themselves", () => {
    expect(feedRoleOf([{ role: "owner" }], null, HOUSE, NOW)).toBe("owner");
    expect(feedRoleOf([{ role: "manager" }], null, HOUSE, NOW)).toBe("manager");
  });

  it("any other word — or none — is staff: membership proven, privilege not", () => {
    expect(feedRoleOf([{ role: "staff" }], null, HOUSE, NOW)).toBe("staff");
    expect(feedRoleOf([{ role: null }], null, HOUSE, NOW)).toBe("staff");
    expect(feedRoleOf([{ role: "sommelier" }], null, HOUSE, NOW)).toBe("staff");
  });

  it("duplicate rows resolve to the LEAST of them", () => {
    expect(
      feedRoleOf([{ role: "owner" }, { role: "staff" }], null, HOUSE, NOW),
    ).toBe("staff");
    expect(
      feedRoleOf([{ role: "owner" }, { role: "manager" }], null, HOUSE, NOW),
    ).toBe("manager");
  });

  it("a row past its valid_until does not count; one still valid does", () => {
    expect(
      feedRoleOf(
        [{ role: "owner", valid_until: "2026-09-21T11:59:59Z" }],
        null,
        HOUSE,
        NOW,
      ),
    ).toBeNull();
    expect(
      feedRoleOf(
        [{ role: "owner", valid_until: "2026-09-21T12:00:01Z" }],
        null,
        HOUSE,
        NOW,
      ),
    ).toBe("owner");
  });

  it("a users row naming the house is staff — never its role column", () => {
    expect(feedRoleOf([], { restaurant_id: HOUSE }, HOUSE, NOW)).toBe("staff");
  });

  it("nothing naming the house is no role at all", () => {
    expect(feedRoleOf([], { restaurant_id: "house-2" }, HOUSE, NOW)).toBeNull();
    expect(feedRoleOf([], null, HOUSE, NOW)).toBeNull();
  });
});

describe("feedScopeFor", () => {
  it("owner: everything, narrowed only by their own pick", () => {
    expect(feedScopeFor("owner", null)).toMatchObject({
      shifts: "all",
      events: "all",
      categories: null,
    });
    expect(
      Array.from(feedScopeFor("owner", ["deliveries"]).categories ?? []),
    ).toEqual(["deliveries"]);
  });

  it.each(["owner", "manager", "staff"] as const)(
    "%s: an unknown word in a saved pick is dropped — never a wildcard, never 'no pick'",
    (role) => {
      const scope = feedScopeFor(role, ["everything"]);
      // Not null: null would mean "no pick", i.e. the whole ceiling.
      expect(scope.categories).not.toBeNull();
      expect(scope.categories?.size).toBe(0);
      expect(
        Array.from(feedScopeFor(role, ["everything", "tastings"]).categories!),
      ).toEqual(["tastings"]);
    },
  );

  it("manager: everything, narrowed only by their own pick", () => {
    expect(feedScopeFor("manager", null)).toMatchObject({
      shifts: "all",
      events: "all",
      categories: null,
    });
    const picked = feedScopeFor("manager", ["deliveries"]);
    expect(picked).toMatchObject({ shifts: "all", events: "all" });
    expect(Array.from(picked.categories ?? [])).toEqual(["deliveries"]);
  });

  it("staff: own shifts and the house-and-areas events, narrowed only by their own pick", () => {
    expect(feedScopeFor("staff", null)).toMatchObject({
      shifts: "own",
      events: "house_and_areas",
      categories: null,
    });
    // A pick naming "shifts" keeps her OWN shifts: the ceiling is the role's.
    const picked = feedScopeFor("staff", ["shifts", "deliveries"]);
    expect(picked).toMatchObject({ shifts: "own", events: "house_and_areas" });
    expect(Array.from(picked.categories ?? []).sort()).toEqual([
      "deliveries",
      "shifts",
    ]);
  });
});

/**
 * The founder, 2026-09-21 (round 6t): "Everyone can narrow (Recommended)" —
 * managers and staff may narrow their own link, and narrowing can only ever
 * show less than their role allows, never more.
 *
 * Measured exhaustively rather than on examples: every role, every one of the
 * 2^10 subsets of the category list (plus the same subsets with an unknown
 * word and a duplicate mixed in), over a fixture holding one event of every
 * category in three areas and shifts of the person, of someone else and open.
 * For each, what the pick serves must be a subset of what no pick serves.
 */
describe("a pick only ever shows less than the role allows, never more", () => {
  const types = [
    "delivery",
    "order",
    "meeting",
    "inventory",
    "tasting",
    "reminder",
    "provider_birthday",
    "holiday",
    "something_new",
  ];
  const events = types.flatMap((t) =>
    (["bar", "kitchen", null] as Array<AreaKind | null>).map((area) => ({
      id: `${t}-${area ?? "house"}`,
      event_type: t,
      area,
    })),
  );
  const areaOf = (e: (typeof events)[number]) => e.area;
  const shifts = [
    { id: "mine", member_id: "m-me" },
    { id: "theirs", member_id: "m-other" },
    { id: "open", member_id: null },
  ];
  const mine = new Set(["m-me"]);
  const areaWorlds = [
    { modelled: false as const },
    { modelled: true as const, kinds: ["bar" as AreaKind] },
  ];

  const subsets: string[][] = [];
  for (let mask = 0; mask < 1 << FEED_CATEGORIES.length; mask += 1) {
    subsets.push(FEED_CATEGORIES.filter((_, i) => mask & (1 << i)));
  }

  it.each(["owner", "manager", "staff"] as const)(
    "%s: every pick serves a subset of what no pick serves",
    (role) => {
      let checked = 0;
      for (const areas of areaWorlds) {
        const ceiling = feedScopeFor(role, null);
        const allEvents = new Set(
          selectEvents(events, ceiling, areas, areaOf).map((e) => e.id),
        );
        const allShifts = new Set(
          selectShifts(shifts, ceiling, mine).map((s) => s.id),
        );
        for (const subset of subsets) {
          for (const saved of [subset, [...subset, "everything", ...subset]]) {
            const scope = feedScopeFor(role, saved);
            // The role's ceiling is untouched by any pick.
            expect(scope.shifts).toBe(ceiling.shifts);
            expect(scope.events).toBe(ceiling.events);
            const shownEvents = selectEvents(events, scope, areas, areaOf);
            const shownShifts = selectShifts(shifts, scope, mine);
            for (const e of shownEvents) {
              expect(allEvents.has(e.id)).toBe(true);
            }
            for (const s of shownShifts) {
              expect(allShifts.has(s.id)).toBe(true);
            }
            // A junk word or a duplicate changes nothing: the pick is exactly
            // the known words in it.
            const clean = feedScopeFor(role, subset);
            expect(shownEvents).toEqual(
              selectEvents(events, clean, areas, areaOf),
            );
            expect(shownShifts).toEqual(selectShifts(shifts, clean, mine));
            checked += 1;
          }
        }
      }
      expect(checked).toBe(2 * 2 * 1024);
    },
  );

  it("staff can never reach someone else's shift or another area's event by picking", () => {
    const bar = { modelled: true as const, kinds: ["bar" as AreaKind] };
    const scope = feedScopeFor("staff", [...FEED_CATEGORIES]);
    expect(selectShifts(shifts, scope, mine).map((s) => s.id)).toEqual([
      "mine",
    ]);
    expect(
      selectEvents(events, scope, bar, areaOf).some(
        (e) => e.area === "kitchen",
      ),
    ).toBe(false);
  });

  it("an empty pick serves nothing, for every role", () => {
    for (const role of ["owner", "manager", "staff"] as const) {
      const scope = feedScopeFor(role, []);
      expect(selectEvents(events, scope, areaWorlds[0], areaOf)).toEqual([]);
      expect(selectShifts(shifts, scope, mine)).toEqual([]);
    }
  });
});

describe("selectEvents", () => {
  const events = [
    { id: "bar-delivery", event_type: "delivery", area: "bar" as AreaKind },
    {
      id: "kitchen-delivery",
      event_type: "delivery",
      area: "kitchen" as AreaKind,
    },
    { id: "house-tasting", event_type: "tasting", area: null },
  ];
  const areaOf = (e: (typeof events)[number]) => e.area;
  const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id);

  it("staff with areas modelled: their area plus house-wide, never another area", () => {
    expect(
      ids(
        selectEvents(
          events,
          feedScopeFor("staff", null),
          { modelled: true, kinds: ["bar"] },
          areaOf,
        ),
      ),
    ).toEqual(["bar-delivery", "house-tasting"]);
  });

  it("staff before areas exist: what the app already shows them — every event", () => {
    expect(
      ids(
        selectEvents(
          events,
          feedScopeFor("staff", null),
          { modelled: false },
          areaOf,
        ),
      ),
    ).toEqual(["bar-delivery", "kitchen-delivery", "house-tasting"]);
  });

  it("manager: every event, whatever its area", () => {
    expect(
      ids(
        selectEvents(
          events,
          feedScopeFor("manager", null),
          { modelled: true, kinds: [] },
          areaOf,
        ),
      ),
    ).toEqual(["bar-delivery", "kitchen-delivery", "house-tasting"]);
  });

  it("owner's pick filters by category", () => {
    expect(
      ids(
        selectEvents(
          events,
          feedScopeFor("owner", ["tastings"]),
          { modelled: false },
          areaOf,
        ),
      ),
    ).toEqual(["house-tasting"]);
  });
});

describe("selectShifts", () => {
  const shifts = [
    { id: "mine", member_id: "m-me" },
    { id: "theirs", member_id: "m-them" },
    { id: "open", member_id: null },
  ];
  const mine = new Set(["m-me"]);

  it("staff: their own only", () => {
    expect(
      selectShifts(shifts, feedScopeFor("staff", null), mine).map((s) => s.id),
    ).toEqual(["mine"]);
  });

  it("staff with no roster profile: none", () => {
    expect(
      selectShifts(shifts, feedScopeFor("staff", null), new Set()),
    ).toEqual([]);
  });

  it("owner and manager: all of them", () => {
    expect(
      selectShifts(shifts, feedScopeFor("manager", null), mine),
    ).toHaveLength(3);
    expect(
      selectShifts(shifts, feedScopeFor("owner", null), mine),
    ).toHaveLength(3);
  });

  it("an owner who did not pick shifts gets none", () => {
    expect(
      selectShifts(shifts, feedScopeFor("owner", ["deliveries"]), mine),
    ).toEqual([]);
  });
});

describe("categoryOfEventType", () => {
  it("every event type the DTO names lands in a category, unknown ones in 'other'", () => {
    expect(categoryOfEventType("delivery_eta")).toBe("deliveries");
    expect(categoryOfEventType("inventory_count")).toBe("stock_counts");
    expect(categoryOfEventType("provider_unavailable")).toBe("suppliers");
    expect(categoryOfEventType("high_volume_expected")).toBe("holidays");
    expect(categoryOfEventType("something_new")).toBe("other");
    expect(categoryOfEventType(null)).toBe("other");
  });
});

describe("scopeSentence says so when areas are not set up", () => {
  it("staff before areas: the sentence names the gap", () => {
    expect(
      scopeSentence(feedScopeFor("staff", null), { modelled: false }),
    ).toMatch(/Areas are not set up yet/);
  });

  it("a narrowed manager or staff link says it is narrowed, and from what", () => {
    expect(
      scopeSentence(feedScopeFor("manager", ["shifts"]), { modelled: false }),
    ).toBe(
      "Your link shows only what you picked (1 of 10), from the house calendar and every shift.",
    );
    expect(
      scopeSentence(feedScopeFor("staff", ["shifts", "deliveries"]), {
        modelled: false,
      }),
    ).toBe(
      "Your link shows only what you picked (2 of 10), from your own shifts and the house calendar you can already see here. Areas are not set up yet, so it cannot narrow to your area.",
    );
  });
});

describe("the category list and the migration's CHECK are the same list", () => {
  it("every category is in the CHECK, and the CHECK names no other", () => {
    const sql = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../supabase/migrations/20260925180300_a_calendar_link_belongs_to_one_person.sql",
      ),
      "utf8",
    );
    const check = sql.slice(
      sql.indexOf("categories <@ ARRAY["),
      sql.indexOf("]::TEXT[]"),
    );
    const inCheck = Array.from(check.matchAll(/'([a-z_]+)'/g)).map((m) => m[1]);
    expect(inCheck.sort()).toEqual([...FEED_CATEGORIES].sort());
  });
});
