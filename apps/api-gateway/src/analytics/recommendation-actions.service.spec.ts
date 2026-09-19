import { RecommendationActionsService } from "./recommendation-actions.service";

/**
 * `getDigestPref`'s `set` field is the one honesty guarantee the UI has for
 * "this house never touched the digest": DigestPost.tsx:63/218/371 all read
 * it to decide between "Not yet set for this house" and showing the actual
 * values. Nothing pinned that contract before this — see r4-lanes.json
 * (key=recs) must_fix #4.
 *
 * `getDigestPref` was un-exercised: no row and a real row both fell through
 * to the SAME defaulted shape unless `set` is asserted separately from the
 * other fields, which is exactly the bug this guards (mutation-tested below:
 * forcing `set: true` unconditionally fails the "no row" case).
 */

interface FakeRow {
  digest_enabled?: boolean;
  digest_hour?: number;
  digest_min_urgency?: string;
  recipient_email?: string | null;
  last_sent_at?: string | null;
}

/** A `DatabaseService` stand-in exposing only what `getDigestPref` calls:
 * `.from(...).select(...).eq(...).maybeSingle()`. */
function fakeDb(row: FakeRow | null) {
  const builder: any = {};
  for (const m of ["select", "eq"]) builder[m] = () => builder;
  builder.maybeSingle = async () => ({ data: row, error: null });
  return { getClient: () => ({ from: (_table: string) => builder }) } as any;
}

describe("RecommendationActionsService.getDigestPref", () => {
  it("with no row: set is false, and the defaults are not reported as a choice", async () => {
    const svc = new RecommendationActionsService(fakeDb(null));
    const pref = await svc.getDigestPref("r-1");
    expect(pref.set).toBe(false);
    // The defaults themselves still come back (the UI needs SOME value to
    // show while disabled), but `set: false` is what tells the caller not to
    // read them as "the house chose 7am".
    expect(pref.digestEnabled).toBe(false);
    expect(pref.digestHour).toBe(7);
    expect(pref.digestMinUrgency).toBe("this_week");
    expect(pref.recipientEmail).toBeNull();
    expect(pref.lastSentAt).toBeNull();
  });

  it("with a row: set is true, and the row's own values come back", async () => {
    const svc = new RecommendationActionsService(
      fakeDb({
        digest_enabled: true,
        digest_hour: 9,
        digest_min_urgency: "now",
        recipient_email: "owner@example.com",
        last_sent_at: "2026-09-18T09:00:00.000Z",
      }),
    );
    const pref = await svc.getDigestPref("r-1");
    expect(pref.set).toBe(true);
    expect(pref.digestEnabled).toBe(true);
    expect(pref.digestHour).toBe(9);
    expect(pref.digestMinUrgency).toBe("now");
    expect(pref.recipientEmail).toBe("owner@example.com");
    expect(pref.lastSentAt).toBe("2026-09-18T09:00:00.000Z");
  });

  it("with a row that has every optional column null: set is STILL true", async () => {
    // A house can have a row that only ever set `digest_enabled=false` and
    // touched nothing else — `set` reads row EXISTENCE, not whether any
    // field happens to differ from the default.
    const svc = new RecommendationActionsService(
      fakeDb({ digest_enabled: false }),
    );
    const pref = await svc.getDigestPref("r-1");
    expect(pref.set).toBe(true);
    expect(pref.digestEnabled).toBe(false);
  });
});
