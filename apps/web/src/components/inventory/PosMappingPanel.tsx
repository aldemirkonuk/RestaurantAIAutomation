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
 *
 * ── THE HOUSE SHAPE (ADR 0112, census 102 row "POS buttons and stock") ─────
 * SHAPE: `Sheet`. One queue, worked line by line, with the register still
 * visible beneath — the reader has not left the list, they are working through
 * it. A `Panel` would be wrong twice over: this is not a question answered and
 * left, and it is not one decision but a session of them.
 *
 * No seal. Confirming a button's identity and its sale size writes a mapping
 * row, not a ledger row: no stock moves at the moment of the write, and the
 * effect is reversible by answering again. ADR 0112 rations the wax.
 *
 * WHAT THIS FILE ALREADY DID RIGHT, and the house branch keeps verbatim: three
 * separate reads with three separate outcomes, so a failed read never renders
 * as "nothing here"; a raw match score rather than a verdict; and an unanswered
 * unit left visibly unanswered.
 *
 * WHAT IT COULD NOT SAY, and now does: a write that failed said so in a TOAST
 * and nowhere else, so an operator who missed it saw a panel that looked
 * settled. Every write's failure now lands on the paper, in place, with what
 * did not happen — and a refusal (401/403) is its own state, because "you may
 * not do this" and "the server broke" ask different things of the reader.
 *
 * Endpoints, all live:
 *   POST /pos-hub/catalog-match/:restaurantId                     (:253)
 *   POST /pos-hub/catalog-match/:restaurantId/proposals/approve   (:288)
 *   POST /pos-hub/catalog-match/:restaurantId/proposals/:id/reject(:339)
 *   POST /pos-hub/mappings/:restaurantId/sale-unit                (:204)
 *   GET  /pos-hub/catalog-match/:restaurantId/proposals           (:277)
 *   GET  /pos-hub/unresolved/:restaurantId                        (:355)
 *   GET  /pos-hub/mappings/:restaurantId                          (:143)
 * — apps/api-gateway/src/pos-hub/pos-hub.controller.ts.
 *
 * The legacy branch below is frozen and renders byte-for-byte as it shipped.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { cn } from "../../lib/utils";
