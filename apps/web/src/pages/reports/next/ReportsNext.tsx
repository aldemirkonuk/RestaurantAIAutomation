/**
 * ReportsNext — the Mudavym redesign of `/reports` (ADR 0044 p4 wave).
 * Verdict: **MERGE**. Live in code for every house since ADR 0149 row 36
 * (2026-09-17) — `mudavym_design_reports` is no longer read.
 *
 *   "Used to like today's drag-to-rearrange canvas — where we can just swipe
 *    and change everything to its place." The new version is "more modern."
 *    Wants: some blocks moved, some actions removed, more graphs, and "more
 *    focus on the insights plus the reports part." Be more creative here.
 *                          — MAKEOVER-VERDICTS.md:177-181, `/reports`
 *
 * Second pass, after the founder read the first one (2026-09-03):
 *
 *   "…we still need to have those functionality and flexibility, especially
 *    different type of graphs — some people might need lines, some bar charts,
 *    some heat maps… we should ask them either to change the type of graph or
 *    to change the graph or the data analysis itself… are we still able to drag
 *    and drop, or now it's fixed locations? If it's drag and drop and we can
 *    still adjust it, then it's perfect."
 *
 * THE STRUCTURE THAT ENFORCES IT — the grid is the paper's ruling, and a
 * cutting is a QUESTION, not a chart.
 * ---------------------------------------------------------------------------
 * A report in this house is a sheet of paper with cuttings laid on it. While
 * you read, the sheet is plain: the cuttings sit flush, no handles, no chrome,
 * each with its window printed under its title. Press "Arrange the sheet" and
 * the twelve-column feint ruling fades up (`settle`), every cutting takes a
 * dashed edge and a grab cursor, one lifted under the finger rises on `tuck` —
 * and each cutting grows two questions: **Show instead** (which of the eleven
 * catalogued analyses occupies this square) and **Draw as** (which of the
 * drawings that are TRUE of that analysis it takes). "Rule it off" writes the
 * whole arrangement — positions, sizes, subjects and drawings — to the reader's
 * own preferences and presses the die dry.
 *
 * Drag and resize are untouched by all of it (`Sheet.tsx`): move by dragging
 * anywhere on a cutting, resize from the bottom-right corner, both live only
 * while arranging, both persisted.
 *
 * The global 7/30/90 selector is still gone on purpose rather than for
 * tidiness: only ONE catalogued register takes a window (`pos-revenue?days=`).
 * The others are computed over windows the server fixes — 90 days of
 * consumption, 180 of purchasing, 365 of COGS, 120 of forecast history. A
 * control that appeared to move all of them would be lying about ten of the
 * eleven, so the window picker lives inside the one cutting it governs, and
 * every other cutting prints its own window under its title.
 *
 * Both grounds ship: paper by default, Warm Charcoal under `.dark .mudavym` or
 * an explicit `ground="charcoal"` (ADR 0042). The root carries `.mudavym`
 * itself so the page stands alone in tests and sandboxes — see PageGate's
 * header for why the ground lives on the page and not on the gate.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Seal, Wordmark } from '@/components/mudavym';
import { animate, settle } from '@/lib/mudavym';
import AskTheBook from './AskTheBook';
import Cutting from './Cutting';
import { ArrangeAnnouncer, ArrangeHelp } from './Placing';
import { useArrange } from './rp-arrange';
import { CATALOGUE, defaultGraph } from './rp-catalogue';
import { READING, failureLine, type MoneyIn } from './rp-format';
import {
  ANALYSIS_IDS,
  DEFAULT_SLOTS,
  HOUSE_LAYOUT_CUTTINGS,
  HOUSE_LAYOUT_IDS,
  HOUSE_LAYOUT_NOTE,
  HOUSE_LAYOUT_TITLE,
  packSlots,
  swapSlot,
  type AnalysisId,
  type Cutting as SheetSlotCutting,
  type GraphType,
  type HouseLayoutId,
  type SheetState,
  type Slot,
} from './rp-sheet';
import type { ComboPick } from './rp-combo';
import ExportsShelf from './ExportsShelf';
import Sheet, { type SheetCutting } from './Sheet';
import { defaultSheet, useReportsNextData } from './useReportsNextData';
import './reports-next.css';

export interface ReportsNextProps {
  /** Force the Warm Charcoal ground regardless of app theme (ADR 0042). */
  ground?: 'charcoal';
}

