import { Role } from "../auth/guards/roles.guard";
import { AskDisposition, QuestionClass, ReadingDescriptor, ReadingId } from "./reading.types";

/**
 * The two role sets a reading can carry (`ReadingDescriptor.allowedRoles`).
 * Founder, batch 4, 2026-09-19: "price, vendor, open-order and sales
 * readings are owner and manager only" -- five readings below name
 * `OWNER_MANAGER_ONLY`; the other ten name `ALL_ROLES`, unchanged from
 * today's behaviour.
 */
export const ALL_ROLES: readonly Role[] = ["owner", "manager", "staff"];
export const OWNER_MANAGER_ONLY: readonly Role[] = ["owner", "manager"];

/** Declared in the dated source census before implementation. Do not pad this floor. */
export const READING_CATALOGUE: readonly ReadingDescriptor[] = [
  { id: "inventory.position", version: 1, title: "The recorded stock", question: "What stock is recorded for this item?", subject: "item", window: false, shelves: ["restaurant_inventory"], meaning: "Live, shadow and in-transit quantities stay in the item's recorded ledger unit.", allowedRoles: ALL_ROLES },
  { id: "inventory.low_stock", version: 1, title: "Below the recorded threshold", question: "Which active items are below their threshold?", subject: "none", window: false, shelves: ["restaurant_inventory", "restaurants"], meaning: "Strictly below par; an unconfigured threshold is an assumption, including when its number looks ordinary.", allowedRoles: ALL_ROLES },
  { id: "inventory.in_transit", version: 1, title: "Recorded in transit", question: "Which items have stock recorded in transit?", subject: "none", window: false, shelves: ["restaurant_inventory"], meaning: "Positive quantities by item and unit; missing quantities remain unknown.", allowedRoles: ALL_ROLES },
  { id: "inventory.locations", version: 1, title: "Where the stock is held", question: "Where is this item's recorded stock held?", subject: "item", window: false, shelves: ["restaurant_inventory", "inventory_lots", "storage_locations"], meaning: "Lot quantities by location and stock lane. A missing location is unassigned.", allowedRoles: ALL_ROLES },
  { id: "inventory.movements", version: 1, title: "The movement record", question: "What changed this item's stock in this period?", subject: "item", window: true, shelves: ["restaurant_inventory", "inventory_transactions"], meaning: "Recorded net movements, keeping live and shadow lanes separate; not a reconstructed stock balance.", allowedRoles: ALL_ROLES },
  // Open-order: the founder's own word for this reading.
  { id: "orders.open", version: 1, title: "The open orders", question: "Which orders are still open?", subject: "none", window: false, shelves: ["procurement_orders"], meaning: "Orders outside the current closed-status family, grouped by their actual state.", allowedRoles: OWNER_MANAGER_ONLY },
  { id: "orders.lines", version: 1, title: "What the order contains", question: "What does this order contain?", subject: "order", window: false, shelves: ["procurement_orders", "procurement_order_items"], meaning: "Recorded line quantities and units. Legacy header-only orders are labelled; an unproven case pack is not a physical bottle count.", allowedRoles: ALL_ROLES },
  { id: "orders.late_deliveries", version: 1, title: "Past the stated delivery date", question: "Which open deliveries are past the date I specify?", subject: "none", window: true, shelves: ["procurement_orders"], meaning: "Open orders with a stated date in the selected past-date window; a planned date is not a supplier promise.", allowedRoles: ALL_ROLES },
  // Price: the only reading that carries a price basis (a bottle's recorded cost).
  { id: "receipts.verified_line", version: 1, title: "The last verified receipt line", question: "What did the last verified receipt record for this item?", subject: "item", window: false, shelves: ["restaurant_inventory", "procurement_documents", "procurement_document_lines", "procurement_document_links", "procurement_orders", "procurement_order_items"], meaning: "An explicitly linked line on a verified receipt or invoice, with its recorded price basis and currency provenance. No inferred freight allocation.", allowedRoles: OWNER_MANAGER_ONLY },
  // Sales: covers and consumption -- the founder's "sales etc" example verbatim.
  { id: "sales.check_activity", version: 1, title: "The recorded checks", question: "How many closed checks and covers were recorded in this period?", subject: "none", window: true, shelves: ["pos_checks"], meaning: "Nonvoid closed checks and known covers. Missing covers are counted separately; no currency or revenue inference.", allowedRoles: OWNER_MANAGER_ONLY },
  { id: "sales.consumption", version: 1, title: "The consumption record", question: "What consumption was recorded for this item in this period?", subject: "item", window: true, shelves: ["restaurant_inventory", "wine_consumption_log"], meaning: "Recorded millilitres and separate serving counts by glass/bottle; no unstated bottle-volume conversion.", allowedRoles: OWNER_MANAGER_ONLY },
  { id: "calendar.upcoming", version: 1, title: "The house calendar", question: "What is in the house calendar for this period?", subject: "none", window: true, shelves: ["calendar_events", "calendar_recurrence_rules", "calendar_recurrence_exceptions"], meaning: "Stored entries and supported recurring occurrences, applying cancellations and replacements once; no demand forecast.", allowedRoles: ALL_ROLES },
  // Vendor: who the house buys from -- the founder's "vendor" example verbatim.
  { id: "vendors.active", version: 1, title: "The attached vendors", question: "Which vendors are attached and active?", subject: "none", window: false, shelves: ["providers", "restaurant_providers"], meaning: "Owned vendors plus active authorized links; explicit revocation wins, and unlinked shared providers stay private.", allowedRoles: OWNER_MANAGER_ONLY },
  { id: "documents.waiting", version: 1, title: "Documents awaiting review", question: "Which documents are waiting for review?", subject: "none", window: false, shelves: ["procurement_documents"], meaning: "Received, extracting and needs-review remain different states; documents are not all invoices.", allowedRoles: ALL_ROLES },
  { id: "goals.targets", version: 1, title: "The posted targets", question: "What goals and targets are posted?", subject: "none", window: false, shelves: ["analytics_goals"], meaning: "Active targets and deadlines, not progress inferred from a default zero.", allowedRoles: ALL_ROLES },
] as const;

