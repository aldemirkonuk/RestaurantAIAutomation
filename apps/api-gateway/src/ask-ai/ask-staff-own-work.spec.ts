import { ConfigService } from "@nestjs/config";
import { classRefusalLine } from "../ask-readings/bound-reply";
import { CLASS_LABEL, DataClass } from "../ask-readings/reading-data-classes";
import { Finding, QuestionClass } from "../ask-readings/reading.types";
import { ModelClientService } from "../common/model-client/model-client.service";
import { ReadingFolio } from "../ask-readings/reading-folio.store";
import { BoundAskService } from "./bound-ask.service";
import { BoundAskDto } from "./dto/bound-ask.dto";

/**
 * Founder, 2026-09-21, round 6. His picks, verbatim: "Yes, own-work only"
 * (staff on /ask) and "Hide by data type" (a Finding's trace counts). The
 * meaning of the first that he approved, verbatim: "Staff can ask about
 * stock, receiving and today's deliveries. Money, supplier prices and people
 * data are refused with a one-line reason. General-knowledge answers are
 * allowed but count toward the house's daily limit."
 *
 * These cases run the REAL BoundAskService, ReadingRunner, RecordingSession,
 * role-policy table and trace withholding against an in-memory book; only the
 * model (a stand-in that picks the class under test and focuses the first
 * cell) and the folio store are doubles. The last block also runs the REAL
 * ModelClientService against an in-memory ledger, so "counts toward the
 * house's daily limit" is measured by the same ledger read the gate makes.
 */

const HOUSE = "22222222-2222-4222-8222-222222222222";
const OTHER_HOUSE = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const today = () => new Date().toISOString().slice(0, 10);

type Row = Record<string, any>;
/** A filtering, paginating book, the same contract as reading-runner.spec.ts's. */
class Books {
  constructor(readonly tables: Record<string, Row[]>) {}
  from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let offset = 0, end = 999;
    const q: any = {
      select: () => q,
      eq: (k: string, v: any) => { filters.push(r => r[k] === v); return q; },
      is: (k: string, v: any) => { filters.push(r => r[k] === v); return q; },
      in: (k: string, v: any[]) => { filters.push(r => v.includes(r[k])); return q; },
      gte: (k: string, v: any) => { filters.push(r => r[k] != null && r[k] >= v); return q; },
      lt: (k: string, v: any) => { filters.push(r => r[k] != null && r[k] < v); return q; },
      order: () => q,
      range: (a: number, b: number) => { offset = a; end = b; return q; },
      then: (resolve: any, reject: any) => {
        const data = (this.tables[table] || []).filter(r => filters.every(f => f(r)))
          .sort((a, b) => String(a.id).localeCompare(String(b.id)));
        return Promise.resolve({ data: data.slice(offset, end + 1), count: data.length, error: null }).then(resolve, reject);
      },
    };
    return q;
  }
}

const house = (id: string, rest: Row = {}): Row => ({ id, restaurant_id: HOUSE, ...rest });
const order = (id: string, rest: Row = {}): Row => house(id, { order_number: id, status: "DELIVERED", inventory_id: "item-a",
  quantity: 2, unit_type: "CASE", expected_delivery_date: "2026-09-01", ...rest });
/** 41 house orders: one open and past, one open and due today, 39 received. */
const HOUSE_ORDER_COUNT = 41;
const books = () => new Books({
  restaurants: [{ id: HOUSE, threshold_configured: true }],
  restaurant_inventory: [
    house("item-a", { display_name: "Barolo", wine_name: "Barolo", uom: "bottle", stock_live: 2, shadow_stock: 0, in_transit_quantity: 6, threshold_min: 4, is_active: true, deleted_at: null }),
    house("item-b", { display_name: "Soave", wine_name: "Soave", uom: "bottle", stock_live: 20, shadow_stock: 0, in_transit_quantity: 0, threshold_min: 4, is_active: true, deleted_at: null }),
  ],
  procurement_orders: [
    order("PO-A", { status: "CONFIRMED" }),
    order("PO-TODAY", { status: "IN_TRANSIT", expected_delivery_date: today() }),
    ...Array.from({ length: HOUSE_ORDER_COUNT - 2 }, (_, i) => order(`PO-OLD-${String(i).padStart(2, "0")}`)),
    { ...order("PO-FOREIGN", { status: "IN_TRANSIT", expected_delivery_date: today() }), restaurant_id: OTHER_HOUSE },
  ],
  procurement_order_items: [
    house("line-1", { order_id: "PO-A", inventory_id: "item-a", wine_name: "Barolo", quantity: 2, unit_type: "case", bottles_per_unit: 6 }),
    house("line-2", { order_id: "PO-A", inventory_id: "item-b", wine_name: "Soave", quantity: 3, unit_type: "bottle", bottles_per_unit: 1 }),
  ],
  procurement_documents: [house("DN-7", { doc_type: "delivery_note", doc_number: "DN-7", doc_date: "2026-09-20", status: "needs_review", currency: "TRY" })],
});

