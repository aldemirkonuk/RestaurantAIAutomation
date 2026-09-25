import { Role } from "../auth/guards/roles.guard";
import { classesOfFields, hiddenClasses, policyFor, ROLE_POLICY, rolesSeeing, RolePolicyTable } from "./reading-data-classes";
import { AskDisposition, QuestionClass, ReadingDescriptor, ReadingId } from "./reading.types";

/**
 * Who may receive each Reading's answer.
 *
 * Founder, batch 4, 2026-09-19, his words: "do not give money or sensitive
 * incentives like sales etc to the staff, maybe we should exclude staff from
 * this equation" -> price, vendor, open-order and sales readings are owner
 * and manager only.
 *
 * [CORRECTED 2026-09-21, KL round 5: `orders.late_deliveries` reads the
 * identical `open` order set `orders.open` computes (`reading-runner.ts`), so
 * leaving it open let a role-refused caller reach the same rows through a
 * wider date window.]
 *
 * [ANSWERED 2026-09-21, founder round 5 -- recorded answer, not a quotation:
 * the posted-targets reading (`goals.targets`) is owner/manager only too, a
 * money measure.]
 *
 * [REBUILT 2026-09-21, founder's option "Rules in code, label rows" (ADR 0145,
 * 2026-09-21 amendment): `allowedRoles` is no longer hand-set per Reading.
 * Each Reading declares the fields it `shows`; each field carries a data class
 * (`reading-data-classes.ts` FIELD_CLASS); a Reading's roles are the
 * ROLE_POLICY rows that see every class it shows. The seven restricted and
 * eight open Readings above come out of that derivation unchanged, and
 * `scripts/check_ask_field_classes.py` fails CI when they stop doing so. Who
 * may open `/ask` itself is still open with the founder and is untouched.]
 *
 * [ANSWERED 2026-09-21, founder round 6, his pick verbatim: "Yes, own-work
 * only". Staff reach `/ask` and see stock, receiving and today's deliveries;
 * money, supplier prices and people data are refused with a one-line reason.
 * `calendar.upcoming` (people) is now refused to staff, and `orders.due_today`
 * -- today's open deliveries, read through the order book's `due_today` row
 * view so no order count, price or value reaches its cells -- is open to
 * them. Eight restricted, eight open, still derived.]
 */

/**
 * The field a subject match is labelled by. A clarifying reply lists up to 30
 * matches BY this label (`reading-runner.ts` `label`), so it is shown too.
 */
export const SUBJECT_LABEL_FIELDS: Readonly<Record<"item" | "order", readonly string[]>> = {
  item: ["restaurant_inventory.display_name", "restaurant_inventory.wine_name"],
  order: ["procurement_orders.order_number"],
};

type DeclaredReading = Omit<ReadingDescriptor, "allowedRoles" | "classes">;

/**
 * Declared in the dated source census before implementation. Do not pad this floor.
 * [2026-09-21, round 6: `orders.due_today` added on the founder's answer (staff ask about today's deliveries).]
 */
