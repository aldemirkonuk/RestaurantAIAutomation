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
  occurredAt: string;
  correlationId: string | null;
  summary: string;
  detail: Record<string, unknown>;
}

@Injectable()
export class LogsTimelineService {
  private readonly logger = new Logger(LogsTimelineService.name);

  constructor(private readonly dbService: DatabaseService) {}

  async getTimeline(
    restaurantId: string,
    opts: { correlationId?: string; limit?: number } = {},
  ): Promise<{ events: TimelineEvent[]; correlationId: string | null }> {
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
    const correlationId = opts.correlationId?.trim() || null;
    const db = this.dbService.getClient();

    const [
      posChecks,
      decisions,
      inventoryTxns,
      documents,
      auditLog,
      eventStore,
    ] = await Promise.all([
      this.fetchPosChecks(db, restaurantId, correlationId, limit),
      this.fetchDecisions(db, restaurantId, correlationId, limit),
      this.fetchInventoryTxns(db, restaurantId, correlationId, limit),
      this.fetchDocuments(db, restaurantId, correlationId, limit),
      this.fetchAuditLog(db, restaurantId, correlationId, limit),
      this.fetchEventStore(db, correlationId, limit),
    ]);

    const events = [
      ...posChecks,
      ...decisions,
      ...inventoryTxns,
      ...documents,
      ...auditLog,
      ...eventStore,
    ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

    return {
      events: events.slice(0, limit),
      correlationId,
    };
  }

  private async fetchPosChecks(
    db: any,
    restaurantId: string,
    correlationId: string | null,
    limit: number,
  ): Promise<TimelineEvent[]> {
    try {
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
        occurredAt: r.closed_at || r.opened_at,
        correlationId: r.correlation_id ?? null,
        summary: `POS check ${r.external_check_id}${r.closed_at ? " closed" : " opened"} (${r.source})`,
        detail: {
          externalCheckId: r.external_check_id,
          source: r.source,
          itemCount: Array.isArray(r.items) ? r.items.length : 0,
        },
      }));
    } catch (err: any) {
      this.logger.warn(`pos_checks timeline fetch failed: ${err?.message}`);
      return [];
    }
  }

  private async fetchDecisions(
    db: any,
    restaurantId: string,
    correlationId: string | null,
    limit: number,
  ): Promise<TimelineEvent[]> {
    try {
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
        occurredAt: r.created_at,
        correlationId: r.correlation_id ?? null,
        summary: `${r.agent_name}: ${r.decision_type}`,
        detail: {
          agentName: r.agent_name,
          decisionType: r.decision_type,
          confidence: r.confidence,
          output: r.output,
        },
      }));
    } catch (err: any) {
      this.logger.warn(`decision_log timeline fetch failed: ${err?.message}`);
      return [];
    }
  }

  private async fetchInventoryTxns(
    db: any,
    restaurantId: string,
    correlationId: string | null,
    limit: number,
  ): Promise<TimelineEvent[]> {
    try {
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
        occurredAt: r.transaction_date,
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
    } catch (err: any) {
      this.logger.warn(
        `inventory_transactions timeline fetch failed: ${err?.message}`,
      );
      return [];
    }
  }

  private async fetchDocuments(
    db: any,
    restaurantId: string,
    correlationId: string | null,
    limit: number,
  ): Promise<TimelineEvent[]> {
    try {
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
        occurredAt: r.created_at,
        correlationId: r.correlation_id ?? null,
        summary: `${r.doc_type}${r.doc_number ? ` #${r.doc_number}` : ""} → ${r.status}`,
        detail: {
          docType: r.doc_type,
          docNumber: r.doc_number,
          status: r.status,
          total: r.total,
        },
      }));
    } catch (err: any) {
      this.logger.warn(
        `procurement_documents timeline fetch failed: ${err?.message}`,
      );
      return [];
    }
  }

  private async fetchAuditLog(
    db: any,
    restaurantId: string,
    correlationId: string | null,
    limit: number,
  ): Promise<TimelineEvent[]> {
    try {
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
        occurredAt: r.created_at,
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
    } catch (err: any) {
      this.logger.warn(
        `system_audit_log timeline fetch failed: ${err?.message}`,
      );
      return [];
    }
  }

  private async fetchEventStore(
    db: any,
    correlationId: string | null,
    limit: number,
  ): Promise<TimelineEvent[]> {
    // event_store is not restaurant-scoped — only return rows when a
    // correlation_id is explicitly requested, otherwise it would dump the
    // whole platform's event stream into every restaurant's timeline.
    if (!correlationId) return [];
    try {
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
        occurredAt: r.created_at,
        correlationId: r.correlation_id ?? null,
        summary: `${r.aggregate_type}.${r.event_type}`,
        detail: {
          aggregateType: r.aggregate_type,
          aggregateId: r.aggregate_id,
          eventType: r.event_type,
        },
      }));
    } catch (err: any) {
      this.logger.warn(`event_store timeline fetch failed: ${err?.message}`);
      return [];
    }
  }
}
