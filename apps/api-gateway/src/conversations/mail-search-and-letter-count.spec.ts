/**
 * r28 mail gaps 14 and 16 at the HTTP seam: GET /mail/people?q= searches,
 * and a thread row says how many letters came or went.
 *
 * The real MailController and MailService run; JwtAuthGuard is a stub that
 * sets request.user from test headers, and the database records each RPC and
 * answers from fixtures. Nothing leaves this process. What the search matches
 * is proven in SQL (supabase/tests/20270421143700_…_test.sql, S1–S7).
 */
import { ExecutionContext, INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DatabaseService } from "../database/database.service";
import { MailController } from "./mail.controller";
import { MailService } from "./mail.service";
import { MAIL_SEARCH_MAX, mailSearchOf } from "./mail.read-rules";

const HOUSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VENDOR = "c0000000-0000-4000-8000-000000000001";

type Read = { kind: "rpc" | "from"; name: string; payload?: any };
let reads: Read[] = [];
let threadRows: any[] = [];

function chain(r: Read): any {
  const c: any = {};
  for (const m of ["select", "eq", "or", "not", "order", "limit", "maybeSingle"]) {
    c[m] = () => c;
  }
  c.then = (ok: any, bad: any) =>
    Promise.resolve(
      r.kind === "from"
        ? {
            data: [{ provider_id: VENDOR, providers: { id: VENDOR, name: "Ali" } }],
            error: null,
          }
        : r.name === "list_mail_threads"
          ? { data: threadRows, error: null }
          : { data: [], error: null },
    ).then(ok, bad);
  return c;
}

const db = {
  supabase: {
    rpc: (name: string, payload: any) => {
      const r: Read = { kind: "rpc", name, payload };
      reads.push(r);
      return chain(r);
    },
    from: (name: string) => {
      const r: Read = { kind: "from", name };
      reads.push(r);
      return chain(r);
    },
  },
};

let app: INestApplication;
let base = "";

async function get(path: string, role = "owner") {
  const res = await fetch(`${base}/mail${path}`, {
    headers: { "x-test-house": HOUSE, "x-test-role": role },
  });
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
          userId: "user-1",
          restaurantId: req.headers["x-test-house"],
          role: req.headers["x-test-role"],
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
  threadRows = [];
});

const peopleCall = () => reads.find((r) => r.name === "list_mail_people");

describe("GET /mail/people?q= (gap 16)", () => {
  it("hands the trimmed search to the list, with the house and role as before", async () => {
    const res = await get(`/people?q=${encodeURIComponent("  Süt Evi ")}&waiting=1`, "staff");
    expect(res.status).toBe(200);
    expect(peopleCall()!.payload).toMatchObject({
      p_restaurant_id: HOUSE,
      p_withhold_house_letters: true,
      p_waiting_only: true,
      p_query: "Süt Evi",
    });
  });

  it.each([["no q", ""], ["an empty q", "?q="], ["a blank q", "?q=%20%20%20"]])(
    "%s is the call as it was before the search: no p_query at all",
    async (_label, qs) => {
      const res = await get(`/people${qs}`);
      expect(res.status).toBe(200);
      expect(peopleCall()!.payload).not.toHaveProperty("p_query");
    },
  );

  it("a search past 100 characters is a 400 in words and never reaches the database", async () => {
    const res = await get(`/people?q=${"x".repeat(MAIL_SEARCH_MAX + 1)}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("A search is at most 100 characters.");
    expect(reads).toHaveLength(0);
  });

  it("exactly 100 characters is searched", async () => {
    const res = await get(`/people?q=${"x".repeat(MAIL_SEARCH_MAX)}`);
    expect(res.status).toBe(200);
    expect(peopleCall()!.payload.p_query).toHaveLength(MAIL_SEARCH_MAX);
  });

  it("a repeated q names no one search: a 400, no read", async () => {
    const res = await get(`/people?q=a&q=b`);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Search for one thing at a time.");
    expect(reads).toHaveLength(0);
  });

  it("the cursor of a searched page is passed through with the search", async () => {
    await get(`/people?q=fish&limit=2`);
    expect(peopleCall()!.payload).toMatchObject({ p_query: "fish", p_limit: 3 });
  });
});

describe("mailSearchOf", () => {
  it("reads null and undefined as no search, and keeps inner spaces", () => {
    expect(mailSearchOf(undefined)).toBeNull();
    expect(mailSearchOf(null)).toBeNull();
    expect(mailSearchOf(" po 12 ")).toBe("po 12");
  });
  it("refuses a number or an array", () => {
    expect(() => mailSearchOf(12)).toThrow("Search for one thing at a time.");
    expect(() => mailSearchOf(["a"])).toThrow("Search for one thing at a time.");
  });
});

describe("GET /mail/threads: letterCount (gap 14)", () => {
  const row = (over: Record<string, unknown>) => ({
    thread_key: "t-1",
    subject: "Order 12",
    message_count: 3,
    letter_count: 2,
    last_at: "2026-11-07 10:00:00+00",
    last_direction: "outbound",
    waiting: false,
    order_id: null,
    order_number: null,
    ...over,
  });

  it("says the letters that came or went, beside every row on the thread", async () => {
    threadRows = [row({})];
    const res = await get(`/threads?with=vendor:${VENDOR}`);
    expect(res.status).toBe(200);
    expect(res.body.threads[0]).toMatchObject({ messageCount: 3, letterCount: 2 });
  });

  it("a thread whose only row is a draft has no letters, and still one row", async () => {
    threadRows = [row({ message_count: 1, letter_count: 0, last_direction: null })];
    const res = await get(`/threads?with=vendor:${VENDOR}`);
    expect(res.body.threads[0]).toMatchObject({ messageCount: 1, letterCount: 0 });
  });

  it("a database older than the count falls back to the row count, never to 0", async () => {
    const { letter_count: _drop, ...old } = row({ message_count: 4 });
    threadRows = [old];
    const res = await get(`/threads?with=vendor:${VENDOR}`);
    expect(res.body.threads[0]).toMatchObject({ messageCount: 4, letterCount: 4 });
  });
});
