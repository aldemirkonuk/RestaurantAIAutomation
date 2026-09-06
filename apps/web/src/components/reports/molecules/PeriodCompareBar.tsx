/**
 * PeriodCompareBar — day-by-day swatch bars comparing current vs previous period.
 * Appears below any chart that receives showComparison=true.
 *
 * It used to INVENT the previous period: `value * (0.75 + Math.random() * 0.45)`
 * (POS lens, absence-as-health 2). That is worse than showing nothing, because
 * it produced a headline verdict — "↑ 12% vs prev" — that an owner can act on,
 * beside real current-period bars, with nothing on screen marking which half
 * was made up. ADR 0020.
 *
 * `previousData` is now a prop. Given real rows it compares them; given none it
 * draws this period and says the comparison is not available. The one thing it
 * will not do is answer a question it has no data for.
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { formatMoney, formatNumber } from "../../../lib/utils";

interface DayData {
  date: string;
  value: number;
}

interface Props {
  currentData: DayData[];
  /**
   * The same days, one period earlier. Omit when they have not been read —
   * the component then says so instead of substituting a plausible shape.
   */
  previousData?: DayData[] | null;
  metric?: "spend" | "orders" | "bottles";
  className?: string;
}

export function PeriodCompareBar({
  currentData,
  previousData = null,
  metric = "spend",
  className = "",
}: Props) {
  const prevData = previousData ?? null;
  const hasComparison =
    Array.isArray(prevData) && prevData.length === currentData.length;

  const maxVal = useMemo(
    () =>
      Math.max(
        ...currentData.map((d) => d.value),
        ...(hasComparison ? prevData!.map((d) => d.value) : []),
        1,
      ),
    [currentData, prevData, hasComparison],
  );

  const fmt = (v: number) =>
    metric === "spend" ? formatMoney(v, "compact") : formatNumber(v, "compact");

  const totalCurrent = currentData.reduce((s, d) => s + d.value, 0);
  const totalPrev = hasComparison
    ? prevData!.reduce((s, d) => s + d.value, 0)
    : 0;
  const changePct =
    hasComparison && totalPrev > 0
      ? Math.round(((totalCurrent - totalPrev) / totalPrev) * 100)
      : null;

  return (
    <div className={`space-y-1.5 ${className}`}>
      {/* Label row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-[10px] text-gray-500">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-2 rounded-sm bg-wine-500" />
            This period
          </span>
          {hasComparison && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-2 rounded-sm bg-gray-200" />
              Previous
            </span>
          )}
        </div>
        {changePct === null ? (
          <span className="text-[11px] text-gray-400">
            Previous period is not available
          </span>
        ) : (
          <span
            className={`text-[11px] font-semibold ${changePct >= 0 ? "text-emerald-600" : "text-red-500"}`}
          >
            {changePct >= 0 ? "↑" : "↓"} {Math.abs(changePct)}% vs prev
          </span>
        )}
      </div>

      {/* Swatch grid */}
      <div className="flex gap-0.5 items-end">
        {currentData.map((d, i) => {
          const prev = hasComparison ? prevData![i] : null;
          const curH = (d.value / maxVal) * 36;
          const preH = prev ? (prev.value / maxVal) * 36 : 0;
          const isUp = prev ? d.value >= prev.value : true;
          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center gap-0.5 group relative"
              title={
                prev
                  ? `${d.date}: ${fmt(d.value)} (prev: ${fmt(prev.value)})`
                  : `${d.date}: ${fmt(d.value)} — no previous period to compare`
              }
            >
              {/* Tooltip */}
              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                <div className="bg-gray-800 text-white text-[9px] rounded px-1.5 py-0.5 whitespace-nowrap">
                  {d.date}: {fmt(d.value)}
                  <br />
                  {prev ? `Prev: ${fmt(prev.value)}` : "No previous period"}
                </div>
                <div className="w-1.5 h-1.5 bg-gray-800 rotate-45 -mt-1" />
              </div>

              {/* Current bar */}
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: curH }}
                transition={{ delay: i * 0.02, duration: 0.3 }}
                className={`w-full rounded-t-[2px] ${isUp ? "bg-wine-500" : "bg-wine-300"}`}
                style={{ minHeight: 2 }}
              />
              {/* Previous bar (ghost) — drawn only when there IS a previous. */}
              {prev && (
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: preH }}
                  transition={{ delay: i * 0.02 + 0.1, duration: 0.3 }}
                  className="w-full rounded-t-[2px] bg-gray-200"
                  style={{ minHeight: 2 }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
