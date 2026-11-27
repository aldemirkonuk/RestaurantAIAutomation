/**
 * Search finds a person by the name the row shows (r105 mail-4, walk finding 2):
 * "Jane Roe" and "Sam Staff" found nobody, because SQL matches an address or a
 * letter's words and the names are read in the gateway. The name match is
 * asked only for a caller who may read team and guest people, so staff, who
 * read vendors only, can never be shown a team or guest row by a name. The
 * database is a recording fake, as mail.every-kind.spec.ts.
 */
import { ServiceUnavailableException } from "@nestjs/common";
import { MailService } from "./mail.service";

const HOUSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
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

const row = (kind: string, address: string, at = "2027-01-05T10:00:00+00:00") => ({
  key: `${kind}:${address}`, kind, provider_id: null, name: address, last_at: at,
  last_line: "Hi", last_direction: "inbound", waiting: false, open_threads: 1, channels: ["email"],
});
const GUEST = row("guest", "j@x.example");
const TEAM = row("team", "sam@h.example", "2027-01-05T09:00:00+00:00");

/** The list finds nobody by "Jane Roe"/"Sam Staff" as words; only a search for the address finds the row. */
const read = (q: Q): R => {
  if (q.kind === "rpc") {
    const addr = q.payload?.p_query;
    return { data: addr === "j@x.example" ? [GUEST] : addr === "sam@h.example" ? [TEAM] : [], error: null };
  }
  if (q.name === "user_restaurant_access") return { data: [{ user_id: "u1", role: "staff" }], error: null };
  if (q.name === "users") return { data: [{ user_id: "u1", email: "Sam@H.Example", name: "Sam Staff", role: "staff" }], error: null };
  if (q.name === "procurement_conversations" && q.calls.some((c) => c[0] === "ilike")) {
    return { data: [{ from_address: "j@x.example", from_header: "Jane Roe <j@x.example>" }], error: null };
  }
  return { data: [{ id: "x" }], error: null };
};

describe("a search by the name a row shows (r105 mail-4)", () => {
  it("finds a guest by the From name it wrote with, for an owner", async () => {
    resolve = read;
    const page = await svc().listPeople(HOUSE, "owner", { query: "Jane Roe" });
    expect(page.people.map((p) => p.key)).toEqual(["guest:j@x.example"]);
    const asked = queries.filter((q) => q.kind === "rpc").map((q) => q.payload.p_query);
    expect(asked).toEqual(["Jane Roe", "j@x.example"]);
    const names = queries.find((q) => q.calls.some((c) => c[0] === "ilike"))!;
    expect(names.calls).toContainEqual(["eq", "restaurant_id", HOUSE]);
    expect(names.calls).toContainEqual(["eq", "kind", "guest"]);
  });

  it("finds a team member by the roster name the row shows, for a manager", async () => {
    resolve = read;
    const page = await svc().listPeople(HOUSE, "manager", { query: "sam staff" });
    expect(page.people.map((p) => p.key)).toEqual(["team:sam@h.example"]);
  });

  it("is blind to accents and the Turkish dotless i", async () => {
    resolve = (q) =>
      q.name === "procurement_conversations" && q.calls.some((c) => c[0] === "ilike")
        ? { data: [{ from_address: "j@x.example", from_header: "Şükrü Ünal <j@x.example>" }], error: null }
        : read(q);
    const page = await svc().listPeople(HOUSE, "owner", { query: "sukru unal" });
    expect(page.people.map((p) => p.key)).toEqual(["guest:j@x.example"]);
  });

  it("lists a person once when the address and the name both match, newest first", async () => {
    resolve = (q) =>
      q.kind === "rpc" && q.payload.p_query === "Jane"
        ? { data: [TEAM, GUEST].reverse(), error: null }
        : read(q);
    const page = await svc().listPeople(HOUSE, "owner", { query: "Jane" });
    expect(page.people.map((p) => p.key)).toEqual(["guest:j@x.example", "team:sam@h.example"]);
  });

  it("shows staff nobody by name: no roster or header read, and no row but vendors'", async () => {
    resolve = read;
    for (const role of ["staff", null, undefined, "waiter"]) {
      queries = [];
      const page = await svc().listPeople(HOUSE, role as any, { query: "Jane Roe" });
      expect(page.people).toEqual([]);
      expect(queries.filter((q) => q.kind === "rpc")).toHaveLength(1);
      expect(queries.some((q) => q.name === "users" || q.name === "user_restaurant_access")).toBe(false);
      expect(queries.some((q) => q.calls.some((c) => c[0] === "ilike"))).toBe(false);
    }
  });

  it("asks nothing extra for a vendor search, a list with no search, or waiting only", async () => {
    resolve = read;
    await svc().listPeople(HOUSE, "owner", { query: "Jane Roe", kind: "vendor" });
    await svc().listPeople(HOUSE, "owner", {});
    await svc().listPeople(HOUSE, "owner", { query: "Jane Roe", waitingOnly: true });
    expect(queries.filter((q) => q.kind === "rpc")).toHaveLength(3);
    expect(queries.some((q) => q.name === "users")).toBe(false);
  });

  it("a failed name read is a 503, never a list that quietly lacks the person", async () => {
    resolve = (q) =>
      q.name === "procurement_conversations" && q.calls.some((c) => c[0] === "ilike")
        ? { data: null, error: { message: "boom" } }
        : read(q);
    await expect(svc().listPeople(HOUSE, "owner", { query: "Jane Roe" })).rejects.toThrow(ServiceUnavailableException);
  });
});
