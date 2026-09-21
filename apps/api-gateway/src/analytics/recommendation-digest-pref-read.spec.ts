/**
 * `getDigestPref` used to answer a failed read with the defaults — "digest off,
 * 07:00" — which was harmless while nothing sent the digest. The digest sender
 * (ADR 0149 row 26) reads the same row, so a preference that could not be read
 * is now an error, never a quiet "off".
 */

import { RecommendationActionsService } from "./recommendation-actions.service";
import { FakeDb } from "./digest/testing/digest-fake-db";

function build() {
  const db = new FakeDb();
  const service = new RecommendationActionsService({
    getClient: () => db,
    supabase: db,
  } as any);
  return { db, service };
}

describe("RecommendationActionsService.getDigestPref", () => {
  it("a failed read throws — it is not reported as a digest that is off", async () => {
    const { db, service } = build();
    db.failures["recommendation_digest_prefs"] = "permission denied";
    await expect(service.getDigestPref("house-1")).rejects.toThrow(
      /recommendation_digest_prefs could not be read: permission denied/,
    );
  });

  it("a house with no row still reads as off at 07:00 — absence is not a failure", async () => {
    const { service } = build();
    await expect(service.getDigestPref("house-1")).resolves.toEqual({
      digestEnabled: false,
      digestHour: 7,
      digestMinUrgency: "this_week",
      recipientEmail: null,
      lastSentAt: null,
    });
  });

  it("reads the stored row", async () => {
    const { db, service } = build();
    db.tables.recommendation_digest_prefs = [
      {
        restaurant_id: "house-1",
        digest_enabled: true,
        digest_hour: 18,
        digest_min_urgency: "now",
        recipient_email: null,
        last_sent_at: "2026-09-17T15:00:00Z",
      },
    ];
    await expect(service.getDigestPref("house-1")).resolves.toMatchObject({
      digestEnabled: true,
      digestHour: 18,
      digestMinUrgency: "now",
      lastSentAt: "2026-09-17T15:00:00Z",
    });
  });
});
