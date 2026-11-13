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

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import { addMenuItem, discardMenuItem, getMenu, type MenuLine } from '../../../services/api/menus';
import { housePriceNote } from './menu-price-note';
import { MenuVersions } from './MenuVersions';
import { LockedPrices } from './LockedPrices';
import { settingsApi } from '../../../services/api/settings';
import { formatMoney } from '@/lib/currency';
import { Wordmark } from '@/components/mudavym';
import { isKitchenLine } from '../../../lib/firstProof';
import { lineStatusWords } from './menu-line-status';
import '../../cellar/next/cellar-next.css';

const EM = '—';

/**
 * Whether a line on the current menu is a dish (a kitchen line): the gateway's
 * own word when it sends one (menu-line-view.ts isKitchenLine), else the same
 * test here. A kitchen line stays on the menu and is carried nowhere (#1085);
 * the page sets it apart from the drinks instead of listing a dessert among
 * the wines (menu walk 2026-11-11).
 */
export function isKitchenMenuLine(line: MenuLine): boolean {
  if (typeof line.kitchen_line === 'boolean') return line.kitchen_line;
  return isKitchenLine({
    category: line.category,
    rawText: null,
    name: line.name,
    producer: line.producer,
    vintage: line.vintage,
    region: line.region,
    grapeVariety: line.grape_variety,
  });
}

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

