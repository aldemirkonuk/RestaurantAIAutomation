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
 *
 * ONE LIVE MENU PER KIND (ADR 0340, lane 6). A read can make a draft per kind
 * (Drinks, Food, Desserts), and they are reviewed together: the plan is asked
 * for the batch (`?menuIds=`), and the review reads in rule 18's order, the
 * counts up front:
 *   1. Conflicts, blocking: one wine at two prices; the owner picks one
 *      (rule 19; a pick is held here and sent with "Make live").
 *   2. Unsure, blocking: one tap per section (Drink and its category, Food,
 *      Dessert), the lines a section answer left one tap each.
 *   3. Price changed: the L13 table above (set-after-read first, Keep), and a
 *      dish beside the same dish on its kind's live menu.
 *   4. New. 5. Gone, with Keep (a button, and a swipe right).
 *   6. Same as last time and Unchanged, collapsed.
 * A kind strip above the groups moves a section between the read's drafts
 * (KindStrip.tsx). One tap makes every ready kind live; a kind still blocked
 * is left as a draft with one tap, and the plan is read again without it, so
 * the fingerprint sent is the plan shown (the gateway refuses a batch with
 * any Unsure line, 400).
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  confirmMenuLine,
  confirmMenuSection,
  getMenuPlan,
  isMenuKind,
  keepGoneLine,
  kindName,
  listMenuSections,
  makeMenuCurrent,
  moveMenuSection,
  type GoneLine,
  type MakeCurrentResult,
  type MakeLiveBatch,
  type MenuKind,
  type MenuPlan as Plan,
  type MenuSection,
  type PlanKind,
  type PlanLine,
  type PlanMenu,
  type UnsureLine,
} from '../../../services/api/menus';
import { MENU_KINDS as DRINK_CATEGORIES } from '../../../lib/firstProof';
import { ConflictPick, conflictKey } from './PricePick';
import { KindStrip, type MovableSection, type StripKind } from './KindStrip';
import { lockPrice, releasePriceLock } from '../../../services/api/pricing';
import { dateIn } from '../../dashboard/next/format';
import { formatMoney } from '../../../lib/currency';
// Drawn with the cellar's classes wherever it is shown (/menu and onboarding).
import '../../cellar/next/cellar-next.css';

const EM = '—';

/**
 * Money printed the way /menu's line table prints it: the house's currency,
 * in the screen's own marks (F-919). It was a bare `toFixed(2)`, so one screen
 * read "₺1.250,00" in the table and "1250.00" here. With no currency handed in
 * (a caller outside /menu), the number alone, still in the screen's marks.
 */
function money(n: number | null | undefined, currency?: string | null): string {
  if (n === null || n === undefined) return EM;
  return currency === undefined
    ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : formatMoney(n, currency);
}

/**
 * The house's day for a moment (F-699). With no zone recorded for the house,
 * the day as stored, so a reader's own clock never stands in for the house's.
 */
