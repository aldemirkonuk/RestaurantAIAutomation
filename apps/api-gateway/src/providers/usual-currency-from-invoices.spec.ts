/**
 * VEN-W13 (founder, 2026-10-01): "write auto and when other currencies are
 * discovere then use option 1", "3 invoices", "Person's value stays, sheet
 * shows the clash", "Keep it, switch to the one-tap offer".
 *
 * The pure rules first, then the read-and-write against a recording stub, so
 * the house scoping and the guarded write are asserted as the queries they are.
 */
import {
  decideUsualCurrency,
  INVOICES_TO_WRITE,
  learnUsualCurrencyFromInvoices,
  printedCurrencyOf,
  readInvoiceCurrencyEvidence,
  type InvoiceCurrencyEvidence,
} from "./usual-currency-from-invoices";
import { vendorCurrencySentence } from "./vendor-currency";

const inv = (...codes: (string | null)[]): InvoiceCurrencyEvidence[] =>
  codes.map((code) => ({ code, restated: false }));
const nothing = { code: null, source: null, invoiceCount: null } as const;

describe("printedCurrencyOf — only what the page printed", () => {
  it("takes the model's sighting", () => {
    expect(printedCurrencyOf({ seenCode: "usd" })).toBe("USD");
  });
  it("takes the file's own code when no model looked (EDI CUR02)", () => {
    expect(printedCurrencyOf({ filedKind: "file", filedCode: "EUR" })).toBe("EUR");
  });
  it("never counts a code filed from the order or the house", () => {
    expect(printedCurrencyOf({ filedKind: "house", filedCode: "TRY" })).toBeNull();
    expect(printedCurrencyOf({ filedKind: "order", filedCode: "TRY" })).toBeNull();
  });
  it("leaves out a document whose sighting disagrees with its own file", () => {
    expect(
      printedCurrencyOf({ seenCode: "EUR", filedKind: "file", filedCode: "USD" }),
    ).toBeNull();
  });
  it("refuses a code that is not a currency", () => {
    expect(printedCurrencyOf({ seenCode: "ZZZ" })).toBeNull();
  });
});

describe("decideUsualCurrency — the write", () => {
  it(`writes at ${INVOICES_TO_WRITE} agreeing invoices when nothing is on file`, () => {
    const d = decideUsualCurrency({ evidence: inv("USD", "USD", "USD"), onFile: nothing });
    expect(d.write).toEqual({ code: "USD", invoiceCount: 3 });
  });
  it("does not write at 2", () => {
    const d = decideUsualCurrency({ evidence: inv("USD", "USD"), onFile: nothing });
    expect(d.write).toBeNull();
    expect(d.state).toBe("E");
  });
  it("does not write when any counted invoice disagrees (state B)", () => {
    const d = decideUsualCurrency({
      evidence: inv("USD", "USD", "USD", "EUR"),
      onFile: nothing,
    });
    expect(d.write).toBeNull();
    expect(d.state).toBe("B");
    expect(d.counts).toEqual([
      { code: "USD", invoices: 3 },
      { code: "EUR", invoices: 1 },
    ]);
  });
  it("leaves a restated invoice out of the count entirely", () => {
    const d = decideUsualCurrency({
      evidence: [
        { code: "USD", restated: true },
        { code: "USD", restated: false },
        { code: "USD", restated: false },
      ],
      onFile: nothing,
    });
    expect(d.write).toBeNull();
    expect(d.counted).toBe(2);
    // ...and a restated disagreement no longer blocks the write.
    const e = decideUsualCurrency({
      evidence: [{ code: "EUR", restated: true }, ...inv("USD", "USD", "USD")],
      onFile: nothing,
    });
    expect(e.write).toEqual({ code: "USD", invoiceCount: 3 });
  });
  it("ignores invoices that printed no currency", () => {
    const d = decideUsualCurrency({
      evidence: inv(null, "USD", null, "USD", "USD"),
      onFile: nothing,
    });
    expect(d.write).toEqual({ code: "USD", invoiceCount: 3 });
  });
  it("NEVER writes over a person's value", () => {
    const d = decideUsualCurrency({
      evidence: inv("EUR", "EUR", "EUR"),
      onFile: { code: "USD", source: "person", invoiceCount: null },
    });
    expect(d.write).toBeNull();
    expect(d.state).toBe("C");
  });
  it("never writes over a code that is not a currency either", () => {
    const d = decideUsualCurrency({
      evidence: inv("EUR", "EUR", "EUR"),
      onFile: { code: "ZZZ", source: "person", invoiceCount: null },
    });
    expect(d.write).toBeNull();
  });
});