const reply = (json: unknown, usage = { input_tokens: 1000, output_tokens: 1000 }) =>
  ({ content: [{ type: "text", text: JSON.stringify(json) }], usage });

function pendingFolio(utterance: string, restaurantId = HOUSE): ReadingFolio {
  return {
    id: "folio-1", restaurant_id: restaurantId, user_id: USER, request_id: "req-1", correlation_id: "folio-1", origin: "page", utterance,
    status: "pending", reading_id: null, reading_version: null, reading_args: {}, finding: null, reply_kind: null, answer: null,
    failure_reason: null, proposal_id: null, previous_folio_id: null, created_at: "2026-09-21T00:00:00.000Z", completed_at: null,
    asked_as_role: null, reading_chosen_by: "model", pick_class: null, pick_args: null, pick_model: null, pick_prompt_sha: null,
    compose_model: null, compose_prompt_sha: null, catalogue_sha: null, policy_sha: null,
  };
}

/** One ask, as `role`, that the stand-in model picks as `questionClass`. */
async function ask(role: string, questionClass: QuestionClass, utterance: string, subjectText?: string, book = books()) {
  const getClient = jest.fn(() => book);
  const call = jest.fn(async (opts: any) => {
    if (opts.nf.taskType === "ask_reading_pick") return reply({ questionClass, ...(subjectText ? { subjectText } : {}) });
    if (opts.nf.taskType === "ask_bound_caption") {
      const { cells } = JSON.parse(opts.body.messages[0].content);
      return reply({ kind: "reading", focus: [cells[0].id] });
    }
    return reply({ kind: "model_knowledge", text: "Barolo is a Nebbiolo wine." });
  });
  const folios = {
    begin: jest.fn(async () => ({ created: true, folio: pendingFolio(utterance) })),
    finish: jest.fn(async (folio: ReadingFolio, answer: any, finding?: Finding) => ({ ...folio, status: "complete", answer, finding: finding ?? null })),
  };
  const service = new BoundAskService({ getClient } as any, new ConfigService({ ASK_LAUNCHED: "true" }),
    { call, dailyShareOfAllowance: jest.fn() } as any, { record: jest.fn() } as any, folios as any);
  await service.submit(HOUSE, USER, role, { requestId: "req-1", utterance, origin: "page" } as BoundAskDto);
  const [, answer, finding] = folios.finish.mock.calls[0];
  return { answer, finding: finding as Finding | undefined, call, getClient };
}

