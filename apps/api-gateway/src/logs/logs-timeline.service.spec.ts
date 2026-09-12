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

  /**
   * ADR 0086 — the seam. Every source was caught to `[]` and the request
   * returned 200, so a source that 500s contributed zero events, the caller's
   * error state stayed false, and the failure rendered as a smaller number
   * with no banner. On a page whose entire subject is counts, that is absence
   * reported as health.
   */
  describe("a source that fails is named, not silently dropped", () => {
    function clientWhereOneTableFails(failing: string) {
      return {
        from(table: string) {
          const api: any = {
            select: () => api,
            eq: () => api,
            contains: () => api,
            order: () => api,
            limit: () => api,
            then: (resolve: any) =>
              resolve(
                table === failing
                  ? { data: null, error: { message: "relation is down" } }
                  : {
                      data:
                        table === "pos_checks"
                          ? [
                              {
                                id: "pc-1",
                                external_check_id: "chk-1",
                                source: "simpos",
                                opened_at: "2026-08-05T10:00:00Z",
                                closed_at: null,
                                correlation_id: null,
                                items: [],
                              },
                            ]
                          : [],
                      error: null,
                    },
              ),
          };
          return api;
        },
      };
    }

    it("returns the events it has AND the sources that failed", async () => {
      const service = new LogsTimelineService({
        getClient: () => clientWhereOneTableFails("procurement_documents"),
      } as unknown as DatabaseService);

      const res = await service.getTimeline("r1");

      expect(res.events).toHaveLength(1); // the request still succeeds
      expect(res.failedSources).toEqual(["procurement_documents"]);
    });

    it("declares which sources it actually queried, so a skip cannot read as a success", async () => {
      const service = new LogsTimelineService({
        getClient: () => clientWhereOneTableFails("__none__"),
      } as unknown as DatabaseService);

      const res = await service.getTimeline("r1");

      expect(res.failedSources).toEqual([]);
      // event_store is not restaurant-scoped and is deliberately not read
      // without a correlation_id — the omission is stated rather than implied.
      expect(res.sourcesQueried).toEqual([
        "pos_checks",
        "decision_log",
        "inventory_transactions",
        "procurement_documents",
        "system_audit_log",
      ]);
      expect(res.sourcesQueried).not.toContain("event_store");
    });
  });

  it("survives a row whose timestamp column is null instead of 500ing the whole feed", async () => {
    // `procurement_documents.created_at` and `system_audit_log.created_at` are
    // both nullable in the baseline. The merge sorted with
    // `b.occurredAt.localeCompare(...)` OUTSIDE every try/catch, so one
    // explicit NULL threw a TypeError past the per-source guards and took the
    // entire timeline down with it.
    const client = makeFakeClient({
      pos_checks: [],
      decision_log: [],
      inventory_transactions: [],
      procurement_documents: [
        {
          id: "doc-null",
          restaurant_id: "r1",
          doc_type: "invoice",
          doc_number: "INV-1",
          status: "received",
          total: 10,
          correlation_id: null,
          created_at: null,
        },
        {
          id: "doc-dated",
          restaurant_id: "r1",
          doc_type: "invoice",
          doc_number: "INV-2",
          status: "received",
          total: 10,
          correlation_id: null,
          created_at: "2026-08-05T12:00:00Z",
        },
      ],
      system_audit_log: [],
      event_store: [],
    });
    const service = new LogsTimelineService({
      getClient: () => client,
    } as unknown as DatabaseService);

    const { events, failedSources } = await service.getTimeline("r1");

    expect(failedSources).toEqual([]);
    expect(events).toHaveLength(2);
    // An undated row keeps its place in the feed but never claims a time, and
    // never presents itself as the newest thing that happened.
    expect(events[0].id).toBe("doc-dated");
    expect(events[1].occurredAt).toBeNull();
  });
});
