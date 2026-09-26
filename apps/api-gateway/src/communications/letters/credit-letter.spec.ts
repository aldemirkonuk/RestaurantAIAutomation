/**
 * A credit claim asked for becomes a DRAFTED letter, never a sent one
 * (founder, 2026-09-25, round 5; ADR 0230).
 *
 * Proved here, each against the queries the service really issues (an
 * in-memory table that honours eq / in / json-path filters, not a mock of the
 * service):
 *
 *   1. The letter carries the claim's facts — amount in its own currency,
 *      reason, invoice and order numbers — and invents none it does not have.
 *   2. The draft is HOUSE_DRAFT: no dispatcher reads it, and `dispatchDue`
 *      leaves it where it is.
 *   3. Asking twice returns the same draft; no second row.
 *   4. No vendor → no row and a sentence; no address → a draft that says so.
 *   5. Sending the draft is the approval: it becomes the queued letter through
 *      `queue()` (book, guardrails, sender all still apply), and a second send
 *      of the same draft is refused.
 *   6. The credits controller drafts on `→ requested` and on no other move.
 */

import { ConflictException } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { IntegrationsOauthService } from "../../integrations/integrations-oauth.service";
import { HouseSenderService } from "./house-sender.service";
import { HouseLettersService, LETTER_STATUS } from "./house-letters.service";
import { composeCreditLetter } from "./credit-letter";
import { composerGuardrails } from "./composer-guardrails";
import { CreditsController } from "../../procurement/documents/credits.controller";

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const OTHER_HOUSE = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";
const PROVIDER = "cccccccc-0000-4000-8000-cccccccccccc";
const PERSON = "dddddddd-0000-4000-8000-dddddddddddd";
const CREDIT = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee";

type Row = Record<string, unknown>;

function field(row: Row, col: string): unknown {
  const m = /^(\w+)->>(\w+)$/.exec(col);
  if (m) {
    const obj = row[m[1]] as Row | null | undefined;
    const v = obj?.[m[2]];
    return v == null ? null : String(v);
  }
  return row[col];
}

/** A tiny table store that honours the filters the service issues. */
function store(tables: Record<string, Row[]>) {
  let seq = 0;
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: ((r: Row) => boolean)[] = [];
    let op: { kind: "select" } | { kind: "insert"; body: Row } | {
      kind: "update";
      body: Row;
    } = { kind: "select" };
    const q: Record<string, unknown> = {};
    const chain = () => q;
    q.select = chain;
    q.order = chain;
    q.limit = chain;
    q.is = chain;
    q.lte = (col: string, v: string) => {
      filters.push((r) => String(r[col] ?? "") <= v);
      return q;
    };
    q.eq = (col: string, v: unknown) => {
      filters.push((r) => field(r, col) === v);
      return q;
    };
    q.in = (col: string, vs: unknown[]) => {
      filters.push((r) => vs.includes(field(r, col)));
      return q;
    };
    q.insert = (body: Row) => {
      op = { kind: "insert", body };
      return q;
    };
    q.update = (body: Row) => {
      op = { kind: "update", body };
      return q;
    };
    const run = (): Row[] => {
      if (op.kind === "insert") {
        const row = { id: `row-${++seq}`, ...op.body };
        rows.push(row);
        return [row];
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op.kind === "update") {
        for (const r of hit) Object.assign(r, op.body);
      }
      return hit;
    };
    q.single = () => {
      const out = run();
      return Promise.resolve({ data: out[0] ?? null, error: null });
    };
    q.maybeSingle = q.single;
    q.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: run(), error: null }).then(resolve);
    return q;
  };
  return {
    tables,
    db: { client: { from }, getClient: () => ({ from }) } as unknown as
      DatabaseService,
  };
}

