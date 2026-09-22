import type { MenuImportReviewItem } from '../../../services/api/menus';

/**
 * What an added line did to the house's own price (ADR 0193: "it could be
 * changed every time a menu is updated"). The gateway says it per line; the
 * page says it back, so a write that failed is never read as a price that
 * moved. Null when there is nothing to say (no price on the line, or a line
 * that matches no wine the house stocks).
 */
export function housePriceNote(
  item: Pick<MenuImportReviewItem, 'priceSync' | 'priceSyncError' | 'priceHeld'> | null | undefined,
): { tone: 'alert' | 'said'; text: string } | null {
  // ADR 0193 round 3 (L5): a kind a lock held is always named, even when the
  // other kind changed -- "changed" alone would hide the hold.
  const held = item?.priceHeld ?? [];
  const heldWords = held
    .map((h) => `the ${h.kind} price is locked${h.lockedPrice === null ? '' : ` at ${h.lockedPrice.toFixed(2)}`}`)
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
    case 'not_current':
      return {
        tone: 'said',
        text: "This menu is not the current one, so the house's own price was not changed. It changes when this menu is made current.",
      };
    default:
      return null;
  }
}
