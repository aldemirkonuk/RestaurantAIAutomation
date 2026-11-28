/**
 * The HTTP seam the thread-notes specs share (r110 mail-gap g5). The real
 * MailController and MailService run behind main.ts's ValidationPipe; only
 * JwtAuthGuard is stubbed (userId, restaurantId, role from test headers). The
 * database is a recording fake that answers per table.
 */
import { ExecutionContext, INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DatabaseService } from "../database/database.service";
import { MailController } from "./mail.controller";
import { MailService } from "./mail.service";

export const HOUSE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const HOUSE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const VENDOR = "c0000000-0000-4000-8000-000000000001";
export const V2 = "c0000000-0000-4000-8000-000000000002";
export const AYSE = "e0000000-0000-4000-8000-0000000000a1";
export const MEHMET = "e0000000-0000-4000-8000-0000000000b2";
export const NOTE = "f0000000-0000-4000-8000-000000000001";

export type Read = { kind: "rpc" | "from"; name: string; payload?: any; calls: Array<[string, unknown[]]> };
export type Answer = { data?: unknown; error?: { message: string } | null; count?: number | null };

/** What the fake database was asked, and how it answers; each test sets `answer`. */
export const fake: { reads: Read[]; answer: (r: Read) => Answer } = {
  reads: [],
  answer: () => ({ data: [], error: null }),
};

function chain(r: Read): any {
  const c: any = new Proxy(
    {},
    {
      get(_t, m: string) {
        if (m === "then") {
          return (ok: any, bad: any) =>
            Promise.resolve()
              .then(() => fake.answer(r))
              .then((a) => ({ data: a.data ?? null, error: a.error ?? null, count: a.count ?? null }))
              .then(ok, bad);
        }
        return (...args: unknown[]) => {
          r.calls.push([m, args]);
          return c;
        };
      },
    },
  );
  return c;
}

const db = {
  supabase: {
    rpc: (name: string, payload: any) => {
      const r: Read = { kind: "rpc", name, payload, calls: [] };
      fake.reads.push(r);
      return chain(r);
    },
    from: (name: string) => {
      const r: Read = { kind: "from", name, calls: [] };
      fake.reads.push(r);
      return chain(r);
    },
  },
};

export const has = (r: Read, m: string, ...args: unknown[]) =>
  r.calls.some(([name, a]) => name === m && JSON.stringify(a) === JSON.stringify(args));
export const named = (name: string) => fake.reads.filter((r) => r.name === name);
export const isWrite = (r: Read) => r.calls.some(([m]) => m === "insert" || m === "update" || m === "delete" || m === "upsert");

let app: INestApplication;
let base = "";

export async function call(
  method: string,
  path: string,
  opts: { role?: string | null; user?: string; house?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    "x-test-house": opts.house ?? HOUSE_A,
    "x-test-user": opts.user ?? AYSE,
    "content-type": "application/json",
  };
  if (opts.role !== null) headers["x-test-role"] = opts.role ?? "owner";
  const res = await fetch(`${base}/mail${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** The real MailController and MailService on a port, for one spec file. */
export function useNotesApp(): void {
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
          userId: req.headers["x-test-user"],
          restaurantId: req.headers["x-test-house"],
          ...(req.headers["x-test-role"] === undefined ? {} : { role: req.headers["x-test-role"] }),
        };
        return true;
      },
    })
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  // As main.ts: the body must pass the global pipe untouched.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  fake.reads = [];
  fake.answer = () => ({ data: [], error: null });
});
}

export const stored = (over: Record<string, unknown> = {}) => ({
  id: NOTE,
  body: "They promised a credit on the phone",
  written_by: AYSE,
  created_at: "2026-11-27 10:00:00+00",
  ...over,
});

/** A house with live notes counted, the write echoing its row, and the writers' names. */
export const writing =
  (count: number | null, over: { countError?: boolean; insertError?: boolean } = {}) =>
  (r: Read): Answer => {
    if (r.name === "users") return { data: [{ user_id: AYSE, name: "Ayşe" }] };
    if (r.name !== "mail_thread_notes") return { data: [] };
    if (r.calls.some(([m]) => m === "insert")) {
      return over.insertError ? { error: { message: "boom" } } : { data: [stored()] };
    }
    return over.countError ? { error: { message: "boom" } } : { count };
  };
