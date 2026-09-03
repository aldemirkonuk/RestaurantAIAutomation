import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

/**
 * Correlated logs timeline (SimPOS testbed plan, cross-cutting).
 *
 * Read-only view over pos_checks, decision_log, inventory_transactions,
 * procurement_documents, system_audit_log, and event_store, joined on
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

@Injectable()
export class LogsTimelineService {
  private readonly logger = new Logger(LogsTimelineService.name);

  constructor(private readonly dbService: DatabaseService) {}

  async getTimeline(
    restaurantId: string,
    opts: { correlationId?: string; limit?: number } = {},
  ): Promise<TimelineResponse> {
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
    const correlationId = opts.correlationId?.trim() || null;
    const db = this.dbService.getClient();

    const results = await Promise.all([
      this.fetchPosChecks(db, restaurantId, correlationId, limit),
      this.fetchDecisions(db, restaurantId, correlationId, limit),
      this.fetchInventoryTxns(db, restaurantId, correlationId, limit),
      this.fetchDocuments(db, restaurantId, correlationId, limit),
      this.fetchAuditLog(db, restaurantId, correlationId, limit),
      // event_store is not restaurant-scoped, so it is read only when a
      // correlation_id names the rows to read. `null` — not an empty result —
      // is what says "not queried", so the skip is reported as a skip.
      correlationId
        ? this.fetchEventStore(db, correlationId, limit)
        : Promise.resolve(null),
    ]);

    const queried = results.filter((r): r is SourceResult => r !== null);
    const events = queried
      .flatMap((r) => r.events)
      .sort(newestFirst)
      .slice(0, limit);

    return {
      events,
      correlationId,
      sourcesQueried: queried.map((r) => r.source),
      failedSources: queried.filter((r) => r.error).map((r) => r.source),
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
    limit: number,
  ): Promise<SourceResult> {
    return this.guard("pos_checks", async () => {
      let q = db
        .from("pos_checks")
        .select(
          "id, external_check_id, source, closed_at, opened_at, correlation_id, items",
        )
        .eq("restaurant_id", restaurantId)
        .order("opened_at", { ascending: false })
        .limit(limit);
      if (correlationId) q = q.eq("correlation_id", correlationId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map((r: any) => ({
        id: r.id,
        source: "pos_checks" as const,
        occurredAt: r.closed_at || r.opened_at || null,
        correlationId: r.correlation_id ?? null,
        summary: `POS check ${r.external_check_id}${r.closed_at ? " closed" : " opened"} (${r.source})`,
        detail: {
          externalCheckId: r.external_check_id,
          source: r.source,
          itemCount: Array.isArray(r.items) ? r.items.length : 0,
        },
      }));
    });
  }

  private fetchDecisions(
    db: any,
    restaurantId: string,
    correlationId: string | null,
    limit: number,
  ): Promise<SourceResult> {
    return this.guard("decision_log", async () => {
      let q = db
        .from("decision_log")
        .select(
          "id, agent_name, decision_type, confidence, correlation_id, created_at, output",
        )
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .limit(limit);
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
          output: r.output,
        },
      }));
    });
  }

  private fetchInventoryTxns(
    db: any,
    restaurantId: string,
    correlationId: string | null,
    limit: number,
  ): Promise<SourceResult> {
    return this.guard("inventory_transactions", async () => {
      // correlation lives in metadata->>'correlation_id' for this table.
      let q = db
        .from("inventory_transactions")
        .select(
          "id, inventory_id, transaction_type, source, quantity_change, reason, metadata, transaction_date",
        )
        .eq("restaurant_id", restaurantId)
        .order("transaction_date", { ascending: false })
        .limit(limit);
      if (correlationId) {
        q = q.contains("metadata", { correlation_id: correlationId });
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map((r: any) => ({
        id: r.id,
        source: "inventory_transactions" as const,
        occurredAt: r.transaction_date ?? null,
        correlationId: r.metadata?.correlation_id ?? null,
        summary: `Stock ${r.transaction_type} (${r.source}): ${r.quantity_change > 0 ? "+" : ""}${r.quantity_change}`,
        detail: {
          inventoryId: r.inventory_id,
          transactionType: r.transaction_type,
          source: r.source,
          quantityChange: r.quantity_change,
          reason: r.reason,
        },
      }));
    });
  }

  private fetchDocuments(
    db: any,
    restaurantId: string,
    correlationId: string | null,
    limit: number,
  ): Promise<SourceResult> {
    return this.guard("procurement_documents", async () => {
      let q = db
        .from("procurement_documents")
        .select(
          "id, doc_type, doc_number, status, total, correlation_id, created_at",
        )
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .limit(limit);
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
          total: r.total,
        },
      }));
    });
  }

  private fetchAuditLog(
    db: any,
    restaurantId: string,
    correlationId: string | null,
    limit: number,
  ): Promise<SourceResult> {
    return this.guard("system_audit_log", async () => {
      let q = db
        .from("system_audit_log")
        .select(
          "id, actor_type, action, entity_type, entity_id, reason, correlation_id, created_at",
        )
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (correlationId) q = q.eq("correlation_id", correlationId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map((r: any) => ({
        id: r.id,
        source: "system_audit_log" as const,
        // NULLABLE in the baseline — see TimelineEvent.occurredAt.
        occurredAt: r.created_at ?? null,
        correlationId: r.correlation_id ?? null,
        summary: `${r.actor_type} ${r.action} on ${r.entity_type}`,
        detail: {
          actorType: r.actor_type,
          action: r.action,
          entityType: r.entity_type,
          entityId: r.entity_id,
          reason: r.reason,
        },
      }));
    });
  }

  /**
   * event_store is not restaurant-scoped, so the caller only reaches this when
   * a correlation_id names the rows to read; without one it would dump the
   * whole platform's event stream into every restaurant's timeline. The skip
   * is decided by the caller so that `sourcesQueried` can report it.
   */
  private fetchEventStore(
    db: any,
    correlationId: string,
    limit: number,
  ): Promise<SourceResult> {
    return this.guard("event_store", async () => {
      const { data, error } = await db
        .from("event_store")
        .select(
          "event_id, aggregate_type, aggregate_id, event_type, correlation_id, created_at, payload",
        )
        .eq("correlation_id", correlationId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data || []).map((r: any) => ({
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
}
