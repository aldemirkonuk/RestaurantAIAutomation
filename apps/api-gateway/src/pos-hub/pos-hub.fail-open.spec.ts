import { PosHubService } from "./pos-hub.service";

/**
 * Two write-side instances of "absence read as health", proven against the code
 * as it stood on 2026-09-01. Each test fails before its fix — a regression test
 * that passes beforehand guards nothing (`pos-hub.correctness.spec.ts`).
 *
 * Both share one root cause that is easy to miss and easy to repeat:
 * **supabase-js RESOLVES with `{ data, error }` on a database error rather than
 * throwing.** So `const { data } = await …` discards the error, a wrapping
 * try/catch never fires, and the caller cannot distinguish "the query found
 * nothing" from "the query failed".
 *
 * They differ in what that costs, and the distinction is worth keeping:
 *
 *   loadTables       → writes a WRONG row (`table_id: null`) and reports success.
 *                      Corrupt, but enumerable: you can query for the nulls.
 *   recordConsumption → writes NO row at all. Silent OMISSION — nothing records
 *                      that the event failed to land, so the damage cannot be
 *                      enumerated, bounded, or repaired, while every aggregate
 *                      over the ledger under-counts. Worse to remediate, not less.
 *
 * Production damage from both was measured before fixing (2026-09-01):
 * `pos_checks` with a null `table_id` = 0 of 66, `wine_consumption_log` = 0 rows.
 * Zero — because the mapping table is empty, so these paths have barely run. That
 * is the reason to fix them now rather than a reason to wait: "it never fires
 * today" is itself an absence-as-health argument.
 */

type Row = Record<string, any>;

/**
 * `failing` names the tables whose SELECT/UPSERT resolves with an error, exactly
 * as PostgREST does — never throwing, which is the whole trap.
 */
function makeDb(failing: Set<string>, sink: { consumption: Row[] } = { consumption: [] }) {
  const checkRows: Row[] = [];
  const err = (t: string) =>
    failing.has(t)
      ? { code: "57014", message: `statement timeout on ${t}`, details: null }
      : null;

  const client: any = {
    from(table: string) {
      const q: any = {
        _t: table,
        select: () => q,
        eq: () => q,
        in: () => q,
        is: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: null, error: err(table) }),
        single: async () => ({ data: { id: "x" }, error: err(table) }),
        upsert: async (row: Row) => {
          const e = err(table);
          if (!e) {
            if (table === "pos_checks") checkRows.push(row);
            if (table === "wine_consumption_log") sink.consumption.push(row);
          }
          return { data: null, error: e };
        },
        insert: async () => ({ data: null, error: err(table) }),
        update: () => q,
      };
      // A resolved list read: `await q` must yield {data, error}.
      q.then = (res: any) =>
        res({ data: err(table) ? null : [], error: err(table) });
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
  return { client, checkRows, sink };
}

const svc = (client: any) =>
  new PosHubService({ getClient: () => client, supabase: client } as any);

const CHECK = {
  externalCheckId: "chk-1",
  tableRef: "T1",
  openedAt: "2026-09-01T18:00:00.000Z",
  closedAt: null,
  voided: false,
  items: [],
  raw: null,
};

describe("pos-hub write paths must not read a failed query as an empty one", () => {
  it("does not report a clean ingest when the table lookup failed", async () => {
    // BEFORE THE FIX: `loadTables` discards `error` and returns [], so every
    // check resolves table_id: null and the ingest reports success with zero
    // errors — indistinguishable from a restaurant that has no tables. That is
    // the mechanism which manufactures the very "table_id is 0 of N" symptom
    // the POS bridge was diagnosed on.
    const { client } = makeDb(new Set(["restaurant_tables"]));
    const result: any = await (svc(client) as any).ingest(
      "r-1",
      "generic_webhook",
      [CHECK],
    );

    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.errors.join(" ")).toMatch(/restaurant_tables|table/i);
  });

  it("still ingests when only the table lookup failed — degrade, do not 500", async () => {
    // The fix must not overcorrect: a failed enrichment lookup should be SAID,
    // not turned into a rejected webhook the POS will retry forever.
    const { client } = makeDb(new Set(["restaurant_tables"]));
    const result: any = await (svc(client) as any).ingest(
      "r-1",
      "generic_webhook",
      [CHECK],
    );
    expect(result.upserted).toBe(1);
  });

  it("reports a clean ingest when the table lookup genuinely returns nothing", async () => {
    // The other half of the same coin: an empty result is NOT an error, and must
    // not be reported as one. Without this, the fix above would trade a silent
    // failure for a permanent false alarm.
    const { client } = makeDb(new Set());
    const result: any = await (svc(client) as any).ingest(
      "r-1",
      "generic_webhook",
      [CHECK],
    );
    expect(result.errors).toEqual([]);
    expect(result.upserted).toBe(1);
  });
});

describe("recordConsumption must not silently omit a row", () => {
  it("surfaces a failed consumption upsert instead of dropping it", async () => {
    // BEFORE THE FIX: the upsert result is discarded entirely and the wrapping
    // try/catch is inert (supabase-js resolves rather than throws), so a failed
    // write vanishes. The comment directly above that call says "Drifting the
    // invisible one is the worse failure" — the code did not guard the risk it
    // names.
    const { client } = makeDb(new Set(["wine_consumption_log"]));
    const s = svc(client);
    const warn = jest.spyOn((s as any).logger, "warn").mockImplementation(() => undefined);
    const error = jest.spyOn((s as any).logger, "error").mockImplementation(() => undefined);

    await (s as any).recordConsumption(
      "r-1",
      { inventory_id: "inv-1", name: "Test Wine" },
      1,
      "bottle",
      750,
      12.5,
      "pos:chk-1:1",
    );

    const said = [...warn.mock.calls, ...error.mock.calls].flat().join(" ");
    expect(said).toMatch(/wine_consumption_log|consumption/i);
    expect(said).toMatch(/57014|statement timeout/i);
  });

  it("stays quiet when the consumption write succeeds", async () => {
    const sink = { consumption: [] as Row[] };
    const { client } = makeDb(new Set(), sink);
    const s = svc(client);
    const error = jest.spyOn((s as any).logger, "error").mockImplementation(() => undefined);

    await (s as any).recordConsumption(
      "r-1",
      { inventory_id: "inv-1", name: "Test Wine" },
      1,
      "bottle",
      750,
      12.5,
      "pos:chk-2:1",
    );

    expect(sink.consumption).toHaveLength(1);
    expect(error).not.toHaveBeenCalled();
  });
});
