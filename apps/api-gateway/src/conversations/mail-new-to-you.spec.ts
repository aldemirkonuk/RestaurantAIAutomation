/**
 * "New to you" in Mail (r36 mail gap 6, second half): each person's own
 * record of the newest letter they were shown on a thread, and the rows that
 * come of it.
 *
 * The real MailController and MailService run behind an HTTP seam; only
 * JwtAuthGuard is replaced, by a stub that sets request.user from test
 * headers. The database records every read and answers from the test's
 * fixtures. Nothing leaves this process. What the SQL keeps (never past the
 * thread's newest letter, never moved back) is proven in
 * supabase/tests/..._mail_remembers_what_each_person_has_seen_test.sql.
 */
import { ExecutionContext, INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DatabaseService } from "../database/database.service";
import { MailController } from "./mail.controller";
import { MailService, SEEN_FAILED, SEEN_NOT_FOUND } from "./mail.service";
import { SEEN_BAD_TIME, newToYou } from "./mail.read-rules";

const HOUSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "eeeeeeee-0000-4000-8000-000000000001";
const V1 = "c0000000-0000-4000-8000-000000000001";
const V2 = "c0000000-0000-4000-8000-000000000002";
const V3 = "c0000000-0000-4000-8000-000000000003";
const V4 = "c0000000-0000-4000-8000-000000000004";

type Read = {
  kind: "rpc" | "from";
  name: string;
  payload?: any;
  calls: Array<[string, unknown[]]>;
};
let reads: Read[] = [];
let answers: Record<string, { data: unknown; error: { message: string } | null }> = {};

function answer(r: Read) {
  return answers[r.name] ?? { data: [], error: null };
}

function chain(r: Read): any {
  const c: any = {};
  for (const m of ["select", "eq", "in", "or", "not", "order", "limit", "maybeSingle"]) {
    c[m] = (...args: unknown[]) => {
      r.calls.push([m, args]);
      return c;
    };
  }
  c.then = (ok: any, bad: any) => Promise.resolve(answer(r)).then(ok, bad);
  return c;
}

const db = {
  supabase: {
    rpc: (name: string, payload: any) => {
      const r: Read = { kind: "rpc", name, payload, calls: [] };
      reads.push(r);
      return chain(r);
    },
    from: (name: string) => {
      const r: Read = { kind: "from", name, calls: [] };
      reads.push(r);
      return chain(r);
    },
  },
};

let app: INestApplication;
let base = "";

async function call(
  method: "GET" | "POST",
  path: string,
  as: { user?: string | null; role?: string } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    "x-test-house": HOUSE,
    "x-test-role": as.role ?? "staff",
  };
  if (as.user !== null) headers["x-test-user"] = as.user ?? USER;
  const res = await fetch(`${base}/mail${path}`, { method, headers });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [MailController],
    providers: [
      MailService,
      { provide: DatabaseService, useValue: db },
      { provide: ConfigService, useValue: { get: () => undefined } },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        req.user = {
          restaurantId: req.headers["x-test-house"],
          role: req.headers["x-test-role"],
          ...(req.headers["x-test-user"] === undefined
            ? {}
            : { userId: req.headers["x-test-user"] }),
        };
        return true;
      },
    })
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  reads = [];
  answers = {};
});

function person(provider: string, lastAt: string, dir: "inbound" | "outbound") {
  return {
    key: `vendor:${provider}`,
    provider_id: provider,
    name: provider.slice(-1),
    last_at: lastAt,
    last_line: "…",
    last_direction: dir,
    waiting: false,
    waiting_since: null,
    open_threads: 0,
    channels: ["email"],
    newest_open_order_id: null,
    newest_open_order_number: null,
    unsent_status: null,
  };
}

const PEOPLE = [
  // Never opened, the vendor wrote last: new.
  person(V1, "2027-01-05 13:00:00+00", "inbound"),
  // Opened through an older letter, the vendor wrote since: new.
  person(V2, "2027-01-05 12:00:00.5+00", "inbound"),
  // Opened through this very letter (Postgres prints it two ways): not new.
  person(V3, "2027-01-05 11:00:00.123456+00", "inbound"),
  // The house wrote last: never new, and its marks are not asked for.
  person(V4, "2027-01-05 10:00:00+00", "outbound"),
];

