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

  it("an unknown word in a saved pick is dropped, never read as a wildcard", () => {
    expect(
      Array.from(feedScopeFor("owner", ["everything"]).categories ?? []),
    ).toEqual([]);
  });

  it("manager: everything, and a saved pick is ignored", () => {
    expect(feedScopeFor("manager", ["deliveries"])).toMatchObject({
      shifts: "all",
      events: "all",
      categories: null,
    });
  });

  it("staff: own shifts and the house-and-areas events, and a saved pick is ignored", () => {
    expect(feedScopeFor("staff", ["deliveries"])).toMatchObject({
      shifts: "own",
      events: "house_and_areas",
      categories: null,
    });
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
});

describe("the category list and the migration's CHECK are the same list", () => {
  it("every category is in the CHECK, and the CHECK names no other", () => {
    const sql = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../supabase/migrations/20260921170600_a_calendar_link_belongs_to_one_person.sql",
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
