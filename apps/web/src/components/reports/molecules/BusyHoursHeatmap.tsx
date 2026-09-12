/**
 * BusyHoursHeatmap — hourly-traffic heatmap (7 days × 24 hours).
 *
 * It used to draw a SYNTHETIC distribution when no POS data was available: a
 * static peak-weight table multiplied by `Math.random()`, scaled by an order
 * count, and rendered in the product's own palette with per-cell tooltips
 * reading "~7 orders" (POS lens, absence-as-health 3). Nothing on screen said
 * it was invented, and it never read `pos_checks` — which held 44 real checks
 * at the moment it was measured.
 *
 * A heatmap of nothing is not a heatmap. `grid` is now a prop: given real
 * hourly counts it draws them, given none it says what it is missing. ADR 0020.
 *
 * The real source exists and is not wired here: `pos_checks.closed_at` bucketed
 * by local weekday and hour. That needs an endpoint and a timezone decision
 * (the venue's, not the viewer's — see lib/venueTime.ts), which is a bigger
 * job than removing the fabrication and should not hold it up.
 */

import { useMemo } from "react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function cellColor(value: number, max: number): string {
  if (max === 0 || value === 0) return "#f9fafb";
  const t = value / max;
  if (t < 0.2) return "#F1F7F8";
  if (t < 0.4) return "#E0EFF1";
  if (t < 0.6) return "#BEDDE2";
  if (t < 0.75) return "#8FC4CD";
  if (t < 0.9) return "#5FB0BC";
  return "#1A5E6B";
}

interface Props {
  totalOrders: number;
  /**
   * Real counts, [weekday 0=Mon][hour 0-23]. Omit when they have not been
   * read: the component then says so rather than drawing a plausible shape.
   */
  grid?: number[][] | null;
  className?: string;
}

export function BusyHoursHeatmap({
  totalOrders,
  grid = null,
  className = "",
}: Props) {
  const hasGrid =
    Array.isArray(grid) &&
    grid.length === DAYS.length &&
    grid.every((r) => r.length === HOURS.length);
  const max = useMemo(
    () => (hasGrid ? Math.max(...grid!.flat(), 0) : 0),
    [grid, hasGrid],
  );

  const labelHours = [0, 6, 9, 12, 15, 18, 21];

  if (!hasGrid) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1 h-full text-center px-4 ${className}`}
      >
        <p className="text-xs font-semibold text-gray-500">
          No check times to plot
        </p>
        <p className="text-[11px] text-gray-400 max-w-[38ch]">
          A busy-hours grid needs the time each check closed. Connect a POS, or
          ring checks on the terminal, and this fills in.
          {totalOrders > 0
            ? ` ${totalOrders} order(s) are counted elsewhere on this page — they carry no times.`
            : ""}
        </p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-1 h-full overflow-hidden ${className}`}>
      {/* Hour axis */}
      <div className="flex pl-8">
        {HOURS.map((h) => (
          <div
            key={h}
            className="flex-1 text-[8px] text-gray-400 text-center leading-none"
          >
            {labelHours.includes(h)
              ? h === 0
                ? "12a"
                : h < 12
                  ? `${h}a`
                  : h === 12
                    ? "12p"
                    : `${h - 12}p`
              : ""}
          </div>
        ))}
      </div>

      {/* Grid */}
      {grid!.map((row, di) => (
        <div
          key={DAYS[di]}
          className="flex items-center gap-0.5 flex-1 min-h-0"
        >
          <span className="w-7 text-[9px] text-gray-400 text-right pr-1 leading-none flex-shrink-0">
            {DAYS[di]}
          </span>
          {row.map((val, hi) => (
            <div
              key={hi}
              className="flex-1 rounded-[2px] min-h-0 h-full"
              style={{ backgroundColor: cellColor(val, max), minHeight: 8 }}
              title={`${DAYS[di]} ${hi}:00 — ~${val} orders`}
            />
          ))}
        </div>
      ))}

      {/* Legend */}
      <div className="flex items-center gap-1 justify-end pt-0.5">
        <span className="text-[9px] text-gray-400">Low</span>
        {["#F1F7F8", "#E0EFF1", "#BEDDE2", "#8FC4CD", "#5FB0BC", "#1A5E6B"].map(
          (c) => (
            <div
              key={c}
              className="w-3 h-2 rounded-[1px]"
              style={{ backgroundColor: c }}
            />
          ),
        )}
        <span className="text-[9px] text-gray-400">High</span>
      </div>
    </div>
  );
}