const DECLARED: readonly DeclaredReading[] = [
  { id: "inventory.position", version: 1, title: "The recorded stock", question: "What stock is recorded for this item?", subject: "item", window: false, shelves: ["restaurant_inventory"], meaning: "Live, shadow and in-transit quantities stay in the item's recorded ledger unit.", shows: ["restaurant_inventory.uom", "restaurant_inventory.stock_live", "restaurant_inventory.shadow_stock", "restaurant_inventory.in_transit_quantity"] },
  { id: "inventory.low_stock", version: 1, title: "Below the recorded threshold", question: "Which active items are below their threshold?", subject: "none", window: false, shelves: ["restaurant_inventory", "restaurants"], meaning: "Strictly below par; an unconfigured threshold is an assumption, including when its number looks ordinary.", shows: ["restaurant_inventory.*", "restaurant_inventory.display_name", "restaurant_inventory.wine_name", "restaurant_inventory.uom", "restaurant_inventory.stock_live", "restaurant_inventory.threshold_min"] },
  { id: "inventory.in_transit", version: 1, title: "Recorded in transit", question: "Which items have stock recorded in transit?", subject: "none", window: false, shelves: ["restaurant_inventory"], meaning: "Positive quantities by item and unit; missing quantities remain unknown.", shows: ["restaurant_inventory.*", "restaurant_inventory.display_name", "restaurant_inventory.wine_name", "restaurant_inventory.uom", "restaurant_inventory.in_transit_quantity"] },
  { id: "inventory.locations", version: 1, title: "Where the stock is held", question: "Where is this item's recorded stock held?", subject: "item", window: false, shelves: ["restaurant_inventory", "inventory_lots", "storage_locations"], meaning: "Lot quantities by location and stock lane. A missing location is unassigned.", shows: ["inventory_lots.*", "inventory_lots.location_id", "inventory_lots.stock_state", "inventory_lots.qty", "storage_locations.name", "restaurant_inventory.uom"] },
  { id: "inventory.movements", version: 1, title: "The movement record", question: "What changed this item's stock in this period?", subject: "item", window: true, shelves: ["restaurant_inventory", "inventory_transactions"], meaning: "Recorded net movements, keeping live and shadow lanes separate; not a reconstructed stock balance.", shows: ["inventory_transactions.*", "inventory_transactions.stock_type", "inventory_transactions.quantity_change", "restaurant_inventory.uom"] },
  // Open-order: the recorded category for this reading (see the module doc
  // above -- not the founder's own word).
  { id: "orders.open", version: 1, title: "The open orders", question: "Which orders are still open?", subject: "none", window: false, shelves: ["procurement_orders"], meaning: "Orders outside the current closed-status family, grouped by their actual state.", shows: ["procurement_orders.*", "procurement_orders.order_number", "procurement_orders.status", "procurement_orders.expected_delivery_date"] },
  { id: "orders.lines", version: 1, title: "What the order contains", question: "What does this order contain?", subject: "order", window: false, shelves: ["procurement_orders", "procurement_order_items"], meaning: "Recorded line quantities and units. Legacy header-only orders are labelled; an unproven case pack is not a physical bottle count.", shows: ["procurement_order_items.*", "procurement_order_items.wine_name", "procurement_order_items.quantity", "procurement_order_items.unit_type", "procurement_order_items.bottles_per_unit", "procurement_orders.order_number", "procurement_orders.quantity", "procurement_orders.unit_type"] },
  // [CORRECTED 2026-09-21, KL round 5: this was ALL_ROLES, a bypass of
  // orders.open's gate -- it reads the identical `open` order set
  // (reading-runner.ts), filtered by date, and lists the same three
  // columns, so a staff caller refused orders.open could reach every one of
  // those rows through a wide-enough past window instead. Same category as
  // orders.open, so the same gate.]
  { id: "orders.late_deliveries", version: 1, title: "Past the stated delivery date", question: "Which open deliveries are past the date I specify?", subject: "none", window: true, shelves: ["procurement_orders"], meaning: "Open orders with a stated date in the selected past-date window; a planned date is not a supplier promise.", shows: ["procurement_orders.*", "procurement_orders.order_number", "procurement_orders.status", "procurement_orders.expected_delivery_date"] },
  // Price: the only reading that carries a price basis (a bottle's recorded cost).
  { id: "receipts.verified_line", version: 1, title: "The last verified receipt line", question: "What did the last verified receipt record for this item?", subject: "item", window: false, shelves: ["restaurant_inventory", "procurement_documents", "procurement_document_lines", "procurement_document_links", "procurement_orders", "procurement_order_items"], meaning: "An explicitly linked line on a verified receipt or invoice, with its recorded price basis and currency provenance. No inferred freight allocation.", shows: ["procurement_documents.doc_number", "procurement_documents.verified_at", "procurement_documents.currency", "procurement_document_lines.qty", "procurement_document_lines.uom", "procurement_document_lines.pack_size", "procurement_document_lines.unit_price", "procurement_document_lines.price_base_qty", "procurement_document_lines.price_base_uom"] },
  // Sales: covers and consumption -- the founder's "sales etc" example verbatim.
  { id: "sales.check_activity", version: 1, title: "The recorded checks", question: "How many closed checks and covers were recorded in this period?", subject: "none", window: true, shelves: ["pos_checks"], meaning: "Nonvoid closed checks and known covers. Missing covers are counted separately; no currency or revenue inference.", shows: ["pos_checks.*", "pos_checks.covers"] },
  { id: "sales.consumption", version: 1, title: "The consumption record", question: "What consumption was recorded for this item in this period?", subject: "item", window: true, shelves: ["restaurant_inventory", "wine_consumption_log"], meaning: "Recorded millilitres and separate serving counts by glass/bottle; no unstated bottle-volume conversion.", shows: ["wine_consumption_log.*", "wine_consumption_log.volume_ml", "wine_consumption_log.quantity", "wine_consumption_log.consumption_type"] },
  { id: "calendar.upcoming", version: 1, title: "The house calendar", question: "What is in the house calendar for this period?", subject: "none", window: true, shelves: ["calendar_events", "calendar_recurrence_rules", "calendar_recurrence_exceptions"], meaning: "Stored entries and supported recurring occurrences, applying cancellations and replacements once; no demand forecast.", shows: ["calendar_events.*", "calendar_events.title", "calendar_events.start_date", "calendar_events.start_time", "calendar_events.status"] },
  // Vendor: who the house buys from -- the recorded category for this
  // reading (see the module doc above -- not the founder's own word).
  { id: "vendors.active", version: 1, title: "The attached vendors", question: "Which vendors are attached and active?", subject: "none", window: false, shelves: ["providers", "restaurant_providers"], meaning: "Owned vendors plus active authorized links; explicit revocation wins, and unlinked shared providers stay private.", shows: ["providers.*", "providers.name"] },
  { id: "documents.waiting", version: 1, title: "Documents awaiting review", question: "Which documents are waiting for review?", subject: "none", window: false, shelves: ["procurement_documents"], meaning: "Received, extracting and needs-review remain different states; documents are not all invoices.", shows: ["procurement_documents.*", "procurement_documents.doc_number", "procurement_documents.doc_type", "procurement_documents.status", "procurement_documents.doc_date"] },
  // Goals: a money measure (founder, round 5, 2026-09-21) -- same category
  // as price, vendor, open-order and sales above, so the same gate.
  { id: "goals.targets", version: 1, title: "The posted targets", question: "What goals and targets are posted?", subject: "none", window: false, shelves: ["analytics_goals"], meaning: "Active targets and deadlines, not progress inferred from a default zero.", shows: ["analytics_goals.*", "analytics_goals.name", "analytics_goals.metric_key", "analytics_goals.target_value", "analytics_goals.direction", "analytics_goals.deadline"] },
  // Today's deliveries (founder, round 6: staff "can ask about ... today's
  // deliveries"): the open orders whose stated date is today, by number, state
  // and date. Its cells come only from the order book's `due_today` row view,
  // so it shows no order count beyond today's, no price and no value; its
  // source trace still reads the whole book, and that count is withheld from
  // any role that does not see suppliers (`withholdTraceCounts`).
  { id: "orders.due_today", version: 1, title: "Today's deliveries", question: "Which open deliveries are expected today?", subject: "none", window: false, shelves: ["procurement_orders"], meaning: "Open orders whose stated delivery date is today (UTC), with their recorded state; a planned date is not a supplier promise.", shows: ["procurement_orders@due_today.*", "procurement_orders@due_today.order_number", "procurement_orders@due_today.status", "procurement_orders@due_today.expected_delivery_date"] },
];

