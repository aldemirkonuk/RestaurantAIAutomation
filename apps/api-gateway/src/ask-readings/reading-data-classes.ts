import { createHash } from "crypto";
import { Role } from "../auth/guards/roles.guard";

/**
 * What a person may see on /ask is a RULE, not a model behaviour (founder,
 * 2026-09-21, the option "Rules in code, label rows"; ADR 0145's amendment of
 * that date). Sensitivity belongs to a FIELD, so every field a Reading can put
 * in a cell carries one data class, and a Reading's roles are DERIVED from the
 * classes of the fields it shows -- never hand-set per Reading, which is how
 * `orders.late_deliveries` stayed a bypass of `orders.open` until 2026-09-21.
 *
 * Three things live here and nowhere else:
 *   FIELD_CLASS   `relation.column` -> class; `relation.*` is that relation's
 *                 row count (a count of pos_checks is a sales figure).
 *   ROLE_POLICY   ONE table, data not branches: per role, the classes it sees,
 *                 the answer kinds it gets, and its share of the house's daily
 *                 ask allowance (ADR 0146).
 *   the aliases   `admin` reads the owner row (RolesGuard's own admin rule);
 *                 any other or absent role reads the FALLBACK row.
 *
 * `scripts/check_ask_field_classes.py` fails CI on a shown field with no tag,
 * a field the runner shows that its Reading does not declare, a tag nothing
 * shows, and a restricted set that differs from CLAIMS.jsonl. Keep each
 * FIELD_CLASS entry and each ROLE_POLICY row on ONE line: the guard reads them.
 */
export const DATA_CLASSES = ["money", "sales", "suppliers", "people", "stock"] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

/** The answers a role can be given. Refusals, clarifications and "not built" are not answers. */
export const ANSWER_KINDS = ["reading", "model_knowledge"] as const;
export type AnswerKind = (typeof ANSWER_KINDS)[number];

/**
 * The class of every field a Reading shows. Where one column could be two
 * classes, the tag is the stricter one (an `analytics_goals.target_value` is
 * money whenever its metric is a currency, so every goal field is money).
 *
 * The tags that reproduce the founder's 2026-09-19 split without changing
 * which Reading anyone reaches are recorded as open founder questions in ADR
 * 0145's 2026-09-21 amendment: an order's number and contents and the
 * document register are `stock` (the door receives against them); calendar
 * entries are `people`; stock movements are `stock` although they net sales
 * depletion in (the judge's section 1.3).
 */
export const FIELD_CLASS: Readonly<Record<string, DataClass>> = {
  "restaurant_inventory.*": "stock",
  "restaurant_inventory.display_name": "stock",
  "restaurant_inventory.wine_name": "stock",
  "restaurant_inventory.uom": "stock",
  "restaurant_inventory.stock_live": "stock",
  "restaurant_inventory.shadow_stock": "stock",
  "restaurant_inventory.in_transit_quantity": "stock",
  "restaurant_inventory.threshold_min": "stock",
  "inventory_lots.*": "stock",
  "inventory_lots.location_id": "stock",
  "inventory_lots.stock_state": "stock",
  "inventory_lots.qty": "stock",
  "storage_locations.name": "stock",
  "inventory_transactions.*": "stock",
  "inventory_transactions.stock_type": "stock",
  "inventory_transactions.quantity_change": "stock",
  "procurement_orders.*": "suppliers",
  "procurement_orders.order_number": "stock",
  "procurement_orders.status": "suppliers",
  "procurement_orders.expected_delivery_date": "suppliers",
  "procurement_orders.quantity": "stock",
  "procurement_orders.unit_type": "stock",
  "procurement_order_items.*": "stock",
  "procurement_order_items.wine_name": "stock",
  "procurement_order_items.quantity": "stock",
  "procurement_order_items.unit_type": "stock",
  "procurement_order_items.bottles_per_unit": "stock",
  "procurement_documents.*": "stock",
  "procurement_documents.doc_number": "stock",
  "procurement_documents.doc_type": "stock",
  "procurement_documents.status": "stock",
  "procurement_documents.doc_date": "stock",
  "procurement_documents.verified_at": "stock",
  "procurement_documents.currency": "money",
  "procurement_document_lines.qty": "stock",
  "procurement_document_lines.uom": "stock",
  "procurement_document_lines.pack_size": "stock",
  "procurement_document_lines.unit_price": "money",
  "procurement_document_lines.price_base_qty": "money",
  "procurement_document_lines.price_base_uom": "money",
  "pos_checks.*": "sales",
  "pos_checks.covers": "sales",
  "wine_consumption_log.*": "sales",
  "wine_consumption_log.volume_ml": "sales",
  "wine_consumption_log.quantity": "sales",
  "wine_consumption_log.consumption_type": "sales",
  "calendar_events.*": "people",
  "calendar_events.title": "people",
  "calendar_events.start_date": "people",
  "calendar_events.start_time": "people",
  "calendar_events.status": "people",
  "providers.*": "suppliers",
  "providers.name": "suppliers",
  "analytics_goals.*": "money",
  "analytics_goals.name": "money",
  "analytics_goals.metric_key": "money",
  "analytics_goals.target_value": "money",
  "analytics_goals.direction": "money",
  "analytics_goals.deadline": "money",
};

