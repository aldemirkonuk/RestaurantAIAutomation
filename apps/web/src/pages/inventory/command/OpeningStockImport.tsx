/**
 * Load the opening stock from a spreadsheet (F-685, S195): name, quantity,
 * type, shelf and cost per bottle. Every drink, not wine alone (F-1684): the
 * Type travels on the draft so a beer is classified as a beer. Read the house's way and sorted before anything
 * is sent (`planOpeningStock`). Two existing doors write it, nothing new:
 *
 *   - a wine not on the list yet is RECEIVED (`POST .../items/bulk`, the same
 *     batch receipt a delivery uses), with its shelf and cost;
 *   - a wine already carried is COUNTED to the file's number
 *     (`POST .../item/:id/count`, on its shelf when one is named), so the same
 *     file imported twice never doubles the cellar. Its cost per bottle
 *     goes with the count when the wine has no cost yet (F-1524: a menu puts
 *     every wine on the list with none); a cost it has is kept.
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
import {
  CostTaxChoice,
  useHouseCostTax,
  type CostTaxBasis,
} from "../../../components/inventory/CostTaxChoice";

interface Outcome {
  received: number;
  addedToCarried: number;
  counted: number;
  /** F-1524: counted wines that had a cost before this file, kept. */
  costKept: string[];
  /**
   * F-1582: wines whose costed (last) line failed, so the file's cost is not
   * on them; `earlier` when bottles from its other shelves were counted
   * uncosted before it.
   */
  costNotApplied: { name: string; earlier: boolean }[];
  failed: string[];
}