describe("staff on /ask, own work only: each allowed class answers (founder, round 6)", () => {
  it.each([
    ["stock", "inventory.low_stock" as QuestionClass, "which wines are below par", undefined],
    ["receiving (an order's contents)", "orders.lines" as QuestionClass, "what is in order PO-A", "PO-A"],
    ["receiving (the document register)", "documents.waiting" as QuestionClass, "which documents are waiting", undefined],
    ["today's deliveries", "orders.due_today" as QuestionClass, "what is coming today", undefined],
  ])("%s: a staff ask is answered out of the books", async (_cls, questionClass, utterance, subjectText) => {
    const { answer, finding, getClient } = await ask("staff", questionClass, utterance, subjectText);
    expect(getClient).toHaveBeenCalled();
    expect(answer.kind).toBe("reading");
    expect(finding?.readingId).toBe(questionClass);
    expect(finding?.outcome).toBe("read");
  });

  it("today's deliveries shows staff the day's open order and nothing of the rest of the book", async () => {
    const { finding } = await ask("staff", "orders.due_today", "what is coming today");
    const cells = finding!.rows.flatMap(r => r.cells);
    expect(cells.find(c => c.key === "deliveries:count")?.value).toBe(1);
    expect(cells.find(c => c.key === "PO-TODAY:status")?.value).toBe("IN_TRANSIT");
    expect(JSON.stringify(finding!.rows)).not.toMatch(/PO-A|PO-OLD|PO-FOREIGN/);
    expect(cells.every(c => c.sourceRelations[0] === "procurement_orders@due_today")).toBe(true);
  });
});

describe("staff on /ask: each refused class refuses with a one-line reason naming it (founder, round 6)", () => {
  it.each([
    ["money", "goals.targets" as QuestionClass, ["money"]],
    ["money -- supplier prices on a receipt", "receipts.verified_line" as QuestionClass, ["money"]],
    ["the supplier order book", "orders.open" as QuestionClass, ["suppliers"]],
    ["the supplier order book, by past date", "orders.late_deliveries" as QuestionClass, ["suppliers"]],
    ["vendors", "vendors.active" as QuestionClass, ["suppliers"]],
    ["sales", "sales.check_activity" as QuestionClass, ["sales"]],
    ["people data", "calendar.upcoming" as QuestionClass, ["people"]],
  ])("%s: refused before any book is read, with its line", async (_name, questionClass, classes) => {
    const { answer, getClient, call } = await ask("staff", questionClass, "tell me");
    expect(answer).toEqual({ kind: "not_permitted", reason: "class_not_visible", readingId: questionClass, classes,
      line: classRefusalLine(classes as DataClass[]) });
    for (const cls of classes) expect(answer.line).toContain(CLASS_LABEL[cls as DataClass]);
    expect(answer.line).not.toMatch(/[\r\n]/);
    expect(getClient).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledTimes(1); // the pick only
  });

  it("the same questions reach the books for a manager", async () => {
    for (const questionClass of ["goals.targets", "calendar.upcoming", "orders.open"] as QuestionClass[]) {
      const { getClient } = await ask("manager", questionClass, "tell me");
      expect(getClient).toHaveBeenCalled();
    }
  });
});

describe("a Finding's trace hides by data type (founder, round 6, \"Hide by data type\")", () => {
  const bookCount = (finding: Finding) => finding.trace.filter(t => t.relation === "procurement_orders").map(t => t.matchedRows);

  it("staff asking what an order contains: the order book's count is withheld, said so, never 0", async () => {
    const { answer, finding } = await ask("staff", "orders.lines", "what is in order PO-A", "PO-A");
    expect(answer.kind).toBe("reading");
    expect(bookCount(finding!)).toEqual(["withheld_for_your_role"]);
    expect(finding!.trace.find(t => t.relation === "procurement_orders")!.outcome).toBe("withheld");
    // The lines' own count is receiving, which staff see.
    expect(finding!.trace.find(t => t.relation === "procurement_order_items")!.matchedRows).toBe(2);
    // The total would let the hidden count be subtracted out.
    expect(finding!.rowsScanned).toBe("withheld_for_your_role");
    // The reply carries the same withheld Finding the folio saves.
    expect(answer.finding).toBe(finding);
    const saved = JSON.stringify({ answer, finding });
    expect(saved).not.toContain(`"matchedRows":${HOUSE_ORDER_COUNT}`);
    expect(saved).not.toContain(`"rowsScanned":${HOUSE_ORDER_COUNT}`);
  });

  it("staff asking today's deliveries: the whole book's count is withheld too", async () => {
    const { finding } = await ask("staff", "orders.due_today", "what is coming today");
    expect(bookCount(finding!)).toEqual(["withheld_for_your_role"]);
    expect(finding!.rowsScanned).toBe("withheld_for_your_role");
  });

  // [2026-09-21, round 6 last call] A read pages 500 rows at a time and writes
  // one trace entry per page, so the NUMBER of withheld entries would still
  // say how many hundreds of orders the house has. One withheld entry per
  // relation, whatever the page count.
  it("a paged read of the order book leaves staff one withheld entry, not one per 500-row page", async () => {
    const bigBook = () => {
      const book = books();
      book.tables.procurement_orders.push(...Array.from({ length: 1000 }, (_, i) => order(`PO-BULK-${String(i).padStart(4, "0")}`)));
      return book;
    };
    const staff = await ask("staff", "orders.lines", "what is in order PO-A", "PO-A", bigBook());
    expect(staff.answer.kind).toBe("reading");
    expect(bookCount(staff.finding!)).toEqual(["withheld_for_your_role"]);
    const manager = await ask("manager", "orders.lines", "what is in order PO-A", "PO-A", bigBook());
    expect(bookCount(manager.finding!)).toEqual([HOUSE_ORDER_COUNT + 1000, HOUSE_ORDER_COUNT + 1000, HOUSE_ORDER_COUNT + 1000]);
  });

  it("a manager asking the same sees the house's order count in the trace", async () => {
    const { finding } = await ask("manager", "orders.lines", "what is in order PO-A", "PO-A");
    expect(bookCount(finding!)).toEqual([HOUSE_ORDER_COUNT]);
    expect(finding!.rowsScanned).toBe(HOUSE_ORDER_COUNT + 2);
  });

  it("a staff stock answer keeps every count: each relation it read is stock", async () => {
    const { finding } = await ask("staff", "inventory.low_stock", "which wines are below par");
    expect(finding!.trace.every(t => typeof t.matchedRows === "number")).toBe(true);
  });
});

