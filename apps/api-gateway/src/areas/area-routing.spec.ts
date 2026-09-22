/**
 * The ladder, the focus split and the lead mark (ADR 0218), as pure functions.
 *
 * Every rule here is also mutation-tested by hand: `p4-scratch` records the
 * mutations and the test each one turned red (see the lane's build note).
 */
import {
  AREA_KINDS,
  AREA_DEFAULT_NAMES,
  isAreaKind,
  readAreaLabel,
} from "./area-label";
import {
  type HouseAreasSnapshot,
  type Viewer,
  areasInUse,
  effectiveLabel,
  fillAreas,
  houseLocalDay,
  isAwayOn,
  isIsoDay,
  mayActForEveryone,
  routeAlert,
  splitForViewer,
} from "./area-routing";

const OWNER = "u-owner";
const MANAGER = "u-manager";
const COOK = "u-cook";
const BARTENDER = "u-bar";
const WAITER = "u-waiter";

function house(over: Partial<HouseAreasSnapshot> = {}): HouseAreasSnapshot {
  return {
    members: [
      { userId: OWNER, role: "owner" },
      { userId: MANAGER, role: "manager" },
      { userId: COOK, role: "staff" },
      { userId: BARTENDER, role: "staff" },
      { userId: WAITER, role: "staff" },
    ],
    areas: fillAreas([]),
    memberships: [],
    away: [],
    today: "2026-09-21",
    ...over,
  };
}

const IN_BAR = { memberId: "m-bar", userId: BARTENDER, kind: "bar" as const, isLead: false };
const IN_KITCHEN = { memberId: "m-cook", userId: COOK, kind: "kitchen" as const, isLead: true };

const sorted = (ids: string[]) => [...ids].sort();

describe("the label", () => {
  it("is one of six fixed kinds, and anything else reads as house-wide", () => {
    expect(AREA_KINDS).toEqual(["kitchen", "bar", "floor", "cellar", "receiving", "management"]);
    for (const k of AREA_KINDS) {
      expect(isAreaKind(k)).toBe(true);
      expect(readAreaLabel(k)).toBe(k);
      expect(AREA_DEFAULT_NAMES[k].length).toBeGreaterThan(0);
    }
    for (const v of ["dish", "Kitchen", "", null, undefined, 3, {}]) {
      expect(readAreaLabel(v)).toBeNull();
    }
  });

  it("fills the six kinds with the house's own names and switches", () => {
    const areas = fillAreas([
      { kind: "kitchen", name: "Garde manger", enabled: true },
      { kind: "bar", name: "  ", enabled: false },
    ]);
    expect(areas.map((a) => a.kind)).toEqual([...AREA_KINDS]);
    expect(areas[0]).toEqual({ kind: "kitchen", name: "Garde manger", enabled: true });
    // A blank stored name falls back to the default; the switch is kept.
    expect(areas[1]).toEqual({ kind: "bar", name: "Bar", enabled: false });
    expect(areas[2]).toEqual({ kind: "floor", name: "Floor", enabled: true });
  });
});

describe("Away dates", () => {
  it("cover both ends of the window and nothing outside it", () => {
    const w = { userId: COOK, from: "2026-09-21", until: "2026-09-28" };
    expect(isAwayOn(w, "2026-09-20")).toBe(false);
    expect(isAwayOn(w, "2026-09-21")).toBe(true);
    expect(isAwayOn(w, "2026-09-28")).toBe(true);
    expect(isAwayOn(w, "2026-09-29")).toBe(false);
  });

  it("are read on the house's own calendar day, not UTC's", () => {
    // 22:30 UTC on the 20th is already the 21st in Istanbul (UTC+3).
    const at = new Date("2026-09-20T22:30:00Z");
    expect(houseLocalDay(at, "Europe/Istanbul")).toBe("2026-09-21");
    expect(houseLocalDay(at, "UTC")).toBe("2026-09-20");
  });

  it("accepts only real calendar days", () => {
    expect(isIsoDay("2026-09-21")).toBe(true);
    expect(isIsoDay("2026-02-30")).toBe(false);
    expect(isIsoDay("21/09/2026")).toBe(false);
    expect(isIsoDay(20260921)).toBe(false);
  });
});

