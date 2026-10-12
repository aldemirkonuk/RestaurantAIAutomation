/**
 * `/menu` — ADR 0160 sec110 item 7: "a person can add and discard items."
 *
 * A new route, not a redesign of a shipping page, so it carries no
 * `mudavym_design_*` flag (App.tsx wires it directly — see that file's
 * comment on this route) and no `legacy` branch to preserve.
 *
 * WHAT THIS READS AND WRITES, both real, both wired in this build:
 *   GET   /menus/:restaurantId               the active menu and its lines
 *   PATCH /menus/:restaurantId/items/:id/discard   soft-remove one line
 *   GET   /menus/:restaurantId/discarded     the lines taken off (F-268)
 *   PATCH /menus/:restaurantId/items/:id/restore   put one back (F-268)
 *   PATCH /menus/items/:id                     correct one field of a line
 *                                              in place (F-065): Edit on the
 *                                              row, owner or manager; a price
 *                                              is the house's own price
 *   POST  /menus/items                        add one line (existing route;
 *                                              its tenant check was a real
 *                                              gap — see menus.service.ts —
 *                                              closed alongside this page).
 *                                              ADR 0193: a priced line also
 *                                              sets the linked wine's own
 *                                              price; the page says what
 *                                              happened (housePriceNote)
 *
 * MENUS KEPT (ADR 0193, menu versions, founder 2026-09-21): below the current
 * menu, every menu the house has read -- its source, its lines, when and by
 * whom -- with the current one and the last one used named, a form to read a
 * new one (optional cadence tag and date), and the owner's or manager's act
 * of making one current (`MenuVersions.tsx`). A blank price on a current
 * menu's line keeps the last known price and the line says so.
 *
 * LOCKED PRICES (ADR 0193 round 3, `LockedPrices.tsx`): every price the house
 * holds, grouped by whether its wine is on the current menu; choosing a menu
 * shows its plan first (`MenuPlan.tsx`), with a Keep switch on each price it
 * would change.
 *
 * WHAT THIS DOES NOT DO. `addMenuItem`'s DTO is the review-step shape
 * (name/producer/category/vintage/region/grape_variety/by_glass_price/
 * bottle_price) — the same fields the onboarding scanner's review screen
 * edits, so this form asks for exactly those and nothing invented. A house
 * with no active menu row (`menuId: null`) is told so, plainly, rather than
 * shown an empty add form that would 404 on submit.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import {
  addMenuItem,
  discardMenuItem,
  getDiscardedLines,
  getMenu,
  restoreMenuItem,
  reviewMenuItem,
  type DiscardedLine,
  type EditableMenuItemField,
  type MenuLine,
} from '../../../services/api/menus';
import { housePriceNote } from './menu-price-note';
import { MenuVersions } from './MenuVersions';
import { LockedPrices } from './LockedPrices';
import { PricePick, housePriceDiffers } from './PricePick';
import { settingsApi } from '../../../services/api/settings';
import { formatMoney } from '@/lib/currency';
import { displayGroupMark, readOptionalAmount, twoReadingsProblem, type GroupMark } from '@/lib/parseDecimal';
import { useHouseGroupMark } from '@/hooks/useHouseGroupMark';
import { Wordmark } from '@/components/mudavym';
import '../../cellar/next/cellar-next.css';

const EM = '—';

/**
 * Money, in the HOUSE's own reporting currency — never a hardcoded `$`.
 *
 * Three production houses (Meyhouse, Kadikoy) bill in TRY, not dollars
 * (`check_money_states_its_currency.py`). `formatMoney` (lib/currency.ts) is
 * the same refusal-shaped formatter `rc2-format.ts`'s `fmtMoney` wraps for
 * receipts: a null/unrecorded currency prints the number with "(currency not
 * recorded)" rather than assuming one.
 */
function money(v: number | null, currency: string | null): string {
  if (v === null) return EM;
  return formatMoney(v, currency);
}

/**
 * The house's reporting currency, read the same way `ReceivingWorkspace`
 * reads it (`GET /settings/currency`, 5-minute staleTime) — a failed or
 * unanswered read resolves to `null`, which `formatMoney` renders as
 * "currency not recorded" rather than a silent dollar-sign default.
 */
function useHouseCurrency(restaurantId: string | null): string | null {
  const { data } = useQuery({
    // The house is in the key: one house's currency never prices another's
    // menu (MENU-01).
    queryKey: ['settings', 'currency', restaurantId],
    queryFn: () => settingsApi.houseCurrency(),
    staleTime: 5 * 60_000,
  });
  return data?.readable ? (data.code ?? null) : null;
}

