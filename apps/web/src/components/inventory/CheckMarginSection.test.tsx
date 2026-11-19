import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckMarginSection } from "./CheckMarginSection";

const getRecentChecks = vi.hoisted(() => vi.fn());
const getCheckView = vi.hoisted(() => vi.fn());
vi.mock("../../services/api/posHub", () => ({ getRecentChecks, getCheckView }));

const check = { source: "toast", external_check_id: "chk-1", closed_at: "2026-11-18T20:00:00Z", total: 40, voided: false };
const view = (o: Record<string, unknown> = {}) => ({
  externalCheckId: "chk-1",
  lines: [
    { wine: "Barolo", volumeMl: 150, revenue: 18, cost: 6, costKept: true, costNote: null },
    { wine: "Old Rioja", volumeMl: 150, revenue: 14, cost: null, costKept: false, costNote: "cost not kept" },
  ],
  voidedLines: 0,
  revenue: 18,
  cost: 6,
  margin: 12,
  marginPct: 66.7,
  linesWithoutCost: 1,
  sentence: "Margin is known for 1 of 2 lines.",
  checkKnown: true,
  total: 40,
  voided: false,
  priceNotSentLines: 2,
  ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  getRecentChecks.mockResolvedValue([check]);
  getCheckView.mockResolvedValue(view());
});

describe("CheckMarginSection", () => {
  it("says the margin, cost not kept and price not sent for a picked check", async () => {
    const user = userEvent.setup();
    render(<CheckMarginSection restaurantId="r1" />);
    await user.selectOptions(await screen.findByLabelText("Closed check"), "chk-1");
    expect(await screen.findByText("Margin is known for 1 of 2 lines.")).toBeInTheDocument();
    expect(screen.getByText("Cost not kept: 1 line(s)")).toBeInTheDocument();
    expect(screen.getByText("Price not sent: 2 line(s)")).toBeInTheDocument();
    expect(screen.getAllByText("cost not kept").length).toBeGreaterThan(0);
    expect(getCheckView).toHaveBeenCalledWith("chk-1", "r1");
  });

  it("says when the till's lines were not found, not zero", async () => {
    const user = userEvent.setup();
    getCheckView.mockResolvedValue(view({ priceNotSentLines: null }));
    render(<CheckMarginSection restaurantId="r1" />);
    await user.selectOptions(await screen.findByLabelText("Closed check"), "chk-1");
    expect(await screen.findByText(/lines for this check were not found/)).toBeInTheDocument();
    expect(screen.queryByText(/Price not sent: 0/)).toBeNull();
  });

  it("says a failed check list failed, not that there are none", async () => {
    getRecentChecks.mockRejectedValue(new Error("down"));
    render(<CheckMarginSection restaurantId="r1" />);
    expect(await screen.findByText(/could not be read \(down\)/)).toBeInTheDocument();
    expect(screen.queryByText("No closed checks have arrived.")).toBeNull();
  });

  it("says a failed check read failed and shows no margin", async () => {
    const user = userEvent.setup();
    getCheckView.mockRejectedValue(new Error("gone"));
    render(<CheckMarginSection restaurantId="r1" />);
    await user.selectOptions(await screen.findByLabelText("Closed check"), "chk-1");
    expect(await screen.findByText(/so no margin is shown/)).toBeInTheDocument();
    expect(screen.queryByText(/Margin\b.*\d/)).toBeNull();
  });

  it("says when no closed check has arrived", async () => {
    getRecentChecks.mockResolvedValue([]);
    render(<CheckMarginSection restaurantId="r1" />);
    await waitFor(() => expect(screen.getByText("No closed checks have arrived.")).toBeInTheDocument());
  });
});