describe("staff general knowledge counts toward the house's daily limit (real ModelClientService, in-memory ledger)", () => {
  type LedgerRow = { id: string; restaurant_id: string | null; subject_type: string; cost_usd: number | null; occurred_at: string; context: Record<string, unknown> };
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  function database(ledger: LedgerRow[]) {
    const from = (table: string) => {
      const filters: Array<(r: any) => boolean> = [];
      const q: any = {
        select: () => q,
        eq: (k: string, v: any) => {
          filters.push(k.startsWith("context->>") ? (r => r.context?.[k.slice("context->>".length)] === v) : (r => r[k] === v));
          return q;
        },
        gte: (k: string, v: any) => { filters.push(r => r[k] >= v); return q; },
        gt: (k: string, v: any) => { filters.push(r => r[k] > v); return q; },
        is: (k: string, v: any) => { filters.push(r => r[k] === v); return q; },
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: table === "restaurants" ? { subscription_tier: "pilot" } : null, error: null }),
        insert: (row: any) => {
          const stored = { id: `nf-${String(ledger.length + 1).padStart(4, "0")}`, occurred_at: new Date().toISOString(), ...row };
          ledger.push(stored);
          const done = { data: null, error: null };
          return { then: (res: any, rej: any) => Promise.resolve(done).then(res, rej), select: () => ({ single: async () => ({ data: { id: stored.id }, error: null }) }) };
        },
        then: (resolve: any) => resolve({ data: ledger.filter(r => filters.every(f => f(r))), error: null }),
      };
      return q;
    };
    return { supabase: { from } } as any;
  }

  /** A fresh gateway instance: its own spend cache, the shared ledger. */
  function gateway(ledger: LedgerRow[], ceilingUsd: string) {
    const config = new ConfigService({ ASK_LAUNCHED: "true", ANTHROPIC_API_KEY: "test-key", MODEL_DAILY_SPEND_CEILING_USD: ceilingUsd });
    const modelClient = new ModelClientService(config, database(ledger));
    const folios = {
      // The folio carries the house the ask was made in, as the real store's does.
      begin: jest.fn(async (input: { restaurantId: string }) => ({ created: true, folio: pendingFolio("what grape is Barolo made from", input.restaurantId) })),
      finish: jest.fn(async (folio: ReadingFolio, answer: any) => ({ ...folio, status: "complete", answer })),
    };
    const service = new BoundAskService({ getClient: jest.fn() } as any, config, modelClient, { record: jest.fn() } as any, folios as any);
    const askAs = async (restaurantId: string, role: string) => {
      folios.finish.mockClear();
      await service.submit(restaurantId, USER, role, { requestId: "req-1", utterance: "what grape is Barolo made from", origin: "page" } as BoundAskDto);
      await new Promise(resolve => setImmediate(resolve)); // let the fire-and-forget ledger rows land
      return folios.finish.mock.calls[0][1];
    };
    return { askAs };
  }

  beforeEach(() => {
    global.fetch = (async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      const json = String(body.system).startsWith("Select a Mudavym question class")
        ? { questionClass: "general_knowledge" }
        : { kind: "model_knowledge", text: "Nebbiolo." };
      return { ok: true, status: 200, json: async () => reply(json), headers: { get: () => null } } as any;
    }) as any;
  });

  it("a staff knowledge answer is written to the house's ledger, and the next ask in that house is refused once it passes the limit", async () => {
    const ledger: LedgerRow[] = [];
    // One pick (Haiku, $0.006 at 1000/1000 tokens) and one knowledge answer
    // (Sonnet 5, $0.012) is $0.018 -- past a $0.015 daily limit.
    const first = gateway(ledger, "0.015");
    expect((await first.askAs(HOUSE, "staff")).kind).toBe("model_knowledge");
    const staffRows = ledger.filter(r => r.restaurant_id === HOUSE && r.context.ask_policy_role === "staff");
    expect(staffRows.map(r => r.context.task_type).sort()).toEqual(["ask_model_knowledge", "ask_reading_pick"]);
    expect(staffRows.reduce((n, r) => n + (r.cost_usd || 0), 0)).toBeCloseTo(0.018, 6);

    // A second instance (its own 60-second spend cache) reads the same ledger:
    // the owner is refused on the staff member's spend, before any model call.
    const second = gateway(ledger, "0.015");
    const rowsBefore = ledger.length;
    expect(await second.askAs(HOUSE, "owner")).toEqual({ kind: "could_not_answer", reason: "spend_ceiling" });
    expect(ledger.length).toBe(rowsBefore);
    // Another house's allowance is untouched by it.
    expect((await second.askAs(OTHER_HOUSE, "owner")).kind).toBe("model_knowledge");
  });

  it("control: under the limit, the same staff spend does not refuse the next ask", async () => {
    const ledger: LedgerRow[] = [];
    await gateway(ledger, "1").askAs(HOUSE, "staff");
    expect((await gateway(ledger, "1").askAs(HOUSE, "owner")).kind).toBe("model_knowledge");
  });
});