/** Every field a Reading can show: what it declares plus the label its subject matches are listed by. */
export function shownFields(reading: Pick<ReadingDescriptor, "shows" | "subject">): string[] {
  const subject = reading.subject === "none" ? [] : SUBJECT_LABEL_FIELDS[reading.subject];
  return [...new Set([...reading.shows, ...subject])];
}

/**
 * The catalogue, with each Reading's classes and roles DERIVED from the fields
 * it shows. An untagged field throws here, at module load: the gateway does
 * not boot with a Reading whose sensitivity nobody has stated.
 */
export const READING_CATALOGUE: readonly ReadingDescriptor[] = DECLARED.map(reading => {
  const classes = classesOfFields(shownFields(reading));
  return { ...reading, classes, allowedRoles: rolesSeeing(classes) as readonly Role[] };
});

/**
 * Server-side, per-reading enforcement: does THIS role receive THIS reading's
 * answer. Read from ROLE_POLICY, a table of data (founder, 2026-09-21, "Rules
 * in code, label rows"): the role's row must see every class the Reading
 * shows and must be given `reading` answers. `admin` reads the owner row
 * (RolesGuard's admin rule); an absent or unrecognised role reads the
 * least-privileged row, so it fails closed on every restricted Reading.
 *
 * Deliberately NOT keyed on the model's own class label -- readings are
 * looked up by `ReadingId`, the same catalogue key `BoundAskService` already
 * resolves a question to before this runs, so a caller cannot spoof a class
 * name into a role it does not have.
 */
export function isReadingAllowedForRole(id: ReadingId, role: string | null | undefined, table: RolePolicyTable = ROLE_POLICY): boolean {
  const descriptor = READING_CATALOGUE.find(r => r.id === id);
  if (!descriptor) return false; // not a real reading: fail closed
  const policy = policyFor(role, table);
  return policy.answers.includes("reading") && hiddenClasses(descriptor.classes, policy).length === 0;
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
  "orders.due_today": { kind: "reading", id: "orders.due_today" },
  forecast: { kind: "not_built" }, landed_cost: { kind: "not_built" },
  sales_revenue: { kind: "not_built" }, lot_expiry: { kind: "not_built" },
  general_knowledge: { kind: "model_knowledge" }, unrecognized: { kind: "no_reading_matched" },
};
export function isReadingId(value: unknown): value is ReadingId {
  return typeof value === "string" && READING_CATALOGUE.some(r => r.id === value);
}
