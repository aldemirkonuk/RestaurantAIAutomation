/**
 * MonthlyReconciliation — collapsible section showing stock-on-hand vs
 * theoretical based on purchases and sales, grouped by month.
 *
 * The table used to be SAMPLED, not read: `opening = 180 - i*12`,
 * `purchased = 90 + i*8`, and — the one that matters —
 * `variance = Math.round((Math.random() - 0.5) * 8)`, with `actual` derived
 * from it (POS lens, absence-as-health 4). A variance is the whole point of a
 * reconciliation: it is the number that says whether bottles are walking out
 * of the building, and it was a coin flip rendered with a green tick when it
 * happened to land under 3%.
 *
 * `records` is now a prop. Given real months it renders them verbatim; given
 * none it says the reconciliation is not available. ADR 0020.
 *
 * Not wired here: the real source is a month-grained rollup of
 * `inventory_transactions` against `stock_counts`, which does not exist yet.
 * Building it is a bigger job than removing the fabrication and must not hold
 * it up — a made-up variance is actively harmful in a way an absent one is not.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  ClipboardList,
  GripVertical,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { formatMoney } from "../../../lib/utils";

export interface MonthRecord {
  month: string;
  openingStock: number;
  purchased: number;
  sold: number;
  theoretical: number;
  actual: number;
  variance: number;
  variancePct: number;
}

interface Props {
  totalBottlesSold: number;
  totalInventoryValue: number;
  /**
   * Real month rollups. Omit when they have not been computed — the section
   * then says so instead of sampling a variance.
   */
  records?: MonthRecord[] | null;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
}

export function MonthlyReconciliation({
  totalBottlesSold,
  totalInventoryValue,
  records = null,
  dragHandleProps,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasRecords = Array.isArray(records) && records.length > 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 cursor-pointer select-none group"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div
          {...dragHandleProps}
          className="drag-section-handle cursor-grab active:cursor-grabbing p-1 -ml-1 rounded hover:bg-gray-100 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-4 h-4 text-gray-300" />
        </div>
        <ClipboardList className="w-4 h-4 text-wine-600 flex-shrink-0" />
        <h3 className="text-sm font-semibold text-gray-800 flex-1">
          Monthly Stock Reconciliation
        </h3>
        {totalInventoryValue > 0 && (
          <span className="text-xs text-gray-400 mr-2">
            Inventory value: {formatMoney(totalInventoryValue, "compact")}
          </span>
        )}
        <ChevronDown
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
        />
      </div>

      {/* Content */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="p-4 space-y-3">
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                Reconciliation compares theoretical stock (opening + purchased −
                sold) against actual counted inventory. Connect your POS for
                live counts.
              </p>

              {!hasRecords && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-4 text-center">
                  <p className="text-xs font-semibold text-gray-600">
                    Monthly reconciliation is not available yet
                  </p>
                  <p className="text-[11px] text-gray-500 mt-1 max-w-[52ch] mx-auto">
                    A variance needs two measured numbers per month — what the
                    books say and what was counted. Neither rollup is computed
                    yet, so there is nothing honest to put in this table.
                    {totalBottlesSold > 0
                      ? ` ${totalBottlesSold} bottle(s) sold are counted elsewhere on this page.`
                      : ""}
                  </p>
                </div>
              )}

              {hasRecords && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100">
                        {[
                          "Month",
                          "Opening",
                          "Purchased",
                          "Sold",
                          "Theoretical",
                          "Actual",
                          "Variance",
                        ].map((h) => (
                          <th
                            key={h}
                            className="text-left py-2 px-2 text-gray-400 font-medium first:pl-0 last:pr-0 whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {records!.map((r) => {
                        const isOk = Math.abs(r.variancePct) < 3;
                        return (
                          <tr
                            key={r.month}
                            className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors"
                          >
                            <td className="py-2.5 px-2 first:pl-0 font-medium text-gray-700 whitespace-nowrap">
                              {r.month}
                            </td>
                            <td className="py-2.5 px-2 text-gray-600">
                              {r.openingStock}
                            </td>
                            <td className="py-2.5 px-2 text-gray-600">
                              {r.purchased}
                            </td>
                            <td className="py-2.5 px-2 text-gray-600">
                              {r.sold}
                            </td>
                            <td className="py-2.5 px-2 text-gray-600">
                              {r.theoretical}
                            </td>
                            <td className="py-2.5 px-2 text-gray-600">
                              {r.actual}
                            </td>
                            <td className="py-2.5 px-2 last:pr-0">
                              <div className="flex items-center gap-1">
                                {isOk ? (
                                  <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                ) : (
                                  <AlertTriangle className="w-3 h-3 text-amber-500" />
                                )}
                                <span
                                  className={`font-semibold ${isOk ? "text-emerald-600" : "text-amber-600"}`}
                                >
                                  {r.variance > 0 ? "+" : ""}
                                  {r.variance} ({r.variancePct > 0 ? "+" : ""}
                                  {r.variancePct}%)
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {hasRecords && (
                <p className="text-[10px] text-gray-400">
                  Variances &gt;3% are flagged for review. These rows are read
                  from your own counts and movements — nothing here is
                  estimated.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
