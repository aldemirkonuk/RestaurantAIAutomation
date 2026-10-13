import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { STAFF_WITHHELD_ACTIONS } from "../settings-audit/settings-audit.service";
import { holdsHouseMoney } from "../procurement/documents/document-money-gate";

/**
 * Correlated logs timeline (SimPOS testbed plan, cross-cutting).
 *
 * Read-only view over pos_checks, decision_log, inventory_transactions,
 * pour_events, procurement_documents, system_audit_log, and event_store, joined on
 * correlation_id. inventory_transactions stores the id inside
 * metadata->>'correlation_id' rather than as a column — see
 * 20260805132000_counting_catalog_and_correlation_columns.sql.
 *
 * Without a correlation_id filter the timeline returns the most recent
 * events across all six sources for a restaurant, tagged by source so the
 * UI can render one chronological feed.
 *
 * THE RESPONSE CONFESSES (ADR 0086)
 *
 * Each source is fetched independently and a failing one must not take the
 * other five down, so every fetch is caught. Catching it to `[]` and
 * returning 200 was the wrong half of that: a source that 500s contributed
 * zero events, the request succeeded, and the caller — a page whose entire
 * subject is counts — rendered a SMALLER NUMBER with no error state at all.
 * A missing register was indistinguishable from a quiet one.
 *
 * So the response carries three things, not one: the events, the sources
 * that were actually queried, and the sources that failed. A caller that
 * wants a count can now tell an empty register from an unreachable one, and
 * `sourcesQueried` states the deliberate omission (event_store without a
 * correlation_id) rather than leaving it to be inferred from a short list.
 */

export type TimelineSource =
  | "pos_checks"
  | "decision_log"
  | "inventory_transactions"
  | "pour_events"
  | "procurement_documents"
  | "system_audit_log"
  | "event_store";

export interface TimelineEvent {
  id: string;
  source: TimelineSource;
  /**
   * NULL when the row's timestamp column is null — which both
   * `procurement_documents.created_at` and `system_audit_log.created_at`
   * permit (baseline_from_production.sql). The event is still returned; it
   * simply does not claim a time it does not have.
   */
  occurredAt: string | null;
  correlationId: string | null;
  summary: string;
  detail: Record<string, unknown>;
}

/** One source's outcome: what it returned, or why it returned nothing. */
interface SourceResult {
  source: TimelineSource;
  events: TimelineEvent[];
  error: string | null;
}

export interface TimelineResponse {
  events: TimelineEvent[];
  correlationId: string | null;
  /** Every source this call actually read. A skip is stated, never implied. */
  sourcesQueried: TimelineSource[];
  /** Sources that errored. Non-empty means the counts below are a FLOOR. */
  failedSources: TimelineSource[];
  /** The clamp applied (`events` fills it); whether a row exists beyond this
   *  page (EXACT — each source is read to `window + 1` — except event_store:
   *  its window is applied on correlation_id alone, before the house proof
   *  in filterEventsOwnedByHouse runs, so a foreign or unprovable row can
   *  fill that source's window and a dated row further back that DOES
   *  belong to this house is never fetched. event_store's contribution to
   *  hasMore is therefore a FLOOR, not exact, whenever it withholds
   *  anything); and the `before` cursor for the next page (null: no next
   *  page, or no dated event to advance from). See "The window, and walking
   *  it" at the foot of the file. */
  window: number;
  hasMore: boolean;
  nextCursor: string | null;
  /** Present when the caller does not hold the house's money (F-958): the
   *  documents' totals and the prices an agent moved were left out. */
  amountsWithheld?: true;
}

/**
 * What a decision's output carries to a role that does not hold the house's
 * money (F-958). AN ALLOWLIST, NOT A STRIP LIST: `decision_log.output` is
 * whatever each agent wrote (the Python agents write their own shapes, with
 * prices, spend and takings among them), so a non-holder gets only the keys
 * named here, which are flags and reason codes, and a key an agent adds later
 * stays on the server for staff until someone decides it is not money. The
 * model's own `recommended_action` is prose that can quote a price, so it is
 * left out too.
 */
const OUTPUT_KEYS_FOR_EVERY_ROLE = [
  "needs_approval",
  "reasons",
  "email_class",
  "is_automated",
  "requires_reply",
  "injection_suspected",
  "paused",
  "autoReply",
  "autonomyFull",
  "orderSyncHeld",
] as const;

/** A decision's `order_change` (inbound-responder `OrderMove`) without its prices (F-492). */
const ORDER_CHANGE_KEYS_FOR_EVERY_ROLE = [
  "order_id",
  "status_from",
  "status_to",
  "written",
] as const;

function pick(
  from: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const key of keys) if (key in from) kept[key] = from[key];
  return kept;
}