/**
 * Server-side, per-reading enforcement (founder, batch 4, 2026-09-19): does
 * THIS role receive THIS reading's answer. An open reading (`allowedRoles`
 * includes "staff") returns `true` for every caller, staff included --
 * unchanged from today, so this never newly restricts a reading nobody asked
 * to restrict. An owner/manager-only reading mirrors `RolesGuard`'s own
 * admin-equivalence rule (`roles.guard.ts`) so this module never drifts from
 * the app's one other owner/manager gate: "admin" satisfies it, "staff" and
 * an absent/unrecognised role do not.
 *
 * Deliberately NOT keyed on the model's own class label -- readings are
 * looked up by `ReadingId`, the same catalogue key `BoundAskService` already
 * resolves a question to before this runs, so a caller cannot spoof a class
 * name into a role it does not have.
 */
export function isReadingAllowedForRole(id: ReadingId, role: string | null | undefined): boolean {
  const descriptor = READING_CATALOGUE.find(r => r.id === id);
  if (!descriptor) return false; // not a real reading: fail closed
  if (descriptor.allowedRoles.includes("staff")) return true; // open reading: behaviour unchanged
  const normalized = role ? String(role).toLowerCase() : "";
  return normalized === "owner" || normalized === "manager" || normalized === "admin";
}

/** Exhaustiveness makes a newly named question an explicit product disposition. */
export const QUESTION_DISPOSITIONS: Record<QuestionClass, AskDisposition> = {
  "inventory.position": { kind: "reading", id: "inventory.position" },
  "inventory.low_stock": { kind: "reading", id: "inventory.low_stock" },
  "inventory.in_transit": { kind: "reading", id: "inventory.in_transit" },
  "inventory.locations": { kind: "reading", id: "inventory.locations" },
  "inventory.movements": { kind: "reading", id: "inventory.movements" },
  "orders.open": { kind: "reading", id: "orders.open" },
  "orders.lines": { kind: "reading", id: "orders.lines" },
  "orders.late_deliveries": { kind: "reading", id: "orders.late_deliveries" },
  "receipts.verified_line": { kind: "reading", id: "receipts.verified_line" },
  "sales.check_activity": { kind: "reading", id: "sales.check_activity" },
  "sales.consumption": { kind: "reading", id: "sales.consumption" },
  "calendar.upcoming": { kind: "reading", id: "calendar.upcoming" },
  "vendors.active": { kind: "reading", id: "vendors.active" },
  "documents.waiting": { kind: "reading", id: "documents.waiting" },
  "goals.targets": { kind: "reading", id: "goals.targets" },
  forecast: { kind: "not_built" }, landed_cost: { kind: "not_built" },
  sales_revenue: { kind: "not_built" }, lot_expiry: { kind: "not_built" },
  general_knowledge: { kind: "model_knowledge" }, unrecognized: { kind: "no_reading_matched" },
};
export function isReadingId(value: unknown): value is ReadingId {
  return typeof value === "string" && READING_CATALOGUE.some(r => r.id === value);
}