function useActiveMenu(restaurantId: string | null, canManage: boolean) {
  const queryClient = useQueryClient();
  const key = ['menu', 'active', restaurantId] as const;
  const discardedKey = ['menu', 'discarded', restaurantId] as const;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: discardedKey });
  };

  const q = useQuery({
    queryKey: key,
    enabled: Boolean(restaurantId),
    queryFn: () => getMenu(restaurantId as string),
  });

  // Only the people who may put a line back are shown the lines taken off
  // (F-268); the gateway refuses a restore from anyone else.
  const discarded = useQuery({
    queryKey: discardedKey,
    enabled: Boolean(restaurantId) && canManage,
    queryFn: () => getDiscardedLines(restaurantId as string),
  });

  const discard = useMutation({
    mutationFn: (itemId: string) => discardMenuItem(restaurantId as string, itemId),
    onSuccess: refresh,
  });

  const restore = useMutation({
    mutationFn: (itemId: string) => restoreMenuItem(restaurantId as string, itemId),
    onSuccess: refresh,
  });

  const add = useMutation({
    mutationFn: (fields: {
      name: string
      producer?: string
      category?: string
      vintage?: string
      region?: string
      grape_variety?: string
      by_glass_price?: number
      bottle_price?: number
    }) => {
      if (!q.data?.menuId) throw new Error('No active menu to add to');
      return addMenuItem(q.data.menuId, fields);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
  });

  // One field per request: PATCH /menus/items/:id corrects one field. Sent
  // in order and stopped at the first refusal, so the page can say which
  // fields were saved and which was not, never "saved" for a half-saved line.
  const edit = useMutation({
    mutationFn: async ({ itemId, changes }: { itemId: string; changes: EditChange[] }) => {
      const out: EditOutcome = { saved: [], notes: [], failed: null };
      for (const c of changes) {
        try {
          const r = await reviewMenuItem(itemId, c.field, c.value);
          out.saved.push(c.field);
          const note = editPriceNote(c.field, r);
          if (note) out.notes.push(note);
        } catch (e) {
          out.failed = { field: c.field, reason: refusalReason(e), ...refusalShape(e) };
          break;
        }
      }
      return out;
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key }),
  });

  return { q, discarded, discard, restore, add, edit };
}

type EditChange = { field: EditableMenuItemField; value: string };
type EditOutcome = {
  saved: EditableMenuItemField[]
  notes: { tone: 'alert' | 'said'; text: string }[]
  failed: { field: EditableMenuItemField; reason: string; refused: boolean; spoke: boolean } | null
};

/**
 * Why the gateway refused a field, in its own words (F-920). The catch used to
 * print the request's own message, so a refused rename read "Request failed
 * with status code 500" and the gateway's reason (the stock row was not
 * renamed) never reached the page.
 */
export function refusalReason(
  err: unknown,
  silent = 'the server could not save it and gave no reason; try again',
): string {
  const e = err as { response?: { status?: number; data?: { message?: unknown } }; message?: string };
  const m = e?.response?.data?.message;
  if (typeof m === 'string' && m) return m;
  if (Array.isArray(m) && m.length) return String(m[0]);
  if (e?.response?.status === 403) return 'only an owner or a manager can change this line';
  if (e?.response) return silent;
  return e?.message || 'no reason given';
}

/**
 * Whether a failed field was REFUSED before anything was written (a 4xx), and
 * whether the gateway said why (F-1002). A 5xx can come after part of the work
 * was done (a rename renames the stock first), so the page never adds "Nothing
 * was changed." to one.
 */
function refusalShape(err: unknown): { refused: boolean; spoke: boolean } {
  const r = (err as { response?: { status?: number; data?: { message?: unknown } } })?.response;
  const m = r?.data?.message;
  return {
    refused: typeof r?.status === 'number' && r.status >= 400 && r.status < 500,
    spoke: (typeof m === 'string' && m !== '') || (Array.isArray(m) && m.length > 0),
  };
}

/** A field of a line, in the words the page uses for it. */
const FIELD_WORDS: Record<string, string> = {
  name: 'Name',
  producer: 'Producer',
  category: 'Section',
  vintage: 'Vintage',
  region: 'Region',
  grape_variety: 'Grape',
  by_glass_price: 'Glass price',
  bottle_price: 'Bottle price',
};

