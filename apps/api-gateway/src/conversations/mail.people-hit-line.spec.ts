/**
 * r109 mail-gap g5 at the HTTP seam: a Mail search carries the words that matched. The real
 * MailController and MailService run; the database answers list_mail_people from fixtures.
 * What the words are, and who may be quoted, is proven in SQL
 * (supabase/tests/20280106100000_a_mail_search_shows_the_words_that_matched_test.sql).
 */
import { ExecutionContext, INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DatabaseService } from "../database/database.service";
import { MailController } from "./mail.controller";
import { MailService } from "./mail.service";

const HOUSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VENDOR = "c0000000-0000-4000-8000-000000000001";

type Read = { kind: "rpc" | "from"; name: string; payload?: any };
let reads: Read[] = [];
let peopleRows: any[] = [];
let peopleFor: ((payload: any) => any[]) | null = null;
let guestHeaders: any[] = [];

function chain(r: Read): any {
  const c: any = {};
  for (const m of ["select", "eq", "in", "ilike", "or", "not", "order", "limit", "maybeSingle"]) {
    c[m] = () => c;
  }
  c.then = (ok: any, bad: any) =>
    Promise.resolve(
      r.kind === "from"
        ? {
            data: guestHeaders.length
              ? guestHeaders
              : [{ provider_id: VENDOR, providers: { id: VENDOR, name: "Ali" } }],
            error: null,
          }
        : r.name === "list_mail_people"
          ? { data: peopleFor ? peopleFor(r.payload) : peopleRows, error: null }
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
  peopleRows = [];
  peopleFor = null;
  guestHeaders = [];
});


const ROW = {
  key: `vendor:${VENDOR}`,
  kind: "vendor",
  provider_id: VENDOR,
  name: "Ali",
  last_at: "2026-11-06T09:00:00Z",
  last_line: "Thanks, all good.",
  last_direction: "inbound",
  waiting: false,
  waiting_since: null,
  open_threads: 0,
  channels: ["email"],
  newest_open_order_id: null,
  newest_open_order_number: null,
  unsent_status: null,
  awaiting_since: null,
  hit_line: "…the tahini pallet arrives Friday…",
};

describe("GET /mail/people: hitLine (g5)", () => {
  it("carries the words that matched beside the line the row already had", async () => {
    peopleRows = [ROW];
    const res = await get(`/people?q=tahini`);
    expect(res.status).toBe(200);
    expect(res.body.people[0]).toMatchObject({
      lastLine: "Thanks, all good.",
      hitLine: "…the tahini pallet arrives Friday…",
    });
  });

  it("a list with no search names no snippet, whatever the database sent", async () => {
    peopleRows = [ROW];
    const res = await get(`/people`);
    expect(res.body.people[0].hitLine).toBeNull();
  });

  it("a person found by name only has no hit line", async () => {
    peopleRows = [{ ...ROW, hit_line: null }];
    const res = await get(`/people?q=Ali`);
    expect(res.body.people[0].hitLine).toBeNull();
    peopleRows = [{ ...ROW, hit_line: "" }];
    expect((await get(`/people?q=Ali`)).body.people[0].hitLine).toBeNull();
  });

  it("staff are asked with the house's letters withheld, so the database quotes only what came in", async () => {
    peopleRows = [ROW];
    await get(`/people?q=tahini`, "staff");
    expect(reads.find((r) => r.name === "list_mail_people")!.payload).toMatchObject({
      p_withhold_house_letters: true,
      p_query: "tahini",
    });
  });

  it("a guest found by the name they write with is not quoted words of an address search", async () => {
    // The name is searched in the From headers; the list is then read again by the ADDRESS, so its
    // snippet is of the address, not of the words the reader typed.
    guestHeaders = [{ from_address: "ayse@x.example", from_header: "Ayse Demir <ayse@x.example>" }];
    peopleFor = (payload) =>
      payload.p_query === "ayse@x.example"
        ? [{ ...ROW, key: "guest:ayse@x.example", kind: "guest", provider_id: null, name: "ayse@x.example", hit_line: "…write to ayse@x.example…" }]
        : [];
    const res = await get(`/people?q=ayse&kind=guest`);
    expect(res.status).toBe(200);
    expect(res.body.people).toHaveLength(1);
    expect(res.body.people[0]).toMatchObject({ key: "guest:ayse@x.example", hitLine: null });
  });
});