/** A decision's output as a non-holder may read it (F-958). */
function outputWithoutPrices(output: unknown): unknown {
  if (!output || typeof output !== "object" || Array.isArray(output))
    return null;
  const all = output as Record<string, unknown>;
  const kept = pick(all, OUTPUT_KEYS_FOR_EVERY_ROLE);
  const move = all.order_change;
  if (move && typeof move === "object" && !Array.isArray(move))
    kept.order_change = pick(
      move as Record<string, unknown>,
      ORDER_CHANGE_KEYS_FOR_EVERY_ROLE,
    );
  return kept;
}

/**
 * Newest first, with undated rows LAST.
 *
 * This comparator used to be `b.occurredAt.localeCompare(a.occurredAt)`
 * inline, and it ran outside every per-source try/catch — so one nullable
 * `created_at` threw a TypeError past all six guards and 500ed the whole
 * feed. An undated row is not dropped (that would be deciding it did not
 * happen) and not floated to the top (that would be claiming it is the most
 * recent thing that did).
 */
function newestFirst(a: TimelineEvent, b: TimelineEvent): number {
  if (!a.occurredAt && !b.occurredAt) return 0;
  if (!a.occurredAt) return 1;
  if (!b.occurredAt) return -1;
  return b.occurredAt.localeCompare(a.occurredAt);
}

/**
 * ADR 0218 round 4 (founder round 6z, 2026-09-22), "Hide Away events from
 * staff (Recommended)": a colleague's Away being set or ended stays out of
 * a staff reader's /logs feed; owners and managers still read it, and /logs
 * stays open to staff for every other action. This is a NARROWER list than
 * settings-audit's `STAFF_WITHHELD_ACTIONS` on purpose — /logs is a raw feed
 * of every `system_audit_log` action for every member (unlike the closed
 * `READ_BACK_ACTIONS` set that trail reads back), so only the two Away
 * actions are named here; a house rename or a lead grant is unaffected.
 */
export const LOGS_AWAY_ACTIONS_WITHHELD_FROM_STAFF = [
  "away_set_for_member",
  "away_ended_for_member",
  // F-1547 (decision manager-leave, 2026-10-12): a manager's time off decided
  // or re-marked by someone else. New rows, not a widening of the round-4
  // list: they carry a colleague's leave dates and paid/unpaid, which staff
  // never read (ADR 0088, `listTimeOff` scopes staff to their own).
  "time_off_decided_for_manager",
  "time_off_remarked_for_manager",
] as const;

/**
 * The role is the token house's role (ADR 0162). `LogsController` reads it
 * off `MembersService.assertMembership`'s own membership row — the same call
 * it already makes to gate the route — rather than trusting a JWT claim that
 * can go stale across houses (`auth/house-role.ts`). Anything but `owner` or
 * `manager` — staff, an unset role, a role the caller never passed — withholds
 * the two Away actions: the same fail-closed default `settings-audit.service.ts`
 * `readBackActionsFor` uses ("Omitted, it reads as staff").
 */
function withholdsAwayActions(role: unknown): boolean {
  const r = typeof role === "string" ? role.toLowerCase() : "";
  return r !== "owner" && r !== "manager";
}

/**
 * F-482 (2026-10-09): /logs now names who did each thing. The ruling above
 * stands — a staff reader still receives every row but the two Away actions —
 * but the rows settings-audit withholds from staff because each one names a
 * colleague (`STAFF_WITHHELD_ACTIONS`: area membership, area lead, zone set-up
 * access) reach a staff reader UNNAMED: the act and its from → to, never who
 * did it or whom it was about. Before F-482 no /logs row named anybody, so
 * this keeps those rows exactly as anonymous for staff as they were; widening
 * the withholding instead would reverse the round-4 ruling, which is the
 * founder's call. The Away pair is left out of this list because the query
 * already withholds those rows from staff entirely.
 */
export const LOGS_UNNAMED_FOR_STAFF: readonly string[] =
  STAFF_WITHHELD_ACTIONS.filter(
    (a) =>
      !(LOGS_AWAY_ACTIONS_WITHHELD_FROM_STAFF as readonly string[]).includes(a),
  );

/** What a reader is shown for a person this house cannot name. */
const NOT_OF_THIS_HOUSE = "Someone not on this house's team";
/** What a reader is shown when the names could not be read at all. */
const NAME_NOT_READ = "Someone (their name could not be read)";

/** The name for one id, or why there is none. `names` null: the lookup failed. */
export function nameFor(names: Map<string, string> | null, id: string): string {
  if (names === null) return NAME_NOT_READ;
  return names.get(id) ?? NOT_OF_THIS_HOUSE;
}

