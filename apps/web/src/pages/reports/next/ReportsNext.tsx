/**
 * ReportsNext — the Mudavym redesign of `/reports`, behind
 * `mudavym_design_reports` (ADR 0044 p4 wave). Verdict: **MERGE**.
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
import { Seal, Wordmark } from '@/components/mudavym';
import { animate, settle } from '@/lib/mudavym';
import AskTheBook from './AskTheBook';
import Cutting from './Cutting';
import { CATALOGUE, defaultGraph } from './rp-catalogue';
import { ensureFraunces, failureLine } from './rp-format';
import {
  ANALYSIS_IDS,
  DEFAULT_SLOTS,
  type AnalysisId,
  type GraphType,
  type SheetState,
  type Slot,
} from './rp-sheet';
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
}: {
  children: React.ReactNode;
  onClick: () => void;
  strong?: boolean;
}) {
  return (
    <button type="button" className="rp-btn rp-ink rp-focus" data-strong={strong} onClick={onClick}>
      {children}
    </button>
  );
}

export default function ReportsNext({ ground }: ReportsNextProps) {
  const [tillDays, setTillDays] = useState(30);
  const [arranging, setArranging] = useState(false);
  const [draft, setDraft] = useState<SheetState | null>(null);
  // The fetch follows what is ON SCREEN, draft included: a cutting swapped to
  // another analysis reads it immediately, rather than shimmering until the
  // sheet is ruled off. You cannot choose an analysis you cannot see.
  const showing = useMemo(() => (draft ? draft.cuttings.map((c) => c.id) : null), [draft]);
  const data = useReportsNextData(tillDays, setTillDays, showing);
  const [asking, setAsking] = useState(false);
  const [ruledOff, setRuledOff] = useState(false);
  const headRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    ensureFraunces();
  }, []);

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

  const startArranging = useCallback(() => {
    setDraft({ cuttings: data.sheet.cuttings.map((c) => ({ ...c, slot: { ...c.slot } })) });
    setArranging(true);
  }, [data.sheet]);

  const ruleOff = useCallback(() => {
    if (draft) data.saveSheet(draft);
    setDraft(null);
    setArranging(false);
    setRuledOff(true);
    window.setTimeout(() => setRuledOff(false), 2400);
  }, [draft, data]);

  const putBack = useCallback(() => setDraft(defaultSheet()), []);

  const edit = useCallback(
    (fn: (s: SheetState) => SheetState) => setDraft((d) => (d ? fn(d) : d)),
    [],
  );

  const onMove = useCallback(
    (slots: Partial<Record<AnalysisId, Slot>>) =>
      edit((d) => ({
        cuttings: d.cuttings.map((c) => (slots[c.id] ? { ...c, slot: slots[c.id] as Slot } : c)),
      })),
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

  /** Change of subject, same square of paper: the slot is kept, the drawing
   *  resets to the new analysis's own default because the old one may not be
   *  true of the new data. */
  const onSwap = useCallback(
    (from: AnalysisId, to: AnalysisId) =>
      edit((d) =>
        from === to || d.cuttings.some((c) => c.id === to)
          ? d
          : {
              cuttings: d.cuttings.map((c) =>
                c.id === from ? { id: to, slot: c.slot, graph: defaultGraph(to) } : c,
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

  const ctx = useMemo(() => ({ days: tillDays }), [tillDays]);

  const cuttings: SheetCutting[] = view.cuttings.map((c) => ({
    id: c.id,
    slot: c.slot,
    body: (
      <Cutting
        id={c.id}
        graph={c.graph}
        register={data.registers[c.id]}
        ctx={ctx}
        arranging={arranging}
        swapOptions={swapOptions}
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
          </div>

          <div className="rp-row" style={{ gap: 8 }}>
            {ruledOff && (
              <span className="rp-stamp" role="status">
                {/* The die pressed DRY — no wax. Arranging your own sheet is
                    routine; wax is reserved for committing to someone else. */}
                <Seal size={18} pressed color="var(--paper-2)" />
                Ruled off.
              </span>
            )}
            <Action onClick={() => setAsking(true)}>Ask the book ⌘K</Action>
            {arranging ? (
              <>
                <Action onClick={putBack}>Put it all back</Action>
                <Action strong onClick={ruleOff}>
                  Rule it off
                </Action>
              </>
            ) : (
              <Action onClick={startArranging}>Arrange the sheet</Action>
            )}
          </div>
        </header>

        <hr className="rp-rule" style={{ marginBottom: 16 }} />

        {arranging && (
          <div className="rp-arrange">
            <p className="rp-note" style={{ margin: 0 }}>
              Drag a cutting anywhere on the ruling; pull its corner to resize. Each one can change
              what it shows and how it is drawn — a drawing is only offered where it is true of that
              register.
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

        {data.restaurantId === null ? (
          <p role="status" className="rp-note">
            No restaurant is active yet, so none of these registers is addressed to anyone. Pick a
            restaurant and the sheet fills in.
          </p>
        ) : view.cuttings.length === 0 ? (
          <p role="status" className="rp-note">
            Every cutting has been taken off this sheet. Nothing is being read — press “Arrange the
            sheet” and add one back.
          </p>
        ) : (
          <Sheet cuttings={cuttings} arranging={arranging} onMove={onMove} />
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

      <AskTheBook open={asking} onClose={() => setAsking(false)} reading={data.reading} />
    </div>
  );
}
