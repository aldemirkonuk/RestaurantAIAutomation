import fs from "fs";
import path from "path";
import {
  FEED_ZERO_START,
  feedZeroStep,
  resolvePulseStripView,
  type FeedZeroWatch,
} from "@/components/today/pulseStripView";
import {
  alertCardRoute,
  holdUnsavedCount,
  openNotificationTap,
  releaseUnsavedCount,
  unsavedCount,
} from "@/lib/notificationRoute";
import { openInvitedHouse } from "@/auth/inviteCode";
import { quietTeamWords } from "@/components/team/teamEvents";
import type { TodayPulse } from "@/api/types";

/**
 * The owner's and new staff member's phone (sim 47, S199): Today, a change of
 * house, a push from another house, an accepted invite, the quiet Team tab.
 */

const MOBILE = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(MOBILE, rel), "utf8");

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function run(
  steps: Array<{ house: string | null; count: number; settled: boolean }>,
): boolean[] {
  let watch: FeedZeroWatch = FEED_ZERO_START;
  return steps.map((now) => {
    const step = feedZeroStep(watch, now);
    watch = step.watch;
    return step.show;
  });
}

describe("Feed Zero plays only when a loaded feed empties (F-1449)", () => {
  it("plays when the last card leaves a loaded feed", () => {
    expect(
      run([
        { house: A, count: 2, settled: true },
        { house: A, count: 1, settled: true },
        { house: A, count: 0, settled: true },
      ]),
    ).toEqual([false, false, true]);
  });

  it("does not play over the empty list a change of house leaves behind", () => {
    // The reads are cleared before the session names the new house, then
    // the new house loads empty.
    expect(
      run([
        { house: A, count: 3, settled: true },
        { house: A, count: 0, settled: false },
        { house: B, count: 0, settled: false },
        { house: B, count: 0, settled: true },
      ]),
    ).toEqual([false, false, false, false]);
  });

  it("does not play when the new house's feed arrives empty in the same step", () => {
    expect(
      run([
        { house: A, count: 3, settled: true },
        { house: B, count: 0, settled: true },
      ]),
    ).toEqual([false, false]);
  });

  it("starts over in the new house, once", () => {
    expect(
      run([
        { house: A, count: 1, settled: true },
        { house: A, count: 0, settled: true },
        { house: B, count: 1, settled: true },
        { house: B, count: 0, settled: true },
        { house: B, count: 1, settled: true },
        { house: B, count: 0, settled: true },
      ]),
    ).toEqual([false, true, false, true, false, false]);
  });

  it("the Today screen asks the rule, with the house and whether the feed loaded", () => {
    const screen = read("app/(tabs)/index.tsx");
    expect(screen).toContain("feedZeroStep(");
    expect(screen).toContain("house: user?.restaurantId");
    expect(screen).not.toMatch(/prevCount\.current > 0 && items\.length === 0/);
  });
});

function pulse(overrides: Partial<TodayPulse>): TodayPulse {
  return {
    revenueToday: 1200,
    checksToday: 30,
    revenueLastWeek: null,
    deltaPct: null,
    pendingDecisions: 0,
    criticalCount: 0,
    windowStart: null,
    windowEnd: "2026-10-11T23:59:59.999Z",
    generatedAt: "2026-10-11T12:00:00.000Z",
    ...overrides,
  };
}

describe("the decisions line says when more wait than Today reads (F-1450)", () => {
  it("says 'maybe more' after the count", () => {
    const view = resolvePulseStripView(
      pulse({ pendingDecisions: 3, decisionsMore: true }),
    );
    expect(view.decisionsLabel).toBe("3 decisions waiting, maybe more in your notices");
  });

  it("never says All clear over notices it did not read", () => {
    const view = resolvePulseStripView(
      pulse({ pendingDecisions: 0, decisionsMore: true }),
    );
    expect(view.decisionsLabel).not.toBe("All clear");
    expect(view.decisionsLabel).toMatch(/notices/);
  });

  it("keeps the plain count when every notice was read", () => {
    expect(resolvePulseStripView(pulse({ pendingDecisions: 2 })).decisionsLabel).toBe(
      "2 decisions waiting",
    );
  });
});

describe("an alert card opens its place, as the inbox does (F-1451)", () => {
  it("opens the notice's link", () => {
    expect(alertCardRoute({ actionUrl: "/inventory?highlight=w-7" })).toBe("/cellar/w-7");
    expect(alertCardRoute({ actionUrl: "/team?shift=s-1" })).toBe("/team");
  });

  it("opens its order when it names one", () => {
    expect(alertCardRoute({ orderId: "o-1", actionUrl: "/team" })).toBe("/supply/o-1");
  });

  it("stays put for a web-only place, like the inbox", () => {
    expect(alertCardRoute({ actionUrl: "/promotions" })).toBeNull();
    expect(alertCardRoute({})).toBeNull();
  });

  it("the card routes an alert through it", () => {
    const card = read("src/components/today/DecisionCard.tsx");
    expect(card).toMatch(/item\.kind === "alert"[\s\S]{0,200}alertCardRoute\(item\)/);
  });
});

