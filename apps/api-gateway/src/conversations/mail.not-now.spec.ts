/**
 * "Not now" (r110 mail, DD-r109-13): the house clock, and the HTTP seam.
 *
 * The real MailController and MailService run; JwtAuthGuard is replaced by a
 * stub that sets request.user, and the database records every RPC. The rule
 * itself (what is waiting, what ends it, whose thread it may be) is proven in
 * SQL, supabase/tests/20280125100000_a_thread_put_off_with_not_now_stops_waiting_test.sql.
 */
import { ExecutionContext, INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DatabaseService } from "../database/database.service";
import { MailController } from "./mail.controller";
import { MailService } from "./mail.service";
import { notNowUntil } from "./mail.not-now";

const at = (iso: string) => Date.parse(iso);

describe("when a thread put off comes back, on the house's clock", () => {
  it("Istanbul: tomorrow and Monday are 09:00 there (06:00Z)", () => {
    const fri = at("2026-11-27T10:00:00Z"); // Friday 13:00 in Istanbul
    expect(notNowUntil("tomorrow_9", fri, "Europe/Istanbul")).toBe("2026-11-28T06:00:00.000Z");
    expect(notNowUntil("monday_9", fri, "Europe/Istanbul")).toBe("2026-11-30T06:00:00.000Z");
  });

  it("New York across the end of summer time: 09:00 stays 09:00 (14:00Z, not 13:00Z)", () => {
    const satNoon = at("2026-10-31T16:00:00Z"); // Saturday 12:00 EDT
    expect(notNowUntil("tomorrow_9", satNoon, "America/New_York")).toBe("2026-11-01T14:00:00.000Z");
    // Monday from that Saturday is past the change too.
    expect(notNowUntil("monday_9", satNoon, "America/New_York")).toBe("2026-11-02T14:00:00.000Z");
  });

  it("Monday from a Sunday is the next day; from a Monday it is a week on", () => {
    const sun = at("2026-11-01T15:00:00Z"); // Sunday 10:00 EST
    expect(notNowUntil("monday_9", sun, "America/New_York")).toBe("2026-11-02T14:00:00.000Z");
    const mon = at("2026-11-02T15:00:00Z"); // Monday 10:00 EST
    expect(notNowUntil("monday_9", mon, "America/New_York")).toBe("2026-11-09T14:00:00.000Z");
  });

  it("the house's today, not UTC's: Sunday 23:30 in New York is already Monday in UTC", () => {
    const late = at("2026-11-02T04:30:00Z"); // Sunday 23:30 EST
    expect(notNowUntil("tomorrow_9", late, "America/New_York")).toBe("2026-11-02T14:00:00.000Z");
    expect(notNowUntil("monday_9", late, "America/New_York")).toBe("2026-11-02T14:00:00.000Z");
  });

  it("in 3 hours is elapsed time and needs no clock; a wall time with no zone is refused, never UTC", () => {
    const now = at("2026-11-01T05:30:00Z");
    expect(notNowUntil("in_3_hours", now, null)).toBe("2026-11-01T08:30:00.000Z");
    expect(notNowUntil("in_3_hours", now, "America/New_York")).toBe("2026-11-01T08:30:00.000Z");
    expect(notNowUntil("tomorrow_9", now, null)).toBeNull();
    expect(notNowUntil("monday_9", now, null)).toBeNull();
  });
});

const HOUSE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "d0000000-0000-4000-8000-0000000000aa";
const VENDOR = "c0000000-0000-4000-8000-000000000001";
const WITH = `vendor:${VENDOR}`;

type Rpc = { name: string; payload: any };
let rpcs: Rpc[] = [];
let zone: string | null = "America/New_York";
let answer: (r: Rpc) => { data: unknown; error: { message: string; code?: string } | null };

const db = {
  supabase: {
    rpc: (name: string, payload: any) => {
      const r = { name, payload };
      rpcs.push(r);
      return Promise.resolve(answer(r));
    },
    from: (table: string) => {
      let fields = "";
      const c: any = {
        // GET /mail/threads reads its person first; every other read is empty.
        then: (ok: (r: unknown) => unknown) =>
          Promise.resolve({
            data: fields.includes("providers (") ? [{ provider_id: VENDOR, providers: { id: VENDOR, name: "Vendor" } }] : [],
            error: null,
          }).then(ok),
        maybeSingle: () =>
          Promise.resolve({
            data: table === "restaurants" ? { timezone: zone, country: null } : null,
            error: null,
          }),
      };
      for (const m of ["eq", "in", "not", "or", "order", "limit"]) c[m] = () => c;
      c.select = (f: string) => ((fields = String(f)), c);
      return c;
    },
  },
};