export interface RolePolicy {
  /** The data classes this role may be shown. */
  sees: readonly DataClass[];
  /** The answer kinds this role may be given. */
  answers: readonly AnswerKind[];
  /**
   * The largest share of the house's DAILY allowance (ADR 0146) that asks made
   * under this row may spend, 0 to 1. At 1 the house gate alone bounds it and
   * no extra ledger read happens; below 1 the share is read per ask and an
   * unreadable ledger REFUSES (never "nothing spent").
   */
  dailyAskBudgetShare: number;
}
export type RolePolicyTable = Readonly<Record<Role, RolePolicy>>;

/**
 * Today's values reproduce what was built before this table existed, exactly:
 * owner and manager see everything; staff see the classes of the eight
 * Readings the founder left open on 2026-09-19 (with goals.targets closed on
 * 2026-09-21); every role may receive model knowledge; nobody has a share
 * below the whole house allowance. Changing any value is a founder decision
 * (ADR 0145, 2026-09-21 amendment, "Founder questions").
 */
export const ROLE_POLICY: RolePolicyTable = {
  owner: { sees: ["money", "sales", "suppliers", "people", "stock"], answers: ["reading", "model_knowledge"], dailyAskBudgetShare: 1 },
  manager: { sees: ["money", "sales", "suppliers", "people", "stock"], answers: ["reading", "model_knowledge"], dailyAskBudgetShare: 1 },
  staff: { sees: ["people", "stock"], answers: ["reading", "model_knowledge"], dailyAskBudgetShare: 1 },
};

/** `admin` passes every owner/manager gate in RolesGuard, so it reads the owner row. */
export const ROLE_POLICY_ALIASES: Readonly<Record<string, Role>> = { admin: "owner" };
/** Any other, absent or unrecognised role reads the least-privileged row. */
export const ROLE_POLICY_FALLBACK: Role = "staff";

/** The ROLE_POLICY row a token's role reads. Case-insensitive, like RolesGuard. */
export function policyRoleFor(role: string | null | undefined, table: RolePolicyTable = ROLE_POLICY): Role {
  const normalized = role ? String(role).trim().toLowerCase() : "";
  if (Object.prototype.hasOwnProperty.call(table, normalized)) return normalized as Role;
  const alias = ROLE_POLICY_ALIASES[normalized];
  return alias || ROLE_POLICY_FALLBACK;
}

export function policyFor(role: string | null | undefined, table: RolePolicyTable = ROLE_POLICY): RolePolicy {
  return table[policyRoleFor(role, table)];
}

/** The classes a set of shown fields carries. An untagged field is a thrown error, never "no class". */
export function classesOfFields(fields: readonly string[]): DataClass[] {
  const found = new Set<DataClass>();
  for (const field of fields) {
    const cls = FIELD_CLASS[field];
    if (!cls) throw new Error(`untagged_shown_field:${field}`);
    found.add(cls);
  }
  return DATA_CLASSES.filter(c => found.has(c));
}

/** The classes in `classes` this policy row does not see. Empty means every one is visible. */
export function hiddenClasses(classes: readonly DataClass[], policy: RolePolicy): DataClass[] {
  return classes.filter(c => !policy.sees.includes(c));
}

/** The roles (by table row) that see every class in `classes` and may be given a Reading. */
export function rolesSeeing(classes: readonly DataClass[], table: RolePolicyTable = ROLE_POLICY): Role[] {
  return (Object.keys(table) as Role[]).filter(
    role => table[role].answers.includes("reading") && hiddenClasses(classes, table[role]).length === 0,
  );
}

const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/**
 * A hash of the rules in force for one ask, computed from their content every
 * time rather than a version string someone must remember to bump (the
 * CLAUDE.md section 5b lesson: a hand-bumped version goes stale the day a row
 * changes without it).
 */
export function policySha(table: RolePolicyTable = ROLE_POLICY): string {
  return sha256({ FIELD_CLASS, ROLE_POLICY: table, ROLE_POLICY_ALIASES, ROLE_POLICY_FALLBACK });
}