describe("a push from another house asks before leaving a count (F-1452)", () => {
  afterEach(() => holdUnsavedCount(null));

  const deps = (over: Partial<Parameters<typeof openNotificationTap>[1]> = {}) => ({
    currentHouse: A,
    chooseHouse: jest.fn().mockResolvedValue(true),
    navigate: jest.fn(),
    refused: jest.fn(),
    unsavedCount,
    confirmLeaveCount: jest.fn().mockResolvedValue(false),
    ...over,
  });

  it("opens nothing and stays in the house when the person keeps counting", async () => {
    holdUnsavedCount("o-1");
    const d = deps();
    await openNotificationTap({ restaurantId: B, orderId: "o-9" }, d);
    expect(d.confirmLeaveCount).toHaveBeenCalled();
    expect(d.chooseHouse).not.toHaveBeenCalled();
    expect(d.navigate).not.toHaveBeenCalled();
  });

  it("moves and opens when the person agrees to leave the count", async () => {
    holdUnsavedCount("o-1");
    const d = deps({ confirmLeaveCount: jest.fn().mockResolvedValue(true) });
    await openNotificationTap({ restaurantId: B, orderId: "o-9" }, d);
    expect(d.chooseHouse).toHaveBeenCalledWith(B);
    expect(d.navigate).toHaveBeenCalledWith("/supply/o-9");
  });

  it("does not ask with no count open, or for a push of this house", async () => {
    const d = deps();
    await openNotificationTap({ restaurantId: B, orderId: "o-9" }, d);
    expect(d.confirmLeaveCount).not.toHaveBeenCalled();
    holdUnsavedCount("o-1");
    const same = deps();
    await openNotificationTap({ restaurantId: A, orderId: "o-9" }, same);
    expect(same.confirmLeaveCount).not.toHaveBeenCalled();
    expect(same.navigate).toHaveBeenCalledWith("/supply/o-9");
  });

  it("a screen lets go only of its own hold", () => {
    holdUnsavedCount("o-2");
    releaseUnsavedCount("o-1");
    expect(unsavedCount()).toBe("o-2");
    releaseUnsavedCount("o-2");
    expect(unsavedCount()).toBeNull();
  });

  it("the receive screen holds its count and the push tap asks", () => {
    expect(read("app/(tabs)/cellar/receive/[orderId].tsx")).toContain(
      "holdUnsavedCount(orderId)",
    );
    const push = read("src/lib/push.ts");
    expect(push).toContain("unsavedCount,");
    expect(push).toContain("confirmLeaveCount:");
  });
});

describe("accepting an invite opens the house joined (F-1455)", () => {
  it("switches to the house the invite named, as the web does", async () => {
    const chooseHouse = jest.fn().mockResolvedValue(true);
    await expect(openInvitedHouse(B, { currentHouse: A, chooseHouse })).resolves.toBe(true);
    expect(chooseHouse).toHaveBeenCalledWith(B);
  });

  it("stays put when already there, or when the reply names no house", async () => {
    const chooseHouse = jest.fn().mockResolvedValue(true);
    await expect(openInvitedHouse(A, { currentHouse: A, chooseHouse })).resolves.toBe(true);
    await expect(openInvitedHouse(undefined, { currentHouse: A, chooseHouse })).resolves.toBe(
      true,
    );
    expect(chooseHouse).not.toHaveBeenCalled();
  });

  it("reports a refused or failed switch, never as done", async () => {
    await expect(
      openInvitedHouse(B, { currentHouse: A, chooseHouse: jest.fn().mockResolvedValue(false) }),
    ).resolves.toBe(false);
    await expect(
      openInvitedHouse(B, {
        currentHouse: A,
        chooseHouse: jest.fn().mockRejectedValue(new Error("offline")),
      }),
    ).resolves.toBe(false);
  });

  it("the invite screen switches with the accept's restaurantId", () => {
    expect(read("app/invite/[code].tsx")).toMatch(
      /openInvitedHouse\(result\?\.restaurantId/,
    );
  });
});

describe("the quiet Team tab speaks to the person's role (F-1456)", () => {
  it("does not send staff to the web dashboard", () => {
    expect(quietTeamWords(false)).not.toMatch(/web dashboard/i);
    expect(quietTeamWords(false)).toMatch(/your manager publishes the week/);
  });

  it("still tells someone who plans the rota where to plan it", () => {
    expect(quietTeamWords(true)).toMatch(/web dashboard/);
  });

  it("the tab draws its words from the role", () => {
    const tab = read("app/(tabs)/team.tsx");
    expect(tab).toContain("quietTeamWords(fullRota)");
    expect(tab).not.toContain(
      'message="Schedule shifts and events from the web dashboard',
    );
  });
});
