/**
 * LogsNext — the Mudavym redesign of `/logs`, behind `mudavym_design_logs`
 * (ADR 0133, the new-pages wave).
 *
 * The founder's verdict, verbatim (MAKEOVER-VERDICTS.md): KEEP — *"That's
 * fine, the new version. I like it."*
 *
 * WHAT IT IS. The house's ledger of what happened, across six registers: the
 * till, the agents, the stock ledger, the paper that arrived, the audit trail
 * and — along a thread — the platform's event store. Read-only; it writes
 * nothing. Its one act is the pivot: any correlation id on the page turns the
 * feed into a thread, and a thread reads like a ledger page — one
 * correlation, its entries in order, ruled off under a double rule.
 *
 * WHAT IT KEEPS FROM ADR 0086, every clause: a register that could not be
 * read is NAMED and shows an em dash, never a count; a register that was not
 * read for this view says so; an undated row prints "not recorded", never
 * "Invalid Date"; a whole-request failure is a failure, not a quiet house;
 * and a gateway that sends neither field makes the page claim nothing.
 *
 * WHAT IT ADDS, the two things the page doc said it lacked (§9):
 *
 *   1. THE WINDOW IS MARKED. "The first 100" is printed as a floor, every
 *      register count carries `≥` while rows remain beyond the window, and the
 *      cap is declared in `LOGS_SERVER_WINDOWS` under
 *      `scripts/check_windowed_figures.py`. The gateway now says whether more
 *      exists, exactly, and the page walks it a page at a time.
 *   2. THE TIMELINE HAS A WAY OUT. A row's register decides where it leads —
 *      the document, the receipts, the stock ledger, the till log, the orders
 *      — and a register with no page of its own says so in words. Never a dead
 *      control.
 *
 * WHAT THE 2026-09-12 PASS ADDED, and what it FIXED. The additions are the
 * house key map (`j`/`k`/`Enter`/`f`/`/`/`Esc`, modelled on the notifications
 * book), Earlier/Later stepping inside the entry sheet, sticky day headings,
 * and a struck mark for a register that did not answer. The fixes matter more,
 * and each was a thing the page got WRONG rather than merely lacked:
 *
 *   - the row declared three grid tracks below 720px and rendered four
 *     children, so its way-out control landed in the 74px clock track on every
 *     phone. `.lg-tail` is now an explicit cell that rules off across the row;
 *   - `lg-turn` depended on `correlationId` alone, so the page's one signature
 *     motion played on the LOADING SKELETON and the thread it was written for
 *     arrived with no motion at all. It now fires on the reading that landed;
 *   - the register tally read "Read 4 of 6 registers" and named nobody: a
 *     FAILED register is in `sourcesQueried`, so it never reached the `skipped`
 *     set the sentence was built from. It names both kinds now, separately;
 *   - `--ink-3` carried the mono eyebrows at 4.37:1 under a header comment
 *     claiming it had been "measured to hold". See the PAGE_CSS note;
 *   - every register cell drew the em dash while the first page was in flight,
 *     which `MOTIONS.md` had always forbidden in as many words. A cell still
 *     being asked draws a static bar; the dash kept its one meaning.
 *
 * Overlays: one, the entry sheet (`EventSheet.tsx`, Sheet 440). The thread
 * is not an overlay; it is the page, turned.
 *
 * Motions: `MOTIONS.md` in this directory, mirrored in 06-pages/logs.md §1b.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Wordmark } from '@/components/mudavym';
import { useAuth } from '@/contexts/AuthContext';
import { animate, ink, settle, springs, tally, turn, useReducedMotion } from '@/lib/mudavym/motion';
import { useMudavymDesign } from '@/lib/mudavym/useMudavymDesign';
import { EventSheet } from './EventSheet';
import {
  EM,
  GE,
  MONO,
  SANS,
  SERIF,
  describeOf,
  displaySources,
  ensureFraunces,
  fmtClock,
  fmtStamp,
  groupByDay,
  labelOf,
  linkOutFor,
  listSources,
  nameOf,
  orderForThread,
  threadSpan,
  word,
  type LinkContext,
  type TimelineEvent,
} from './lg-format';
import { LOGS_SERVER_WINDOWS, useLogsNextData, type LogsNextData } from './useLogsNextData';

/* ── figures arrive on the tally spring; an unknown never counts ────────── */

function tallyAt(t: number): number {
  const s = springs.tally.samples;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const pos = t * (s.length - 1);
  const i = Math.floor(pos);
  return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * (pos - i);
}

