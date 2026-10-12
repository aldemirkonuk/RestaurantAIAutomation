/**
 * Load the opening stock from a spreadsheet (F-685, S195): wine, quantity,
 * shelf and cost per bottle. Read the house's way and sorted before anything
 * is sent (`planOpeningStock`). Two existing doors write it, nothing new:
 *
 *   - a wine not on the list yet is RECEIVED (`POST .../items/bulk`, the same
 *     batch receipt a delivery uses), with its shelf and cost;
 *   - a wine already carried is COUNTED to the file's number
 *     (`POST .../item/:id/count`, on its shelf when one is named), so the same
 *     file imported twice never doubles the cellar.
 *
 * Owners and managers only: a cost is theirs to set (F-312), and the page
 * offers this to them alone.
 */

import { useState } from "react";
import { X } from "lucide-react";
import {
  bulkCreateInventoryItems,
  recordSpotCount,
} from "../../../services/api/inventory";
import { getErrorMessage } from "../../../services/api/client";
import {
  parseCsvRows,
  planOpeningStock,
  readCsvFile,
  type OpeningStockPlan,
} from "../../../lib/csvImport";
import { formatHouseMoney } from "../../../lib/houseCurrency";

interface Outcome {
  received: number;
  addedToCarried: number;
  counted: number;
  failed: string[];
}

export function OpeningStockImport({
  carried,
  shelves,
  onDone,
  onClose,
}: {
  carried: { inventoryId?: string; name: string; vintage?: number | null; producer?: string | null }[];
  shelves: { id: string; name: string }[];
  onDone: () => void;
  onClose: () => void;
}) {
  const [plan, setPlan] = useState<OpeningStockPlan | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const choose = async (file: File | undefined) => {
    setPlan(null);
    setOutcome(null);
    setProblem(null);
    if (!file) return;
    try {
      setPlan(planOpeningStock(parseCsvRows(await readCsvFile(file)), carried, shelves));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "The file could not be read, so nothing was sent.");
    }
  };

  const send = async () => {
    if (!plan) return;
    setSending(true);
    setProblem(null);
    const out: Outcome = { received: 0, addedToCarried: 0, counted: 0, failed: [] };
    try {
      if (plan.receive.length > 0) {
        const r = await bulkCreateInventoryItems(
          {
            source: "opening_stock",
            reason: "Opening stock, imported from a spreadsheet",
            items: plan.receive.map((w) => ({
              wineDraft: { name: w.name, ...(w.producer ? { producer: w.producer } : {}), vintage: w.vintage },
              stockLive: w.qty,
              storageLocationId: w.shelfId,
              ...(w.cost !== null ? { costPerBottle: w.cost, costProvenance: "manual" as const } : {}),
            })),
          },
          undefined,
          { idempotencyKey: `opening-stock:${crypto.randomUUID()}` },
        );
        for (const line of r.results) {
          if (line.status === "failed") out.failed.push(`${line.wineName}: ${line.error ?? "not received"}`);
          else if (line.status === "stock_added") out.addedToCarried += 1;
          // F-1457: a wine already carried that the list did not match by
          // name is counted to the file's number by the gateway, not added.
          else if (line.status === "counted") out.counted += 1;
          else out.received += 1;
        }
      }
      for (const c of plan.count) {
        try {
          await recordSpotCount(c.inventoryId, {
            countedQty: c.qty,
            reason: "Opening stock, imported from a spreadsheet",
            // F-1514: the first count, not a variance in the month close.
            opening: true,
            ...(c.shelfId ? { locationId: c.shelfId } : {}),
          });
          out.counted += 1;
        } catch (e) {
          out.failed.push(`${c.name}: ${getErrorMessage(e)}`);
        }
      }
      setOutcome(out);
      setPlan(null);
      onDone();
    } catch (e) {
      setProblem(`No wine was received — ${getErrorMessage(e)}`);
    } finally {
      setSending(false);
    }
  };

  const total = plan ? plan.receive.length + plan.count.length : 0;
  return (
    <section
      data-testid="opening-stock-import"
      className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Load opening stock from a spreadsheet</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            A CSV with Wine and Quantity columns; Vintage, Producer, Shelf and Cost (per bottle) are read when present.
            A wine you already carry is counted to the file's number, never added to. Nothing is changed until you
            confirm below.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700">
          <X className="w-4 h-4" />
        </button>
      </div>
      <input
        type="file"
        accept=".csv,text/csv"
        aria-label="Opening stock (CSV)"
        onChange={(e) => void choose(e.target.files?.[0])}
        className="my-2 text-xs"
      />
      {problem && <p role="alert" className="text-xs text-gray-900">{problem}</p>}
      {plan?.fileProblem && <p role="alert" className="text-xs text-gray-900">{plan.fileProblem}</p>}
      {plan && !plan.fileProblem && (
        <div data-testid="opening-stock-preview" className="text-xs">
          <p>
            <strong>{plan.receive.length}</strong> new to the list · <strong>{plan.count.length}</strong> already
            carried, counted to the file's number · <strong>{plan.refused.length}</strong> cannot be used
          </p>
          <ul className="mt-1 mb-2 list-disc pl-5">
            {plan.receive.map((w) => (
              <li key={`r${w.line}`}>
                {w.name}
                {w.vintage ? ` ${w.vintage}` : ""}: {w.qty} {w.qty === 1 ? "bottle" : "bottles"}
                {w.shelfName ? ` on ${w.shelfName}` : ""}
                {w.cost !== null ? `, ${formatHouseMoney(w.cost)} each` : ", cost not stated"}
              </li>
            ))}
            {plan.count.map((c) => (
              <li key={`c${c.line}`}>
                {c.name}: counted to {c.qty}
                {c.shelfName ? ` on ${c.shelfName}` : ""}
                {c.costIgnored ? " (the cost on this line is not applied to a wine you already carry)" : ""}
              </li>
            ))}
            {plan.refused.map((r) => (
              <li key={`x${r.line}`} className="text-gray-500">
                Line {r.line}, {r.label}: {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {outcome && (
        <div role="status" className="text-xs">
          <p>
            {outcome.received} received · {outcome.counted} counted
            {outcome.addedToCarried > 0
              ? ` · ${outcome.addedToCarried} matched a wine you already carry under another name, and were added to it`
              : ""}
          </p>
          {outcome.failed.map((f) => (
            <p key={f} className="text-gray-500">
              Not changed: {f}
            </p>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => void send()}
        disabled={total === 0 || sending}
        className="mt-1 h-8 px-3 bg-wine-600 hover:bg-wine-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold"
      >
        {sending ? "Loading…" : `Load ${total} ${total === 1 ? "wine" : "wines"}`}
      </button>
    </section>
  );
}