/**
 * Founder, 2026-09-21, round 6r. His picks, verbatim: "J4 wins, hide size
 * (Recommended)" -- staff are told "no orders recorded yet" for an empty book,
 * and a book too large to read answers them only "couldn't read the order book
 * right now", never why; and "Classify now, forecast=sales (Recommended)" --
 * landed cost is money, sales revenue and a forecast are sales, so staff are
 * refused with the class's line instead of "not built".
 */
describe("round 6r, \"J4 wins, hide size\": what staff are told when the books do not answer", () => {
  const LIMIT = 20_000;
  const emptyBook = () => { const book = books(); book.tables.procurement_orders = []; return book; };
  const hugeBook = (table = "procurement_orders") => {
    const book = books();
    book.tables[table] = Array.from({ length: LIMIT + 1 }, (_, i) => table === "procurement_orders"
      ? order(`PO-HUGE-${String(i).padStart(5, "0")}`)
      : house(`item-${String(i).padStart(5, "0")}`, { display_name: `Wine ${i}`, wine_name: `Wine ${i}`, uom: "bottle",
        stock_live: 1, shadow_stock: 0, in_transit_quantity: 0, threshold_min: 4, is_active: true, deleted_at: null }));
    return book;
  };
  /** The order book answers with a database error instead of rows. */
  const failingBook = () => {
    const book = books();
    const from = book.from.bind(book);
    (book as any).from = (table: string) => {
      if (table !== "procurement_orders") return from(table);
      const q: any = new Proxy({}, { get: (_t, p) => p === "then"
        ? (resolve: any, reject: any) => Promise.resolve({ data: null, count: null, error: { code: "57014" } }).then(resolve, reject)
        : () => q });
      return q;
    };
    return book;
  };
  const saved = (r: { answer: unknown; finding?: Finding }) => JSON.stringify({ answer: r.answer, finding: r.finding });

  it("an empty order book: staff are told no orders are recorded yet, and are shown no zero", async () => {
    const staff = await ask("staff", "orders.due_today", "what is coming today", undefined, emptyBook());
    expect(staff.answer.kind).toBe("not_in_your_books");
    expect(staff.answer.reason).toBe("empty_register");
    expect(staff.answer.line).toBe("No orders recorded yet.");
    expect(staff.finding!.outcome).toBe("not_in_your_books");
    expect(staff.finding!.rows).toEqual([]);
    expect(saved(staff)).not.toMatch(/"value":0\b/);
    // The book's count stays withheld, as for any staff trace.
    expect(staff.finding!.trace.find(t => t.relation === "procurement_orders")!.matchedRows).toBe("withheld_for_your_role");
  });

  it("control: a manager asking the same keeps the measured zero and no line", async () => {
    const manager = await ask("manager", "orders.due_today", "what is coming today", undefined, emptyBook());
    expect(manager.answer.kind).toBe("not_in_your_books");
    expect(manager.answer.line).toBeUndefined();
    expect(manager.finding!.rows.flatMap(r => r.cells).find(c => c.key === "deliveries:count")?.value).toBe(0);
  });

  it.each([
    ["today's deliveries", "orders.due_today" as QuestionClass, undefined],
    ["an order's contents", "orders.lines" as QuestionClass, "PO-HUGE-00001"],
  ])("%s over the 20,000-row limit: staff are told only that the order book could not be read right now", async (_n, questionClass, subjectText) => {
    const staff = await ask("staff", questionClass, "what is coming today PO-HUGE-00001", subjectText, hugeBook());
    expect(staff.answer).toMatchObject({ kind: "could_not_read", reason: "withheld_for_your_role",
      line: "Couldn't read the order book right now." });
    expect(staff.finding!.reason).toBe("withheld_for_your_role");
    expect(staff.finding!.failedSources).toBe("withheld_for_your_role");
    expect(staff.finding!.rowsScanned).toBe("withheld_for_your_role");
    expect(staff.finding!.trace.length).toBeGreaterThan(0);
    expect(staff.finding!.trace.every(t => t.outcome === "withheld" && t.matchedRows === "withheld_for_your_role")).toBe(true);
    const text = saved(staff);
    expect(text).not.toContain("source_limit");
    expect(text).not.toContain(String(LIMIT + 1));
    expect(text).not.toContain("failureCode");
  });

  it("control: a manager over the same limit keeps the reason", async () => {
    const manager = await ask("manager", "orders.due_today", "what is coming today", undefined, hugeBook());
    expect(manager.answer.kind).toBe("could_not_read");
    expect(manager.answer.reason).toBe("source_limit");
    expect(manager.answer.line).toBeUndefined();
    expect(manager.finding!.reason).toBe("source_limit");
  });

  it("any staff-visible source: a stock register over the limit names the stock records, not a reason", async () => {
    const staff = await ask("staff", "inventory.low_stock", "which wines are below par", undefined, hugeBook("restaurant_inventory"));
    expect(staff.answer).toMatchObject({ kind: "could_not_read", reason: "withheld_for_your_role",
      line: "Couldn't read the stock records right now." });
    expect(saved(staff)).not.toContain("source_limit");
  });

  it("a book too large and a query that failed look the same to staff, fingerprint included", async () => {
    const huge = await ask("staff", "orders.due_today", "what is coming today", undefined, hugeBook());
    const failed = await ask("staff", "orders.due_today", "what is coming today", undefined, failingBook());
    const manager = await ask("manager", "orders.due_today", "what is coming today", undefined, failingBook());
    expect(manager.finding!.reason).toBe("query_failed");
    expect(failed.answer).toEqual({ ...huge.answer, finding: failed.finding });
    expect(failed.finding!.fingerprint).toBe(huge.finding!.fingerprint);
    expect(failed.finding!.failedSources).toBe(huge.finding!.failedSources);
    expect(failed.finding!.trace.map(t => [t.relation, t.outcome])).toEqual(huge.finding!.trace.map(t => [t.relation, t.outcome]));
    expect(manager.finding!.fingerprint).not.toBe(failed.finding!.fingerprint);
  });
});

