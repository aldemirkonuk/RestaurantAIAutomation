/**
 * What choosing a menu will do, shown BEFORE anyone chooses it (ADR 0193
 * round 3, L13).
 *
 * THE FOUNDER, 2026-09-21, verbatim: "add a section to that where you can lock
 * price, but wha f that menu item disappears? so think verify validate your
 * decision and build". This is that section:
 *   - every price this menu would REPLACE, with who set it and when, and a
 *     Keep switch beside it (an owner or a manager locks the price there and
 *     then; the plan is read again);
 *   - every price a lock already holds, which this menu will not touch;
 *   - a locked wine that comes back with this menu, and a vintage that reads
 *     differently from the locked wine's, so a wrong link is seen;
 *   - every lock whose wine is NOT on this menu: kept, not changed;
 *   - every line of the menu, per kind, behind one "Every line" disclosure.
 * A price a person set AFTER this menu was read is listed FIRST, with who and
 * when (the founder, 2026-09-21, confirming L11 verbatim: "The menu sets it,
 * locks keep"): the menu replaces it unless someone keeps it.
 * "Make it current" sends the plan's fingerprint; the gateway refuses (409,
 * nothing changed) if the plan moved in the meantime, and the page reads it
 * again.
 *
 * Simple and readable for people (the founder's Wave Four / Arrival bar): one
 * sentence first, the detail after. No motion.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMenuPlan,
  makeMenuCurrent,
  type MakeCurrentResult,
  type MenuPlan as Plan,
  type PlanKind,
  type PlanLine,
} from '../../../services/api/menus';
import { lockPrice, releasePriceLock } from '../../../services/api/pricing';
import { countByKind, oneNounFor } from './menu-line-kind';
import { deviceClockNote, houseDay } from './menu-clock';
import { formatMoney } from '../../../lib/currency';
import { useHouseCurrencyCode } from '../../../hooks/queries/useHouseCurrencyCode';
// Drawn with the cellar's classes wherever it is shown (/menu and onboarding).
import '../../cellar/next/cellar-next.css';

const EM = '—';

/**
 * A price in the house's own money (lib/currency formatMoney): "₺80,00" in a
 * lira house, never the bare "80.00" the r23 walk read beside "₺80,00" on the
 * same page. No code yet (still reading, or none recorded) prints the number
 * with "(currency not recorded)", as /menu's rows do.
 */
function money(n: number | null | undefined, currency: string | null): string {
  return n === null || n === undefined ? EM : formatMoney(n, currency);
}

/**
 * The calendar day on the house's clock (menu-clock.ts; the device's when the
 * plan names no zone). Not the UTC day, which is tomorrow by evening in the Americas.
 */
function day(iso: string | null | undefined, zone?: string | null): string {
  if (!iso) return 'an unknown day';
  return houseDay(String(iso), zone) ?? String(iso).slice(0, 10);
}

/** The gateway's own words for a refusal, never a bare status. */
function reasonOf(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { message?: unknown } }; message?: string };
  if (e?.response?.status === 403) return 'only an owner or a manager can do that';
  const m = e?.response?.data?.message;
  if (typeof m === 'string' && m) return m;
  if (Array.isArray(m) && m.length) return String(m[0]);
  return e?.message || 'no reason was given';
}

/**
 * Why choosing (or carrying) did not answer, in words that are true (r28 G1).
 * A refusal (4xx) comes before the switch, so nothing changed. A 5xx says
 * itself: after the switch the gateway says the menu IS current. No answer at
 * all means nobody here knows whether the switch happened.
 */
