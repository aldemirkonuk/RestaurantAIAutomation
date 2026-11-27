import { SetupReminderService } from "./setup-reminder.service";
import { hashUnsubscribeToken } from "../analytics/digest/digest-schedule";

/** DD-r108-57. An in-memory PostgREST, so the conditional claim is real. */
type Rec = Record<string, any>;

class FakeDb {
  /** Runs before each plain read of a table: a write that lands between reads. */
  beforeRead?: (table: string) => void;
  constructor(public tables: Record<string, Rec[]>) {}
  getClient() {
    return { from: (t: string) => new Query(this.tables, t, this.beforeRead) };
  }
}

class Query implements PromiseLike<{ data: Rec[] | null; error: null }> {
  private filters: Array<(r: Rec) => boolean> = [];
  private patch: Rec | null = null;
  private max = Infinity;
  constructor(
    private tables: Record<string, Rec[]>,
    private table: string,
    private beforeRead?: (table: string) => void,
  ) {}
  select() { return this; }
  update(patch: Rec) { this.patch = patch; return this; }
  eq(k: string, v: unknown) { this.filters.push((r) => r[k] === v); return this; }
  is(k: string, v: null) { this.filters.push((r) => (r[k] ?? null) === v); return this; }
  lte(k: string, v: string) { this.filters.push((r) => r[k] <= v); return this; }
  gt(k: string, v: string) { this.filters.push((r) => r[k] > v); return this; }
  in(k: string, v: unknown[]) { this.filters.push((r) => v.includes(r[k])); return this; }
  order() { return this; }
  limit(n: number) { this.max = n; return this; }
  then<A, B>(ok?: (v: { data: Rec[] | null; error: null }) => A, bad?: (e: unknown) => B) {
    if (!this.patch) this.beforeRead?.(this.table);
    const hit = (this.tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r))).slice(0, this.max);
    if (this.patch) for (const r of hit) Object.assign(r, this.patch);
    return Promise.resolve({ data: hit.map((r) => ({ ...r })), error: null }).then(ok, bad);
  }
}

const NOW = new Date("2026-11-27T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function world(over: { progress?: Rec; user?: Rec; role?: string } = {}) {
  return {
    user_onboarding_progress: [
      {
        id: "p-1",
        user_id: "u-1",
        restaurant_id: "h-1",
        menu_uploaded: false,
        setup_reminder_opt_out: false,
        setup_reminder_sent_at: null,
        created_at: hoursAgo(25),
        ...over.progress,
      },
    ],
    users: [{ user_id: "u-1", email: "selin@example.com", name: "Selin Kaya", email_verified: true, ...over.user }],
    user_restaurant_access: [
      { user_id: "u-1", restaurant_id: "h-1", role: over.role ?? "owner", is_active: true, valid_until: null },
    ],
    restaurants: [{ id: "h-1", name: "Meyhane" }],
  };
}

function build(tables: Record<string, Rec[]>) {
  const db = new FakeDb(tables);
  const gmail = { sendEmail: jest.fn().mockResolvedValue({ success: true, messageId: "m-1" }) };
  const config = {
    get: (k: string) =>
      ({ API_PUBLIC_URL: "https://api.example/", FRONTEND_URL: "https://app.example,https://other.example" } as Rec)[k],
  };
  const service = new SetupReminderService(db as any, gmail as any, config as any);
  return { service, gmail, db };
}