function seed(over: { provider?: Row; credit?: Row } = {}) {
  return store({
    procurement_credits: [
      {
        id: CREDIT,
        restaurant_id: HOUSE,
        provider_id: PROVIDER,
        order_id: "order-1",
        document_id: "doc-1",
        reason: "qty_short",
        summary: "Invoice says 12, we counted 10.",
        claimed_amount: "84.50",
        claimed_qty: 2,
        currency: "EUR",
        opened_at: "2026-09-20T10:00:00.000Z",
        state: "open",
        ...over.credit,
      },
    ],
    providers: [
      {
        id: PROVIDER,
        restaurant_id: HOUSE,
        name: "Vinoteca Sur",
        contact_email: "orders@vinoteca.example",
        primary_contact: null,
        deleted_at: null,
        ...over.provider,
      },
    ],
    provider_contacts: [],
    procurement_orders: [
      { id: "order-1", restaurant_id: HOUSE, order_number: "PO-1042" },
    ],
    procurement_documents: [
      { id: "doc-1", restaurant_id: HOUSE, doc_number: "INV-77" },
    ],
    procurement_conversations: [],
  });
}

function sendable(): HouseSenderService {
  return {
    resolve: async () => ({
      sendable: true,
      kind: "house_mailbox",
      address: "cellar@house.example",
      ceremony: "undo",
      undoMs: 120_000,
      words: "Sends from cellar@house.example.",
      grant: null,
    }),
  } as unknown as HouseSenderService;
}

function service(db: DatabaseService) {
  return new HouseLettersService(
    db,
    sendable(),
    {} as unknown as IntegrationsOauthService,
  );
}

