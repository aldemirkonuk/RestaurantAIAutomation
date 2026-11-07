/**
 * GET /mail/* at the HTTP seam: whose house, and what the caller's role changes.
 *
 * The app below runs the real MailController and the real MailService. Only
 * JwtAuthGuard is replaced, by a stub that sets the request.user shape
 * JwtStrategy.validate returns (userId, restaurantId, role) from test headers.
 * The database records every RPC and table read and answers from fixtures, so
 * the test sees exactly which house and which withholding each read asked for.
 * Nothing leaves this process.
 */
import { ExecutionContext, INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { DatabaseService } from "../database/database.service";
import { MailController } from "./mail.controller";
import { MailService } from "./mail.service";

const HOUSE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOUSE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VENDOR = "c0000000-0000-4000-8000-000000000001";

type Read = {
  kind: "rpc" | "from";
  name: string;
  payload?: any;
  calls: Array<[string, unknown[]]>;
};
let reads: Read[] = [];
let failWith: string | null = null;

function answer(r: Read) {
  if (failWith) return { data: null, error: { message: failWith } };
  if (r.kind === "rpc" && r.name === "mail_inbox_summary") {
    return {
      data: [
        {
          waiting_people: 0,
          oldest_wait_at: null,
          in_today: 0,
          out_today: 0,
          house_mailbox_last_at: null,
          whatsapp_last_at: null,
          mudavym_mail_last_at: null,
        },
      ],
      error: null,
    };
  }
  if (r.kind === "from") {
    return {
      data: [{ provider_id: VENDOR, providers: { id: VENDOR, name: "Ali" } }],
      error: null,
    };
  }
  return { data: [], error: null };
}

function chain(r: Read): any {
  const c: any = {};
  for (const m of ["select", "eq", "or", "not", "order", "limit"]) {
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

async function get(
  path: string,
  as: { house?: string | null; role?: string | null } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (as.house !== null) headers["x-test-house"] = as.house ?? HOUSE_A;
  if (as.role !== null) headers["x-test-role"] = as.role ?? "owner";
  const res = await fetch(`${base}/mail${path}`, { headers });
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
          // A token with no role claim carries no `role` at all.
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
  reads = [];
  failWith = null;
});

const ROUTES = [
  ["/people", "list_mail_people"],
  [`/threads?with=vendor:${VENDOR}`, "list_mail_threads"],
  ["/summary", "mail_inbox_summary"],
  ["/thread?key=t-1", "mail_thread_letters"],
] as const;

describe("the house comes from the token and nowhere else", () => {
  it.each(ROUTES)(
    "%s reads the token's house, ignoring ?restaurantId",
    async (path, rpc) => {
      const sep = path.includes("?") ? "&" : "?";
      const res = await get(`${path}${sep}restaurantId=${HOUSE_B}`);
      expect(res.status).toBe(200);
      const call = reads.find((r) => r.name === rpc)!;
      expect(call.payload.p_restaurant_id).toBe(HOUSE_A);
      expect(JSON.stringify(reads)).not.toContain(HOUSE_B);
    },
  );

  it("/thread is one read, of the token's house only", async () => {
    const res = await get(`/thread?key=t-1&restaurantId=${HOUSE_B}`);
    expect(res.status).toBe(200);
    expect(reads.map((r) => `${r.kind}:${r.name}`)).toEqual([
      "rpc:mail_thread_letters",
    ]);
    expect(reads[0].payload).toMatchObject({
      p_restaurant_id: HOUSE_A,
      p_thread_key: "t-1",
      p_provider_id: null,
    });
    expect(JSON.stringify(reads)).not.toContain(HOUSE_B);
  });

  it("/thread?with= names that person to the read as well", async () => {
    const res = await get(`/thread?key=gm%3Ashared&with=vendor%3A${VENDOR}`);
    expect(res.status).toBe(200);
    expect(reads).toHaveLength(1);
    expect(reads[0].payload).toMatchObject({
      p_restaurant_id: HOUSE_A,
      p_thread_key: "gm:shared",
      p_provider_id: VENDOR,
    });
  });

  it("/thread with a repeated `with` is an empty page, not a crash", async () => {
    const res = await get(
      `/thread?key=t-1&with=vendor%3A${VENDOR}&with=vendor%3A${VENDOR}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
    expect(reads).toHaveLength(0);
  });

  it.each(["/people", "/threads?with=x", "/thread?key=t-1", "/summary"])(
    "%s: a session that names no house is a 403 in words and reads nothing",
    async (path) => {
      const res = await get(path, { house: null });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe("This session names no restaurant.");
      expect(reads).toHaveLength(0);
    },
  );
});

describe("the role is enforced in the service, not by a decorator", () => {
  it("no route and not the class carries @Roles", () => {
    expect(Reflect.getMetadata(ROLES_KEY, MailController)).toBeUndefined();
    for (const name of ["people", "threads", "thread", "summary"]) {
      expect(
        Reflect.getMetadata(ROLES_KEY, (MailController.prototype as any)[name]),
      ).toBeUndefined();
    }
  });

  it.each([
    ["owner", false],
    ["manager", false],
    ["staff", true],
    ["waiter", true],
    [null, true],
  ])("role %p reads with withholding %p", async (role, withhold) => {
    for (const [path, rpc] of ROUTES) {
      reads = [];
      const res = await get(path, { role });
      expect(res.status).toBe(200);
      expect(
        reads.find((r) => r.name === rpc)!.payload.p_withhold_house_letters,
      ).toBe(withhold);
    }
  });
});

describe("errors are said in words", () => {
  it("a malformed cursor is a 400", async () => {
    const res = await get("/people?after=%25%25");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not one this list made/);
    expect(reads).toHaveLength(0);
  });

  it("a page size that is not a whole number is a 400", async () => {
    const res = await get("/people?limit=ten");
    expect(res.status).toBe(400);
  });

  it.each([
    "/people",
    `/threads?with=vendor:${VENDOR}`,
    "/thread?key=t-1",
    "/summary",
  ])("%s: a database failure is a 503, never an empty list", async (path) => {
    failWith = "connection reset";
    const res = await get(path);
    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/could not be read/);
    expect(JSON.stringify(res.body)).not.toContain("connection reset");
  });
});
