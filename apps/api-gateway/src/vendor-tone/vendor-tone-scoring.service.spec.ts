/**
 * The Jev sweep (ADR 0207, round 3): which houses it reads, what it sends, and
 * what it keeps. The real service runs over an in-memory PostgREST double that
 * honours its filters; the scorer is a recording double — the far end, not the
 * unit — so every request the sweep would send can be read back.
 */

import {
  VendorToneScoringService,
  SweepSummary,
  MAX_ATTEMPTS,
} from "./vendor-tone-scoring.service";
import type { EgressPayload } from "./tone-egress";
import type { ToneScoreOutcome, ToneScorer } from "./jev-tone.client";
import { TONE_SCALE_VERSION } from "./tone-scale";

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

const ON = "house-on";
const OFF = "house-off";
const NOW = new Date("2026-09-21T12:00:00Z");

class RecordingScorer implements ToneScorer {
  readonly name = "recording";
  sent: EgressPayload[] = [];
  answer: ToneScoreOutcome = {
    ok: true,
    score: {
      valence: 0.5,
      friction: 0.1,
      urgency: 0.2,
      commitment: 0.9,
      apology: 0,
      escalation: 0,
      confidence: 0.8,
      quoteIndex: 1,
      quoteConfidence: 0.6,
      modelVersion: "jev-1.13",
    },
  };
  constructor(private readonly key = true) {}
  available() {
    return this.key;
  }
  async score(p: EgressPayload) {
    this.sent.push(p);
    return this.answer;
  }
}

function seed(db: FakeDb) {
  db.tables.restaurants = [
    { id: OFF, vendor_tone_scoring_enabled: false },
    { id: ON, vendor_tone_scoring_enabled: true },
  ];
  db.tables.user_restaurant_access = [
    { user_id: "u-on", restaurant_id: ON },
    { user_id: "u-off", restaurant_id: OFF },
  ];
  db.tables.users = [
    { user_id: "u-on", name: "Selin Aksoy", restaurant_id: null },
    { user_id: "u-off", name: "Other Person", restaurant_id: null },
  ];
  db.tables.providers = [
    {
      id: "p-on",
      restaurant_id: ON,
      contact_first_name: "Deniz",
      contact_last_name: "Kaya",
    },
    {
      id: "p-off",
      restaurant_id: OFF,
      contact_first_name: "Nope",
      contact_last_name: "Never",
    },
  ];
  db.tables.provider_contacts = [{ provider_id: "p-on", name: "Emre Demir" }];
  const msg = (
    id: string,
    house: string,
    provider: string,
    text: string,
    over: Row = {},
  ) => ({
    id,
    restaurant_id: house,
    provider_id: provider,
    direction: "inbound",
    received_at: "2026-09-20T10:00:00Z",
    message_text: text,
    content: null,
    conversation_context: {},
    ...over,
  });
  db.tables.procurement_conversations = [
    msg("m-off", OFF, "p-off", "Nope Never here, the house that is off."),
    msg(
      "m-1",
      ON,
      "p-on",
      "Hi Selin,\nSorry, Deniz Kaya is out. Emre Demir will call you on 0532 123 45 67.\nBest,\nDeniz",
    ),
    msg("m-auto", ON, "p-on", "Weekly newsletter", {
      conversation_context: { classification: { is_automated: true } },
    }),
  ];
  db.tables.vendor_message_tone_scores = [];
}

/**
 * A double for `HouseDataTermsService`, matching only the one method the
 * sweep reads (`effectiveAcceptance`). Defaults every house to "accepted,
 * current version" so the existing switch-driven scenarios below are
 * unaffected by ADR 0207 round 4's acceptance gate; `notCurrent`/`failing`
 * let a case opt a house OUT explicitly.
 */
class StubDataTerms {
  notCurrent = new Set<string>();
  failing = new Map<string, string>();
  async effectiveAcceptance(house: string) {
    if (this.failing.has(house))
      return { ok: false as const, reason: this.failing.get(house)! };
    return { ok: true as const, current: !this.notCurrent.has(house) };
  }
}

function make(scorer = new RecordingScorer(), dataTerms = new StubDataTerms()) {
  const db = new FakeDb();
  seed(db);
  const svc = new VendorToneScoringService(
    { getClient: () => db } as never,
    scorer,
    dataTerms as never,
  );
  svc.clock = () => NOW;
  return { db, svc, scorer, dataTerms };
}

