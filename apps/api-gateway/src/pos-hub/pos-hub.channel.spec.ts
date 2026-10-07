import { PosHubService } from "./pos-hub.service";
import { DatabaseService } from "../database/database.service";

/**
 * ADR 0302 (AW24): a check carries its channel to `pos_checks.channel`.
 *
 * The analytics walk on Tuzlu Rüzgar (2026-10-03) found the street-fair
 * booth's checks scored as Kerem's table service, because no check carried a
 * channel at all. The founder ruled *"Own row, POS field (Recommended)"*.
 *
 * What the ingest owes, pinned here:
 *   - a check that names a channel the hub knows writes it;
 *   - a check that names none writes NO channel key, so a gateway deployed
 *     before the column exists still stores it, and a re-send that says
 *     nothing leaves a stored channel alone;
 *   - a channel outside the vocabulary is counted and said, never folded into
 *     table service in silence (memory: absence reported as health), and is
 *     never written as a channel: a re-send that names one leaves a stored
 *     channel alone, and the line says only that, not that anything was stored;
 *   - only the canonical feeds (generic_webhook, csv_import) name a channel:
 *     a Square, Clover or Toast `raw` is the provider's own object, so a
 *     top-level `channel` there is not read as one (ADR 0302 method 3).
 */

type Row = Record<string, any>;

function makeService(opts: { upsertError?: string } = {}) {
  const checkUpserts: Row[] = [];
  // What pos_checks holds, keyed as the ingest's onConflict is
  // (restaurant_id, source, external_check_id). PostgREST's upsert of one
  // object updates only the columns that object names, so a key the row
  // leaves out keeps its stored value: modelled by the merge below.
  const stored = new Map<string, Row>();
  const client: any = {
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        in: async () => ({ data: [], error: null }),
        then: (resolve: any, reject: any) =>
          Promise.resolve({ data: [], error: null }).then(resolve, reject),
      };
      if (table === "pos_checks") {
        q.upsert = async (row: Row) => {
          checkUpserts.push(row);
          if (opts.upsertError) return { error: { message: opts.upsertError } };
          const key = `${row.restaurant_id}|${row.source}|${row.external_check_id}`;
          stored.set(key, { ...(stored.get(key) ?? {}), ...row });
          return { error: null };
        };
      }
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
  const db = { getClient: () => client } as unknown as DatabaseService;
  const storedChannel = (id: string, source = "csv_import") =>
    stored.get(`r1|${source}|${id}`)?.channel ?? null;
  return { service: new PosHubService(db), checkUpserts, storedChannel };
}

// Open checks (no closedAt), so no stock effect runs: this spec is about the row.
const check = (id: string, extra: Row = {}) => ({
  externalCheckId: id,
  openedAt: "2026-08-22T16:00:00.000Z",
  closedAt: null,
  serverName: "Kerem",
  tableRef: "BOOTH",
  total: 4201.1,
  tip: 0,
  covers: null,
  items: [],
  ...extra,
});