function useActiveMenu(restaurantId: string | null) {
  const queryClient = useQueryClient();
  const key = ['menu', 'active', restaurantId] as const;

  const q = useQuery({
    queryKey: key,
    enabled: Boolean(restaurantId),
    queryFn: () => getMenu(restaurantId as string),
  });

  const discard = useMutation({
    mutationFn: (itemId: string) => discardMenuItem(restaurantId as string, itemId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
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

  return { q, discard, add };
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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd(
      {
        name: name.trim(),
        category: category.trim() || undefined,
        by_glass_price: byGlass ? Number(byGlass) : undefined,
        bottle_price: bottle ? Number(bottle) : undefined,
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
        type="number"
        min={0}
        step="0.01"
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
        type="number"
        min={0}
        step="0.01"
        value={bottle}
        onChange={(e) => setBottle(e.target.value)}
        style={{ width: 80 }}
      />
      <button type="submit" className="cl-btn cl-focus" disabled={adding || !name.trim()}>
        {adding ? 'Adding…' : 'Add to menu'}
      </button>
      {error ? (
        <span role="alert" className="cl-said" style={{ fontSize: 12 }}>
          {error}
        </span>
      ) : null}
    </form>
  );
}

function MenuRow({ line, currency, onDiscard, discarding, testId = 'menu-row' }: {
  line: MenuLine
  currency: string | null
  testId?: string
  /** Absent for a member who may not discard (ADR 0358 D2: owner or manager only). */
  onDiscard?: () => void
  discarding: boolean
}) {
  return (
    <tr data-testid={testId}>
      <td>{line.name}</td>
      <td className="cl-dim">{line.category ?? EM}</td>
      <td className="cl-dim">{[line.producer, line.region].filter(Boolean).join(', ') || EM}</td>
      <td className="cl-num">{money(line.by_glass_price, currency)}</td>
      <td className="cl-num">{money(line.bottle_price, currency)}</td>
      <td>
        {(() => {
          const s = lineStatusWords(line);
          return (
            <>
              <span className="cl-chip" data-seal={s.sealed ? 'true' : 'false'} title={s.why ?? undefined} data-testid="menu-line-status">
                {s.words}
              </span>
              {s.noteShown && s.why ? (
                <span className="cl-note" style={{ display: 'block' }} data-testid="menu-line-status-why">
                  {s.why}
                </span>
              ) : null}
            </>
          );
        })()}
        {line.price_flag ? (
          <span className="cl-note" style={{ display: 'block' }} data-testid="menu-price-flag" title={line.price_flag_note ?? undefined}>
            {line.price_flag_note ?? 'A blank price kept the last known one.'}
          </span>
        ) : null}
      </td>
      <td>
        {onDiscard ? (
        <button
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

export default function MenuNext() {
  const { activeRestaurantId, loading: authLoading, activeRole, user } = useAuth();
  // Choosing the current menu is an owner's or a manager's (ADR 0193); the
  // gateway refuses anyone else regardless of what this page offers.
  const role = (activeRole ?? user?.role ?? null) as string | null;
  const canManage = role === 'owner' || role === 'manager';
  const { q, discard, add } = useActiveMenu(activeRestaurantId);
  const currency = useHouseCurrency(activeRestaurantId);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const lines = q.data?.items ?? [];
  const drinks = lines.filter((l) => !isKitchenMenuLine(l));
  const kitchen = lines.filter(isKitchenMenuLine);
  const row = (line: MenuLine, testId?: string) => (
    <MenuRow
      key={line.id}
      line={line}
      currency={currency}
      testId={testId}
      discarding={discard.isPending && discardingId === line.id}
      onDiscard={!canManage ? undefined : () => {
        setDiscardingId(line.id);
        discard.mutate(line.id, { onSettled: () => setDiscardingId(null) });
      }}
    />
  );
  const head = (
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
  );

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
            {/* Every kept menu is stored as "Wine List" (the column's default), so
                the name is not said: a menu with a dessert on it is not a wine
                list, and the kept menus below are told apart by when they were read. */}
            <p className="cl-standing" style={{ fontSize: 15.5 }} data-testid="menu-standing">
              {drinks.length} {drinks.length === 1 ? 'drink' : 'drinks'} on the current menu
              {kitchen.length > 0
                ? `, and ${kitchen.length} ${kitchen.length === 1 ? 'line' : 'lines'} from the kitchen, set apart below`
                : ''}
              .
            </p>

            <div style={{ marginTop: 16 }}>
              <AddItemForm
                adding={add.isPending}
                error={add.isError ? (add.error instanceof Error ? add.error.message : 'no reason given') : null}
                onAdd={(fields, opts) => add.mutate(fields, opts)}
              />
              {(() => {
                const note = add.isSuccess ? housePriceNote(add.data) : null;
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
              <table className="cl-table" style={{ width: '100%' }} aria-label="Drinks on the current menu">
                {head}
                <tbody>
                  {drinks.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="cl-said" style={{ padding: 14 }}>
                        {kitchen.length === 0
                          ? 'Nothing on the menu yet — add the first line above.'
                          : 'No drink on the menu yet — only the kitchen lines below.'}
                      </td>
                    </tr>
                  ) : (
                    drinks.map((line) => row(line))
                  )}
                </tbody>
              </table>
            </div>
            {kitchen.length > 0 ? (
              <section aria-labelledby="menu-kitchen-h" style={{ marginTop: 20 }} data-testid="menu-kitchen">
                <h2 id="menu-kitchen-h" className="cl-crumb">
                  From the kitchen
                </h2>
                <p className="cl-note" style={{ marginTop: 4, fontSize: 12 }}>
                  On the menu, and carried nowhere: no wine, no house price, no stock.
                </p>
                <div style={{ overflowX: 'auto', border: '1px solid var(--paper-2)', borderRadius: 10, marginTop: 8 }}>
                  <table className="cl-table" style={{ width: '100%' }} aria-label="Kitchen lines on the current menu">
                    {head}
                    <tbody>{kitchen.map((line) => row(line, 'menu-kitchen-row'))}</tbody>
                  </table>
                </div>
              </section>
            ) : null}
            {discard.isError ? (
              <p role="alert" className="cl-said" style={{ marginTop: 8 }}>
                That line was not discarded (
                {discard.error instanceof Error ? discard.error.message : 'no reason given'}).
              </p>
            ) : null}
          </>
        )}

        {/* ADR 0193 round 3: every price this house holds, kept when its wine
            leaves the menu (the founder, 2026-09-21: "add a section to that
            where you can lock price, but wha f that menu item disappears?"). */}
        {activeRestaurantId ? <LockedPrices canManage={canManage} /> : null}

        {activeRestaurantId ? <MenuVersions canManage={canManage} /> : null}

        <footer
          style={{
            marginTop: 40,
            paddingTop: 12,
            borderTop: '1px solid var(--paper-2)',
          }}
        >
          <p className="cl-note" style={{ margin: 0, fontSize: 11 }}>
            Discard removes a line from what guests see. What it cost and who added it is kept —
            nothing here is a delete.
          </p>
        </footer>
      </div>
    </div>
  );
}
