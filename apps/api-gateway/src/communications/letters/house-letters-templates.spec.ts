/**
 * The order letter's template: owner or manager, against the STORED purpose;
 * a draft that renders nothing until previewed and published; versions; reset;
 * restore; and the renderer reading only what was published (ADR 0313, 4a-ii;
 * ADR 0173 D2).
 *
 * The route gate on preview/publish/reset/restore is pinned through real HTTP
 * in house-letters-drafts-roles.spec.ts. This file is the service half: the
 * save route stays open for the five composer purposes, so the order letter's
 * rule there lives in `upsertTemplate`, and the write methods check the role
 * again themselves.
 */

import {
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { DatabaseService } from "../../database/database.service";
import {
  COMPOSER_LETTER_CATEGORIES,
  HouseLettersService,
  LETTER_CATEGORIES,
  letterBodyHash,
  orderLetterPreviewHash,
} from "./house-letters.service";
import { OrderRequestService } from "./order-request.service";
import { DEFAULT_ORDER_REQUEST_TEMPLATES } from "./order-request-letter";

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";
const OWNER = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee";
const LETTER = "11111111-0000-4000-8000-111111111111";
const PRICE_TPL = "22222222-0000-4000-8000-222222222222";
const VENDOR = "cccccccc-0000-4000-8000-cccccccccccc";
const ORDER = "dddddddd-0000-4000-8000-dddddddddddd";

const HOUSE_WORDS = [
  "{{greeting}}",
  "",
  "We would like the following:",
  "",
  "{{order_lines}}",
  "",
  "{{ask}}",
  "",
  "With thanks,",
  "{{signer}}",
].join("\n");

type Row = Record<string, unknown>;

/** A tiny supabase-js stand-in: filters, order, limit, insert, update. */
function store(tables: Record<string, Row[]>, opts: { failing?: string[] } = {}) {
  const writes: { op: "insert" | "update"; table: string; body: Row }[] = [];
  let ids = 0;
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    const orders: { col: string; asc: boolean }[] = [];
    let limit: number | null = null;
    let op: { kind: "insert" | "update"; body: Row } | null = null;
    const run = () => {
      if (opts.failing?.includes(table)) return { data: null, error: { message: `${table} is down` } };
      const all = (tables[table] ??= []);
      if (op?.kind === "insert") {
        const row: Row = { id: `new-${++ids}`, created_at: `2026-10-08T00:00:0${ids}Z`, ...op.body };
        if (
          table === "letter_template_versions" &&
          all.some((r) => r.template_id === row.template_id && r.locale === row.locale && r.version === row.version)
        ) {
          return { data: null, error: { code: "23505", message: "duplicate" } };
        }
        all.push(row);
        writes.push({ op: "insert", table, body: op.body });
        return { data: [row], error: null };
      }
      let rows = all.filter((r) => filters.every((f) => f(r)));
      if (op?.kind === "update") {
        for (const r of rows) Object.assign(r, op.body);
        writes.push({ op: "update", table, body: op.body });
      }
      for (const o of [...orders].reverse()) {
        rows = [...rows].sort((a, b) =>
          (a[o.col] as any) < (b[o.col] as any) ? (o.asc ? -1 : 1) : (a[o.col] as any) > (b[o.col] as any) ? (o.asc ? 1 : -1) : 0,
        );
      }
      if (limit != null) rows = rows.slice(0, limit);
      return { data: rows, error: null };
    };
    const q: any = {
      select: () => q,
      insert: (body: Row) => ((op = { kind: "insert", body }), q),
      update: (body: Row) => ((op = { kind: "update", body }), q),
      eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), q),
      in: (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), q),
      order: (col: string, o?: { ascending?: boolean }) => (orders.push({ col, asc: o?.ascending !== false }), q),
      limit: (n: number) => ((limit = n), q),
      maybeSingle: async () => {
        const r = run();
        if (r.error) return r;
        if (r.data!.length > 1) return { data: null, error: { message: "more than one row" } };
        return { data: r.data![0] ?? null, error: null };
      },
      single: async () => {
        const r = run();
        if (r.error) return r;
        return r.data!.length === 1 ? { data: r.data![0], error: null } : { data: null, error: { message: "not one row" } };
      },
      then: (ok: any, bad: any) => Promise.resolve(run()).then(ok, bad),
    };
    return q;
  };
  const client = { from, rpc: async () => ({ data: { id: "conv-1", staged: true }, error: null }) };
  return { db: { client, supabase: client } as unknown as DatabaseService, writes, tables };
}