describe("decideUsualCurrency — the five sheet states", () => {
  it("A: invoice-written, nothing disagrees; refreshes a grown count", () => {
    const d = decideUsualCurrency({
      evidence: inv("USD", "USD", "USD", "USD"),
      onFile: { code: "USD", source: "invoices", invoiceCount: 3 },
    });
    expect(d.state).toBe("A");
    expect(d.refreshCount).toBe(4);
    expect(d.write).toBeNull();
  });
  it("D: invoice-written, a later invoice disagrees — the value stays", () => {
    const d = decideUsualCurrency({
      evidence: inv("EUR", "USD", "USD", "USD"),
      onFile: { code: "USD", source: "invoices", invoiceCount: 3 },
    });
    expect(d.state).toBe("D");
    expect(d.write).toBeNull();
    expect(d.refreshCount).toBeNull();
  });
  it("C: a person's value, the newest invoices print another code", () => {
    const d = decideUsualCurrency({
      evidence: inv("EUR", "EUR", "EUR", "USD"),
      onFile: { code: "USD", source: "person", invoiceCount: null },
    });
    expect(d.state).toBe("C");
    expect(d.clash).toEqual({ code: "EUR", lastInvoices: 3 });
  });
  it("not C when the newest invoice agrees with the person, whatever came before", () => {
    const d = decideUsualCurrency({
      evidence: inv("USD", "EUR", "EUR"),
      onFile: { code: "USD", source: "person", invoiceCount: null },
    });
    expect(d.state).toBe("stated");
  });
  it("a row from before the source column reads as a person's", () => {
    const d = decideUsualCurrency({
      evidence: inv("EUR"),
      onFile: { code: "USD", source: null, invoiceCount: null },
    });
    expect(d.state).toBe("C");
    expect(d.clash).toEqual({ code: "EUR", lastInvoices: 1 });
  });
  it("E: nothing on file, too few", () => {
    expect(decideUsualCurrency({ evidence: inv("USD"), onFile: nothing }).state).toBe("E");
    expect(decideUsualCurrency({ evidence: [], onFile: nothing }).state).toBe("E");
  });
});

describe("vendorCurrencySentence — the sketch's words", () => {
  const say = (
    evidence: InvoiceCurrencyEvidence[],
    onFile: { code: string | null; source: "person" | "invoices" | null; invoiceCount: number | null },
  ) =>
    vendorCurrencySentence({
      code: onFile.code,
      source: onFile.source,
      invoiceCount: onFile.invoiceCount,
      vendorName: "ALDEMIR DISTRIBUTION",
      setByName: "Aldemir Konuk",
      decision: decideUsualCurrency({ evidence, onFile }),
    });

  it("A", () => {
    expect(
      say(inv("USD", "USD", "USD", "USD"), { code: "USD", source: "invoices", invoiceCount: 4 }),
    ).toBe(
      "All 4 invoices from ALDEMIR DISTRIBUTION were printed in USD, so orders to them start in USD. You can change it on the order.",
    );
  });
  it("B", () => {
    expect(say(inv("USD", "EUR", "USD", "USD"), nothing)).toBe(
      "Their invoices disagree: 3 printed in USD, 1 in EUR. Choose the one they usually invoice in; your name goes on it.",
    );
  });
  it("C", () => {
    expect(
      say(inv("EUR", "EUR", "EUR"), { code: "USD", source: "person", invoiceCount: null }),
    ).toBe("Their last 3 invoices were printed in EUR. USD stays until someone switches it.");
  });
  it("D", () => {
    expect(
      say(inv("EUR", "USD", "USD", "USD"), { code: "USD", source: "invoices", invoiceCount: 3 }),
    ).toBe(
      "A later invoice was printed in EUR. Orders still start in USD; choose which one they usually invoice in.",
    );
  });
  it("E", () => {
    expect(say(inv("USD"), nothing)).toBe(
      "1 invoice so far, printed in USD. After 2 more in the same currency it is filled in for you — or choose it now.",
    );
    expect(say([], nothing)).toContain("No invoice from ALDEMIR DISTRIBUTION has printed a currency yet.");
  });
  it("a person's value nothing contradicts keeps the person's sentence", () => {
    const s = say(inv("USD"), { code: "USD", source: "person", invoiceCount: null });
    expect(s).toContain("Stated by Aldemir Konuk");
  });
  it("an invoice-written value never names a person", () => {
    const s = say(inv("USD", "USD", "USD"), { code: "USD", source: "invoices", invoiceCount: 3 });
    expect(s).not.toMatch(/Stated by/);
  });
});

/* ------------------------------------------------------------------------ */

type Call = { table: string; ops: [string, unknown[]][] };
function stub(answers: Record<string, { data: unknown; error: unknown }[]>) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const q: any = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === "then") {
              const next = (answers[table] ?? []).shift() ?? { data: null, error: null };
              return (res: (v: unknown) => void) => res(next);
            }
            return (...args: unknown[]) => {
              call.ops.push([prop, args]);
              return q;
            };
          },
        },
      );
      return q;
    },
  };
  return { client, calls };
}
const has = (c: Call, op: string, ...args: unknown[]) =>
  c.ops.some(([o, a]) => o === op && JSON.stringify(a) === JSON.stringify(args));

