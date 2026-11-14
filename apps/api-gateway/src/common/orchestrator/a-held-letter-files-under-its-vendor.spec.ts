/**
 * r35 mail, gap 9: a held letter can reach its vendor.
 *
 * A letter the receiving server could not confirm came from its From
 * (`held_reason = sender_unconfirmed`) was held in "Who is writing" with
 * "Put away" as its only act. An owner or a manager can now say it is the
 * vendor's: `ProspectsService.fileHeldLetter` writes it as that vendor's
 * inbound letter, with its files, and marks the held row `filed`. The list
 * names that vendor beforehand (`held_vendor`).
 *
 * The store below keeps rows and applies filters, updates and deletes the
 * way PostgREST does for the calls this service makes, so a test can read
 * what the tables hold afterwards rather than which calls were made.
 */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ProspectsService } from "./prospects.service";
import { likeToRegExp } from "../../communications/testing/mail-store";

const HOUSE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const HELD = "33333333-3333-4333-8333-333333333333";
const VENDOR = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";

type Row = Record<string, any>;
type Op = "select" | "insert" | "update" | "delete";

/**
 * `fail` names `table:op` pairs whose next call answers `{ data: null, error }`.
 * `before` runs before a `table:op` call is answered (to race a write).
 */
function store(
  tables: Record<string, Row[]>,
  fail: string[] = [],
  before: Record<string, () => void> = {},
) {
  let n = 0;
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: Array<(r: Row) => boolean> = [];
    let op: Op = "select";
    let payload: any;
    let single = false;
    let returning = false;
    let lim = Infinity;
    let columns: string[] | null = null;
    const field = (r: Row, c: string) => {
      const [col, f] = c.split("->>");
      return f === undefined ? r[col] : r[col]?.[f];
    };
    const qb: any = {
      // A read returns only the columns it names, as PostgREST does.
      select: (cols?: string) => {
        if (op !== "select") returning = true;
        else if (cols && cols !== "*") columns = cols.split(",").map((c) => c.trim());
        return qb;
      },
      eq: (c: string, v: any) => (filters.push((r) => field(r, c) === v), qb),
      is: (c: string, v: any) => (
        filters.push((r) => (v === null ? field(r, c) == null : field(r, c) === v)),
        qb
      ),
      in: (c: string, v: any[]) => (filters.push((r) => v.includes(field(r, c))), qb),
      ilike: (c: string, v: string) => {
        const re = likeToRegExp(v);
        filters.push((r) => re.test(String(field(r, c) ?? "")));
        return qb;
      },
      order: () => qb,
      limit: (k: number) => ((lim = k), qb),
      single: () => ((single = true), qb),
      maybeSingle: () => ((single = true), qb),
      insert: (p: any) => ((op = "insert"), (payload = p), qb),
      update: (p: any) => ((op = "update"), (payload = p), qb),
      delete: () => ((op = "delete"), qb),
      then: (res: any, rej: any) => {
        const key = `${table}:${op}`;
        before[key]?.();
        let out: any;
        const at = fail.indexOf(key);
        if (at >= 0) {
          fail.splice(at, 1);
          out = { data: null, error: { message: `${key} refused` } };
        } else if (op === "insert") {
          const list = (Array.isArray(payload) ? payload : [payload]).map((p) => ({
            id: `${table}-${++n}`,
            ...(table === "procurement_conversations"
              ? { thread_key: p.gmail_thread_id ? `gm:${p.gmail_thread_id}` : `msg:${table}-${n}` }
              : {}),
            ...p,
          }));
          rows.push(...list);
          out = { data: single ? list[0] : list, error: null };
        } else {
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          if (op === "update") {
            for (const r of hit) Object.assign(r, payload);
            out = { data: returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
          } else if (op === "delete") {
            for (const r of hit) rows.splice(rows.indexOf(r), 1);
            out = { data: null, error: null };
          } else {
            const m = hit
              .slice(0, lim)
              .map((r) =>
                columns ? Object.fromEntries(columns.filter((c) => c in r).map((c) => [c, r[c]])) : { ...r },
              );
            out = { data: single ? (m[0] ?? null) : m, error: null };
          }
        }
        return Promise.resolve(out).then(res, rej);
      },
    };
    return qb;
  };
  return { supabase: { from } };
}

