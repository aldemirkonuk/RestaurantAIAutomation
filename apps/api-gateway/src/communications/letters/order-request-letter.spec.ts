/**
 * The order-request letter (W25; ADR 0313, 4a-i): the pure renderer, the
 * service door that reads an order's facts and stages its letter, and the
 * internal route's guards. One spec file for the lane, to keep the PR inside
 * its file cap.
 *
 * Renderer, proved without a database: who may see money (W12b F6), what "no
 * price on file" asks (never "confirm"), the subject, the Mudavym line (F4),
 * the courtesy line's drop rules (F2), that the queue's own guardrails pass the
 * default letter, that the render and its facts hash are deterministic and
 * move with the facts, and each class the prose predicate refuses.
 *
 * Service, proved against an in-memory table store that honours the filters
 * the service issues (eq / order / maybeSingle) — so a read that forgot its
 * restaurant scope picks up the other house's row and fails a test here.
 */

import "reflect-metadata";
import {
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { OrderRequestService } from "./order-request.service";
import { OrderRequestController } from "./order-request.controller";
import { ServiceKeyGuard } from "../../auth/guards/service-key.guard";
import { IS_PUBLIC_KEY } from "../../auth/decorators/public.decorator";
import type { DatabaseService } from "../../database/database.service";
import {
  DEFAULT_ORDER_REQUEST_TEMPLATE,
  ORDER_REQUEST_TOKENS,
  OrderRequestTemplateRefused,
  courtesyLineOrNull,
  orderRequestProseRefusals,
  renderOrderRequest,
  type OrderRequestFacts,
} from "./order-request-letter";
import { composerGuardrails } from "./composer-guardrails";

function facts(over: Partial<OrderRequestFacts> = {}): OrderRequestFacts {
  return {
    orderId: "o-1",
    orderNumber: "PO-1042",
    houseName: "Tuzlu Rüzgar",
    vendorFirstName: "Ayşe",
    lines: [
      {
        name: "Kavaklıdere Yakut",
        vendorSku: "KY-75",
        quantity: 2,
        unit: "cases",
        bottlesPerUnit: 6,
        price: { amount: 25, currency: "EUR", per: "bottle" },
      },
    ],
    placer: { userId: "u-1", name: "Deniz", role: "owner" },
    deliverTo: "Moda Cd., Istanbul",
    neededBy: "2026-10-20",
    paymentTerms: "Net 30",
    ...over,
  };
}

const STAFF = { userId: "u-2", name: "Ali", role: "staff" };
const NOBODY = { userId: null, name: null, role: null };
const NO_PRICE_LINE = {
  name: "Kavaklıdere Yakut",
  vendorSku: null,
  quantity: 2,
  unit: "cases",
  bottlesPerUnit: 6,
  price: null,
};
/** A price as it would be written in any currency, or a currency code. */
const MONEY_RE = /\d+\.\d{2}|\bEUR\b|currency not recorded/;

describe("who may see money (W12b F6)", () => {
  it("an owner's letter carries the line price in its own currency", () => {
    const r = renderOrderRequest(facts());
    expect(r.priceShown).toBe(true);
    expect(r.body).toContain("2 cases, 6 bottles each at 25.00 EUR per bottle");
  });

  it("a price with no currency says so rather than guessing one", () => {
    const f = facts();
    f.lines[0].price = { amount: 25, currency: null, per: "bottle" };
    expect(renderOrderRequest(f).body).toContain("25.00 (currency not recorded) per bottle");
  });

  it("a staff placer's letter carries no price anywhere", () => {
    const r = renderOrderRequest(facts({ placer: STAFF }));
    expect(r.priceShown).toBe(false);
    expect(`${r.subject}\n${r.body}`).not.toMatch(MONEY_RE);
    expect(r.body).toContain("2 cases, 6 bottles each");
    expect(r.body).toContain("Ali\nTuzlu Rüzgar");
  });

  it("a NULL creator fails closed: no price, and the house signs alone", () => {
    const r = renderOrderRequest(facts({ placer: NOBODY }));
    expect(`${r.subject}\n${r.body}`).not.toMatch(MONEY_RE);
    expect(r.parts.signer).toBe("Tuzlu Rüzgar");
  });

  it("a placer with no role here fails closed the same way", () => {
    const r = renderOrderRequest(facts({ placer: { userId: "u-3", name: "Eda", role: null } }));
    expect(`${r.subject}\n${r.body}`).not.toMatch(MONEY_RE);
    expect(r.parts.signer).toBe("Tuzlu Rüzgar");
  });
});

describe("no price on file", () => {
  it("asks for a price and never asks the vendor to confirm (header 0, no line price)", () => {
    for (const placer of [facts().placer, STAFF, NOBODY]) {
      const r = renderOrderRequest(facts({ placer, lines: [NO_PRICE_LINE] }));
      expect(r.ask).toBe("price");
      expect(r.body).toContain("We have no price on file for this order");
      expect(`${r.subject}\n${r.body}`).not.toMatch(/confirm/i);
    }
  });

  it("a zero price is no price: no 0.00 shown, and the price ask", () => {
    const f = facts();
    f.lines[0].price = { amount: 0, currency: "EUR", per: "bottle" };
    const r = renderOrderRequest(f);
    expect(r.ask).toBe("price");
    expect(r.body).not.toMatch(/0\.00|confirm/i);
  });

  it("one unpriced line among priced ones is still no price on file", () => {
    const f = facts();
    f.lines.push({ ...NO_PRICE_LINE, name: "Second" });
    const r = renderOrderRequest(f);
    expect(r.ask).toBe("price");
    expect(r.body).not.toMatch(/confirm/i);
  });

  it("with a price on file the ask is the confirm ask, whoever placed it", () => {
    expect(renderOrderRequest(facts()).ask).toBe("confirm");
    expect(renderOrderRequest(facts({ placer: STAFF })).parts.ask).toContain("Please confirm this order");
  });
});

describe("subject (renderer-owned, R7)", () => {
  it("names the item for a one-line order", () => {
    expect(renderOrderRequest(facts()).subject).toBe("Order PO-1042 — Tuzlu Rüzgar — Kavaklıdere Yakut");
  });
  it("names no item for an N-line order", () => {
    const f = facts();
    f.lines.push({ ...f.lines[0], name: "Second" });
    expect(renderOrderRequest(f).subject).toBe("Order PO-1042 — Tuzlu Rüzgar");
  });
});

describe("the Mudavym line (F4)", () => {
  it("is the last line of the default letter", () => {
    expect(renderOrderRequest(facts()).body.endsWith("—\nThis message was drafted by Mudavym on behalf of Tuzlu Rüzgar.")).toBe(true);
  });
  it("is present under a house template that never mentions it", () => {
    const r = renderOrderRequest(facts(), {
      template: "{{greeting}}\n{{order_lines}}\n{{ask}}\n{{signer}}",
    });
    expect(r.body).toContain("drafted by Mudavym on behalf of Tuzlu Rüzgar.");
  });
});

describe("optional blocks", () => {
  it("drops an empty optional block's line; the date ask stands in for a missing date", () => {
    const r = renderOrderRequest(facts({ deliverTo: null, paymentTerms: null, neededBy: null }));
    expect(r.body).not.toContain("Deliver to");
    expect(r.body).not.toContain("Payment terms");
    expect(r.body).toContain("Please tell us the delivery date you can make.");
    expect(r.body).not.toMatch(/\n{3,}/);
  });
});

describe("the courtesy line (F2)", () => {
  it.each([
    ["a digit", "We look forward to working with you for 3 more seasons."],
    ["a non-ASCII digit", "We look forward to working with you for ３ seasons."],
    ["a currency sign", "Thank you for the € support."],
    ["a date word", "Hope to see you on Friday."],
    ["a Turkish date word", "Yarın görüşmek üzere."],
    ["a bracket", "Best regards from [Your Name]."],
    ["a merge token", "Thanks {{name}}."],
    ["a commitment", "We accept your terms gladly."],
    ["a money word", "Thanks for the free delivery last time."],
  ])("is dropped on %s", (_label, sentence) => {
    expect(courtesyLineOrNull(sentence)).toBeNull();
    const r = renderOrderRequest(facts(), { courtesySentence: sentence });
    expect(r.courtesyDropped).toBe(true);
    expect(r.parts.courtesy_line).toBe("");
  });

  it("is kept when it holds no figure", () => {
    const s = "We hope the harvest went well for you.";
    const r = renderOrderRequest(facts(), { courtesySentence: s });
    expect(r.courtesyDropped).toBe(false);
    expect(r.body).toContain(s);
  });
});

describe("the queue's guardrails over the default letter", () => {
  it.each([
    ["owner with a price", facts()],
    ["staff", facts({ placer: STAFF })],
    ["no price", facts({ lines: [NO_PRICE_LINE] })],
    ["no placer", facts({ placer: NOBODY })],
  ])("trip nothing (%s)", (_label, f) => {
    const r = renderOrderRequest(f, { courtesySentence: "We hope the harvest went well." });
    expect(composerGuardrails({ body: r.body, subject: r.subject, priorOutboundOnOrder: 0 })).toEqual([]);
  });
});

describe("determinism and the facts hash", () => {
  it("same facts and template give the same text and hash", () => {
    const a = renderOrderRequest(facts());
    const b = renderOrderRequest(facts());
    expect(b.body).toBe(a.body);
    expect(b.subject).toBe(a.subject);
    expect(b.factsHash).toBe(a.factsHash);
    expect(a.factsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("moves with quantity, price and role", () => {
    const base = renderOrderRequest(facts()).factsHash;
    const qty = facts();
    qty.lines[0].quantity = 3;
    const price = facts();
    price.lines[0].price = { amount: 26, currency: "EUR", per: "bottle" };
    expect(renderOrderRequest(qty).factsHash).not.toBe(base);
    expect(renderOrderRequest(price).factsHash).not.toBe(base);
    expect(renderOrderRequest(facts({ placer: { ...facts().placer, role: "staff" } })).factsHash).not.toBe(base);
  });

  it("does not move with the template (R5) or the courtesy line", () => {
    const base = renderOrderRequest(facts()).factsHash;
    const other = renderOrderRequest(facts(), {
      template: "{{greeting}}\n{{order_lines}}\n{{ask}}\n{{signer}}",
      courtesySentence: "We hope the harvest went well.",
    }).factsHash;
    expect(other).toBe(base);
  });
});

describe("the prose predicate", () => {
  const T = (prose: string) => `{{greeting}}\n${prose}\n{{order_lines}}\n{{ask}}\n{{signer}}`;
  const rules = (tpl: string) => orderRequestProseRefusals(tpl).map((r) => r.rule);

  it("passes the default template", () => {
    expect(orderRequestProseRefusals(DEFAULT_ORDER_REQUEST_TEMPLATE)).toEqual([]);
  });

  it("names no single figure among its tokens", () => {
    for (const k of Object.keys(ORDER_REQUEST_TOKENS)) {
      expect(k).not.toMatch(/price|quantity|qty|order_number|amount|total|date$/);
    }
  });

  it.each([
    ["unknown_token", "{{greeting}}\n{{price}}\n{{order_lines}}\n{{ask}}\n{{signer}}"],
    ["missing_required_token", "{{greeting}}\n{{order_lines}}\n{{signer}}"],
    ["numeral", T("Within 2 days please.")],
    ["numeral", T("Within ３ days please.")],
    ["numeral", T("Our ² favourite.")],
    ["numeral", T("Ⅻ cheers.")],
    ["currency", T("We pay in € only.")],
    ["currency", T("All in EUR as usual.")],
    ["currency", T("Hepsi lira olarak.")],
    ["link", T("See https://example.org for details.")],
    ["link", T("See example.com for details.")],
    ["link", T("Write to orders@house.example.")],
    ["stray_bracket", T("Thanks { team.")],
    ["stray_bracket", T("Thanks <b>team</b>.")],
    ["stray_bracket", "{{greeting}}\n{{{order_lines}}}\n{{ask}}\n{{signer}}"],
    ["money_or_terms_word", T("At the usual price.")],
    ["money_or_terms_word", T("Free delivery as always.")],
    ["money_or_terms_word", T("Her zamanki FİYAT ile.")],
    ["money_or_terms_word", T("Ödemeyi sonra konuşuruz.")],
    ["money_or_terms_word", T("Vadeli olsun.")],
    ["number_word", T("Twelve of the usual.")],
    ["number_word", T("A dozen more.")],
    ["number_word", T("İki koli daha.")],
    ["commitment_language", T("We accept your offer.")],
    ["commitment_language", T("We a\u200bccept your offer.")],
  ])("refuses %s: %s", (rule, tpl) => {
    expect(rules(tpl)).toContain(rule);
  });

  it("does not refuse everyday words that collide with numbers or dates", () => {
    expect(rules(T("Bir sorumuz var. May we ask for an early slot on Pazar? No one minds."))).toEqual([]);
  });

  it("a refused template never renders", () => {
    expect(() => renderOrderRequest(facts(), { template: T("At the usual price.") })).toThrow(
      OrderRequestTemplateRefused,
    );
  });
});

// ── The service door and the route ──────────────────────────────────────────

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";
const VENDOR = "cccccccc-0000-4000-8000-cccccccccccc";
const ORDER = "dddddddd-0000-4000-8000-dddddddddddd";
const OWNER = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee";
const STAFF_ID = "ffffffff-0000-4000-8000-ffffffffffff";

type Row = Record<string, unknown>;

function store(tables: Record<string, Row[]>, opts: { failing?: string[]; rpc?: any } = {}) {
  const rpcCalls: { fn: string; args: any }[] = [];
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    const orders: { col: string; asc: boolean }[] = [];
    const run = () => {
      if (opts.failing?.includes(table)) {
        return { data: null, error: { message: `${table} is down` } };
      }
      let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      for (const o of [...orders].reverse()) {
        rows = [...rows].sort((a, b) =>
          (a[o.col] as any) < (b[o.col] as any) ? (o.asc ? -1 : 1) : (a[o.col] as any) > (b[o.col] as any) ? (o.asc ? 1 : -1) : 0,
        );
      }
      return { data: rows, error: null };
    };
    const q: any = {
      select: () => q,
      eq: (col: string, v: unknown) => {
        filters.push((r) => r[col] === v);
        return q;
      },
      order: (col: string, o?: { ascending?: boolean }) => {
        orders.push({ col, asc: o?.ascending !== false });
        return q;
      },
      maybeSingle: async () => {
        const r = run();
        if (r.error) return r;
        if (r.data!.length > 1) return { data: null, error: { message: "more than one row" } };
        return { data: r.data![0] ?? null, error: null };
      },
      then: (ok: any, bad: any) => Promise.resolve(run()).then(ok, bad),
    };
    return q;
  };
  const supabase = {
    from,
    rpc: async (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      return opts.rpc ?? { data: { id: "conv-1", staged: true }, error: null };
    },
  };
  return { db: { supabase } as unknown as DatabaseService, rpcCalls };
}

function world(over: { createdBy?: string | null; linePrice?: number | null; staffRole?: string } = {}) {
  return {
    procurement_orders: [
      {
        id: ORDER,
        order_number: "PO-7",
        restaurant_id: HOUSE,
        provider_id: VENDOR,
        created_by: over.createdBy === undefined ? OWNER : over.createdBy,
        expected_delivery_date: null,
        // A no-price order stores 0 here (procurement.service.ts:1076); never read.
        final_price: 0,
      },
    ],
    procurement_order_items: [
      {
        order_id: ORDER,
        restaurant_id: HOUSE,
        wine_name: "Yakut",
        vendor_sku: "KY-75",
        quantity: 3,
        unit_type: "cases",
        bottles_per_unit: 6,
        final_unit_price: over.linePrice === undefined ? 25 : over.linePrice,
        negotiated_unit_price: null,
        quoted_unit_price: null,
        price_uom: "bottle",
        price_pack_size: null,
        currency: "EUR",
        line_no: 1,
        created_at: "2026-10-08T10:00:00Z",
      },
      // Another house's line on the same order id must never be read.
      { order_id: ORDER, restaurant_id: OTHER, wine_name: "Leak", quantity: 9, unit_type: "cases", line_no: 0 },
    ],
    restaurants: [
      { id: HOUSE, name: "Tuzlu Rüzgar", address: { street: "Moda Cd." }, city: "Istanbul" },
      { id: OTHER, name: "Other House" },
    ],
    providers: [
      { id: VENDOR, restaurant_id: HOUSE, contact_first_name: "Ayşe" },
      { id: VENDOR, restaurant_id: OTHER, contact_first_name: "Wrong" },
    ],
    restaurant_vendor_terms: [
      { restaurant_id: HOUSE, provider_id: VENDOR, payment_terms: "Net 30" },
      { restaurant_id: OTHER, provider_id: VENDOR, payment_terms: "Cash" },
    ],
    user_restaurant_access: [
      { user_id: OWNER, restaurant_id: HOUSE, role: "owner", is_active: true },
      { user_id: STAFF_ID, restaurant_id: HOUSE, role: over.staffRole ?? "staff", is_active: true },
      { user_id: STAFF_ID, restaurant_id: OTHER, role: "owner", is_active: true },
    ],
    users: [
      { user_id: OWNER, name: "Deniz", role: null, restaurant_id: null },
      { user_id: STAFF_ID, name: "Ali", role: null, restaurant_id: null },
    ],
  };
}

describe("OrderRequestService — facts under the order row's house", () => {
  it("renders from this house's rows only, with the owner's price", async () => {
    const { db } = store(world());
    const r = await new OrderRequestService(db).render({ orderId: ORDER, stage: false });
    expect(r.restaurantId).toBe(HOUSE);
    expect(r.body).toContain("Hello Ayşe,");
    expect(r.body).toContain("3 cases, 6 bottles each at 25.00 EUR per bottle");
    expect(r.body).toContain("Payment terms you gave us: Net 30");
    expect(r.body).toContain("Deliver to: Moda Cd., Istanbul");
    expect(r.body).not.toMatch(/Leak|Wrong|Cash|Other House/);
    expect(r.template).toEqual({ key: "order_request", source: "default" });
  });

  it("an order of another house is a 404, the same as no order", async () => {
    const { db } = store(world());
    const svc = new OrderRequestService(db);
    await expect(svc.render({ orderId: ORDER, restaurantId: OTHER, stage: false })).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      svc.render({ orderId: "99999999-0000-4000-8000-999999999999", stage: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("a staff placer's letter shows no price (role read in THIS house)", async () => {
    const { db } = store(world({ createdBy: STAFF_ID }));
    const r = await new OrderRequestService(db).render({ orderId: ORDER, stage: false });
    expect(r.priceShown).toBe(false);
    expect(r.body).not.toMatch(/25\.00|EUR/);
    expect(r.parts.signer).toBe("Ali\nTuzlu Rüzgar");
  });

  it("an unreadable access register shows no price, even with a legacy owner role", async () => {
    // lookupRestaurantRole falls back to users.role and still reports the
    // failed read: the letter must take the failure, not the legacy role.
    const w = world();
    w.users = w.users.map((u: any) => (u.user_id === OWNER ? { ...u, role: "owner", restaurant_id: HOUSE } : u));
    const { db } = store(w, { failing: ["user_restaurant_access"] });
    const r = await new OrderRequestService(db).render({ orderId: ORDER, stage: false });
    expect(r.priceShown).toBe(false);
    expect(r.body).not.toMatch(/25\.00|EUR/);
  });

  it("a NULL creator shows no price and the house signs alone", async () => {
    const { db } = store(world({ createdBy: null }));
    const r = await new OrderRequestService(db).render({ orderId: ORDER, stage: false });
    expect(r.priceShown).toBe(false);
    expect(r.parts.signer).toBe("Tuzlu Rüzgar");
  });

  it("header final_price 0 with no line price asks for a price, never confirm", async () => {
    const { db } = store(world({ linePrice: null }));
    const r = await new OrderRequestService(db).render({ orderId: ORDER, stage: false });
    expect(r.ask).toBe("price");
    expect(r.body).not.toMatch(/confirm|0\.00/i);
  });

  it("a line price of 0 is no price on file", async () => {
    const { db } = store(world({ linePrice: 0 }));
    const r = await new OrderRequestService(db).render({ orderId: ORDER, stage: false });
    expect(r.ask).toBe("price");
    expect(r.body).not.toMatch(/confirm|0\.00/i);
  });

  it("a failed terms read is a failure, not 'no terms'", async () => {
    const { db } = store(world(), { failing: ["restaurant_vendor_terms"] });
    await expect(new OrderRequestService(db).render({ orderId: ORDER, stage: false })).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});

describe("OrderRequestService — staging through stage_order_letter", () => {
  it("does not touch the door without stage", async () => {
    const { db, rpcCalls } = store(world());
    const r = await new OrderRequestService(db).render({ orderId: ORDER, stage: false });
    expect(rpcCalls).toEqual([]);
    expect(r.staged).toBeNull();
  });

  it("stages an ORDER_REQUEST with p_kind and the provenance headers", async () => {
    const { db, rpcCalls } = store(world());
    const r = await new OrderRequestService(db).render({ orderId: ORDER, stage: true });
    expect(rpcCalls).toHaveLength(1);
    const { fn, args } = rpcCalls[0];
    expect(fn).toBe("stage_order_letter");
    expect(args.p_kind).toBe("ORDER_REQUEST");
    expect(args.p_row).toMatchObject({
      order_id: ORDER,
      restaurant_id: HOUSE,
      provider_id: VENDOR,
      direction: "outbound",
      status: "PENDING_APPROVAL",
      outbound_email_type: "ORDER_REQUEST",
      disclaimer_appended: true,
      message_text: r.body,
      email_headers: {
        subject: r.subject,
        template_key: "order_request",
        renderer_version: r.rendererVersion,
        facts_hash: r.factsHash,
      },
    });
    expect(r.staged).toBe(true);
    expect(r.conversationId).toBe("conv-1");
  });

  it("relays staged:false with the live letter's id", async () => {
    const { db } = store(world(), { rpc: { data: { id: "conv-old", staged: false }, error: null } });
    const r = await new OrderRequestService(db).render({ orderId: ORDER, stage: true });
    expect(r.staged).toBe(false);
    expect(r.conversationId).toBe("conv-old");
  });

  it("PGRST202 (door not deployed) is a 503 that stages nothing", async () => {
    const { db } = store(world(), { rpc: { data: null, error: { code: "PGRST202", message: "not found" } } });
    await expect(new OrderRequestService(db).render({ orderId: ORDER, stage: true })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("any other door error is a 500, never reported as staged", async () => {
    const { db } = store(world(), { rpc: { data: null, error: { code: "23514", message: "check" } } });
    await expect(new OrderRequestService(db).render({ orderId: ORDER, stage: true })).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});

describe("OrderRequestController — a service door, not a person's", () => {
  const handler = OrderRequestController.prototype.orderRequest;

  it("sits at internal/letters, behind ServiceKeyGuard and nothing else", () => {
    expect(Reflect.getMetadata(PATH_METADATA, OrderRequestController)).toBe("internal/letters");
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([ServiceKeyGuard]);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    // No class guard: a class JwtAuthGuard would refuse the service outright.
    expect(Reflect.getMetadata(GUARDS_METADATA, OrderRequestController)).toBeUndefined();
  });

  it("refuses an unknown field and a non-uuid order", async () => {
    const svc = { render: jest.fn() } as unknown as OrderRequestService;
    const c = new OrderRequestController(svc);
    await expect(c.orderRequest({ order_id: ORDER, restaurantId: HOUSE })).rejects.toThrow(/Unknown field/);
    await expect(c.orderRequest({ order_id: "x" })).rejects.toThrow(/uuid/);
    expect((svc.render as jest.Mock).mock.calls).toHaveLength(0);
  });
});