import { Sheet } from "../mudavym/Sheet";
import { useMudavymShell } from "../../lib/mudavym/shellGround";
import "./inventory-mudavym.css";

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
  }>;
  /** Called after any write that could have moved stock into a mappable state. */
  onChanged?: () => void;
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
  const shell = useMudavymShell();
  /* A write's failure, on the paper rather than only in a toast. House branch
     only — the legacy render never reads it, so it stays byte-identical. */
  const [wrote, setWrote] = useState<{
    what: string;
    message: string;
    denied: boolean;
  } | null>(null);

  const invById = useMemo(() => {
    const m = new Map<
      string,
      { name: string; bottleMl: number | null; pourMl: number | null }
    >();
    for (const i of inventory || []) {
      m.set(i.id, {
        name: i.wineName || i.wine_name || "Unnamed row",
        bottleMl: i.bottleSizeMl ?? null,
        pourMl: i.pourSizeMl ?? null,
      });
    }
    return m;
  }, [inventory]);

  const load = useCallback(async () => {
    setProposals((s) => ({ ...s, loading: true }));
    setUnresolved((s) => ({ ...s, loading: true }));
    setMappings((s) => ({ ...s, loading: true }));

    // Each read reports its own outcome. One failing must not blank the others,
    // and none of them may report a failure as "nothing here".
    const [p, u, m] = await Promise.allSettled([
      getMatchProposals(restaurantId, "pending"),
      getUnresolvedLines(restaurantId),
      getItemMappings(restaurantId),
    ]);
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

  /** Keep a write's failure on the paper. A toast is a thing you can miss. */
  const noteWriteFailure = (what: string, e: unknown) => {
    const status = (e as { response?: { status?: number } })?.response?.status;
    setWrote({
      what,
      message: errText(e),
      denied: status === 401 || status === 403,
    });
  };

  const runMatch = async () => {
    setMatching(true);
    setWrote(null);
    try {
      const res = await runCatalogMatch(restaurantId);
      toast.success(
        `Catalog match: ${res.pulled} button(s) read, ${res.autoMapped.length} mapped outright, ${res.proposed.length} waiting for you`,
      );
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(`Catalog match failed: ${errText(e)}`);
      noteWriteFailure("The POS catalog was not re-read", e);
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
    setWrote(null);
    try {
      const res = await approveProposals(items, restaurantId);
      const unanswered = items.filter((i) => i.sale_volume_ml == null).length;
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
      noteWriteFailure("Nothing was confirmed", e);
    } finally {
      setBusy(false);
    }
  };

  const answerQueuedUnit = async (
    mappingId: string,
    unit: "glass" | "bottle",
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
          `Recorded — sales of this button now remove one ${unit}.`,
        );
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(`Could not record the unit: ${errText(e)}`);
      noteWriteFailure("The sale size was not recorded", e);
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
      noteWriteFailure("The proposal was not rejected", e);
    } finally {
      setBusy(false);
    }
  };

  const summary = unresolved.data?.summary;

  /* ── the house shape ───────────────────────────────────────────────────── */
  if (shell.on) {
    const unanswered = [...selected].filter((id) => !answers[id]).length;
    const nothingWaiting =
      !proposals.error &&
      !proposals.loading &&
      proposalRows.length === 0 &&
      noSaleVolume.length === 0 &&
      stillUnmapped.length === 0;

    return (
      <Sheet
        open={isOpen}
        onClose={onClose}
        label="POS buttons and stock. Confirming a button writes which wine it is and how much one sale removes. Leaving writes nothing."
        eyebrow="The bridge"
        title="POS buttons and stock"
        zIndex={110}
        action={
          <button
            type="button"
            className="mdv-btn"
            onClick={() => void runMatch()}
            disabled={matching}
          >
            {matching ? "Reading…" : "Re-read the catalog"}
          </button>
        }
        footer={
          <span>
            A button with no sale size is confirmed as the right wine and still moves no stock. That
            is a supported answer, not an error.
          </span>
        }
      >
        <div className="mdv-form">
          <p className="mdv-contract">
            Two things stand between a POS button and a bottle leaving the shelf: which wine it is,
            and how much one sale removes. Both are asked on the same row. Leaving writes nothing.
          </p>

          {wrote && (
            <div className="mdv-alert" role="alert">
              <p className="mdv-alert__head">{wrote.denied ? "Not permitted" : "Not written"}</p>
              <p>
                {wrote.denied
                  ? `This account is not permitted to change the POS bridge. ${wrote.what.toLowerCase()}; every row below is as it was.`
                  : `${wrote.what} — ${wrote.message}. Every row below is as it was.`}
              </p>
            </div>
          )}

          {/* The queue, in stock and money rather than row counts. */}
          <div className="mdv-panelbox">
            <p className="mdv-alert__head">Arrived and moved no stock</p>
            {unresolved.error ? (
              <p className="mdv-hintline">
                The unresolved-line queue could not be read ({unresolved.error}). This is not a
                claim that the queue is empty.
              </p>
            ) : unresolved.loading && !summary ? (
              <p className="mdv-hintline">Reading the queue…</p>
            ) : summary ? (
              <>
                <div className="mdv-figs">
                  <span>
                    <span className="mdv-fig__n">{summary.open_lines}</span>
                    <span className="mdv-fig__l">POS lines</span>
                  </span>
                  <span>
                    <span className="mdv-fig__n">{summary.qty_total}</span>
                    <span className="mdv-fig__l">units unaccounted</span>
                  </span>
                  <span>
                    <span className="mdv-fig__n">{summary.distinct_items}</span>
                    <span className="mdv-fig__l">buttons</span>
                  </span>
                </div>
                <span className="mdv-prov">
                  Counted from the unresolved-line queue
                  {summary.truncated ? " · read capped — this is a floor, not the total" : ""}
                </span>
              </>
            ) : (
              <p className="mdv-hintline">The queue has not answered yet.</p>
            )}
          </div>

          {nothingWaiting && (
            <p className="mdv-quiet">
              Nothing is waiting. Every button the POS has sent is either mapped with a sale size or
              was answered already. &ldquo;Re-read the catalog&rdquo; pulls the current button list
              and matches it again.
            </p>
          )}

          {/* ── 1. identity and unit, in one row ── */}
          <div>
            <span className="mdv-head">
              <span>Waiting for you — {proposalRows.length}</span>
              {selected.size > 0 && (
                <button
                  type="button"
                  className="mdv-link"
                  onClick={() => void approveSelected()}
                  disabled={busy}
                >
                  {busy ? "Confirming…" : `Confirm ${selected.size}`}
                </button>
              )}
            </span>

            {proposals.error && (
              <p className="mdv-hintline">
                Match proposals could not be read ({proposals.error}) — not the same as having none.
              </p>
            )}
            {!proposals.error && proposals.loading && proposalRows.length === 0 && (
              <p className="mdv-hintline">Reading the proposals…</p>
            )}
            {!proposals.error && !proposals.loading && proposalRows.length === 0 && (
              <p className="mdv-hintline">
                No buttons are waiting on an answer from you.
              </p>
            )}

            <div className="mdv-picks">
              {proposalRows.map((p) => {
                const cand = p.candidate_inventory_id
                  ? invById.get(p.candidate_inventory_id)
                  : null;
                const a = answers[p.id];
                const bottleMl = cand?.bottleMl ?? 750;
                const pourMl = cand?.pourMl ?? null;
                return (
                  <div
                    key={p.id}
                    className="mdv-pick"
                    aria-checked={selected.has(p.id)}
                    role="group"
                    style={{ alignItems: "flex-start" }}
                  >
                    <span style={{ minWidth: 0, flex: "1 1 auto" }}>
                      <span className="mdv-pick__label" style={{ whiteSpace: "normal" }}>
                        {p.item_name}
                      </span>
                      <span className="mdv-pick__sub">{p.external_item_id}</span>
                      {cand ? (
                        /* The engine's proposal and its RAW score — never a
                           verdict dressed as one. */
                        <span className="mdv-grey">
                          proposes {cand.name} ·{" "}
                          {p.confidence != null
                            ? `${Math.round(p.confidence * 100)}%`
                            : "no score recorded"}{" "}
                          · {p.match_method}
                        </span>
                      ) : (
                        <span className="mdv-grey">
                          no inventory row matched — add the wine first
                        </span>
                      )}
                      <span style={{ display: "block", marginTop: 6 }}>
                        <span className="mdv-label">How much does one sale remove?</span>
                        <span className="mdv-seg">
                          <button
                            type="button"
                            className="mdv-seg__opt"
                            aria-pressed={a?.label === "bottle"}
                            onClick={() => setAnswer(p.id, "bottle", bottleMl)}
                          >
                            Bottle {bottleMl}ml
                          </button>
                          <button
                            type="button"
                            className="mdv-seg__opt"
                            aria-pressed={a?.label === "glass"}
                            onClick={() => setAnswer(p.id, "glass", pourMl ?? 150)}
                          >
                            Glass {pourMl ?? 150}ml
                          </button>
                          <button
                            type="button"
                            className="mdv-seg__opt"
                            onClick={() => void reject(p.id)}
                            disabled={busy}
                          >
                            Not this wine
                          </button>
                        </span>
                        {!a && (
                          <span className="mdv-hintline">
                            Unanswered. Nothing is guessed here — a size nobody chose is written as
                            absent, and the sale queues.
                          </span>
                        )}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      aria-label={`Confirm ${p.item_name}`}
                      checked={selected.has(p.id)}
                      disabled={!p.candidate_inventory_id}
                      onChange={() => toggle(p.id)}
                    />
                  </div>
                );
              })}
            </div>
            {selected.size > 0 && unanswered > 0 && (
              <p className="mdv-consequence">
                <strong>{unanswered}</strong> of the buttons you ticked have no sale size. They will
                be confirmed as the right wine, and their sales will keep queueing and move no stock
                until a size is set.
              </p>
            )}
          </div>

          {/* ── 2. identified, but nobody said how much a sale removes ── */}
          {noSaleVolume.length > 0 && (
            <div>
              <span className="mdv-head">
                <span>Identified, no sale size — {noSaleVolume.length}</span>
              </span>
              <div className="mdv-lines">
                {noSaleVolume.map((g) => {
                  const m = mappingForQueued(g);
                  return (
                    <div
                      key={`${g.source}:${g.external_item_id}:${g.item_name}`}
                      className="mdv-line"
                      data-owed="true"
                      style={{ flexWrap: "wrap" }}
                    >
                      <span className="mdv-line__name">
                        {g.item_name}
                        <span className="mdv-line__sub">
                          {g.occurrences} sale{g.occurrences !== 1 ? "s" : ""}, {g.qty_total} unit
                          {g.qty_total !== 1 ? "s" : ""} — none removed from stock
                        </span>
                      </span>
                      {m ? (
                        <span className="mdv-seg">
                          <button
                            type="button"
                            className="mdv-seg__opt"
                            onClick={() => void answerQueuedUnit(m.id, "bottle")}
                            disabled={busy}
                          >
                            One bottle
                          </button>
                          <button
                            type="button"
                            className="mdv-seg__opt"
                            onClick={() => void answerQueuedUnit(m.id, "glass")}
                            disabled={busy}
                          >
                            One glass
                          </button>
                        </span>
                      ) : (
                        <span className="mdv-line__fig">
                          {mappings.error
                            ? "mappings could not be read — no answer can be offered here"
                            : "no mapping row found for this button"}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── 3. arrived, unrecognised ── */}
          {stillUnmapped.length > 0 && (
            <div>
              <span className="mdv-head">
                <span>Not recognised — {stillUnmapped.length}</span>
              </span>
              <p className="mdv-hintline">
                These rang up and matched nothing in inventory. Food and drinks that are not wine
                belong here and are safe to ignore; a wine here needs adding to inventory first,
                then &ldquo;Re-read the catalog&rdquo;.
              </p>
              <div className="mdv-lines">
                {stillUnmapped.map((g) => (
                  <div
                    key={`${g.source}:${g.external_item_id}:${g.item_name}`}
                    className="mdv-line"
                  >
                    <span className="mdv-line__name">{g.item_name}</span>
                    <span className="mdv-line__fig">
                      <b>{g.qty_total}</b> unit{g.qty_total !== 1 ? "s" : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Sheet>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-5xl my-6"
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
                const bottleMl = cand?.bottleMl ?? 750;
                const pourMl = cand?.pourMl ?? null;
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
                      <button
                        onClick={() => setAnswer(p.id, "bottle", bottleMl)}
                        className={cn(
                          "h-7 px-2.5 rounded-md text-[11px] font-bold border",
                          a?.label === "bottle"
                            ? "border-wine-600 bg-wine-600 text-white"
                            : "border-gray-200 bg-white text-gray-600 hover:border-gray-300",
                        )}
                      >
                        Bottle {bottleMl}ml
                      </button>
                      <button
                        onClick={() => setAnswer(p.id, "glass", pourMl ?? 150)}
                        className={cn(
                          "h-7 px-2.5 rounded-md text-[11px] font-bold border",
                          a?.label === "glass"
                            ? "border-wine-600 bg-wine-600 text-white"
                            : "border-gray-200 bg-white text-gray-600 hover:border-gray-300",
                        )}
                      >
                        Glass {pourMl ?? 150}ml
                      </button>
                      <button
                        onClick={() => reject(p.id)}
                        disabled={busy}
                        className="h-7 px-2 rounded-md text-[11px] font-semibold text-gray-400 hover:text-gray-700"
                      >
                        Not this
                      </button>
                    </div>
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
                      {m ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => answerQueuedUnit(m.id, "bottle")}
                            disabled={busy}
                            className="h-7 px-2.5 rounded-md text-[11px] font-bold border border-gray-200 bg-white text-gray-600 hover:border-gray-300 disabled:opacity-50"
                          >
                            One bottle
                          </button>
                          <button
                            onClick={() => answerQueuedUnit(m.id, "glass")}
                            disabled={busy}
                            className="h-7 px-2.5 rounded-md text-[11px] font-bold border border-gray-200 bg-white text-gray-600 hover:border-gray-300 disabled:opacity-50"
                          >
                            One glass
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] font-semibold text-amber-700">
                          {mappings.error
                            ? "mappings could not be read — cannot offer an answer here"
                            : "no mapping row found for this button"}
                        </span>
                      )}
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