describe("GET /mail/people says which people are new to the reader", () => {
  beforeEach(() => {
    answers.list_mail_people = { data: PEOPLE, error: null };
    answers.mail_seen_through_by_person = {
      data: [
        { provider_id: V2, seen_through: "2027-01-05T12:00:00+00:00" },
        { provider_id: V3, seen_through: "2027-01-05T11:00:00.123456+00:00" },
      ],
      error: null,
    };
  });

  it("marks only the vendor letters that came after what this person was shown", async () => {
    const res = await call("GET", "/people");
    expect(res.status).toBe(200);
    expect(res.body.people.map((p: any) => [p.providerId, p.newToYou])).toEqual([
      [V1, true],
      [V2, true],
      [V3, false],
      [V4, false],
    ]);
  });

  it("asks for this person's marks in this house, for the vendors who wrote last only", async () => {
    await call("GET", "/people");
    const seen = reads.filter((r) => r.name === "mail_seen_through_by_person");
    expect(seen).toHaveLength(1);
    expect(seen[0].payload).toEqual({
      p_restaurant_id: HOUSE,
      p_user_id: USER,
      p_provider_ids: [V1, V2, V3],
    });
  });

  it("says nothing is known, never 'not new', when the marks cannot be read; the list still answers", async () => {
    answers.mail_seen_through_by_person = { data: null, error: { message: "boom" } };
    const res = await call("GET", "/people");
    expect(res.status).toBe(200);
    expect(res.body.people.map((p: any) => p.newToYou)).toEqual([null, null, null, null]);
  });

  it("reads no marks and says nothing is known for a session that names no person", async () => {
    const res = await call("GET", "/people", { user: null });
    expect(res.body.people.map((p: any) => p.newToYou)).toEqual([null, null, null, null]);
    expect(reads.some((r) => r.name === "mail_seen_through_by_person")).toBe(false);
  });

  it("reads no marks when nobody on the page wrote last, and every row is plainly not new", async () => {
    answers.list_mail_people = { data: [PEOPLE[3]], error: null };
    const res = await call("GET", "/people");
    expect(res.body.people.map((p: any) => p.newToYou)).toEqual([false]);
    expect(reads.some((r) => r.name === "mail_seen_through_by_person")).toBe(false);
  });
});

describe("GET /mail/threads says which threads are new to the reader", () => {
  beforeEach(() => {
    answers.procurement_conversations = {
      data: [{ provider_id: V1, providers: { id: V1, name: "Ali" } }],
      error: null,
    };
    answers.list_mail_threads = {
      data: [
        { thread_key: "t:new", last_at: "2027-01-05 13:00:00+00", last_direction: "inbound", message_count: 1, letter_count: 1, waiting: true },
        { thread_key: "t:seen", last_at: "2027-01-05 12:00:00+00", last_direction: "inbound", message_count: 2, letter_count: 2, waiting: false },
        { thread_key: "t:since", last_at: "2027-01-05 11:00:00+00", last_direction: "inbound", message_count: 3, letter_count: 3, waiting: true },
        { thread_key: "t:ours", last_at: "2027-01-05 10:00:00+00", last_direction: "outbound", message_count: 1, letter_count: 1, waiting: false },
      ],
      error: null,
    };
    answers.mail_thread_seen = {
      data: [
        { thread_key: "t:seen", seen_through: "2027-01-05T12:00:00+00:00" },
        { thread_key: "t:since", seen_through: "2027-01-05T10:59:59.999+00:00" },
      ],
      error: null,
    };
  });

  it("marks each thread by its own newest letter", async () => {
    const res = await call("GET", `/threads?with=vendor:${V1}`);
    expect(res.status).toBe(200);
    expect(res.body.threads.map((t: any) => [t.key, t.newToYou])).toEqual([
      ["t:new", true],
      ["t:seen", false],
      ["t:since", true],
      ["t:ours", false],
    ]);
  });

  it("reads this person's marks for this house, this vendor and the page's vendor-last threads only", async () => {
    await call("GET", `/threads?with=vendor:${V1}`);
    const seen = reads.filter((r) => r.name === "mail_thread_seen");
    expect(seen).toHaveLength(1);
    expect(seen[0].calls).toEqual([
      ["select", ["thread_key, seen_through"]],
      ["eq", ["restaurant_id", HOUSE]],
      ["eq", ["user_id", USER]],
      ["eq", ["provider_id", V1]],
      ["in", ["thread_key", ["t:new", "t:seen", "t:since"]]],
    ]);
  });

  it("says nothing is known when the marks cannot be read", async () => {
    answers.mail_thread_seen = { data: null, error: { message: "boom" } };
    const res = await call("GET", `/threads?with=vendor:${V1}`);
    expect(res.status).toBe(200);
    expect(res.body.threads.map((t: any) => t.newToYou)).toEqual([null, null, null, null]);
  });
});

