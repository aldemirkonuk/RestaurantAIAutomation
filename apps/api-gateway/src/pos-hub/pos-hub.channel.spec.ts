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
 *   - a check that names a channel writes it;
 *   - a check that names none writes NO channel key, so a gateway deployed
 *     before the column exists never names it, and a re-send that says nothing
 *     leaves a stored channel alone;
 *   - a channel outside the vocabulary is counted and said, never folded into
 *     table service in silence (memory: absence reported as health).
 */

type Row = Record<string, any>;

function makeService() {
  const checkUpserts: Row[] = [];
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
          return { error: null };
        };
      }
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
  const db = { getClient: () => client } as unknown as DatabaseService;
  return { service: new PosHubService(db), checkUpserts };
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
    expect(said[0]).toContain("table service");
  });

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
