/**
 * F-257 — a read that is not a sighting must not log one.
 *
 * `GET /analytics/recommendations/:rid` inserted a `recommendation_impressions`
 * row per card on every read, so the command palette (which shows one card)
 * and the page's re-read after every act each logged the whole feed as shown,
 * and "how long has this stood" dated from a palette open. The service already
 * honoured `recordImpressions: false`; the controller never passed it.
 */
import { AnalyticsController } from "./analytics.controller";

const getRecommendations = (
  AnalyticsController.prototype as unknown as Record<string, any>
).getRecommendations;

function call(recordImpressions?: string) {
  const seen: Array<Record<string, unknown>> = [];
  const self = {
    recommendationsService: {
      getRecommendations: async (
        _rid: string,
        opts: Record<string, unknown>,
      ) => {
        seen.push(opts);
        return { recommendations: [] };
      },
    },
  };
  return getRecommendations
    .call(self, "rest-1", undefined, { userId: "u-1" }, recordImpressions)
    .then(() => seen[0]);
}

describe("GET recommendations — impressions", () => {
  it("logs the feed as shown on a plain read, as before", async () => {
    expect((await call(undefined)).recordImpressions).toBe(true);
  });

  it("does not log it when the caller says the read is only a glance", async () => {
    expect((await call("false")).recordImpressions).toBe(false);
  });
});
