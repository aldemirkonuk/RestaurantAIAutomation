import { LogsTimelineService } from "./logs-timeline.service";
import { DatabaseService } from "../database/database.service";

import { BadRequestException } from "@nestjs/common";

/**
 * Logs timeline — correlated read-only feed. Locks in: events merge across
 * sources and sort newest-first, a correlation_id filter reaches into
 * inventory_transactions.metadata, and event_store is only queried when a
 * correlation_id is supplied (it is not restaurant-scoped).
 *
 * Since 2026-09-11 (the /logs rebuild) it also locks in the window: each
 * register is read to `limit + 1` so `hasMore` is exact, undated rows sort
 * LAST inside every register, the `before` cursor is inclusive and keeps
 * undated rows reachable, and a page with no dated event says it cannot
 * advance rather than pretending it is the end.
 */

type Row = Record<string, any>;

/** What one `from()` chain was asked for — the fake records it so a spec can
 *  assert on the ORDER and the LIMIT, not only on the rows that came back. */
interface Asked {
  table: string;
  order: Array<[string, any]>;
  limit: number | null;
  or: string[];
}

function makeFakeClient(tables: Record<string, Row[]>, asked: Asked[] = []) {
  return {
    from(table: string) {
      const filters: Array<[string, any]> = [];
      const containsFilters: Array<[string, Row]> = [];
      const inFilters: Array<[string, any[]]> = [];
      const notInFilters: Array<[string, string[]]> = [];
      const rec: Asked = { table, order: [], limit: null, or: [] };
      asked.push(rec);
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
        in(col: string, vals: any[]) {
          inFilters.push([col, vals]);
          return api;
        },
        // `.not(col, "in", "(a,b)")` — the ADR 0218 round-4 Away filter. Only
        // the "in" operator is parsed; a wider call throws so a future caller
        // does not get a filter that silently does nothing.
        not(col: string, op: string, val: any) {
          if (op !== "in") {
            throw new Error(`fake client cannot parse not(${col}, ${op}, …)`);
          }
          const list = String(val)
            .replace(/^\(|\)$/g, "")
            .split(",")
            .filter(Boolean);
          notInFilters.push([col, list]);
          return api;
        },
        order(col: string, opts: any) {
          rec.order.push([col, opts]);
          return api;
        },
        or(expr: string) {
          rec.or.push(expr);
          return api;
        },
        limit(n: number) {
          rec.limit = n;
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
          for (const [col, vals] of inFilters) {
            rows = rows.filter((r) => vals.includes(r[col]));
          }
          for (const [col, excluded] of notInFilters) {
            rows = rows.filter((r) => !excluded.includes(String(r[col])));
          }
          // The cursor filter the service writes: `<col>.lte.<iso>,<col>.is.null`.
          for (const expr of rec.or) {
            const m = /^([a-z_]+)\.lte\.(.+),\1\.is\.null$/.exec(expr);
            if (!m) throw new Error(`fake client cannot parse or(${expr})`);
            const [, col, iso] = m;
            rows = rows.filter(
              (r) => r[col] === null || r[col] === undefined || r[col] <= iso,
            );
          }
          // Newest first, NULLs last — what `nullsFirst: false` under DESC does.
          for (const [col, opts] of rec.order) {
            const desc = opts?.ascending === false;
            const nullsFirst = opts?.nullsFirst === true;
            rows = [...rows].sort((a, b) => {
              const av = a[col] ?? null;
              const bv = b[col] ?? null;
              if (av === null && bv === null) return 0;
              if (av === null) return nullsFirst ? -1 : 1;
              if (bv === null) return nullsFirst ? 1 : -1;
              return desc
                ? String(bv).localeCompare(String(av))
                : String(av).localeCompare(String(bv));
            });
          }
          if (rec.limit !== null) rows = rows.slice(0, rec.limit);
          resolve({ data: rows, error: null });
        },
      };
      return api;
    },
  };
}

function decision(
  id: string,
  createdAt: string | null,
  restaurantId = "r1",
): Row {
  return {
    id,
    restaurant_id: restaurantId,
    agent_name: "drift",
    decision_type: "scan",
    created_at: createdAt,
    correlation_id: null,
    confidence: 0.9,
    output: {},
  };
}

function document(
  id: string,
  createdAt: string | null,
  restaurantId = "r1",
): Row {
  return {
    id,
    restaurant_id: restaurantId,
    doc_type: "invoice",
    doc_number: id.toUpperCase(),
    status: "received",
    total: 10,
    correlation_id: null,
    created_at: createdAt,
  };
}

