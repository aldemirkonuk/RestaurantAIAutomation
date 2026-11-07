import { DatabaseService } from "../database/database.service";
import { TableAnalyticsService } from "./table-analytics.service";

/**
 * ADR 0347 D4 / E9: POST /analytics/tables used to store `seats: 2` for any
 * table sent without a count (`Number(table.seats) || 2`). A seat count is
 * only ever one a person gave; anything else is NULL.
 */
function serviceCapturing() {
  const rows: Array<Record<string, unknown>> = [];
  const builder: Record<string, unknown> = {};
  builder.upsert = (row: Record<string, unknown>) => {
    rows.push(row);
    return builder;
  };
  builder.select = () => builder;
  builder.single = () => Promise.resolve({ data: rows[rows.length - 1], error: null });
  const db = {
    getClient: () => ({ from: () => builder }),
  } as unknown as DatabaseService;
  return { service: new TableAnalyticsService(db), rows };
}

describe("upsertTable never guesses seats (ADR 0347 D4, E9)", () => {
  it.each([[undefined], [null], [""], [0], [-3], ["abc"], [2.5]])(
    "stores NULL when seats is %p",
    async (seats) => {
      const { service, rows } = serviceCapturing();
      await service.upsertTable("h1", { label: "12", seats });
      expect(rows[0].seats).toBeNull();
    },
  );

  it("stores a count a person gave, as given", async () => {
    const { service, rows } = serviceCapturing();
    await service.upsertTable("h1", { label: "12", seats: "6" });
    expect(rows[0].seats).toBe(6);
  });
});
