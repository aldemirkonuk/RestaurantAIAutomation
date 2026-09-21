import type { MenuImportReviewItem } from '../../../services/api/menus';

/**
 * What an added line did to the house's own price (ADR 0193: "it could be
 * changed every time a menu is updated"). The gateway says it per line; the
 * page says it back, so a write that failed is never read as a price that
 * moved. Null when there is nothing to say (no price on the line, or a line
 * that matches no wine the house stocks).
 */
export function housePriceNote(
  item: Pick<MenuImportReviewItem, 'priceSync' | 'priceSyncError'> | null | undefined,
): { tone: 'alert' | 'said'; text: string } | null {
  switch (item?.priceSync) {
    case 'changed':
      return { tone: 'said', text: "This wine's own price on Inventory now matches the line." };
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
    default:
      return null;
  }
}