function day(iso: string | null | undefined, zone: string | null | undefined): string {
  if (!iso) return 'an unknown day';
  const d = new Date(iso);
  return zone && !Number.isNaN(d.getTime()) ? dateIn(d, zone) : String(iso).slice(0, 10);
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

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * What leaves with the menu this choice ends (F-696): the house has one current
 * menu, so choosing this one takes the other off, every line on it included.
 */
export function retiringSentence(plan: Pick<Plan, 'retiring'> & Partial<Pick<Plan, 'menus'>>): string | null {
  const off = plan.retiring ?? [];
  if (off.length === 0) return null;
  const each = off.map((m) => {
    const kind = kindName(m.kind);
    const what = m.name ?? (kind ? `the live ${kind} menu` : 'the current menu');
    return `${what} off: its ${plural(m.lines, 'line leaves', 'lines leave')} the menu`;
  });
  const lead = (plan.menus?.length ?? 0) > 1 ? 'Making these menus live takes' : 'Choosing this menu takes';
  // ADR 0340 rule 1: one live menu of each kind; a Food menu never ends the Drinks one.
  return `${lead} ${each.join('; and ')}. A house has one current menu of each kind.`;
}

/** The plan in one sentence, in the order a person reads a menu change. */
export function planSentence(plan: Pick<Plan, 'counts' | 'dormantLocks' | 'current' | 'lines'> & Partial<Pick<Plan, 'retiring' | 'menus'>>): string {
  if (plan.current) return 'This is already the current menu. Choosing it again changes nothing.';
  const off = retiringSentence(plan);
  const prices = pricesSentence(plan);
  return off ? `${off} ${prices}` : prices;
}

function pricesSentence(plan: Pick<Plan, 'counts' | 'dormantLocks' | 'lines'>): string {
  const c = plan.counts;
  const parts: string[] = [];
  if (c.change > 0) parts.push(`set ${plural(c.change, 'price', 'prices')} from this menu`);
  if (c.new_wine > 0) parts.push(`add ${plural(c.new_wine, 'price', 'prices')} for wines new to the house`);
  if (c.held_by_lock > 0)
    parts.push(`leave ${plural(c.held_by_lock, 'locked price', 'locked prices')} as ${c.held_by_lock === 1 ? 'it is' : 'they are'}`);
  if (c.unchanged > 0) parts.push(`find ${plural(c.unchanged, 'price', 'prices')} already the same`);
  const lead = parts.length ? `Choosing this menu will ${parts.join(', ')}.` : 'Choosing this menu changes no price.';
  const more: string[] = [];
  if (c.blank_kept > 0) more.push(`${plural(c.blank_kept, 'price is', 'prices are')} blank on the menu, so the house keeps its own (flagged)`);
  const unpriced = plan.lines.filter((l) => l.flag === 'blank_no_house_price').length;
  if (unpriced > 0) more.push(`${plural(unpriced, 'line shows', 'lines show')} no price and the house has none either (flagged)`);
  const unmatched = plan.lines.filter((l) => l.bottle.result === 'not_linked').length;
  if (unmatched > 0) more.push(`${plural(unmatched, 'line is', 'lines are')} not matched to a wine, so no price`);
  // A food line is set aside, not an unmatched wine (F-1297).
  const kitchen = plan.lines.filter((l) => l.bottle.result === 'kitchen').length;
  if (kitchen > 0) more.push(`${plural(kitchen, 'kitchen line', 'kitchen lines')} set aside, with no price`);
  // A cocktail is made from its recipe, not kept in stock (F-1470).
  const cocktails = plan.lines.filter((l) => l.bottle.result === 'cocktail').length;
  if (cocktails > 0)
    more.push(`${plural(cocktails, 'cocktail is', 'cocktails are')} made from ${cocktails === 1 ? 'its recipe' : 'their recipes'}, so ${cocktails === 1 ? 'it gets' : 'they get'} no stock row and no price here`);
  if (plan.dormantLocks.length > 0)
    more.push(
      `${plural(plan.dormantLocks.length, 'locked price is', 'locked prices are')} not on this menu and ${plan.dormantLocks.length === 1 ? 'stays' : 'stay'} locked`,
    );
  return more.length ? `${lead} ${more.join('; ')}.` : lead;
}

/** Who set the price that would be replaced, in words. */
function setWords(k: PlanKind, zone: string | null | undefined): string {
  if (!k.lastSet) return '';
  const who = k.lastSet.by.name ?? (k.lastSet.by.userId ? 'someone whose name is not on record' : 'no person named');
  // 'menu_current' (S202): a menu made current; 'import': a menu line. Both are a menu, not a hand.
  const how =
    k.lastSet.source === 'import' || k.lastSet.source === 'menu_current'
      ? 'from a menu'
      : k.lastSet.source === 'agent_accepted'
        ? 'accepting advice'
        : 'by hand';
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
export function kindWords(line: PlanLine, k: PlanKind, currency?: string | null): string {
  switch (k.result) {
    case 'change':
      return `becomes ${money(k.menuPrice, currency)} (now ${money(k.housePrice, currency)})`;
    case 'unchanged':
      return `already ${money(k.housePrice, currency)}`;
    case 'held_by_lock':
      return `stays ${money(k.lock?.lockedPrice ?? k.housePrice, currency)}, locked`;
    case 'blank_kept':
      return `blank on the menu; the house keeps ${money(k.housePrice, currency)} (flagged)`;
    case 'blank_never_priced':
      return line.flag === 'blank_no_house_price' ? 'no price on the menu or at the house (flagged)' : EM;
    case 'not_linked':
      return 'not matched to a wine, so no price';
    case 'kitchen':
      return 'a kitchen line, set aside';
    case 'cocktail':
      return 'a cocktail, made from its recipe; priced on /cocktails';
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

/** Unsure lines, grouped by the section they are in (one tap per section, rule 18); a line with no section stands alone. */
export interface UnsureGroup {
  menuId: string;
  sectionId: string | null;
  title: string;
  lines: UnsureLine[];
}

export function unsureGroups(
  unsure: UnsureLine[],
  lines: PlanLine[],
  sections: MenuSection[],
): UnsureGroup[] {
  const sectionOf = new Map(lines.map((l) => [l.menuItemId, l.sectionId ?? null]));
  const titleOf = new Map(sections.map((s) => [s.id, s.title]));
  const out = new Map<string, UnsureGroup>();
  for (const u of unsure) {
    const sectionId = sectionOf.get(u.menuItemId) ?? null;
    const key = sectionId ? `s:${sectionId}` : `l:${u.menuItemId}`;
    const g = out.get(key);
    if (g) g.lines.push(u);
    else
      out.set(key, {
        menuId: u.menuId,
        sectionId,
        title: sectionId ? (titleOf.get(sectionId) ?? 'A section') : u.name,
        lines: [u],
      });
  }
  return [...out.values()];
}

/** "2 sections, 3 lines to check": what the Unsure group asks, counted up front. */
export function unsureWords(groups: UnsureGroup[]): string {
  const sections = groups.filter((g) => g.sectionId !== null).length;
  const lines = groups.reduce((n, g) => n + g.lines.length, 0);
  return sections > 0
    ? `${plural(sections, 'section', 'sections')}, ${plural(lines, 'line', 'lines')} to check`
    : `${plural(lines, 'line', 'lines')} to check`;
}

/** A batch menu that cannot go live yet: an Unsure line on a draft (a current menu blocks nothing). */
export function blockedMenus(menus: PlanMenu[]): PlanMenu[] {
  return menus.filter((m) => !m.current && m.unsure > 0);
}

/** The review's counts, in rule 18's order: what to answer first, then what will change. */
export function reviewCounts(plan: Plan, groups: UnsureGroup[]): string {
  const parts: string[] = [];
  const conflicts = plan.conflicts ?? [];
  if (conflicts.length > 0) parts.push(`${plural(conflicts.length, 'wine', 'wines')} at two prices to pick`);
  if (groups.length > 0) parts.push(unsureWords(groups));
  const changed = orderedRows(plan.lines).filter((r) => r.k.result === 'change').length + changedDishes(plan.lines).length;
  if (changed > 0) parts.push(`${plural(changed, 'price', 'prices')} changed`);
  const fresh = newLines(plan.lines).length;
  if (fresh > 0) parts.push(`${fresh} new`);
  const gone = plan.gone ?? [];
  if (gone.length > 0) parts.push(`${gone.length} gone`);
  return parts.join(' · ');
}

/** A dish whose price differs from the same dish on its kind's live menu (by section key and name). */
export function changedDishes(lines: PlanLine[]): PlanLine[] {
  return lines.filter((l) => l.dish?.changed === true);
}

/** A line new to the house's menu: a wine new to the house, or a dish no live menu of its kind lists. */
export function newLines(lines: PlanLine[]): PlanLine[] {
  return lines.filter(
    (l) => l.bottle.result === 'new_wine' || l.glass.result === 'new_wine' || (l.lineKind === 'dish' && !l.dish),
  );
}

/** The make-live call for what the review holds: one menu as before, or the batch with its picks. */
export function makeLiveArgs(
  ids: string[],
  picks: Record<string, number>,
  conflicts: Plan['conflicts'],
  partOk: boolean,
  partKinds: MenuKind[],
): { menuId: string; partReadAccepted: boolean; batch: MakeLiveBatch | undefined } {
  const [menuId, ...others] = ids;
  const answered = (conflicts ?? [])
    .filter((c) => picks[conflictKey(c)] !== undefined)
    .map((c) => ({ wineLibraryId: c.wineLibraryId, kind: c.kind, price: picks[conflictKey(c)] }));
  if (others.length === 0 && answered.length === 0) return { menuId, partReadAccepted: partOk, batch: undefined };
  return {
    menuId,
    partReadAccepted: others.length === 0 && partOk,
    batch: {
      menuIds: others,
      picks: answered,
      partReadAcceptedKinds: others.length === 0 ? [] : partKinds,
    },
  };
}

/** The live line not on this read stays when kept: a button, and a swipe right on a touch screen. */
function GoneRow({ g, draftId, canManage, onKept }: {
  g: GoneLine;
  draftId: string | null;
  canManage: boolean;
  onKept: (said: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const start = useRef<number | null>(null);
  const keep = useMutation({
    mutationFn: () => keepGoneLine(draftId as string, g.menuItemId),
    onSuccess: () => {
      setError(null);
      const kind = kindName(g.kind);
      onKept(`${g.name} stays: it is on the ${kind ? `${kind} ` : ''}draft now.`);
    },
    onError: (e) => setError(reasonOf(e)),
  });
  const canKeep = canManage && draftId !== null;
  return (
    <li
      data-testid="menu-plan-gone-line"
      onPointerDown={canKeep ? (e) => (start.current = e.clientX) : undefined}
      onPointerUp={
        canKeep
          ? (e) => {
              const from = start.current;
              start.current = null;
              if (from !== null && e.clientX - from > 64 && !keep.isPending) keep.mutate();
            }
          : undefined
      }
      style={{ touchAction: 'pan-y', padding: '2px 0' }}
    >
      {g.name}
      {kindName(g.kind) ? <span className="cl-dim"> · {kindName(g.kind)}</span> : null}{' '}
      {canKeep ? (
        <button
          type="button"
          className="cl-btn cl-focus"
          disabled={keep.isPending}
          onClick={() => keep.mutate()}
          aria-label={`Keep ${g.name} on the menu`}
        >
          {keep.isPending ? 'Keeping…' : 'Keep'}
        </button>
      ) : null}
      {error ? (
        <span role="alert" className="cl-note" style={{ display: 'block' }}>
          {error}
        </span>
      ) : null}
    </li>
  );
}

/** One tap for an Unsure section (or a lone line): Drink with its category, Food, or Dessert. */
function UnsureAnswer({ group, menuKind, onAnswered, onMoved }: {
  group: UnsureGroup;
  menuKind: MenuKind | null;
  onAnswered: (said: string) => void;
  /** A section moved to another kind's draft (a missing one is made): the batch gains it. */
  onMoved: (menuId: string) => void;
}) {
  const [category, setCategory] = useState('');
  const [error, setError] = useState<string | null>(null);
  const answer = useMutation({
    mutationFn: async (to: 'drink' | 'food' | 'desserts') => {
      const kind: MenuKind = to === 'drink' ? 'beverage' : to;
      const lineKind = to === 'drink' ? 'drink' : 'dish';
      const drinkCategory = to === 'drink' ? category : undefined;
      if (group.sectionId === null) {
        // A line with no section answers alone, on its own menu (a line moves with a section only).
        const only = group.lines[0];
        await confirmMenuLine(only.menuId, only.menuItemId, lineKind, drinkCategory);
        return `${group.title}: ${to === 'drink' ? `a drink (${category})` : 'a dish'}.`;
      }
      let menuId = group.menuId;
      if (menuKind !== kind) {
        const moved = await moveMenuSection(menuId, group.sectionId, kind);
        menuId = moved.menu_id;
        onMoved(menuId);
      }
      const r = await confirmMenuSection(menuId, group.sectionId, lineKind, drinkCategory);
      const left = r.left_line_ids.length;
      return `${group.title} is ${kindName(kind)}${to === 'drink' ? ` (${category})` : ''}${
        left > 0 ? `; ${plural(left, 'line', 'lines')} in it still to check one by one` : ''
      }.`;
    },
    onSuccess: (said) => {
      setError(null);
      onAnswered(said);
    },
    onError: (e) => setError(reasonOf(e)),
  });
  const id = `unsure-cat-${group.sectionId ?? group.lines[0].menuItemId}`;
  return (
    <li data-testid="menu-plan-unsure-group" style={{ marginTop: 6 }}>
      <span>
        {group.title}
        <span className="cl-dim">
          {' '}
          · {kindName(menuKind) ?? 'a draft'} · {plural(group.lines.length, 'line', 'lines')}
          {group.sectionId !== null ? `: ${group.lines.map((l) => l.name).join(', ')}` : ''}
        </span>
      </span>
      <span className="cl-row-controls" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4, alignItems: 'center' }}>
        <label className="cl-dim" htmlFor={id} style={{ fontSize: 12 }}>
          Drink
        </label>
        <select id={id} className="cl-field cl-focus" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">which kind of drink</option>
          {DRINK_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="cl-btn cl-focus"
          disabled={answer.isPending || !category}
          onClick={() => answer.mutate('drink')}
        >
          Drink
        </button>
        <button type="button" className="cl-btn cl-focus" disabled={answer.isPending} onClick={() => answer.mutate('food')}>
          {group.sectionId !== null ? 'Food' : 'Dish'}
        </button>
        {group.sectionId !== null ? (
          <button type="button" className="cl-btn cl-focus" disabled={answer.isPending} onClick={() => answer.mutate('desserts')}>
            Dessert
          </button>
        ) : null}
      </span>
      {error ? (
        <span role="alert" className="cl-note" style={{ display: 'block' }}>
          {error}
        </span>
      ) : null}
    </li>
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

export function MenuPlan({
  menuId,
  batchIds = [],
  canManage,
  onDone,
  onCancel,
  currency,
}: {
  menuId: string;
  /** The read's other drafts, one per kind, reviewed and made live with this one (ADR 0340 rule 20). */
  batchIds?: string[];
  canManage: boolean;
  /** The house's currency, as /menu read it for its line table. */
  currency?: string | null;
  /** Called with what the choice did, once it is made. */
  onDone: (result: MakeCurrentResult) => void;
  onCancel?: () => void;
}) {
  const queryClient = useQueryClient();
  const [said, setSaid] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  /**
   * The house never answered (the page stopped waiting, or the connection
   * dropped) or answered with its own failure: the switch may have happened
   * (F-448). The plan is read again and says which, never "nothing changed".
   */
  const [unsure, setUnsure] = useState(false);
  /** The person said a menu read only in part may still be made current (F-1292). */
  const [partOk, setPartOk] = useState(false);
  /** Kinds a part-read was accepted for, in a batch (rule 17). */
  const [partKinds, setPartKinds] = useState<MenuKind[]>([]);
  /** The owner's pick per conflict (rule 19): held here, sent with make-live. */
  const [picks, setPicks] = useState<Record<string, number>>({});
  /** Drafts left out of this make-live (a blocked kind), and drafts a section move made. */
  const [left, setLeft] = useState<Array<{ menuId: string; kind: string | null }>>([]);
  const [added, setAdded] = useState<string[]>([]);
  const [moving, setMoving] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const ids = [...new Set([menuId, ...batchIds, ...added])].filter((id) => !left.some((l) => l.menuId === id));
  const lead = ids[0] ?? menuId;
  const others = ids.slice(1);
  const planKey = others.length > 0 ? ['menu', 'plan', lead, ...others] : ['menu', 'plan', lead];
  const q = useQuery({ queryKey: planKey, enabled: ids.length > 0, queryFn: () => getMenuPlan(lead, others) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['menu', 'plan'] });

  // The sections of each draft of the batch: titles for the Unsure taps, the
  // kind strip's moves, and "Same as last time" (rule 18). Read only where the
  // gateway says which menus are in the batch, and only for an owner or a
  // manager (the sections routes refuse anyone else).
  const drafts = (q.data?.menus ?? []).filter((m) => !m.current);
  const sectionReads = useQueries({
    queries: drafts.map((m) => ({
      queryKey: ['menu', 'sections', m.menuId],
      enabled: canManage,
      queryFn: () => listMenuSections(m.menuId),
    })),
  });
  const sections: MenuSection[] = sectionReads.flatMap((r) => r.data ?? []);
  const sectionsUnread = sectionReads.some((r) => r.isError);
  const refreshAll = () => {
    refresh();
    void queryClient.invalidateQueries({ queryKey: ['menu', 'sections'] });
  };

  const move = useMutation({
    mutationFn: (v: { section: MovableSection; kind: MenuKind }) => moveMenuSection(v.section.menuId, v.section.id, v.kind),
    onMutate: (v) => {
      setMoving(v.section.id);
      setMoveError(null);
    },
    onSuccess: (r, v) => {
      if (!ids.includes(r.menu_id)) setAdded((a) => [...a, r.menu_id]);
      setSaid(
        `${v.section.title} moved to ${kindName(v.kind)}${r.created_menu ? `, on a new ${kindName(v.kind)} draft` : ''}.`,
      );
      refreshAll();
    },
    onError: (e) => setMoveError(reasonOf(e)),
    onSettled: () => setMoving(null),
  });

  const choose = useMutation({
    mutationFn: (fingerprint: string) => {
      const a = makeLiveArgs(ids, picks, q.data?.conflicts, partOk, partKinds);
      if (a.batch) return makeMenuCurrent(a.menuId, fingerprint, a.partReadAccepted, a.batch);
      return a.partReadAccepted ? makeMenuCurrent(a.menuId, fingerprint, true) : makeMenuCurrent(a.menuId, fingerprint);
    },
    onMutate: () => setUnsure(false),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['menu'] });
      void queryClient.invalidateQueries({ queryKey: ['pricing', 'locks'] });
      onDone(r);
    },
    onError: (e) => {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        setMoved(true);
        refresh();
      } else if (status === undefined || status >= 500) {
        setUnsure(true);
        void queryClient.invalidateQueries({ queryKey: ['menu'] });
      }
    },
  });

  // Seconds since "Make it current" was pressed (F-069). The gateway answers
  // once, at the end, so there is no true progress to show; the count says
  // the work is still going rather than leaving a label that looks stuck.
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!choose.isPending) return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [choose.isPending]);

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
  const menus = plan.menus ?? [];
  const batch = menus.length > 1;
  const conflicts = plan.conflicts ?? [];
  const gone = plan.gone ?? [];
  const groups = unsureGroups(plan.unsure ?? [], plan.lines, sections);
  const blocked = blockedMenus(menus);
  const unpicked = conflicts.filter((c) => picks[conflictKey(c)] === undefined).length;
  const kindOf = (id: string): MenuKind | null => {
    const k = menus.find((m) => m.menuId === id)?.kind;
    return isMenuKind(k) ? k : null;
  };
  const partReads = menus.filter((m) => !m.current && m.partRead);
  const partUnaccepted = batch
    ? partReads.filter((m) => !(isMenuKind(m.kind) && partKinds.includes(m.kind))).length > 0
    : !!plan.partRead && !partOk;
  const draftOf = (kind: string | null) => menus.find((m) => !m.current && m.kind === kind)?.menuId ?? null;
  const fmt = (v: number | null) => money(v, currency);
  const strip: StripKind[] = drafts
    .filter((m) => isMenuKind(m.kind))
    .map((m) => ({ kind: m.kind as MenuKind, count: m.lines, menuId: m.menuId }));
  const movable: MovableSection[] = sections
    .filter((sct) => sct.parent_id === null && kindOf(sct.menu_id) !== null)
    .map((sct) => ({
      id: sct.id,
      title: sct.title,
      menuId: sct.menu_id,
      kind: kindOf(sct.menu_id) as MenuKind,
      lines: plan.lines.filter((l) => l.sectionId === sct.id).length,
    }));
  const same = sections.filter((sct) => sct.inherited_from_section_id !== null);
  const counted = reviewCounts(plan, groups);
  const liveNames = menus.filter((m) => !m.current).map((m) => kindName(m.kind) ?? 'a menu');
  const replacing = orderedRows(plan.lines);
  const typedAfter = replacing.filter((r) => r.k.setAfterRead === true).length;
  const returned = plan.lines.filter((l) => l.returned);
  const mismatched = plan.lines.filter((l) => l.vintageMismatch);

  return (
    <section className="cl-panel" style={{ marginTop: 12 }} aria-labelledby={`plan-h-${menuId}`} data-testid="menu-plan">
      <h3 id={`plan-h-${menuId}`} className="cl-crumb" style={{ margin: 0 }}>
        Before it becomes current
      </h3>
      <p className="cl-standing" style={{ marginTop: 6 }} data-testid="menu-plan-sentence">
        {planSentence(plan)}
      </p>
      {counted ? (
        <p className="cl-said" style={{ marginTop: 4 }} data-testid="menu-plan-counts">
          {counted}
        </p>
      ) : null}
      {strip.length > 0 && (batch || movable.length > 0) ? (
        <KindStrip
          kinds={strip}
          sections={movable}
          canMove={canManage}
          moving={moving}
          onMove={(section, kind) => move.mutate({ section, kind })}
        />
      ) : null}
      {moveError ? (
        <p role="alert" className="cl-said" style={{ marginTop: 6 }}>
          That section did not move: {moveError}.
        </p>
      ) : null}
      {canManage && sectionsUnread ? (
        <p className="cl-note" role="alert">
          The sections of this read could not be read, so lines are shown one by one.
        </p>
      ) : null}

      {conflicts.length > 0 ? (
        <div style={{ marginTop: 12 }} data-testid="menu-plan-conflicts">
          <p className="cl-said">
            {plural(conflicts.length, 'wine is', 'wines are')} at two prices across what would be live. A wine has one
            price, so {canManage ? 'pick the one it has' : 'an owner or a manager picks the one it has'} before these go live:
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {conflicts.map((c) => (
              <ConflictPick
                key={conflictKey(c)}
                conflict={c}
                picked={picks[conflictKey(c)] ?? null}
                canPick={canManage}
                onPick={(price) => setPicks((p) => ({ ...p, [conflictKey(c)]: price }))}
                fmt={fmt}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {groups.length > 0 ? (
        <div style={{ marginTop: 12 }} data-testid="menu-plan-unsure-lines">
          <p className="cl-said">
            Unsure, {unsureWords(groups)}: the read could not tell what {groups.length === 1 ? 'this is' : 'these are'}.
            {canManage ? ' One tap per section says it.' : ' An owner or a manager says it.'}
          </p>
          {canManage ? (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {groups.map((g) => (
                <UnsureAnswer
                  key={g.sectionId ?? g.lines[0].menuItemId}
                  group={g}
                  menuKind={kindOf(g.menuId)}
                  onMoved={(id) => {
                    if (!ids.includes(id)) setAdded((a) => [...a, id]);
                  }}
                  onAnswered={(s) => {
                    setSaid(s);
                    setMoved(false);
                    refreshAll();
                  }}
                />
              ))}
            </ul>
          ) : (
            <ul className="cl-said" style={{ paddingLeft: 18 }}>
              {groups.map((g) => (
                <li key={g.sectionId ?? g.lines[0].menuItemId}>
                  {g.title} ({plural(g.lines.length, 'line', 'lines')})
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {moved ? (
        <p role="status" className="cl-said" style={{ marginTop: 6 }} data-testid="menu-plan-moved">
          A price or a lock changed since this was shown, so nothing was changed. Here it is again.
        </p>
      ) : null}
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
                    <td>{r.line.name}</td>
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

      {changedDishes(plan.lines).length > 0 ? (
        <ul className="cl-said" style={{ marginTop: 10, paddingLeft: 18 }} data-testid="menu-plan-dishes">
          {changedDishes(plan.lines).map((l) => (
            <li key={`d-${l.menuItemId}`}>
              {l.name}
              {kindName(l.menuKind) ? ` (${kindName(l.menuKind)})` : ''}: {fmt(l.dish?.livePrice ?? null)} on the live menu,{' '}
              {fmt(l.dish?.price ?? null)} on this one
            </li>
          ))}
        </ul>
      ) : null}

      {newLines(plan.lines).length > 0 && (batch || menus.length > 0) ? (
        <details style={{ marginTop: 12 }} data-testid="menu-plan-new" open={newLines(plan.lines).length <= 12}>
          <summary className="cl-said cl-focus" style={{ cursor: 'pointer' }}>
            New ({newLines(plan.lines).length})
          </summary>
          <ul className="cl-said" style={{ paddingLeft: 18, marginTop: 4 }}>
            {newLines(plan.lines).map((l) => (
              <li key={`n-${l.menuItemId}`}>
                {l.name}
                {kindName(l.menuKind) ? <span className="cl-dim"> · {kindName(l.menuKind)}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {gone.length > 0 ? (
        <div style={{ marginTop: 12 }} data-testid="menu-plan-gone">
          <p className="cl-said">
            Gone: {plural(gone.length, 'line on a live menu is', 'lines on a live menu are')} not on this read, so{' '}
            {gone.length === 1 ? 'it leaves' : 'they leave'} the menu
            {canManage ? '. Keep one (or swipe it right) to carry it onto the draft.' : ' unless an owner or a manager keeps them.'}
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {gone.map((g) => (
              <GoneRow
                key={g.menuItemId}
                g={g}
                draftId={draftOf(g.kind)}
                canManage={canManage}
                onKept={(s) => {
                  setSaid(s);
                  setMoved(false);
                  refreshAll();
                }}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {same.length > 0 ? (
        <details style={{ marginTop: 12 }} data-testid="menu-plan-same">
          <summary className="cl-said cl-focus" style={{ cursor: 'pointer' }}>
            Same as last time ({plural(same.length, 'section', 'sections')})
          </summary>
          <p className="cl-said" style={{ marginTop: 4 }}>
            {same.map((sct) => sct.title).join(', ')}
          </p>
        </details>
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

      {batch && partReads.length > 0 ? (
        <div role="alert" className="cl-said" style={{ marginTop: 12 }} data-testid="menu-plan-part-read">
          {partReads.map((m) => (
            <div key={m.menuId} style={{ marginTop: 4 }}>
              <p style={{ margin: 0 }}>
                Only part of the {kindName(m.kind) ?? 'menu'} draft was read: {m.partRead}. Making it live takes every line
                that was not read off that menu.
              </p>
              {canManage && isMenuKind(m.kind) ? (
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                  <input
                    type="checkbox"
                    checked={partKinds.includes(m.kind)}
                    onChange={(e) => {
                      const k = m.kind as MenuKind;
                      setPartKinds((ks) => (e.target.checked ? [...ks, k] : ks.filter((x) => x !== k)));
                    }}
                  />
                  Make {kindName(m.kind)} live anyway, with those lines missing
                </label>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {!batch && !plan.current && plan.partRead ? (
        // F-1292: a menu read only in part takes every drink that was not read
        // off the house's menu. Said first, and chosen only once confirmed.
        <div role="alert" className="cl-said" style={{ marginTop: 12 }} data-testid="menu-plan-part-read">
          <p style={{ margin: 0 }}>
            Only part of this menu was read: {plan.partRead}. Making it current takes every drink that was not read
            off the house's menu. Reading the menu again, as a clearer photo or a smaller file, is safer.
          </p>
          {canManage && plan.lines.length > 0 ? (
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
              <input type="checkbox" checked={partOk} onChange={(e) => setPartOk(e.target.checked)} />
              Make it current anyway, with those drinks missing
            </label>
          ) : null}
        </div>
      ) : null}

      {canManage && batch && blocked.length > 0 ? (
        <div style={{ marginTop: 12 }} data-testid="menu-plan-blocked">
          {blocked.map((m) => (
            <p key={m.menuId} className="cl-said" style={{ margin: '4px 0' }}>
              {kindName(m.kind) ?? 'A menu'} has {plural(m.unsure, 'line', 'lines')} still to check, so it cannot go live
              yet.{' '}
              <button
                type="button"
                className="cl-btn cl-focus"
                disabled={choose.isPending || ids.length <= 1}
                onClick={() => {
                  setLeft((l) => [...l, { menuId: m.menuId, kind: m.kind }]);
                  setMoved(false);
                }}
              >
                Leave {kindName(m.kind) ?? 'it'} as a draft
              </button>
            </p>
          ))}
          <p className="cl-note">The other kinds go live without it; it stays in the list below.</p>
        </div>
      ) : null}
      {canManage && left.length > 0 ? (
        <p className="cl-note" data-testid="menu-plan-left">
          Left as a draft: {left.map((l) => kindName(l.kind) ?? 'a menu').join(', ')}.{' '}
          <button type="button" className="cl-btn cl-focus" onClick={() => setLeft([])} disabled={choose.isPending}>
            Put {left.length === 1 ? 'it' : 'them'} back
          </button>
        </p>
      ) : null}

      <div className="cl-row-controls" style={{ marginTop: 14 }}>
        {canManage && !plan.current && plan.lines.length === 0 ? (
          // F-681: an empty menu made current archived the house's real one.
          <p className="cl-said" data-testid="plan-empty">
            This menu has no lines, so it cannot become the current menu.
          </p>
        ) : null}
        {canManage && !plan.current && plan.lines.length > 0 ? (
          <button
            type="button"
            className="cl-btn cl-ink cl-focus"
            disabled={choose.isPending || partUnaccepted || blocked.length > 0 || groups.length > 0 || unpicked > 0}
            onClick={() => choose.mutate(plan.fingerprint)}
          >
            {batch
              ? choose.isPending
                ? 'Making them live…'
                : `Make ${liveNames.join(' + ')} live`
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
      {choose.isPending ? (
        <p role="status" className="cl-said" style={{ marginTop: 8 }} data-testid="menu-plan-working">
          Putting {plan.lines.length} {plan.lines.length === 1 ? 'line' : 'lines'} on the menu and setting their
          prices. A long menu can take half a minute; keep this page open. {seconds}s so far.
        </p>
      ) : null}
      {!canManage ? (
        <p className="cl-note">An owner or a manager chooses the current menu. Every price here is read at this house only.</p>
      ) : (
        <p className="cl-note">A lock holds a price at this house only.</p>
      )}
      {choose.isError && !moved && unsure ? (
        <p role="alert" className="cl-said" style={{ marginTop: 8 }} data-testid="menu-plan-unsure">
          {q.isFetching
            ? 'The house did not answer in time, so it may have made this menu current. Checking…'
            : plan.current
              ? 'The house did not answer in time, but this menu is now current. Some of its prices may still be on their way to the house; Inventory shows the prices the house has now.'
              : 'The house did not answer in time, and this menu is not current. Nothing has changed; you can try again.'}
        </p>
      ) : null}
      {choose.isError && !moved && !unsure ? (
        <p role="alert" className="cl-said" style={{ marginTop: 8 }}>
          It was not made current: {reasonOf(choose.error)}. Nothing has changed.
        </p>
      ) : null}
    </section>
  );
}

export default MenuPlan;
