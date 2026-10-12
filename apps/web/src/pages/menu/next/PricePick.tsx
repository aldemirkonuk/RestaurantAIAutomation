/**
 * Two prices for one drink, and the owner picks one (F-618; the founder's
 * answer S202, an amendment to ADR 0193).
 *
 * Making a menu current sets its prices, dated at the moment it became current
 * (change_source 'menu_current'), so the live menu's prices are the newest and
 * win. Two things still keep the house price apart from the live line: a
 * locked price ("The menu sets it, locks keep") and a price a person set after
 * the menu became current. Then the line says both, "Locked at X — the menu
 * says Y" (or "Your price X — ..."), never two prices in silence, and an owner
 * or a manager picks the one the house charges with one tap:
 *   - Keep X: the menu line is corrected to X (PATCH /menus/items/:id). A
 *     lock stays as it is; an unlocked house price is already X.
 *   - Use the menu's Y: a locked price is changed to Y and stays locked
 *     (POST /pricing/locks/:id/change); an unlocked one is set to Y through
 *     the same line correction, which moves the house price with it.
 * Who may pick is the gateway's check (owner or manager, ADR 0193); staff read
 * the two prices and get no buttons.
 *
 * Used on /menu (each price cell) and on the wine's reading stand in the
 * cellar (WineMenuPrices, beside the lock note).
 *
 * ADR 0340 (one live menu per kind): a house may have Drinks and Desserts
 * live at once, and the same wine on both. The line names its menu's kind
 * when more than one kind is live, and a correction that moved the house
 * price says the other live kinds it also changed on (rule 21: the follow
 * trigger brings every other live line of that item to the house price).
 * ConflictPick is the make-live review's pick (rule 19): one wine at two
 * prices across what would be live, and the owner picks the one it has.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMenu,
  kindName,
  reviewMenuItem,
  type MenuLine,
  type PriceConflict,
} from '../../../services/api/menus';
import { changeLockedPrice, listPriceLocks, type PriceLock } from '../../../services/api/pricing';

type Kind = 'bottle' | 'glass';

/** The line prints a price the house does not charge (a blank beside a known house price counts). */
export function housePriceDiffers(linePrice: number | null, housePrice: number | null | undefined): boolean {
  if (housePrice === null || housePrice === undefined) return false;
  return linePrice === null || Math.abs(linePrice - housePrice) >= 0.005;
}

/**
 * The other live kinds the same house item is a drink line on: where a price
 * correction on `line` also lands (rule 21). Dishes are left out: the follow
 * trigger never gives a dish a drink price. Empty for a line with no house
 * item, or when the reply did not say which menu each line is on.
 */
export function alsoOnKinds(items: MenuLine[], line: Pick<MenuLine, 'id' | 'inventory_item_id' | 'menu_type'>): string[] {
  if (!line.inventory_item_id || !line.menu_type) return [];
  const names = items
    .filter(
      (l) =>
        l.id !== line.id &&
        l.inventory_item_id === line.inventory_item_id &&
        l.line_kind !== 'dish' &&
        l.menu_type &&
        l.menu_type !== line.menu_type,
    )
    .map((l) => kindName(l.menu_type))
    .filter((n): n is string => n !== null);
  return [...new Set(names)];
}

/** "Desserts", "Food and Desserts". */
function joinKinds(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function why(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { message?: unknown } }; message?: string };
  const m = e?.response?.data?.message;
  if (typeof m === 'string' && m) return m;
  if (Array.isArray(m) && m.length) return String(m[0]);
  if (e?.response?.status === 403) return 'only an owner or a manager can pick the price';
  return e?.message || 'no reason given';
}

