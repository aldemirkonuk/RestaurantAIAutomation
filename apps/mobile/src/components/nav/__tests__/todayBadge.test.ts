import type { FeedResponse } from "@/api/types";
import { todayBadgeCount } from "../todayBadge";

function feed(counts: Partial<FeedResponse["counts"]>): FeedResponse {
  return {
    items: [],
    counts: {
      total: 0,
      orderApprovals: 0,
      draftApprovals: 0,
      receiptVerifications: 0,
      alerts: 0,
      ...counts,
    },
    generatedAt: "2026-10-12T18:00:00Z",
  };
}

describe("the Today tab badge counts what the strip counts (F-1499)", () => {
  it("shows no number when only alerts wait, as the strip says All clear", () => {
    expect(todayBadgeCount(feed({ total: 3, alerts: 3, decisions: 0 }))).toBe(0);
  });

  it("counts the decisions, not the alerts beside them", () => {
    expect(
      todayBadgeCount(feed({ total: 5, alerts: 3, orderApprovals: 2, decisions: 2 })),
    ).toBe(2);
  });

  it("sums the decision kinds when an older gateway sends no decisions count", () => {
    expect(
      todayBadgeCount(
        feed({ total: 6, alerts: 2, orderApprovals: 1, draftApprovals: 2, receiptVerifications: 1 }),
      ),
    ).toBe(4);
  });

  it("shows no number before the feed is read", () => {
    expect(todayBadgeCount(undefined)).toBe(0);
  });
});