const heldRow = (o: Row = {}): Row => ({
  id: HELD,
  restaurant_id: HOUSE,
  domain: "dairy.example",
  sender_email: "orders@dairy.example",
  sender_name: "Dairy Orders",
  subject: "Invoice 2211",
  body_preview: "Please find the invoice for last week attached.",
  snippet: "Please find the invoice",
  capture_reason: "sender_unconfirmed",
  held_reason: "sender_unconfirmed",
  attachments: [
    {
      filename: "invoice-2211.pdf",
      mime_type: "application/pdf",
      size_bytes: 1234,
      storage_path: "prospects/dairy.example/abc-invoice-2211.pdf",
      sha256: "abc",
    },
  ],
  has_attachments: true,
  message_count: 1,
  status: "new",
  gmail_message_id: "gm-msg-1",
  gmail_thread_id: "gm-thread-1",
  first_seen_at: "2026-11-12T09:30:00.000Z",
  last_seen_at: "2026-11-12T09:30:00.000Z",
  ...o,
});

const vendorRow = (o: Row = {}): Row => ({
  id: VENDOR,
  restaurant_id: HOUSE,
  name: "Quiet Dairy",
  contact_email: "orders@dairy.example",
  primary_contact: {},
  deleted_at: null,
  ...o,
});

function world(o: { held?: Row[]; providers?: Row[]; contacts?: Row[]; conversations?: Row[] } = {}) {
  return {
    email_prospects: o.held ?? [heldRow()],
    providers: o.providers ?? [vendorRow()],
    provider_contacts: o.contacts ?? [],
    procurement_conversations: o.conversations ?? [],
    conversation_attachments: [] as Row[],
  };
}

const svc = (db: unknown) =>
  new ProspectsService(db as any, { get: () => undefined } as any);

describe("fileHeldLetter: a held letter is filed under the vendor a person vouches for", () => {
  it("writes it as the vendor's inbound letter and marks the held row filed", async () => {
    const t = world();
    const r = await svc(store(t)).fileHeldLetter(HOUSE, HELD, USER);
    expect(r).toEqual({
      filed: true,
      conversationId: expect.any(String),
      threadKey: "gm:gm-thread-1",
      providerId: VENDOR,
      providerName: "Quiet Dairy",
      alreadyStored: false,
    });
    expect(t.procurement_conversations).toHaveLength(1);
    const c = t.procurement_conversations[0];
    expect(c).toMatchObject({
      restaurant_id: HOUSE,
      provider_id: VENDOR,
      order_id: null,
      direction: "inbound",
      channel: "email",
      message_text: "Subject: Invoice 2211\n\nPlease find the invoice for last week attached.",
      received_at: "2026-11-12T09:30:00.000Z",
      gmail_message_id: "gm-msg-1",
      gmail_thread_id: "gm-thread-1",
      ai_generated: false,
    });
    expect(c.email_headers).toMatchObject({
      from: "orders@dairy.example",
      subject: "Invoice 2211",
      filed_from_held: {
        prospect_id: HELD,
        held_reason: "sender_unconfirmed",
        by_user_id: USER,
        words_cut: false,
      },
    });
    expect(t.email_prospects[0]).toMatchObject({ status: "filed", promoted_provider_id: VENDOR });
  });

  it("files the letter's files with it, under the vendor and no order", async () => {
    const t = world();
    const r = await svc(store(t)).fileHeldLetter(HOUSE, HELD, USER);
    expect(t.conversation_attachments).toEqual([
      expect.objectContaining({
        conversation_id: r.conversationId,
        restaurant_id: HOUSE,
        provider_id: VENDOR,
        order_id: null,
        filename: "invoice-2211.pdf",
        mime_type: "application/pdf",
        size_bytes: 1234,
        storage_path: "prospects/dairy.example/abc-invoice-2211.pdf",
        sha256: "abc",
      }),
    ]);
  });

  it("writes no files row for a letter that carried none", async () => {
    const t = world({ held: [heldRow({ attachments: [] })] });
    await svc(store(t)).fileHeldLetter(HOUSE, HELD, USER);
    expect(t.conversation_attachments).toEqual([]);
    expect(t.procurement_conversations).toHaveLength(1);
  });

  it("says the kept words were cut when the held row kept 4,000 characters", async () => {
    const t = world({ held: [heldRow({ body_preview: "x".repeat(4000) })] });
    await svc(store(t)).fileHeldLetter(HOUSE, HELD, USER);
    expect(t.procurement_conversations[0].email_headers.filed_from_held.words_cut).toBe(true);
  });

  it("files under the vendor whose contact row lists the address (the bridge's own rule)", async () => {
    const t = world({
      providers: [vendorRow({ contact_email: "sales@dairy.example" })],
      contacts: [{ provider_id: VENDOR, email: "orders@dairy.example" }],
    });
    const r = await svc(store(t)).fileHeldLetter(HOUSE, HELD, USER);
    expect(r.providerId).toBe(VENDOR);
  });

  it("answers the vendor's stored letter when the same letter is already theirs", async () => {
    const t = world({
      conversations: [
        { id: "already", restaurant_id: HOUSE, provider_id: VENDOR, gmail_message_id: "gm-msg-1", thread_key: "gm:gm-thread-1" },
      ],
    });
    const r = await svc(store(t)).fileHeldLetter(HOUSE, HELD, USER);
    expect(r).toMatchObject({ conversationId: "already", alreadyStored: true });
    expect(t.procurement_conversations).toHaveLength(1);
    expect(t.conversation_attachments).toEqual([]);
    expect(t.email_prospects[0].status).toBe("filed");
  });
});

