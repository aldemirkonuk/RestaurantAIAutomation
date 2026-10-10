import { InsightSchedulerService } from "./insight-scheduler.service";

/**
 * F-329: "daily at 06:00" is 06:00 on the house's clock. On the server's UTC
 * clock an LA house's morning findings were built at 23:00 the evening before,
 * mid-service, and an Istanbul house got them at 09:00. Each case pairs a
 * sweep that must run with one that must not, so the pair fails on a UTC
 * server and on a US Eastern one alike without the house's zone.
 */

function makeScheduler(house: { timezone: string; country: string }) {
  const client = {
    from: (table: string) => {
      const builder: any = {};
      for (const m of ["select", "limit", "eq"]) builder[m] = () => builder;
      builder.upsert = async () => ({ data: null, error: null });
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({
          data: table === "restaurants" ? [{ id: "r1", ...house }] : [],
          error: null,
        }).then(resolve, reject);
      return builder;
    },
  };
  const generated: string[] = [];
  const generator: any = {
    generate: async (rid: string) => {
      generated.push(rid);
      return { insights: [] };
    },
    staleVersionCategories: async () => new Map(),
  };
  const svc = new InsightSchedulerService(
    { getClient: () => client } as any,
    generator,
  );
  return { svc, generated };
}

describe("the insight sweep runs at 06:00 on the house's clock", () => {
  afterEach(() => jest.useRealTimers());

  it("an LA house refreshes at 06:00 Los Angeles, not 23:00 the evening before", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    const la = { timezone: "America/Los_Angeles", country: "US" };

    const evening = makeScheduler(la);
    const at2300 = new Date("2026-10-09T06:00:00Z"); // Thu 23:00 PDT
    jest.setSystemTime(at2300);
    await evening.svc.runSweep(at2300);
    expect(evening.generated).toEqual([]);

    const morning = makeScheduler(la);
    const at0600 = new Date("2026-10-09T13:00:00Z"); // Fri 06:00 PDT
    jest.setSystemTime(at0600);
    await morning.svc.runSweep(at0600);
    expect(morning.generated).toEqual(["r1"]);
  });

  it("an Istanbul house refreshes at 06:00 Istanbul, not 09:00", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    const ist = { timezone: "Europe/Istanbul", country: "TR" };

    const dawn = makeScheduler(ist);
    const at0600 = new Date("2026-10-09T03:00:00Z"); // Fri 06:00 Istanbul
    jest.setSystemTime(at0600);
    await dawn.svc.runSweep(at0600);
    expect(dawn.generated).toEqual(["r1"]);

    const late = makeScheduler(ist);
    const at0900 = new Date("2026-10-09T06:00:00Z"); // Fri 09:00 Istanbul
    jest.setSystemTime(at0900);
    await late.svc.runSweep(at0900);
    expect(late.generated).toEqual([]);
  });
});