function world(over: { country?: string | null; letter?: Row | null; versions?: Row[] } = {}) {
  return {
    restaurants: [
      { id: HOUSE, name: "Tuzlu Rüzgar", country: over.country === undefined ? null : over.country },
      { id: OTHER, name: "Other House", country: null },
    ],
    communication_templates: [
      ...(over.letter === null
        ? []
        : [
            {
              id: LETTER,
              restaurant_id: HOUSE,
              type: "letter",
              category: "order_request",
              name: "Our order letter",
              body: HOUSE_WORDS,
              published_version_id: null,
              updated_by: OWNER,
              updated_at: "2026-10-08T09:00:00Z",
              ...(over.letter ?? {}),
            },
          ]),
      { id: PRICE_TPL, restaurant_id: HOUSE, type: "letter", category: "price_query", name: "Price ask", body: "Hello" },
    ],
    letter_template_versions: over.versions ?? [],
    users: [{ user_id: OWNER, name: "Deniz" }],
  } as Record<string, Row[]>;
}

const svc = (db: DatabaseService) => new HouseLettersService(db, {} as never, {} as never);

describe("order_request is the sixth purpose", () => {
  it("is in LETTER_CATEGORIES beside the five", () => {
    expect(LETTER_CATEGORIES).toEqual([
      "order_confirmation",
      "price_query",
      "delivery_dispute",
      "invoice_mismatch",
      "promotion_reply",
      "order_request",
    ]);
  });
});

describe("the composer never offers the order letter", () => {
  it("offers the five purposes, not order_request", () => {
    expect(COMPOSER_LETTER_CATEGORIES).toEqual(LETTER_CATEGORIES.filter((c) => c !== "order_request"));
    expect(COMPOSER_LETTER_CATEGORIES).toHaveLength(5);
  });

  it("the template library lists the five purposes' rows and leaves the order letter to its panel", async () => {
    const rows = await svc(store(world()).db).listTemplates(HOUSE);
    expect(rows.map((r) => r.id)).toEqual([PRICE_TPL]);
  });
});