export function OpeningStockImport({
  carried,
  shelves,
  onDone,
  onClose,
}: {
  carried: {
    inventoryId?: string;
    name: string;
    vintage?: number | null;
    producer?: string | null;
    hasCost?: boolean;
  }[];
  /** `parentId`: the place it sits in; a place others sit in is not a shelf (F-945). */
  shelves: { id: string; name: string; parentId?: string | null }[];
  onDone: () => void;
  onClose: () => void;
}) {
  const [plan, setPlan] = useState<OpeningStockPlan | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // F-1683: the shelf new items the file puts on no shelf go on; '' = none.
  const [putAllOn, setPutAllOn] = useState('');
  // ADR 0341 F3: whether tax is inside the file's costs, one answer for the
  // file; null = not said, and nothing is sent for it.
  const costTax = useHouseCostTax(true);
  const [costTaxBasis, setCostTaxBasis] = useState<CostTaxBasis | null>(null);
  const saidTax = costTax?.inclusive && costTaxBasis ? { costTaxBasis } : {};
  const insides = new Set(shelves.map((s) => s.parentId).filter(Boolean));
  const leafShelves = shelves.filter((s) => !insides.has(s.id));
  const fallback = leafShelves.find((s) => s.id === putAllOn) ?? null;

  const choose = async (file: File | undefined) => {
    setPlan(null);
    setOutcome(null);
    setProblem(null);
    setPutAllOn('');
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
    const out: Outcome = { received: 0, addedToCarried: 0, counted: 0, costKept: [], costNotApplied: [], failed: [] };
    try {
      if (plan.receive.length > 0) {
        const r = await bulkCreateInventoryItems(
          {
            source: "opening_stock",
            reason: "Opening stock, imported from a spreadsheet",
            items: plan.receive.map((w) => ({
              wineDraft: {
                name: w.name,
                ...(w.producer ? { producer: w.producer } : {}),
                vintage: w.vintage,
                // F-1684: the file's Type, so a beer is not filed as a wine.
                ...(w.category ? { category: w.category } : {}),
              },
              stockLive: w.qty,
              storageLocationId: w.shelfId ?? fallback?.id ?? null,
              ...(w.cost !== null ? { costPerBottle: w.cost, costProvenance: "manual" as const, ...saidTax } : {}),
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
      // F-1556: a wine on several shelves is costed by its LAST line only.
      // record_stock_count costs a wine only while it has no costed bottles,
      // so a cost sent with its first line made every later line land
      // uncosted. Sent last, it costs the bottles the earlier lines added
      // too, and a "kept" answer can only mean a cost from before this file.
      const lastLine = new Map(plan.count.map((c) => [c.inventoryId, c.line]));
      for (const c of plan.count) {
        const cost = lastLine.get(c.inventoryId) === c.line ? c.cost : null;
        try {
          const r = await recordSpotCount(c.inventoryId, {
            countedQty: c.qty,
            reason: "Opening stock, imported from a spreadsheet",
            // F-1514: the first count, not a variance in the month close.
            opening: true,
            ...(c.shelfId ? { locationId: c.shelfId } : {}),
            // F-1524: used only if the wine still has no cost when it lands.
            ...(cost !== null ? { costPerBottle: cost, ...saidTax } : {}),
          });
          out.counted += 1;
          if (cost !== null && r?.count?.costApplied === false) out.costKept.push(c.name);
        } catch (e) {
          out.failed.push(`${c.name}: ${getErrorMessage(e)}`);
          if (cost !== null) {
            out.costNotApplied.push({
              name: c.name,
              earlier: plan.count.some((o) => o.inventoryId === c.inventoryId && o.line !== c.line),
            });
          }
        }
      }
      setOutcome(out);
      setPlan(null);
      onDone();
    } catch (e) {
      setProblem(`Nothing was received — ${getErrorMessage(e)}`);
    } finally {
      setSending(false);
    }
  };

  const total = plan ? plan.receive.length + plan.count.length : 0;
  const fileHasCost = plan
    ? plan.receive.some((w) => w.cost !== null) || plan.count.some((c) => c.cost !== null)
    : false;
  const unshelved = plan ? plan.receive.filter((w) => !w.shelfId).length : 0;
  return (
    <section
      data-testid="opening-stock-import"
      className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Load opening stock from a spreadsheet</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            A CSV with Name and Quantity columns; Type (wine, beer, spirit…), Vintage, Producer, Shelf and Cost (per
            bottle) are read when present. An item you already carry is counted to the file's number, never added to.
            Nothing is changed until you confirm below.
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
                {w.shelfName ? ` on ${w.shelfName}` : fallback ? ` on ${fallback.name}` : ""}
                {w.cost !== null ? `, ${formatHouseMoney(w.cost)} each` : ", cost not stated"}
              </li>
            ))}
            {plan.count.map((c) => (
              <li key={`c${c.line}`}>
                {c.name}: counted to {c.qty}
                {c.shelfName ? ` on ${c.shelfName}` : ""}
                {c.cost !== null
                  ? `, ${formatHouseMoney(c.cost)} each (this item has no cost yet, so this one is used${
                      c.costAcrossShelves === "averaged"
                        ? "; the file gives it different costs on its shelves, so they are averaged by bottles and used on every shelf"
                        : c.costAcrossShelves === "same"
                          ? " for its bottles on every shelf in this file"
                          : ""
                    })`
                  : ""}
                {c.costIgnored ? " (this item already has a cost, which is kept; the cost on this line is not used)" : ""}
              </li>
            ))}
            {plan.refused.map((r) => (
              <li key={`x${r.line}`} className="text-gray-500">
                Line {r.line}, {r.label}: {r.reason}
              </li>
            ))}
          </ul>
          {fileHasCost && (
            <CostTaxChoice
              terms={costTax}
              value={costTaxBasis}
              onChange={setCostTaxBasis}
              disabled={sending}
              what="the costs in this file"
            />
          )}
          {unshelved > 0 && (
            <div data-testid="opening-stock-no-shelf" className="mb-2">
              <p className="text-gray-900">
                {unshelved} new {unshelved === 1 ? "item names" : "items name"} no shelf. A stock-take on the phone
                goes shelf by shelf, so bottles on no shelf are not on its list; they are counted on Inventory, all at
                once.
                {leafShelves.length > 0 ? " Put them on one shelf to count them there:" : ""}
              </p>
              {leafShelves.length > 0 && (
                <select
                  aria-label="Shelf for the items with no shelf"
                  value={putAllOn}
                  onChange={(e) => setPutAllOn(e.target.value)}
                  className="mt-1 h-8 rounded-lg border border-gray-200 px-2 text-xs"
                >
                  <option value="">No shelf</option>
                  {leafShelves.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
      )}
      {outcome && (
        <div role="status" className="text-xs">
          <p>
            {outcome.received} received · {outcome.counted} counted
            {outcome.addedToCarried > 0
              ? ` · ${outcome.addedToCarried} matched an item you already carry under another name, and were added to it`
              : ""}
          </p>
          {outcome.costKept.length > 0 && (
            <p className="text-gray-500">
              Already had a cost before this file, which was kept: {outcome.costKept.join(", ")}
            </p>
          )}
          {outcome.costNotApplied.length > 0 && (
            <p data-testid="opening-stock-cost-not-applied" className="text-gray-900">
              Cost not applied: {outcome.costNotApplied.map((w) => w.name).join(", ")}.{" "}
              {outcome.costNotApplied.some((w) => w.earlier)
                ? "The bottles already counted on its other shelves have no cost yet. "
                : ""}
              Sending the file again applies it.
            </p>
          )}
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
        {sending ? "Loading…" : `Load ${total} ${total === 1 ? "item" : "items"}`}
      </button>
    </section>
  );
}
