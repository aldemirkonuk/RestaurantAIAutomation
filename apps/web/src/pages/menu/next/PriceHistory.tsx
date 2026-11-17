/**
 * When, by whom and from where a line's house price changed (r36 menu audit
 * N6): on day 30 the owner can see when Chianti went from 48 to 52, and who
 * moved it. Read from `GET /pricing/history/:inventoryId` (menu_price_versions),
 * newest first, for an owner or a manager. Nothing here writes.
 */
import { useQuery } from '@tanstack/react-query';
import { getHousePriceHistory, type HousePriceVersion } from '../../../services/api/priceHistory';

const SOURCE: Record<string, string> = {
  manual: 'by hand',
  import: 'from a menu',
  agent_accepted: 'accepting price advice',
  backfill: 'as it stood when price records began',
};

/**
 * A change by hand on /menu is written with the menu's source and the reason
 * "menu line corrected (bottle_price)" (menus.service). It is said as what it
 * was: set by hand on the menu, its bottle or glass price (r39 walk: the page
 * said "set from a menu … (menu line corrected (bottle_price))" while the
 * line's status read "set by hand: its bottle price").
 */
export const HAND_ON_MENU = /^menu line corrected \((bottle|glass)_price\)$/;

/**
 * The reasons the gateway and the database write, in the house's words; one
 * that only repeats how it was set says nothing. Any other reason (a person's
 * own words, accepted advice) is said as written.
 */
export function reasonWords(reason: string | null): string | null {
  if (!reason) return null;
  const r = reason.trim();
  if (r === 'menu line') return null;
  if (r === 'Seeded from restaurant_inventory when price versioning was introduced') return null;
  if (r === 'typed on /inventory') return 'typed on Inventory';
  if (r.startsWith('written without set_house_menu_price')) return 'written outside the price record, so no person or source was named';
  const hand = HAND_ON_MENU.exec(r);
  if (hand) return `its ${hand[1]} price`;
  return r;
}

/** One change in a sentence: the prices, since when, how, by whom, and why. */
export function versionWords(v: HousePriceVersion, money: (n: number) => string, namesReadable = true): string {
  const prices = [v.bottle !== null ? `bottle ${money(v.bottle)}` : null, v.glass !== null ? `glass ${money(v.glass)}` : null].filter(Boolean);
  const when = v.to ? `${v.from.slice(0, 10)} to ${v.to.slice(0, 10)}` : `since ${v.from.slice(0, 10)}`;
  const how = v.reason && HAND_ON_MENU.test(v.reason.trim()) ? 'by hand on the menu' : SOURCE[v.source] ?? v.source.replace(/_/g, ' ');
  const why = reasonWords(v.reason);
  const who = v.by.name
    ? `, by ${v.by.name}`
    : v.by.userId
      ? namesReadable
        ? ', by someone whose name is not on record'
        : ', by someone not named here'
      : '';
  return `${prices.length ? prices.join(', ') : 'no price'}, ${when}, set ${how}${who}${why ? ` (${why})` : ''}.`;
}

export function PriceHistory({ inventoryId, name, money }: { inventoryId: string; name: string; money: (n: number) => string }) {
  const q = useQuery({ queryKey: ['pricing', 'history', inventoryId], queryFn: () => getHousePriceHistory(inventoryId) });
  if (q.isLoading) {
    return (
      <p className="cl-said" role="status" style={{ fontSize: 12, margin: 0 }}>
        Reading the price history of {name}…
      </p>
    );
  }
  if (q.isError || !q.data) {
    const e = q.error as { response?: { status?: number; data?: { message?: unknown } }; message?: string } | null;
    const m = e?.response?.data?.message;
    const why = e?.response?.status === 403 ? 'only an owner or a manager reads it' : typeof m === 'string' && m ? m.replace(/\.$/, '') : e?.message || 'no reason was given';
    return (
      <p className="cl-said" role="alert" style={{ fontSize: 12, margin: 0 }} data-testid="menu-price-history-error">
        The price history of {name} could not be read ({why}).
      </p>
    );
  }
  const h = q.data;
  return (
    <div data-testid="menu-price-history">
      <p className="cl-said" style={{ fontSize: 12, margin: 0 }}>
        {h.versions.length === 0
          ? `${name} has no recorded price change yet.`
          : `How the house price of ${name} changed, newest first${h.more ? ` (the last ${h.versions.length}; older changes are kept)` : ''}:`}
      </p>
      {h.versions.length > 0 ? (
        <ul className="cl-said" style={{ fontSize: 12, paddingLeft: 18, margin: '4px 0 0' }}>
          {h.versions.map((v) => (
            <li key={v.from} data-testid="menu-price-history-line">
              {versionWords(v, money, h.namesReadable)}
            </li>
          ))}
        </ul>
      ) : null}
      {!h.namesReadable && h.namesReason ? <p className="cl-note">Not everyone could be named: {h.namesReason}.</p> : null}
    </div>
  );
}
