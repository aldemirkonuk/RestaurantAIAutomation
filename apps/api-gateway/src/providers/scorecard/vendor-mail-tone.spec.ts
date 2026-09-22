/**
 * "How their mail reads" — A plus C's line, owners and managers only (ADR
 * 0207, round 3; the founder, 2026-09-21: "A, Plus C's lines", "Vendor sheet
 * only", staff never see it).
 *
 * The builder is pure and run directly; the route runs the real controller,
 * the real service and the real OrganizationsService over an in-memory
 * PostgREST double that honours its filters, seeded with a second house whose
 * rows are cross-linked to the first house's vendor.
 */

import { ForbiddenException, NotFoundException } from "@nestjs/common";
import {
  InboundMessageRow,
  MIN_READ,
  ToneScoreRow,
  buildMailToneSection,
  readingOf,
} from "./vendor-mail-tone";
import { VendorMailToneService } from "./vendor-mail-tone.service";
import { VendorScorecardController } from "./vendor-scorecard.controller";
import { OrganizationsService } from "../../organizations/organizations.service";
import { TONE_SCALE_VERSION } from "../../vendor-tone/tone-scale";

type Row = Record<string, any>;

/**
 * A PostgREST double that HONOURS the filters it is handed (a stub that
 * returned fixed rows would pass with every house clause deleted) and records
 * every write. Per-table failures stand in for a register that refuses.
 */