describe("POST /mail/thread/seen keeps the reader's own mark", () => {
  const THROUGH = "2027-01-05 11:00:00.123456+00";
  const path = (q: Record<string, string>) =>
    `/thread/seen?${new URLSearchParams(q).toString()}`;

  it("passes the token's house and person, the vendor and the letter's time exactly as given", async () => {
    answers.mail_thread_mark_seen = { data: "2027-01-05T11:00:00.123456+00:00", error: null };
    const res = await call("POST", path({ key: "t:one", with: `vendor:${V1.toUpperCase()}`, through: THROUGH }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      key: "t:one",
      with: `vendor:${V1}`,
      seenThrough: "2027-01-05T11:00:00.123456+00:00",
    });
    const mark = reads.filter((r) => r.name === "mail_thread_mark_seen");
    expect(mark).toHaveLength(1);
    expect(mark[0].payload).toEqual({
      p_restaurant_id: HOUSE,
      p_user_id: USER,
      p_provider_id: V1,
      p_thread_key: "t:one",
      p_through: THROUGH,
    });
  });

  it("is any member's to keep, staff included", async () => {
    answers.mail_thread_mark_seen = { data: "2027-01-05T11:00:00+00:00", error: null };
    for (const role of ["staff", "owner", "manager"]) {
      const res = await call("POST", path({ key: "t:one", with: `vendor:${V1}`, through: THROUGH }), { role });
      expect(res.status).toBe(200);
    }
  });

  it("is a 404 in words for a thread this house has no letter on with that vendor", async () => {
    answers.mail_thread_mark_seen = { data: null, error: null };
    const res = await call("POST", path({ key: "t:none", with: `vendor:${V1}`, through: THROUGH }));
    expect(res.status).toBe(404);
    expect(res.body.message).toBe(SEEN_NOT_FOUND);
  });

  it("is a 503 in words when the mark cannot be kept", async () => {
    answers.mail_thread_mark_seen = { data: null, error: { message: "boom" } };
    const res = await call("POST", path({ key: "t:one", with: `vendor:${V1}`, through: THROUGH }));
    expect(res.status).toBe(503);
    expect(res.body.message).toBe(SEEN_FAILED);
  });

  it.each([
    ["no key", { with: `vendor:${V1}`, through: THROUGH }],
    ["no person", { key: "t:one", through: THROUGH }],
    ["a person that is not a vendor key", { key: "t:one", with: V1, through: THROUGH }],
    ["no time", { key: "t:one", with: `vendor:${V1}` }],
    ["a time that is not one", { key: "t:one", with: `vendor:${V1}`, through: "yesterday" }],
    ["a time with no zone", { key: "t:one", with: `vendor:${V1}`, through: "2027-01-05 10:00:00" }],
  ])("is a 400 for %s, and writes nothing", async (_label, q) => {
    const res = await call("POST", path(q as Record<string, string>));
    expect(res.status).toBe(400);
    expect(reads.some((r) => r.name === "mail_thread_mark_seen")).toBe(false);
  });

  it("names the bad time in words", async () => {
    const res = await call("POST", path({ key: "t:one", with: `vendor:${V1}`, through: "soon" }));
    expect(res.body.message).toBe(SEEN_BAD_TIME);
  });

  it("is a 403 for a session that names no person, and writes nothing", async () => {
    const res = await call("POST", path({ key: "t:one", with: `vendor:${V1}`, through: THROUGH }), { user: null });
    expect(res.status).toBe(403);
    expect(reads.some((r) => r.name === "mail_thread_mark_seen")).toBe(false);
  });
});

describe("newToYou, the rule itself", () => {
  it("is null whenever the marks are unknown, whatever the row", () => {
    expect(newToYou("inbound", "2027-01-05 13:00:00+00", undefined, false)).toBeNull();
    expect(newToYou("outbound", "2027-01-05 13:00:00+00", undefined, false)).toBeNull();
  });

  it("is false for a row whose newest letter has no direction", () => {
    expect(newToYou(null, "2027-01-05 13:00:00+00", undefined, true)).toBe(false);
  });

  it("reads Postgres's short offsets the same as long ones", () => {
    expect(newToYou("inbound", "2027-01-05 13:00:00+0000", "2027-01-05T13:00:00+00:00", true)).toBe(false);
    expect(newToYou("inbound", "2027-01-05 13:00:01+03", "2027-01-05T10:00:00+00:00", true)).toBe(true);
  });
});
