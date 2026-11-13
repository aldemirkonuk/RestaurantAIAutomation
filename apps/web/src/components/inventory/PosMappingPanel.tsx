/**
 * POS buttons → stock. The screen that did not exist (POS lens defects 1-2).
 *
 * The gateway has carried the whole mapping surface since the SimPOS testbed
 * landed — catalog pull, match proposals, approve/reject, the sale-unit review
 * and the unresolved-line queue all work. Nothing in the SPA called any of it:
 * `services/api/posHub.ts` reached exactly two routes, `providers` and
 * `status`. So on the Sim Meyhouse run 44 closed checks put 99 lines through
 * the bridge, 39 landed in `pos_unresolved_lines`, and not one bottle moved
 * until a human worked the API by hand with curl.
 *
 * WHAT THIS SCREEN ASKS, AND WHY IN THIS ORDER
 * --------------------------------------------
 * Two questions stand between a POS button and a depleted bottle, and the old
 * approve endpoint only ever recorded the first:
 *
 *   1. "Which wine is this button?"  → pos_item_mappings.inventory_id
 *   2. "How much does one sale remove?" → sale_volume_ml (ADR 0011)
 *
 * Approving (1) without (2) produced a mapping that queued its very next sale
 * as `no_sale_volume`: a second invisible queue behind the first. So the unit
 * is asked HERE, in the same row, in the same tap — never in a follow-up
 * screen the owner has no reason to visit.
 *
 * WHAT IT REFUSES TO DO
 * ---------------------
 * It does not pre-select a unit. Decision B36 and ADR 0011 both turn on the
 * same point: a guessed unit looks answered, and a mapping that reads
 * "bottle" when it meant a 150ml pour over-depletes by 5x silently. Leaving a
 * row unanswered is a supported outcome — it is written as null, the sale
 * queues, and stock reads high until someone knows. That is the honest state,
 * and the queue counter at the top of the panel is what makes it visible.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import {
  approveProposals,
  getItemMappings,
  getMatchProposals,
  getUnresolvedLines,
  rejectProposal,
  runCatalogMatch,
  setSaleUnits,
  type PosItemMapping,
  type PosMatchProposal,
  type UnresolvedLineGroup,
  type UnresolvedLinesResponse,
} from "../../services/api/posHub";
import {
  confirmPourSize,
  confirmWinePour,
  getTargetMargin,
  type TargetMarginReadout,
} from "../../services/api/pricing";
import { cn } from "../../lib/utils";
import { portionsFor, type PortionFacts, type PortionOffer } from "./posPortions";
import { PourBox } from "./PourBox";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  restaurantId?: string;
  /** Inventory rows, so a proposal's candidate can be named rather than shown as a uuid. */
  inventory: Array<{
    id: string;
    wineName?: string;
    wine_name?: string;
    bottleSizeMl?: number | null;
    pourSizeMl?: number | null;
    /** What a sale of the good can be (inventory read, portion-facts.ts). The offers are built from this alone. */
    portionFacts?: PortionFacts | null;
  }>;
  /** Called after any write that could have moved stock into a mappable state. */
  onChanged?: () => void;
  /**
   * Owner or manager of this house: may confirm a pour here (r26). The gateway
   * refuses anyone else on its own; without it the panel only says who can.
   */
  canManage?: boolean;
}

/**
 * The house's glass of wine as the panel knows it. A read that failed is not
 * an unconfirmed pour (ADR 0067), and an unconfirmed pour is the database's
 * 150 default, which is never offered as a size.
 */
type HousePour =
  | { state: "reading" }
  | { state: "unread"; reason: string }
  | { state: "unconfirmed" }
  | { state: "confirmed"; ml: number; by: string | null };

function housePourFrom(r: TargetMarginReadout | null | undefined): HousePour {
  if (!r) return { state: "unread", reason: "no answer was given" };
  if (r.readable === false) return { state: "unread", reason: r.reason ?? "no reason was given" };
  const ml = Number(r.pour?.ml);
  return r.pour?.confirmed && ml > 0
    ? { state: "confirmed", ml, by: r.pour.confirmedBy?.name ?? null }
    : { state: "unconfirmed" };
}

/**
 * A read that failed and a queue that is empty are different answers (ADR
 * 0067). `null` data with `error` set renders the failure; `[]` renders "clear".
 */
interface LoadState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

const emptyState = <T,>(): LoadState<T> => ({
  data: null,
  error: null,
  loading: false,
});