const docs = (codes: string[]) =>
  codes.map((code, i) => ({
    id: `d${i}`,
    doc_number: `N${i}`,
    doc_date: `2026-09-${String(20 - i).padStart(2, "0")}`,
    status: "received",
    seen_code: code,
    filed_kind: "house",
    filed_code: null,
  }));

describe("readInvoiceCurrencyEvidence — house-scoped, invoices only", () => {
  it("filters documents and the restatement log by house", async () => {
    const { client, calls } = stub({
      procurement_documents: [{ data: docs(["USD", "USD"]), error: null }],
      procurement_document_currency_changes: [
        { data: [{ document_id: "d0", change_kind: "restated" }], error: null },
      ],
    });
    const ev = await readInvoiceCurrencyEvidence(client, "house-1", "vendor-1");
    const [d, c] = calls;
    expect(has(d, "eq", "restaurant_id", "house-1")).toBe(true);
    expect(has(d, "eq", "provider_id", "vendor-1")).toBe(true);
    expect(has(d, "eq", "doc_type", "invoice")).toBe(true);
    expect(has(c, "eq", "restaurant_id", "house-1")).toBe(true);
    expect(ev).toEqual([
      { code: "USD", restated: true },
      { code: "USD", restated: false },
    ]);
  });
  it("counts one invoice number once, and skips rejected paper", async () => {
    const rows = docs(["USD", "USD", "USD"]);
    rows[1].doc_number = "N0";
    rows[2].status = "rejected";
    const { client } = stub({
      procurement_documents: [{ data: rows, error: null }],
      procurement_document_currency_changes: [{ data: [], error: null }],
    });
    expect(await readInvoiceCurrencyEvidence(client, "h", "v")).toHaveLength(1);
  });
  it("a failed read throws — it is never 'no invoices'", async () => {
    const { client } = stub({
      procurement_documents: [{ data: null, error: { message: "down" } }],
    });
    await expect(readInvoiceCurrencyEvidence(client, "h", "v")).rejects.toThrow("down");
  });
});

describe("learnUsualCurrencyFromInvoices — the guarded write", () => {
  it("writes as the invoices, with no person, only where nothing is on file", async () => {
    const { client, calls } = stub({
      providers: [
        { data: { usual_currency: null, usual_currency_source: null, usual_currency_invoice_count: null }, error: null },
        { data: [{ id: "v" }], error: null },
      ],
      procurement_documents: [{ data: docs(["USD", "USD", "USD"]), error: null }],
      procurement_document_currency_changes: [{ data: [], error: null }],
    });
    const out = await learnUsualCurrencyFromInvoices(client, "house-1", "v");
    expect(out).toEqual({ kind: "written", code: "USD", invoiceCount: 3 });
    const write = calls.filter((c) => c.table === "providers")[1];
    const [, [payload]] = write.ops.find(([o]) => o === "update")!;
    expect(payload).toMatchObject({
      usual_currency: "USD",
      usual_currency_set_by: null,
      usual_currency_source: "invoices",
      usual_currency_invoice_count: 3,
    });
    expect(has(write, "is", "usual_currency", null)).toBe(true);
    expect(has(write, "eq", "restaurant_id", "house-1")).toBe(true);
  });
  it("a person who wrote first wins: the guarded update matches nothing", async () => {
    const { client } = stub({
      providers: [
        { data: { usual_currency: null }, error: null },
        { data: [], error: null },
      ],
      procurement_documents: [{ data: docs(["USD", "USD", "USD"]), error: null }],
      procurement_document_currency_changes: [{ data: [], error: null }],
    });
    expect(await learnUsualCurrencyFromInvoices(client, "h", "v")).toEqual({ kind: "raced" });
  });
  it("writes nothing over a person's value", async () => {
    const { client, calls } = stub({
      providers: [{ data: { usual_currency: "EUR", usual_currency_source: "person" }, error: null }],
      procurement_documents: [{ data: docs(["USD", "USD", "USD"]), error: null }],
      procurement_document_currency_changes: [{ data: [], error: null }],
    });
    expect(await learnUsualCurrencyFromInvoices(client, "h", "v")).toEqual({ kind: "left", state: "C" });
    expect(calls.filter((c) => c.table === "providers")).toHaveLength(1);
  });
  it("never throws: a failed read comes back as a failure", async () => {
    const { client } = stub({
      providers: [{ data: null, error: { message: "boom" } }],
    });
    const out = await learnUsualCurrencyFromInvoices(client, "h", "v");
    expect(out.kind).toBe("failed");
  });
});
