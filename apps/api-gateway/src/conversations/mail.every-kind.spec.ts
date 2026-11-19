/**
 * The Mail read model reads every kind it files (r77 walk w3 finding 1): a
 * team and a guest person come back with their stored kind, a letter carries
 * who it is from and to, and anyone but the house's owner or a manager reads
 * vendors only. The SQL is proven in supabase/tests/20271204100000_*_test.sql;
 * this proves what the service asks of it. The database is a recording fake.
 */
import { ServiceUnavailableException } from "@nestjs/common";
import { MailService } from "./mail.service";
import { mailKindOf, otherPersonOf } from "./mail.read-rules";

const HOUSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VENDOR = "c0000000-0000-4000-8000-000000000001";
type Q = { kind: "from" | "rpc"; name: string; payload?: any; calls: any[][] };
type R = { data: unknown; error: { message: string } | null };
let queries: Q[] = [];
let resolve: (q: Q) => R = () => ({ data: [], error: null });
const chain = (q: Q): any =>
  new Proxy({}, {
    get: (_t, m: string) =>
      m === "then"
        ? (ok: (r: R) => unknown) => Promise.resolve(resolve(q)).then(ok)
        : (...a: unknown[]) => (q.calls.push([m, ...a]), chain(q)),
  });
const start = (q: Q) => (queries.push(q), chain(q));
const db = {
  supabase: {
    from: (name: string) => start({ kind: "from", name, calls: [] }),
    rpc: (name: string, payload: unknown) => start({ kind: "rpc", name, payload, calls: [] }),
  },
};
const svc = () => new MailService(db as any, { get: () => undefined } as any);
beforeEach(() => {
  queries = [];
  resolve = () => ({ data: [], error: null });
});

const person = (kind: string, key: string, providerId: string | null) => ({
  key, kind, provider_id: providerId, name: key.split(":")[1], last_at: "2027-01-05 10:00:00+00",
  last_line: "Hi", last_direction: "inbound", waiting: false, open_threads: 1, channels: ["email"],
});
const PEOPLE = [
  person("team", "team:deniz@h.example", null),
  person("guest", "guest:g@x.example", null),
  person("vendor", `vendor:${VENDOR}`, VENDOR),
];
/** The people RPC answers; a table read for `kind` finds a row only for the kinds named. */
const stored = (kinds: string[]) => (q: Q): R => ({
  data: q.kind === "rpc" ? PEOPLE : q.calls.some((c) => c[0] === "eq" && c[1] === "kind" && kinds.includes(c[2])) ? [{ id: "x" }] : [],
  error: null,
});

describe("people", () => {
  it("come back with their stored kind, and no provider for a team or guest person", async () => {
    resolve = stored([]);
    const page = await svc().listPeople(HOUSE, "owner", {});
    expect(page.people.map((p) => [p.kind, p.providerId])).toEqual([["team", null], ["guest", null], ["vendor", VENDOR]]);
  });

  it.each([
    [[], ["vendor"]],
    [["team"], ["vendor", "team"]],
    [["guest"], ["vendor", "guest"]],
    [["team", "guest"], ["vendor", "team", "guest"]],
  ])("storedKinds follows what is stored: %p", async (kinds, expected) => {
    resolve = stored(kinds);
    expect((await svc().listPeople(HOUSE, "manager", {})).storedKinds).toEqual(expected);
    expect(queries.filter((q) => q.kind === "from").every((q) => q.calls.some((c) => c[1] === "restaurant_id" && c[2] === HOUSE))).toBe(true);
  });

  it("are vendors only to staff or a role-less token, and no table is read", async () => {
    resolve = stored(["team", "guest"]);
    for (const role of ["staff", undefined]) {
      queries = [];
      expect((await svc().listPeople(HOUSE, role, {})).storedKinds).toEqual(["vendor"]);
      expect(queries.map((q) => q.name)).toEqual(["list_mail_people"]);
      expect(queries[0].payload.p_withhold_house_letters).toBe(true);
    }
  });

  it("a failed read of what is stored is a 503, never 'vendors only'", async () => {
    resolve = (q) => (q.kind === "rpc" ? { data: [], error: null } : { data: null, error: { message: "boom" } });
    await expect(svc().listPeople(HOUSE, "owner", {})).rejects.toThrow(ServiceUnavailableException);
  });
});

