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
 * THE STRUCTURE THAT ENFORCES IT — the grid is the paper's ruling.
 * ---------------------------------------------------------------
 * A report in this house is a sheet of paper with cuttings laid on it. While
 * you read, the sheet is plain: eight cuttings sit flush, no handles, no
 * chrome. Press "Arrange the sheet" and the twelve-column feint ruling fades
 * up (`settle`), every cutting takes a dashed edge and a grab cursor, and one
 * lifted under the finger rises on `tuck`. "Rule it off" writes the
 * arrangement to the reader's own preferences and presses the die dry. That
 * single toggle IS the founder's swipe-everything-into-place — and it replaces
 * the legacy page's edit mode, add-block, preset and reset toolbar (four
 * actions down to one), the KPI spotlight modal, the eight-format export menu
 * and the global 7/30/90 selector.
 *
 * The global selector is gone on purpose rather than for tidiness: only ONE of
 * these registers takes a window (`pos-revenue?days=`). The others are
 * computed over windows the server fixes — 90 days of consumption, 180 of
 * purchasing, 365 of COGS. A control that appeared to move all of them would
 * be lying about six of the seven, so the window picker lives inside the one
 * cutting it governs, and every other cutting states its own window under
 * "show the working" — in the SERVER'S basis string, not ours.
 *
 * MORE GRAPHS, ALL WITH PRODUCERS. Five plots where the legacy default sheet
 * had vendor-spend charts only: sales through the till (area), spend pacing
 * (bars), the week's shape (bars), what's coming (measured + dashed
 * projection), and margin against movement (scatter on the engine's own
 * medians). A chart with no producer is an honest sentence here, never an
 * empty axis — an empty plot frame claims the restaurant did nothing.
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
import {
  AheadCutting,
  LedgerCutting,
  PacingCutting,
  QuadrantsCutting,
  ReadingCutting,
  TillCutting,
  TillWindowPicker,
  WeekCutting,
  WritingCutting,
} from './Cuttings';
import { ensureFraunces, failureLine } from './rp-format';
import {
  BLOCK_META,
  DEFAULT_SHEET,
  REPORT_BLOCK_IDS,
  type ReportBlockId,
  type Slot,
} from './rp-sheet';
import Sheet, { type SheetCutting } from './Sheet';
import { useReportsNextData, type SheetState } from './useReportsNextData';
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
  const data = useReportsNextData(tillDays, setTillDays);
  const [arranging, setArranging] = useState(false);
  const [draft, setDraft] = useState<SheetState | null>(null);
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

  const startArranging = useCallback(() => {
    setDraft({ slots: { ...data.sheet.slots }, hidden: [...data.sheet.hidden] });
    setArranging(true);
  }, [data.sheet]);

  const ruleOff = useCallback(() => {
    if (draft) data.saveSheet(draft);
    setDraft(null);
    setArranging(false);
    setRuledOff(true);
    window.setTimeout(() => setRuledOff(false), 2400);
  }, [draft, data]);

  const putBack = useCallback(() => {
    setDraft({ slots: { ...DEFAULT_SHEET }, hidden: [] });
  }, []);

  const onMove = useCallback((slots: Partial<Record<ReportBlockId, Slot>>) => {
    setDraft((d) => (d ? { ...d, slots: { ...d.slots, ...slots } } : d));
  }, []);

  const onHide = useCallback((id: ReportBlockId) => {
    setDraft((d) => (d && !d.hidden.includes(id) ? { ...d, hidden: [...d.hidden, id] } : d));
  }, []);

  const putOn = useCallback((id: ReportBlockId) => {
    setDraft((d) => (d ? { ...d, hidden: d.hidden.filter((h) => h !== id) } : d));
  }, []);

  /** The opening sentence is the engine's loudest one, verbatim, or the truth. */
  const opening = useMemo(() => {
    if (data.reading.failure) return failureLine('insight register', data.reading.failure);
    if (data.reading.loading || !data.reading.data) return 'Reading the registers…';
    const top = data.reading.data[0];
    return top ? top.sentence : 'The engine has nothing to say about this restaurant yet.';
  }, [data.reading]);

  const bodies: Record<ReportBlockId, React.ReactNode> = {
    reading: <ReadingCutting reg={data.reading} />,
    till: <TillCutting reg={data.till} />,
    pacing: <PacingCutting reg={data.pacing} />,
    week: <WeekCutting reg={data.week} />,
    ahead: <AheadCutting reg={data.ahead} />,
    quadrants: <QuadrantsCutting reg={data.quadrants} />,
    ledger: <LedgerCutting reg={data.ledger} />,
    writing: <WritingCutting />,
  };

  const cuttings: SheetCutting[] = REPORT_BLOCK_IDS.filter((id) => !view.hidden.includes(id)).map(
    (id) => ({
      id,
      slot: view.slots[id],
      body: bodies[id],
      aside:
        id === 'till' ? <TillWindowPicker days={tillDays} onChange={setTillDays} /> : undefined,
    }),
  );

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
          <p className="rp-row" style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--ink-2)', gap: 8 }}>
            <span>Drag a cutting anywhere on the ruling; pull its corner to resize.</span>
            {view.hidden.map((id) => (
              <button
                key={id}
                type="button"
                className="rp-mini rp-ink rp-focus"
                onClick={() => putOn(id)}
              >
                Put back {BLOCK_META[id].title}
              </button>
            ))}
          </p>
        )}

        {data.restaurantId === null ? (
          <p role="status" className="rp-note">
            No restaurant is active yet, so none of these registers is addressed to anyone. Pick a
            restaurant and the sheet fills in.
          </p>
        ) : (
          <Sheet cuttings={cuttings} arranging={arranging} onMove={onMove} onHide={onHide} />
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
