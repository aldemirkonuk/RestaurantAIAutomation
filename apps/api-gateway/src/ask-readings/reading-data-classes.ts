import { createHash } from "crypto";
import { Role } from "../auth/guards/roles.guard";
import { findingFingerprint } from "./finding-fingerprint";
import { WITHHELD_FOR_YOUR_ROLE } from "./reading.types";
import type { Finding, QuestionClass, SourceTrace, WithheldSourceTrace } from "./reading.types";

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
 *                 row count (a count of pos_checks is a sales figure), shown
 *                 in a cell or in a Finding's source trace alike.
 *                 `relation@view.column` is a named ROW VIEW of a relation
 *                 whose rows carry a different class than the whole relation
 *                 (`recording-session.ts` `view`).
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
/**
 * [2026-09-21, founder round 6: `receiving` and `todays_deliveries` added. His
 * approved meaning, verbatim: "Staff can ask about stock, receiving and
 * today's deliveries. Money, supplier prices and people data are refused with
 * a one-line reason." `receiving` is what the door receives against (an
 * order's number and contents, the document register, a receipt's printed
 * quantities); `todays_deliveries` is the `due_today` row view of the order
 * book -- today's open orders, their state and date, never the book's size.]
 */
export const DATA_CLASSES = ["money", "sales", "suppliers", "people", "stock", "receiving", "todays_deliveries"] as const;
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
 * [ANSWERED 2026-09-21, founder round 6 ("Yes, own-work only"): an order's
 * number and contents and the document register are `receiving` -- the
 * lane's reading of his word "receiving", not his words; calendar
 * entries stay `people`, which staff no longer see. Stock movements stay
 * `stock` -- whether they are sales is still open (ADR 0145, round 6).]
 * [ANSWERED 2026-09-21, founder round 6r, his pick verbatim: "Stays stock
 * (Recommended)" -- movements are stock, open to staff; only money-valued
 * sales are sales data. Pinned by CLAIMS row ADR-0145-ASK-MOVEMENTS-STAY-STOCK.]
 *
 * Every relation a Reading reads (its `shelves`) carries a `relation.*` tag,
 * because the source trace reports every read's row count: an untagged count
 * would be withheld from every role, and the CI guard fails on one.
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
  "restaurants.*": "stock",
  "inventory_lots.*": "stock",
  "inventory_lots.location_id": "stock",
  "inventory_lots.stock_state": "stock",
  "inventory_lots.qty": "stock",
  "storage_locations.*": "stock",
  "storage_locations.name": "stock",
  "inventory_transactions.*": "stock",
  "inventory_transactions.stock_type": "stock",
  "inventory_transactions.quantity_change": "stock",
  "procurement_orders.*": "suppliers",
  "procurement_orders.order_number": "receiving",
  "procurement_orders.status": "suppliers",
  "procurement_orders.expected_delivery_date": "suppliers",
  "procurement_orders.quantity": "receiving",
  "procurement_orders.unit_type": "receiving",
  "procurement_orders@due_today.*": "todays_deliveries",
  "procurement_orders@due_today.order_number": "todays_deliveries",
  "procurement_orders@due_today.status": "todays_deliveries",
  "procurement_orders@due_today.expected_delivery_date": "todays_deliveries",
  "procurement_order_items.*": "receiving",
  "procurement_order_items.wine_name": "receiving",
  "procurement_order_items.quantity": "receiving",
  "procurement_order_items.unit_type": "receiving",
  "procurement_order_items.bottles_per_unit": "receiving",
  "procurement_documents.*": "receiving",
  "procurement_documents.doc_number": "receiving",
  "procurement_documents.doc_type": "receiving",
  "procurement_documents.status": "receiving",
  "procurement_documents.doc_date": "receiving",
  "procurement_documents.verified_at": "receiving",
  "procurement_documents.currency": "money",
  "procurement_document_lines.*": "receiving",
  "procurement_document_lines.qty": "receiving",
  "procurement_document_lines.uom": "receiving",
  "procurement_document_lines.pack_size": "receiving",
  "procurement_document_lines.unit_price": "money",
  "procurement_document_lines.price_base_qty": "money",
  "procurement_document_lines.price_base_uom": "money",
  "procurement_document_links.*": "receiving",
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
  "calendar_recurrence_rules.*": "people",
  "calendar_recurrence_exceptions.*": "people",
  "providers.*": "suppliers",
  "providers.name": "suppliers",
  "restaurant_providers.*": "suppliers",
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
 *
 * [ANSWERED 2026-09-21, founder round 6 -- his pick, verbatim, "Yes, own-work
 * only", with this meaning he approved: "Staff can ask about stock, receiving
 * and today's deliveries. Money, supplier prices and people data are refused
 * with a one-line reason. General-knowledge answers are allowed but count
 * toward the house's daily limit." So the staff row sees exactly stock,
 * receiving and today's deliveries (people left it); staff keep
 * model_knowledge, and every model call already counts against the house's
 * daily allowance (ADR 0146's first-attempt gate); the share stays 1 -- no
 * per-role cap, the orchestrating session's gloss of his answer.]
 */
export const ROLE_POLICY: RolePolicyTable = {
  owner: { sees: ["money", "sales", "suppliers", "people", "stock", "receiving", "todays_deliveries"], answers: ["reading", "model_knowledge"], dailyAskBudgetShare: 1 },
  manager: { sees: ["money", "sales", "suppliers", "people", "stock", "receiving", "todays_deliveries"], answers: ["reading", "model_knowledge"], dailyAskBudgetShare: 1 },
  staff: { sees: ["stock", "receiving", "todays_deliveries"], answers: ["reading", "model_knowledge"], dailyAskBudgetShare: 1 },
};

/**
 * What each class is called in a refusal's one line (founder, round 6:
 * refused "with a one-line reason"). The line itself is built in
 * `bound-reply.ts` from these names and the classes the role does not see.
 */
export const CLASS_LABEL: Readonly<Record<DataClass, string>> = {
  money: "money (prices, supplier prices, costs, values, margins)",
  sales: "sales figures",
  suppliers: "the house's supplier orders and vendors",
  people: "people data (the calendar, and anything about a person)",
  stock: "stock",
  receiving: "receiving",
  todays_deliveries: "today's deliveries",
};

/**
 * The data class of each question class the pick can name that has no Reading
 * yet (founder, 2026-09-21, round 6r, his pick verbatim: "Classify now,
 * forecast=sales (Recommended)"). A role that does not see the class is
 * refused with the class's one-line reason, as for a built Reading; a role
 * that does see it is still told "not built" until that Reading ships. The
 * pick has already been paid for; nothing is read and no other model call is
 * made for either answer. `lot_expiry` is not listed: he classified the three
 * money and sales questions only, so it answers "not built" to every role.
 */
export const UNBUILT_QUESTION_CLASS = {
  landed_cost: "money",
  sales_revenue: "sales",
  forecast: "sales",
} as const satisfies Partial<Record<QuestionClass, DataClass>>;
export type ClassifiedUnbuiltQuestion = keyof typeof UNBUILT_QUESTION_CLASS;

/** The data class of an unbuilt question class, or null when it has none. */
export function unbuiltClassOf(questionClass: unknown): DataClass | null {
  return typeof questionClass === "string" && Object.prototype.hasOwnProperty.call(UNBUILT_QUESTION_CLASS, questionClass)
    ? UNBUILT_QUESTION_CLASS[questionClass as ClassifiedUnbuiltQuestion]
    : null;
}

/**
 * How much of a failed read a role is told (founder, 2026-09-21, round 6r, his
 * pick verbatim: "J4 wins, hide size (Recommended)"). `full`: the reason the
 * runner gave (`source_limit`, `query_failed`, ...), with the trace. And
 * `source_only`: which source could not be read, right now -- no reason and no
 * size, because `source_limit` alone says a relation holds more than 20,000
 * rows (`RecordingSession.read`). One line per role, like ROLE_POLICY; any
 * other or absent role reads the fallback row's (`staff`) value.
 */
export type FailureDetail = "full" | "source_only";
export const FAILURE_DETAIL: Readonly<Record<Role, FailureDetail>> = {
  owner: "full",
  manager: "full",
  staff: "source_only",
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

/** How much of a failed read this role is told. Fails closed: an unknown role reads the fallback row's. */
export function failureDetailFor(role: string | null | undefined, table: RolePolicyTable = ROLE_POLICY): FailureDetail {
  return FAILURE_DETAIL[policyRoleFor(role, table)] ?? FAILURE_DETAIL[ROLE_POLICY_FALLBACK];
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

/** The relation a trace entry or evidence names, without its row view (`relation@view` -> `relation`). */
export function baseRelation(relation: string): string {
  const at = relation.indexOf("@");
  return at < 0 ? relation : relation.slice(0, at);
}

/** The class of a relation's row count: its `relation.*` tag, or null when it has none. */
export function countClassOf(relation: string): DataClass | null {
  return FIELD_CLASS[`${relation}.*`] ?? null;
}

/**
 * A Finding as this policy row may see it (founder, 2026-09-21, round 6, his
 * pick verbatim: "Hide by data type"). The CELLS were already gated by the
 * Reading's classes; the source TRACE reports every read's row count, and a
 * Reading open to a role can still read a relation that role does not see --
 * `orders.lines` finds its order in the whole order book, so its trace
 * carried the house's order count, a suppliers figure, to staff. A count is
 * kept only when the row sees its relation's class; otherwise the read stays
 * listed (which relation, when) and its count, its rows/empty outcome and the
 * Finding's total are `withheld_for_your_role`. A failed read carries no count
 * and stays as it is. An untagged relation is withheld from every role.
 *
 * [2026-09-21, round 6 last call] A withheld relation leaves ONE entry, however
 * many times it was read: `RecordingSession.read` pages 500 rows at a time and
 * writes a trace entry per page, so the number of entries would itself say how
 * many hundreds of rows the relation has.
 */
export function withholdTraceCounts(finding: Finding, policy: RolePolicy): Finding {
  let withheld = false;
  const listed = new Set<string>();
  const trace = finding.trace.map((entry): SourceTrace | WithheldSourceTrace => {
    if (entry.outcome === "failed" || entry.outcome === "withheld") return entry;
    const cls = countClassOf(entry.relation);
    if (cls && policy.sees.includes(cls)) return entry;
    withheld = true;
    return { relation: entry.relation, operation: entry.operation, outcome: "withheld",
      rowsScanned: WITHHELD_FOR_YOUR_ROLE, matchedRows: WITHHELD_FOR_YOUR_ROLE, asOf: entry.asOf };
  }).filter(entry => {
    if (entry.outcome !== "withheld") return true;
    const read = `${entry.operation}:${entry.relation}`;
    if (listed.has(read)) return false; // one withheld entry per relation read
    listed.add(read);
    return true;
  });
  if (!withheld) return finding;
  return { ...finding, trace, rowsScanned: finding.rowsScanned === null ? null : WITHHELD_FOR_YOUR_ROLE };
}

/**
 * A Finding that could not be read, as a `source_only` role may see it
 * (founder, 2026-09-21, round 6r, "J4 wins, hide size (Recommended)"). Every
 * part that separates one failure from another is withheld, because each one
 * would say which it was and `source_limit` is a size:
 *   - the reason                  -> `withheld_for_your_role`;
 *   - each trace entry            -> relation, operation and time only; its
 *                                    outcome (`rows` before a limit, `failed`
 *                                    for a query error), counts and failure
 *                                    code go, one entry per relation read;
 *   - `failedSources` and the total -> withheld;
 *   - the fingerprint             -> recomputed from what is left, since it
 *                                    hashes the reason (`finding-fingerprint.ts`).
 * Which sources were queried, and when, stays.
 *
 * An empty register ("not in your books") stays what it is -- J4 wins -- but
 * loses its cells: the only cells built over an empty register are its zero
 * counts, and his pick is that staff are told "no orders recorded yet", never a
 * zero. Its trace was already shaped by `withholdTraceCounts`. Every other
 * outcome is returned unchanged: a read, a clarification or a refusal is not a
 * failure. `full` returns every Finding unchanged.
 */
export function withholdFailureDetail(finding: Finding, detail: FailureDetail): Finding {
  if (detail === "full") return finding;
  if (finding.outcome === "not_in_your_books") {
    if (!finding.rows.length) return finding;
    return { ...finding, rows: [], fingerprint: findingFingerprint({ id: finding.readingId, version: finding.readingVersion,
      args: finding.args, outcome: finding.outcome, reason: finding.reason, rows: [] }) };
  }
  if (finding.outcome !== "could_not_read") return finding;
  const listed = new Set<string>();
  const trace: WithheldSourceTrace[] = [];
  for (const entry of finding.trace) {
    const read = `${entry.operation}:${entry.relation}`;
    if (listed.has(read)) continue;
    listed.add(read);
    trace.push({ relation: entry.relation, operation: entry.operation, outcome: "withheld",
      rowsScanned: WITHHELD_FOR_YOUR_ROLE, matchedRows: WITHHELD_FOR_YOUR_ROLE, asOf: entry.asOf });
  }
  const reason = WITHHELD_FOR_YOUR_ROLE;
  const { choices: _choices, ...rest } = finding;
  return {
    ...rest,
    reason,
    trace,
    failedSources: WITHHELD_FOR_YOUR_ROLE,
    rowsScanned: WITHHELD_FOR_YOUR_ROLE,
    rows: [],
    fingerprint: findingFingerprint({ id: finding.readingId, version: finding.readingVersion, args: finding.args,
      outcome: finding.outcome, reason, rows: [] }),
  };
}

const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/**
 * A hash of the rules in force for one ask, computed from their content every
 * time rather than a version string someone must remember to bump (the
 * CLAUDE.md section 5b lesson: a hand-bumped version goes stale the day a row
 * changes without it).
 */
export function policySha(table: RolePolicyTable = ROLE_POLICY): string {
  return sha256({ FIELD_CLASS, ROLE_POLICY: table, ROLE_POLICY_ALIASES, ROLE_POLICY_FALLBACK, FAILURE_DETAIL, UNBUILT_QUESTION_CLASS });
}
