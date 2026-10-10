import {
  DECISIONS_UNREAD_LABEL,
  REVENUE_UNAVAILABLE_MESSAGE,
  REVENUE_UNAVAILABLE_MESSAGES,
  readState,
  resolvePulseStripView,
} from "@/components/today/pulseStripView";
import type { TodayPulse } from "@/api/types";

function pulse(overrides: Partial<TodayPulse>): TodayPulse {
  return {
    revenueToday: null,
    checksToday: null,
    revenueLastWeek: null,
    deltaPct: null,
    pendingDecisions: 0,
    criticalCount: 0,
    windowStart: null,
    windowEnd: "2026-09-01T23:59:59.999Z",
    generatedAt: "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("resolvePulseStripView", () => {
  /**
   * The defect this guards: `PulseStrip.tsx` used to fall through to
   * `pendingDecisions === 0 ? "All clear" : ...` whenever `revenueToday`
   * was null — collapsing "we don't have tonight's revenue" into a
   * reassuring "All clear". ADR 0020 names this exact shape ("a green
   * 'All clear' badge over a failed request") as a fabrication. This test
   * fails against the pre-fix branching and passes against the resolver.
   */
  it("does not claim All clear when revenue is unavailable, even with zero pending decisions", () => {
    const view = resolvePulseStripView(pulse({ revenueToday: null, pendingDecisions: 0 }));

    expect(view.decisionsLabel).not.toBe("All clear");
    expect(view.decisionsLabel).toBeNull();
    expect(view.revenue.status).toBe("unavailable");
    expect(view.revenue.status === "unavailable" && view.revenue.message).toBe(
      REVENUE_UNAVAILABLE_MESSAGE,
    );
  });

  it("still reports pending decisions honestly when revenue is unavailable", () => {
    const view = resolvePulseStripView(pulse({ revenueToday: null, pendingDecisions: 3 }));

    expect(view.revenue.status).toBe("unavailable");
    expect(view.decisionsLabel).toBe("3 decisions waiting");
  });

  /**
   * The legitimate case: revenue IS known and pending decisions are
   * genuinely zero. "All clear" is an honest claim here and must keep
   * rendering — this is the regression guard for requirement 3.
   */
  it("renders All clear when revenue is known and pending decisions are genuinely zero", () => {
    const view = resolvePulseStripView(
      pulse({ revenueToday: 4210, checksToday: 62, deltaPct: 8, pendingDecisions: 0 }),
    );

    expect(view.revenue.status).toBe("known");
    expect(view.revenue.status === "known" && view.revenue.amount).toBe(4210);
    expect(view.decisionsLabel).toBe("All clear");
  });

  /**
   * F-542: the gateway sends `pendingDecisions: null` when the decision feed
   * could not be read. That used to arrive as 0 and render "All clear" next to
   * a known revenue figure, with orders waiting for approval.
   */
  it("does not claim All clear when the decision feed could not be read", () => {
    const view = resolvePulseStripView(pulse({ revenueToday: 4210, pendingDecisions: null }));

    expect(view.decisionsLabel).not.toBe("All clear");
    expect(view.decisionsLabel).toBe(DECISIONS_UNREAD_LABEL);
  });

  it("says the feed is unread even when revenue is also unavailable", () => {
    const view = resolvePulseStripView(pulse({ revenueToday: null, pendingDecisions: null }));

    expect(view.decisionsLabel).toBe(DECISIONS_UNREAD_LABEL);
  });

  it("reports singular decision phrasing for exactly one pending decision", () => {
    const view = resolvePulseStripView(pulse({ revenueToday: 100, pendingDecisions: 1 }));

    expect(view.decisionsLabel).toBe("1 decision waiting");
  });

  it("reports plural decision phrasing for more than one pending decision", () => {
    const view = resolvePulseStripView(pulse({ revenueToday: 100, pendingDecisions: 5 }));

    expect(view.decisionsLabel).toBe("5 decisions waiting");
  });

  it("falls back to a generic checks label when checksToday is unavailable but revenue is known", () => {
    const view = resolvePulseStripView(pulse({ revenueToday: 100, checksToday: null }));

    expect(view.revenue.status === "known" && view.revenue.checksLabel).toBe("sales so far");
  });

  /**
   * F-674: a failed read said "Connect Toast" to a house whose register
   * already feeds it. The message now follows the gateway's `salesState`.
   */
  it("never asks a house to connect a register when the read only failed", () => {
    const unread = resolvePulseStripView(pulse({ salesState: "unread" }));
    const none = resolvePulseStripView(pulse({ salesState: "no_register" }));
    const noZone = resolvePulseStripView(pulse({ salesState: "zone_unset" }));

    expect(unread.revenue.status === "unavailable" && unread.revenue.message).toBe(
      REVENUE_UNAVAILABLE_MESSAGES.unread,
    );
    expect(none.revenue.status === "unavailable" && none.revenue.message).toBe(
      REVENUE_UNAVAILABLE_MESSAGES.no_register,
    );
    expect(noZone.revenue.status === "unavailable" && noZone.revenue.message).toBe(
      REVENUE_UNAVAILABLE_MESSAGES.zone_unset,
    );
    for (const v of [unread, none, noZone]) {
      expect(v.revenue.status === "unavailable" && v.revenue.message).not.toMatch(/Toast/);
    }
  });

  it("says one check, not one checks", () => {
    const view = resolvePulseStripView(pulse({ revenueToday: 40, checksToday: 1 }));

    expect(view.revenue.status === "known" && view.revenue.checksLabel).toBe("1 check");
  });
});