describe("SetupReminderService.runOnce", () => {
  it("23 h after opening: nothing yet", async () => {
    const { service, gmail } = build(world({ progress: { created_at: hoursAgo(23) } }));
    await service.runOnce(NOW);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("25 h after opening: one letter, to /get-started, with its unsubscribe link", async () => {
    const { service, gmail, db } = build(world());
    const tally = await service.runOnce(NOW);
    expect(tally.sent).toBe(1);
    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
    const mail = gmail.sendEmail.mock.calls[0][0];
    expect(mail.to).toEqual(["selin@example.com"]);
    expect(mail.html).toContain('href="https://app.example/get-started"');
    expect(mail.listUnsubscribe.url).toMatch(/^https:\/\/api\.example\/api\/v1\/house\/setup-reminder\/unsubscribe\/[0-9a-f]{64}$/);
    const row = db.tables.user_onboarding_progress[0];
    expect(row.setup_reminder_sent_at).toBe(NOW.toISOString());
    expect(row.setup_reminder_token_hash).toBe(hashUnsubscribeToken(mail.listUnsubscribe.url.split("/").pop()));
  });

  it("a second run sends nothing more", async () => {
    const { service, gmail } = build(world());
    await service.runOnce(NOW);
    await service.runOnce(new Date(NOW.getTime() + 3_600_000));
    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("a failed send is not retried: one letter, ever", async () => {
    const { service, gmail } = build(world());
    gmail.sendEmail.mockResolvedValueOnce({ success: false, error: "quota" });
    expect((await service.runOnce(NOW)).failed).toBe(1);
    await service.runOnce(new Date(NOW.getTime() + 3_600_000));
    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("staff: none, and the row is not claimed", async () => {
    const { service, gmail, db } = build(world({ role: "staff" }));
    expect((await service.runOnce(NOW)).skipped).toBe(1);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(db.tables.user_onboarding_progress[0].setup_reminder_sent_at).toBeNull();
  });

  it.each([
    ["past 72 h", { progress: { created_at: hoursAgo(73) } }],
    ["a menu read", { progress: { menu_uploaded: true } }],
    ["opted out", { progress: { setup_reminder_opt_out: true } }],
    ["an unverified address", { user: { email_verified: false } }],
  ])("%s: none", async (_why, over) => {
    const { service, gmail } = build(world(over));
    await service.runOnce(NOW);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("two instances at once: one letter", async () => {
    const tables = world();
    const a = build(tables);
    const b = build(tables);
    const [ta, tb] = await Promise.all([a.service.runOnce(NOW), b.service.runOnce(NOW)]);
    expect(ta.candidates + tb.candidates).toBe(2);
    expect(a.gmail.sendEmail.mock.calls.length + b.gmail.sendEmail.mock.calls.length).toBe(1);
    expect(ta.lostClaim + tb.lostClaim).toBe(1);
  });

  it("no public origin: nothing claimed, nothing sent", async () => {
    const tables = world();
    const gmail = { sendEmail: jest.fn() };
    const service = new SetupReminderService(new FakeDb(tables) as any, gmail as any, { get: () => undefined } as any);
    await service.runOnce(NOW);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(tables.user_onboarding_progress[0].setup_reminder_sent_at).toBeNull();
  });
});

// r109 onboarding-r109-5: the claim re-checks what the sweep read, so a write
// between the two (the menu read, the owner's opt-out) sends nothing.
describe("SetupReminderService.runOnce, a write between the read and the claim", () => {
  it.each([
    ["the menu is read", { menu_uploaded: true }],
    ["the owner opts out", { setup_reminder_opt_out: true }],
    ["another instance stamps it", { setup_reminder_sent_at: NOW.toISOString() }],
  ])("%s: no letter, the claim is lost", async (_why, patch) => {
    const { service, gmail, db } = build(world());
    db.beforeRead = (table) => {
      if (table === "users") Object.assign(db.tables.user_onboarding_progress[0], patch);
    };
    const tally = await service.runOnce(NOW);
    expect(tally).toMatchObject({ candidates: 1, sent: 0, lostClaim: 1 });
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(db.tables.user_onboarding_progress[0].setup_reminder_token_hash).toBeUndefined();
  });
});

describe("SetupReminderService.sweep", () => {
  it("is off until SETUP_REMINDER_SEND_ENABLED is set", async () => {
    const { service, gmail } = build(world());
    await service.sweep();
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it.each(["", "false", "0", "yes", "on", "ture"])(
    "SETUP_REMINDER_SEND_ENABLED=%j stays off: nothing read, nothing sent",
    async (raw) => {
      const tables = world();
      const gmail = { sendEmail: jest.fn() };
      const env: Rec = { API_PUBLIC_URL: "https://api.example", FRONTEND_URL: "https://app.example", SETUP_REMINDER_SEND_ENABLED: raw };
      const service = new SetupReminderService(new FakeDb(tables) as any, gmail as any, { get: (k: string) => env[k] } as any);
      const run = jest.spyOn(service, "runOnce");
      await service.sweep();
      expect(run).not.toHaveBeenCalled();
      expect(gmail.sendEmail).not.toHaveBeenCalled();
    },
  );

  it.each(["true", "1", " TRUE "])("SETUP_REMINDER_SEND_ENABLED=%j arms it", async (raw) => {
    const tables = world();
    const gmail = { sendEmail: jest.fn().mockResolvedValue({ success: true }) };
    const env: Rec = { API_PUBLIC_URL: "https://api.example", FRONTEND_URL: "https://app.example", SETUP_REMINDER_SEND_ENABLED: raw };
    const service = new SetupReminderService(new FakeDb(tables) as any, gmail as any, { get: (k: string) => env[k] } as any);
    await service.sweep();
    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe("the unsubscribe link", () => {
  it("GET changes nothing; POST sets this row's opt-out", async () => {
    const { service, gmail, db } = build(world());
    await service.runOnce(NOW);
    const token = gmail.sendEmail.mock.calls[0][0].listUnsubscribe.url.split("/").pop();
    expect(await service.readLink(token)).toEqual({ kind: "active", houseName: "Meyhane" });
    expect(db.tables.user_onboarding_progress[0].setup_reminder_opt_out).toBe(false);
    expect(await service.stopByLink(token)).toEqual({ kind: "stopped", houseName: "Meyhane" });
    expect(db.tables.user_onboarding_progress[0].setup_reminder_opt_out).toBe(true);
  });

  it("a malformed or unknown token opens nothing", async () => {
    const { service } = build(world());
    expect(await service.stopByLink("nope")).toEqual({ kind: "malformed" });
    expect(await service.stopByLink("a".repeat(64))).toEqual({ kind: "unknown" });
  });
});