describe("fileHeldLetter: what it refuses, and that a refusal leaves the letter held", () => {
  const refused = async (t: ReturnType<typeof world>, err: any, words: RegExp, db = store(t)) => {
    await expect(svc(db).fileHeldLetter(HOUSE, HELD, USER)).rejects.toThrow(err);
    await expect(svc(db).fileHeldLetter(HOUSE, HELD, USER)).rejects.toThrow(words);
    expect(t.procurement_conversations.filter((c) => c.id !== "already")).toEqual([]);
    expect(t.conversation_attachments).toEqual([]);
  };

  it("400 for an id that is not one", async () => {
    const t = world();
    await expect(svc(store(t)).fileHeldLetter(HOUSE, "nope", USER)).rejects.toThrow(BadRequestException);
  });

  it("404 for another house's held letter", async () => {
    const t = world({ held: [heldRow({ restaurant_id: OTHER })] });
    await refused(t, NotFoundException, /not in this house's mail/);
  });

  it("409 for a letter whose sender could not be read", async () => {
    const t = world({ held: [heldRow({ held_reason: "sender_unreadable", sender_email: null })] });
    await refused(t, ConflictException, /could not be confirmed can be filed/);
  });

  it("409 for a letter whose sender could not be read, even when an address was kept", async () => {
    const t = world({ held: [heldRow({ held_reason: "sender_unreadable" })] });
    await refused(t, ConflictException, /could not be confirmed can be filed/);
  });

  it("409 for a stranger's letter that was not held", async () => {
    const t = world({ held: [heldRow({ held_reason: null })] });
    await refused(t, ConflictException, /could not be confirmed can be filed/);
  });

  it("409 for a letter already filed", async () => {
    const t = world({ held: [heldRow({ status: "filed" })] });
    await refused(t, ConflictException, /already filed/);
  });

  it("409 for a letter that was put away", async () => {
    const t = world({ held: [heldRow({ status: "dismissed" })] });
    await refused(t, ConflictException, /put away/);
    expect(t.email_prospects[0].status).toBe("dismissed");
  });

  it("409 when no vendor lists the address", async () => {
    const t = world({ providers: [vendorRow({ contact_email: "sales@dairy.example" })] });
    await refused(t, ConflictException, /No single vendor in your book lists orders@dairy\.example/);
    expect(t.email_prospects[0]).toMatchObject({ status: "new" });
    expect(t.email_prospects[0].promoted_provider_id).toBeUndefined();
  });

  it("409 when only a removed vendor lists the address", async () => {
    const t = world({ providers: [vendorRow({ deleted_at: "2026-11-01T00:00:00Z" })] });
    await refused(t, ConflictException, /No single vendor/);
  });

  it("409 when two vendors list the address", async () => {
    const t = world({ providers: [vendorRow(), vendorRow({ id: "other-vendor", name: "Other" })] });
    await refused(t, ConflictException, /No single vendor/);
  });

  it("503 when the held letter cannot be read", async () => {
    const t = world();
    await expect(
      svc(store(t, ["email_prospects:select"])).fileHeldLetter(HOUSE, HELD, USER),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(t.email_prospects[0].status).toBe("new");
  });

  it("503 when the vendor book cannot be read, and the letter stays held", async () => {
    const t = world();
    await expect(
      svc(store(t, ["providers:select"])).fileHeldLetter(HOUSE, HELD, USER),
    ).rejects.toThrow(/vendor book could not be read/);
    expect(t.email_prospects[0].status).toBe("new");
    expect(t.procurement_conversations).toEqual([]);
  });

  it("409 when the row was put away between the read and the claim; nothing is written", async () => {
    const t = world();
    const db = store(t, [], {
      "email_prospects:update": () => {
        if (t.email_prospects[0].status === "new") t.email_prospects[0].status = "dismissed";
      },
    });
    await expect(svc(db).fileHeldLetter(HOUSE, HELD, USER)).rejects.toThrow(/a moment ago/);
    expect(t.procurement_conversations).toEqual([]);
    expect(t.email_prospects[0].status).toBe("dismissed");
  });

  it("503 when the claim cannot be written", async () => {
    const t = world();
    await expect(
      svc(store(t, ["email_prospects:update"])).fileHeldLetter(HOUSE, HELD, USER),
    ).rejects.toThrow(/could not be marked/);
    expect(t.procurement_conversations).toEqual([]);
  });

  it("503 when the vendor's mail cannot be read for a second copy; the row is held again", async () => {
    const t = world();
    await expect(
      svc(store(t, ["procurement_conversations:select"])).fileHeldLetter(HOUSE, HELD, USER),
    ).rejects.toThrow(/vendor's mail could not be read/);
    expect(t.email_prospects[0]).toMatchObject({ status: "new", promoted_provider_id: null });
    expect(t.procurement_conversations).toEqual([]);
  });

  it("503 when the letter cannot be stored; the row is held again", async () => {
    const t = world();
    await expect(
      svc(store(t, ["procurement_conversations:insert"])).fileHeldLetter(HOUSE, HELD, USER),
    ).rejects.toThrow(/it is still held/);
    expect(t.email_prospects[0]).toMatchObject({ status: "new", promoted_provider_id: null });
  });

  it("503 when its files cannot be filed; the letter is taken back out and the row held again", async () => {
    const t = world();
    await expect(
      svc(store(t, ["conversation_attachments:insert"])).fileHeldLetter(HOUSE, HELD, USER),
    ).rejects.toThrow(/files could not be filed just now; it is still held/);
    expect(t.procurement_conversations).toEqual([]);
    expect(t.email_prospects[0]).toMatchObject({ status: "new", promoted_provider_id: null });
  });

  it("says so when the half-filed letter cannot be taken back out", async () => {
    const t = world();
    await expect(
      svc(store(t, ["conversation_attachments:insert", "procurement_conversations:delete"])).fileHeldLetter(
        HOUSE,
        HELD,
        USER,
      ),
    ).rejects.toThrow(/could not be undone/);
  });
});

describe("the strangers list names the vendor a held letter would be filed under", () => {
  const stranger = (o: Row = {}) =>
    heldRow({ id: "s-1", held_reason: null, capture_reason: "offer", sender_email: "rep@new.example", ...o });

  it("names the vendor for an unconfirmed letter, and touches no other row", async () => {
    const t = world({ held: [heldRow(), stranger()] });
    const rows = await svc(store(t)).list(HOUSE);
    const held = rows.find((r) => r.id === HELD);
    const plain = rows.find((r) => r.id === "s-1");
    expect(held).toMatchObject({ held_vendor: { id: VENDOR, name: "Quiet Dairy" }, held_vendor_unread: false });
    expect(plain).not.toHaveProperty("held_vendor");
  });

  it("names no vendor when no single live vendor lists the address", async () => {
    const t = world({ providers: [vendorRow({ deleted_at: "2026-11-01T00:00:00Z" })] });
    const [row] = await svc(store(t)).list(HOUSE);
    expect(row).toMatchObject({ held_vendor: null, held_vendor_unread: false });
  });

  it("says the book was unread rather than naming no vendor", async () => {
    const t = world();
    const [row] = await svc(store(t, ["providers:select"])).list(HOUSE);
    expect(row).toMatchObject({ held_vendor: null, held_vendor_unread: true });
  });

  it("reads each row's own house across houses", async () => {
    const t = world({
      held: [heldRow({ restaurant_id: OTHER })],
      providers: [vendorRow({ restaurant_id: HOUSE })],
    });
    const [row] = await svc(store(t)).listAcross([HOUSE, OTHER]);
    expect(row).toMatchObject({ held_vendor: null });
  });

  it("names nothing for a letter whose sender could not be read", async () => {
    const t = world({ held: [heldRow({ held_reason: "sender_unreadable", sender_email: null })] });
    const [row] = await svc(store(t)).list(HOUSE);
    expect(row).not.toHaveProperty("held_vendor");
  });
});