describe("saving the order letter: owner or manager, against the STORED purpose", () => {
  it.each([["staff"], [null], [undefined], ["admin"]])("refuses %p a new order letter, writing nothing", async (role) => {
    const { db, writes } = store(world({ letter: null }));
    await expect(
      svc(db).upsertTemplate({
        restaurantId: HOUSE,
        userId: OWNER,
        role: role as string | null | undefined,
        dto: { name: "x", category: "order_request", body: HOUSE_WORDS },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes).toEqual([]);
  });

  it("refuses staff editing the order letter's row while NAMING another purpose", async () => {
    const { db, writes, tables } = store(world());
    await expect(
      svc(db).upsertTemplate({
        restaurantId: HOUSE,
        userId: OWNER,
        role: "staff",
        dto: { id: LETTER, name: "x", category: "price_query", body: "Hello there" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes).toEqual([]);
    expect(tables.communication_templates.find((r) => r.id === LETTER)!.body).toBe(HOUSE_WORDS);
  });

  it("refuses moving the order letter to another purpose, and another template into it", async () => {
    const { db, writes } = store(world());
    await expect(
      svc(db).upsertTemplate({
        restaurantId: HOUSE,
        userId: OWNER,
        role: "owner",
        dto: { id: LETTER, name: "x", category: "price_query", body: "Hello there" },
      }),
    ).rejects.toThrow(/keeps its purpose/);
    await expect(
      svc(db).upsertTemplate({
        restaurantId: HOUSE,
        userId: OWNER,
        role: "owner",
        dto: { id: PRICE_TPL, name: "x", category: "order_request", body: HOUSE_WORDS },
      }),
    ).rejects.toThrow(/cannot become the order letter/);
    expect(writes).toEqual([]);
  });

  it("leaves the five purposes open to staff, as before (ADR 0313 R2)", async () => {
    const { db, writes } = store(world());
    const r = await svc(db).upsertTemplate({
      restaurantId: HOUSE,
      userId: OWNER,
      role: "staff",
      dto: { id: PRICE_TPL, name: "Price ask", category: "price_query", body: "Hello {{vendor_name}}" },
    });
    expect(r.saved).toBe(true);
    expect(writes).toHaveLength(1);
  });

  it.each([
    ["a digit", "We need 3 more.", "numeral"],
    ["a number word", "We need twelve more.", "number_word"],
    ["a currency sign", "Prices in $ please.", "currency"],
    ["a bare domain", "See tuzlu.com for us.", "link"],
    ["a money word", "Is there a discount?", "money_or_terms_word"],
  ])("refuses words with %s, saying the class, writing nothing", async (_what, line, rule) => {
    const { db, writes } = store(world());
    const err = await svc(db)
      .upsertTemplate({
        restaurantId: HOUSE,
        userId: OWNER,
        role: "manager",
        dto: { id: LETTER, name: "x", category: "order_request", body: `${HOUSE_WORDS}\n${line}` },
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect((err.getResponse() as any).refusals.map((r: any) => r.rule)).toContain(rule);
    expect(writes).toEqual([]);
  });

  it("refuses words missing a required block", async () => {
    const { db } = store(world());
    await expect(
      svc(db).upsertTemplate({
        restaurantId: HOUSE,
        userId: OWNER,
        role: "owner",
        dto: { id: LETTER, name: "x", category: "order_request", body: "{{greeting}}\n{{order_lines}}\n{{signer}}" },
      }),
    ).rejects.toThrow(/must carry \{\{ask\}\}/);
  });

  it("refuses a subject: Mudavym writes it (R7)", async () => {
    const { db } = store(world());
    await expect(
      svc(db).upsertTemplate({
        restaurantId: HOUSE,
        userId: OWNER,
        role: "owner",
        dto: { id: LETTER, name: "x", category: "order_request", subject: "Our order", body: HOUSE_WORDS },
      }),
    ).rejects.toThrow(/subject/);
  });

  it("refuses a second order letter, naming the one the house has", async () => {
    const { db, writes } = store(world());
    await expect(
      svc(db).upsertTemplate({
        restaurantId: HOUSE,
        userId: OWNER,
        role: "owner",
        dto: { name: "Another", category: "order_request", body: HOUSE_WORDS },
      }),
    ).rejects.toThrow(new ConflictException(
      'This house already has its order letter, "Our order letter". Open that one and edit it: a house has one order letter. Nothing was saved.',
    ));
    expect(writes).toEqual([]);
  });

  it("saves a draft only: never publishes it", async () => {
    const { db, writes, tables } = store(world({ letter: null }));
    const r = await svc(db).upsertTemplate({
      restaurantId: HOUSE,
      userId: OWNER,
      role: "owner",
      dto: { name: "Ours", category: "order_request", body: HOUSE_WORDS },
    });
    expect(r).toMatchObject({ saved: true, published: false });
    expect(writes).toHaveLength(1);
    expect(writes[0].body).not.toHaveProperty("published_version_id");
    expect(writes[0].body.subject).toBeNull();
    expect(tables.letter_template_versions).toEqual([]);
  });
});

describe("preview, publish, reset, restore", () => {
  it("previews the saved draft over a priced and an unpriced example", async () => {
    const { db } = store(world());
    const p = await svc(db).previewOrderLetter({ restaurantId: HOUSE });
    expect(p.locale).toBe("en");
    expect(p.previewHash).toBe(orderLetterPreviewHash(HOUSE_WORDS, "en"));
    expect(p.samples).toHaveLength(2);
    expect(p.samples[0].body).toContain("We would like the following:");
    expect(p.samples[0].body).toMatch(/25\.00 USD/);
    expect(p.samples[1].body).not.toMatch(/USD/);
    expect(p.samples[0].subject).toMatch(/^Order PO-1042/);
  });

  it("a refused preview has no hash and no render", async () => {
    const { db } = store(world());
    const p = await svc(db).previewOrderLetter({ restaurantId: HOUSE, body: `${HOUSE_WORDS}\n3 cases` });
    expect(p.previewHash).toBeNull();
    expect(p.samples).toEqual([]);
    expect(p.refusals.map((r) => r.rule)).toContain("numeral");
  });

  it("refuses a publish whose preview was of other words, publishing nothing", async () => {
    const { db, writes } = store(world());
    await expect(
      svc(db).publishOrderLetter({
        restaurantId: HOUSE,
        userId: OWNER,
        role: "owner",
        previewHash: orderLetterPreviewHash(`${HOUSE_WORDS}\nKind regards,`, "en"),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    // and a preview in the other language does not publish this one
    await expect(
      svc(db).publishOrderLetter({
        restaurantId: HOUSE,
        userId: OWNER,
        role: "owner",
        previewHash: orderLetterPreviewHash(HOUSE_WORDS, "tr"),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(writes).toEqual([]);
  });

  it("publishes the previewed draft as version 1, then 2, and points the template at it", async () => {
    const { db, tables } = store(world());
    const s = svc(db);
    const hash = orderLetterPreviewHash(HOUSE_WORDS, "en");
    const v1 = await s.publishOrderLetter({ restaurantId: HOUSE, userId: OWNER, role: "owner", previewHash: hash });
    expect(v1).toMatchObject({ published: true, version: 1, locale: "en", kind: "publish" });
    const v2 = await s.publishOrderLetter({ restaurantId: HOUSE, userId: OWNER, role: "manager", previewHash: hash });
    expect(v2.version).toBe(2);
    const versions = tables.letter_template_versions;
    expect(versions[0]).toMatchObject({
      template_id: LETTER,
      restaurant_id: HOUSE,
      body: HOUSE_WORDS,
      body_hash: letterBodyHash(HOUSE_WORDS),
      author: OWNER,
    });
    expect(tables.communication_templates.find((r) => r.id === LETTER)!.published_version_id).toBe(v2.versionId);
  });

  it("numbers each language on its own (R4)", async () => {
    const { db } = store(world({ letter: { body: HOUSE_WORDS } }));
    const s = svc(db);
    await s.publishOrderLetter({ restaurantId: HOUSE, userId: OWNER, role: "owner", previewHash: orderLetterPreviewHash(HOUSE_WORDS, "en") });
    const tr = await s.publishOrderLetter({
      restaurantId: HOUSE,
      userId: OWNER,
      role: "owner",
      locale: "tr",
      previewHash: orderLetterPreviewHash(HOUSE_WORDS, "tr"),
    });
    expect(tr).toMatchObject({ version: 1, locale: "tr" });
  });

  it("refuses to publish a draft the prose rules refuse today", async () => {
    const bad = `${HOUSE_WORDS}\nfree delivery`;
    const { db, writes } = store(world({ letter: { body: bad } }));
    await expect(
      svc(db).publishOrderLetter({ restaurantId: HOUSE, userId: OWNER, role: "owner", previewHash: orderLetterPreviewHash(bad, "en") }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(writes).toEqual([]);
  });

  it.each([["staff"], [null]])("the service refuses %p on publish, reset and restore too", async (role) => {
    const { db, writes } = store(world());
    const s = svc(db);
    await expect(
      s.publishOrderLetter({ restaurantId: HOUSE, userId: OWNER, role: role as any, previewHash: orderLetterPreviewHash(HOUSE_WORDS, "en") }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(s.resetOrderLetter({ restaurantId: HOUSE, userId: OWNER, role: role as any })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      s.restoreOrderLetter({ restaurantId: HOUSE, userId: OWNER, role: role as any, versionId: "v" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes).toEqual([]);
  });

  it("a reset publishes the default in the house's language as a version, and puts it in the draft", async () => {
    const { db, tables } = store(world({ country: "Türkiye" }));
    const r = await svc(db).resetOrderLetter({ restaurantId: HOUSE, userId: OWNER, role: "owner" });
    expect(r).toMatchObject({ kind: "reset", locale: "tr", version: 1 });
    expect(tables.letter_template_versions[0].body).toBe(DEFAULT_ORDER_REQUEST_TEMPLATES.tr);
    const row = tables.communication_templates.find((x) => x.id === LETTER)!;
    expect(row.body).toBe(DEFAULT_ORDER_REQUEST_TEMPLATES.tr);
    expect(row.published_version_id).toBe(r.versionId);
  });

  it("nothing to reset when the house never saved its own letter", async () => {
    const { db } = store(world({ letter: null }));
    await expect(svc(db).resetOrderLetter({ restaurantId: HOUSE, userId: OWNER, role: "owner" })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("restore copies a version into the draft and publishes nothing", async () => {
    const versions = [
      { id: "v1", template_id: LETTER, restaurant_id: HOUSE, locale: "en", version: 1, kind: "publish", body: "{{greeting}}\n{{order_lines}}\n{{ask}}\n{{signer}}" },
      { id: "vx", template_id: "elsewhere", restaurant_id: OTHER, locale: "en", version: 1, kind: "publish", body: "theirs" },
    ];
    const { db, tables } = store(world({ letter: { published_version_id: null }, versions }));
    const s = svc(db);
    const r = await s.restoreOrderLetter({ restaurantId: HOUSE, userId: OWNER, role: "manager", versionId: "v1" });
    expect(r).toMatchObject({ restored: true, published: false, fromVersion: 1 });
    const row = tables.communication_templates.find((x) => x.id === LETTER)!;
    expect(row.body).toBe(versions[0].body);
    expect(row.published_version_id).toBeNull();
    expect(tables.letter_template_versions).toHaveLength(2);
    await expect(
      s.restoreOrderLetter({ restaurantId: HOUSE, userId: OWNER, role: "owner", versionId: "vx" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("the order letter's read", () => {
  it("says who may edit, what is published, and renders-from default when the published language is not the house's", async () => {
    const versions = [
      { id: "v1", template_id: LETTER, restaurant_id: HOUSE, locale: "en", version: 1, kind: "publish", body: HOUSE_WORDS, body_hash: "h", author: OWNER, created_at: "2026-10-08T10:00:00Z" },
    ];
    const asStaff = await svc(store(world({ letter: { published_version_id: "v1" }, versions })).db).orderLetter(HOUSE, "staff");
    expect(asStaff.mayEdit).toBe(false);
    expect(asStaff.rendersFrom).toBe("house");
    expect(asStaff.published).toMatchObject({ id: "v1", version: 1, by: "Deniz" });
    const asOwner = await svc(store(world({ letter: { published_version_id: "v1" }, versions })).db).orderLetter(HOUSE, "owner");
    expect(asOwner.mayEdit).toBe(true);
    const turkish = await svc(store(world({ country: "TR", letter: { published_version_id: "v1" }, versions })).db).orderLetter(HOUSE, "manager");
    expect(turkish.locale).toBe("tr");
    expect(turkish.rendersFrom).toBe("default");
  });

  it("a failed read is said, never shown as 'no letter'", async () => {
    await expect(
      svc(store(world(), { failing: ["communication_templates"] }).db).orderLetter(HOUSE, "owner"),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});

describe("OrderRequestService renders only what was published", () => {
  function orderWorld(over: Parameters<typeof world>[0] = {}) {
    return {
      ...world(over),
      procurement_orders: [
        { id: ORDER, order_number: "PO-7", restaurant_id: HOUSE, provider_id: VENDOR, created_by: null, expected_delivery_date: null },
      ],
      procurement_order_items: [
        { order_id: ORDER, restaurant_id: HOUSE, wine_name: "Yakut", quantity: 3, unit_type: "case", line_no: 1 },
      ],
      providers: [{ id: VENDOR, restaurant_id: HOUSE, contact_first_name: "Ayşe" }],
      restaurant_vendor_terms: [],
    } as Record<string, Row[]>;
  }
  const published = (over: Row = {}) => [
    {
      id: "v1",
      template_id: LETTER,
      restaurant_id: HOUSE,
      locale: "en",
      version: 1,
      body: HOUSE_WORDS.replace("We would like the following:", "Published words:"),
      ...over,
    },
  ];

  it("a saved draft that was never published is never read: the default renders", async () => {
    const { db } = store(orderWorld());
    const r = await new OrderRequestService(db).render({ orderId: ORDER, stage: false });
    expect(r.template).toEqual({ key: "order_request", source: "default" });
    expect(r.body).not.toContain("We would like the following:");
    expect(r.body).toContain("Here is our order request:");
    expect(r.templateVersion).toEqual({ id: null, version: null, hash: letterBodyHash(DEFAULT_ORDER_REQUEST_TEMPLATES.en) });
  });

  it("renders the published version (not the draft) and names it on the staged row", async () => {
    const { db } = store(orderWorld({ letter: { published_version_id: "v1" }, versions: published() }));
    const rpc: any[] = [];
    (db as any).supabase.rpc = async (fn: string, args: any) => (rpc.push(args), { data: { id: "c", staged: true }, error: null });
    const r = await new OrderRequestService(db).render({ orderId: ORDER, stage: true });
    expect(r.template.source).toBe("house");
    expect(r.body).toContain("Published words:");
    expect(r.body).not.toContain("We would like the following:");
    expect(rpc[0].p_row.email_headers).toMatchObject({
      template_source: "house",
      template_version_id: "v1",
      template_hash: letterBodyHash(published()[0].body as string),
    });
  });

  it("a version published in the other language gives the default in the house's language", async () => {
    const { db } = store(orderWorld({ country: "Türkiye", letter: { published_version_id: "v1" }, versions: published() }));
    const r = await new OrderRequestService(db).render({ orderId: ORDER, stage: false });
    expect(r.template.source).toBe("default");
    expect(r.body).toContain("Sipariş talebimiz aşağıdadır:");
  });

  it("a pointer to another house's version is a failure, not the default", async () => {
    const { db } = store(orderWorld({ letter: { published_version_id: "v1" }, versions: published({ restaurant_id: OTHER }) }));
    await expect(new OrderRequestService(db).render({ orderId: ORDER, stage: false })).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it("a failed read of the house's letter is a failure, never the default", async () => {
    const { db } = store(orderWorld(), { failing: ["communication_templates"] });
    await expect(new OrderRequestService(db).render({ orderId: ORDER, stage: false })).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