/** A value inside "from → to", in words. */
function valueWords(v: unknown): string {
  if (v === null || v === undefined || v === "") return "none";
  if (v === true) return "yes";
  if (v === false) return "no";
  if (typeof v === "string" || typeof v === "number") return String(v);
  return JSON.stringify(v);
}

/**
 * The `{ from, to }` pairs inside an audit row's `changes`. Both shapes
 * writers use are read, the same two `settings-audit.service.ts` `readFields`
 * reads: nested under `fields`, or at the top level (`recordAccessChange`).
 * Anything that is not a `{ from, to }` pair (`subject`, `register`, a
 * removal's shift tally) is not a field change and is not printed as one.
 */
function fieldChanges(
  changes: unknown,
): Array<{ field: string; from: unknown; to: unknown }> {
  if (!changes || typeof changes !== "object" || Array.isArray(changes))
    return [];
  const c = changes as Record<string, unknown>;
  const nested = c.fields;
  const source =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : c;
  const out: Array<{ field: string; from: unknown; to: unknown }> = [];
  for (const [key, value] of Object.entries(source)) {
    if (key === "register" || key === "subject" || key === "fields") continue;
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "to" in value
    ) {
      const v = value as { from?: unknown; to?: unknown };
      out.push({ field: key, from: v.from ?? null, to: v.to ?? null });
    }
  }
  return out;
}

/** "role: staff → manager; lead: no → yes" */
function changeWords(
  fields: Array<{ field: string; from: unknown; to: unknown }>,
): string {
  return fields
    .map(
      (f) =>
        `${f.field.replace(/_/g, " ")}: ${valueWords(f.from)} → ${valueWords(f.to)}`,
    )
    .join("; ");
}

@Injectable()
export class LogsTimelineService {
  private readonly logger = new Logger(LogsTimelineService.name);

  constructor(private readonly dbService: DatabaseService) {}

  async getTimeline(
    restaurantId: string,
    opts: {
      correlationId?: string;
      limit?: number;
      before?: string;
      /** The caller's role in this house (ADR 0162). See
       *  `withholdsAwayActions` — omitted reads as staff. */
      role?: unknown;
    } = {},
  ): Promise<TimelineResponse> {
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
    const correlationId = opts.correlationId?.trim() || null;
    const before = parseCursor(opts.before);
    const db = this.dbService.getClient();

    // One past the window, per source. That single extra row is what makes
    // `hasMore` a measurement instead of an inference from a full page.
    const fetch = limit + 1;
    const cursor: Cursor = { before, fetch };

    // F-958: the house's money stays with those who hold it, as the document
    // list already does (documents.controller.ts). Omitted role reads as staff.
    const withholdMoney = !holdsHouseMoney(
      typeof opts.role === "string" ? opts.role : null,
    );
    const results = await Promise.all([
      this.fetchPosChecks(db, restaurantId, correlationId, cursor),
      this.fetchDecisions(
        db,
        restaurantId,
        correlationId,
        cursor,
        withholdMoney,
      ),
      this.fetchInventoryTxns(db, restaurantId, correlationId, cursor),
      // F-1597: a glass poured by hand reaches the ledger only when it opens
      // a bottle, so the pours themselves are read from pour_events. A pour
      // carries no correlation_id, so it is not read along a thread (and the
      // skip is reported, as event_store's is).
      correlationId
        ? Promise.resolve(null)
        : this.fetchHandPours(db, restaurantId, cursor),
      this.fetchDocuments(
        db,
        restaurantId,
        correlationId,
        cursor,
        withholdMoney,
      ),
      this.fetchAuditLog(db, restaurantId, correlationId, cursor, opts.role),
      // event_store is not restaurant-scoped (the table itself carries no
      // restaurant_id column), so it is read only when a correlation_id
      // names the rows to read — that part is still true and still why the
      // skip below exists. What changed: every row this now returns is
      // proven against restaurantId through its aggregate before it reaches
      // the caller (see filterEventsOwnedByHouse below), so a foreign
      // house's row is withheld even though the table it came from has no
      // scoping of its own. The table stays unscoped; the read is not.
      // `null` — not an empty result — is what says "not queried", so the
      // skip is reported as a skip.
      correlationId
        ? this.fetchEventStore(db, correlationId, restaurantId, cursor)
        : Promise.resolve(null),
    ]);

    const queried = results.filter((r): r is SourceResult => r !== null);
    const merged = queried.flatMap((r) => r.events).sort(newestFirst);
    const hasMore = merged.length > limit;
    const events = merged.slice(0, limit);
    const lastDated = [...events].reverse().find((e) => e.occurredAt !== null);

    return {
      events,
      correlationId,
      sourcesQueried: queried.map((r) => r.source),
      failedSources: queried.filter((r) => r.error).map((r) => r.source),
      window: limit,
      hasMore,
      nextCursor: hasMore ? (lastDated?.occurredAt ?? null) : null,
      ...(withholdMoney ? { amountsWithheld: true as const } : {}),
    };
  }