/** What a price changed in place did to the house's own price (ADR 0193). */
function editPriceNote(
  field: EditableMenuItemField,
  r: Awaited<ReturnType<typeof reviewMenuItem>>,
): { tone: 'alert' | 'said'; text: string } | null {
  const kind = field === 'by_glass_price' ? 'glass' : 'bottle';
  switch (r.priceSync) {
    case 'changed':
      return { tone: 'said', text: `The house's own ${kind} price now matches the line.` };
    case 'locked':
      return {
        tone: 'said',
        text: `The ${kind} price is locked, so the house's own price was not changed. An owner or a manager changes it under Locked prices.`,
      };
    case 'stale':
      return { tone: 'said', text: `A newer ${kind} price was set after this one, so the house kept it.` };
    case 'not_linked':
      return {
        tone: 'said',
        text: `This line is not matched to anything the house stocks, so the new ${kind} price is on the menu only.`,
      };
    case 'failed':
      return {
        tone: 'alert',
        text: `The menu shows the new ${kind} price, but the house's own price was NOT updated (${r.priceSyncError || 'no reason given'}).`,
      };
    default:
      return null;
  }
}

/** One sentence for what Edit saved, and what it did not. */
function editSentence(o: EditOutcome): string {
  const words = (fs: EditableMenuItemField[]) => fs.map((f) => FIELD_WORDS[f] ?? f).join(', ');
  const saved = o.saved.length ? `Saved: ${words(o.saved)}.` : '';
  if (!o.failed) return saved || 'Nothing had changed, so nothing was saved.';
  // Only a refusal (4xx) is known to have written nothing; a 5xx that names
  // what happened speaks for itself, and one that does not is not guessed at.
  const after = o.failed.refused ? 'Nothing was changed.' : o.failed.spoke ? '' : 'Reload the page to see what was kept.';
  const tail = saved || after;
  return `${FIELD_WORDS[o.failed.field] ?? o.failed.field} was not saved (${o.failed.reason}).${tail ? ` ${tail}` : ''}`;
}

/**
 * Why a line is flagged, in plain words (F-151). The gateway writes its own
 * note on the line ("Manually added during review", "Manager corrected
 * by_glass_price"); a line a person added or corrected here is flagged for
 * that reason alone, which is not a missing price.
 */
function flagReason(note: string | null | undefined): { hand: boolean; text: string } | null {
  if (!note) return null;
  if (/^Manually added/i.test(note)) return { hand: true, text: 'Added by hand.' };
  const corrected = /^Manager corrected (\w+)/.exec(note);
  if (corrected) return { hand: true, text: `${FIELD_WORDS[corrected[1]] ?? 'A detail'} changed by hand.` };
  if (/^Free tier/i.test(note)) return { hand: false, text: 'Past the 25 lines a menu typed by hand holds on the free plan.' };
  return { hand: false, text: note };
}

/** The changes between a line and what was typed for it, in the order shown. */
function editChanges(
  line: MenuLine,
  typed: { name: string; category: string; glass: string; bottle: string },
  group: GroupMark | null = null,
  display: GroupMark | null = null,
): { changes: EditChange[]; error: string | null } {
  const changes: EditChange[] = [];
  const name = typed.name.trim();
  if (!name) return { changes: [], error: 'A line needs a name.' };
  if (name !== line.name) changes.push({ field: 'name', value: name });
  const category = typed.category.trim();
  if (category !== (line.category ?? '')) {
    if (!category) return { changes: [], error: 'A section cannot be cleared here; type the section it belongs to.' };
    changes.push({ field: 'category', value: category });
  }
  for (const [field, raw, was] of [
    ['by_glass_price', typed.glass.trim(), line.by_glass_price],
    ['bottle_price', typed.bottle.trim(), line.bottle_price],
  ] as const) {
    if (raw === '') {
      if (was !== null) return { changes: [], error: `${FIELD_WORDS[field]} cannot be cleared here. Discard the line to take it off.` };
      continue;
    }
    // Read the way the house writes it, as the add form does (F-878): a bare
    // Number() refused "45,50" and a number input showed it as blank.
    const read = readOptionalAmount(raw, group);
    if (!read.ok || read.value === null) return { changes: [], error: `${FIELD_WORDS[field]} must be a number, 0 or more.` };
    const asked = twoReadingsProblem(raw, group, display);
    if (asked) return { changes: [], error: asked };
    const n = read.value;
    if (n !== was) changes.push({ field, value: String(n) });
  }
  return { changes, error: null };
}

/** What a put-back line returns as, in the house's words. */
function goesBackAs(line: DiscardedLine): string {
  return line.prior_status
    ? `Goes back as ${line.prior_status.replace('_', ' ')}.`
    : 'Goes back as in review — what it was before is not known.';
}

