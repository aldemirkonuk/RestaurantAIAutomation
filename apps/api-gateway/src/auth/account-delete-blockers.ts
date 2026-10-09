/**
 * F-457 (house-lifecycle sim, 2026-10-09). Deleting an account used to leave
 * every house and drop the sign-in links, and only then delete the `users`
 * row — which the house's own records refuse once the person has, say,
 * written a crew note (`team_notes.author_user_id ... ON DELETE RESTRICT`) or
 * changed a menu price. The account stayed and the houses were gone.
 *
 * `account_delete_blockers` (migration an_account_is_deleted_whole_or_not_at_all)
 * answers, before the first write, which records would refuse that delete.
 * This file reads it and words the answer for the person. It does not decide
 * how long those records are kept (OD-163 is open): it only makes the delete
 * refuse up front, naming them, instead of failing half-way. Decision note:
 * p4-scratch/sim-run/bulletproof/reconcile/account-delete-decisions.md.
 */

export interface AccountDeleteBlocker {
  table_name: string;
  column_name: string | null;
  row_count: number | null;
}

/** The records the sim and the catalog show, in a restaurant's words. */
const RECORD_WORDS: Record<string, string> = {
  team_notes: "crew notes",
  calendar_day_notes: "calendar notes",
  menu_price_versions: "menu price changes",
  restaurant_menus: "menus",
  house_price_locks: "price locks",
  delivery_line_acceptances: "delivery checks",
  procurement_order_arrival_answers: "delivery answers",
  price_index_upload_reviews: "price list reviews",
  distributor_price_code_mappings: "vendor price codes",
  house_item_commodity_exposure: "item cost links",
  restaurant_inventory: "stock settings",
  master_wine_library: "wine details",
  restaurants: "restaurant settings",
  providers: "vendor settings",
  goal_scenario_request: "goal plans",
  auction_lot_records: "auction records",
};

const recordWords = (table: string): string =>
  RECORD_WORDS[table.replace(/^public\./, "").replace(/"/g, "")] ??
  "other records";

/** "crew notes and menu price changes", each named once, in a stable order. */
export function nameTheRecords(blockers: AccountDeleteBlocker[]): string {
  const words = [...new Set(blockers.map((b) => recordWords(b.table_name)))];
  if (words.length <= 1) return words[0] ?? "other records";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export function blockedDeleteMessage(blockers: AccountDeleteBlocker[]): string {
  return (
    `Your name is on ${nameTheRecords(blockers)} that your restaurant keeps, ` +
    "so the account can't be deleted yet. Nothing was changed: you are still " +
    "in your restaurants and can still sign in."
  );
}