  /** Run one source's query, converting a thrown error into a named failure. */
  private async guard(
    source: TimelineSource,
    fetch: () => Promise<TimelineEvent[]>,
  ): Promise<SourceResult> {
    try {
      return { source, events: await fetch(), error: null };
    } catch (err: any) {
      const message = err?.message ?? "unknown error";
      // Still logged loudly — but the log is for us, and the caller needs to
      // be told too. Only one of those two used to happen.
      this.logger.warn(`${source} timeline fetch failed: ${message}`);
      return { source, events: [], error: message };
    }
  }

  private fetchPosChecks(
    db: any,
    restaurantId: string,
    correlationId: string | null,
    cursor: Cursor,
  ): Promise<SourceResult> {
    return this.guard("pos_checks", async () => {
      // A check is placed at its close, or at its open while it is still
      // open — so it must be paged by that same time. Paging every check by
      // opened_at let a long table that just closed (opened early, closed
      // last) fall behind the window of later-opened checks: missing from
      // page one, then turning up on a later page above older rows (F-261).
      // PostgREST cannot order by coalesce(closed_at, opened_at), so the two
      // halves are read separately, each windowed on the column that IS its
      // time, and merged; the top `fetch` of the union is exact because each
      // half is its own top `fetch`.
      const read = (half: (q: any) => any, col: string) => {
        let q = half(
          db
            .from("pos_checks")
            .select(
              "id, external_check_id, source, closed_at, opened_at, correlation_id, items, voided, server_name",
            )
            .eq("restaurant_id", restaurantId),
        );
        q = windowed(q, col, cursor);
        if (correlationId) q = q.eq("correlation_id", correlationId);
        return q;
      };
      const [closed, open] = await Promise.all([
        read((q) => q.not("closed_at", "is", null), "closed_at"),
        read((q) => q.is("closed_at", null), "opened_at"),
      ]);
      if (closed.error) throw closed.error;
      if (open.error) throw open.error;
      const data = [...(closed.data || []), ...(open.data || [])];
      // F-483: a voided check is stamped closed too, so `closed_at` alone
      // printed a void as an ordinary sale and an owner looking for last
      // night's voids could not find one. `voided` is said first. The server
      // is the till's own name for whoever rang it up (F-482).
      return data.map((r: any) => {
        const state =
          r.voided === true ? "voided" : r.closed_at ? "closed" : "opened";
        const server =
          typeof r.server_name === "string" && r.server_name.trim()
            ? r.server_name.trim()
            : null;
        return {
          id: r.id,
          source: "pos_checks" as const,
          occurredAt: r.closed_at || r.opened_at || null,
          correlationId: r.correlation_id ?? null,
          summary: `POS check ${r.external_check_id} ${state}${server ? ` by ${server}` : ""} (${r.source})`,
          detail: {
            externalCheckId: r.external_check_id,
            source: r.source,
            voided: r.voided === true,
            serverName: server,
            itemCount: Array.isArray(r.items) ? r.items.length : 0,
          },
        };
      });
    });
  }

