import { NotFoundException } from "@nestjs/common";
import { OneTapActionsService } from "./one-tap-actions.service";

/**
 * Tenancy isolation on one-tap actions.
 *
 * Every by-id method used to take only an actionId and read restaurant_id off the
 * result to address the WebSocket broadcast — so any caller holding a UUID could
 * read, execute or delete another restaurant's action. These tests assert the
 * filter is in the QUERY, not applied after the row comes back.
 */

type Captured = { table: string; filters: Record<string, unknown> };

/** Supabase stub that records the filters each query applied. */
function makeDb(row: Record<string, unknown> | null) {
  const captured: Captured[] = [];

  const client: any = {
    from(table: string) {
      const entry: Captured = { table, filters: {} };
      captured.push(entry);
      const q: any = {
        select: () => q,
        insert: () => q,
        update: () => q,
        is: (col: string, v: unknown) => {
          entry.filters[col] = v;
          return q;
        },
        eq: (col: string, v: unknown) => {
          entry.filters[col] = v;
          return q;
        },
        order: () => q,
        // A query filtered to a restaurant that does not own the row finds nothing,
        // which is what a scoped query does in Postgres.
        single: async () => {
          const wanted = entry.filters["restaurant_id"];
          if (wanted != null && row && row.restaurant_id !== wanted)
            return { data: null, error: { message: "no rows" } };
          return row
            ? { data: row, error: null }
            : { data: null, error: { message: "no rows" } };
        },
      };
      return q;
    },
  };

  return { db: { getClient: () => client } as any, captured };
}

const ACTION = {
  id: "act-1",
  restaurant_id: "rest-A",
  user_id: "u1",
  action_type: "custom",
  title: "Reorder Barolo",
  status: "pending",
  priority: "medium",
  created_at: new Date().toISOString(),
};

const ws = { emitRestaurantNotification: () => {}, server: null } as any;

function svc(row: Record<string, unknown> | null) {
  const { db, captured } = makeDb(row);
  return { service: new OneTapActionsService(db, ws), captured };
}

describe("one-tap actions tenancy", () => {
  it("scopes getAction by restaurant_id in the query", async () => {
    const { service, captured } = svc(ACTION);

    await service.getAction("act-1", "rest-A");

    expect(captured[0].filters).toMatchObject({
      id: "act-1",
      restaurant_id: "rest-A",
    });
  });

  it("refuses to return another restaurant's action", async () => {
    // The hole this closes: previously getAction(actionId) with no scope returned
    // any action to any caller holding its UUID.
    const { service } = svc(ACTION);

    await expect(service.getAction("act-1", "rest-B")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("reports a foreign action as 404, not 403", async () => {
    // 403 would confirm the UUID is real — information a caller should not get
    // from an id they should not have.
    const { service } = svc(ACTION);

    await expect(service.getAction("act-1", "rest-B")).rejects.toThrow(
      /not found/i,
    );
  });

  it("refuses to execute another restaurant's action", async () => {
    const { service } = svc(ACTION);

    await expect(
      service.executeAction("act-1", "rest-B", "u9", {} as any),
    ).rejects.toThrow(NotFoundException);
  });

  it("refuses to delete another restaurant's action", async () => {
    const { service } = svc(ACTION);

    await expect(service.deleteAction("act-1", "rest-B")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("refuses to cancel another restaurant's action", async () => {
    const { service } = svc(ACTION);

    await expect(service.cancelAction("act-1", "rest-B")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("scopes the execute UPDATE by restaurant_id, not just the pre-check", async () => {
    // Defence in depth: the ownership check and the write must both be scoped, or
    // the write is one refactor away from touching any row.
    const { service, captured } = svc(ACTION);

    await service.executeAction("act-1", "rest-A", "u1", {} as any);

    const updates = captured.filter(
      (c) => c.filters["id"] === "act-1" && c.filters["restaurant_id"],
    );
    expect(updates.length).toBeGreaterThanOrEqual(2); // the read and the write
  });
});
