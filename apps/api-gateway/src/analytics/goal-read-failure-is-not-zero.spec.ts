import { GoalsService } from "./goals.service";

/**
 * A goal's reading that could not be taken is not a reading of nothing. The
 * metric read caught every failure it did not recognise, logged it and summed
 * nothing, so a broken query came back as 0 sales, 0 checks or 0 spend: a
 * ceiling goal read as met and a floor goal as missed, with no word that
 * anything failed. It now reaches the caller, which already says "could not be
 * read" per goal (`listGoalsWithProgress`) and refuses to write a reading
 * (`getGoalProgress`, `createGoal`).
 */

const HOUSE = "house-1";

function service(client: unknown) {
  return new GoalsService(
    { getClient: () => client } as any,
    { getStored: async () => [] } as any,
    { get: () => undefined } as any,
    {} as any,
    { record: () => {} } as any,
    {} as any,
  ) as any;
}

/** A client whose every table read throws something the reader does not know. */
const broken = {
  from: () => {
    throw new Error("connection reset by peer");
  },
};

describe("a metric read that fails is refused, never summed to 0", () => {
  it.each(["pos_revenue", "checks", "avg_check", "wine_revenue", "purchase_spend"])(
    "%s",
    async (metric) => {
      await expect(
        service(broken).computeMetricWithSeries(HOUSE, metric, "2026-01-01", "2026-09-30", "UTC", {
          withSales: true,
        }),
      ).rejects.toThrow("connection reset by peer");
    },
  );

  it("the goal's own reading refuses too, so no stored figure is written from it", async () => {
    await expect(
      service(broken).computeMetric(HOUSE, "pos_revenue", "2026-01-01", "UTC", { withSales: true }),
    ).rejects.toThrow("connection reset by peer");
  });
});
