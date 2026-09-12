import {
  ZONES_SCOPE_NOTE,
  splitZones,
  toZone,
  zoneLabel,
  type ZoneVM,
} from "./zones.service";

const row = (over: Record<string, unknown> = {}) =>
  ({
    id: "z1",
    restaurant_id: "r1",
    zone: "Wine Cellar",
    section: "Main Cellar",
    name: "Wine Cellar - Main Cellar",
    capacity_bottles: 500,
    display_order: 1,
    is_active: true,
    created_at: "2026-02-08T00:00:00Z",
    zone_confirmed_at: null,
    zone_confirmed_by: null,
    zone_provenance: "unconfirmed",
    ...over,
  }) as never;

describe("zoneLabel — a zone's name, never invented", () => {
  it("prefers the row's own name", () => {
    expect(
      zoneLabel({ name: "Keg line", zone: "Bar", section: "Fridge" }),
    ).toBe("Keg line");
  });

  it("composes zone and section when there is no name", () => {
    expect(zoneLabel({ name: null, zone: "Bar", section: "Fridge" })).toBe(
      "Bar - Fridge",
    );
  });

  it("says a zone is unnamed rather than making one up", () => {
    expect(zoneLabel({ name: "   ", zone: null, section: null })).toBe(
      "Unnamed zone",
    );
  });
});

describe("toZone — what is in a zone is counted, never read off the seeder", () => {
  it("carries the counted assignment, not current_occupancy", () => {
    // Measured 2026-09-04: the demo tenant's three zones report
    // current_occupancy 180/32/45 against 17/17/16 rows actually assigned.
    const z = toZone(row(), 17);
    expect(z.itemsAssigned).toBe(17);
    expect(Object.keys(z)).not.toContain("currentOccupancy");
  });

  it("a zone whose contents could not be counted is unknown, not empty", () => {
    expect(toZone(row(), null).itemsAssigned).toBeNull();
  });

  it("an unrecognised provenance word reads as unconfirmed, never as confirmed", () => {
    expect(toZone(row({ zone_provenance: "nonsense" }), 0).provenance).toBe(
      "unconfirmed",
    );
    expect(toZone(row({ zone_provenance: null }), 0).provenance).toBe(
      "unconfirmed",
    );
  });
});

describe("splitZones — the floor draws confirmed zones and nothing else", () => {
  const zones: ZoneVM[] = [
    toZone(row({ id: "a" }), 3),
    toZone(
      row({
        id: "b",
        zone_confirmed_at: "2026-09-04T10:00:00Z",
        zone_provenance: "confirmed",
      }),
      9,
    ),
    toZone(
      row({
        id: "c",
        name: "Keg line",
        zone_confirmed_at: "2026-09-04T10:01:00Z",
        zone_provenance: "renamed",
      }),
      1,
    ),
  ];

  it("splits on the timestamp, and both renamed and confirmed are drawn", () => {
    const { confirmed, unconfirmed } = splitZones(zones);
    expect(confirmed.map((z) => z.id)).toEqual(["b", "c"]);
    expect(unconfirmed.map((z) => z.id)).toEqual(["a"]);
  });

  it("a house nobody has asked draws NOTHING — every zone is unconfirmed", () => {
    // The live state on 2026-09-04: 4 rows, 2 tenants, 4 of 4 unconfirmed.
    const { confirmed, unconfirmed } = splitZones([
      toZone(row({ id: "a" }), 0),
      toZone(row({ id: "b" }), 0),
    ]);
    expect(confirmed).toHaveLength(0);
    expect(unconfirmed).toHaveLength(2);
  });

  it("the scope note says what a drawn zone means, and what capacity is not", () => {
    expect(ZONES_SCOPE_NOTE).toMatch(
      /only once somebody in this house has confirmed/,
    );
    expect(ZONES_SCOPE_NOTE).toMatch(/current_occupancy, which disagrees/);
  });
});