/** The page's whole action vocabulary: four buttons, down from the legacy
 *  page's edit mode + add block + preset + reset + spotlight + export menu. */
function Action({
  children,
  onClick,
  strong,
  tour,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  strong?: boolean;
  /** The page tour's anchor (guidance/content/reports.ts). */
  tour?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="rp-btn rp-ink rp-focus"
      data-strong={strong}
      data-tour={tour}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function ReportsNext({ ground }: ReportsNextProps) {
  const [tillDays, setTillDays] = useState(30);
  // A bars-and-line pick made before the reader's own sheet is known: shown
  // for this visit, never written (a write then could put the house sheet
  // over theirs). Once the sheet is known the pick lives on the sheet itself.
  const [comboHeld, setComboHeld] = useState<Partial<Record<AnalysisId, ComboPick>>>({});
  const [arranging, setArranging] = useState(false);
  const [draft, setDraft] = useState<SheetState | null>(null);
  // The fetch follows what is ON SCREEN, draft included: a cutting swapped to
  // another analysis reads it immediately, rather than shimmering until the
  // sheet is ruled off. You cannot choose an analysis you cannot see.
  const showing = useMemo(() => (draft ? draft.cuttings.map((c) => c.id) : null), [draft]);
  // The desk's "put it on the sheet" needs the draft, and the draft's placer
  // needs the desk — so the page hands the data layer a STABLE callback that
  // forwards to whatever `placeProposed` is this render. One seam, no cycle.
  const placeRef = useRef<(cut: { id: AnalysisId; graph: GraphType; days: number | null }) => void>(
    () => {},
  );
  const place = useCallback(
    (cut: { id: AnalysisId; graph: GraphType; days: number | null }) => placeRef.current(cut),
    [],
  );
  const data = useReportsNextData(tillDays, setTillDays, showing, place);
  const [asking, setAsking] = useState(false);
  const [ruledOff, setRuledOff] = useState(false);
  /* Ruling off is a WRITE to the reader's preferences, so the page says it is
     ruling off until the gateway answers, and says "Ruled off." only after it
     did. While it is in flight the paper is held still (`editing` below): an
     edit made then would be dropped with the draft when the save lands. */
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  /* One stamp timer, restarted by every rule-off and cleared on the way out —
     two stray timers would hide the second stamp 2.4 s after the FIRST. */
  const stampTimer = useRef<number | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (stampTimer.current !== null) window.clearTimeout(stampTimer.current);
      stampTimer.current = null;
    };
  }, []);
  const headRef = useRef<HTMLElement | null>(null);

  /* One quiet entrance for the opening line — settle, 6px, once. */
  useEffect(() => {
    if (headRef.current) {
      animate(
        headRef.current,
        [
          { opacity: 0, transform: 'translateY(6px)' },
          { opacity: 1, transform: 'none' },
        ],
        { easing: settle.easing, ms: 420 },
      );
    }
  }, []);

  /* ⌘K / Ctrl-K opens the palette. Escape is handled inside it. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setAsking((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const view = draft ?? data.sheet;
  const onSheet = useMemo(() => new Set(view.cuttings.map((c) => c.id)), [view]);

  /* Arranging the HOUSE sheet while the reader's own is still being read —
     or could not be read — and ruling it off would write the house sheet over
     theirs. So the paper only opens once the sheet is known. */
  const startArranging = useCallback(() => {
    if (!data.sheetKnown) return;
    setSaveFailed(false);
    setDraft({ cuttings: data.sheet.cuttings.map((c) => ({ ...c, slot: { ...c.slot } })) });
    setArranging(true);
  }, [data.sheet, data.sheetKnown]);

  const ruleOff = useCallback(async () => {
    if (saving) return;
    if (!draft) {
      setArranging(false);
      return;
    }
    setSaving(true);
    setSaveFailed(false);
    try {
      await data.saveSheet(draft);
    } catch {
      // The draft and the arranging stay exactly as they were, so "Try again"
      // is one press of the same button. No stamp: nothing was ruled off.
      if (!alive.current) return;
      setSaving(false);
      setSaveFailed(true);
      return;
    }
    if (!alive.current) return;
    setSaving(false);
    setDraft(null);
    setArranging(false);
    setRuledOff(true);
    if (stampTimer.current !== null) window.clearTimeout(stampTimer.current);
    stampTimer.current = window.setTimeout(() => {
      stampTimer.current = null;
      setRuledOff(false);
    }, 2400);
  }, [draft, data, saving]);

  /** The paper takes edits only while it is being arranged and not being saved. */
  const editing = arranging && !saving;

  const putBack = useCallback(() => setDraft(defaultSheet()), []);

  const edit = useCallback(
    (fn: (s: SheetState) => SheetState) => setDraft((d) => (d ? fn(d) : d)),
    [],
  );

  /* Which measure is the bars and which the line is part of how the reader
     set this sheet, like its drawing, so it is saved with it (it was page
     state, and a reload put every cutting back to its default pair). While
     arranging it goes into the draft and is saved on rule-off; while reading
     it is written at once, and a refused write says so (the preferences hook
     rolls the pick back). */
  const onComboPick = useCallback(
    (id: AnalysisId, pick: ComboPick) => {
      const withPick = (s: SheetState): SheetState => ({
        cuttings: s.cuttings.map((c) => (c.id === id ? { ...c, combo: pick } : c)),
      });
      if (saving) return;
      if (draft) {
        edit(withPick);
        return;
      }
      if (!data.sheetKnown) {
        setComboHeld((all) => ({ ...all, [id]: pick }));
        return;
      }
      setSaveFailed(false);
      data.saveSheet(withPick(data.sheet)).catch(() => {
        if (alive.current) setSaveFailed(true);
      });
    },
    [saving, draft, edit, data],
  );

  /* ── the keyboard's half of the canvas ──────────────────────────────────
     `useArrange` writes THIS draft — the same state react-grid-layout is
     handed as its `layouts` prop, and the same state `onMove` writes when a
     pointer finishes a drag. One layout, two ways in. */
  const sheetEl = useRef<HTMLElement | null>(null);
  const applyCuttings = useCallback(
    (next: SheetSlotCutting[]) => setDraft((d) => (d ? { cuttings: next } : d)),
    [],
  );
  const arrange = useArrange({
    cuttings: draft?.cuttings ?? null,
    apply: applyCuttings,
    sheetRef: sheetEl,
    arranging: editing,
  });
  const holdSheetEl = useCallback((node: HTMLDivElement | null) => {
    sheetEl.current = node;
  }, []);

  /**
   * A named house layout — DESIGN-FOUNDATION §6's *"a house layout, not an
   * empty one"*, and the founder's *"editable for personalized screens"*: it
   * writes the DRAFT, so it is a starting point you then edit. Nothing is
   * saved until the sheet is ruled off.
   */
  const applyHouseLayout = useCallback(
    (which: HouseLayoutId) => {
      const ids = HOUSE_LAYOUT_CUTTINGS[which];
      const slots = packSlots(ids);
      setDraft({
        cuttings: ids.map((id) => ({ id, slot: slots[id], graph: defaultGraph(id) })),
      });
      setArranging(true);
    },
    [],
  );

  const onMove = useCallback(
    (slots: Partial<Record<AnalysisId, Slot>>, order?: AnalysisId[]) =>
      edit((d) => {
        const moved = d.cuttings.map((c) =>
          slots[c.id] ? { ...c, slot: slots[c.id] as Slot } : c,
        );
        if (!order) return { cuttings: moved };
        // A narrow ruling draws row-mates in list order, so a drag there that
        // changes who comes first is a change of list order (`liftCuttings`).
        const rank = new Map(order.map((id, i) => [id, i]));
        const last = order.length;
        return {
          cuttings: [...moved].sort(
            (a, b) => (rank.get(a.id) ?? last) - (rank.get(b.id) ?? last),
          ),
        };
      }),
    [edit],
  );

  const onRemove = useCallback(
    (id: AnalysisId) => edit((d) => ({ cuttings: d.cuttings.filter((c) => c.id !== id) })),
    [edit],
  );

  /** A cutting put back on lands at the foot of the sheet, full-width-ish, so
   *  it never appears under something the reader is already looking at. */
  const onAdd = useCallback(
    (id: AnalysisId) =>
      edit((d) => {
        if (d.cuttings.some((c) => c.id === id)) return d;
        const foot = d.cuttings.reduce((m, c) => Math.max(m, c.slot.y + c.slot.h), 0);
        return {
          cuttings: [
            ...d.cuttings,
            { id, slot: { ...DEFAULT_SLOTS[id], x: 0, y: foot }, graph: defaultGraph(id) },
          ],
        };
      }),
    [edit],
  );

  /** Change of subject, same square of paper: the position is kept, the drawing
   *  resets to the new analysis's own default because the old one may not be
   *  true of the new data, and the square grows to the new analysis's declared
   *  size if it is smaller (`swapSlot`) so the new subject is not crushed. */
  const onSwap = useCallback(
    (from: AnalysisId, to: AnalysisId) =>
      edit((d) =>
        from === to || d.cuttings.some((c) => c.id === to)
          ? d
          : {
              cuttings: d.cuttings.map((c) =>
                c.id === from ? { id: to, slot: swapSlot(c.slot, to), graph: defaultGraph(to) } : c,
              ),
            },
      ),
    [edit],
  );

  const onGraph = useCallback(
    (id: AnalysisId, graph: GraphType) =>
      edit((d) => ({ cuttings: d.cuttings.map((c) => (c.id === id ? { ...c, graph } : c)) })),
    [edit],
  );

  /** The engine's loudest sentence, verbatim, or the truth about its absence. */
  const opening = useMemo(() => {
    if (data.reading.failure) return failureLine('insight register', data.reading.failure);
    if (data.reading.loading || !data.reading.data) return 'Reading the registers…';
    const top = data.reading.data[0];
    return top ? top.sentence : 'The engine has nothing to say about this restaurant yet.';
  }, [data.reading]);

  const swapOptions = useMemo(
    () => ANALYSIS_IDS.map((id) => ({ id, taken: onSheet.has(id) })),
    [onSheet],
  );

  /**
   * Put a cutting the goals desk proposed onto the sheet, and open arranging so
   * the reader lands looking at it with the controls in reach. It writes the
   * draft like every other change: the assistant's proposal is never saved
   * behind the reader's back — "Rule it off" is still what commits it.
   */
  const placeProposed = useCallback(
    (cut: { id: AnalysisId; graph: GraphType; days: number | null }) => {
      // Same rule as "Arrange the sheet": no draft is built on a sheet that is
      // not the reader's. The desk's button lives inside a cutting, and no
      // cutting is drawn until the sheet is known; when it could not be read,
      // the page already says arranging is off.
      if (!data.sheetKnown) return;
      // The paper is held still while the sheet is being saved; the desk's
      // button is disabled then, and this keeps any other caller honest.
      if (saving) return;
      if (cut.days !== null) setTillDays(cut.days);
      setDraft((d) => {
        const base = d ?? { cuttings: data.sheet.cuttings.map((c) => ({ ...c, slot: { ...c.slot } })) };
        if (base.cuttings.some((c) => c.id === cut.id))
          return {
            cuttings: base.cuttings.map((c) => (c.id === cut.id ? { ...c, graph: cut.graph } : c)),
          };
        const foot = base.cuttings.reduce((m, c) => Math.max(m, c.slot.y + c.slot.h), 0);
        return {
          cuttings: [
            ...base.cuttings,
            { id: cut.id, slot: { ...DEFAULT_SLOTS[cut.id], x: 0, y: foot }, graph: cut.graph },
          ],
        };
      });
      setArranging(true);
    },
    [data.sheet, data.sheetKnown, saving],
  );
  placeRef.current = placeProposed;

  // While the house's currency is still being read every money figure is the
  // dash: never a `$`, and never a bare number that becomes "₺4,210" a moment
  // later (r7, 2026-11-12; the dashboard's rule, #1181).
  const currencyMark: MoneyIn =
    data.currency?.state === 'stated'
      ? data.currency.code
      : data.currency?.state === 'unread' && data.currency.pending
        ? READING
        : null;
  const ctx = useMemo(
    () => ({
      days: tillDays,
      goals: { ...data.goalsDesk, placeBlocked: saving },
      currency: currencyMark,
    }),
    [data.goalsDesk, tillDays, currencyMark, saving],
  );
  // Said once for the whole sheet, never beside each figure (audit G5).
  const moneyLine =
    data.currency?.state === 'unstated'
      ? 'This house has not recorded its currency, so money is printed as plain numbers.'
      : data.currency?.state === 'unread' && !data.currency.pending
        ? 'The house’s currency could not be read, so money is printed as plain numbers.'
        : null;

  const cuttings: SheetCutting[] = view.cuttings.map((c) => ({
    id: c.id,
    slot: c.slot,
    body: (
      <Cutting
        id={c.id}
        graph={c.graph}
        register={data.registers[c.id]}
        ctx={ctx}
        arranging={editing}
        swapOptions={swapOptions}
        arrange={arrange}
        comboPick={data.sheetKnown ? c.combo : comboHeld[c.id]}
        onComboPick={(p) => onComboPick(c.id, p)}
        onGraph={(g) => onGraph(c.id, g)}
        onSwap={(to) => onSwap(c.id, to)}
        onRemove={() => onRemove(c.id)}
        onDays={setTillDays}
      />
    ),
  }));

  const offSheet = ANALYSIS_IDS.filter((id) => !onSheet.has(id));

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="mudavym rp-page" data-ground={ground}>
      <div className="rp-page__inner">
        <header ref={headRef} className="rp-head">
          <div style={{ maxWidth: 660 }}>
            <Wordmark size={13} />
            <p className="rp-eyebrow" style={{ display: 'block', margin: '6px 0 0' }}>
              Reports · {today}
            </p>
            <h1 className="rp-title">
              What the books say<span>.</span>
            </h1>
            {/* Fraunces speaks only what the ENGINE said — verbatim, or the truth
                about why it said nothing. This page never writes a sentence. */}
            <p className="rp-voice">{opening}</p>
            {moneyLine && (
              <p className="rp-cap" data-testid="rp-money-line">
                {moneyLine}{' '}
                {data.currency?.state === 'unstated' && (
                  <Link to="/settings?tab=currency" className="rp-link rp-ink rp-focus">
                    Record it in Settings
                  </Link>
                )}
              </p>
            )}
          </div>

          <div className="rp-row" style={{ gap: 8 }}>
            {saveFailed && (
              <span className="rp-note" role="alert">
                The sheet was not saved. Try again.
              </span>
            )}
            {ruledOff && (
              <span className="rp-stamp" role="status">
                {/* The die pressed DRY — no wax. Arranging your own sheet is
                    routine; wax is reserved for committing to someone else. */}
                <Seal size={18} pressed color="var(--paper-2)" />
                Ruled off.
              </span>
            )}
            <Action tour="reports-ask" onClick={() => setAsking(true)}>Ask the book ⌘K</Action>
            {arranging ? (
              <>
                <Action onClick={putBack} disabled={saving}>
                  Put it all back
                </Action>
                <Action strong onClick={() => void ruleOff()} disabled={saving}>
                  {saving ? 'Ruling off…' : 'Rule it off'}
                </Action>
              </>
            ) : (
              <Action tour="reports-arrange" onClick={startArranging} disabled={!data.sheetKnown}>
                Arrange the sheet
              </Action>
            )}
          </div>
        </header>

        <hr className="rp-rule" style={{ marginBottom: 16 }} />

        {editing && (
          <div className="rp-arrange">
            <p className="rp-note" style={{ margin: 0 }}>
              Drag a cutting anywhere on the ruling; pull its corner to resize. Each one can change
              what it shows and how it is drawn — a drawing is only offered where it is true of that
              register.
            </p>
            {/* The keyboard sentence lives in ArrangeHelp and nowhere else: it is
                what every grip's `aria-describedby` points at, so saying it twice
                would read it twice to the reader who most needs it once. */}
            <ArrangeHelp />
            <p className="rp-row" style={{ margin: 0 }}>
              <span className="rp-eyebrow">Start from a house layout</span>
              {HOUSE_LAYOUT_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="rp-mini rp-ink rp-focus"
                  title={HOUSE_LAYOUT_NOTE[id]}
                  onClick={() => applyHouseLayout(id)}
                >
                  {HOUSE_LAYOUT_TITLE[id]}
                </button>
              ))}
            </p>
            {offSheet.length > 0 && (
              <p className="rp-row" style={{ margin: 0 }}>
                <span className="rp-eyebrow">Add a cutting</span>
                {offSheet.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="rp-mini rp-ink rp-focus"
                    onClick={() => onAdd(id)}
                  >
                    {CATALOGUE[id].title}
                  </button>
                ))}
              </p>
            )}
          </div>
        )}

        {data.sheetUnread && data.restaurantId !== null && (
          <p role="status" className="rp-note" style={{ marginBottom: 12 }}>
            {data.sheetUnread}
          </p>
        )}

        {data.sheetStale && data.restaurantId !== null && (
          <p role="status" className="rp-note" style={{ marginBottom: 12 }}>
            {data.sheetStale}
          </p>
        )}

        {data.restaurantId === null ? (
          <p role="status" className="rp-note">
            No restaurant is active yet, so none of these registers is addressed to anyone. Pick a
            restaurant and the sheet fills in.
          </p>
        ) : !data.sheetKnown && !data.sheetUnread ? (
          /* The reader's own arrangement is still on its way. Plain paper, not
             the house sheet: drawing the house sheet first and then swapping it
             for theirs is a layout jump, and arranging it would save it over
             theirs. The reads behind the sheet are already in flight. */
          <div className="rp-outlines" role="status">
            <span className="rp-sr-only">Reading how you arranged this sheet…</span>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rp-outline" aria-hidden />
            ))}
          </div>
        ) : view.cuttings.length === 0 ? (
          <p role="status" className="rp-note">
            Every cutting has been taken off this sheet. Nothing is being read — press “Arrange the
            sheet” and add one back.
          </p>
        ) : (
          <Sheet
            cuttings={cuttings}
            arranging={editing}
            onMove={onMove}
            containerRef={holdSheetEl}
            ghost={arrange.origin}
          />
        )}

        {/* OD-81: the written-up cuttings. Not while arranging — a layout in
            progress is not yet what the reader is exporting. */}
        {data.restaurantId !== null && !arranging && (
          <ExportsShelf
            desk={data.exportDesk}
            onSheet={view.cuttings.map((c) => c.id)}
            tillDays={tillDays}
          />
        )}

        <footer className="rp-foot">
          <Wordmark size={13} />
          <p>
            Spend is money paid to vendors; “through the till” is money taken from guests. This
            sheet never adds one to the other, and it prints an em dash wherever the engine could
            not compute a figure.
          </p>
        </footer>
      </div>

      {/* One live region for the whole sheet. It reports the position the
          RULING gave, never the one that was asked for — see `rp-arrange.ts`. */}
      <ArrangeAnnouncer message={arrange.message} />

      <AskTheBook open={asking} onClose={() => setAsking(false)} reading={data.reading} />
    </div>
  );
}