/**
 * The lines taken off the current menu, each with Put back (F-268). Folded by
 * default: it is the way back, not the menu.
 */
function DiscardedLines({ lines, onRestore, restoringId }: {
  lines: DiscardedLine[]
  onRestore: (line: DiscardedLine) => void
  restoringId: string | null
}) {
  if (lines.length === 0) return null;
  return (
    <details style={{ marginTop: 16 }} data-testid="menu-discarded">
      <summary className="cl-said" style={{ cursor: 'pointer' }}>
        Taken off the menu ({lines.length})
      </summary>
      <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
        {lines.map((line) => (
          <li
            key={line.id}
            data-testid="menu-discarded-row"
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', borderTop: '1px solid var(--paper-2)' }}
          >
            <span style={{ flex: 1 }}>
              {line.name}
              <span className="cl-note" style={{ display: 'block' }}>
                {goesBackAs(line)}
              </span>
            </span>
            <button
              type="button"
              className="cl-btn cl-focus"
              disabled={restoringId === line.id}
              onClick={() => onRestore(line)}
              aria-label={`Put ${line.name} back on the menu`}
            >
              {restoringId === line.id ? 'Putting back…' : 'Put back'}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

function AddItemForm({ onAdd, adding, error }: {
  // The reset callback fires only on a SUCCESSFUL add. Clearing the form at
  // submit time (the prior behaviour) threw the person's typed entry away on
  // a failed POST, with no way to recover it — "a draft is not sent" cuts
  // both ways: a failure must not erase it either.
  onAdd: (
    fields: { name: string; category?: string; by_glass_price?: number; bottle_price?: number },
    opts: { onSuccess: () => void },
  ) => void
  adding: boolean
  error: string | null
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [byGlass, setByGlass] = useState('');
  const [bottle, setBottle] = useState('');
  // "12,50" — and "1.250" in a "."-grouping house — read the way the house writes
  // it (F-358). A bare Number() made "12,50" NaN, sent as null: the line was
  // added with no price and nothing said so.
  const group = useHouseGroupMark();
  const glassRead = readOptionalAmount(byGlass, group);
  const bottleRead = readOptionalAmount(bottle, group);
  const unreadable = !glassRead.ok ? byGlass : !bottleRead.ok ? bottle : null;
  // F-878: a figure that reads two ways ("1,250" when the house and the screen
  // group thousands differently) is asked about, never saved as a guess.
  const shown = displayGroupMark();
  const twoWays =
    unreadable === null ? twoReadingsProblem(byGlass, group, shown) ?? twoReadingsProblem(bottle, group, shown) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !glassRead.ok || !bottleRead.ok || twoWays) return;
    onAdd(
      {
        name: name.trim(),
        category: category.trim() || undefined,
        by_glass_price: glassRead.value ?? undefined,
        bottle_price: bottleRead.value ?? undefined,
      },
      {
        onSuccess: () => {
          setName('');
          setCategory('');
          setByGlass('');
          setBottle('');
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="cl-row-controls" data-testid="menu-add-form">
      <label className="cl-dim" style={{ fontSize: 12 }} htmlFor="menu-add-name">
        Name
      </label>
      <input
        id="menu-add-name"
        className="cl-field cl-focus"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="What's on the menu"
        style={{ minWidth: 180 }}
      />
      <label className="cl-dim" style={{ fontSize: 12 }} htmlFor="menu-add-category">
        Section
      </label>
      <input
        id="menu-add-category"
        className="cl-field cl-focus"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        placeholder="e.g. Reds"
        style={{ width: 120 }}
      />
      <label className="cl-dim" style={{ fontSize: 12 }} htmlFor="menu-add-glass">
        Glass
      </label>
      <input
        id="menu-add-glass"
        className="cl-field cl-focus cl-num"
        type="text"
        inputMode="decimal"
        value={byGlass}
        onChange={(e) => setByGlass(e.target.value)}
        style={{ width: 80 }}
      />
      <label className="cl-dim" style={{ fontSize: 12 }} htmlFor="menu-add-bottle">
        Bottle
      </label>
      <input
        id="menu-add-bottle"
        className="cl-field cl-focus cl-num"
        type="text"
        inputMode="decimal"
        value={bottle}
        onChange={(e) => setBottle(e.target.value)}
        style={{ width: 80 }}
      />
      <button type="submit" className="cl-btn cl-focus" disabled={adding || !name.trim() || unreadable !== null || twoWays !== null}>
        {adding ? 'Adding…' : 'Add to menu'}
      </button>
      {unreadable !== null ? (
        <span role="alert" className="cl-said" style={{ fontSize: 12 }}>
          “{unreadable}” is not a price. Write it like 12,50 or 12.50.
        </span>
      ) : null}
      {twoWays !== null ? (
        <span role="alert" className="cl-said" style={{ fontSize: 12 }}>
          {twoWays}
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="cl-said" style={{ fontSize: 12 }}>
          {error}
        </span>
      ) : null}
    </form>
  );
}

function EditRow({ line, saving, onSave, onCancel }: {
  line: MenuLine
  saving: boolean
  onSave: (changes: EditChange[]) => void
  onCancel: () => void
}) {
  const [typed, setTyped] = useState({
    name: line.name,
    category: line.category ?? '',
    glass: line.by_glass_price === null ? '' : String(line.by_glass_price),
    bottle: line.bottle_price === null ? '' : String(line.bottle_price),
  });
  const [error, setError] = useState<string | null>(null);
  const group = useHouseGroupMark();
  const set = (k: keyof typeof typed) => (e: { target: { value: string } }) => {
    setTyped((t) => ({ ...t, [k]: e.target.value }));
    setError(null);
  };
  const save = () => {
    const r = editChanges(line, typed, group, displayGroupMark());
    if (r.error) return setError(r.error);
    onSave(r.changes);
  };
  return (
    <tr data-testid="menu-edit-row">
      <td>
        {/* Edit swaps the row out from under its button; focus follows into the form (F-1038). */}
        <input className="cl-field cl-focus" aria-label={`Name of ${line.name}`} value={typed.name} onChange={set('name')} autoFocus />
      </td>
      <td>
        <input className="cl-field cl-focus" aria-label={`Section of ${line.name}`} value={typed.category} onChange={set('category')} style={{ width: 110 }} />
      </td>
      <td className="cl-dim">{[line.producer, line.region].filter(Boolean).join(', ') || EM}</td>
      <td>
        <input className="cl-field cl-focus cl-num" type="text" inputMode="decimal" aria-label={`Glass price of ${line.name}`} value={typed.glass} onChange={set('glass')} style={{ width: 80 }} />
      </td>
      <td>
        <input className="cl-field cl-focus cl-num" type="text" inputMode="decimal" aria-label={`Bottle price of ${line.name}`} value={typed.bottle} onChange={set('bottle')} style={{ width: 80 }} />
      </td>
      <td>
        {error ? (
          <span role="alert" className="cl-note">
            {error}
          </span>
        ) : (
          <span className="cl-note">A price saved here is the house's own price.</span>
        )}
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <button type="button" className="cl-btn cl-ink cl-focus" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>{' '}
        <button type="button" className="cl-btn cl-focus" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
      </td>
    </tr>
  );
}

/**
 * F-618. Inventory, Reports and the till read the house's own price. Since
 * S195 a change of it is written onto the current menu's line (migration
 * 20270105500000), and since S202 a menu made current is the newest dated
 * price (migration 20270106000000), so the two agree. A locked price, a price
 * a person set after the menu became current, or a line older than those
 * migrations can still differ. Only then does the cell show both, "Locked at
 * X — the menu says Y", and an owner or a manager picks one (PricePick). A
 * blank line price beside a known house price shows that price too.
 */
function PriceCell({ line, linePrice, housePrice, currency, kind, canPick }: {
  line: MenuLine
  linePrice: number | null
  housePrice: number | null | undefined
  currency: string | null
  kind: 'glass' | 'bottle'
  canPick: boolean
}) {
  const { activeRestaurantId } = useAuth();
  return (
    <td className="cl-num">
      {money(linePrice, currency)}
      {housePriceDiffers(linePrice, housePrice) ? (
        <PricePick
          house={activeRestaurantId ?? null}
          inventoryId={line.inventory_item_id}
          lineId={line.id}
          kind={kind}
          linePrice={linePrice}
          housePrice={housePrice as number}
          canPick={canPick}
          fmt={(v) => money(v, currency)}
        />
      ) : null}
    </td>
  );
}

function MenuRow({ line, currency, onDiscard, discarding, canDiscard, onEdit, focusEdit = false, focusDiscard = false }: {
  line: MenuLine
  currency: string | null
  onDiscard: () => void
  discarding: boolean
  // Taking a line off the guest menu is an owner's or a manager's (F-268);
  // the gateway refuses anyone else.
  canDiscard: boolean
  // Edit in place (F-065): owners and managers only; null hides it.
  onEdit: (() => void) | null
  // Back from Save or Cancel, the row's own Edit takes focus again (F-1038).
  focusEdit?: boolean
  // Put back, the line's own Discard takes focus again (F-1425).
  focusDiscard?: boolean
}) {
  const reason = line.status === 'flagged' ? flagReason(line.review_notes) : null;
  const editRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (focusEdit) editRef.current?.focus();
  }, [focusEdit]);
  const discardRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (focusDiscard) discardRef.current?.focus();
  }, [focusDiscard]);
  return (
    <tr data-testid="menu-row">
      <td>{line.name}</td>
      <td className="cl-dim">{line.category ?? EM}</td>
      <td className="cl-dim">{[line.producer, line.region].filter(Boolean).join(', ') || EM}</td>
      <PriceCell line={line} linePrice={line.by_glass_price} housePrice={line.house_glass_price} currency={currency} kind="glass" canPick={canDiscard} />
      <PriceCell line={line} linePrice={line.bottle_price} housePrice={line.house_bottle_price} currency={currency} kind="bottle" canPick={canDiscard} />
      <td>
        <span className="cl-chip" data-seal={line.status === 'approved' ? 'true' : 'false'}>
          {reason?.hand ? 'by hand' : line.status.replace('_', ' ')}
        </span>
        {/* F-145: 86'd on /cellar, /inventory or the phone; back on when a delivery is booked in. */}
        {line.sold_out ? (
          <span className="cl-chip" data-testid="menu-sold-out" title="Not available to guests until it is brought back or a delivery is booked in.">
            sold out
          </span>
        ) : null}
        {reason ? (
          <span className="cl-note" style={{ display: 'block' }} data-testid="menu-flag-reason">
            {reason.text}
          </span>
        ) : null}
        {line.price_flag ? (
          <span className="cl-note" style={{ display: 'block' }} data-testid="menu-price-flag" title={line.price_flag_note ?? undefined}>
            {line.price_flag_note ?? 'A blank price kept the last known one.'}
          </span>
        ) : null}
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {onEdit ? (
          <>
            <button ref={editRef} type="button" className="cl-btn cl-focus" onClick={onEdit} aria-label={`Edit ${line.name}`}>
              Edit
            </button>{' '}
          </>
        ) : null}
        {canDiscard ? (
          <button
            ref={discardRef}
            type="button"
            className="cl-btn cl-focus"
            disabled={discarding}
            onClick={onDiscard}
            aria-label={`Discard ${line.name}`}
            data-testid="menu-discard-button"
          >
            {discarding ? 'Discarding…' : 'Discard'}
          </button>
        ) : null}
      </td>
    </tr>
  );
}

/**
 * The page is keyed on the house (F-1004): a switch of house does not remount
 * the route, so "X is off the menu. Put it back", the Edit sentence and the add
 * note stayed up for the house just left -- and Put it back then sent that
 * house's line to this one. A new key starts every one of them empty.
 */
export default function MenuNext() {
  const { activeRestaurantId } = useAuth();
  return <MenuPage key={activeRestaurantId ?? 'no-house'} />;
}

function MenuPage() {
  const { activeRestaurantId, loading: authLoading, activeRole, user } = useAuth();
  // Choosing the current menu is an owner's or a manager's (ADR 0193); the
  // gateway refuses anyone else regardless of what this page offers.
  const role = (activeRole ?? user?.role ?? null) as string | null;
  const canManage = role === 'owner' || role === 'manager';
  const { q, discarded, discard, restore, add, edit } = useActiveMenu(activeRestaurantId, canManage);
  const currency = useHouseCurrency(activeRestaurantId);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  // The line this person just took off, offered back in place (F-268): the
  // undo is why Discard needs no confirm step.
  const [justDiscarded, setJustDiscarded] = useState<{ id: string; name: string } | null>(null);
  // Discard takes its row, and its button, off the page, which dropped focus
  // to the body (F-1425). Focus goes to "Put it back" instead, and once the
  // line is back, to that line's own Discard.
  const putBackRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (justDiscarded) putBackRef.current?.focus();
  }, [justDiscarded]);
  const [putBackId, setPutBackId] = useState<string | null>(null);
  const putBack = (id: string) => {
    setRestoringId(id);
    restore.mutate(id, {
      onSuccess: () => {
        setPutBackId(id);
        setJustDiscarded((d) => (d?.id === id ? null : d));
      },
      onSettled: () => setRestoringId(null),
    });
  };
  const [editingId, setEditingId] = useState<string | null>(null);
  const [leftEditId, setLeftEditId] = useState<string | null>(null);
  const leaveEdit = (id: string) => {
    setLeftEditId(id);
    setEditingId(null);
  };
  const [edited, setEdited] = useState<{ name: string; outcome: EditOutcome } | null>(null);

  return (
    <div
      className="mudavym min-h-full"
      style={{ background: 'var(--paper-0)', color: 'var(--ink-1)' }}
    >
      <div style={{ margin: '0 auto', maxWidth: 1100, padding: '22px 16px 40px' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Wordmark size={13} />
        </header>

        <p className="cl-crumb" style={{ marginTop: 20 }}>
          What the house lists
        </p>
        <h1 className="cl-h1" data-testid="menu-headline">
          Menu.
        </h1>

        {authLoading || q.isLoading ? (
          <p className="cl-said" role="status">
            Reading the menu…
          </p>
        ) : q.isError ? (
          <p className="cl-said" role="alert" data-testid="menu-error">
            The menu could not be read
            {q.error instanceof Error ? ` (${q.error.message})` : ''}. Nothing below is a real
            count of what this house lists.
          </p>
        ) : !q.data?.menuId ? (
          <p className="cl-said" data-testid="menu-no-active">
            No current menu yet. Read one below and make it current — Add to menu has nothing to
            add to until a menu is current.
          </p>
        ) : (
          <>
            <p className="cl-standing" style={{ fontSize: 15.5 }}>
              {/* Not the menu's stored name: every read is named by the
                  importer ("Wine List" before F-018), never by the house,
                  and a beer is not on a wine list (F-066). */}
              {q.data.items.length} {q.data.items.length === 1 ? 'line' : 'lines'} on the current menu.
            </p>

            <div style={{ marginTop: 16 }}>
              {/* F-698: a line added here joins the house's stock and the wine
                  library, so it is an owner's or a manager's, as Discard is
                  (the gateway refuses anyone else). */}
              {canManage ? (
                <AddItemForm
                  adding={add.isPending}
                  error={add.isError ? refusalReason(add.error) : null}
                  onAdd={(fields, opts) => add.mutate(fields, opts)}
                />
              ) : (
                <p className="cl-note" data-testid="menu-add-managers-only">
                  An owner or a manager adds lines to the current menu.
                </p>
              )}
              {(() => {
                const note = add.isSuccess ? housePriceNote(add.data, currency) : null;
                return note ? (
                  <p
                    role={note.tone === 'alert' ? 'alert' : 'status'}
                    className="cl-said"
                    style={{ fontSize: 12, marginTop: 6 }}
                    data-testid="menu-add-price-note"
                  >
                    {note.text}
                  </p>
                ) : null;
              })()}
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid var(--paper-2)', borderRadius: 10, marginTop: 16 }}>
              <table className="cl-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Section</th>
                    <th>Producer / region</th>
                    <th>Glass</th>
                    <th>Bottle</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {q.data.items.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="cl-said" style={{ padding: 14 }}>
                        Nothing on the menu yet — add the first line above.
                      </td>
                    </tr>
                  ) : (
                    q.data.items.map((line) =>
                      editingId === line.id ? (
                        <EditRow
                          key={line.id}
                          line={line}
                          saving={edit.isPending}
                          onCancel={() => leaveEdit(line.id)}
                          onSave={(changes) =>
                            edit.mutate(
                              { itemId: line.id, changes },
                              {
                                onSuccess: (outcome) => {
                                  setEdited({ name: line.name, outcome });
                                  if (!outcome.failed) leaveEdit(line.id);
                                },
                              },
                            )
                          }
                        />
                      ) : (
                      <MenuRow
                        key={line.id}
                        line={line}
                        currency={currency}
                        canDiscard={canManage}
                        focusEdit={leftEditId === line.id}
                        focusDiscard={putBackId === line.id}
                        onEdit={
                          canManage
                            ? () => {
                                setEdited(null);
                                setLeftEditId(null);
                                setEditingId(line.id);
                              }
                            : null
                        }
                        discarding={discard.isPending && discardingId === line.id}
                        onDiscard={() => {
                          setDiscardingId(line.id);
                          setPutBackId(null);
                          discard.mutate(line.id, {
                            onSuccess: () => setJustDiscarded({ id: line.id, name: line.name }),
                            onSettled: () => setDiscardingId(null),
                          });
                        }}
                      />
                      ),
                    )
                  )}
                </tbody>
              </table>
            </div>
            {edited ? (
              <div style={{ marginTop: 8 }} data-testid="menu-edit-said">
                <p role={edited.outcome.failed ? 'alert' : 'status'} className="cl-said">
                  {edited.name}: {editSentence(edited.outcome)}
                </p>
                {edited.outcome.notes.map((n) => (
                  <p key={n.text} role={n.tone === 'alert' ? 'alert' : 'status'} className="cl-said" style={{ fontSize: 12 }}>
                    {n.text}
                  </p>
                ))}
              </div>
            ) : null}
            {(() => {
              const differ = q.data.items.filter(
                (l) =>
                  housePriceDiffers(l.bottle_price, l.house_bottle_price) ||
                  housePriceDiffers(l.by_glass_price, l.house_glass_price),
              ).length;
              const soldOutUnread =
                q.data.soldOutReadable === false ? (
                  <p className="cl-note" role="alert" style={{ marginTop: 8 }} data-testid="menu-sold-out-unread">
                    {q.data.soldOutReason ?? 'Which drinks are sold out could not be read, so none is marked.'}
                  </p>
                ) : null;
              if (q.data.housePricesReadable === false)
                return (
                  <>
                    {soldOutUnread}
                    <p className="cl-note" role="alert" style={{ marginTop: 8 }} data-testid="menu-house-prices-unread">
                      {q.data.housePricesReason ?? "This house's own prices could not be read, so a line whose price differs from them is not marked."}
                    </p>
                  </>
                );
              return (
                <>
                  {soldOutUnread}
                  {differ > 0 ? (
                    <p className="cl-note" style={{ marginTop: 8 }} data-testid="menu-house-prices-differ">
                      {differ} {differ === 1 ? 'line prints a price' : 'lines print a price'} that is not this
                      house&rsquo;s own. Inventory, Reports and the till use the house&rsquo;s price, shown under the
                      line&rsquo;s{canManage ? '; pick on the line which one the house charges' : ''}. Nothing changes until an owner or a manager picks.
                    </p>
                  ) : null}
                </>
              );
            })()}
            {discard.isError ? (
              <p role="alert" className="cl-said" style={{ marginTop: 8 }}>
                That line was not discarded ({refusalReason(discard.error)}).
              </p>
            ) : null}
            {justDiscarded ? (
              <p role="status" className="cl-said" style={{ marginTop: 8 }} data-testid="menu-just-discarded">
                {justDiscarded.name} is off the menu.{' '}
                <button
                  ref={putBackRef}
                  type="button"
                  className="cl-btn cl-focus"
                  disabled={restoringId === justDiscarded.id}
                  onClick={() => putBack(justDiscarded.id)}
                >
                  {restoringId === justDiscarded.id ? 'Putting it back…' : 'Put it back'}
                </button>
              </p>
            ) : null}
            {restore.isError ? (
              <p role="alert" className="cl-said" style={{ marginTop: 8 }}>
                That line was not put back ({refusalReason(restore.error)}).
              </p>
            ) : null}
            {canManage ? (
              discarded.isError ? (
                <p role="alert" className="cl-said" style={{ marginTop: 8 }}>
                  The lines taken off the menu could not be read
                  {` (${refusalReason(discarded.error, 'the server gave no reason; try again')})`}.
                </p>
              ) : (
                <DiscardedLines
                  lines={discarded.data?.items ?? []}
                  restoringId={restoringId}
                  onRestore={(line) => putBack(line.id)}
                />
              )
            ) : null}
          </>
        )}

        {/* ADR 0193 round 3: every price this house holds, kept when its wine
            leaves the menu (the founder, 2026-09-21: "add a section to that
            where you can lock price, but wha f that menu item disappears?"). */}
        {activeRestaurantId ? <LockedPrices canManage={canManage} currency={currency} /> : null}

        {activeRestaurantId ? <MenuVersions canManage={canManage} currency={currency} /> : null}

        <footer
          style={{
            marginTop: 40,
            paddingTop: 12,
            borderTop: '1px solid var(--paper-2)',
          }}
        >
          <p className="cl-note" style={{ margin: 0, fontSize: 11 }}>
            Edit changes a line's name, section or prices; a price saved there is the house's own
            price.
            Discard takes a line off this house's current menu here. Mudavym shows no menu to guests, so a
            printed or online menu changes only when you change it. What the line cost and who added it is
            kept — nothing here is a delete, and an owner or a manager can put it back.
          </p>
        </footer>
      </div>
    </div>
  );
}