export function chooseFailedSentence(err: unknown, current: boolean): string {
  const e = err as { response?: { status?: number } };
  if (!e?.response) {
    return `No answer came back (${reasonOf(err)}), so whether this menu is now current, and how many of its prices reached the house, is not known. Its standing under Menus kept says; if it is current, Carry its prices again finishes the rest.`;
  }
  if ((e.response.status ?? 0) >= 500) return reasonOf(err);
  return current
    ? `Its prices were not carried again: ${reasonOf(err)}. Nothing has changed.`
    : `It was not made current: ${reasonOf(err)}. Nothing has changed.`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Lines whose house row the house removed (set inactive or deleted). The carry
 * still writes their price, onto that removed row: one row per house and wine
 * (the UNIQUE) leaves no other row to write, and silence changes nothing (L12),
 * so the choice does not bring the row back. The page says it, so a removed
 * wine is never sold off a menu with nothing on Inventory saying so (r28 G9).
 */
export function removedLines(lines: PlanLine[]): PlanLine[] {
  return lines.filter((l) => l.house?.active === false);
}

/** What a removed row's lines mean, in a clause; null when there are none. */
export function removedClause(lines: PlanLine[]): string | null {
  const n = removedLines(lines).length;
  if (n === 0) return null;
  const one = n === 1;
  return `${plural(n, 'line is', 'lines are')} a good the house removed from Inventory; ${one ? 'its' : 'their'} price is kept on the removed row and ${one ? 'it stays' : 'they stay'} removed (${removedLines(lines).map((l) => l.name).join(', ')}). Bring ${one ? 'it' : 'them'} back on Inventory to sell ${one ? 'it' : 'them'} from there`;
}


/** "a, b and c": a list as a sentence says it. */
function listWords(parts: string[]): string {
  return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** What one line's choice will answer, as the gateway tallies `priceSync`. */
export type LineOutcome = 'changed' | 'unchanged' | 'locked' | 'no_price' | 'not_linked';

/**
 * The one outcome a line's choice answers, worked out from its two kinds the
 * way the price writer decides it (`set_house_menu_price`,
 * 20260922230800_a_house_can_hold_a_price.sql): a kind with a price on the
 * menu is "named"; every named kind held is `locked`; any named kind changed
 * (or new to the house) is `changed`; otherwise `unchanged`. A line with no
 * named kind is `no_price`, and an unmatched line is `not_linked`.
 *
 * Onboarding walk 2026-11-12: the plan said "add 2 prices" and the result
 * "1 price set" -- the plan counted kinds (a bottle and a glass are two) and
 * the result counted lines. #1125 moved changed and new wines onto lines; the
 * prices already the same were still counted per kind ("keep 2 prices that
 * already match") against the result's per line ("1 already at the menu's
 * price"). Both sides now count the same thing for the same words.
 */
export function lineOutcome(line: PlanLine): LineOutcome {
  const kinds = [line.bottle, line.glass];
  if (kinds.some((k) => k.result === 'not_linked')) return 'not_linked';
  const named = kinds.filter(
    (k) => k.result === 'change' || k.result === 'new_wine' || k.result === 'unchanged' || k.result === 'held_by_lock',
  );
  if (named.length === 0) return 'no_price';
  if (named.every((k) => k.result === 'held_by_lock')) return 'locked';
  if (named.some((k) => k.result === 'change' || k.result === 'new_wine')) return 'changed';
  return 'unchanged';
}

/**
 * The plan in one sentence, in the order a person reads a menu change.
 *
 * Menu walk 2026-11-12: it said "add 7 prices for wines new to the house" (and
 * "add 1 price for wines new to the house") where the choice's own result then
 * said "4 wines priced from this menu". Everything the result counts per wine
 * is counted here per wine, from the same rule (`lineOutcome`): wines priced
 * (changed or new), wines already at the menu's price, wines a lock holds. A
 * lock on one kind of a wine the menu otherwise changes is a single price, and
 * is counted in prices.
 */
export function planSentence(
  plan: Pick<Plan, 'counts' | 'dormantLocks' | 'current' | 'lines' | 'kitchenLines' | 'notOnThisFile'>,
): string {
  const c = plan.counts;
  if (plan.current) {
    // r28 G1: a carry cut off part-way can be finished from here, so "changes
    // nothing" is only true when no price on the house differs from the menu.
    const differ = c.change + c.new_wine;
    const removed = removedClause(plan.lines);
    const tail = removed ? ` ${removed}.` : '';
    if (differ === 0) return `This is the current menu, and every price on it already reached the house.${tail}`;
    return `This is the current menu, and ${plural(differ, 'price on the house differs', 'prices on the house differ')} from it. Carrying its prices again sets the ones its choice did not reach; a price someone set since it was chosen stays.${tail}`;
  }
  const parts: string[] = [];
  if (plan.lines.length > 0) {
    // Each group is named by its lines' kinds ("1 wine and 1 cocktail"), from
    // the section the line was read or set into (r13 walk: a Negroni was a "wine").
    const outcome = plan.lines.map((l) => [l, lineOutcome(l)] as const);
    const isNew = (l: PlanLine) => l.bottle.result === 'new_wine' || l.glass.result === 'new_wine';
    const changed = outcome.filter(([l, o]) => o === 'changed' && !isNew(l)).map(([l]) => l);
    const added = outcome.filter(([l, o]) => o === 'changed' && isNew(l)).map(([l]) => l);
    const lockedLines = outcome.filter(([, o]) => o === 'locked').map(([l]) => l);
    const same = outcome.filter(([, o]) => o === 'unchanged').map(([l]) => l);
    const heldOn = outcome.filter(([l, o]) => o !== 'locked' && [l.bottle, l.glass].some((k) => k.result === 'held_by_lock'));
    const heldOnChanged = heldOn.reduce(
      (n, [l]) => n + [l.bottle, l.glass].filter((k) => k.result === 'held_by_lock').length,
      0,
    );
    if (changed.length > 0) parts.push(`change the price of ${countByKind(changed)} the house already has`);
    if (added.length > 0)
      parts.push(`add ${countByKind(added)} new to the house at ${added.length === 1 ? 'its menu price' : 'their menu prices'}`);
    if (lockedLines.length > 0)
      parts.push(`leave ${countByKind(lockedLines)} at ${lockedLines.length === 1 ? 'its locked price' : 'their locked prices'}`);
    if (heldOnChanged > 0)
      parts.push(
        `keep ${plural(heldOnChanged, 'locked price', 'locked prices')} on the ${oneNounFor(heldOn.map(([l]) => l))[heldOn.length === 1 ? 0 : 1]} it changes`,
      );
    if (same.length > 0) parts.push(`keep ${countByKind(same)} already at the menu's price`);
  } else {
    // A plan's counts with no lines to count from (never sent by the gateway
    // today) still say what they can, in prices.
    if (c.change > 0) parts.push(`change ${plural(c.change, 'price', 'prices')}`);
    if (c.new_wine > 0) parts.push(`price the wines new to the house (${plural(c.new_wine, 'price', 'prices')})`);
    if (c.held_by_lock > 0)
      parts.push(`leave ${plural(c.held_by_lock, 'locked price', 'locked prices')} as ${c.held_by_lock === 1 ? 'it is' : 'they are'}`);
    if (c.unchanged > 0)
      parts.push(`keep ${plural(c.unchanged, 'price that already matches', 'prices that already match')} the menu`);
  }
  const lead = parts.length ? `Choosing this menu will ${listWords(parts)}.` : 'Choosing this menu changes no price.';
  const more: string[] = [];
  if (c.blank_kept > 0) more.push(`${plural(c.blank_kept, 'price is', 'prices are')} blank on the menu, so the house keeps the one it has, and the line carries a note saying so`);
  const unpriced = plan.lines.filter((l) => l.flag === 'blank_no_house_price').length;
  if (unpriced > 0) more.push(`${plural(unpriced, 'line shows', 'lines show')} no price and the house has none either, so it stays unpriced, and the line carries a note saying so`);
  const unmatchedLines = plan.lines.filter((l) => l.bottle.result === 'not_linked');
  const unmatched = unmatchedLines.length;
  if (unmatched > 0)
    more.push(`${plural(unmatched, 'line is', 'lines are')} not matched to a ${oneNounFor(unmatchedLines)[0]}, so no price`);
  const kitchen = plan.kitchenLines ?? [];
  if (kitchen.length > 0)
    more.push(
      `${plural(kitchen.length, 'kitchen line stays', 'kitchen lines stay')} on the menu and ${kitchen.length === 1 ? 'is' : 'are'} not carried (${kitchen.map((k) => k.name).join(', ')})`,
    );
  const removed = removedClause(plan.lines);
  if (removed) more.push(removed);
  const gone = plan.notOnThisFile ?? [];
  if (gone.length > 0)
    more.push(
      // A kitchen line is never in this list (computePlan keeps drinks only), and a drink is not always a wine.
      `${plural(gone.length, 'drink on the current menu is', 'drinks on the current menu are')} not on this file and ${gone.length === 1 ? 'keeps its' : 'keep their'} price`,
    );
  if (plan.dormantLocks.length > 0)
    more.push(
      `${plural(plan.dormantLocks.length, 'locked price is', 'locked prices are')} not on this menu and ${plan.dormantLocks.length === 1 ? 'stays' : 'stay'} locked`,
    );
  return more.length ? `${lead} ${more.join('; ')}.` : lead;
}

/** One drink that is not on this file, in a line: what it is and what the house keeps. */
export function notOnFileWords(n: NonNullable<Plan['notOnThisFile']>[number], currency: string | null = null): string {
  const name = [n.name, n.vintage].filter(Boolean).join(' ');
  if (!n.inventoryId) return `${name}: not on the house's list, so nothing is kept for it`;
  const kept = [
    n.bottle !== null ? `bottle ${money(n.bottle, currency)}` : null,
    n.glass !== null ? `glass ${money(n.glass, currency)}` : null,
  ].filter(Boolean);
  const locked = n.locked.length ? `, ${n.locked.join(' and ')} locked` : '';
  const gone = n.active === false ? 'the house no longer sells it; its row ' : '';
  return `${name}: ${gone}keeps ${kept.length ? kept.join(', ') : 'no price (it had none)'}${locked}`;
}

/** Who set the price that would be replaced, in words. */
function setWords(k: PlanKind, zone?: string | null): string {
  if (!k.lastSet) return '';
  const who = k.lastSet.by.name ?? (k.lastSet.by.userId ? 'someone whose name is not on record' : 'no person named');
  const how = k.lastSet.source === 'import' ? 'from a menu' : k.lastSet.source === 'agent_accepted' ? 'accepting advice' : 'by hand';
  return `set ${how} by ${who} on ${day(k.lastSet.at, zone)}${k.setAfterRead ? ', after this menu was read' : ''}`;
}

/**
 * The prices this menu would change or leaves held, a price a person set after
 * the menu was read FIRST (the founder's L11 confirmation), the rest in menu
 * order.
 */
export function orderedRows(lines: PlanLine[]): Row[] {
  const rows: Row[] = lines
    .flatMap((line) => [line.bottle, line.glass].map((k) => ({ line, k })))
    .filter((r) => r.k.result === 'change' || r.k.result === 'held_by_lock');
  return [...rows.filter((r) => r.k.setAfterRead === true), ...rows.filter((r) => r.k.setAfterRead !== true)];
}

/** One kind of one line, in the words of what choosing the menu does to it. */
export function kindWords(line: PlanLine, k: PlanKind, currency: string | null = null): string {
  switch (k.result) {
    case 'change':
      return `becomes ${money(k.menuPrice, currency)} (now ${money(k.housePrice, currency)})`;
    case 'unchanged':
      return `already ${money(k.housePrice, currency)}`;
    case 'held_by_lock':
      return `stays ${money(k.lock?.lockedPrice ?? k.housePrice, currency)}, locked`;
    case 'blank_kept':
      return `blank on the menu; the house keeps ${money(k.housePrice, currency)} (noted on the line)`;
    case 'blank_never_priced':
      return line.flag === 'blank_no_house_price' ? 'no price on the menu or at the house (noted on the line)' : EM;
    case 'not_linked':
      return 'not matched to a wine, so no price';
    case 'new_wine':
      return k.menuPrice === null ? EM : `new to the house at ${money(k.menuPrice, currency)}`;
    default:
      // A result this page does not know is still shown, never dropped.
      return String(k.result).replace(/_/g, ' ');
  }
}

export interface Row {
  line: PlanLine;
  k: PlanKind;
}

/** Beside a line's name when its house row is removed (r28 G9). */
function RemovedMark({ line }: { line: PlanLine }) {
  if (line.house?.active !== false) return null;
  return (
    <span className="cl-note" style={{ display: 'block' }} data-testid="menu-plan-removed">
      removed from Inventory; it stays removed
    </span>
  );
}

function KeepSwitch({
  row,
  canManage,
  onChanged,
}: {
  row: Row;
  canManage: boolean;
  onChanged: (said: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const held = row.k.result === 'held_by_lock';
  const act = useMutation({
    mutationFn: async () => {
      if (held && row.k.lock) return releasePriceLock(row.k.lock.lockId, 'released from the menu plan');
      if (!row.line.inventoryId) throw new Error('this line has no wine of the house to lock');
      return lockPrice(row.line.inventoryId, row.k.kind, 'kept from the menu plan');
    },
    onSuccess: (r) => {
      setError(null);
      onChanged(r.sentence);
    },
    onError: (e) => setError(reasonOf(e)),
  });
  if (!canManage) return <span className="cl-dim">{held ? 'Kept (locked)' : EM}</span>;
  // L2: a lock holds a price that exists. A kind the house has no price for
  // has nothing to keep (the gateway would answer 409 nothing_to_lock).
  if (!held && row.k.housePrice === null) return <span className="cl-dim">Nothing to keep yet</span>;
  return (
    <span>
      <button
        type="button"
        className="cl-btn cl-focus"
        data-on={held ? 'true' : 'false'}
        aria-pressed={held}
        disabled={act.isPending}
        onClick={() => act.mutate()}
        aria-label={`${held ? 'Let the menu set' : 'Keep'} the ${row.k.kind} price of ${row.line.name}`}
      >
        {act.isPending ? 'Saving…' : held ? 'Kept' : 'Keep'}
      </button>
      {error ? (
        <span role="alert" className="cl-note" style={{ display: 'block' }}>
          {error}
        </span>
      ) : null}
    </span>
  );
}

interface MenuPlanProps {
  menuId: string;
  canManage: boolean;
  /** Called with what the choice did, once it is made, and the plan's lines (to name them by kind). */
  onDone: (result: MakeCurrentResult, lines: PlanLine[]) => void;
  onCancel?: () => void;
}

/**
 * Where an opened plan stands on the page decides whether it is brought into
 * view: its top below 60% of the window, or above it, is out of the reader's
 * eye. A plan that opens where the reader is already looking is left still.
 */
export function planNeedsScroll(top: number, viewportHeight: number): boolean {
  return top < 0 || top > viewportHeight * 0.6;
}

/**
 * The plan, brought to the reader. Menu walk 2026-11-12: "Make current" on a
 * kept menu opened its plan under the list, below the fold, and nothing
 * moved, so the click looked like it did nothing. The plan now scrolls its top
 * into view when it opens (instantly for a reader who asked for reduced
 * motion), and its heading takes focus once it has been worked out, so a
 * keyboard or screen-reader user lands on it too.
 */
export function MenuPlan(props: MenuPlanProps) {
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = anchor.current;
    if (!el || typeof el.scrollIntoView !== 'function') return;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!planNeedsScroll(el.getBoundingClientRect().top, vh)) return;
    const reduce =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // 'instant', not 'auto': globals.css puts `scroll-smooth` on <html>,
    // so 'auto' would still glide for a reader who asked for reduced motion.
    el.scrollIntoView({ block: 'start', behavior: reduce ? 'instant' : 'smooth' });
  }, []);
  return (
    <div ref={anchor} data-testid="menu-plan-anchor" style={{ scrollMarginTop: 16 }}>
      <MenuPlanSheet {...props} />
    </div>
  );
}

function MenuPlanSheet({ menuId, canManage, onDone, onCancel }: MenuPlanProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const focused = useRef(false);
  const queryClient = useQueryClient();
  const [said, setSaid] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  const q = useQuery({ queryKey: ['menu', 'plan', menuId], queryFn: () => getMenuPlan(menuId) });
  const ready = !!q.data;
  useEffect(() => {
    if (!ready || focused.current || !heading.current) return;
    focused.current = true;
    heading.current.focus({ preventScroll: true });
  }, [ready]);
  const currency = useHouseCurrencyCode();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['menu', 'plan', menuId] });

  const choose = useMutation({
    mutationFn: (fingerprint: string) => makeMenuCurrent(menuId, fingerprint),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['menu'] });
      void queryClient.invalidateQueries({ queryKey: ['pricing', 'locks'] });
      onDone(r, q.data?.lines ?? []);
    },
    onError: (e) => {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        setMoved(true);
        refresh();
      } else if (!(e as { response?: unknown })?.response || (status ?? 0) >= 500) {
        // The switch may have happened: the standing and the plan are read again.
        void queryClient.invalidateQueries({ queryKey: ['menu'] });
      }
    },
  });

  if (q.isLoading) {
    return (
      <p className="cl-said" role="status" style={{ marginTop: 10 }}>
        Working out what choosing this menu would do…
      </p>
    );
  }
  if (q.isError || !q.data) {
    return (
      <p className="cl-said" role="alert" style={{ marginTop: 10 }} data-testid="menu-plan-error">
        What choosing this menu would do could not be worked out ({reasonOf(q.error)}), so it cannot be made current
        yet. Nothing has changed.
      </p>
    );
  }
  const plan = q.data;
  const replacing = orderedRows(plan.lines);
  const typedAfter = replacing.filter((r) => r.k.setAfterRead === true).length;
  const returned = plan.lines.filter((l) => l.returned);
  const mismatched = plan.lines.filter((l) => l.vintageMismatch);

  return (
    <section className="cl-panel" style={{ marginTop: 12 }} aria-labelledby={`plan-h-${menuId}`} data-testid="menu-plan">
      <h3 id={`plan-h-${menuId}`} ref={heading} tabIndex={-1} className="cl-crumb" style={{ margin: 0 }}>
        {plan.current ? 'Before its prices are carried again' : 'Before it becomes current'}
      </h3>
      <p className="cl-standing" style={{ marginTop: 6 }} data-testid="menu-plan-sentence">
        {planSentence(plan)}
      </p>
      {moved ? (
        <p role="status" className="cl-said" style={{ marginTop: 6 }} data-testid="menu-plan-moved">
          A price or a lock changed since this was shown, so nothing was changed. Here it is again.
        </p>
      ) : null}
      {(() => {
        const clock = plan.timezone === undefined ? null : deviceClockNote(plan.timezone, plan.timezoneReason);
        return clock ? <p className="cl-note" data-testid="menu-plan-clock">{clock}</p> : null;
      })()}
      {!plan.namesReadable ? (
        <p className="cl-note">Some names could not be read ({plan.namesReason}). The prices below are exact.</p>
      ) : null}

      {replacing.length > 0 ? (
        <>
          <p className="cl-said" style={{ marginTop: 12 }}>
            {canManage
              ? 'Prices this menu would change. Keep one to hold it at the house price: no menu changes it until an owner or a manager does.'
              : 'Prices this menu would change. An owner or a manager can keep one as it is.'}
          </p>
          {typedAfter > 0 ? (
            <p className="cl-said" style={{ marginTop: 6 }} data-testid="menu-plan-typed-after">
              {plural(typedAfter, 'price was', 'prices were')} set by a person after this menu was read
              {plan.readAt ? ` (${day(plan.readAt, plan.timezone)})` : ''}. This menu would replace {typedAfter === 1 ? 'it' : 'them'}, so{' '}
              {typedAfter === 1 ? 'it is' : 'they are'} listed first{canManage ? ': keep one to hold it' : ''}.
            </p>
          ) : null}
          <div style={{ overflowX: 'auto', border: '1px solid var(--paper-2)', borderRadius: 10, marginTop: 8 }}>
            <table className="cl-table" style={{ width: '100%' }} data-testid="menu-plan-prices">
              <thead>
                <tr>
                  <th>Wine</th>
                  <th>Price</th>
                  <th>House now</th>
                  <th>This menu</th>
                  <th>What happens</th>
                  <th>Keep</th>
                </tr>
              </thead>
              <tbody>
                {replacing.map((r) => (
                  <tr
                    key={`${r.line.menuItemId}:${r.k.kind}`}
                    data-testid="menu-plan-row"
                    data-after-read={r.k.setAfterRead === true ? 'true' : 'false'}
                  >
                    <td>
                      {r.line.name}
                      <RemovedMark line={r.line} />
                    </td>
                    <td className="cl-dim">{r.k.kind}</td>
                    <td>{money(r.k.housePrice, currency)}</td>
                    <td>{money(r.k.menuPrice, currency)}</td>
                    <td className="cl-dim">
                      {r.k.result === 'held_by_lock' && r.k.lock
                        ? `Stays ${money(r.k.lock.lockedPrice, currency)}: locked by ${r.k.lock.lockedBy.name ?? 'someone whose name is not on record'} on ${day(r.k.lock.lockedAt, plan.timezone)}`
                        : `Becomes ${money(r.k.menuPrice, currency)}${setWords(r.k, plan.timezone) ? `; it was ${setWords(r.k, plan.timezone)}` : ''}`}
                    </td>
                    <td>
                      <KeepSwitch
                        row={r}
                        canManage={canManage}
                        onChanged={(s) => {
                          setSaid(s);
                          setMoved(false);
                          refresh();
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {returned.length > 0 || mismatched.length > 0 ? (
        <ul className="cl-said" style={{ marginTop: 10, paddingLeft: 18 }} data-testid="menu-plan-returned">
          {returned.map((l) => (
            <li key={`r-${l.menuItemId}`}>
              {l.name} comes back with this menu and its lock still holds
              {l.house?.wineName ? ` (the house's ${l.house.wineName}${l.house.vintage ? ` ${l.house.vintage}` : ''})` : ''}.
            </li>
          ))}
          {mismatched.map((l) => (
            <li key={`v-${l.menuItemId}`} role="note">
              Check this one: the menu reads {l.name}
              {l.vintage ? ` ${l.vintage}` : ''}, and the locked wine it is linked to is the {l.house?.vintage ?? 'unknown'} vintage.
            </li>
          ))}
        </ul>
      ) : null}

      {plan.lines.length > 0 ? (
        <details style={{ marginTop: 12 }} data-testid="menu-plan-every-line">
          <summary className="cl-said cl-focus" style={{ cursor: 'pointer' }}>
            Every line on this menu ({plan.lines.length})
          </summary>
          <div style={{ overflowX: 'auto', border: '1px solid var(--paper-2)', borderRadius: 10, marginTop: 8 }}>
            <table className="cl-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Wine</th>
                  <th>Bottle</th>
                  <th>Glass</th>
                </tr>
              </thead>
              <tbody>
                {plan.lines.map((l) => (
                  <tr key={`all-${l.menuItemId}`} data-testid="menu-plan-line">
                    <td>
                      {l.name}
                      {l.vintage ? ` ${l.vintage}` : ''}
                      <RemovedMark line={l} />
                    </td>
                    <td className="cl-dim">{kindWords(l, l.bottle, currency)}</td>
                    <td className="cl-dim">{kindWords(l, l.glass, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      {(plan.notOnThisFile ?? []).length > 0 ? (
        <div style={{ marginTop: 12 }} data-testid="menu-plan-not-on-file">
          <p className="cl-said">
            Not on this file: what the current menu lists and this one does not. Choosing it leaves{' '}
            {(plan.notOnThisFile ?? []).length === 1 ? 'it as it is' : 'them as they are'}: the price, the
            house&apos;s row and any lock stay.
          </p>
          <ul className="cl-said" style={{ paddingLeft: 18, marginTop: 4 }}>
            {(plan.notOnThisFile ?? []).map((n) => (
              <li key={n.menuItemId} data-testid="menu-plan-not-on-file-line">
                {notOnFileWords(n, currency)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan.dormantLocks.length > 0 ? (
        <div style={{ marginTop: 12 }} data-testid="menu-plan-dormant">
          <p className="cl-said">Locked, and not on this menu. They stay locked and unchanged:</p>
          <ul className="cl-said" style={{ paddingLeft: 18, marginTop: 4 }}>
            {plan.dormantLocks.map((d) => (
              <li key={d.lockId}>
                {d.wineName ?? 'A wine'} ({d.kind}) at {money(d.lockedPrice, currency)}
                {d.active === false ? ', removed from inventory' : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {said ? (
        <p role="status" className="cl-said" style={{ marginTop: 8 }}>
          {said}
        </p>
      ) : null}

      <div className="cl-row-controls" style={{ marginTop: 14 }}>
        {canManage && (!plan.current || plan.counts.change + plan.counts.new_wine > 0) ? (
          <button
            type="button"
            className="cl-btn cl-ink cl-focus"
            disabled={choose.isPending}
            onClick={() => choose.mutate(plan.fingerprint)}
          >
            {plan.current
              ? choose.isPending
                ? 'Carrying its prices…'
                : 'Carry its prices again'
              : choose.isPending
                ? 'Making it current…'
                : 'Make it current'}
          </button>
        ) : null}
        {onCancel ? (
          <button type="button" className="cl-btn cl-focus" onClick={onCancel} disabled={choose.isPending}>
            Not now
          </button>
        ) : null}
      </div>
      {!canManage ? (
        <p className="cl-note">An owner or a manager chooses the current menu. Every price here is read at this house only.</p>
      ) : (
        <p className="cl-note">A lock holds a price at this house only.</p>
      )}
      {choose.isError && !moved ? (
        <p role="alert" className="cl-said" style={{ marginTop: 8 }}>
          {chooseFailedSentence(choose.error, plan.current)}
        </p>
      ) : null}
    </section>
  );
}

export default MenuPlan;