/**
 * F-676: saved figures come back at boot. When the refresh fails, the strip
 * showed last night's "$4,210 · +12%" as "Tonight", with no time and no
 * error.
 */
describe("resolvePulseStripView freshness (F-676)", () => {
  const formatTime = (at: Date) => at.toISOString().slice(11, 16);
  const formatWeekday = () => "Thursday";
  const opened = Date.parse("2026-10-08T04:00:00.000Z");

  it("names tonight and when the figures are from when they are current", () => {
    const view = resolvePulseStripView(
      pulse({ revenueToday: 4210, windowStart: "2026-10-08T04:00:00.000Z" }),
      {
        now: opened + 15 * 3_600_000,
        fetchedAt: opened + 14 * 3_600_000,
        formatTime,
        formatWeekday,
      },
    );

    expect(view.heading).toBe("Tonight");
    expect(view.freshness).toBe("As of 18:00");
    expect(view.stale).toBe(false);
    expect(view.decisionsLabel).toBe("All clear");
  });

  it("does not present an earlier night's figures as tonight", () => {
    const view = resolvePulseStripView(
      pulse({ revenueToday: 4210, deltaPct: 12, windowStart: "2026-10-08T04:00:00.000Z" }),
      {
        now: opened + 33 * 3_600_000,
        fetchedAt: opened + 23 * 3_600_000,
        formatTime,
        formatWeekday,
      },
    );

    expect(view.heading).toBe("Thursday night");
    expect(view.stale).toBe(true);
    expect(view.decisionsLabel).not.toBe("All clear");
  });

  it("says the refresh failed, and from when the shown figures are", () => {
    const view = resolvePulseStripView(
      pulse({ revenueToday: 4210, windowStart: "2026-10-08T04:00:00.000Z" }),
      {
        now: opened + 15 * 3_600_000,
        fetchedAt: opened + 14 * 3_600_000,
        refreshFailed: true,
        formatTime,
        formatWeekday,
      },
    );

    expect(view.freshness).toBe("Couldn't refresh · as of 18:00");
    expect(view.stale).toBe(true);
    expect(view.decisionsLabel).toBeNull();
  });
});

/**
 * F-1074: the pulse names the house's zone, but "as of" and "<Weekday> night"
 * were read on the phone's clock. A Detroit phone looking at an Istanbul house
 * said "as of 12:30pm" for 19:30 there, and named Thursday for Friday's night.
 */
describe("resolvePulseStripView reads the house's clock (F-1074)", () => {
  const phoneZone = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/Detroit";
  });
  afterAll(() => {
    process.env.TZ = phoneZone;
  });

  it("says when the figures are from on the house's clock, not the phone's", () => {
    const view = resolvePulseStripView(
      pulse({ revenueToday: 4210, locale: "en-US", timezone: "Europe/Istanbul" }),
      {
        now: Date.parse("2026-10-09T16:40:00.000Z"),
        fetchedAt: Date.parse("2026-10-09T16:30:00.000Z"),
      },
    );
    expect(view.freshness).toBe("As of 7:30pm");
  });

  it("names an earlier night by the house's weekday", () => {
    // Opened 18:30 Thu in Istanbul; its middle is 06:30 Fri there, 23:30 Thu in Detroit.
    const view = resolvePulseStripView(
      pulse({
        revenueToday: 4210,
        locale: "en-US",
        timezone: "Europe/Istanbul",
        windowStart: "2026-10-08T15:30:00.000Z",
      }),
      { now: Date.parse("2026-10-10T10:00:00.000Z") },
    );
    expect(view.heading).toBe("Friday night");
  });
});

/**
 * F-677: a failed Insights read rendered as "nothing yet" or zero. A read
 * that failed with nothing saved is `failed`, never an empty `ready`.
 */
describe("readState", () => {
  it("is failed, not empty, when the read failed with nothing to show", () => {
    expect(readState({ isLoading: false, isError: true, data: undefined })).toBe("failed");
  });

  it("is loading while the first read is in flight", () => {
    expect(readState({ isLoading: true, isError: false, data: undefined })).toBe("loading");
  });

  it("is ready for a real empty answer", () => {
    expect(readState({ isLoading: false, isError: false, data: [] })).toBe("ready");
  });

  it("keeps saved data on screen when only a refresh failed", () => {
    expect(readState({ isLoading: false, isError: true, data: [1] })).toBe("ready");
  });
});