function Tally({ value, floor, pending }: { value: number | null; floor: boolean; pending?: boolean }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<number | null>(value);
  const from = useRef<number | null>(null);
  const raf = useRef(0);

  useEffect(() => {
    cancelAnimationFrame(raf.current);
    if (value === null) {
      from.current = null;
      setShown(null);
      return;
    }
    const start = from.current ?? 0;
    from.current = value;
    if (reduced || start === value) {
      setShown(value);
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const p = tallyAt((now - t0) / tally.ms);
      setShown(start + (value - start) * p);
      if (p < 1) raf.current = requestAnimationFrame(step);
      else setShown(value);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, reduced]);

  // A REGISTER STILL BEING ASKED IS NOT A REGISTER THAT ANSWERED NOTHING, and
  // this page's own MOTIONS.md says so in as many words: "A skeleton means 'the
  // first page is in flight'; a dash means 'asked, and there is no answer'.
  // They are never the same element." Every cell used to print the dash while
  // the first page was in flight, which made the two the same element for the
  // whole of the load. The bar is static — a pulse would assert progress the
  // page cannot measure.
  if (pending) return <span className="lg-figure lg-figure--wait" aria-hidden />;
  if (shown === null) return <span className="lg-figure">{EM}</span>;
  return (
    <span className="lg-figure">
      {floor ? <span className="lg-figure__floor">{GE} </span> : null}
      {String(Math.round(shown))}
    </span>
  );
}

/**
 * The page's only stylesheet. Durations and easings are interpolated FROM the
 * tokens, so what runs on screen is the token and not a copy of it.
 *
 * EVERY piece of secondary text on this page is `--ink-4`. Re-measured
 * 2026-09-12 with the WCAG relative-luminance formula against the tokens in
 * `styles/mudavym.css`, and quoted here to three figures because a contrast
 * ratio rounded in prose is the kind of number that rots:
 *
 *     --ink-4 #665D50 on --paper-0 #FAF7F1 (light)     6.05 : 1
 *     --ink-4 #665D50 on --paper-1 #F3EFE6 (light)     5.64 : 1   (cell ground)
 *     --ink-4 #ABA294 on --paper-0 #15130F (charcoal)  7.36 : 1
 *     --ink-4 #ABA294 on --paper-1 #1D1813 (charcoal)  6.98 : 1   (cell ground)
 *
 * This header used to say `--ink-3` "is kept for the mono eyebrows at 9–10px
 * bold where it was measured to hold". That sentence was false twice over, and
 * both halves are worth naming because the second was missed on the first fix:
 *
 *   1. `--ink-3` #7C7365 on #FAF7F1 is **4.37:1** — under the 4.5:1 floor. The
 *      large-text exemption starts at 18.66px bold, not 9.5px, so the "9–10px
 *      bold" clause was the reason it failed, not the reason it passed.
 *   2. The charcoal figure it quoted for `--ink-4`, 7.46:1, was **7.36:1**. A
 *      number nobody re-measured, carried forward in a comment whose whole job
 *      was to justify a colour.
 *
 * Both read as measurements because they named one, which is the shape this
 * page exists to refuse. `--ink-3` is now used nowhere here: the day headings,
 * the register marks, the "Ruled off" line and the sheet's field labels are all
 * `--ink-4`.
 */
const PAGE_CSS = `
.mudavym .lg-root { min-height: 100vh; background: var(--paper-0); color: var(--ink-1); font-family: ${SANS}; }
.mudavym .lg-wrap { max-width: 1040px; margin: 0 auto; padding: 26px 18px 72px; }
.mudavym .lg-ink, .mudavym .lg-ink * { transition: border-color ${ink.ms}ms ${ink.easing}, background-color ${ink.ms}ms ${ink.easing}, color ${ink.ms}ms ${ink.easing}, opacity ${ink.ms}ms ${ink.easing}; }
.mudavym .lg-rule { border-top: 1px solid var(--ink-1); border-bottom: 1px solid var(--ink-1); height: 3px; opacity: 0.5; margin: 16px 0 18px; }
.mudavym .lg-eyebrow { font-family: ${MONO}; font-size: 9.5px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-4); margin: 0; }
.mudavym .lg-eyebrow--seal { color: var(--seal-deep); }
.mudavym .lg-strip { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin: 0 0 18px; padding: 0; list-style: none; }
@media (min-width: 720px) { .mudavym .lg-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (min-width: 980px) { .mudavym .lg-strip { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
.mudavym .lg-cell { display: block; width: 100%; text-align: left; padding: 9px 11px 8px; border: 0; border-left: 2px solid transparent; border-radius: 8px; background: var(--paper-1); color: var(--ink-1); cursor: pointer; font: inherit; }
.mudavym .lg-cell:hover { background: var(--paper-2); }
.mudavym .lg-cell[aria-pressed="true"] { border-left-color: var(--seal); background: var(--seal-tint); }
.mudavym .lg-cell[aria-disabled="true"] { cursor: default; opacity: 0.72; }
.mudavym .lg-cell[aria-disabled="true"]:hover { background: var(--paper-1); }
/* A register that FAILED is not merely unreadable-and-dimmed like one that was
   never asked. It carries the same double rule as the banner and its dash is
   set in full ink, because an em dash at 72% opacity beside five live figures
   is a count the eye skips rather than a fault it stops at. */
.mudavym .lg-cell[data-struck="true"] { opacity: 1; border-left: 6px double var(--ink-1); background: var(--paper-1); }
.mudavym .lg-cell[data-struck="true"] .lg-figure { color: var(--ink-1); }
.mudavym .lg-cell[data-struck="true"] .lg-cell__state { color: var(--ink-2); }
.mudavym .lg-cell:focus-visible, .mudavym .lg-open:focus-visible, .mudavym .lg-follow:focus-visible, .mudavym .lg-out:focus-visible, .mudavym .lg-btn:focus-visible, .mudavym .lg-input:focus-visible { outline: 2px solid var(--seal); outline-offset: 2px; border-radius: 6px; }
.mudavym .lg-figure { font-family: ${MONO}; font-size: 20px; font-weight: 500; font-variant-numeric: tabular-nums; line-height: 1.1; display: block; margin-top: 3px; }
.mudavym .lg-figure__floor { color: var(--ink-4); font-size: 14px; }
.mudavym .lg-figure--wait { width: 34px; height: 11px; border-radius: 4px; background: var(--paper-2); margin-top: 7px; margin-bottom: 4px; }
.mudavym .lg-cell__state { display: block; font-size: 10.5px; line-height: 1.4; color: var(--ink-4); margin-top: 2px; min-height: 15px; }
.mudavym .lg-search { display: flex; gap: 8px; align-items: stretch; margin: 0 0 6px; }
.mudavym .lg-input { flex: 1 1 auto; min-width: 0; height: 36px; padding: 0 11px; border: 1px solid var(--paper-2); border-radius: 8px; background: var(--paper-1); color: var(--ink-1); font-family: ${MONO}; font-size: 12px; }
.mudavym .lg-input::placeholder { color: var(--ink-4); font-family: ${SANS}; }
.mudavym .lg-input:hover { border-color: var(--seal-ring); }
.mudavym .lg-btn { height: 36px; padding: 0 14px; border: 1px solid var(--paper-2); border-radius: 8px; background: var(--paper-1); color: var(--ink-1); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.mudavym .lg-btn:hover { border-color: var(--seal-ring); background: var(--paper-2); }
.mudavym .lg-btn--seal { background: var(--seal); border-color: var(--seal); color: var(--paper-0); }
.mudavym .lg-btn--seal:hover { background: var(--seal-deep); border-color: var(--seal-deep); }
.mudavym .lg-btn[disabled] { opacity: 0.6; cursor: default; }
.mudavym .lg-hint { font-size: 11px; color: var(--ink-4); margin: 0 0 16px; }
.mudavym .lg-band { border: 1px solid var(--paper-2); border-left: 2px solid var(--ink-1); border-radius: 10px; padding: 12px 14px; margin: 0 0 16px; font-size: 13px; line-height: 1.55; }
.mudavym .lg-band--quiet { border-left-color: var(--paper-2); color: var(--ink-2); }
/* A register that did not answer is STRUCK, in the page's own ledger idiom:
   the double rule it already uses to close a thread, turned on its side. The
   house allows one chromatic colour (the seal) and the seal means "a control
   you may press", so a failure cannot be red and must not be seal — it is
   marked by WEIGHT and by a mono eyebrow, never by hue. */
.mudavym .lg-band--struck { border-left: 6px double var(--ink-1); background: var(--paper-1); }
.mudavym .lg-band__mark { font-family: ${MONO}; font-size: 9.5px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-1); margin: 0 0 4px; }
.mudavym .lg-band strong { font-family: ${SERIF}; font-weight: 600; font-size: 15px; }
.mudavym .lg-band p { margin: 0; }
.mudavym .lg-band p + p { margin-top: 4px; }
.mudavym .lg-skel { height: 11px; border-radius: 4px; background: var(--paper-2); margin: 8px 0; }
/* The day a row belongs to stays on screen while its rows are on screen. A
   hundred rows is four or five days deep; a heading that scrolls away makes
   every timestamp below it a time with no date. */
.mudavym .lg-day { position: sticky; top: 0; z-index: 1; margin: 18px 0 0; padding: 6px 8px 5px; background: var(--paper-0); border-bottom: 1px solid var(--paper-2); }
.mudavym .lg-list { list-style: none; margin: 0; padding: 0; }
.mudavym .lg-row { display: grid; grid-template-columns: 74px 52px minmax(0, 1fr); gap: 10px; align-items: baseline; padding: 8px 6px 8px 8px; border-top: 1px solid var(--paper-2); border-left: 2px solid transparent; scroll-margin-top: 34px; }
.mudavym .lg-row:hover { background: var(--paper-1); }
/* The keyboard cursor is --ink-1, never the seal: the seal is the colour of a
   control, and where the reader is standing is not a control (BookRow.tsx:139). */
.mudavym .lg-row[data-cursor="true"] { border-left-color: var(--ink-1); background: var(--paper-1); }
.mudavym .lg-row[data-thread="true"] { grid-template-columns: 30px 74px 52px minmax(0, 1fr); }
@media (min-width: 720px) { .mudavym .lg-row { grid-template-columns: 74px 52px minmax(0, 1fr) auto; } .mudavym .lg-row[data-thread="true"] { grid-template-columns: 30px 74px 52px minmax(0, 1fr) auto; } }
.mudavym .lg-clock { font-family: ${MONO}; font-size: 11px; color: var(--ink-4); font-variant-numeric: tabular-nums; white-space: nowrap; }
.mudavym .lg-clock--none { color: var(--ink-4); font-style: italic; font-family: ${SANS}; }
.mudavym .lg-mark { font-family: ${MONO}; font-size: 9.5px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--seal-deep); white-space: nowrap; }
.mudavym .lg-index { font-family: ${MONO}; font-size: 10px; color: var(--ink-4); }
.mudavym .lg-open { display: block; width: 100%; text-align: left; padding: 0; border: 0; background: none; color: var(--ink-1); font: inherit; font-size: 13.5px; line-height: 1.4; cursor: pointer; }
.mudavym .lg-open:hover { color: var(--seal-deep); }
/* The row's tail. At ≥720px it is the fourth track; below it rules off across
   the whole row rather than landing in the 74px clock track — three declared
   tracks and four children is an implicit row at column 1, which put "Open the
   stock ledger" underneath the timestamp on every phone. */
.mudavym .lg-tail { display: flex; align-items: baseline; gap: 10px; justify-content: flex-end; min-width: 0; }
@media (max-width: 719.98px) {
  .mudavym .lg-tail { grid-column: 1 / -1; justify-content: flex-start; margin-top: 2px; padding-top: 3px; border-top: 1px dotted var(--paper-2); }
}
.mudavym .lg-follow { border: 0; background: none; padding: 0; font: inherit; font-family: ${MONO}; font-size: 10.5px; color: var(--ink-4); cursor: pointer; max-width: 156px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mudavym .lg-follow:hover { color: var(--seal-deep); text-decoration: underline; }
.mudavym .lg-nothread { font-size: 10.5px; font-family: ${MONO}; color: var(--ink-4); white-space: nowrap; opacity: 0.75; }
.mudavym .lg-out { font-size: 12px; color: var(--seal-deep); text-decoration: none; white-space: nowrap; flex: none; }
.mudavym .lg-out:hover { text-decoration: underline; }
.mudavym .lg-noway { font-size: 11px; color: var(--ink-4); white-space: nowrap; flex: none; }
.mudavym .lg-thread { margin: 6px 0 0; }
.mudavym .lg-thread__id { font-family: ${MONO}; font-size: 15px; word-break: break-all; margin: 2px 0 0; }
.mudavym .lg-double { border-top: 1px solid var(--ink-1); border-bottom: 1px solid var(--ink-1); height: 3px; opacity: 0.5; margin: 10px 0 8px; }
.mudavym .lg-foot { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; justify-content: space-between; margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--paper-2); font-size: 12px; color: var(--ink-2); }
.mudavym .lg-foot p { margin: 0; }
.mudavym .lg-page-foot { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; border-top: 1px solid var(--paper-2); margin-top: 40px; padding-top: 14px; font-size: 11px; color: var(--ink-4); }
.mudavym .lg-page-foot p { margin: 0; max-width: 720px; }
.mudavym .lg-keys { border: 1px solid var(--paper-2); background: var(--paper-1); border-radius: 12px; padding: 12px 14px; margin: 28px 0 0; }
.mudavym .lg-keys h2 { font-family: ${MONO}; font-size: 10px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-4); margin: 0; }
.mudavym .lg-keys dl { display: grid; grid-template-columns: 1fr; gap: 3px 14px; margin: 8px 0 0; font-size: 11.5px; }
@media (min-width: 720px) { .mudavym .lg-keys dl { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.mudavym .lg-keys div { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.mudavym .lg-keys dt { color: var(--ink-2); }
.mudavym .lg-keys dd { margin: 0; flex: 1 1 auto; text-align: right; color: var(--ink-4); }
.mudavym .lg-key { font-family: ${MONO}; font-size: 10px; border: 1px solid var(--paper-2); border-radius: 4px; background: var(--paper-0); padding: 1px 5px; white-space: nowrap; }
.mudavym .lg-keys p { margin: 8px 0 0; font-size: 10.5px; color: var(--ink-4); }
.mudavym .lg-sheet { padding: 4px 16px 16px; }
.mudavym .lg-step { display: inline-flex; gap: 4px; }
.mudavym .lg-step__btn { font-family: ${MONO}; font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--seal-deep); background: none; border: 1px solid var(--paper-2); border-radius: 6px; padding: 3px 7px; cursor: pointer; white-space: nowrap; }
.mudavym .lg-step__btn:hover { border-color: var(--seal-ring); background: var(--paper-1); }
.mudavym .lg-step__btn:focus-visible { outline: 2px solid var(--seal); outline-offset: 2px; }
.mudavym .lg-place { margin: 0 0 10px; font-size: 11px; line-height: 1.5; color: var(--ink-4); }
.mudavym .lg-place:focus { outline: none; }
.mudavym .lg-place:focus-visible { outline: 2px solid var(--seal); outline-offset: 3px; border-radius: 4px; }
.mudavym .lg-facts { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 6px 12px; margin: 0; font-size: 12.5px; }
.mudavym .lg-facts dt { font-family: ${MONO}; font-size: 9.5px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-4); padding-top: 3px; }
.mudavym .lg-facts dd { margin: 0; min-width: 0; word-break: break-word; }
.mudavym .lg-facts__note { color: var(--ink-4); font-style: italic; }
.mudavym .lg-facts .lg-follow { display: block; max-width: 100%; margin-top: 4px; font-family: ${SANS}; font-size: 12px; color: var(--seal-deep); }
.mudavym .lg-payload { margin: 0; font-family: ${MONO}; font-size: 11.5px; line-height: 1.5; background: var(--paper-1); border-radius: 8px; padding: 8px 10px; }
.mudavym .lg-payload__line { display: grid; grid-template-columns: minmax(80px, 34%) minmax(0, 1fr); gap: 8px; padding: 3px 0; border-top: 1px solid var(--paper-2); }
.mudavym .lg-payload__line:first-child { border-top: 0; }
.mudavym .lg-payload dt { color: var(--ink-4); }
.mudavym .lg-payload dd { margin: 0; white-space: pre-wrap; word-break: break-word; }
@media (prefers-reduced-motion: reduce) {
  .mudavym .lg-ink, .mudavym .lg-ink * { transition: none !important; }
}
`;

/* ── state bands ──────────────────────────────────────────────────────────── */

function Loading({ threadOn }: { threadOn: boolean }) {
  return (
    <div className="lg-band lg-band--quiet" role="status">
      <p>
        <strong>{threadOn ? 'Reading every register for this thread.' : 'Reading six registers.'}</strong>
      </p>
      <p>
        {threadOn
          ? 'A thread is a second read, not a filter over the first: the event store is only reachable along one, so the registers are asked again with the id.'
          : 'The till, the agents, the stock ledger, the paper, the audit trail — and the event store when a thread is followed.'}
      </p>
      <div aria-hidden>
        <div className="lg-skel" style={{ width: '62%' }} />
        <div className="lg-skel" style={{ width: '48%' }} />
        <div className="lg-skel" style={{ width: '71%' }} />
      </div>
    </div>
  );
}

function Unreadable({ data }: { data: LogsNextData }) {
  const f = data.failure;
  if (f?.forbidden) {
    return (
      <div className="lg-band lg-band--struck" role="alert">
        <p className="lg-band__mark">Refused</p>
        <p>
          <strong>This house’s timeline was refused to your account.</strong>
        </p>
        <p>
          The gateway answered {f.status ?? EM}: {f.message}. Nothing below is a count of anything. Ask an owner of
          this house, or switch to a house you belong to from the header.
        </p>
      </div>
    );
  }
  return (
    <div className="lg-band lg-band--struck" role="alert">
      <p className="lg-band__mark">Not read</p>
      <p>
        <strong>The timeline could not be read.</strong>
      </p>
      <p>
        No register was reached, so this is a failure, not a quiet house. The gateway said:{' '}
        <span style={{ fontFamily: MONO }}>{f?.message ?? 'no message'}</span>
        {f?.status ? ` (${f.status})` : ''}.
      </p>
      <p>
        <button type="button" className="lg-btn lg-ink" onClick={data.refetch} style={{ marginTop: 6 }}>
          Try again
        </button>
      </p>
    </div>
  );
}

/* ── the register strip ───────────────────────────────────────────────────── */

interface StripProps {
  data: LogsNextData;
  active: string | null;
  onToggle: (source: string) => void;
  threadOn: boolean;
}

function RegisterStrip({ data, active, onToggle, threadOn }: StripProps) {
  const sources = useMemo(() => displaySources(data.sourcesQueried), [data.sourcesQueried]);
  const requestFailed = data.state === 'unreadable';
  const loaded = data.events?.length ?? 0;
  // A floor while rows remain beyond the window, or while the gateway did not
  // say and the window is full. Exact only when the gateway said "no more".
  const floor =
    data.hasMore === true || (data.hasMore === null && loaded >= LOGS_SERVER_WINDOWS.TIMELINE);
  const loading = data.state === 'loading';
  const failedList: string[] = data.failedSources ?? [];
  const readCount =
    data.sourcesQueried === null ? null : data.sourcesQueried.length - failedList.length;
  // `sources` is the display list (string[] — it also names a register the
  // gateway sent that this page's SOURCE_ORDER union does not know, on
  // purpose), so membership against the narrower TimelineSource[] is checked
  // with `===`, not `.includes`, to avoid a false narrowing of `s`.
  const skipped = data.sourcesQueried === null ? [] : sources.filter((s) => !data.sourcesQueried!.some((q) => q === s));

  return (
    <div>
      <ul className="lg-strip" aria-label="Registers">
        {sources.map((s) => {
          const failed = data.failedSources?.includes(s as never) ?? false;
          const wasSkipped = !failed && skipped.includes(s);
          const unknown = failed || wasSkipped || requestFailed || loading;
          const count = data.counts ? (data.counts[s] ?? 0) : null;
          const stateWord = failed
            ? 'could not be read'
            : wasSkipped
              ? threadOn
                ? 'not read for this view'
                : 'read only along a thread'
              : requestFailed
                ? 'not reached'
                : loading
                  ? 'reading'
                  : data.counts && data.sourcesQueried === null
                    ? 'rows on this page'
                    : count === 0
                      ? 'nothing on this page'
                      : floor
                        ? 'on this page, at least'
                        : 'on this page';
          const pressed = active === s;
          return (
            <li key={s}>
              <button
                type="button"
                className="lg-cell lg-ink"
                aria-pressed={pressed}
                aria-disabled={unknown ? 'true' : undefined}
                data-struck={failed ? 'true' : undefined}
                title={failed ? `${describeOf(s)} — this register could not be read` : describeOf(s)}
                onClick={() => {
                  if (!unknown) onToggle(s);
                }}
              >
                <span className="lg-eyebrow">{labelOf(s)}</span>
                <Tally value={unknown ? null : count} floor={!unknown && floor && (count ?? 0) > 0} pending={loading} />
                <span className="lg-cell__state">{stateWord}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {/* Presence is stated, not assumed: only when the gateway reported which
          registers it read. A FAILED register is in `sourcesQueried` — it WAS
          asked — so it never appeared in `skipped`, and this line used to fall
          from "Read 6 of 6" to "Read 4 of 6" while naming nobody: the count
          dropped silently and only the banner said who. The two absences get
          different words here because they are different facts. */}
      {!requestFailed && readCount !== null ? (
        <p className="lg-hint">
          Read {readCount} of {sources.length} registers
          {failedList.length > 0 ? ` · could not be read: ${listSources(failedList)}` : ''}
          {skipped.length > 0 ? ` · not read: ${listSources(skipped)}` : ''}
          {active ? ` · showing ${nameOf(active)} only` : ''}
        </p>
      ) : (
        <p className="lg-hint">{active ? `Showing ${nameOf(active)} only` : ' '}</p>
      )}
    </div>
  );
}

/* ── a row ────────────────────────────────────────────────────────────────── */

interface RowProps {
  e: TimelineEvent;
  index?: number;
  link: LinkContext;
  onOpen: (e: TimelineEvent) => void;
  onFollow: (id: string) => void;
  showDate?: boolean;
  /** Where the keyboard reader is standing. Not a selection; nothing acts on it. */
  cursor?: boolean;
  rowRef?: (el: HTMLLIElement | null) => void;
}

function Row({ e, index, link, onOpen, onFollow, showDate, cursor, rowRef }: RowProps) {
  const out = linkOutFor(e, link);
  const undated = !e.occurredAt;
  return (
    <li
      ref={rowRef}
      className="lg-row lg-ink"
      data-thread={index !== undefined ? 'true' : undefined}
      data-cursor={cursor ? 'true' : undefined}
    >
      {index !== undefined ? <span className="lg-index">{String(index).padStart(2, '0')}</span> : null}
      <span className={`lg-clock${undated ? ' lg-clock--none' : ''}`} title={undated ? 'This row records no timestamp' : undefined}>
        {showDate ? fmtStamp(e.occurredAt) : fmtClock(e.occurredAt)}
      </span>
      <span className="lg-mark">{labelOf(e.source)}</span>
      <div style={{ minWidth: 0 }}>
        <button type="button" className="lg-open lg-ink" onClick={() => onOpen(e)}>
          {e.summary}
        </button>
      </div>
      {/* The tail: the thread this row belongs to, and the page it leads to.
          Both are controls, so both live together on the row's right edge —
          the correlation id used to take a SECOND line of its own, where a
          36-character identifier was wider, and more chromatic, than the
          sentence it sat under. It is the same id, ellipsised by the box
          rather than by the string; the whole of it is on `title`, on the
          accessible name, and in the sheet. Below 720px this cell takes a
          rule-off line of its own rather than landing under the clock, which
          is where three grid tracks and four children used to put it. */}
      <div className="lg-tail">
        {e.correlationId ? (
          <button
            type="button"
            className="lg-follow lg-ink"
            aria-label={`Follow thread ${e.correlationId}`}
            title={`Follow thread ${e.correlationId}`}
            onClick={() => onFollow(e.correlationId as string)}
          >
            {e.correlationId}
          </button>
        ) : (
          <span className="lg-nothread">no thread</span>
        )}
        {out ? (
          <Link to={out.to} className="lg-out lg-ink">
            {out.label}
          </Link>
        ) : (
          <span className="lg-noway">no page of its own</span>
        )}
      </div>
    </li>
  );
}

/* ── the window, at the foot of the list ──────────────────────────────────── */

function WindowFoot({ data, shown, threadOn }: { data: LogsNextData; shown: number; threadOn: boolean }) {
  const loaded = data.events?.length ?? 0;
  const failed = data.failedSources ?? [];
  const what = threadOn ? 'this thread holds' : 'the registers hold';
  let sentence: string;
  if (data.stalled) {
    sentence = `Older entries exist, but the last page holds no dated entry to page from — the feed cannot walk past this point. ${loaded} entries are on the page.`;
  } else if (data.hasMore === true) {
    sentence = `Showing the first ${loaded} entries · older entries exist${
      data.window !== null ? ` — the gateway reads ${data.window} at a time` : ''
    }.`;
  } else if (data.hasMore === false) {
    sentence = `All ${loaded} entries ${what} are on the page.`;
  } else {
    sentence = `Showing the first ${loaded} entries · whether older entries exist was not reported by this gateway.`;
  }
  return (
    <div className="lg-foot" aria-live="polite">
      <div>
        <p>{sentence}</p>
        {shown !== loaded ? <p>{shown} of them match the register you chose.</p> : null}
        {failed.length > 0 ? (
          <p>
            Every count is a floor: {listSources(failed)} could not be read, so the feed is missing whatever{' '}
            {failed.length === 1 ? 'that register holds' : 'those registers hold'}.
          </p>
        ) : null}
      </div>
      {data.hasMore === true && !data.stalled ? (
        <button type="button" className="lg-btn lg-ink" onClick={data.readMore} disabled={data.readingMore}>
          {data.readingMore ? 'Reading older entries…' : 'Read older entries'}
        </button>
      ) : null}
    </div>
  );
}

/* ── the page ─────────────────────────────────────────────────────────────── */

export interface LogsNextProps {
  /**
   * Force the Warm Charcoal ground regardless of app theme (ADR 0042).
   *
   * `'charcoal'` only, matching every other rebuilt page (`DashboardNext.tsx`,
   * `CellarNext.tsx`, `TeamNext.tsx`, …). The two-value form this used to have
   * offered a `'paper'` that does not do what it says: `.dark .mudavym` still
   * matches and still wins (`styles/mudavym.css:48-49`), so passing it would
   * only suppress the pre-hydration media query — a prop that reads as "force
   * paper" and cannot. `App.tsx:386` passes neither; the ground is a DOM fact
   * (ADR 0112:99-101), not a prop.
   */
  ground?: 'charcoal';
}

export default function LogsNext({ ground }: LogsNextProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const correlationId = searchParams.get('correlationId')?.trim() || null;
  const [draft, setDraft] = useState(correlationId ?? '');
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [open, setOpen] = useState<TimelineEvent | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const { activeRestaurantId } = useAuth();
  const documentPageOn = useMudavymDesign('document');
  const data = useLogsNextData(correlationId);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const headRef = useRef<HTMLElement | null>(null);
  const ledgerRef = useRef<HTMLElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  /** The reading `lg-turn` last landed on. See the effect below. */
  const turned = useRef<string | null>(correlationId);

  useEffect(() => {
    ensureFraunces();
  }, []);

  // lg-arrive — the opening, once.
  useEffect(() => {
    if (!headRef.current) return;
    animate(headRef.current, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], settle);
  }, []);

  // lg-turn — the page turns when a thread is entered or left. "Show the
  // working" is exactly what following a thread is.
  //
  // IT FIRES ON THE FRAME THE NEW READING LANDS, not on the frame the URL
  // changed. Entering a thread changes the query key, so for the length of one
  // round trip `<main>` holds the loading band — and this effect used to
  // depend on `correlationId` alone, which meant the page's one signature
  // motion played on three skeleton bars while the thread it was written for
  // appeared with no motion at all. The ref starts on the correlation the page
  // mounted with, so the first landing is the arrival (`lg-arrive`) and not a
  // turn; every later change of reading is a turn, in both directions.
  useEffect(() => {
    if (data.state !== 'ready') return;
    if (turned.current === correlationId) return;
    turned.current = correlationId;
    if (!ledgerRef.current) return;
    animate(ledgerRef.current, [{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }], turn);
  }, [correlationId, data.state]);

  // The URL is the one source of truth for the thread; the input mirrors it.
  useEffect(() => {
    setDraft(correlationId ?? '');
  }, [correlationId]);

  const follow = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams);
      const trimmed = id.trim();
      if (trimmed) next.set('correlationId', trimmed);
      else next.delete('correlationId');
      setSearchParams(next);
      setOpen(null);
      setActiveSource(null);
    },
    [searchParams, setSearchParams],
  );

  const leave = useCallback(() => follow(''), [follow]);

  const link: LinkContext = useMemo(
    () => ({
      documentPageOn,
      posLogAvailable: !import.meta.env.PROD,
      restaurantId: activeRestaurantId,
    }),
    [documentPageOn, activeRestaurantId],
  );

  const events = data.events;
  const visible = useMemo(
    () => (events ? (activeSource ? events.filter((e) => e.source === activeSource) : events) : null),
    [events, activeSource],
  );
  const days = useMemo(() => (visible ? groupByDay(visible) : []), [visible]);
  const thread = useMemo(() => (visible && correlationId ? orderForThread(visible) : null), [visible, correlationId]);
  const span = useMemo(() => (thread ? threadSpan(thread) : null), [thread]);
  const someFailed = (data.failedSources?.length ?? 0) > 0;

  /**
   * THE ROWS AS THEY ARE DRAWN, in one flat list. The feed draws `days`, the
   * thread draws `thread`, and the keyboard has to walk whichever is on screen
   * — deriving the walk from the same arrays the JSX maps is the only way the
   * two cannot disagree about what "the next row" means.
   */
  const walk = useMemo<TimelineEvent[]>(
    () => (thread ? thread : days.flatMap((d) => d.events)),
    [thread, days],
  );
  const keyOf = useCallback((e: TimelineEvent) => `${e.source}:${e.id}`, []);

  /**
   * j / k / Enter / f — the four keys a log is expected to have.
   *
   * The vocabulary is the house's, set by the notifications book
   * (`NotificationsNext.tsx:267-356`) and by Linear before it: `j`/`k` move,
   * `Enter` opens. Two house rules apply on top, and one of them is free here:
   *
   *   • a key never does something irreversible. On this page NOTHING is: it
   *     writes nothing, and its one act — following a thread — is a URL change
   *     the back button undoes. So `f` is bound where an inbox could not bind
   *     archive.
   *   • a key never fires while the reader is typing. The thread box is an
   *     input, and a log that started pivoting because someone typed a `j`
   *     into a correlation id is the classic version of that bug.
   *
   * The cursor is where the reader is STANDING, not a selection: nothing acts
   * on it but the reader, and it is drawn in --ink-1 rather than the seal for
   * exactly that reason.
   */
  const move = useCallback(
    (delta: number) => {
      if (walk.length === 0) return;
      const at = cursor === null ? -1 : walk.findIndex((e) => keyOf(e) === cursor);
      const to =
        at === -1 ? (delta < 0 ? walk.length - 1 : 0) : Math.min(walk.length - 1, Math.max(0, at + delta));
      const id = walk[to] ? keyOf(walk[to]) : null;
      setCursor(id);
      // `scrollIntoView` is not universally implemented (jsdom has no layout,
      // and neither do some embedded webviews). Keeping the cursor is the
      // behaviour; scrolling to it is a courtesy that must not throw.
      const el = id ? rowRefs.current.get(id) : null;
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    },
    [walk, cursor, keyOf],
  );

  /**
   * STEPPING INSIDE THE SHEET. The two lists run in opposite directions — the
   * feed is newest-first, a thread is oldest-first (`lg-format.ts:219-224`) —
   * so "earlier" is `+1` in one and `-1` in the other. The sheet is labelled by
   * TIME because that is what an audit reader thinks in; `j`/`k` stay labelled
   * by the LIST, so they mean the same thing inside the sheet as they do on the
   * page behind it. Both are true in their own frame, and the position line
   * under the title says which page they are true about.
   */
  const stepDir = thread ? -1 : 1; // walk index delta for "earlier"
  const openAt = open ? walk.findIndex((e) => keyOf(e) === keyOf(open)) : -1;
  const stepBy = useCallback(
    (delta: number) => {
      if (openAt < 0) return;
      const to = walk[openAt + delta];
      if (!to) return;
      setOpen(to);
      setCursor(keyOf(to));
    },
    [openAt, walk, keyOf],
  );

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const t = ev.target as HTMLElement | null;
      const typing =
        !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (ev.key === '/' && !typing) {
        ev.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (typing) {
        if (ev.key === 'Escape') (t as HTMLInputElement).blur();
        return;
      }
      // The entry sheet traps its own focus and owns its own Escape
      // (`Sheet.tsx:352-362`). While it is open the page behind it is not the
      // thing being read — but j/k still mean "down and up the list", so they
      // walk the sheet through the same entries rather than moving a cursor
      // nobody can see. Everything else stays down.
      if (open) {
        if (ev.key === 'j') {
          ev.preventDefault();
          stepBy(1);
        } else if (ev.key === 'k') {
          ev.preventDefault();
          stepBy(-1);
        }
        return;
      }
      const row = cursor ? walk.find((e) => keyOf(e) === cursor) ?? null : null;
      switch (ev.key) {
        case 'j':
          ev.preventDefault();
          move(1);
          break;
        case 'k':
          ev.preventDefault();
          move(-1);
          break;
        case 'Enter':
        case 'o':
          if (!row) return;
          ev.preventDefault();
          setOpen(row);
          break;
        case 'f':
          if (!row?.correlationId) return;
          ev.preventDefault();
          follow(row.correlationId);
          break;
        case 'Escape':
          // One step back at a time: put the cursor down first, then leave the
          // thread. An Escape that did both would make the reader's place and
          // the page's reading the same act, and they are not.
          if (cursor) setCursor(null);
          else if (correlationId) leave();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [walk, cursor, move, open, correlationId, follow, leave, keyOf, stepBy]);

  // A cursor standing on a row that has left the page is no cursor at all —
  // the register filter, the thread pivot and a fresh read can all take it.
  useEffect(() => {
    if (cursor && !walk.some((e) => keyOf(e) === cursor)) setCursor(null);
  }, [walk, cursor, keyOf]);

  const bindRow = useCallback(
    (e: TimelineEvent) => (el: HTMLLIElement | null) => {
      const k = keyOf(e);
      if (el) rowRefs.current.set(k, el);
      else rowRefs.current.delete(k);
    },
    [keyOf],
  );

  const steps = useMemo(() => {
    if (openAt < 0) return null;
    const earlier = !!walk[openAt + stepDir];
    const later = !!walk[openAt - stepDir];
    // The end of the LOADED page is not the end of the registers, and the two
    // must not be said with the same sentence. `hasMore === null` is a gateway
    // that never said, which is neither.
    let endNote: string | null = null;
    if (!earlier) {
      endNote =
        data.hasMore === true
          ? 'This is the earliest entry read; older ones exist beyond the window — read them from the foot of the list.'
          : data.hasMore === false
            ? 'This is the earliest entry the registers hold.'
            : 'This is the earliest entry read; whether older ones exist was not reported by this gateway.';
    } else if (!later) {
      endNote = 'This is the latest entry on the page.';
    }
    return { index: openAt + 1, total: walk.length, earlier, later, endNote };
  }, [openAt, walk, stepDir, data.hasMore]);

  return (
    <div className="mudavym" data-ground={ground}>
      <style>{PAGE_CSS}</style>
      <div className="lg-root">
        <div className="lg-wrap">
          {/* ── The opening — Fraunces speaks ─────────────────────────── */}
          <header ref={headRef}>
            <Wordmark size={13} />
            <h1 style={{ fontFamily: SERIF, fontSize: 34, fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.1, margin: '4px 0 0' }}>
              Logs<span style={{ color: 'var(--seal)' }}>.</span>
            </h1>
            <p style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 15, color: 'var(--ink-2)', margin: '6px 0 0' }}>
              What the house recorded, across six registers.
            </p>
            <p style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--ink-2)', margin: '8px 0 0', maxWidth: 680 }}>
              Every entry is a row one of the house’s registers wrote — the till, the agents, the stock ledger, the
              paper that arrived, the audit trail and, along a thread, the platform’s event store. A register that
              could not be read is named. A count taken inside the window is a floor. Any correlation id on the page
              turns the feed into a thread.
            </p>
          </header>

          <div className="lg-rule" aria-hidden />

          {/* ── What did not answer, BEFORE what did ────────────────────
              This band used to sit inside the ledger, below the strip, so the
              reader met six unexplained em dashes and then, a screen later,
              the sentence explaining them. The explanation of an absence has
              to precede the absence, or the absence is read as a figure. */}
          {data.state === 'ready' && someFailed ? (
            <div className="lg-band lg-band--struck" role="alert">
              <p className="lg-band__mark">Not read</p>
              <p>
                <strong>
                  {data.failedSources!.length === 1
                    ? 'One register could not be read'
                    : `${word(data.failedSources!.length)} registers could not be read`}
                  :
                </strong>{' '}
                {listSources(data.failedSources!)}. Every count on this page is a floor — the feed is missing whatever{' '}
                {data.failedSources!.length === 1 ? 'that register holds' : 'those registers hold'}.
              </p>
            </div>
          ) : null}

          {/* ── The registers ──────────────────────────────────────────── */}
          <RegisterStrip
            data={data}
            active={activeSource}
            onToggle={(s) => setActiveSource((cur) => (cur === s ? null : s))}
            threadOn={!!correlationId}
          />

          {/* ── The thread box ─────────────────────────────────────────── */}
          <form
            className="lg-search"
            role="search"
            onSubmit={(ev) => {
              ev.preventDefault();
              follow(draft);
            }}
          >
            <input
              ref={inputRef}
              className="lg-input lg-ink"
              value={draft}
              onChange={(ev) => setDraft(ev.target.value)}
              placeholder="Follow a correlation id"
              aria-label="Correlation id"
              spellCheck={false}
              autoComplete="off"
            />
            <button type="submit" className="lg-btn lg-btn--seal lg-ink">
              Follow
            </button>
            {correlationId ? (
              <button type="button" className="lg-btn lg-ink" onClick={leave}>
                Leave the thread
              </button>
            ) : null}
          </form>
          <p className="lg-hint">
            Press <span style={{ fontFamily: MONO }}>/</span> to jump here. A thread reads every register that
            carries the id, the event store included.
          </p>

          {/* ── The ledger ─────────────────────────────────────────────── */}
          <main ref={ledgerRef} key={correlationId ?? '__feed'} aria-label={correlationId ? 'One thread' : 'The feed'}>
            {data.state === 'loading' ? <Loading threadOn={!!correlationId} /> : null}
            {data.state === 'unreadable' ? <Unreadable data={data} /> : null}

            {data.state === 'ready' && visible && visible.length === 0 ? (
              <div className="lg-band lg-band--quiet" role="status">
                <p>
                  <strong>
                    {correlationId
                      ? 'No entry carries this correlation id.'
                      : activeSource
                        ? `Nothing from ${nameOf(activeSource)} on this page.`
                        : 'No entries.'}
                  </strong>
                </p>
                <p>
                  {someFailed
                    ? 'The registers that could be read hold nothing for this view; the ones that failed are named above.'
                    : correlationId
                      ? 'The registers that were read hold no row with this id. A thread is only as complete as the rows that carry it.'
                      : activeSource
                        ? // NOT "this register was quiet". The choice is a sieve over the
                          // rows already loaded, and the gateway merges every register
                          // before it slices the window — so a busy register can crowd
                          // this one out of the page entirely. Saying "nothing here"
                          // without saying "on this page, from this window" would be the
                          // page reporting a crowding-out as a quiet register.
                          'This is the page you have read, not the register itself: the gateway merges all six before it cuts the window, so a busy register can crowd this one off the page. Read older entries, or clear the choice.'
                        : 'The registers answered and hold nothing for this house yet.'}
                </p>
              </div>
            ) : null}

            {data.state === 'ready' && thread && span && thread.length > 0 ? (
              <section className="lg-thread" aria-labelledby="lg-thread-heading">
                <p className="lg-eyebrow lg-eyebrow--seal">One thread</p>
                <h2 id="lg-thread-heading" className="lg-thread__id">
                  {correlationId}
                </h2>
                <p style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 14, color: 'var(--ink-2)', margin: '4px 0 10px' }}>
                  {thread.length === 1 ? 'One entry' : `${thread.length} entries`} across {word(span.registers)}{' '}
                  {span.registers === 1 ? 'register' : 'registers'}
                  {span.first && span.last
                    ? span.first === span.last
                      ? `, at ${fmtStamp(span.first)}`
                      : `, from ${fmtStamp(span.first)} to ${fmtStamp(span.last)}`
                    : ', none of them dated'}
                  .
                </p>
                <ol className="lg-list">
                  {thread.map((e, i) => (
                    <Row
                      key={keyOf(e)}
                      e={e}
                      index={i + 1}
                      link={link}
                      onOpen={setOpen}
                      onFollow={follow}
                      showDate
                      cursor={cursor === keyOf(e)}
                      rowRef={bindRow(e)}
                    />
                  ))}
                </ol>
                <div className="lg-double" aria-hidden />
                <p className="lg-eyebrow">Ruled off · {thread.length === 1 ? 'one entry' : `${thread.length} entries`}</p>
              </section>
            ) : null}

            {data.state === 'ready' && !correlationId && visible && visible.length > 0
              ? days.map((d) => (
                  <section key={d.key ?? '__undated'} aria-label={d.heading}>
                    <p className="lg-eyebrow lg-day">{d.heading}</p>
                    <ul className="lg-list">
                      {d.events.map((e) => (
                        <Row
                          key={keyOf(e)}
                          e={e}
                          link={link}
                          onOpen={setOpen}
                          onFollow={follow}
                          cursor={cursor === keyOf(e)}
                          rowRef={bindRow(e)}
                        />
                      ))}
                    </ul>
                  </section>
                ))
              : null}

            {data.state === 'ready' && events ? (
              <WindowFoot data={data} shown={visible?.length ?? 0} threadOn={!!correlationId} />
            ) : null}
          </main>

          {/* ── Without the mouse ──────────────────────────────────────────
              The house prints its key map rather than hiding it behind a
              chord (`NotificationsNext.tsx:815-852`). It is drawn only when
              there is something to walk: a legend over an empty ledger is a
              promise about rows that are not there. */}
          {data.state === 'ready' && walk.length > 0 ? (
            <section className="lg-keys" aria-labelledby="lg-keys-heading">
              <h2 id="lg-keys-heading">Without the mouse</h2>
              <dl>
                {[
                  ['j / k', 'move down and up the entries — and through them once one is open'],
                  ['Enter', 'open the entry and read the row as its register holds it'],
                  ['f', 'follow the thread the entry belongs to'],
                  ['/', 'jump to the correlation id box'],
                  ['Esc', correlationId ? 'put the cursor down, then leave the thread' : 'put the cursor down'],
                ].map(([k, what]) => (
                  <div key={k}>
                    <dt>
                      <span className="lg-key">{k}</span>
                    </dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
              <p>
                Nothing here is destructive, because nothing here writes: this page reads six registers and changes
                none of them. Following a thread is a change of address, and the back button undoes it.
              </p>
            </section>
          ) : null}

          <footer className="lg-page-foot">
            <Wordmark size={13} />
            <p>
              A register shown as an em dash reported nothing, which is not the same as reporting none. A count with
              the floor mark was taken inside a window; the window is stated at the foot of the list. Nothing on this
              page is written by it.
            </p>
          </footer>
        </div>
      </div>

      <EventSheet
        event={open}
        onClose={() => setOpen(null)}
        onFollow={follow}
        link={link}
        steps={steps}
        onStep={(dir) => stepBy(dir === 'earlier' ? stepDir : -stepDir)}
      />
    </div>
  );
}