describe("the ladder", () => {
  it("changes nothing for a house with nobody in any area", () => {
    const d = routeAlert("bar", house());
    expect(d.step).toBe("everyone");
    expect(sorted(d.alert)).toEqual(sorted([OWNER, MANAGER, COOK, BARTENDER, WAITER]));
    expect(d.inboxOnly).toEqual([]);
    expect(areasInUse(house())).toBe(false);
  });

  it("sends a house-wide item to everyone even when areas are in use", () => {
    const d = routeAlert(null, house({ memberships: [IN_BAR] }));
    expect(d.step).toBe("everyone");
    expect(d.alert).toHaveLength(5);
  });

  it("alerts the area's members first; owners and managers keep the row without the push", () => {
    const d = routeAlert("bar", house({ memberships: [IN_BAR, IN_KITCHEN] }));
    expect(d.step).toBe("area");
    expect(d.alert).toEqual([BARTENDER]);
    expect(sorted(d.inboxOnly)).toEqual(sorted([OWNER, MANAGER]));
    // The cook and the waiter are not in the bar and are not written to.
    expect([...d.alert, ...d.inboxOnly]).not.toContain(COOK);
    expect([...d.alert, ...d.inboxOnly]).not.toContain(WAITER);
  });

  it("reaches the lead inside the area step — a lead is a member of the area", () => {
    const d = routeAlert("kitchen", house({ memberships: [IN_BAR, IN_KITCHEN] }));
    expect(d.step).toBe("area");
    expect(d.alert).toEqual([COOK]);
  });

  it("goes to owners and managers when nobody is in the labelled area", () => {
    const d = routeAlert("cellar", house({ memberships: [IN_BAR] }));
    expect(d.step).toBe("owners_managers");
    expect(sorted(d.alert)).toEqual(sorted([OWNER, MANAGER]));
  });

  it("passes over a member with no account (nothing can reach them)", () => {
    const d = routeAlert(
      "bar",
      house({ memberships: [{ memberId: "m-x", userId: null, kind: "bar", isLead: false }] }),
    );
    expect(d.step).toBe("owners_managers");
  });

  it("never writes to someone outside the house, whatever a membership row says", () => {
    const d = routeAlert(
      "bar",
      house({ memberships: [{ memberId: "m-x", userId: "u-stranger", kind: "bar", isLead: false }] }),
    );
    expect([...d.alert, ...d.inboxOnly]).not.toContain("u-stranger");
  });

  it("treats a switched-off area's label as house-wide", () => {
    const s = house({
      memberships: [IN_BAR, IN_KITCHEN],
      areas: fillAreas([{ kind: "bar", name: "Bar", enabled: false }]),
    });
    expect(effectiveLabel("bar", s)).toBeNull();
    const d = routeAlert("bar", s);
    expect(d.step).toBe("everyone");
    expect(d.alert).toHaveLength(5);
  });

  it("does not count memberships in a switched-off area as areas in use", () => {
    const s = house({
      memberships: [IN_BAR],
      areas: fillAreas([{ kind: "bar", name: "Bar", enabled: false }]),
    });
    expect(areasInUse(s)).toBe(false);
    expect(routeAlert("kitchen", s).step).toBe("everyone");
  });

  describe("with Away", () => {
    const away = (userId: string) => ({ userId, from: "2026-09-20", until: "2026-09-28" });

    it("holds a house-wide item back from the person who is Away", () => {
      const d = routeAlert(null, house({ away: [away(WAITER)] }));
      expect(d.alert).not.toContain(WAITER);
      expect(d.inboxOnly).not.toContain(WAITER);
      expect(d.heldAway).toBe(1);
    });

    it("sends the area's item to the rest of the area when one of them is Away", () => {
      const secondBar = { memberId: "m-w", userId: WAITER, kind: "bar" as const, isLead: false };
      const d = routeAlert("bar", house({ memberships: [IN_BAR, secondBar], away: [away(BARTENDER)] }));
      expect(d.step).toBe("area");
      expect(d.alert).toEqual([WAITER]);
      expect(d.heldAway).toBe(1);
    });

    it("climbs to owners and managers when the whole area is Away", () => {
      const d = routeAlert("bar", house({ memberships: [IN_BAR], away: [away(BARTENDER)] }));
      expect(d.step).toBe("owners_managers");
      expect(sorted(d.alert)).toEqual(sorted([OWNER, MANAGER]));
    });

    it("skips an Away manager on the way up", () => {
      const d = routeAlert("bar", house({ memberships: [IN_BAR], away: [away(BARTENDER), away(MANAGER)] }));
      expect(d.alert).toEqual([OWNER]);
    });

    it("keeps an Away owner out of the inbox-only copy of an area's item", () => {
      const d = routeAlert("bar", house({ memberships: [IN_BAR], away: [away(OWNER)] }));
      expect(d.inboxOnly).toEqual([MANAGER]);
    });

    it("lands in every owner's inbox, silently, when everyone who could be alerted is Away", () => {
      const all = [OWNER, MANAGER, COOK, BARTENDER, WAITER].map(away);
      for (const label of [null, "bar"] as const) {
        const d = routeAlert(label, house({ memberships: [IN_BAR], away: all }));
        expect(d.step).toBe("owners_inbox_only");
        expect(d.alert).toEqual([]);
        expect(d.inboxOnly).toEqual([OWNER]);
      }
    });

    it("falls back to managers for the silent copy when the house has no owner row", () => {
      const s = house({
        members: [
          { userId: MANAGER, role: "manager" },
          { userId: COOK, role: "staff" },
        ],
        away: [away(MANAGER), away(COOK)],
      });
      expect(routeAlert(null, s).inboxOnly).toEqual([MANAGER]);
    });

    it("ignores a window that has ended or not started", () => {
      const d = routeAlert(null, house({
        away: [
          { userId: COOK, from: "2026-09-01", until: "2026-09-20" },
          { userId: WAITER, from: "2026-09-22", until: "2026-09-30" },
        ],
      }));
      expect(d.alert).toHaveLength(5);
      expect(d.heldAway).toBe(0);
    });
  });
});