/** The unit answer for one row. `null` = deliberately unanswered. */
interface UnitAnswer {
  label: string;
  ml: number | null;
}

function errText(e: unknown): string {
  const anyE = e as {
    response?: { data?: { message?: string } };
    message?: string;
  };
  return anyE?.response?.data?.message || anyE?.message || "Request failed";
}

export function PosMappingPanel({
  isOpen,
  onClose,
  restaurantId,
  inventory,
  onChanged,
  canManage = false,
}: Props) {
  const [proposals, setProposals] =
    useState<LoadState<PosMatchProposal[]>>(emptyState);
  const [unresolved, setUnresolved] =
    useState<LoadState<UnresolvedLinesResponse>>(emptyState);
  const [mappings, setMappings] =
    useState<LoadState<PosItemMapping[]>>(emptyState);
  const [answers, setAnswers] = useState<Record<string, UnitAnswer>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [matching, setMatching] = useState(false);
  // The house's pour. Only a CONFIRMED one is a size: unconfirmed or unread,
  // a wine's glass says its size is not known rather than pouring 150.
  const [housePour, setHousePour] = useState<HousePour>({ state: "reading" });
  const housePourMl = housePour.state === "confirmed" ? housePour.ml : null;
  // r26: pours confirmed in this panel, by item, so a row's glass or shot can
  // be picked at once rather than after the inventory is read again.
  const [ownPour, setOwnPour] = useState<Record<string, number>>({});
  // Which pour box is open: "house", or "item:<row key>". One at a time.
  const [pourOpen, setPourOpen] = useState<string | null>(null);
  // r26 walk: after Escape (or Cancel, or a confirm) the box closes and its
  // opener comes back, but focus fell to the page. It goes back to the button
  // that opened the box, when that button is there again; else to the dialog,
  // never to the page behind it.
  const dialog = useRef<HTMLDivElement>(null);
  const lastPour = useRef<string | null>(null);
  useEffect(() => {
    if (pourOpen !== null) {
      lastPour.current = pourOpen;
      return;
    }
    const key = lastPour.current;
    lastPour.current = null;
    if (!key || !dialog.current) return;
    const opener = Array.from(
      dialog.current.querySelectorAll<HTMLElement>("[data-pour-opener]"),
    ).find((el) => el.getAttribute("data-pour-opener") === key);
    (opener ?? dialog.current).focus();
  }, [pourOpen]);

  const invById = useMemo(() => {
    const m = new Map<string, { name: string; facts: PortionFacts | null }>();
    for (const i of inventory || []) {
      const facts = i.portionFacts ?? null;
      const mine = ownPour[i.id];
      m.set(i.id, {
        name: i.wineName || i.wine_name || "Unnamed row",
        facts: facts && mine != null ? { ...facts, pourMl: mine } : facts,
      });
    }
    return m;
  }, [inventory, ownPour]);

  const load = useCallback(async () => {
    setProposals((s) => ({ ...s, loading: true }));
    setUnresolved((s) => ({ ...s, loading: true }));
    setMappings((s) => ({ ...s, loading: true }));

    // Each read reports its own outcome. One failing must not blank the others,
    // and none of them may report a failure as "nothing here".
    const [p, u, m, t] = await Promise.allSettled([
      getMatchProposals(restaurantId, "pending"),
      getUnresolvedLines(restaurantId),
      getItemMappings(restaurantId),
      getTargetMargin(),
    ]);
    setHousePour(
      t.status === "fulfilled"
        ? housePourFrom(t.value)
        : { state: "unread", reason: errText(t.reason) },
    );
    setProposals(
      p.status === "fulfilled"
        ? { data: p.value, error: null, loading: false }
        : { data: null, error: errText(p.reason), loading: false },
    );
    setUnresolved(
      u.status === "fulfilled"
        ? { data: u.value, error: null, loading: false }
        : { data: null, error: errText(u.reason), loading: false },
    );
    setMappings(
      m.status === "fulfilled"
        ? { data: m.value, error: null, loading: false }
        : { data: null, error: errText(m.reason), loading: false },
    );
  }, [restaurantId]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  if (!isOpen) return null;

  const proposalRows = proposals.data ?? [];
  const noSaleVolume = (unresolved.data?.items ?? []).filter(
    (i) => i.reason === "no_sale_volume",
  );
  const stillUnmapped = (unresolved.data?.items ?? []).filter(
    (i) => i.reason !== "no_sale_volume",
  );

  // A mapping row for a queued `no_sale_volume` button, so its unit can be
  // answered without re-approving an identity that is already settled.
  const mappingForQueued = (g: UnresolvedLineGroup): PosItemMapping | null =>
    (mappings.data ?? []).find(
      (m) =>
        m.external_item_id === g.external_item_id ||
        m.item_name === g.item_name,
    ) ?? null;

  const setAnswer = (id: string, label: string, ml: number | null) =>
    setAnswers((a) => ({ ...a, [id]: { label, ml } }));

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const runMatch = async () => {
    setMatching(true);
    try {
      const res = await runCatalogMatch(restaurantId);
      toast.success(
        `Catalog match: ${res.pulled} button(s) read, ${res.autoMapped.length} mapped outright, ${res.proposed.length} waiting for you`,
      );
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(`Catalog match failed: ${errText(e)}`);
    } finally {
      setMatching(false);
    }
  };

  const approveSelected = async () => {
    const items = [...selected]
      .filter((id) => proposalRows.some((p) => p.id === id))
      .map((id) => {
        const a = answers[id];
        return {
          proposal_id: id,
          // Absent stays absent. A default here would be the exact bug ADR
          // 0011 removed from the depletion path.
          sale_unit: a?.label ?? null,
          sale_volume_ml: a?.ml ?? null,
        };
      });
    if (items.length === 0) return;
    setBusy(true);
    try {
      const res = await approveProposals(items, restaurantId);
      // A whole bottle is answered with no volume, so "unanswered" is no unit.
      const unanswered = items.filter((i) => i.sale_unit == null).length;
      if (res.failed > 0) {
        // Partial failure is reported per row, never rounded to "done".
        toast.error(
          `${res.approved} of ${res.requested} approved. ${res.failed} failed: ${res.results
            .filter((r) => !r.ok)
            .map((r) => r.error)
            .join("; ")}`,
        );
      } else if (unanswered > 0) {
        toast.warning(
          `${res.approved} approved — ${unanswered} without a sale size, so their next sale will queue and move no stock.`,
        );
      } else {
        toast.success(`${res.approved} button(s) now deplete stock.`);
      }
      setSelected(new Set());
      setAnswers({});
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(`Approve failed: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const answerQueuedUnit = async (
    mappingId: string,
    unit: "glass" | "bottle",
    word: string,
  ) => {
    setBusy(true);
    try {
      const res = await setSaleUnits(
        [{ mapping_id: mappingId, sale_unit: unit }],
        restaurantId,
      );
      const bad = res.results.find((r) => !r.ok);
      if (bad) toast.error(`Could not record the unit: ${bad.error}`);
      else
        toast.success(
          `Recorded — sales of this button now remove one ${word}.`,
        );
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(`Could not record the unit: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const reject = async (proposalId: string) => {
    setBusy(true);
    try {
      await rejectProposal(proposalId, restaurantId);
      await load();
    } catch (e) {
      toast.error(`Reject failed: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // r26: a glass or a shot waits for a confirmed pour, and nothing on
  // /inventory could confirm one (TargetMarginSection is mounted nowhere). The
  // pour is now confirmed here, next to the button that waits for it.
  const confirmHousePour = async (ml: number) => {
    const r = await confirmPourSize(ml);
    setHousePour(housePourFrom(r));
    setPourOpen(null);
    toast.success(`The house's glass of wine is now ${ml} ml.`);
  };

  const confirmItemPour = async (
    inventoryId: string,
    name: string,
    word: string,
    ml: number,
  ) => {
    await confirmWinePour(inventoryId, ml);
    setOwnPour((p) => ({ ...p, [inventoryId]: ml }));
    setPourOpen(null);
    toast.success(`${name}: one ${word} is now ${ml} ml.`);
    onChanged?.();
  };

  /**
   * The "Confirm a shot size" ask for a row whose pour offer waits only for a
   * confirmed pour (not for a bottle size, not for a pour that does not fit).
   * Nothing is picked for the person after it is confirmed: the size becomes
   * choosable, and choosing stays theirs (ADR 0011, B36).
   */
  const pourAsk = (
    key: string,
    inventoryId: string | null | undefined,
    offers: PortionOffer[],
  ) => {
    const waiting = offers.find((o) => o.shape === "pour" && o.needs === "pour");
    const item = inventoryId ? invById.get(inventoryId) : undefined;
    if (!canManage || !waiting || !inventoryId || !item) {
      return { button: null, box: null };
    }
    const open = pourOpen === `item:${key}`;
    const word = waiting.saleUnit;
    const isWine = item.facts?.kind === "wine";
    return {
      button: open ? null : (
        <button
          type="button"
          onClick={() => setPourOpen(`item:${key}`)}
          data-pour-opener={`item:${key}`}
          className="h-7 px-2 rounded-md text-[11px] font-semibold text-wine-700 hover:underline"
        >
          Confirm a {word} size
        </button>
      ),
      box: open ? (
        <PourBox
          label={`One ${word} of ${item.name}, in ml`}
          startMl={null}
          sentence={(ml) =>
            `Confirm records one ${word} of ${item.name} as ${ml} ml. A ${word} sale of it then removes ${ml} ml from its open bottle${isWine ? ", and its glass price advice uses the same pour" : ""}.`
          }
          onConfirm={(ml) => confirmItemPour(inventoryId, item.name, word, ml)}
          onCancel={() => setPourOpen(null)}
        />
      ) : null,
    };
  };

  const summary = unresolved.data?.summary;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div
        ref={dialog}
        tabIndex={-1}
        className="bg-white rounded-2xl shadow-xl w-full max-w-5xl my-6 outline-none"
        role="dialog"
        aria-label="POS buttons and stock"
      >
        {/* header */}
        <div className="flex items-start justify-between gap-4 p-5 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-extrabold text-gray-900">
              POS buttons → stock
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Confirm which wine each POS button is, and how much one sale
              removes. Both are needed before a sale can move a bottle.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={runMatch}
              disabled={matching}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {matching ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Re-read POS catalog
            </button>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-2 rounded-lg hover:bg-gray-100"
            >
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        </div>

        {/* the queue, stated in stock and money rather than row counts */}
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/70">
          {unresolved.error && (
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-700">
              <AlertTriangle className="w-3.5 h-3.5" />
              The unresolved-line queue could not be read ({unresolved.error}).
              This is not a claim that the queue is empty.
            </div>
          )}
          {!unresolved.error && unresolved.loading && !summary && (
            <span className="text-xs text-gray-400">Reading the queue…</span>
          )}
          {!unresolved.error && summary && (
            <div className="flex items-center gap-5 flex-wrap text-xs">
              <span className="text-gray-700">
                <b className="font-mono">{summary.open_lines}</b> POS line(s)
                have arrived and moved <b>no stock</b>
              </span>
              <span className="text-gray-500">
                <b className="font-mono">{summary.qty_total}</b> unit(s)
                unaccounted for
              </span>
              <span className="text-gray-500">
                across <b className="font-mono">{summary.distinct_items}</b>{" "}
                button(s)
              </span>
              {summary.truncated && (
                <span className="text-amber-700 font-semibold">
                  read capped — this is a floor, not the total
                </span>
              )}
            </div>
          )}
        </div>

        <div className="p-5 space-y-6 max-h-[65vh] overflow-y-auto">
          {/* ── 0. the house's glass of wine (r26) ── */}
          <section aria-label="The house's glass of wine" data-testid="house-pour">
            <div className="flex items-center gap-2 flex-wrap text-xs">
              {housePour.state === "reading" && (
                <span className="text-gray-400">
                  Reading the house's glass of wine…
                </span>
              )}
              {housePour.state === "unread" && (
                <span className="font-semibold text-amber-700">
                  The house's glass of wine could not be read (
                  {housePour.reason}). A wine's glass waits below; this is not
                  the same as a pour nobody confirmed.
                </span>
              )}
              {housePour.state === "unconfirmed" && (
                <span className="text-gray-700">
                  <b>The house's glass of wine is not confirmed.</b> A wine's
                  glass can be picked below once it is, or once that wine has a
                  pour of its own.
                  {!canManage &&
                    " Only an owner or a manager can confirm it."}
                </span>
              )}
              {housePour.state === "confirmed" && (
                <span className="text-gray-700">
                  A glass of wine pours the house's{" "}
                  <b className="font-mono">{housePour.ml} ml</b>
                  {housePour.by ? `, confirmed by ${housePour.by}` : ""}, unless
                  the wine has a pour of its own.
                </span>
              )}
              {canManage &&
                (housePour.state === "unconfirmed" ||
                  housePour.state === "confirmed") &&
                pourOpen !== "house" && (
                  <button
                    type="button"
                    onClick={() => setPourOpen("house")}
                    data-pour-opener="house"
                    className="h-7 px-2.5 rounded-md border border-gray-200 bg-white text-[11px] font-bold text-gray-700 hover:border-gray-300"
                  >
                    {housePour.state === "confirmed"
                      ? "Change the house glass"
                      : "Confirm the house glass"}
                  </button>
                )}
            </div>
            {pourOpen === "house" && (
              <div className="mt-2 max-w-xl">
                <PourBox
                  label="The house's glass of wine, in ml"
                  startMl={housePourMl}
                  sentence={(ml) =>
                    `Confirm records the house's glass of wine as ${ml} ml. A wine with no pour of its own then sells a ${ml} ml glass, and glass price advice uses the same pour. Buttons already saved keep the size they were saved with.`
                  }
                  onConfirm={confirmHousePour}
                  onCancel={() => setPourOpen(null)}
                />
              </div>
            )}
          </section>

          {/* ── 1. proposals: identity + unit in one step ── */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                Waiting for you — {proposalRows.length} button(s)
              </h3>
              {selected.size > 0 && (
                <button
                  onClick={approveSelected}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-wine-600 hover:bg-wine-700 text-white text-xs font-bold disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  Confirm {selected.size}
                </button>
              )}
            </div>

            {proposals.error && (
              <p className="text-xs font-semibold text-amber-700">
                Match proposals could not be read ({proposals.error}) — not the
                same as having none.
              </p>
            )}
            {!proposals.error &&
              !proposals.loading &&
              proposalRows.length === 0 && (
                <p className="text-xs text-gray-400">
                  No buttons are waiting. "Re-read POS catalog" pulls the
                  current button list and matches it again.
                </p>
              )}

            <div className="space-y-1.5">
              {proposalRows.map((p) => {
                const cand = p.candidate_inventory_id
                  ? invById.get(p.candidate_inventory_id)
                  : null;
                const a = answers[p.id];
                // r24: the offers follow the good's kind and stated sizes
                // (posPortions.ts). A soda has no glass; an unsized bottle says
                // so; a pour needs a stated bottle and a confirmed pour.
                const portions = cand ? portionsFor(cand.facts, housePourMl) : null;
                const ask = pourAsk(
                  `p:${p.id}`,
                  p.candidate_inventory_id,
                  portions?.offers ?? [],
                );
                return (
                  <div
                    key={p.id}
                    className={cn(
                      "flex items-center gap-3 flex-wrap rounded-lg border px-3 py-2",
                      selected.has(p.id)
                        ? "border-wine-300 bg-wine-50/50"
                        : "border-gray-200 bg-white",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                      disabled={!p.candidate_inventory_id}
                      aria-label={`Confirm ${p.item_name}`}
                      className="w-4 h-4"
                    />
                    <div className="min-w-[180px] flex-1">
                      <div className="text-sm font-semibold text-gray-900">
                        {p.item_name}
                      </div>
                      <div className="text-[11px] text-gray-400 font-mono">
                        {p.external_item_id}
                      </div>
                    </div>
                    <div className="min-w-[180px] flex-1 text-xs">
                      {cand ? (
                        <>
                          <span className="text-gray-700">{cand.name}</span>
                          {/* The raw score, not a verdict dressed as one. */}
                          <span className="text-gray-400 ml-1.5 font-mono">
                            {p.confidence != null
                              ? `${Math.round(p.confidence * 100)}%`
                              : "—"}{" "}
                            · {p.match_method}
                          </span>
                        </>
                      ) : (
                        <span className="text-amber-700 font-semibold">
                          no inventory row matched — add the wine first
                        </span>
                      )}
                    </div>
                    {/* the second question, asked here */}
                    <div className="flex items-center gap-1">
                      {(portions?.offers ?? []).map((o) => (
                        <button
                          key={o.shape}
                          onClick={() =>
                            o.blocked === null &&
                            setAnswer(p.id, o.saleUnit, o.saleVolumeMl)
                          }
                          disabled={o.blocked !== null}
                          title={o.blocked ?? undefined}
                          aria-pressed={a?.label === o.saleUnit}
                          className={cn(
                            "h-7 px-2.5 rounded-md text-[11px] font-bold border",
                            a?.label === o.saleUnit
                              ? "border-wine-600 bg-wine-600 text-white"
                              : "border-gray-200 bg-white text-gray-600 hover:border-gray-300",
                            o.blocked !== null && "opacity-60 cursor-not-allowed",
                          )}
                        >
                          {o.text}
                        </button>
                      ))}
                      {ask.button}
                      {portions?.note && (
                        <span className="text-[11px] text-gray-500 max-w-[220px]">
                          {portions.note}
                        </span>
                      )}
                      <button
                        onClick={() => reject(p.id)}
                        disabled={busy}
                        className="h-7 px-2 rounded-md text-[11px] font-semibold text-gray-400 hover:text-gray-700"
                      >
                        Not this
                      </button>
                    </div>
                    {ask.box}
                  </div>
                );
              })}
            </div>
            {selected.size > 0 && [...selected].some((id) => !answers[id]) && (
              <p className="text-[11px] text-amber-700 font-semibold mt-2">
                {[...selected].filter((id) => !answers[id]).length} selected
                button(s) have no sale size. They will be confirmed as the right
                wine, but their sales will keep queueing and move no stock until
                a size is set.
              </p>
            )}
          </section>

          {/* ── 2. mapped, but nobody said how much a sale removes ── */}
          {noSaleVolume.length > 0 && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                Identified, but no sale size — {noSaleVolume.length} button(s)
              </h3>
              <div className="space-y-1.5">
                {noSaleVolume.map((g) => {
                  const m = mappingForQueued(g);
                  const item = m?.inventory_id ? invById.get(m.inventory_id) : undefined;
                  // This route takes a unit only: "bottle" books one unit, and
                  // "glass" pours the item's own pour_size_ml. So a pour is
                  // offered here only when that column is the confirmed pour;
                  // the house's pour does not reach this route.
                  const offers = item
                    ? portionsFor(item.facts, housePourMl).offers.map((o) =>
                        o.shape === "pour" && o.blocked === null && item.facts?.pourMl == null
                          ? {
                              ...o,
                              blocked:
                                "This answer pours the item's own pour, and that is not confirmed. Confirm the pour on the item first; until then this button's sales keep queueing.",
                              needs: "pour" as const,
                            }
                          : o,
                      )
                    : [];
                  const queuedKey = `q:${g.source}:${g.external_item_id}:${g.item_name}`;
                  const ask = pourAsk(queuedKey, m?.inventory_id, offers);
                  return (
                    <div
                      key={`${g.source}:${g.external_item_id}:${g.item_name}`}
                      className="flex items-center gap-3 flex-wrap rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2"
                    >
                      <div className="flex-1 min-w-[200px]">
                        <div className="text-sm font-semibold text-gray-900">
                          {g.item_name}
                        </div>
                        <div className="text-[11px] text-gray-500">
                          {g.occurrences} sale(s), {g.qty_total} unit(s) — none
                          removed from stock
                        </div>
                      </div>
                      {m && offers.length > 0 ? (
                        <div className="flex items-center gap-1">
                          {offers.map((o) => (
                            <button
                              key={o.shape}
                              onClick={() =>
                                answerQueuedUnit(
                                  m.id,
                                  o.shape === "whole" ? "bottle" : "glass",
                                  o.shape === "whole" ? "unit" : o.saleUnit,
                                )
                              }
                              disabled={busy || o.blocked !== null}
                              title={o.blocked ?? undefined}
                              className="h-7 px-2.5 rounded-md text-[11px] font-bold border border-gray-200 bg-white text-gray-600 hover:border-gray-300 disabled:opacity-50"
                            >
                              {o.text}
                            </button>
                          ))}
                          {ask.button}
                        </div>
                      ) : (
                        <span className="text-[11px] font-semibold text-amber-700">
                          {mappings.error
                            ? "mappings could not be read — cannot offer an answer here"
                            : !m
                              ? "no mapping row found for this button"
                              : item
                                ? (portionsFor(item.facts, housePourMl).note ??
                                  "no sale size fits this item")
                                : "its item is not in this list — cannot offer an answer here"}
                        </span>
                      )}
                      {ask.box}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── 3. arrived, unrecognised ── */}
          {stillUnmapped.length > 0 && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                Not recognised — {stillUnmapped.length} button(s)
              </h3>
              <p className="text-[11px] text-gray-500 mb-2">
                These rang up and matched nothing in inventory. Food and drinks
                that are not wine belong here and are safe to ignore; a wine
                here needs adding to inventory first, then "Re-read POS
                catalog".
              </p>
              <div className="flex flex-wrap gap-1.5">
                {stillUnmapped.map((g) => (
                  <span
                    key={`${g.source}:${g.external_item_id}:${g.item_name}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] text-gray-600"
                    title={`${g.occurrences} line(s), ${g.qty_total} unit(s)`}
                  >
                    {g.item_name}
                    <b className="font-mono text-gray-400">{g.qty_total}</b>
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export default PosMappingPanel;