  private fetchDecisions(
    db: any,
    restaurantId: string,
    correlationId: string | null,
    cursor: Cursor,
    withholdMoney: boolean,
  ): Promise<SourceResult> {
    return this.guard("decision_log", async () => {
      let q = db
        .from("decision_log")
        .select(
          "id, agent_name, decision_type, confidence, correlation_id, created_at, output",
        )
        .eq("restaurant_id", restaurantId);
      q = windowed(q, "created_at", cursor);
      if (correlationId) q = q.eq("correlation_id", correlationId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map((r: any) => ({
        id: r.id,
        source: "decision_log" as const,
        occurredAt: r.created_at ?? null,
        correlationId: r.correlation_id ?? null,
        summary: `${r.agent_name}: ${r.decision_type}`,
        detail: {
          agentName: r.agent_name,
          decisionType: r.decision_type,
          confidence: r.confidence,
          output: withholdMoney ? outputWithoutPrices(r.output) : r.output,
        },
      }));
    });
  }

  private fetchInventoryTxns(
    db: any,
    restaurantId: string,
    correlationId: string | null,
    cursor: Cursor,
  ): Promise<SourceResult> {
    return this.guard("inventory_transactions", async () => {
      // correlation lives in metadata->>'correlation_id' for this table.
      let q = db
        .from("inventory_transactions")
        .select(
          "id, inventory_id, transaction_type, source, quantity_change, reason, metadata, transaction_date, performed_by",
        )
        .eq("restaurant_id", restaurantId);
      q = windowed(q, "transaction_date", cursor);
      if (correlationId) {
        q = q.contains("metadata", { correlation_id: correlationId });
      }
      const { data, error } = await q;
      if (error) throw error;
      const rows = data || [];
      // F-482: who counted or adjusted. A movement with no `performed_by`
      // was booked by the system (`apply_stock_movement` stamps
      // performed_by_type 'system'), so it names nobody.
      const names = await this.namesInHouse(
        db,
        restaurantId,
        rows.map((r: any) => r.performed_by),
      );
      return rows.map((r: any) => {
        const by = r.performed_by ? nameFor(names, r.performed_by) : null;
        return {
          id: r.id,
          source: "inventory_transactions" as const,
          occurredAt: r.transaction_date ?? null,
          correlationId: r.metadata?.correlation_id ?? null,
          summary: `Stock ${r.transaction_type} (${r.source}): ${r.quantity_change > 0 ? "+" : ""}${r.quantity_change}${by ? ` by ${by}` : ""}`,
          detail: {
            inventoryId: r.inventory_id,
            transactionType: r.transaction_type,
            source: r.source,
            quantityChange: r.quantity_change,
            reason: r.reason,
            performedBy: r.performed_by ?? null,
            performedByName: by,
          },
        };
      });
    });
  }

  /**
   * Glasses poured by hand (F-1597): who, when, how many. The till's own
   * pours (`source = 'pos'`) are left out — they are on the till's checks.
   * A pour that opened a bottle also has its ledger row above; this row is
   * the glass, that one the bottle.
   */
  private fetchHandPours(
    db: any,
    restaurantId: string,
    cursor: Cursor,
  ): Promise<SourceResult> {
    return this.guard("pour_events", async () => {
      let q = db
        .from("pour_events")
        .select(
          "id, inventory_id, pours, pour_ml, bottles_opened, location_id, source, performed_by, created_at",
        )
        .eq("restaurant_id", restaurantId)
        .neq("source", "pos");
      q = windowed(q, "created_at", cursor);
      const { data, error } = await q;
      if (error) throw error;
      const rows = data || [];
      const names = await this.namesInHouse(
        db,
        restaurantId,
        rows.map((r: any) => r.performed_by),
      );
      return rows.map((r: any) => {
        const by = r.performed_by ? nameFor(names, r.performed_by) : null;
        const glasses = Number(r.pours) || 0;
        const opened = Number(r.bottles_opened) || 0;
        return {
          id: r.id,
          source: "pour_events" as const,
          occurredAt: r.created_at ?? null,
          correlationId: null,
          summary: `${glasses} glass${glasses === 1 ? "" : "es"} poured (${r.pour_ml} ml)${opened > 0 ? `, ${opened} bottle${opened === 1 ? "" : "s"} opened` : ""}${by ? ` by ${by}` : ""}`,
          detail: {
            inventoryId: r.inventory_id,
            pours: glasses,
            pourMl: r.pour_ml,
            bottlesOpened: opened,
            locationId: r.location_id ?? null,
            source: r.source,
            performedBy: r.performed_by ?? null,
            performedByName: by,
          },
        };
      });
    });
  }

  private fetchDocuments(
    db: any,
    restaurantId: string,
    correlationId: string | null,
    cursor: Cursor,
    withholdMoney: boolean,
  ): Promise<SourceResult> {
    return this.guard("procurement_documents", async () => {
      let q = db
        .from("procurement_documents")
        .select(
          "id, doc_type, doc_number, status, total, correlation_id, created_at",
        )
        .eq("restaurant_id", restaurantId);
      q = windowed(q, "created_at", cursor);
      if (correlationId) q = q.eq("correlation_id", correlationId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map((r: any) => ({
        id: r.id,
        source: "procurement_documents" as const,
        // NULLABLE in the baseline — see TimelineEvent.occurredAt.
        occurredAt: r.created_at ?? null,
        correlationId: r.correlation_id ?? null,
        summary: `${r.doc_type}${r.doc_number ? ` #${r.doc_number}` : ""} → ${r.status}`,
        detail: {
          docType: r.doc_type,
          docNumber: r.doc_number,
          status: r.status,
          // An invoice's or a credit note's total is the house's money.
          ...(withholdMoney ? {} : { total: r.total }),
        },
      }));
    });
  }

  private fetchAuditLog(
    db: any,
    restaurantId: string,
    correlationId: string | null,
    cursor: Cursor,
    role: unknown,
  ): Promise<SourceResult> {
    return this.guard("system_audit_log", async () => {
      let q = db
        .from("system_audit_log")
        .select(
          "id, actor_type, actor_id, action, entity_type, entity_id, changes, reason, correlation_id, created_at",
        )
        .eq("restaurant_id", restaurantId);
      // ADR 0218 round 4, 2026-09-22 — filtered in the QUERY, not after the
      // window is applied: `system_audit_log` is read to `limit + 1` per
      // source so `hasMore` is exact (see "The window, and walking it"
      // below), and filtering the withheld rows out afterwards would shrink
      // a staff page below its own cap whenever a house's Away actions were
      // frequent, the same hazard `settings-audit.service.ts` avoids by
      // filtering `readBackActionsFor` in its `.in("action", …)` clause.
      if (withholdsAwayActions(role)) {
        q = q.not(
          "action",
          "in",
          `(${LOGS_AWAY_ACTIONS_WITHHELD_FROM_STAFF.join(",")})`,
        );
      }
      q = windowed(q, "created_at", cursor);
      if (correlationId) q = q.eq("correlation_id", correlationId);
      const { data, error } = await q;
      if (error) throw error;
      const rows = data || [];
      // F-482: "Name: act — subject (field: from → to)". The summary used to
      // be `${actor_type} ${action} on ${entity_type}` ("user
      // member_role_changed on restaurant_member"): who and from-what-to-what
      // were stored on the row and never read.
      const staff = withholdsAwayActions(role);
      const unnamed = (action: string) =>
        staff && LOGS_UNNAMED_FOR_STAFF.includes(action);
      const names = await this.namesInHouse(
        db,
        restaurantId,
        rows.filter((r: any) => !unnamed(r.action)).map((r: any) => r.actor_id),
      );
      return rows.map((r: any) => {
        const hide = unnamed(r.action);
        const fields = fieldChanges(r.changes);
        const subject =
          !hide &&
          typeof r.changes?.subject === "string" &&
          r.changes.subject.trim()
            ? r.changes.subject.trim()
            : null;
        const actorName = hide
          ? null
          : r.actor_id
            ? nameFor(names, r.actor_id)
            : null;
        const who = hide
          ? "Someone"
          : (actorName ??
            (r.actor_type === "system"
              ? "The system"
              : r.actor_type === "agent"
                ? "An agent"
                : "Someone"));
        const act = String(r.action ?? "").replace(/_/g, " ");
        const moved = changeWords(fields);
        // F-1522: a delivery put the drink back on (or, turned away, took it
        // off again); the person on the row booked the delivery, not the 86.
        const byDelivery =
          r.action === "drink_back_on" && r.changes?.ended_by_receipt
            ? "back on: delivery booked"
            : r.action === "drink_sold_out" && r.changes?.reopened_after_receipt
              ? "sold out again: the delivery that brought it back was turned away"
              : null;
        const by = actorName ? ` by ${actorName}` : "";
        return {
          id: r.id,
          source: "system_audit_log" as const,
          // NULLABLE in the baseline — see TimelineEvent.occurredAt.
          occurredAt: r.created_at ?? null,
          correlationId: r.correlation_id ?? null,
          summary: byDelivery
            ? `${subject ?? "A drink"} ${byDelivery}${by}`
            : `${who}: ${act}${subject ? ` — ${subject}` : ""}${moved ? ` (${moved})` : ""}`,
          detail: {
            actorType: r.actor_type,
            actorId: hide ? null : (r.actor_id ?? null),
            actorName,
            action: r.action,
            entityType: r.entity_type,
            entityId: r.entity_id,
            subject,
            changes: fields,
            reason: r.reason,
          },
        };
      });
    });
  }

  /** The house's names for a page of rows: see `readNamesInHouse`. */
  private namesInHouse(
    db: any,
    restaurantId: string,
    ids: unknown[],
  ): Promise<Map<string, string> | null> {
    return readNamesInHouse(db, restaurantId, ids, (m) =>
      this.logger.warn(`/logs could not name the people on this page: ${m}`),
    );
  }

  /**
   * event_store is not restaurant-scoped, so the caller only reaches this when
   * a correlation_id names the rows to read; without one it would dump the
   * whole platform's event stream into every restaurant's timeline. The skip
   * is decided by the caller so that `sourcesQueried` can report it.
   *
   * A correlation_id is not a house boundary — it is an author's own
   * bookkeeping value, and nothing stops two houses' work from sharing one
   * (or a caller from guessing another house's). Filtering by correlation_id
   * alone would hand back another restaurant's rows whenever that happened
   * (2026-09-17 finding). Every row is proven to belong to `restaurantId`
   * through its aggregate before it leaves this method; a row whose house
   * cannot be proven is refused, never included on faith.
   */
  private fetchEventStore(
    db: any,
    correlationId: string,
    restaurantId: string,
    cursor: Cursor,
  ): Promise<SourceResult> {
    return this.guard("event_store", async () => {
      const q = db
        .from("event_store")
        .select(
          "event_id, aggregate_type, aggregate_id, event_type, correlation_id, created_at, payload",
        )
        .eq("correlation_id", correlationId);
      const { data, error } = await windowed(q, "created_at", cursor);
      if (error) throw error;
      const rows = data || [];
      const { owned, foreignCount, unprovableTypes } =
        await this.filterEventsOwnedByHouse(db, rows, restaurantId);
      // Two different reasons a row does not make it back, named separately:
      // an operator reading "outside restaurant" for every withheld row would
      // conclude a cross-house leak was attempted, when most of the time (any
      // aggregate_type other than "inventory") it means a new event producer
      // started writing and this method has no owning table to check it
      // against yet — the signal that needs to reach someone is "a new
      // aggregate_type appeared," not "a house tried to read another's data."
      if (foreignCount > 0) {
        this.logger.warn(
          `event_store: correlation_id ${JSON.stringify(correlationId)} named ${foreignCount} row(s) withheld (foreign house, not restaurant ${restaurantId})`,
        );
      }
      if (unprovableTypes.length > 0) {
        this.logger.warn(
          `event_store: correlation_id ${JSON.stringify(correlationId)} named row(s) withheld (house unprovable: aggregate_type=${unprovableTypes.join(",")})`,
        );
      }
      return owned.map((r: any) => ({
        id: r.event_id,
        source: "event_store" as const,
        occurredAt: r.created_at ?? null,
        correlationId: r.correlation_id ?? null,
        summary: `${r.aggregate_type}.${r.event_type}`,
        detail: {
          aggregateType: r.aggregate_type,
          aggregateId: r.aggregate_id,
          eventType: r.event_type,
        },
      }));
    });
  }

  /**
   * Prove each event_store row's house through its aggregate, never through
   * the row's own `payload.restaurant_id` (a value the writer stamped on
   * itself, not a key another table can be joined against). Today the only
   * producer is `BaseAgent.append_event`, and the only `aggregate_type` it
   * writes is `"inventory"`, whose `aggregate_id` is `restaurant_inventory.id`
   * (`services/agent-orchestrator/agents/inventory_engine.py`). Any other
   * aggregate_type has no known owning table here, so it is refused rather
   * than assumed safe — an unprovable row is exactly the shape a future
   * cross-house leak would take.
   *
   * Returns the two withheld counts separately from the owned rows, so the
   * caller can log "foreign house" and "house unprovable" as different
   * conditions rather than one combined "outside restaurant" that blames an
   * unprovable row (a new aggregate_type nobody taught this method about) on
   * the same cause as an actual cross-house read.
   */
  private async filterEventsOwnedByHouse(
    db: any,
    rows: any[],
    restaurantId: string,
  ): Promise<{
    owned: any[];
    foreignCount: number;
    unprovableTypes: string[];
  }> {
    const inventoryRows = rows.filter((r) => r.aggregate_type === "inventory");
    const unprovableTypes = Array.from(
      new Set(
        rows
          .filter((r) => r.aggregate_type !== "inventory")
          .map((r) => r.aggregate_type),
      ),
    );
    if (inventoryRows.length === 0) {
      return { owned: [], foreignCount: 0, unprovableTypes };
    }

    const inventoryIds = Array.from(
      new Set(inventoryRows.map((r) => r.aggregate_id)),
    );
    const { data, error } = await db
      .from("restaurant_inventory")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .in("id", inventoryIds);
    if (error) throw error;
    const ownedIds = new Set((data || []).map((r: any) => r.id));
    const owned = inventoryRows.filter((r) => ownedIds.has(r.aggregate_id));
    return {
      owned,
      foreignCount: inventoryRows.length - owned.length,
      unprovableTypes,
    };
  }
}

/* ── The window, and walking it ──────────────────────────────────────────
THE WINDOW IS MARKED, AND IT CAN BE WALKED (2026-09-11, /logs rebuild)

`limit` was a silent cap: the page asked for 100, the merge sliced to 100,
and nothing in the response said whether a 101st row existed. Now:

  - every source is read to `limit + 1`, so `hasMore` is EXACT: the merged
    list exceeds `limit` if and only if some register holds a row past it;
  - `window` echoes the clamp that was applied, so a caller prints the cap
    the server used and not the one it asked for;
  - `nextCursor` is the `occurredAt` of the last DATED event on the page.
    Passing it back as `before` reads the next page. The filter is `<=`,
    not `<`: a strict cursor silently drops every row that shares the
    boundary timestamp, and a batch insert stamps dozens of rows with one.
    The caller de-duplicates on `source:id` instead — a re-read row costs a
    byte, a dropped row costs the truth;
  - undated rows (`occurredAt: null`) are re-read on every cursor page
    (`col.is.null` is OR-ed into the filter) and sort LAST in every
    register (`nullsFirst: false`), so they surface once the dated rows are
    exhausted rather than never. Before this they sorted FIRST inside each
    source query — Postgres puts NULLs first under DESC — so a register with
    more undated rows than the window could crowd its own dated rows out of
    the fetch entirely, and the merge then sliced the undated ones off: a
    register full of rows that returned nothing;
  - a page holding no dated event at all cannot advance: `nextCursor` is
    null while `hasMore` may still be true, and the caller says so in words.
*/

/** Where a source read starts (`before`, inclusive) and how many rows it takes. */
interface Cursor {
  before: string | null;
  fetch: number;
}

/**
 * A cursor is an ISO-8601 instant or nothing. It is normalised to UTC `Z`
 * form, at the precision it was sent in, because it is spliced into a PostgREST `or=` filter, where a `+`
 * offset would be read as a space; and a cursor that does not parse is a
 * client error said as one, never a silent "start from the top" — that
 * would hand a caller page one again while telling it this was page two.
 */
function parseCursor(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === "") return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) {
    throw new BadRequestException(
      `before must be an ISO-8601 timestamp; got ${JSON.stringify(raw)}`,
    );
  }
  // toISOString keeps milliseconds only, while Postgres stamps microseconds:
  // a cursor of `.123456` re-written as `.123` sits BEFORE every row of its
  // own batch, so `<=` dropped the rest of a same-transaction batch for good
  // (F-906). An offset is whole minutes, so the fraction the caller sent is
  // the fraction in UTC too — splice it back as given.
  const iso = new Date(t).toISOString();
  const frac = /T\d{2}:\d{2}:\d{2}\.(\d{4,9})/.exec(raw)?.[1];
  return frac ? iso.replace(/\.\d{3}Z$/, `.${frac}Z`) : iso;
}

