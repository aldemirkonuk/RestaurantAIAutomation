import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PeriodCompareBar } from "./molecules/PeriodCompareBar";
import { BusyHoursHeatmap } from "./molecules/BusyHoursHeatmap";
import { MonthlyReconciliation } from "./organisms/MonthlyReconciliation";

// framer-motion animates heights from 0; render statically so assertions see
// the final DOM rather than the first frame.
vi.mock("framer-motion", () => ({
  motion: new Proxy({} as any, {
    get: () => (props: any) => {
      const {
        children,
        initial: _i,
        animate: _a,
        transition: _t,
        exit: _e,
        ...rest
      } = props;
      return <div {...rest}>{children}</div>;
    },
  }),
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

/**
 * POS lens, absence-as-health 2, 3 and 4 (ADR 0020 — no fabricated figures).
 *
 * Three report widgets invented their numbers and rendered them beside real
 * ones, with nothing on screen marking the difference:
 *
 *   PeriodCompareBar      previous period = current × (0.75 + random × 0.45)
 *   BusyHoursHeatmap      a static weight table × random, never reading pos_checks
 *   MonthlyReconciliation purchased = 90 + i×8, variance = round((random − 0.5) × 8)
 *
 * A fabricated comparison is worse than no comparison: it produces a "↑ 12% vs
 * prev" an owner can act on. The rule these now follow is the one the honest
 * surfaces on this product already follow — say what is not available.
 */

const days = [
  { date: "Mon", value: 100 },
  { date: "Tue", value: 120 },
  { date: "Wed", value: 90 },
];

describe("PeriodCompareBar — a comparison needs a previous period", () => {
  it("says the previous period is not available instead of inventing one", () => {
    render(<PeriodCompareBar currentData={days} />);

    expect(
      screen.getByText(/previous period is not available/i),
    ).toBeInTheDocument();
    // The invented verdict is the dangerous part: an owner acts on "↑ 12%".
    expect(screen.queryByText(/vs prev/i)).not.toBeInTheDocument();
  });

  it("renders the comparison when real previous-period rows are supplied", () => {
    const previousData = [
      { date: "Mon", value: 50 },
      { date: "Tue", value: 60 },
      { date: "Wed", value: 45 },
    ];
    render(<PeriodCompareBar currentData={days} previousData={previousData} />);

    // 310 vs 155 — exactly double, so exactly +100%. A real number, checkable.
    expect(screen.getByText(/100% vs prev/)).toBeInTheDocument();
  });

  it("still draws this period when there is nothing to compare against", () => {
    const { container } = render(<PeriodCompareBar currentData={days} />);
    expect(container.querySelectorAll('[title^="Mon"]').length).toBeGreaterThan(
      0,
    );
  });
});

describe("BusyHoursHeatmap — an hour grid needs hours", () => {
  it("says it needs POS check times instead of drawing a weighted random grid", () => {
    render(<BusyHoursHeatmap totalOrders={44} />);

    expect(screen.getByText(/no check times/i)).toBeInTheDocument();
  });

  it("draws the grid when real hourly counts are supplied", () => {
    const grid = Array.from({ length: 7 }, (_, d) =>
      Array.from({ length: 24 }, (_, h) => (h === 19 ? d + 1 : 0)),
    );
    const { container } = render(
      <BusyHoursHeatmap totalOrders={44} grid={grid} />,
    );

    expect(screen.queryByText(/no check times/i)).not.toBeInTheDocument();
    expect(container.querySelectorAll('[title*="19:00"]').length).toBe(7);
  });
});

describe("MonthlyReconciliation — a variance needs two real numbers", () => {
  // The section is collapsed by default, so every assertion opens it first.
  const expand = async (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByText("Monthly Stock Reconciliation"));

  it("says the reconciliation is not available instead of sampling one", async () => {
    const user = userEvent.setup();
    render(
      <MonthlyReconciliation
        totalBottlesSold={34}
        totalInventoryValue={1000}
      />,
    );
    await expand(user);

    expect(
      screen.getByText(/not available|cannot be reconciled|no month/i),
    ).toBeInTheDocument();
    // The sampled variance is the dangerous part: a coin flip rendered with a
    // green tick whenever it happened to land under 3%.
    expect(
      screen.queryByText(/Variances >3% are flagged/i),
    ).not.toBeInTheDocument();
  });

  it("renders supplied months verbatim", async () => {
    const user = userEvent.setup();
    render(
      <MonthlyReconciliation
        totalBottlesSold={34}
        totalInventoryValue={1000}
        records={[
          {
            month: "August 2026",
            openingStock: 100,
            purchased: 40,
            sold: 30,
            theoretical: 110,
            actual: 108,
            variance: -2,
            variancePct: -1.8,
          },
        ]}
      />,
    );
    await expand(user);

    expect(screen.getByText("August 2026")).toBeInTheDocument();
    expect(screen.getByText(/-2 \(-1\.8%\)/)).toBeInTheDocument();
  });
});
