/**
 * The price_moved producer (r109 g4): one notification per verified paper that
 * moved a price, to owners and managers only, once.
 *
 * Reads go through a small table-backed client that models the operators the
 * producer and `readLastPrintedPrices` use, including the embedded
 * `procurement_document_lines!inner` filter, so the compare runs the real
 * price-move.ts and the real last-other-paper basis.
 */
import { PriceMovedProducer } from "./price-moved.producer";
import { ProducerLedgerService } from "./producer-ledger.service";
import { FakeDb, fakeDatabase, fakeNotifications } from "./testing/fake-db";

const TENANT = "rest-1";
const OTHER = "rest-2";
const OWNER = "u-owner";
const MANAGER = "u-manager";
const STAFF = "u-staff";
const MEMBERS = [OWNER, MANAGER, STAFF];
const ZONE = "America/New_York";
const AUDIENCE = { ready: [...MEMBERS], deferred: [] as string[] };
const NOW = new Date("2026-11-27T18:00:00Z");
const GOOD = "inv-red";

type Row = Record<string, any>;

class Q {
  private f: Array<(r: Row) => boolean> = [];
  private nested: Array<(l: Row) => boolean> = [];
  private lim: number | null = null;
  private ord: { col: string; asc: boolean } | null = null;
  constructor(private rows: Row[]) {}
  select() { return this; }
  private add(col: string, test: (v: any) => boolean) {
    if (col.startsWith("procurement_document_lines."))
      this.nested.push((l) => test(l[col.split(".")[1]]));
    else this.f.push((r) => test(r[col]));
    return this;
  }
  eq(c: string, v: any) { return this.add(c, (x) => x === v); }
  neq(c: string, v: any) { return this.add(c, (x) => x !== v); }
  ilike(c: string, v: string) { return this.add(c, (x) => String(x ?? "").toLowerCase() === v.toLowerCase()); }
  in(c: string, vs: any[]) { return this.add(c, (x) => vs.includes(x)); }
  gte(c: string, v: any) { return this.add(c, (x) => x != null && x >= v); }
  gt(c: string, v: any) { return this.add(c, (x) => Number(x) > v); }
  not(c: string, _op: string, v: string) {
    const set = v.replace(/[()]/g, "").split(",");
    return this.add(c, (x) => !set.includes(x));
  }
  or() { return this; }
  order(col: string, o?: { ascending?: boolean }) { this.ord = { col, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this.lim = n; return this; }
  private run() {
    let out = this.rows.filter((r) => this.f.every((t) => t(r)));
    if (this.nested.length) {
      out = out
        .map((r) => ({
          ...r,
          procurement_document_lines: (r.procurement_document_lines ?? []).filter((l: Row) =>
            this.nested.every((t) => t(l)),
          ),
        }))
        .filter((r) => r.procurement_document_lines.length > 0);
    }
    if (this.ord) {
      const { col, asc } = this.ord;
      out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
    }
    return this.lim == null ? out : out.slice(0, this.lim);
  }
  maybeSingle() { return Promise.resolve({ data: this.run()[0] ?? null, error: null }); }
  then(res: any, rej: any) { return Promise.resolve({ data: this.run(), error: null }).then(res, rej); }
}

function build() {
  const db = new FakeDb();
  const tables: Record<string, Row[]> = {
    procurement_documents: [],
    procurement_document_lines: [],
    providers: [{ id: "prov-1", name: "Anadolu Wines", restaurant_id: null }],
    restaurants: [{ id: TENANT, currency: "USD" }, { id: OTHER, currency: "USD" }],
    user_restaurant_access: [
      { restaurant_id: TENANT, user_id: OWNER, role: "owner", is_active: true },
      { restaurant_id: TENANT, user_id: MANAGER, role: "manager", is_active: true },
      { restaurant_id: TENANT, user_id: STAFF, role: "staff", is_active: true },
    ],
  };
  const client = {
    from(t: string) {
      // The lines live on their paper for the embedded read, flat for the list.
      if (t === "procurement_documents")
        return new Q(
          tables.procurement_documents.map((d) => ({
            ...d,
            procurement_document_lines: tables.procurement_document_lines.filter((l) => l.document_id === d.id),
          })),
        );
      return new Q(tables[t] ?? []);
    },
  };
  const notifications = fakeNotifications(MEMBERS);
  const ledger = new ProducerLedgerService(fakeDatabase(db, MEMBERS) as any, notifications as any);
  const producer = new PriceMovedProducer({ getClient: () => client } as any, ledger);
  return { tables, notifications, producer };
}

let n = 0;
function paper(t: Record<string, Row[]>, over: Row, lines: Row[]) {
  const id = over.id ?? `doc-${++n}`;
  t.procurement_documents.push({
    id, restaurant_id: TENANT, doc_type: "invoice", doc_number: "4471", provider_id: "prov-1",
    currency: "USD", status: "verified", verified_at: "2026-11-27T10:00:00Z", ...over,
  });
  lines.forEach((l, i) =>
    t.procurement_document_lines.push({
      document_id: id, restaurant_id: over.restaurant_id ?? TENANT, line_no: i + 1,
      inventory_id: GOOD, description: "House Red", qty_bottles: 12, uom: "bottle", ...l,
    }),
  );
  return id;
}
/** An earlier verified paper that priced the good at 5.00 a bottle. */
const earlier = (t: Record<string, Row[]>, over: Row = {}) =>
  paper(t, { id: "doc-old", doc_number: "4400", verified_at: "2026-10-01T10:00:00Z", ...over }, [{ line_total: 60 }]);

const sent = (nn: any) => nn.persistForRestaurant.calls.map((c: any[]) => c[1]);
const audiences = (nn: any) => nn.persistForRestaurant.calls.map((c: any[]) => c[2]?.onlyUserIds);

describe("PriceMovedProducer", () => {
  it("says a move once, in the house's words, and opens the paper", async () => {
    const { tables, notifications, producer } = build();
    earlier(tables);
    paper(tables, { id: "doc-new" }, [{ line_total: 84 }]); // 7.00 a bottle vs 5.00
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const [row] = sent(notifications);
    expect(tally.emitted).toBeGreaterThan(0);
    expect(row.message).toBe("Anadolu Wines, invoice 4471: House Red up 40% (5.00 -> 7.00).");
    expect(row.actionUrl).toBe("/receipts?doc=doc-new");
    expect(row.type).toBe("price_change");
  });

  it("lists three lines, then 'and N more'", async () => {
    const { tables, notifications, producer } = build();
    const goods = ["a", "b", "c", "d", "e"];
    paper(tables, { id: "doc-old", verified_at: "2026-10-01T10:00:00Z" },
      goods.map((g) => ({ inventory_id: g, description: `Wine ${g}`, line_total: 60 })));
    paper(tables, { id: "doc-new" },
      goods.map((g) => ({ inventory_id: g, description: `Wine ${g}`, line_total: 84 })));
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(sent(notifications)[0].message).toBe(
      "Anadolu Wines, invoice 4471: Wine a up 40% (5.00 -> 7.00), Wine b up 40% (5.00 -> 7.00), Wine c up 40% (5.00 -> 7.00), and 2 more.",
    );
  });

  it("[REVERT-FAILS] no move, or a move under the threshold, writes nothing", async () => {
    const { tables, notifications, producer } = build();
    earlier(tables);
    paper(tables, { id: "doc-same" }, [{ line_total: 60 }]);
    paper(tables, { id: "doc-small", verified_at: "2026-11-27T11:00:00Z" }, [{ line_total: 63 }]); // 5 percent
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(sent(notifications)).toHaveLength(0);
    expect(tally.emitted).toBe(0);
  });

  it("[REVERT-FAILS] another house's paper, and a paper in another money, are not compared", async () => {
    const { tables, notifications, producer } = build();
    earlier(tables);
    paper(tables, { id: "theirs", restaurant_id: OTHER }, [{ line_total: 84 }]);
    paper(tables, { id: "lira", currency: "TRY", verified_at: "2026-11-27T11:00:00Z" }, [{ line_total: 84 }]);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(sent(notifications)).toHaveLength(0);
  });

  it("[REVERT-FAILS] a re-run writes nothing", async () => {
    const { tables, notifications, producer } = build();
    earlier(tables);
    paper(tables, { id: "doc-new" }, [{ line_total: 84 }]);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const first = sent(notifications).length;
    const second = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(first).toBeGreaterThan(0);
    expect(sent(notifications)).toHaveLength(first);
    expect(second.emitted).toBe(0);
    expect(second.alreadyClaimed).toBeGreaterThan(0);
  });

  it("[REVERT-FAILS] staff are never in the audience", async () => {
    const { tables, notifications, producer } = build();
    earlier(tables);
    paper(tables, { id: "doc-new" }, [{ line_total: 84 }]);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const who = audiences(notifications).flat();
    expect(who.length).toBeGreaterThan(0);
    expect(who).not.toContain(STAFF);
    expect(new Set(who)).toEqual(new Set([OWNER, MANAGER]));
  });
});