let app: INestApplication;
let base = "";

async function call(
  method: "POST" | "DELETE" | "GET",
  path: string,
  as: { role?: string | null; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "x-test-house": HOUSE_A, "content-type": "application/json" };
  if (as.role !== null) headers["x-test-role"] = as.role ?? "owner";
  const res = await fetch(`${base}/mail${path}`, {
    method,
    headers,
    body: as.body === undefined ? undefined : JSON.stringify(as.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const q = (key: string) => `?key=${encodeURIComponent(key)}&with=${encodeURIComponent(WITH)}`;
const putOff = (choice: unknown, as: { role?: string | null } = {}, key = "gm:1") =>
  call("POST", `/thread/not-now${q(key)}`, { ...as, body: { choice } });
const takeBack = (as: { role?: string | null } = {}) => call("DELETE", `/thread/not-now${q("gm:1")}`, as);

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
          ...(req.headers["x-test-role"] === undefined ? {} : { role: req.headers["x-test-role"] }),
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
  zone = "America/New_York";
  answer = () => ({ data: true, error: null });
});

describe("POST/DELETE /mail/thread/not-now", () => {
  it.each(["owner", "manager", "Manager"])("%s puts it off, in the token's house, as the token's person", async (role) => {
    const res = await putOff("tomorrow_9", { role });
    expect(res.status).toBe(200);
    expect(res.body.key).toBe("gm:1");
    expect(res.body.with).toBe(WITH);
    const set = rpcs.find((r) => r.name === "set_mail_thread_snooze");
    expect(set?.payload).toEqual({
      p_restaurant_id: HOUSE_A,
      p_provider_id: VENDOR,
      p_thread_key: "gm:1",
      p_until: res.body.until,
      p_set_by: USER,
    });
    // 09:00 on the house's wall: 13:00Z or 14:00Z in New York, by the season.
    expect(new Date(res.body.until).getUTCMinutes()).toBe(0);
    expect([13, 14]).toContain(new Date(res.body.until).getUTCHours());
  });

  it.each([["staff"], ["waiter"], [null]])("role %p is refused in words and nothing is written", async (role) => {
    for (const res of [await putOff("in_3_hours", { role }), await takeBack({ role })]) {
      expect(res.status).toBe(403);
      expect(res.body.message).toBe("Only the house's owner or a manager can put a letter off with Not now.");
    }
    expect(rpcs).toEqual([]);
  });

  it("another house's thread (SQL P0002) is not found, in words", async () => {
    answer = (r) =>
      r.name === "set_mail_thread_snooze"
        ? { data: null, error: { message: "set_mail_thread_snooze: no such thread", code: "P0002" } }
        : { data: true, error: null };
    const res = await putOff("in_3_hours");
    expect(res.status).toBe(404);
    expect(res.body.message).toBe("That thread is not in this house's mail.");
  });

  it("any other failure is a failure, never a success", async () => {
    answer = () => ({ data: null, error: { message: "boom", code: "XX000" } });
    const res = await putOff("in_3_hours");
    expect(res.status).toBe(503);
  });

  it("a choice it does not know is refused and nothing is written", async () => {
    const res = await putOff("next_year");
    expect(res.status).toBe(400);
    expect(rpcs).toEqual([]);
  });

  it("a thread named without its vendor is refused", async () => {
    const res = await call("POST", `/thread/not-now?key=gm:1`, { body: { choice: "in_3_hours" } });
    expect(res.status).toBe(404);
    expect(rpcs).toEqual([]);
  });

  it("with no house zone, 09:00 is refused in words (never a UTC guess); in 3 hours still works", async () => {
    zone = null;
    const res = await putOff("tomorrow_9");
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/time zone isn't set/);
    expect(rpcs.find((r) => r.name === "set_mail_thread_snooze")).toBeUndefined();
    expect((await putOff("in_3_hours")).status).toBe(200);
  });

  it("DELETE takes it back for the token's house and thread", async () => {
    const res = await takeBack();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ key: "gm:1", with: WITH, until: null });
    expect(rpcs).toEqual([
      {
        name: "clear_mail_thread_snooze",
        payload: { p_restaurant_id: HOUSE_A, p_provider_id: VENDOR, p_thread_key: "gm:1" },
      },
    ]);
  });
});
