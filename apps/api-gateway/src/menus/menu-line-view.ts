import { policyFor } from "../ask-readings/reading-data-classes";

/**
 * What one menu line read says to the person reading it (ADR 0309 option 1c,
 * amended after the audit of #655 at 220e3747d).
 *
 * The import keeps each line as the reading saw it in
 * `menu_items.raw_extracted_text`. For a CSV that is the WHOLE row
 * (`parsers/csv-parser.service.ts:55`), including every column the reader does
 * not map (cost, supplier, margin, notes: `HEADER_MAP`, `:5-29`), and no header
 * is kept with it, so nothing can tell which cell is a cost. Under ADR 0145's
 * ROLE_POLICY staff see neither `money` nor `suppliers`, so the raw line goes
 * only to a role that sees both.
 *
 * Every member gets `kitchen_line`, worked out here from the stored row, so a
 * line's kitchen split no longer depends on who reads it or in which tab.
 *
 * The reply's marker is `rawLineWithheld`, not the money-policy synthesis's
 * one root marker `amountsWithheld`: these replies still carry the sale prices
 * (`by_glass_price`, `bottle_price`) to every member until MENU-02 withholds
 * them, so `amountsWithheld: true` would tell a reader that amounts are gone
 * when they are not. Moving these replies to `amountsWithheld` belongs with
 * MENU-02 (the coordinator's money-policy synthesis of 2026-10-07, M2).
 */

/**
 * The kitchen hints. The same nine as the web's `KITCHEN`
 * (`apps/web/src/lib/firstProof.ts`); a CLAIMS row keeps the two lists equal.
 * 'dessert' is also a drink section, so a dessert wine counts as a kitchen
 * line: a known defect, filed in
 * `.planning/tech-debt.d/2026-10-07-fix-a-menu-line-carries-its-raw-line.md`.
 */
export const KITCHEN_HINTS = ["food", "kitchen", "dish", "starter", "dessert", "entree", "entrée", "pasta", "salad"];

/** The raw line's column. Sent only when the caller's view allows it. */
export const RAW_LINE_COLUMN = "raw_extracted_text";

/**
 * The keys of a line any member of the house is sent. An allowlist: a column
 * added to the select reaches nobody until it is named here.
 */
export const MEMBER_LINE_KEYS = [
  "id",
  "name",
  "producer",
  "category",
  "vintage",
  "region",
  "country",
  "grape_variety",
  "by_glass_price",
  "bottle_price",
  "wine_library_id",
  "inventory_item_id",
  "source",
  "status",
  "price_flag",
  "price_flag_note",
  "created_at",
] as const;

/** Who a line read is for. `rawLine` true sends the raw line itself. */
export interface LineView {
  rawLine: boolean;
}

/** The same test as the web's `isKitchenLine`: a hint in the section or in the raw line. */
export function isKitchenLine(category: unknown, raw: unknown): boolean {
  const hay = `${typeof category === "string" ? category : ""} ${typeof raw === "string" ? raw : ""}`.toLowerCase();
  return KITCHEN_HINTS.some((hint) => hay.includes(hint));
}

/**
 * Whether this token's role may read a line's raw line: its ROLE_POLICY row
 * must see both `money` and `suppliers`, because an unmapped CSV cell can be
 * either. An unknown or missing role reads the staff row (false); `admin`
 * reads the owner row (true).
 */
export function seesRawLine(role: string | null | undefined): boolean {
  const sees = policyFor(role).sees;
  return sees.includes("money") && sees.includes("suppliers");
}

/**
 * One stored line as this viewer is sent it: the allowlisted keys the row
 * has, `kitchen_line` for everyone, and the raw line only when `view.rawLine`.
 * When a stored raw line (a non-empty string) is held back, the line says
 * `raw_line_withheld: true`; a line with no stored raw line says nothing,
 * because there is nothing to withhold. A withheld raw line is a missing key,
 * never a null: null already means "no raw line kept".
 */
export function lineForViewer(row: Record<string, unknown>, view: LineView): Record<string, unknown> {
  const raw = row[RAW_LINE_COLUMN];
  const out: Record<string, unknown> = {};
  for (const key of MEMBER_LINE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(row, key)) out[key] = row[key];
  }
  out.kitchen_line = isKitchenLine(row.category, raw);
  if (view.rawLine) {
    out[RAW_LINE_COLUMN] = raw ?? null;
  } else if (typeof raw === "string" && raw.length > 0) {
    out.raw_line_withheld = true;
  }
  return out;
}