describe("focus, not filter", () => {
  const items = [
    { id: 1, area: "kitchen" as const },
    { id: 2, area: null },
    { id: 3, area: "bar" as const },
    { id: 4, area: "kitchen" as const },
  ];
  const labelOf = (i: (typeof items)[number]) => i.area;
  const staff = (areas: string[]): Viewer => ({
    role: "staff",
    areas: new Set(areas as any),
    leadOf: new Set(),
  });

  it("puts a staff member's area first and keeps every other item below, in order", () => {
    const { yours, rest } = splitForViewer(items, labelOf, staff(["kitchen"]));
    expect(yours.map((i) => i.id)).toEqual([1, 4]);
    expect(rest.map((i) => i.id)).toEqual([2, 3]);
  });

  it("changes nothing for owners, managers, or anyone in no area", () => {
    for (const viewer of [
      { role: "owner", areas: new Set(["kitchen"]), leadOf: new Set() },
      { role: "manager", areas: new Set(["kitchen"]), leadOf: new Set() },
      staff([]),
    ] as Viewer[]) {
      const { yours, rest } = splitForViewer(items, labelOf, viewer);
      expect(yours).toEqual([]);
      expect(rest.map((i) => i.id)).toEqual([1, 2, 3, 4]);
    }
  });
});

describe("the lead mark: cards only", () => {
  const lead: Viewer = { role: "staff", areas: new Set(["bar"]), leadOf: new Set(["bar"]) };
  const member: Viewer = { role: "staff", areas: new Set(["bar"]), leadOf: new Set() };

  it("lets a lead act for everyone inside the area they lead", () => {
    expect(mayActForEveryone(lead, "bar")).toEqual({ allowed: true, via: "area_lead" });
  });

  it("stops at the edge of that area, and at house-wide items", () => {
    expect(mayActForEveryone(lead, "kitchen")).toEqual({ allowed: false, via: null });
    expect(mayActForEveryone(lead, null)).toEqual({ allowed: false, via: null });
  });

  it("is the mark, not the membership, that grants it", () => {
    expect(mayActForEveryone(member, "bar").allowed).toBe(false);
  });

  it("leaves owners and managers acting everywhere, as today", () => {
    for (const role of ["owner", "manager"] as const) {
      const v: Viewer = { role, areas: new Set(), leadOf: new Set() };
      expect(mayActForEveryone(v, null)).toEqual({ allowed: true, via: "house_role" });
      expect(mayActForEveryone(v, "cellar")).toEqual({ allowed: true, via: "house_role" });
    }
  });
});
