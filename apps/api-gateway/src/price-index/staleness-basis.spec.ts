/**
 * The staleness gate when the date on the row is OURS.
 *
 * ADR 0117 Q27, answered by the founder 2026-09-05: a merchant shop states no
 * publication date, so its row is filed under the day we read it and labelled
 * `issued_at_basis = 'fetch_date'`. `refuseStale` therefore has two clocks to
 * read, and the whole point of the label is that it never confuses them.
 *
 * Its own file rather than an addition to `staleness.spec.ts`: that spec is
 * another builder's and this worktree is shared.
 *
 * PROVED AGAINST THE PRE-FIX CODE, 2026-09-05. A verbatim `git show HEAD:` copy
 * of `staleness.ts` was written to a same-depth probe
 * (`__prefix_probe_staleness.ts`), imported beside the fixed one, run, and both
 * files deleted. HEAD's `refuseStale` took three arguments and ignored the
 * fourth entirely, so a fetch-dated row was aged against its own `issued_at`:
 *
 *   row issued_at = today (our read date), last actually read 35 days ago,
 *   cadence 7 days
 *     PRE  {"stale":false,"ageDays":0,"reason":null}          <- certified fresh
 *     POST {"stale":true,"ageDays":35,"reason":"nobody published a date for
 *           this price and we last read it 35 days ago, past the 7-day cadence
 *           this source is allowed (a read is not a publication)"}
 *
 * That is the vacuous gate the basis exists to prevent, measured rather than
 * argued: without it every shop row is fresh on the day it is written and can
 * never become anything else.
 */

import { refuseStale, stalenessDays } from "./staleness";

const TODAY = new Date("2026-09-05T12:00:00Z");

describe("refuseStale with an issuer-stated date (unchanged)", () => {
  it("admits a fresh edition and refuses a stale one", () => {
    expect(refuseStale("2026-09-01", 62, TODAY)).toEqual({
      stale: false,
      ageDays: 4,
      reason: null,
    });
    const stale = refuseStale("2024-01-03", 62, TODAY);
    expect(stale.stale).toBe(true);
    expect(stale.ageDays).toBe(976);
    expect(stale.reason).toContain("a 200 OK is not freshness");
  });

  it("refuses an undated run, and passing basis 'issuer_stated' changes nothing", () => {
    for (const opts of [undefined, { basis: "issuer_stated" as const }]) {
      const v = refuseStale(null, 62, TODAY, opts);
      expect(v.stale).toBe(true);
      expect(v.ageDays).toBeNull();
      expect(v.reason).toContain("an undated posting is not a sighting");
    }
  });
});

describe("refuseStale with a fetch-dated row", () => {
  it("ages it from the READ, not from the edition it never had", () => {
    // Read today: fresh.
    expect(
      refuseStale("2026-09-05", 7, TODAY, {
        basis: "fetch_date",
        readAt: "2026-09-05",
      }),
    ).toEqual({ stale: false, ageDays: 0, reason: null });

    // Read nine days ago against a seven-day cadence: refused, and the reason
    // says WHY in the shop's terms, not a publisher's.
    const old = refuseStale("2026-08-27", 7, TODAY, {
      basis: "fetch_date",
      readAt: "2026-08-27",
    });
    expect(old.stale).toBe(true);
    expect(old.ageDays).toBe(9);
    expect(old.reason).toContain("nobody published a date");
    expect(old.reason).toContain("we last read it 9 days ago");
    expect(old.reason).toContain("a read is not a publication");
  });

  it("does not go stale on the calendar while it is being re-read", () => {
    // THE FAULT THE BASIS EXISTS TO AVOID, stated as a test. A row whose
    // `issued_at` is our own read date and that is aged as if it were an
    // EDITION date is fresh by construction on the day it is written and can
    // never be anything else, so the gate would certify every shop row forever.
    // With the basis, the two clocks are separable: the same row, re-read
    // today, is fresh; left unread for ten days it is refused.
    const rewritten = refuseStale("2026-08-27", 7, TODAY, {
      basis: "fetch_date",
      readAt: "2026-09-05",
    });
    expect(rewritten.stale).toBe(false);
    expect(rewritten.ageDays).toBe(0);
  });

  it("refuses rather than guessing when the read date is unreadable too", () => {
    const v = refuseStale(null, 7, TODAY, { basis: "fetch_date", readAt: null });
    expect(v.stale).toBe(true);
    expect(v.ageDays).toBeNull();
    expect(v.reason).toContain("nothing about its age can be stated");
  });

  it("falls back to issuedAt as the read date, since they are the same at write", () => {
    expect(
      refuseStale("2026-09-05", 7, TODAY, { basis: "fetch_date" }),
    ).toEqual({ stale: false, ageDays: 0, reason: null });
    expect(stalenessDays("2026-09-05", TODAY)).toBe(0);
  });
});
