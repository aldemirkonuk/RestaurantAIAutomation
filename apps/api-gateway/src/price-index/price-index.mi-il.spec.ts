/**
 * What a Michigan house and an Illinois house actually get back from
 * `GET /price-index/:state` — driven through the real service, so the sentence
 * the panel prints is proved end to end rather than only at the note.
 *
 * These live in their own file, not in `price-index.service.spec.ts`, because
 * that file is being edited concurrently by the Türkiye/UK research.
 */

import { PriceIndexService } from "./price-index.service";
import { SOURCES } from "./price-index.registry";
import { noSourceSentence } from "./silence-notes";

/** A db whose reads succeed and return nothing — an EMPTY register, not a failed one. */
function emptyRegisterDb() {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
  };
  return {
    client: {
      from: jest.fn(() => ({
        ...chain,
        select: jest.fn(() => ({
          ...chain,
          // head:true count reads resolve straight off select().eq().eq()
          eq: jest.fn(() => ({
            ...chain,
            eq: jest.fn().mockResolvedValue({ count: 0, error: null, data: [] }),
          })),
        })),
      })),
    },
  };
}

describe("GET /price-index/:state — Illinois", () => {
  const svc = new PriceIndexService(emptyRegisterDb() as never);

  it("normalises the free-text state either way round", async () => {
    for (const raw of ["IL", "Illinois", "US-IL"]) {
      const r = await svc.forState(raw);
      expect(r.state).toBe("US-IL");
    }
  });

  it("holds no source for Illinois — there is nothing to hold", async () => {
    const r = await svc.forState("Illinois");
    expect(r.sources).toHaveLength(0);
    expect(r.lines).toHaveLength(0);
    expect(
      Object.values(SOURCES).filter((s) => s.jurisdiction === "US-IL"),
    ).toHaveLength(0);
  });

  it("says WHY, with the statute, instead of promising a search", async () => {
    const r = await svc.forState("Illinois");
    expect(r.silence).toBe(noSourceSentence("US-IL"));
    expect(r.silence).toMatch(/235 ILCS 5\/6-19/);
    expect(r.silence).toMatch(/1 January 1998/);
    expect(r.silence).toMatch(/11 Ill\. Adm\. Code 100/);
    // The pre-fix sentence, which is what `git show HEAD:` still carries.
    expect(r.silence).not.toMatch(/until one is found/i);
  });
});

describe("GET /price-index/:state — Michigan", () => {
  const svc = new PriceIndexService(emptyRegisterDb() as never);

  it("names the Commission, the block, and the way round it", async () => {
    const r = await svc.forState("MI");
    expect(r.state).toBe("US-MI");
    // TWO since 2026-09-05 (ADR 0126): the published spirits book and the
    // FILED beer and wine schedules. This assertion read `toHaveLength(1)` and
    // was green while the register held only half of what Michigan posts —
    // the second half being the one three Michigan houses actually buy.
    expect(r.sources).toHaveLength(2);
    expect(r.sources.map((s) => s.key).sort()).toEqual([
      "michigan-lcc-filed-beer-wine-schedules",
      "michigan-lcc-spirits-price-book",
    ]);
    for (const s of r.sources) {
      expect(s.issuer).toBe("Michigan Liquor Control Commission");
      expect(s.withheld).not.toBeNull();
    }
    expect(r.silence).toMatch(/Michigan Liquor Control Commission/);
    expect(r.silence).toMatch(/403/);
    // The half the old sentence lacked: a Michigan house is not stuck.
    expect(r.silence).toMatch(/A manager can download the quarterly book/);
    expect(r.silence).toMatch(/upload it/);
    // And the half THIS pass added: "upload the book" is true of spirits and
    // false of wine, so the filed list gets its own clause with its embargo.
    expect(r.silence).toMatch(/filed with the issuer rather than published/);
    expect(r.silence).toMatch(/365 days/);
  });

  it("files the beer and wine schedules as a request, not as a fetch, and does not claim the request was sent", () => {
    const foia = SOURCES["michigan-lcc-filed-beer-wine-schedules"];
    expect(foia.intake).toBe("foia");
    expect(foia.parse).toBeUndefined();
    expect(foia.withheld).toBeDefined();
    // Nothing has been filed. A drafted letter reported as a filed request
    // would be an intention reported as an action.
    expect(foia.standingRequest?.status).toBe("not_yet_filed");
    expect(foia.standingRequest?.filedOn).toBeNull();
    expect(foia.standingRequest?.draft).toContain(
      "MICHIGAN-FOIA-BEER-WINE-SCHEDULES.md",
    );
  });

  it("sets a bound that is the embargo's arithmetic, never a freshness allowance", () => {
    const foia = SOURCES["michigan-lcc-filed-beer-wine-schedules"];
    expect(foia.standingRequest?.statutoryEmbargoDays).toBe(365);
    // A granted request cannot return anything younger than the embargo, so a
    // bound at or below it would refuse every answer this source can ever give.
    expect(foia.maxAgeDays).toBeGreaterThan(365);
    expect(foia.maxAgeDays).toBe(480);
    // And it must stay far above every OTHER source's bound, so nobody copies
    // it across as though this register tolerated sixteen-month-old prices.
    expect(foia.maxAgeDays).toBeGreaterThan(
      SOURCES["michigan-lcc-spirits-price-book"].maxAgeDays,
    );
  });

  it("carries the corrected quarterly cadence, not the old monthly one", () => {
    const mi = SOURCES["michigan-lcc-spirits-price-book"];
    expect(mi.cadence).toMatch(/quarterly/);
    expect(mi.cadence).toMatch(/91 days/);
    // 62 days would refuse a current book from day 63 of its own 91-day cycle.
    expect(mi.maxAgeDays).toBe(105);
    expect(mi.maxAgeDays).toBeGreaterThan(91);
  });

  it("is uploadable but never fetchable — the scheduled sweep must skip it", () => {
    const mi = SOURCES["michigan-lcc-spirits-price-book"];
    expect(mi.intake).toBe("upload");
    expect(mi.withheld).toBeDefined();
    // The sweep's own guard is `source.withheld || !source.parse`; both hold.
    expect(mi.parse).toBeUndefined();
    expect(mi.fixture).toBe("michigan-lcc-price-book-2025-08-03.sample.json");
  });
});

describe("a jurisdiction nobody has researched", () => {
  const svc = new PriceIndexService(emptyRegisterDb() as never);

  it("says so, rather than implying a conclusion", async () => {
    const r = await svc.forState("North Dakota");
    expect(r.state).toBe("US-ND");
    expect(r.silence).toMatch(/nobody has looked/i);
    expect(r.silence).not.toMatch(/until one is found/i);
  });
});