describe("one team or guest person", () => {
  const WITH = "Team:Deniz@H.Example";
  const row = { id: "L1", provider_id: null, direction: "inbound", channel: "email", message_text: "Subject: Rota\nShift swap", ai_generated: false, status: "DELIVERED", received_at: "2027-01-05 11:00:00+00", created_at: "2027-01-05 11:00:00+00", at: "2027-01-05 11:00:00+00", thread_subject: "Rota", thread_waiting: false };
  const who = { id: "L1", kind: "team", from_address: "deniz@h.example", to_addresses: ["house@x.example", "ops@x.example"] };

  it("has threads read by kind and lower-cased address, and is named by its address", async () => {
    resolve = (q) => ({ data: q.kind === "rpc" ? [{ thread_key: "gm:t1", subject: "Rota", message_count: 2, letter_count: 2, last_at: "2027-01-05 11:30:00+00" }] : [{ id: "x" }], error: null });
    const page = await svc().listThreads(HOUSE, "owner", { with: WITH });
    expect(queries.find((q) => q.kind === "rpc")).toMatchObject({ name: "list_mail_threads_other", payload: { p_kind: "team", p_address: "deniz@h.example", p_withhold_house_letters: false } });
    expect(page.person).toEqual({ key: "team:deniz@h.example", kind: "team", providerId: null, name: "deniz@h.example" });
    expect(page.threads.map((t) => [t.key, t.subject, t.letterCount])).toEqual([["gm:t1", "Rota", 2]]);
  });

  it("is nobody, and no read, to a caller who may not read them", async () => {
    expect(await svc().listThreads(HOUSE, "staff", { with: WITH })).toEqual({ person: null, threads: [], next: null });
    const page = await svc().getThread(HOUSE, "staff", { key: "gm:t1", with: WITH });
    expect([page.person, page.messages, queries.length]).toEqual([null, [], 0]);
  });

  it("is nobody when the house holds no mail from that address", async () => {
    expect((await svc().listThreads(HOUSE, "owner", { with: WITH })).person).toBeNull();
  });

  it("has letters that carry their kind, sender and recipients", async () => {
    resolve = (q) => ({ data: q.kind === "rpc" ? [row] : q.name === "procurement_conversations" ? [who] : [], error: null });
    const page = await svc().getThread(HOUSE, "owner", { key: "gm:t1", with: WITH });
    expect(queries[0]).toMatchObject({ name: "mail_thread_letters_other", payload: { p_kind: "team", p_address: "deniz@h.example", p_thread_key: "gm:t1", p_withhold_house_letters: false } });
    expect(page.person?.providerId).toBeNull();
    expect(page.messages[0]).toMatchObject({ kind: "team", fromAddress: "deniz@h.example", toAddresses: ["house@x.example", "ops@x.example"], text: "Shift swap" });
    const read = queries.find((q) => q.name === "procurement_conversations")!;
    expect(read.calls).toContainEqual(["eq", "restaurant_id", HOUSE]);
    expect(read.calls).toContainEqual(["in", "id", ["L1"]]);
  });

  it("gives a vendor's letter its kind, sender and recipients too", async () => {
    resolve = (q) => ({ data: q.kind === "rpc" ? [{ ...row, provider_id: VENDOR, provider_name: "V" }] : q.name === "procurement_conversations" ? [{ ...who, kind: "vendor", from_address: "s@v.example", to_addresses: ["h@x.example"] }] : [], error: null });
    const page = await svc().getThread(HOUSE, "staff", { key: "gm:v1", with: `vendor:${VENDOR}` });
    expect(queries[0].name).toBe("mail_thread_letters");
    expect(page.messages[0]).toMatchObject({ kind: "vendor", fromAddress: "s@v.example", toAddresses: ["h@x.example"] });
  });

  it("fails the page when the addresses cannot be read, never a letter with no sender", async () => {
    resolve = (q) => (q.kind === "rpc" ? { data: [row], error: null } : q.name === "procurement_conversations" ? { data: null, error: { message: "boom" } } : { data: [], error: null });
    await expect(svc().getThread(HOUSE, "owner", { key: "gm:t1", with: WITH })).rejects.toThrow(ServiceUnavailableException);
  });
});

describe("the key rules", () => {
  it("reads a team or guest key lower-cased, and nothing else", () => {
    expect(otherPersonOf(" Guest:A@B.co ")).toEqual({ kind: "guest", address: "a@b.co" });
    for (const raw of ["", "team:", "team:nobody", `vendor:${VENDOR}`, "guest:a b@c.d", "team:a@b@c", 42, undefined]) expect(otherPersonOf(raw)).toBeNull();
  });
  it("reads a stored kind as one of three, anything else as a vendor's", () => {
    expect([mailKindOf("team"), mailKindOf("guest"), mailKindOf("x"), mailKindOf(null)]).toEqual(["team", "guest", "vendor", "vendor"]);
  });
});
