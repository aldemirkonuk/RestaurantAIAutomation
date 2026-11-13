/**
 * "This letter needs no reply" (r28 mail audit, gap 4) at the HTTP seam.
 *
 * Before this, Mail had no act at all: a thread stopped waiting only when a
 * letter the house sent landed in it, so a vendor's "Thanks!" kept "N vendors
 * are waiting on you" up for good. POST/DELETE /mail/letters/:id/no-reply-needed
 * set and take back the mark; GET /mail/thread says whether the thread waits
 * and when each letter was marked.
 *
 * The real MailController and MailService run; JwtAuthGuard is replaced by a
 * stub that sets the request.user shape JwtStrategy.validate returns, and the
 * database records every RPC and answers from what the test sets. What may be
 * marked (this house's received letters only) is proven in SQL, in
 * supabase/tests/20270421143700_the_mail_list_is_read_by_person_test.sql NR1-NR8.
 */
import { ExecutionContext, INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DatabaseService } from "../database/database.service";
import { MailController } from "./mail.controller";
import { MailService } from "./mail.service";

const HOUSE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOUSE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "d0000000-0000-4000-8000-0000000000aa";
const LETTER = "e8000000-0000-4000-8000-000000000003";
const VENDOR = "c0000000-0000-4000-8000-000000000001";

type Rpc = { name: string; payload: any };
let rpcs: Rpc[] = [];
let answer: (r: Rpc) => { data: unknown; error: { message: string } | null } =
  () => ({ data: "marked", error: null });

const db = {
  supabase: {
    rpc: (name: string, payload: any) => {
      const r = { name, payload };
      rpcs.push(r);
      return Promise.resolve(answer(r));
    },
    from: () => {
      throw new Error("no table is read by these routes");
    },
  },
};

let app: INestApplication;
let base = "";

async function call(
  method: "POST" | "DELETE" | "GET",
  path: string,
  as: { house?: string | null; role?: string | null } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (as.house !== null) headers["x-test-house"] = as.house ?? HOUSE_A;
  if (as.role !== null) headers["x-test-role"] = as.role ?? "owner";
  const res = await fetch(`${base}/mail${path}`, { method, headers });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const mark = (id: string, as?: { house?: string | null; role?: string | null }) =>
  call("POST", `/letters/${id}/no-reply-needed`, as);
const unmark = (id: string, as?: { house?: string | null; role?: string | null }) =>
  call("DELETE", `/letters/${id}/no-reply-needed`, as);

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
          userId: USER,
          restaurantId: req.headers["x-test-house"],
          ...(req.headers["x-test-role"] === undefined
            ? {}
            : { role: req.headers["x-test-role"] }),
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
  rpcs = [];
  answer = (r) => ({
    data: r.name === "mail_letter_mark_no_reply" ? "marked" : "unmarked",
    error: null,
  });
});

describe("who may say a letter needs no reply", () => {
  it.each(["owner", "manager", "Owner"])(
    "%s marks it, in the token's house, as the token's person",
    async (role) => {
      const res = await mark(LETTER, { role });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: LETTER, marked: true });
      expect(rpcs).toEqual([
        {
          name: "mail_letter_mark_no_reply",
          payload: {
            p_restaurant_id: HOUSE_A,
            p_conversation_id: LETTER,
            p_marked_by: USER,
          },
        },
      ]);
    },
  );

  it.each([["staff"], ["waiter"], [null]])(
    "role %p is refused in words and nothing is written",
    async (role) => {
      for (const res of [await mark(LETTER, { role }), await unmark(LETTER, { role })]) {
        expect(res.status).toBe(403);
        expect(res.body.message).toBe(
          "Only the house's owner or a manager can say a letter needs no reply.",
        );
      }
      expect(rpcs).toHaveLength(0);
    },
  );

  it("a session that names no house is refused and writes nothing", async () => {
    const res = await mark(LETTER, { house: null });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("This session names no restaurant.");
    expect(rpcs).toHaveLength(0);
  });

  it("the house is never the request's", async () => {
    const res = await call(
      "POST",
      `/letters/${LETTER}/no-reply-needed?restaurantId=${HOUSE_B}`,
    );
    expect(res.status).toBe(200);
    expect(rpcs[0].payload.p_restaurant_id).toBe(HOUSE_A);
    expect(JSON.stringify(rpcs)).not.toContain(HOUSE_B);
  });
});