class FakeQuery {
  private filters: ((r: Row) => boolean)[] = [];
  private rangeFrom = 0;
  private rangeTo: number | null = null;
  private limitN: number | null = null;
  private single = false;
  private orderKey: string | null = null;
  private desc = false;
  private write: {
    kind: "insert" | "upsert" | "update";
    row: Row;
    keys?: string[];
  } | null = null;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  select() {
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  is(col: string, v: unknown) {
    this.filters.push((r) => (r[col] ?? null) === v);
    return this;
  }
  not(col: string, op: string, v: unknown) {
    if (op !== "is" || v !== null) throw new Error(`fake: not(${col}, ${op})`);
    this.filters.push((r) => (r[col] ?? null) !== null);
    return this;
  }
  ilike(col: string, v: string) {
    this.filters.push(
      (r) => String(r[col] ?? "").toLowerCase() === v.toLowerCase(),
    );
    return this;
  }
  gte(col: string, v: string) {
    this.filters.push((r) => r[col] != null && String(r[col]) >= v);
    return this;
  }
  lte(col: string, v: string) {
    this.filters.push((r) => r[col] != null && String(r[col]) <= v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    if (this.orderKey === null) {
      this.orderKey = col;
      this.desc = opts?.ascending === false;
    }
    return this;
  }
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  insert(row: Row) {
    this.write = { kind: "insert", row };
    return this;
  }
  upsert(row: Row, opts?: { onConflict?: string }) {
    this.write = { kind: "upsert", row, keys: opts?.onConflict?.split(",") };
    return this;
  }
  update(row: Row) {
    this.write = { kind: "update", row };
    return this;
  }
  then(
    resolve: (v: { data: any; error: any }) => unknown,
    reject?: (e: unknown) => unknown,
  ) {
    try {
      return Promise.resolve(resolve(this.run())).catch(reject);
    } catch (e) {
      return Promise.reject(e).catch(reject);
    }
  }
  private run(): { data: any; error: any } {
    const fail = this.db.failures[this.table];
    if (fail) return { data: null, error: { code: "57014", message: fail } };
    if (this.write) {
      this.db.writes.push({ table: this.table, ...this.write });
      const t = (this.db.tables[this.table] ??= []);
      const w = this.write;
      if (w.kind === "update") {
        for (const r of t)
          if (this.filters.every((f) => f(r))) Object.assign(r, w.row);
      } else if (w.kind === "upsert" && w.keys) {
        const hit = t.find((r) => w.keys!.every((k) => r[k] === w.row[k]));
        if (hit) Object.assign(hit, w.row);
        else t.push({ ...w.row });
      } else t.push({ ...w.row });
      return { data: null, error: null };
    }
    let rows = (this.db.tables[this.table] ?? []).filter((r) =>
      this.filters.every((f) => f(r)),
    );
    if (this.orderKey) {
      const k = this.orderKey;
      rows = [...rows].sort((a, b) => String(a[k]).localeCompare(String(b[k])));
      if (this.desc) rows.reverse();
    }
    if (this.rangeTo !== null)
      rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    if (this.single) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }
}

class FakeDb {
  tables: Record<string, Row[]> = {};
  failures: Record<string, string> = {};
  writes: { table: string; kind: string; row: Row }[] = [];
  from(table: string) {
    return new FakeQuery(this, table);
  }
  get supabase() {
    return this;
  }
  get client() {
    return this;
  }
  getClient() {
    return this;
  }
}

const NOW = new Date("2026-09-21T12:00:00Z");
let seq = 0;
function inbound(
  at: string,
  over: Partial<InboundMessageRow> = {},
): InboundMessageRow {
  seq += 1;
  return {
    id: `m-${seq}`,
    received_at: at,
    message_text: `Thanks for the order. We can deliver Monday, message ${seq}.`,
    email_headers: { subject: `Re: PO-${seq}` },
    detected_sentiment: "neutral",
    conversation_context: {},
    ...over,
  };
}
function score(id: string, over: Partial<ToneScoreRow> = {}): ToneScoreRow {
  return {
    message_id: id,
    status: "scored",
    reason: null,
    valence: "0.60",
    friction: "0.05",
    confidence: "0.90",
    quote_index: 1,
    ...over,
  };
}
const build = (
  over: Partial<Parameters<typeof buildMailToneSection>[0]> = {},
) =>
  buildMailToneSection({
    providerId: "p",
    days: 90,
    now: NOW,
    jevOn: false,
    jevAvailable: false,
    mail: { ok: true, rows: [] },
    scores: null,
    ...over,
  });
const day = (d: number) =>
  new Date(NOW.getTime() - d * 86_400_000).toISOString();

describe("one message's reading", () => {
  it("with the switch off, renames the inbound model's label and quotes its line only if it is verbatim", () => {
    const own = inbound(day(1), {
      detected_sentiment: "negative",
      message_text: "We cannot do that price. Please stop asking.",
      conversation_context: { analysis: { tone_quote: "Please stop asking." } },
    });
    expect(readingOf(own, false, undefined)).toMatchObject({
      word: "terse",
      quote: "Please stop asking.",
      readBy: "inbound_model",
    });
    const invented = {
      ...own,
      conversation_context: { analysis: { tone_quote: "You are rude." } },
    };
    expect(readingOf(invented, false, undefined)).toMatchObject({
      word: "terse",
      quote: null,
      quoteMissing: "the read kept no line for this one",
    });
  });

  it("with the switch on, reads Jev's word and the vendor's own sentence at the picked index", () => {
    const m = inbound(day(1));
    expect(readingOf(m, true, score(m.id))).toMatchObject({
      word: "warm",
      quote: `We can deliver Monday, message ${seq}.`,
      readBy: "jev",
    });
  });

  it("reads a Jev failure as not assessed — never the inbound model's word in its place", () => {
    const m = inbound(day(1), { detected_sentiment: "positive" });
    const r = readingOf(
      m,
      true,
      score(m.id, {
        status: "failed",
        reason: "Jev answered HTTP 529",
        valence: null,
        confidence: null,
      }),
    );
    expect(r.word).toBeNull();
    expect(r.notAssessed).toBe(
      "not assessed — Jev could not read it (Jev answered HTTP 529)",
    );
  });

  it("reads an unsure Jev score, automated mail and a message with no label as not assessed", () => {
    const m = inbound(day(1));
    expect(
      readingOf(m, true, score(m.id, { confidence: "0.30" })).notAssessed,
    ).toContain("unsure");
    expect(
      readingOf(
        inbound(day(1), {
          conversation_context: { classification: { is_automated: true } },
        }),
        true,
        undefined,
      ).notAssessed,
    ).toBe("not assessed — automated mail");
    expect(
      readingOf(inbound(day(1), { detected_sentiment: null }), false, undefined)
        .notAssessed,
    ).toBe("not assessed — no reading was kept for this one");
  });

  it("with the switch on and no Jev row yet, falls back to the inbound model's label", () => {
    expect(
      readingOf(
        inbound(day(1), { detected_sentiment: "positive" }),
        true,
        undefined,
      ),
    ).toMatchObject({
      word: "warm",
      readBy: "inbound_model",
    });
  });
});

describe("the section's honest states", () => {
  it("no mail yet", () => {
    const s = build();
    expect(s.state).toBe("no_mail");
    expect(s.messages).toEqual([]);
    expect(s.note).toContain("An empty inbox is not a quiet vendor.");
  });

  it("could not read — the mail or Jev's readings failing, never 'no mail'", () => {
    expect(build({ mail: { ok: false, reason: "57014 timeout" } }).state).toBe(
      "could_not_read",
    );
    const s = build({
      jevOn: true,
      mail: { ok: true, rows: [inbound(day(1))] },
      scores: { ok: false, reason: "Jev's readings did not answer" },
    });
    expect(s.state).toBe("could_not_read");
    expect(s.messages).toEqual([]);
  });

  it("tone not assessed — the messages are listed with no word on them", () => {
    const rows = [1, 2, 3].map((d) =>
      inbound(day(d), { detected_sentiment: null }),
    );
    const s = build({ mail: { ok: true, rows } });
    expect(s.state).toBe("not_assessed");
    expect(s.messages).toHaveLength(3);
    expect(s.note).toContain("Unread is not plain.");
  });

  it("too few — the messages are shown with their words, and no comparison is drawn", () => {
    const rows = [1, 2].map((d) => inbound(day(d)));
    const s = build({ mail: { ok: true, rows } });
    expect(s.state).toBe("too_few");
    expect(s.messages.map((m) => m.word)).toEqual(["plain", "plain"]);
    expect(s.comparison).toBeNull();
  });

  it("answered, newest first, with C's sentence only when BOTH windows hold 5 read", () => {
    const cur = [1, 2, 3, 4, 5, 6].map((d) =>
      inbound(day(d), { detected_sentiment: d === 1 ? "negative" : "neutral" }),
    );
    const prior4 = [100, 101, 102, 103].map((d) =>
      inbound(day(d), { detected_sentiment: "positive" }),
    );
    const s4 = build({ mail: { ok: true, rows: [...prior4, ...cur] } });
    expect(s4.state).toBe("answered");
    expect(s4.messages[0].word).toBe("terse");
    expect(s4.comparison).toBeNull();
    const prior5 = [
      ...prior4,
      inbound(day(104), { detected_sentiment: "positive" }),
    ];
    const s5 = build({ mail: { ok: true, rows: [...prior5, ...cur] } });
    expect(s5.comparison).toBe(
      `Both windows have ${MIN_READ} or more read, so they are set side by side: 1 of 6 terse against 0 of 5, 0 of 6 warm against 5 of 5, and 5 of 6 plain against 0 of 5. Each is a count of messages, not a trend.`,
    );
    expect(s5.standing).toBe(
      "90 d · 6 messages · a model read 6 · no person has checked one · in no figure above",
    );
  });

  it("returns no number of the point scale, and no direction word", () => {
    const rows = [1, 2, 3, 4, 5].map((d) => inbound(day(d)));
    const s = build({
      jevOn: true,
      jevAvailable: true,
      mail: { ok: true, rows },
      scores: { ok: true, rows: rows.map((r) => score(r.id)) },
    });
    const wire = JSON.stringify(s);
    expect(wire).not.toMatch(
      /valence|friction|confidence|0\.6|0\.9|improving|declining|%/,
    );
    expect(s.jev).toBe("on");
    expect(s.standing).toContain(
      "read by Jev, with names removed before it left",
    );
  });
});

// ---------------------------------------------------------------------------
// The route: owners and managers only, house-scoped
// ---------------------------------------------------------------------------

const A = "house-A";
const B = "house-B";
const PA = "prov-A";

function seedRoute(db: FakeDb) {
  db.tables.restaurants = [
    { id: B, vendor_tone_scoring_enabled: true },
    { id: A, vendor_tone_scoring_enabled: false },
  ];
  db.tables.providers = [
    { id: PA, restaurant_id: A, deleted_at: null },
    { id: "prov-B", restaurant_id: B, deleted_at: null },
  ];
  db.tables.user_restaurant_access = [
    { user_id: "owner-a", restaurant_id: A, role: "owner", is_active: true },
    {
      user_id: "manager-a",
      restaurant_id: A,
      role: "manager",
      is_active: true,
    },
    { user_id: "staff-a", restaurant_id: A, role: "staff", is_active: true },
    { user_id: "owner-b", restaurant_id: B, role: "owner", is_active: true },
  ];
  db.tables.users = [];
  const row = (id: string, house: string, sentiment: string) => ({
    id,
    restaurant_id: house,
    provider_id: PA,
    direction: "inbound",
    received_at: day(2),
    message_text: "Thanks. We can deliver Monday.",
    content: null,
    email_headers: {},
    detected_sentiment: sentiment,
    conversation_context: {},
  });
  db.tables.procurement_conversations = [
    // House B's messages stamped with house A's vendor: a read that lost its
    // house clause would put them on house A's sheet.
    row("b-1", B, "negative"),
    row("b-2", B, "negative"),
    row("a-1", A, "positive"),
  ];
  db.tables.vendor_message_tone_scores = [
    {
      restaurant_id: B,
      message_id: "a-1",
      scale_version: TONE_SCALE_VERSION,
      status: "failed",
      reason: "x",
      valence: null,
      friction: null,
      confidence: null,
      quote_index: null,
    },
  ];
}

function route() {
  const db = new FakeDb();
  seedRoute(db);
  const mail = new VendorMailToneService({ getClient: () => db } as never);
  mail.clock = () => NOW;
  const orgs = new OrganizationsService({ supabase: db } as never);
  const controller = new VendorScorecardController({} as never, mail, orgs);
  return { db, controller };
}

describe("GET /vendor-scorecard/:id/mail", () => {
  it("answers an owner and a manager with house A's mail alone", async () => {
    const { controller } = route();
    for (const userId of ["owner-a", "manager-a"]) {
      const s = await controller.mail({ userId, restaurantId: A }, PA, "90");
      expect(s.messages.map((m) => m.id)).toEqual(["a-1"]);
      expect(s.messages[0].word).toBe("warm");
      expect(s.jev).toBe("off");
    }
  });

  it("refuses staff with 403 before anything is read", async () => {
    const { controller, db } = route();
    db.failures.procurement_conversations = "must not be read";
    await expect(
      controller.mail({ userId: "staff-a", restaurantId: A }, PA, "90"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.mail({ userId: "owner-b", restaurantId: A }, PA, "90"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("answers another house's vendor with 404 — the same answer as no vendor", async () => {
    const { controller } = route();
    await expect(
      controller.mail({ userId: "owner-a", restaurantId: A }, "prov-B", "90"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("reads this house's switch, not another's, and this house's Jev rows only", async () => {
    const { controller, db } = route();
    db.tables.restaurants.find((r) => r.id === A)!.vendor_tone_scoring_enabled =
      true;
    const s = await controller.mail(
      { userId: "owner-a", restaurantId: A },
      PA,
      "90",
    );
    expect(s.jev).toBe("on_unavailable");
    // House B's failed row on house A's message is not house A's reading.
    expect(s.messages[0]).toMatchObject({
      id: "a-1",
      word: "warm",
      readBy: "inbound_model",
    });
  });

  it("says the mail could not be read when it could not — never 'no mail yet'", async () => {
    const { controller, db } = route();
    db.failures.procurement_conversations = "statement timeout";
    const s = await controller.mail(
      { userId: "owner-a", restaurantId: A },
      PA,
      "90",
    );
    expect(s.state).toBe("could_not_read");
    expect(s.reason).toContain("statement timeout");
  });
});