/**
 * Apply the window to one source's query: newest first with undated rows
 * LAST (see the header — Postgres puts NULLs first under DESC, which let an
 * undated register crowd out its own dated rows), the cursor as an inclusive
 * `<=` OR-ed with `is.null` so undated rows stay reachable on every page, and
 * the fetch size of one past the window.
 */
function windowed(q: any, col: string, cursor: Cursor): any {
  let out = q.order(col, { ascending: false, nullsFirst: false });
  if (cursor.before) {
    out = out.or(`${col}.lte.${cursor.before},${col}.is.null`);
  }
  return out.limit(cursor.fetch);
}

/**
 * Names for the people behind a page of rows, resolved WITHIN this house
 * only (F-482): an id is named when `public.users` says it belongs to this
 * house or it holds a `user_restaurant_access` row for it, or held one: a
 * former member's acts stay theirs, so an id with a
 * `house_memberships_ended` row for this house is named too (F-1512; the
 * removal clears the other two). The month-close shelf names them the same
 * way, and ADR 0337 never touches who acted. Any other id's name is read but
 * dropped here, never returned to this reader, and its row reads "Someone
 * not on this house's team". A lookup that fails returns null — said on each row as a name
 * that could not be read, never as a stranger — and is `warn`ed; the rows
 * still come back, because a change nobody can name still happened.
 * Exported for a wine's own pours (inventory activity, F-1597).
 */