describe("the Jev sweep", () => {
  it("reads only houses that turned it on, and sends only masked text", async () => {
    const { svc, scorer, db } = make();
    const s: SweepSummary = await svc.sweep();
    expect(s).toMatchObject({
      houses: 1,
      scored: 1,
      failed: 0,
      skippedAutomated: 1,
    });
    expect(scorer.sent).toHaveLength(1);
    const wire = JSON.stringify(scorer.sent[0].body);
    for (const leak of [
      "Selin",
      "Deniz",
      "Kaya",
      "Emre",
      "Demir",
      "0532",
      "Nope",
    ])
      expect(wire).not.toContain(leak);
    // Nothing of the house that is off was read, let alone sent.
    expect(
      db.tables.vendor_message_tone_scores.map((r) => r.message_id),
    ).toEqual(["m-1"]);
  });

  it("masks the sender's own display name, a name the house's records do not hold", async () => {
    const { svc, scorer, db } = make();
    db.tables.procurement_conversations.push({
      id: "m-2",
      restaurant_id: ON,
      provider_id: "p-on",
      direction: "inbound",
      received_at: "2026-09-20T11:00:00Z",
      message_text:
        "The Barolo is delayed to Friday, sorry.\nMehmet Öztürk\nSales Manager",
      content: null,
      email_headers: { from: "Mehmet Öztürk <mehmet@kestrel.com.tr>" },
      conversation_context: {},
    });
    await svc.sweep();
    expect(scorer.sent).toHaveLength(2);
    const wire = JSON.stringify(scorer.sent.map((p) => p.body));
    for (const leak of ["Mehmet", "Öztürk", "kestrel.com.tr"])
      expect(wire).not.toContain(leak);
    expect(wire).toContain("delayed to Friday");
  });

  it("keys the score to our message id, with the scale, the model and the mask counts, and no text", async () => {
    const { svc, db } = make();
    await svc.sweep();
    const row = db.tables.vendor_message_tone_scores[0];
    expect(row).toMatchObject({
      restaurant_id: ON,
      provider_id: "p-on",
      message_id: "m-1",
      scale_version: TONE_SCALE_VERSION,
      status: "scored",
      reason: null,
      valence: 0.5,
      confidence: 0.8,
      model_requested: "jev-latest",
      model_version: "jev-1.13",
      attempts: 1,
    });
    expect(row.masked).toEqual({
      emails: 0,
      phones: 1,
      names: expect.any(Number),
      // ADR 0207 round 4 — sensitive-mask.ts counts and the list version,
      // folded into the same stored object.
      accounts: 0,
      ids: 0,
      credentials: 0,
      private: 0,
      version: "sensitive-terms/1",
    });
    expect(row.masked.names).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(row)).not.toMatch(/Sorry|Deniz|call you/);
  });

  it("writes a failed reading as a failed row with its reason, retries it, and stops at the attempt cap", async () => {
    const scorer = new RecordingScorer();
    scorer.answer = { ok: false, reason: "Jev answered HTTP 529" };
    const { svc, db } = make(scorer);
    await svc.sweep();
    expect(db.tables.vendor_message_tone_scores[0]).toMatchObject({
      status: "failed",
      reason: "Jev answered HTTP 529",
      valence: null,
      attempts: 1,
    });
    for (let i = 1; i < MAX_ATTEMPTS + 2; i++) await svc.sweep();
    expect(db.tables.vendor_message_tone_scores).toHaveLength(1);
    expect(db.tables.vendor_message_tone_scores[0].attempts).toBe(MAX_ATTEMPTS);
    expect(scorer.sent).toHaveLength(MAX_ATTEMPTS);
  });

  it("sends nothing for a house whose names could not be read", async () => {
    const { svc, scorer, db } = make();
    db.failures.provider_contacts = "statement timeout";
    const s = await svc.sweep();
    expect(scorer.sent).toHaveLength(0);
    expect(s.housesRefused).toEqual([
      { house: ON, reason: expect.stringContaining("vendor contacts") },
    ]);
    expect(db.tables.vendor_message_tone_scores).toHaveLength(0);
  });

  it("does not score a message already scored, and reads nothing without a key", async () => {
    const { svc, scorer } = make();
    await svc.sweep();
    await svc.sweep();
    expect(scorer.sent).toHaveLength(1);
    const keyless = make(new RecordingScorer(false));
    const s = await keyless.svc.sweep();
    expect(s.houses).toBe(0);
    expect(keyless.scorer.sent).toHaveLength(0);
  });
});

describe("ADR 0207 round 4 — the data terms acceptance gate", () => {
  it("sends nothing for a house whose acceptance is not the current version, even with the switch on", async () => {
    const dataTerms = new StubDataTerms();
    dataTerms.notCurrent.add(ON);
    const { svc, scorer, db } = make(new RecordingScorer(), dataTerms);
    const s = await svc.sweep();
    expect(s.houses).toBe(1); // still counted as a house whose switch is on
    expect(s.scored).toBe(0);
    expect(scorer.sent).toHaveLength(0);
    expect(db.tables.vendor_message_tone_scores).toHaveLength(0);
  });

  it("refuses (not silently skips) a house whose acceptance could not be read", async () => {
    const dataTerms = new StubDataTerms();
    dataTerms.failing.set(ON, "acceptance store timed out");
    const { svc, scorer, db } = make(new RecordingScorer(), dataTerms);
    const s = await svc.sweep();
    expect(s.housesRefused).toEqual([
      { house: ON, reason: expect.stringContaining("acceptance store timed out") },
    ]);
    expect(scorer.sent).toHaveLength(0);
    expect(db.tables.vendor_message_tone_scores).toHaveLength(0);
  });

  it("stops the NEXT call once the acceptance lapses mid-run, without failing the calls already made", async () => {
    const dataTerms = new StubDataTerms();
    const scorer = new RecordingScorer();
    const { svc, db } = make(scorer, dataTerms);
    // Two messages for ON: m-1 and (after the first call) flip the acceptance
    // so the second in-flight message is refused, same shape as the
    // switch-off mid-run case this mirrors.
    db.tables.procurement_conversations.push({
      id: "m-2",
      restaurant_id: ON,
      provider_id: "p-on",
      direction: "inbound",
      received_at: "2026-09-20T11:00:00Z",
      message_text: "Second message, also fine to read.",
      content: null,
      conversation_context: {},
    });
    // Call 1 = the house-level check (before any message is read); call 2 =
    // the first per-message re-check (m-2, read newest-first); call 3 = the
    // second per-message re-check (m-1) — made to see the lapse.
    const realAcceptance = dataTerms.effectiveAcceptance.bind(dataTerms);
    let calls = 0;
    dataTerms.effectiveAcceptance = async (house: string) => {
      calls += 1;
      if (calls > 2) dataTerms.notCurrent.add(ON);
      return realAcceptance(house);
    };
    await svc.sweep();
    expect(scorer.sent).toHaveLength(1);
  });
});