describe("what the answer says", () => {
  it("an id that is not a letter id is a 400 and reads nothing", async () => {
    const res = await mark("not-a-letter");
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("That letter is not in this house's mail.");
    expect(rpcs).toHaveLength(0);
  });

  it("another house's letter, or none, is a 404 in words", async () => {
    answer = () => ({ data: "not_found", error: null });
    for (const res of [await mark(LETTER), await unmark(LETTER)]) {
      expect(res.status).toBe(404);
      expect(res.body.message).toBe("That letter is not in this house's mail.");
    }
  });

  it("a letter the house sent is a 409 in words", async () => {
    answer = () => ({ data: "not_received", error: null });
    const res = await mark(LETTER);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(
      "Only a letter the house received can be marked as needing no reply.",
    );
  });

  it("taking a mark back answers marked:false, twice or once", async () => {
    for (const outcome of ["unmarked", "not_marked"]) {
      answer = () => ({ data: outcome, error: null });
      rpcs = [];
      const res = await unmark(LETTER, { role: "manager" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: LETTER, marked: false });
      expect(rpcs).toEqual([
        {
          name: "mail_letter_unmark_no_reply",
          payload: { p_restaurant_id: HOUSE_A, p_conversation_id: LETTER },
        },
      ]);
    }
  });

  it("a database failure is a 503 that says nothing changed, never the cause", async () => {
    answer = () => ({ data: null, error: { message: "connection reset" } });
    const res = await mark(LETTER);
    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/nothing changed/);
    expect(JSON.stringify(res.body)).not.toContain("connection reset");
    // An error is never a success, whatever answer came with it.
    answer = () => ({ data: "marked", error: { message: "timeout" } });
    expect((await mark(LETTER)).status).toBe(503);
  });

  it("an outcome this code does not know is not a success", async () => {
    answer = () => ({ data: null, error: null });
    const res = await mark(LETTER);
    expect(res.status).toBe(503);
  });
});

describe("the thread says whether it waits, and which letter was marked", () => {
  const row = (over: Record<string, unknown>) => ({
    id: LETTER,
    provider_id: VENDOR,
    provider_name: "Ali",
    direction: "inbound",
    channel: "email",
    message_text: "Thanks!",
    ai_generated: false,
    status: "RECEIVED",
    sent_at: null,
    received_at: "2027-02-01T11:00:00+00:00",
    created_at: "2027-02-01T11:00:00+00:00",
    at: "2027-02-01T11:00:00+00:00",
    raw_deleted_at: null,
    mirrored_by_grant_id: null,
    thread_subject: "Friday order",
    order_id: null,
    order_number: null,
    order_status: null,
    automatic: false,
    no_reply_marked_at: null,
    thread_waiting: false,
    ...over,
  });

  it("a marked letter carries its time; the page says it does not wait", async () => {
    answer = () => ({
      data: [row({ no_reply_marked_at: "2027-02-01T11:05:00.123456+00:00" })],
      error: null,
    });
    const res = await call("GET", "/thread?key=gm%3Anr");
    expect(res.status).toBe(200);
    expect(res.body.waiting).toBe(false);
    expect(res.body.messages[0].noReplyMarkedAt).toBe(
      "2027-02-01T11:05:00.123456+00:00",
    );
  });

  it("a waiting thread says so; an unmarked letter is null, not absent", async () => {
    answer = () => ({ data: [row({ thread_waiting: true })], error: null });
    const res = await call("GET", "/thread?key=gm%3Anr");
    expect(res.body.waiting).toBe(true);
    expect(res.body.messages[0]).toHaveProperty("noReplyMarkedAt", null);
  });

  it("an empty thread does not wait", async () => {
    answer = () => ({ data: [], error: null });
    const res = await call("GET", "/thread?key=gm%3Anone");
    expect(res.body.waiting).toBe(false);
  });
});