describe("round 6r, \"Classify now, forecast=sales\": an unbuilt question has a data class", () => {
  it.each([
    ["landed_cost" as QuestionClass, ["money"]],
    ["sales_revenue" as QuestionClass, ["sales"]],
    ["forecast" as QuestionClass, ["sales"]],
  ])("staff asking %s are refused with the class's line, before any book is read", async (questionClass, classes) => {
    const { answer, getClient, call } = await ask("staff", questionClass, "tell me");
    expect(answer).toEqual({ kind: "not_permitted", reason: "class_not_visible", questionClass, classes,
      line: classRefusalLine(classes as DataClass[]) });
    expect(getClient).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledTimes(1); // the pick only
  });

  it.each(["owner", "manager"])("%s: each is still not built", async role => {
    for (const questionClass of ["landed_cost", "sales_revenue", "forecast"] as QuestionClass[]) {
      const { answer } = await ask(role, questionClass, "tell me");
      expect(answer).toEqual({ kind: "not_built", reason: "unimplemented_question" });
    }
  });

  it("lot expiry has no class and answers every role not built", async () => {
    for (const role of ["staff", "owner"]) {
      expect((await ask(role, "lot_expiry", "tell me")).answer).toEqual({ kind: "not_built", reason: "unimplemented_question" });
    }
  });
});