const EMPTY = {
  pos_checks: [],
  decision_log: [],
  inventory_transactions: [],
  procurement_documents: [],
  system_audit_log: [],
  event_store: [],
  restaurant_inventory: [],
};

function eventStoreRow(
  eventId: string,
  aggregateType: string,
  aggregateId: string,
  correlationId: string,
  createdAt: string,
): Row {
  return {
    event_id: eventId,
    aggregate_type: aggregateType,
    aggregate_id: aggregateId,
    event_type: "StockUpdated",
    correlation_id: correlationId,
    created_at: createdAt,
    payload: {},
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
          not: () => api,
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
   * 2026-09-17 finding: event_store carries no restaurant_id, so filtering
   * only by correlation_id let one house read another house's rows whenever
   * a correlation_id was shared or guessed. Every row must now be proven
   * through its aggregate before it can leave the service.
   */
  describe("event_store rows are proven to belong to the caller's house", () => {
    it("returns only the caller's rows when a correlation_id spans two houses", async () => {
      const client = makeFakeClient({
        ...EMPTY,
        event_store: [
          eventStoreRow(
            "ev-mine",
            "inventory",
            "inv-r1",
            "corr-shared",
            "2026-09-17T10:00:00Z",
          ),
          eventStoreRow(
            "ev-theirs",
            "inventory",
            "inv-r2",
            "corr-shared",
            "2026-09-17T09:00:00Z",
          ),
        ],
        restaurant_inventory: [
          { id: "inv-r1", restaurant_id: "r1" },
          { id: "inv-r2", restaurant_id: "r2" },
        ],
      });
      const service = new LogsTimelineService({
        getClient: () => client,
      } as unknown as DatabaseService);

      const { events } = await service.getTimeline("r1", {
        correlationId: "corr-shared",
      });

      expect(events.map((e) => e.id)).toEqual(["ev-mine"]);
    });

    it("returns nothing (not an error) when the correlation_id names only a foreign house, and logs the withholding", async () => {
      const client = makeFakeClient({
        ...EMPTY,
        event_store: [
          eventStoreRow(
            "ev-theirs",
            "inventory",
            "inv-r2",
            "corr-foreign",
            "2026-09-17T09:00:00Z",
          ),
        ],
        restaurant_inventory: [{ id: "inv-r2", restaurant_id: "r2" }],
      });
      const service = new LogsTimelineService({
        getClient: () => client,
      } as unknown as DatabaseService);
      const warnSpy = jest.spyOn((service as any).logger, "warn");

      const res = await service.getTimeline("r1", {
        correlationId: "corr-foreign",
      });

      expect(res.events).toEqual([]);
      expect(res.failedSources).toEqual([]);
      expect(res.sourcesQueried).toContain("event_store");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("corr-foreign"),
      );
    });

    it("refuses a row whose aggregate_type has no known owning table, rather than trusting it", async () => {
      const client = makeFakeClient({
        ...EMPTY,
        event_store: [
          eventStoreRow(
            "ev-unknown",
            "reservation",
            "res-1",
            "corr-1",
            "2026-09-17T09:00:00Z",
          ),
        ],
      });
      const service = new LogsTimelineService({
        getClient: () => client,
      } as unknown as DatabaseService);

      const { events } = await service.getTimeline("r1", {
        correlationId: "corr-1",
      });

      expect(events).toEqual([]);
    });
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
            not: () => api,
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

  /**
   * THE WINDOW (2026-09-11). The page prints "the first 100" and a floor mark
   * on every register count; those words are only true if the service can
   * say whether a 101st row exists and can hand over the next page.
   */
  describe("the window is marked and can be walked", () => {
    function service(tables: Record<string, Row[]>, asked: Asked[] = []) {
      return new LogsTimelineService({
        getClient: () => makeFakeClient(tables, asked),
      } as unknown as DatabaseService);
    }

    it("reads one past the window in every register, newest first with undated rows last", async () => {
      const asked: Asked[] = [];
      await service(EMPTY, asked).getTimeline("r1", { limit: 5 });

      expect(asked.map((a) => a.table).sort()).toEqual([
        "decision_log",
        "inventory_transactions",
        "pos_checks",
        "procurement_documents",
        "system_audit_log",
      ]);
      for (const a of asked) {
        expect(a.limit).toBe(6);
        expect(a.order).toHaveLength(1);
        expect(a.order[0][1]).toEqual({ ascending: false, nullsFirst: false });
      }
    });

    it("reports hasMore exactly and hands over the last dated event as the cursor", async () => {
      const tables = {
        ...EMPTY,
        decision_log: [
          decision("d1", "2026-09-01T10:00:00.000Z"),
          decision("d2", "2026-09-01T09:00:00.000Z"),
          decision("d3", "2026-09-01T08:00:00.000Z"),
        ],
        procurement_documents: [
          document("p1", "2026-09-01T09:30:00.000Z"),
          document("p2", "2026-09-01T07:00:00.000Z"),
          document("p3", "2026-09-01T06:00:00.000Z"),
        ],
      };

      const full = await service(tables).getTimeline("r1", { limit: 4 });
      expect(full.window).toBe(4);
      expect(full.events.map((e) => e.id)).toEqual(["d1", "p1", "d2", "d3"]);
      expect(full.hasMore).toBe(true);
      expect(full.nextCursor).toBe("2026-09-01T08:00:00.000Z");

      // Exactly the window: six rows, six asked for — nothing beyond, and the
      // seventh row that was NOT there is what a page-length inference would
      // have invented.
      const exact = await service(tables).getTimeline("r1", { limit: 6 });
      expect(exact.events).toHaveLength(6);
      expect(exact.hasMore).toBe(false);
      expect(exact.nextCursor).toBeNull();
    });

    it("applies `before` inclusively and keeps undated rows reachable on every page", async () => {
      const asked: Asked[] = [];
      const tables = {
        ...EMPTY,
        decision_log: [
          decision("newer", "2026-09-01T10:00:00.000Z"),
          decision("boundary", "2026-09-01T08:00:00.000Z"),
          decision("older", "2026-09-01T07:00:00.000Z"),
        ],
        procurement_documents: [document("undated", null)],
      };

      const page = await service(tables, asked).getTimeline("r1", {
        limit: 10,
        before: "2026-09-01T08:00:00.000Z",
      });

      // The boundary row is RE-READ (inclusive), the newer one is not, and the
      // undated row is still there — sorted last, never dropped.
      expect(page.events.map((e) => e.id)).toEqual([
        "boundary",
        "older",
        "undated",
      ]);
      expect(page.hasMore).toBe(false);
      for (const a of asked) {
        expect(a.or).toHaveLength(1);
        expect(a.or[0]).toMatch(
          /^[a-z_]+\.lte\.2026-09-01T08:00:00\.000Z,[a-z_]+\.is\.null$/,
        );
      }
    });

    it("normalises an offset cursor to UTC before splicing it into the filter", async () => {
      const asked: Asked[] = [];
      await service(EMPTY, asked).getTimeline("r1", {
        limit: 3,
        before: "2026-09-01T11:00:00+03:00",
      });
      expect(asked[0].or[0]).toContain(".lte.2026-09-01T08:00:00.000Z,");
    });

    it("says a page with no dated event cannot advance, rather than calling it the end", async () => {
      const tables = {
        ...EMPTY,
        procurement_documents: [
          document("u1", null),
          document("u2", null),
          document("u3", null),
        ],
      };
      const page = await service(tables).getTimeline("r1", { limit: 2 });
      expect(page.events).toHaveLength(2);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).toBeNull();
    });

    it("refuses a cursor that does not parse as a 400, never as page one", async () => {
      await expect(
        service(EMPTY).getTimeline("r1", { before: "yesterday" }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("echoes the clamp it applied, not the limit it was asked for", async () => {
      const page = await service(EMPTY).getTimeline("r1", { limit: 999 });
      expect(page.window).toBe(200);
    });
  });

  /**
   * ADR 0218 round 4 (founder round 6z, 2026-09-22), "Hide Away events from
   * staff (Recommended)": a colleague's Away being set or ended stays out of
   * a staff reader's /logs feed; owners and managers still read it, and
   * every other system_audit_log action stays open to staff. This is the
   * surface round 3's last call found still readable after `/house/away`
   * and `/settings-audit` were both closed (see ADR 0218, "What is still
   * readable, and is not a window").
   */
  describe("a staff reader of /logs never sees a colleague's Away being set or ended", () => {
    function auditRow(id: string, action: string): Row {
      return {
        id,
        restaurant_id: "r1",
        actor_type: "user",
        action,
        entity_type: "restaurant_member",
        entity_id: "user-2",
        reason: null,
        correlation_id: null,
        created_at: "2026-09-20T09:00:00Z",
      };
    }

    function withAudit(rows: Row[]) {
      return { ...EMPTY, system_audit_log: rows };
    }

    it("filters away_set_for_member and away_ended_for_member out of the query for a staff role", async () => {
      const asked: Asked[] = [];
      const client = makeFakeClient(
        withAudit([
          auditRow("a1", "away_set_for_member"),
          auditRow("a2", "away_ended_for_member"),
          auditRow("a3", "member_role_changed"),
        ]),
        asked,
      );
      const service = new LogsTimelineService({
        getClient: () => client,
      } as unknown as DatabaseService);

      const { events } = await service.getTimeline("r1", { role: "staff" });

      expect(events.map((e) => e.detail.action)).toEqual([
        "member_role_changed",
      ]);
    });

    it.each(["owner", "manager", "Owner", "MANAGER"])(
      "reads both Away actions for role %s",
      async (role) => {
        const client = makeFakeClient(
          withAudit([
            auditRow("a1", "away_set_for_member"),
            auditRow("a2", "away_ended_for_member"),
          ]),
        );
        const service = new LogsTimelineService({
          getClient: () => client,
        } as unknown as DatabaseService);

        const { events } = await service.getTimeline("r1", { role });

        expect(events.map((e) => e.detail.action).sort()).toEqual([
          "away_ended_for_member",
          "away_set_for_member",
        ]);
      },
    );

    it("withholds both Away actions when no role is given — fails closed, never open", async () => {
      const client = makeFakeClient(
        withAudit([auditRow("a1", "away_set_for_member")]),
      );
      const service = new LogsTimelineService({
        getClient: () => client,
      } as unknown as DatabaseService);

      const { events } = await service.getTimeline("r1");

      expect(events).toEqual([]);
    });

    it("withholds both Away actions for a role that is neither owner nor manager (admin, unknown)", async () => {
      for (const role of ["admin", "bogus", 42, null]) {
        const client = makeFakeClient(
          withAudit([auditRow("a1", "away_set_for_member")]),
        );
        const service = new LogsTimelineService({
          getClient: () => client,
        } as unknown as DatabaseService);

        const { events } = await service.getTimeline("r1", { role });

        expect(events).toEqual([]);
      }
    });

    it("leaves every other /logs action open to a staff reader", async () => {
      const client = makeFakeClient(
        withAudit([
          auditRow("a1", "house_area_changed"),
          auditRow("a2", "area_member_added"),
          auditRow("a3", "member_role_changed"),
        ]),
      );
      const service = new LogsTimelineService({
        getClient: () => client,
      } as unknown as DatabaseService);

      const { events } = await service.getTimeline("r1", { role: "staff" });

      expect(events.map((e) => e.detail.action).sort()).toEqual([
        "area_member_added",
        "house_area_changed",
        "member_role_changed",
      ]);
    });

    // The window is `limit + 1` rows per source. Were the Away rows dropped
    // AFTER that read, a staff page whose newest audit rows were all Away
    // would come back empty with `hasMore: false` — the feed would end while
    // older rows still existed. Filtered in the query, the window is filled
    // with rows the reader may see, and `hasMore` still measures what is left.
    it("fills a staff page's window with rows it may see — Away rows never crowd the window or end the feed early", async () => {
      const at = (id: string, action: string, createdAt: string): Row => ({
        ...auditRow(id, action),
        created_at: createdAt,
      });
      const client = makeFakeClient(
        withAudit([
          at("away-3", "away_set_for_member", "2026-09-20T12:00:00Z"),
          at("away-2", "away_ended_for_member", "2026-09-20T11:00:00Z"),
          at("away-1", "away_set_for_member", "2026-09-20T10:00:00Z"),
          at("other-3", "member_role_changed", "2026-09-20T09:00:00Z"),
          at("other-2", "house_area_changed", "2026-09-20T08:00:00Z"),
          at("other-1", "member_role_changed", "2026-09-20T07:00:00Z"),
        ]),
      );
      const service = new LogsTimelineService({
        getClient: () => client,
      } as unknown as DatabaseService);

      const page = await service.getTimeline("r1", { role: "staff", limit: 2 });

      expect(page.events.map((e) => e.id)).toEqual(["other-3", "other-2"]);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).toBe("2026-09-20T08:00:00Z");
    });
  });
});
