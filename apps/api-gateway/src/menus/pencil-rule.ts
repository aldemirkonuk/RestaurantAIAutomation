import { MENU_CATEGORY_VOCABULARY } from "./wine-extract-item.interface";

/**
 * ADR 0213 honesty residual: pencil = unmatched fallback, unless the
 * extractor already returned a usable category signal. Do not invent
 * confidence. A known vocabulary category on a matched line is ink.
 */
export function itemNeedsPencil(item: {
  matched: boolean;
  category?: string | null;
}): boolean {
  if (!item.matched) return true;
  const category = item.category?.toLowerCase().trim() ?? "";
  if (!category || category === "unknown") return true;
  return !(MENU_CATEGORY_VOCABULARY as readonly string[]).includes(category);
}