// [2026-09-21, round 6r] What `reading_version` means in the code: the version
// of a Reading's definition (`ReadingDescriptor.version`, today 1 for all).
// The page may name it for a Reading it chose; a Reading the model picked runs
// at the catalogue's version, whatever the request carries.
describe("round 6r: reading_version is the page's, and only for the Reading the page chose", () => {
  async function submit(input: Partial<BoundAskDto>, questionClass: QuestionClass = "inventory.low_stock") {
    const call = jest.fn(async (opts: any) => {
      if (opts.nf.taskType === "ask_reading_pick") return reply({ questionClass });
      const { cells } = JSON.parse(opts.body.messages[0].content);
      return reply({ kind: "reading", focus: [cells[0].id] });
    });
    const folios = {
      begin: jest.fn(async () => ({ created: true, folio: pendingFolio("which wines are below par") })),
      finish: jest.fn(async (folio: ReadingFolio, answer: any, finding?: Finding) => ({ ...folio, answer, finding: finding ?? null })),
    };
    const service = new BoundAskService({ getClient: () => books() } as any, new ConfigService({ ASK_LAUNCHED: "true" }),
      { call, dailyShareOfAllowance: jest.fn() } as any, { record: jest.fn() } as any, folios as any);
    await service.submit(HOUSE, USER, "staff", { requestId: "req-1", utterance: "which wines are below par", origin: "page", ...input } as BoundAskDto);
    const [, answer, finding] = folios.finish.mock.calls[0];
    return { answer, finding: finding as Finding, begin: (folios.begin.mock.calls[0] as any[])[0], call };
  }

  it("a page-chosen Reading at a version that does not exist is refused and recorded at that version", async () => {
    const { answer, finding, begin, call } = await submit({ readingId: "inventory.low_stock", readingVersion: 2 });
    expect(begin.readingVersion).toBe(2);
    expect(finding).toMatchObject({ outcome: "not_built", reason: "unknown_reading_version", readingVersion: 2 });
    expect(answer.kind).toBe("not_built");
    expect(call).not.toHaveBeenCalled();
  });

  it("a model-picked Reading runs at version 1 whatever version the request carries", async () => {
    const { answer, finding, begin } = await submit({ readingVersion: 2 });
    expect(begin.readingVersion).toBeUndefined();
    expect(finding).toMatchObject({ outcome: "read", readingVersion: 1 });
    expect(answer.kind).toBe("reading");
  });
});
