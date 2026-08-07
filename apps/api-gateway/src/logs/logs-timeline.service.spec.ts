import { LogsTimelineService } from "./logs-timeline.service";
import { DatabaseService } from "../database/database.service";

/**
 * Logs timeline — correlated read-only feed. Locks in: events merge across
 * sources and sort newest-first, a correlation_id filter reaches into
 * inventory_transactions.metadata, and event_store is only queried when a
 * correlation_id is supplied (it is not restaurant-scoped).
 */

type Row = Record<string, any>;

function makeFakeClient(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: Array<[string, any]> = [];
      const containsFilters: Array<[string, Row]> = [];
      const api: any = {
        select() {
          return api;
        },
        eq(col: string, val: any) {
          filters.push([col, val]);
          return api;
        },
        contains(col: string, val: Row) {
          containsFilters.push([col, val]);
          return api;
        },
        order() {
          return api;
        },
        limit() {
          return api;
        },
        then(resolve: any) {
          let rows = tables[table] || [];
          rows = rows.filter((r) => filters.every(([c, v]) => r[c] === v));
          for (const [col, obj] of containsFilters) {
            rows = rows.filter((r) => {
              const meta = r[col] || {};
              return Object.entries(obj).every(([k, v]) => meta[k] === v);
            });
          }
          resolve({ data: rows, error: null });
        },
      };
      return api;
    },
  };
}

describe("LogsTimelineService.getTimeline", () => {
  it("merges sources and sorts newest-first", async () => {
    const client = makeFakeClient({
      pos_checks: [
        {
          id: "pc-1",
          restaurant_id: "r1",
          external_check_id: "chk-1",
          source: "simpos",
          opened_at: "2026-08-05T10:00:00Z",
          closed_at: "2026-08-05T11:00:00Z",
          correlation_id: "corr-1",
          items: [{ name: "Opus" }],
        },
      ],
      decision_log: [
        {
          id: "dl-1",
          restaurant_id: "r1",
          agent_name: "drift",
          decision_type: "scan",
          created_at: "2026-08-05T12:00:00Z",
          correlation_id: "corr-1",
          confidence: 0.9,
          output: {},
        },
      ],
      inventory_transactions: [],
      procurement_documents: [],
      system_audit_log: [],
      event_store: [],
    });
    const service = new LogsTimelineService({
      getClient: () => client,
    } as unknown as DatabaseService);

    const { events } = await service.getTimeline("r1");

    expect(events).toHaveLength(2);
    expect(events[0].source).toBe("decision_log");
    expect(events[1].source).toBe("pos_checks");
  });

  it("filters inventory_transactions via metadata.correlation_id", async () => {
    const client = makeFakeClient({
      pos_checks: [],
      decision_log: [],
      inventory_transactions: [
        {
          id: "tx-1",
          restaurant_id: "r1",
          inventory_id: "inv-1",
          transaction_type: "sale",
          source: "pos",
          quantity_change: -1,
          transaction_date: "2026-08-05T11:05:00Z",
          metadata: { correlation_id: "corr-1" },
        },
        {
          id: "tx-2",
          restaurant_id: "r1",
          inventory_id: "inv-1",
          transaction_type: "sale",
          source: "pos",
          quantity_change: -1,
          transaction_date: "2026-08-05T11:06:00Z",
          metadata: { correlation_id: "other" },
        },
      ],
      procurement_documents: [],
      system_audit_log: [],
      event_store: [],
    });
    const service = new LogsTimelineService({
      getClient: () => client,
    } as unknown as DatabaseService);

    const { events } = await service.getTimeline("r1", {
      correlationId: "corr-1",
    });

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("tx-1");
    expect(events[0].correlationId).toBe("corr-1");
  });

  it("does not query event_store without a correlation_id", async () => {
    const fromSpy = jest.fn(() => {
      throw new Error("should not be called");
    });
    // Only event_store access would throw; other tables return empty.
    const client = {
      from(table: string) {
        if (table === "event_store") return fromSpy();
        const api: any = {
          select: () => api,
          eq: () => api,
          contains: () => api,
          order: () => api,
          limit: () => api,
          then: (resolve: any) => resolve({ data: [], error: null }),
        };
        return api;
      },
    };
    const service = new LogsTimelineService({
      getClient: () => client,
    } as unknown as DatabaseService);

    const { events } = await service.getTimeline("r1");
    expect(events).toEqual([]);
    expect(fromSpy).not.toHaveBeenCalled();
  });
});