describe("POS ingest writes the channel a check names (ADR 0302)", () => {
  it("a booth_event check from csv_import is stored with channel booth_event", async () => {
    const { service, checkUpserts } = makeService();
    const out = await service.ingest("r1", "csv_import", [
      check("TR-2026-08-22-BOOTH", { channel: "booth_event" }),
    ]);
    expect(out.upserted).toBe(1);
    expect(checkUpserts).toHaveLength(1);
    expect(checkUpserts[0].channel).toBe("booth_event");
  });

  it("a check that names no channel writes no channel key at all", async () => {
    const { service, checkUpserts } = makeService();
    await service.ingest("r1", "csv_import", [check("TR-1")]);
    expect(checkUpserts).toHaveLength(1);
    expect(
      Object.prototype.hasOwnProperty.call(checkUpserts[0], "channel"),
    ).toBe(false);
  });

  it("an unknown channel writes no key, is counted, and is said in errors", async () => {
    const { service, checkUpserts } = makeService();
    const out = await service.ingest("r1", "csv_import", [
      check("TR-2", { channel: "catering" }),
      check("TR-3", { channel: "catering" }),
    ]);
    expect(checkUpserts.every((r) => !("channel" in r))).toBe(true);
    expect(out.channels.unrecognised).toBe(2);
    const said = out.errors.filter((e) => e.startsWith("channel:"));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("2 checks");
    expect(said[0]).toContain('"catering"');
    expect(said[0]).toContain("not written as a channel");
    expect(said[0]).not.toContain("stored as");
  });

  // Audit at 28c59e9f8: the tally ran String() on whatever raw.channel held,
  // before the per-check try. String() on {"toString":1} throws "Cannot
  // convert object to primitive value", and on a deeply nested array a
  // RangeError, so one such check turned the whole import into a 400 and no
  // check in it was stored. A channel that is not text is unrecognised, said
  // under a fixed label (within the five-name cap), and never converted.
  const deeplyNested = () => {
    let v: unknown = "booth_event";
    for (let i = 0; i < 100_000; i++) v = [v];
    return v;
  };
  it.each([
    ['{"toString":1}', () => JSON.parse('{"toString":1}')],
    ["a 100,000-deep nested array", deeplyNested],
  ])(
    "a channel that is %s is counted as unrecognised and the rest of the import still lands",
    async (_label, value) => {
      const { service, checkUpserts } = makeService();
      const out = await service.ingest("r1", "csv_import", [
        check("TR-2026-08-22-BOOTH", { channel: "booth_event" }),
        check("TR-10", { channel: value() }),
      ]);
      expect(out.received).toBe(2);
      expect(out.upserted).toBe(2);
      expect(checkUpserts.map((r) => r.channel ?? null)).toEqual([
        "booth_event",
        null,
      ]);
      expect(out.channels).toEqual({
        booth_event: 1,
        table: 0,
        none: 0,
        unrecognised: 1,
      });
      const said = out.errors.filter((e) => e.startsWith("channel:"));
      expect(said).toHaveLength(1);
      expect(said[0]).toContain("1 check named");
      expect(said[0]).toContain("(a value that is not text)");
    },
  );

  it("values that are not text share one label beside the quoted names", async () => {
    const { service } = makeService();
    const out = await service.ingest("r1", "generic_webhook", [
      check("TR-11", { channel: "catering" }),
      check("TR-12", { channel: 7 }),
      check("TR-13", JSON.parse('{"channel":{"toString":1,"valueOf":1}}')),
    ]);
    expect(out.upserted).toBe(3);
    expect(out.channels.unrecognised).toBe(3);
    const said = out.errors.filter((e) => e.startsWith("channel:"));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('("catering", a value that is not text)');
    expect(said[0]).not.toContain("7");
  });

  it("a re-send that names an unknown channel leaves a stored booth_event in place", async () => {
    const { service, storedChannel } = makeService();
    await service.ingest("r1", "csv_import", [
      check("TR-2026-08-22-BOOTH", { channel: "booth_event" }),
    ]);
    expect(storedChannel("TR-2026-08-22-BOOTH")).toBe("booth_event");

    const out = await service.ingest("r1", "csv_import", [
      check("TR-2026-08-22-BOOTH", { channel: "catering", total: 4300 }),
    ]);
    expect(out.upserted).toBe(1);
    // The re-send landed (its total moved) and its channel did not.
    expect(storedChannel("TR-2026-08-22-BOOTH")).toBe("booth_event");
    expect(out.channels.unrecognised).toBe(1);
    const said = out.errors.filter((e) => e.startsWith("channel:"));
    expect(said).toHaveLength(1);
    // The line must not say the check became table service: it did not.
    expect(said[0]).not.toContain("stored as");
    expect(said[0]).toContain("not written as a channel");
  });

  it("a new check that names an unknown channel is stored with no channel", async () => {
    const { service, storedChannel } = makeService();
    await service.ingest("r1", "csv_import", [
      check("TR-7", { channel: "catering" }),
    ]);
    expect(storedChannel("TR-7")).toBeNull();
  });

  it("a refused or failed check that names an unknown channel is not said to be stored", async () => {
    const refused = makeService();
    const r = await refused.service.ingest("r1", "csv_import", [
      check("TR-8", { channel: "catering", closedAt: "03.10.2026" }),
    ]);
    expect(r.refusedUnreadableDate).toBe(1);
    expect(refused.checkUpserts).toHaveLength(0);
    expect(r.channels.unrecognised).toBe(1);
    const saidRefused = r.errors.filter((e) => e.startsWith("channel:"));
    expect(saidRefused).toHaveLength(1);
    expect(saidRefused[0]).not.toContain("stored as");

    const failed = makeService({ upsertError: "boom" });
    const f = await failed.service.ingest("r1", "csv_import", [
      check("TR-9", { channel: "catering" }),
    ]);
    expect(f.upserted).toBe(0);
    expect(f.errors).toContain("TR-9: boom");
    const saidFailed = f.errors.filter((e) => e.startsWith("channel:"));
    expect(saidFailed).toHaveLength(1);
    expect(saidFailed[0]).not.toContain("stored as");
  });

  it.each([
    ["square", { id: "sq-1", state: "OPEN", channel: "ONLINE" }],
    [
      "clover",
      {
        id: "clv-1",
        state: "open",
        channel: "Street Fair",
        lineItems: { elements: [] },
      },
    ],
    ["toast", { guid: "tst-1", channel: "TAKE_OUT" }],
  ])(
    "a %s order's own top-level channel key is not read as a channel name",
    async (provider, order) => {
      const { service, checkUpserts } = makeService();
      const out = await service.ingest("r1", provider, order);
      expect(out.received).toBe(1);
      expect(out.channels).toEqual({
        booth_event: 0,
        table: 0,
        none: 1,
        unrecognised: 0,
      });
      expect(out.errors.some((e) => e.startsWith("channel:"))).toBe(false);
      expect(checkUpserts.every((r) => !("channel" in r))).toBe(true);
    },
  );

  it("the import says how many checks named each channel", async () => {
    const { service } = makeService();
    const out = await service.ingest("r1", "csv_import", [
      check("TR-2026-08-22-BOOTH", { channel: "booth_event" }),
      check("TR-2026-08-23-BOOTH", { channel: " BOOTH_EVENT " }),
      check("TR-4", { channel: "table" }),
      check("TR-5"),
      check("TR-6", { channel: "catering" }),
    ]);
    expect(out.channels).toEqual({
      booth_event: 2,
      table: 1,
      none: 1,
      unrecognised: 1,
    });
  });

  it("an empty payload still reports the channel tally, all zero", async () => {
    const { service } = makeService();
    const out = await service.ingest("r1", "csv_import", { nonsense: true });
    expect(out.channels).toEqual({
      booth_event: 0,
      table: 0,
      none: 0,
      unrecognised: 0,
    });
  });
});
