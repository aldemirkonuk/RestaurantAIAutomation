import { PriceIndexController } from "./price-index.controller";
import { PriceIndexService } from "./price-index.service";
import { PriceIndexFetchService } from "./price-index-fetch.service";

/**
 * The controller is a thin adapter. These tests check the two things it decides:
 *   1. it hands the RAW :state through to the service (which owns normalisation),
 *      so scoping cannot be silently dropped between route and query;
 *   2. status overlays this process's last-run outcome onto the stored status,
 *      so a stale-refused run is visible before it has written a row.
 */
describe("PriceIndexController", () => {
  const USER = { restaurantId: "r-1" };

  it("passes the state param and query filters straight to the service", async () => {
    const forState = jest
      .fn()
      .mockResolvedValue({ requested: "CA", state: "US-CA", lines: [], sources: [], silence: null });
    const controller = new PriceIndexController(
      { forState } as unknown as PriceIndexService,
      {} as unknown as PriceIndexFetchService,
    );
    const res = await controller.forState(USER, "CA", "coopers", "Retailers", "10");
    expect(forState).toHaveBeenCalledWith("CA", "coopers", "Retailers", 10);
    expect(res.success).toBe(true);
    expect(res.state).toBe("US-CA");
  });

  it("ignores a non-numeric limit rather than passing NaN", async () => {
    const forState = jest
      .fn()
      .mockResolvedValue({ requested: "CA", state: "US-CA", lines: [], sources: [], silence: null });
    const controller = new PriceIndexController(
      { forState } as unknown as PriceIndexService,
      {} as unknown as PriceIndexFetchService,
    );
    await controller.forState(USER, "CA", undefined, undefined, "abc");
    expect(forState).toHaveBeenCalledWith("CA", undefined, undefined, undefined);
  });

  it("routes 'me' to forHouse with the caller's restaurant", async () => {
    const forHouse = jest
      .fn()
      .mockResolvedValue({ requested: "me", state: "US-CA", lines: [], sources: [], silence: null });
    const controller = new PriceIndexController(
      { forHouse } as unknown as PriceIndexService,
      {} as unknown as PriceIndexFetchService,
    );
    const res = await controller.forState(USER, "me");
    expect(forHouse).toHaveBeenCalledWith("r-1");
    expect(res.state).toBe("US-CA");
  });

  it("merges the in-memory last run into the status per source", async () => {
    const status = jest.fn().mockResolvedValue({
      armed: false,
      flag: "PRICE_INDEX_FETCH_ENABLED",
      sources: [
        { key: "california-abc-beer-price-posting", rows: 0, silentBecause: "fetch disabled" },
      ],
    });
    const lastRunFor = jest.fn().mockReturnValue({
      sourceKey: "california-abc-beer-price-posting",
      silentBecause: "REFUSED (stale): the newest posting is 999 days old",
    });
    const controller = new PriceIndexController(
      { status } as unknown as PriceIndexService,
      { lastRunFor } as unknown as PriceIndexFetchService,
    );
    const res = await controller.status();
    expect(res.sources[0].lastRun?.silentBecause).toContain("REFUSED (stale)");
  });
});