describe("composeCreditLetter", () => {
  const facts = {
    reason: "qty_short",
    summary: "Invoice says 12, we counted 10.",
    claimedAmount: 84.5,
    currency: "EUR",
    claimedQty: 2,
    openedAt: "2026-09-20T10:00:00.000Z",
    vendorName: "Vinoteca Sur",
    orderNumber: "PO-1042",
    invoiceNumber: "INV-77",
  };

  it("carries the claim's facts in its own currency", () => {
    const l = composeCreditLetter(facts);
    expect(l.subject).toBe("Credit request — invoice INV-77");
    expect(l.body).toContain("84.50 EUR");
    expect(l.body).toContain("Invoice: INV-77");
    expect(l.body).toContain("Order: PO-1042");
    expect(l.body).toContain("Bottles concerned: 2");
    expect(l.body).toContain("Invoice says 12, we counted 10.");
    expect(l.body).toContain("2026-09-20");
    expect(l.category).toBe("invoice_mismatch");
  });

  it("leaves out what the claim does not carry, and invents nothing", () => {
    const l = composeCreditLetter({
      ...facts,
      orderNumber: null,
      invoiceNumber: null,
      claimedQty: null,
      summary: null,
      vendorName: null,
    });
    expect(l.subject).toBe("Credit request");
    expect(l.body).not.toMatch(/Invoice:|Order:|Bottles concerned/);
    expect(l.body.startsWith("Hello,")).toBe(true);
    expect(l.body).not.toMatch(/\{\{|undefined|null|NaN/);
  });

  it("trips none of the composer's guardrails", () => {
    for (const reason of [
      "overbilled_vs_ship",
      "qty_short",
      "short_shipped",
      "damaged",
      "price_variance",
      "never_ordered",
      "other",
      "unknown_code",
    ]) {
      const l = composeCreditLetter({ ...facts, reason });
      expect(
        composerGuardrails({
          body: l.body,
          subject: l.subject,
          priorOutboundOnOrder: null,
        }),
      ).toEqual([]);
    }
    expect(composeCreditLetter({ ...facts, reason: "damaged" }).category).toBe(
      "delivery_dispute",
    );
  });
});

describe("HouseLettersService.draftForCredit", () => {
  it("drafts, never queues: HOUSE_DRAFT to the booked address, with the claim's facts", async () => {
    const { db, tables } = seed();
    const out = await service(db).draftForCredit({
      restaurantId: HOUSE,
      userId: PERSON,
      creditId: CREDIT,
    });
    expect(out.state).toBe("drafted");
    expect(out.to).toBe("orders@vinoteca.example");
    const rows = tables.procurement_conversations;
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.status).toBe(LETTER_STATUS.DRAFT);
    expect(row.status).not.toBe(LETTER_STATUS.QUEUED);
    expect(row.scheduled_send_at).toBeNull();
    expect(row.sent_at).toBeUndefined();
    expect(row.ai_generated).toBe(false);
    expect(row.outbound_email_type).toBe("HOUSE_LETTER");
    expect(row.order_id).toBe("order-1");
    const headers = row.email_headers as Row;
    expect(headers.credit_id).toBe(CREDIT);
    expect(headers.drafted_by).toBe(PERSON);
    expect(headers.subject).toBe("Credit request — invoice INV-77");
    expect(String(row.message_text)).toContain("84.50 EUR");
    expect(String(row.message_text)).toContain("Hello Vinoteca Sur team,");
  });

  it("is not picked up by the dispatcher — a draft cannot leave on its own", async () => {
    const { db, tables } = seed();
    const svc = service(db);
    await svc.draftForCredit({
      restaurantId: HOUSE,
      userId: PERSON,
      creditId: CREDIT,
    });
    const run = await svc.dispatchDue(Date.now() + 365 * 86_400_000);
    expect(run.considered).toBe(0);
    expect(tables.procurement_conversations[0].status).toBe(
      LETTER_STATUS.DRAFT,
    );
  });

  it("asking twice returns the same draft and writes no second row", async () => {
    const { db, tables } = seed();
    const svc = service(db);
    const first = await svc.draftForCredit({
      restaurantId: HOUSE,
      userId: PERSON,
      creditId: CREDIT,
    });
    const again = await svc.draftForCredit({
      restaurantId: HOUSE,
      userId: PERSON,
      creditId: CREDIT,
    });
    expect(again.state).toBe("existing");
    expect(again.id).toBe(first.id);
    expect(tables.procurement_conversations).toHaveLength(1);
  });

  it("a claim with no vendor writes no row and says there is nobody to write to", async () => {
    const { db, tables } = seed({ credit: { provider_id: null } });
    const out = await service(db).draftForCredit({
      restaurantId: HOUSE,
      userId: PERSON,
      creditId: CREDIT,
    });
    expect(out.state).toBe("no_vendor");
    expect(out.id).toBeNull();
    expect(out.says).toMatch(/names no vendor/);
    expect(tables.procurement_conversations).toHaveLength(0);
  });

  it("a vendor with no address keeps the draft and says it cannot go yet", async () => {
    const { db, tables } = seed({ provider: { contact_email: null } });
    const out = await service(db).draftForCredit({
      restaurantId: HOUSE,
      userId: PERSON,
      creditId: CREDIT,
    });
    expect(out.state).toBe("drafted_no_address");
    expect(out.to).toBeNull();
    expect(out.says).toMatch(/no address in the house's book/);
    expect(tables.procurement_conversations).toHaveLength(1);
    expect(
      (tables.procurement_conversations[0].email_headers as Row).to,
    ).toBeNull();
  });

  it("another house's claim is not found, and nothing is drafted", async () => {
    const { db, tables } = seed({ credit: { restaurant_id: OTHER_HOUSE } });
    await expect(
      service(db).draftForCredit({
        restaurantId: HOUSE,
        userId: PERSON,
        creditId: CREDIT,
      }),
    ).rejects.toThrow(/No such claim/);
    expect(tables.procurement_conversations).toHaveLength(0);
  });
});

describe("sending a draft is the approval", () => {
  async function drafted() {
    const s = seed();
    const svc = service(s.db);
    const d = await svc.draftForCredit({
      restaurantId: HOUSE,
      userId: PERSON,
      creditId: CREDIT,
    });
    return { ...s, svc, draftId: String(d.id) };
  }

  const dto = (draftId: string) => ({
    providerId: PROVIDER,
    to: "orders@vinoteca.example",
    subject: "Credit request — invoice INV-77",
    body: "Edited by the manager before sending.",
    draftId,
  });

  it("the draft row becomes the queued letter, keeping its claim", async () => {
    const { svc, tables, draftId } = await drafted();
    const out = await svc.queue({
      restaurantId: HOUSE,
      userId: PERSON,
      dto: dto(draftId),
    });
    expect(out.id).toBe(draftId);
    expect(out.status).toBe(LETTER_STATUS.QUEUED);
    const rows = tables.procurement_conversations;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(LETTER_STATUS.QUEUED);
    expect(rows[0].message_text).toBe("Edited by the manager before sending.");
    const headers = rows[0].email_headers as Row;
    expect(headers.credit_id).toBe(CREDIT);
    expect(headers.written_by).toBe(PERSON);
  });

  it("a draft already sent is refused, not sent twice", async () => {
    const { svc, tables, draftId } = await drafted();
    await svc.queue({ restaurantId: HOUSE, userId: PERSON, dto: dto(draftId) });
    await expect(
      svc.queue({ restaurantId: HOUSE, userId: PERSON, dto: dto(draftId) }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tables.procurement_conversations).toHaveLength(1);
  });

  it("a draft sent to a different vendor is refused", async () => {
    const { svc, draftId } = await drafted();
    await expect(
      svc.queue({
        restaurantId: HOUSE,
        userId: PERSON,
        dto: { ...dto(draftId), providerId: "ffffffff-0000-4000-8000-ffffffffffff" },
      }),
    ).rejects.toThrow(/different vendor/);
  });

  it("a discarded draft is kept as cancelled and cannot then be sent", async () => {
    const { svc, tables, draftId } = await drafted();
    const out = await svc.discardDraft({ restaurantId: HOUSE, id: draftId });
    expect(out.status).toBe(LETTER_STATUS.CANCELLED);
    expect(tables.procurement_conversations[0].status).toBe(
      LETTER_STATUS.CANCELLED,
    );
    await expect(
      svc.queue({ restaurantId: HOUSE, userId: PERSON, dto: dto(draftId) }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("lists the draft with its claim, and links the claim to its letter", async () => {
    const { svc, draftId } = await drafted();
    const drafts = await svc.drafts(HOUSE);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ id: draftId, creditId: CREDIT });
    const byCredit = await svc.lettersForCredits(HOUSE, [CREDIT]);
    expect(byCredit[CREDIT]).toEqual([
      expect.objectContaining({ id: draftId, status: LETTER_STATUS.DRAFT }),
    ]);
    expect(await svc.drafts(OTHER_HOUSE)).toEqual([]);
  });
});

describe("CreditsController drafts on → requested only", () => {
  const user = { userId: PERSON, restaurantId: HOUSE };

  it("moving a claim to requested drafts its letter and returns it", async () => {
    const { db, tables } = seed();
    const c = new CreditsController(db, service(db));
    const out = (await c.transition(CREDIT, { to: "requested" }, user)) as Row;
    expect(out.state).toBe("requested");
    expect(out.letter).toMatchObject({ state: "drafted" });
    expect(tables.procurement_conversations).toHaveLength(1);
    expect(tables.procurement_conversations[0].status).toBe(
      LETTER_STATUS.DRAFT,
    );
  });

  it("writing a claim off drafts nothing", async () => {
    const { db, tables } = seed();
    const c = new CreditsController(db, service(db));
    const out = (await c.transition(
      CREDIT,
      { to: "written_off" },
      user,
    )) as Row;
    expect(out.letter).toBeUndefined();
    expect(tables.procurement_conversations).toHaveLength(0);
  });

  it("a letter that cannot be drafted is reported beside the move, not thrown", async () => {
    const { db } = seed();
    const failing = {
      draftForCredit: async () => {
        throw new Error("The conversation book refused the row.");
      },
    } as unknown as HouseLettersService;
    const c = new CreditsController(db, failing);
    const out = (await c.transition(CREDIT, { to: "requested" }, user)) as Row;
    expect(out.state).toBe("requested");
    expect(out.letter).toEqual({
      state: "failed",
      id: null,
      to: null,
      says: "The conversation book refused the row.",
    });
  });

  it("the chase list names each claim's letter", async () => {
    const { db } = seed();
    const c = new CreditsController(db, service(db));
    await c.transition(CREDIT, { to: "requested" }, user);
    const list = await c.list(user);
    expect(list.lettersError).toBeNull();
    expect(list.items[0].letters).toEqual([
      expect.objectContaining({ status: LETTER_STATUS.DRAFT }),
    ]);
  });

  it("request-letter refuses a claim nobody has asked for yet", async () => {
    const { db } = seed();
    const c = new CreditsController(db, service(db));
    await expect(c.requestLetter(CREDIT, user)).rejects.toThrow(
      /move it to requested first/,
    );
  });
});