export async function readNamesInHouse(
  db: any,
  restaurantId: string,
  ids: unknown[],
  warn: (message: string) => void,
): Promise<Map<string, string> | null> {
  const out = new Map<string, string>();
  const unique = [
    ...new Set(
      ids.filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  ];
  if (unique.length === 0) return out;
  try {
    const [users, access, ended] = await Promise.all([
      db
        .from("users")
        .select("user_id, name, email, restaurant_id")
        .in("user_id", unique),
      db
        .from("user_restaurant_access")
        .select("user_id")
        .eq("restaurant_id", restaurantId)
        .in("user_id", unique),
      db
        .from("house_memberships_ended")
        .select("user_id")
        .eq("restaurant_id", restaurantId)
        .in("user_id", unique),
    ]);
    if (users.error) throw users.error;
    if (access.error) throw access.error;
    if (ended.error) throw ended.error;
    const held = new Set(
      [...(access.data ?? []), ...(ended.data ?? [])].map(
        (a: any) => a.user_id,
      ),
    );
    for (const u of users.data ?? []) {
      if (u.restaurant_id !== restaurantId && !held.has(u.user_id)) continue;
      out.set(u.user_id, u.name?.trim() || u.email || "A team member");
    }
  } catch (err: any) {
    warn(String(err?.message ?? err));
    return null;
  }
  return out;
}
