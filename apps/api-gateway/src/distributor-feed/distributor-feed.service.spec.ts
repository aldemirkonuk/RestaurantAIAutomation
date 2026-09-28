/**
 * What a house actually gets back from `GET /distributor-feed/:jurisdiction`.
 *
 * The read-failure case is the one worth writing down: `restaurants` returning
 * an error and a house with no address recorded are DIFFERENT facts, and if
 * both render as an empty distributor list then a broken read is reported as
 * "you have no distributors" (ADR 0020 / ADR 0051).
 */

import { DistributorFeedService } from "./distributor-feed.service";

function houseDb(row: { state_province: string | null; country: string | null }) {
  return {
    client: {
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn().mockResolvedValue({ data: row, error: null }),
          })),
        })),
      })),
    },
  };
}

function failingDb() {
  return {
    client: {
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest
              .fn()
              .mockResolvedValue({ data: null, error: { message: "boom" } }),
          })),
        })),
      })),
    },
  };
}

describe("forJurisdiction", () => {
  const svc = new DistributorFeedService(houseDb({
    state_province: "IL",
    country: "USA",
  }) as never);

  it("normalises the free-text state either way round", () => {
    for (const raw of ["IL", "Illinois", "US-IL"]) {
      const r = svc.forJurisdiction(raw);
      expect(r.jurisdiction).toBe("US-IL");
      expect(r.distributors.length).toBeGreaterThan(0);
    }
  });

  it("returns not one connectable distributor, and says why in words", () => {
    const r = svc.forJurisdiction("US-IL");
    expect(r.distributors.every((d) => d.connectable === false)).toBe(true);
    expect(r.connection.offerable).toBe(false);
    expect(r.silence).toContain("Your own invoices");
  });

  it("refuses to guess a state it does not recognise", () => {
    const r = svc.forJurisdiction("Cook County");
    expect(r.jurisdiction).toBeNull();
    expect(r.distributors).toHaveLength(0);
    expect(r.silence).toContain("not a jurisdiction this register recognises");
  });

  it("says 'nobody has looked' for a state nobody measured, rather than borrowing Illinois' certainty", () => {
    const r = svc.forJurisdiction("US-WY");
    expect(r.distributors).toHaveLength(0);
    expect(r.silence).toContain("nobody has looked");
  });

  it("carries the verbatim robots rule and terms clause on the row a person reads", () => {
    const breakthru = svc
      .forJurisdiction("US-IL")
      .distributors.find((d) => d.key === "breakthru-il")!;
    expect(breakthru.automatedAccess.verdict).toBe("forbidden");
    expect(breakthru.automatedAccess.robots).toContain("Disallow: /");
    expect(breakthru.automatedAccess.terms).toContain("web crawlers");
  });
});

describe("forHouse", () => {
  it("resolves the caller's own state", async () => {
    const svc = new DistributorFeedService(
      houseDb({ state_province: "Illinois", country: "USA" }) as never,
    );
    const r = await svc.forHouse("a-house");
    expect(r.jurisdiction).toBe("US-IL");
  });

  it("falls back to the country when no province is recorded", async () => {
    const svc = new DistributorFeedService(
      houseDb({ state_province: null, country: "Türkiye" }) as never,
    );
    const r = await svc.forHouse("a-house");
    expect(r.jurisdiction).toBe("TR");
    expect(r.silence).toContain("nobody has looked");
  });

  it("says a failed read is unknown, never empty", async () => {
    const svc = new DistributorFeedService(failingDb() as never);
    const r = await svc.forHouse("a-house");
    expect(r.silence).toContain("This is unknown, not empty");
    expect(r.jurisdiction).toBeNull();
  });

  it("tells a house with no address to set one, rather than showing an empty list", async () => {
    const svc = new DistributorFeedService(
      houseDb({ state_province: null, country: null }) as never,
    );
    const r = await svc.forHouse("a-house");
    expect(r.silence).toContain("neither a state nor a country");
  });

  it("has no state to scope to without a session restaurant, and says so", async () => {
    const svc = new DistributorFeedService(failingDb() as never);
    const r = await svc.forHouse(null);
    expect(r.silence).toContain("No active restaurant on this session");
  });
});