export function PricePick({ house, inventoryId, lineId, kind, linePrice, housePrice, canPick, fmt, menuKind = null, alsoOn = [] }: {
  house: string | null
  /** The line's menu, named only when more than one kind is live ("the Drinks menu says"). */
  menuKind?: string | null
  /** The other live kinds this item is on: a moved house price follows there (rule 21). */
  alsoOn?: string[]
  inventoryId: string | null
  lineId: string
  kind: Kind
  linePrice: number | null
  housePrice: number
  canPick: boolean
  fmt: (v: number | null) => string
}) {
  const queryClient = useQueryClient();
  // The same house-keyed read as Menu's Locked prices (MENU-01): no extra call.
  const locks = useQuery({ queryKey: ['pricing', 'locks', house], queryFn: listPriceLocks, enabled: Boolean(inventoryId) });
  const lock: PriceLock | null =
    locks.data?.readable === false
      ? null
      : (locks.data?.locks.find((l) => l.inventoryId === inventoryId && l.kind === kind) ?? null);
  // While a lock is open the house price IS the locked price (L3); one figure for both.
  const held = lock ? lock.lockedPrice : housePrice;
  const [said, setSaid] = useState<{ text: string; alert: boolean } | null>(null);
  const field = kind === 'bottle' ? 'bottle_price' : 'by_glass_price';

  const pick = useMutation({
    mutationFn: async (to: 'house' | 'menu'): Promise<{ text: string; alert: boolean }> => {
      if (to === 'house') {
        const r = await reviewMenuItem(lineId, field, String(held));
        if (r.priceSync === 'failed')
          return {
            text: `The menu now says ${fmt(held)}, but whether the house price still matches could not be checked (${r.priceSyncError ?? 'no reason given'}).`,
            alert: true,
          };
        return { text: `The menu now says ${fmt(held)}, the price the house charges.`, alert: false };
      }
      const price = linePrice as number;
      if (lock) {
        const r = await changeLockedPrice(lock.lockId, price, "picked the menu's price on Menu");
        return { text: r.sentence, alert: false };
      }
      const r = await reviewMenuItem(lineId, field, String(price));
      if (r.priceSync === 'changed' && alsoOn.length > 0)
        return {
          text: `The house now charges ${fmt(price)}, as the menu says; also changed on ${joinKinds(alsoOn)}.`,
          alert: false,
        };
      if (r.priceSync === 'changed' || r.priceSync === 'unchanged')
        return { text: `The house now charges ${fmt(price)}, as the menu says.`, alert: false };
      if (r.priceSync === 'locked')
        return {
          text: `This ${kind} price is locked, so the house still charges ${fmt(held)}. Change it under Locked prices.`,
          alert: true,
        };
      return {
        text: `The house price was not changed (${r.priceSyncError ?? r.priceSync ?? 'no reason given'}).`,
        alert: true,
      };
    },
    onSuccess: (r) => {
      setSaid(r);
      void queryClient.invalidateQueries({ queryKey: ['menu', 'active'] });
      void queryClient.invalidateQueries({ queryKey: ['pricing', 'locks'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (err) => setSaid({ text: `That did not save (${why(err)}).`, alert: true }),
  });

  const ours = lock ? `Locked at ${fmt(lock.lockedPrice)}` : `Your price ${fmt(housePrice)}`;
  // One kind live keeps the S202 words exactly ("the menu says Y"); more than
  // one names the line's menu ("the Drinks menu says Y").
  const menuWords = menuKind ? `the ${menuKind} menu` : 'the menu';
  const theirs =
    linePrice === null
      ? `${menuWords} shows no price`
      : menuKind
        ? `${menuWords} says ${fmt(linePrice)}`
        : `the menu says ${fmt(linePrice)}`;
  return (
    <span style={{ display: 'block' }} data-testid={`price-pick-${kind}`}>
      <span
        className="cl-note"
        style={{ display: 'block' }}
        data-testid={`menu-house-price-${kind}`}
        title="The house's own price is the one Inventory, Reports and the till use."
      >
        {ours} — {theirs}
      </span>
      {canPick ? (
        <span style={{ display: 'block', whiteSpace: 'nowrap' }}>
          <button
            type="button"
            className="cl-btn cl-focus"
            disabled={pick.isPending}
            onClick={() => pick.mutate('house')}
            data-testid={`price-pick-keep-${kind}`}
          >
            Keep {fmt(held)}
          </button>
          {linePrice !== null ? (
            <>
              {' '}
              <button
                type="button"
                className="cl-btn cl-focus"
                disabled={pick.isPending}
                onClick={() => pick.mutate('menu')}
                data-testid={`price-pick-menu-${kind}`}
              >
                Use the menu&rsquo;s {fmt(linePrice)}
              </button>
            </>
          ) : null}
        </span>
      ) : null}
      {said ? (
        <span role={said.alert ? 'alert' : 'status'} className="cl-said" style={{ display: 'block', fontSize: 12 }}>
          {said.text}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The wine's side (the cellar's reading stand): the current menu's lines for
 * this wine whose price is not the house's, each with the same pick. Reads the
 * same house-keyed menu as /menu. A menu that could not be read is said, never
 * taken for "no difference".
 */
export function WineMenuPrices({ house, inventoryId, canPick, fmt }: {
  house: string | null
  inventoryId: string
  canPick: boolean
  fmt: (v: number | null) => string
}) {
  const q = useQuery({
    queryKey: ['menu', 'active', house],
    enabled: Boolean(house),
    queryFn: () => getMenu(house as string),
  });
  if (!house || q.isLoading) return null;
  if (q.isError || !q.data) {
    return (
      <p className="cl-note" role="alert" data-testid="wine-menu-prices-unread" style={{ marginTop: 4 }}>
        Whether the current menu prints another price for this wine could not be read
        {q.error instanceof Error ? ` (${q.error.message})` : ''}.
      </p>
    );
  }
  if (q.data.housePricesReadable === false) return null;
  const items = q.data.items;
  const manyKinds = (q.data.kinds?.length ?? 0) > 1;
  const picks = items
    .filter((l) => l.inventory_item_id === inventoryId)
    .flatMap((l) =>
      (['bottle', 'glass'] as const)
        .map((kind) => {
          const linePrice = kind === 'bottle' ? l.bottle_price : l.by_glass_price;
          const housePrice = kind === 'bottle' ? l.house_bottle_price : l.house_glass_price;
          return housePriceDiffers(linePrice, housePrice)
            ? {
                key: `${l.id}-${kind}`,
                lineId: l.id,
                kind,
                linePrice,
                housePrice: housePrice as number,
                menuKind: manyKinds ? kindName(l.menu_type) : null,
                alsoOn: alsoOnKinds(items, l),
              }
            : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    );
  if (picks.length === 0) return null;
  return (
    <div data-testid="wine-menu-prices" style={{ marginTop: 4 }}>
      {picks.map((p) => (
        <PricePick
          key={p.key}
          house={house}
          inventoryId={inventoryId}
          lineId={p.lineId}
          kind={p.kind}
          linePrice={p.linePrice}
          housePrice={p.housePrice}
          canPick={canPick}
          fmt={fmt}
          menuKind={p.menuKind}
          alsoOn={p.alsoOn}
        />
      ))}
    </div>
  );
}

/** The key one pick is held under: one answer per wine and price kind. */
export function conflictKey(c: Pick<PriceConflict, 'wineLibraryId' | 'kind'>): string {
  return `${c.wineLibraryId}:${c.kind}`;
}

/**
 * One wine at two prices of one price kind across what would be live (ADR
 * 0340 rule 19, S198). Each price names the menu it is on and whether that
 * menu is live; the owner taps the one the wine has. Nothing is written: the
 * pick is held by the review and sent with "Make live" (a pick is a draft
 * edit only). Staff read the prices and get no buttons.
 */
export function ConflictPick({ conflict, picked, canPick, onPick, fmt }: {
  conflict: PriceConflict
  picked: number | null
  canPick: boolean
  onPick: (price: number) => void
  fmt: (v: number | null) => string
}) {
  const prices = [...new Set(conflict.prices.map((p) => p.price))];
  const where = (price: number) =>
    conflict.prices
      .filter((p) => p.price === price)
      .map((p) => `${kindName(p.menuKind) ?? 'a menu'} (${p.live ? 'live' : 'draft'})`)
      .join(', ');
  return (
    <li data-testid="conflict-pick" style={{ marginTop: 6 }}>
      <span>
        {conflict.name} ({conflict.kind}):{' '}
        {prices.map((p) => `${fmt(p)} on ${where(p)}`).join(' · ')}
      </span>
      {canPick ? (
        <span role="group" aria-label={`The ${conflict.kind} price of ${conflict.name}`} style={{ display: 'block', marginTop: 4 }}>
          {prices.map((p) => (
            <button
              key={p}
              type="button"
              className="cl-btn cl-focus"
              aria-pressed={picked === p}
              data-on={picked === p ? 'true' : 'false'}
              onClick={() => onPick(p)}
              style={{ marginRight: 6 }}
            >
              {fmt(p)}
            </button>
          ))}
        </span>
      ) : null}
      {picked !== null ? (
        <span className="cl-said" style={{ display: 'block', fontSize: 12 }}>
          Picked {fmt(picked)}: every draft line of it takes this price when the menus go live.
        </span>
      ) : null}
    </li>
  );
}
