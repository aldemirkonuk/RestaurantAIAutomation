import type { MenuImportReviewItem, MenuItemCorrection } from '../../../services/api/menus';
import { formatMoney } from '../../../lib/currency';

/**
 * What an added line did to the house's own price (ADR 0193: "it could be
 * changed every time a menu is updated"). The gateway says it per line; the
 * page says it back, so a write that failed is never read as a price that
 * moved. Null when there is nothing to say (no price on the line, or a line
 * that matches no wine the house stocks).
 */
export function housePriceNote(
  item: Pick<MenuImportReviewItem, 'priceSync' | 'priceSyncError' | 'priceHeld'> | null | undefined,
  /** The house's money; a held price is written in it ("locked at ₺95,00"). */
  currency: string | null = null,
): { tone: 'alert' | 'said'; text: string } | null {
  // ADR 0193 round 3 (L5): a kind a lock held is always named, even when the
  // other kind changed -- "changed" alone would hide the hold.
  const held = item?.priceHeld ?? [];
  const heldWords = held
    .map((h) => `the ${h.kind} price is locked${h.lockedPrice === null ? '' : ` at ${formatMoney(h.lockedPrice, currency)}`}`)
    .join(' and ');
  switch (item?.priceSync) {
    case 'changed':
      return held.length
        ? { tone: 'said', text: `This wine's own price on Inventory was updated where it could be; ${heldWords}, so that one was not changed.` }
        : { tone: 'said', text: "This wine's own price on Inventory now matches the line." };
    case 'locked':
      return {
        tone: 'said',
        text: `Added to the menu, but ${heldWords || 'this price is locked'}, so the house's price was not changed. An owner or a manager changes it under Locked prices.`,
      };
    case 'stale':
      return {
        tone: 'said',
        text: "A newer price for this wine was set after this line was dated, so the house's price was kept.",
      };
    case 'failed':
      return {
        tone: 'alert',
        text: `Added to the menu, but this wine's own price was NOT updated (${item.priceSyncError || 'no reason given'}). Change it on Inventory, under Your price.`,
      };
    case 'kitchen_line':
      return {
        tone: 'said',
        text: 'A kitchen line: it stays on the menu, and no wine, price or stock is made for it.',
      };
    case 'not_current':
      return {
        tone: 'said',
        text: "This menu is not the current one, so the house's own price was not changed. It changes when this menu is made current.",
      };
    default:
      return null;
  }
}

/** One price a person changed on a current-menu line, and what the gateway answered. */
export interface PriceChange {
  kind: 'bottle' | 'glass'
  /** The price as the page shows it, in the house's money. */
  shown: string
  /** The gateway's answer, or the reason the change was refused. */
  result: MenuItemCorrection | { refused: string }
}

/**
 * What changing a price on the current menu did, in one sentence per price
 * (menu r21: the page could add and discard a line, never change its price).
 * The menu line always takes the new price when the gateway answers; whether
 * the house's own price followed is said, never implied.
 */
export function priceChangeNote(
  name: string,
  dish: boolean,
  changes: PriceChange[],
  money: (n: number | null) => string,
): { tone: 'alert' | 'said'; text: string } | null {
  if (changes.length === 0) return null;
  let alert = false;
  const parts = changes.map((c) => {
    // A dish has one price (bottle_price); a glass-column price is named apart (r28 G13).
    const what = dish ? (c.kind === 'glass' ? 'the glass-column price' : 'the price') : `the ${c.kind} price`;
    if ('refused' in c.result) {
      alert = true;
      return `${what} was not changed (${c.result.refused})`;
    }
    const r = c.result;
    const now = `${what} is now ${c.shown} on the menu`;
    const held = (r.priceHeld ?? []).find((h) => h.kind === c.kind);
    switch (r.priceSync) {
      case 'changed':
        return `${now}, and the house's own ${c.kind} price is ${c.shown} too`;
      case 'unchanged':
        return `${now}; the house's own ${c.kind} price was already ${c.shown}`;
      case 'locked':
        return `${now}, but the house's ${c.kind} price is locked${held && held.lockedPrice !== null ? ` at ${money(held.lockedPrice)}` : ''}, so it was not changed. An owner or a manager changes it under Locked prices`;
      case 'stale':
        return `${now}; the house kept a ${c.kind} price someone set after this line was dated`;
      case 'kitchen_line':
        return `${now}. A dish has no house price and no stock, so nothing else changed`;
      case 'not_linked':
        return `${now}. The line is not matched to anything the house stocks, so no house price changed`;
      case 'not_current':
        return `${now}. This menu is not the current one, so the house's own price changes when it is made current`;
      case 'failed':
        alert = true;
        return `${now}, but the house's own ${c.kind} price was NOT changed (${r.priceSyncError || 'no reason was given'}). Change it on Inventory, under Your price`;
      default:
        return now;
    }
  });
  return { tone: alert ? 'alert' : 'said', text: `${name}: ${parts.join('; ')}.` };
}
