/**
 * Every /conversations/:conversationId route, and GET /conversations/pending/list,
 * at the HTTP seam — the caller's house and the caller's role (ADR 0147, ADR 0116,
 * ADR 0162, ADR 0171).
 *
 * Before this, approve, edit, reject, summarize and the by-id read took no
 * `@CurrentUser` and updated or read `procurement_conversations` by `id` alone, so
 * any signed-in user of any house who held a conversation id could approve, rewrite
 * or reject another house's vendor message, and `pending/list` listed every house's.
 *
 * The app below runs the real controller, the real ConversationsService and the
 * real RolesGuard. Only JwtAuthGuard is replaced by a stub that sets the
 * request.user shape JwtStrategy.validate returns (userId, restaurantId, role).
 * The database is an in-memory table that HONOURS every `.eq` filter and reports
 * which rows an update really changed, so a route that drops its house filter
 * changes another house's row here and the test sees it. Only axios (the event
 * publish) is mocked. Nothing leaves this process.
 */
import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import axios from "axios";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { DatabaseService } from "../database/database.service";
import { ConversationsController } from "./conversations.controller";
import { ConversationsService } from "./conversations.service";
import { SealChallengeService } from "../common/seal/seal-challenge.service";
import { VendorSendAuthorityService } from "../organizations/vendor-send-authority.service";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

const HOUSE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOUSE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONV_A = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const CONV_B = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
const MISSING = "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0";

type Row = Record<string, any>;

let table: Row[] = [];
/** Every update the fake database applied: which rows it really changed. */
let applied: Array<{ ids: string[]; patch: Row }> = [];
/** When set, every query against the table fails with this database text. */
let failWith: string | null = null;

function seed() {
  table = [
    {
      id: CONV_A,
      restaurant_id: HOUSE_A,
      order_id: "o-a",
      delivery_status: "pending",
      manager_approval_status: "pending",
      manager_approved_message: null,
      message_text: "House A asks the vendor for 12 cases",
      paused_at: new Date(Date.now() - 60_000).toISOString(),
    },
    {
      id: CONV_B,
      restaurant_id: HOUSE_B,
      order_id: "o-b",
      delivery_status: "pending",
      manager_approval_status: "pending",
      manager_approved_message: null,
      message_text: "House B asks the vendor for 40 cases",
      paused_at: new Date(Date.now() - 60_000).toISOString(),
    },
  ];
  applied = [];
  failWith = null;
}

/** A chainable query over `table`; `.eq` filters are real, not recorded-and-ignored. */
function makeBuilder() {
  const filters: Array<[string, unknown]> = [];
  let patch: Row | null = null;
  const matching = () =>
    table.filter((r) => filters.every(([col, val]) => r[col] === val));
  const run = () => {
    if (failWith) return { data: null, error: { message: failWith } };
    // Postgres refuses a non-uuid against a uuid column (22P02); it does not
    // quietly match nothing. The service must not hand it one.
    const badId = filters.find(
      ([col, val]) => col === "id" && !/^[0-9a-f-]{36}$/i.test(String(val)),
    );
    if (badId) {
      return {
        data: null,
        error: {
          message: `invalid input syntax for type uuid: "${badId[1]}"`,
        },
      };
    }
    const rows = matching();
    if (patch) {
      for (const r of rows) Object.assign(r, patch);
      applied.push({ ids: rows.map((r) => r.id), patch });
      return { data: rows.map((r) => ({ id: r.id })), error: null };
    }
    return { data: rows, error: null };
  };
  const b: any = {
    select: () => b,
    order: () => b,
    eq: (col: string, val: unknown) => {
      filters.push([col, val]);
      return b;
    },
    update: (row: Row) => {
      patch = row;
      return b;
    },
    maybeSingle: async () => {
      const res: any = run();
      if (res.error) return res;
      return { data: res.data[0] ?? null, error: null };
    },
    single: async () => {
      const res: any = run();
      if (res.error) return res;
      return res.data.length === 1
        ? { data: res.data[0], error: null }
        : { data: null, error: { message: "no rows" } };
    },
    then: (resolve: any, reject: any) =>
      Promise.resolve(run()).then(resolve, reject),
  };
  return b;
}

const db = { supabase: { from: jest.fn(() => makeBuilder()) } };

/*
 * The approve route's two gates (ADR 0175 D9/D10, 2026-09-21). WHO is a stand-in
 * keyed on the role this spec's token carries — the real rule is exercised in
 * organizations/vendor-send-authority.spec.ts and
 * procurement/staff-ask-manager-sends.spec.ts — and admits the three standings
 * D10 names: owner, manager and grantee. The seal is a recorder that accepts
 * exactly the token "good": what is asserted is that approve REACHES it, over
 * the words it would release, before anything is written.
 */
let tokenRole = "manager";
const authority = {
  assertMaySend: jest.fn(async () => {
    if (["owner", "manager", "grantee"].includes(tokenRole)) {
      return { mode: "send", basis: tokenRole === "grantee" ? "grant" : tokenRole, grant: null, role: tokenRole };
    }
    throw new ForbiddenException("Nothing was sent. Only an owner, a manager, or someone an owner has named may approve this message to the vendor with one hold. Ask an owner or a manager to do it.");
  }),
};
const seal = {
  issue: jest.fn(async (p: any) => ({ challenge: "good", expiresAt: "t", action: p.action })),
  redeem: jest.fn(async (p: any) => {
    if (p.challenge !== "good") throw new ForbiddenException("That seal is absent or not this one. Nothing was changed.");
    return { sealId: "seal-1" };
  }),
};

let app: INestApplication;
let base: string;

async function call(
  method: "GET" | "POST" | "PUT",
  path: string,
  as: { house?: string | null; role?: string; seal?: string | null },
  body?: unknown,
): Promise<{ status: number; body: any }> {
  tokenRole = as.role ?? "manager";
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-test-role": as.role ?? "manager",
  };
  if (as.seal !== null) headers["x-seal-challenge"] = as.seal ?? "good";
  if (as.house !== null) headers["x-test-house"] = as.house ?? HOUSE_A;
  const res = await fetch(`${base}/conversations${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* a non-JSON body is kept as text */
  }
  return { status: res.status, body: parsed };
}

const rowOf = (id: string) => table.find((r) => r.id === id)!;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ConversationsController],
    providers: [
      ConversationsService,
      { provide: DatabaseService, useValue: db },
      { provide: SealChallengeService, useValue: seal },
      { provide: VendorSendAuthorityService, useValue: authority },
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
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  jest.clearAllMocks();
  seed();
  mockedAxios.post.mockResolvedValue({ status: 200, data: {} });
});

const APPROVE_BODY = {
  approved: true,
  modified_message: "Send 400 cases to my account",
  approval_channel: "web_app",
};

describe("a foreign conversation id answers 404 and changes nothing", () => {
  it("POST approve — and never rewrites the message or publishes to the agent", async () => {
    const res = await call(
      "POST",
      `/${CONV_B}/approve`,
      { house: HOUSE_A },
      APPROVE_BODY,
    );
    expect(res.status).toBe(404);
    expect(rowOf(CONV_B).manager_approved_message).toBeNull();
    expect(rowOf(CONV_B).manager_approval_status).toBe("pending");
    expect(applied.flatMap((a) => a.ids)).not.toContain(CONV_B);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("POST approve with approved:false takes the reject path and is still a 404", async () => {
    const res = await call(
      "POST",
      `/${CONV_B}/approve`,
      { house: HOUSE_A },
      { approved: false, approval_channel: "web_app" },
    );
    expect(res.status).toBe(404);
    expect(rowOf(CONV_B).manager_approval_status).toBe("pending");
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("PUT message — the vendor text is not rewritten", async () => {
    const res = await call(
      "PUT",
      `/${CONV_B}/message`,
      { house: HOUSE_A },
      {
        new_message: "Wire the money to this account",
      },
    );
    expect(res.status).toBe(404);
    expect(rowOf(CONV_B).manager_approved_message).toBeNull();
    expect(applied.flatMap((a) => a.ids)).not.toContain(CONV_B);
  });

  it("POST reject — the other house's message is not rejected", async () => {
    const res = await call(
      "POST",
      `/${CONV_B}/reject`,
      { house: HOUSE_A },
      {
        reason: "no",
      },
    );
    expect(res.status).toBe(404);
    expect(rowOf(CONV_B).manager_approval_status).toBe("pending");
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("POST summarize — nothing is queued for the other house", async () => {
    const res = await call("POST", `/${CONV_B}/summarize`, { house: HOUSE_A });
    expect(res.status).toBe(404);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("GET :conversationId — the other house's message is not read", async () => {
    const res = await call("GET", `/${CONV_B}`, { house: HOUSE_A });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("House B");
  });

  it("answers a foreign id exactly as it answers an id that does not exist", async () => {
    for (const [method, suffix, body] of [
      ["GET", "", undefined],
      ["POST", "/approve", APPROVE_BODY],
      ["PUT", "/message", { new_message: "x" }],
      ["POST", "/reject", { reason: "x" }],
      ["POST", "/summarize", undefined],
    ] as const) {
      const foreign = await call(
        method,
        `/${CONV_B}${suffix}`,
        { house: HOUSE_A },
        body,
      );
      const missing = await call(
        method,
        `/${MISSING}${suffix}`,
        { house: HOUSE_A },
        body,
      );
      expect(foreign.status).toBe(404);
      expect(foreign).toEqual(missing);
    }
  });

  it("answers a malformed id 404, not a database error", async () => {
    const res = await call("GET", `/not-a-uuid`, { house: HOUSE_A });
    expect(res.status).toBe(404);
  });
});

describe("the caller's own house still works", () => {
  it("approve records the approval and the manager's edit, then publishes", async () => {
    const res = await call(
      "POST",
      `/${CONV_A}/approve`,
      { house: HOUSE_A },
      APPROVE_BODY,
    );
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(rowOf(CONV_A).manager_approval_status).toBe("modified");
    expect(rowOf(CONV_A).manager_approved_message).toBe(
      APPROVE_BODY.modified_message,
    );
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(rowOf(CONV_B).manager_approved_message).toBeNull();
  });

  it("edit and reject write only the caller's row", async () => {
    const edit = await call(
      "PUT",
      `/${CONV_A}/message`,
      { house: HOUSE_A },
      {
        new_message: "Ten cases, please",
      },
    );
    expect(edit.status).toBe(200);
    expect(rowOf(CONV_A).manager_approved_message).toBe("Ten cases, please");
    const rej = await call(
      "POST",
      `/${CONV_A}/reject`,
      { house: HOUSE_A },
      {
        reason: "too dear",
      },
    );
    expect(rej.status).toBe(201);
    expect(rowOf(CONV_A).manager_approval_status).toBe("rejected");
    expect(applied.flatMap((a) => a.ids).every((id) => id === CONV_A)).toBe(
      true,
    );
  });

  it("the by-id read and summarize answer for the caller's own row", async () => {
    const got = await call("GET", `/${CONV_A}`, { house: HOUSE_A });
    expect(got.status).toBe(200);
    expect(got.body.conversation_id).toBe(CONV_A);
    const sum = await call("POST", `/${CONV_A}/summarize`, { house: HOUSE_A });
    expect(sum.status).toBe(201);
    expect(sum.body.success).toBe(true);
  });

  it("pending/list returns this house's rows only, never another's", async () => {
    const a = await call("GET", "/pending/list", { house: HOUSE_A });
    expect(a.status).toBe(200);
    expect(a.body.conversations.map((c: Row) => c.id)).toEqual([CONV_A]);
    const b = await call("GET", "/pending/list", { house: HOUSE_B });
    expect(b.body.conversations.map((c: Row) => c.id)).toEqual([CONV_B]);
  });
});

describe("a session that names no house is refused, not handed an unfiltered query", () => {
  it.each([
    ["GET", "/pending/list", undefined],
    ["GET", `/${CONV_A}`, undefined],
    ["POST", `/${CONV_A}/approve`, APPROVE_BODY],
    ["PUT", `/${CONV_A}/message`, { new_message: "x" }],
    ["POST", `/${CONV_A}/reject`, { reason: "x" }],
    ["POST", `/${CONV_A}/summarize`, undefined],
  ] as const)("%s %s → 403", async (method, path, body) => {
    const res = await call(method, path, { house: null }, body);
    expect(res.status).toBe(403);
    expect(applied).toEqual([]);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});

describe("approve, edit and reject take an owner or a manager (ADR 0116, ADR 0162)", () => {
  const writes = [
    ["POST", `/${CONV_A}/approve`, APPROVE_BODY],
    ["PUT", `/${CONV_A}/message`, { new_message: "x" }],
    ["POST", `/${CONV_A}/reject`, { reason: "x" }],
  ] as const;

  it.each(writes)(
    "refuses staff on %s %s, before any write",
    async (method, path, body) => {
      const res = await call(method, path, { role: "staff" }, body);
      expect(res.status).toBe(403);
      expect(applied).toEqual([]);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    },
  );

  it.each(writes)(
    "refuses a session with no role on %s %s",
    async (method, path, body) => {
      const res = await call(method, path, { role: "" }, body);
      expect(res.status).toBe(403);
      expect(applied).toEqual([]);
    },
  );

  it.each(["owner", "manager"])("admits %s", async (role) => {
    const res = await call(
      "POST",
      `/${CONV_A}/reject`,
      { role },
      { reason: "x" },
    );
    expect(res.status).toBe(201);
  });

  it("does not gate the reads or summarize on a role", async () => {
    expect((await call("GET", `/${CONV_A}`, { role: "staff" })).status).toBe(
      200,
    );
    expect((await call("GET", "/pending/list", { role: "staff" })).status).toBe(
      200,
    );
  });

  it("lists JwtAuthGuard BEFORE RolesGuard and declares the role on edit and reject", () => {
    const guards: unknown[] =
      Reflect.getMetadata("__guards__", ConversationsController) ?? [];
    expect(guards.indexOf(JwtAuthGuard)).toBe(0);
    expect(guards.indexOf(RolesGuard)).toBe(1);
    for (const name of ["editMessage", "rejectConversation"]) {
      expect(
        Reflect.getMetadata(
          ROLES_KEY,
          (ConversationsController.prototype as any)[name],
        ),
      ).toEqual(["owner", "manager"]);
    }
  });

  it("approve carries no token role: a grantee is a row, not a role, so WHO is the service's gate (ADR 0175 D10)", () => {
    for (const name of ["approveConversation", "issueApproveSeal"]) {
      expect(
        Reflect.getMetadata(ROLES_KEY, (ConversationsController.prototype as any)[name]),
      ).toBeUndefined();
    }
  });
});

// Only GET :id is asserted to keep the database text out of the response. The write
// routes still return the service's error string as a 400 (ADR 0171, "Named and not
// decided"); what is asserted for them is that a failing database is never a 404 or a
// success.
describe("a failed by-id read is a failure, and its text does not leave", () => {
  it("answers 500 with a fixed sentence when the database fails", async () => {
    failWith =
      'permission denied for table "procurement_conversations" (secret detail)';
    const res = await call("GET", `/${CONV_A}`, { house: HOUSE_A });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("secret detail");
    const appr = await call(
      "POST",
      `/${CONV_A}/approve`,
      { house: HOUSE_A },
      APPROVE_BODY,
    );
    expect(appr.status).not.toBe(404);
    expect(appr.status).not.toBe(201);
  });
});

describe("approve is sealed and admits a grantee (ADR 0175 D9/D10, 2026-09-21)", () => {
  it("refuses an approve with no seal, before anything is written or published", async () => {
    const res = await call("POST", `/${CONV_A}/approve`, { house: HOUSE_A, seal: null }, APPROVE_BODY);
    expect(res.status).toBe(403);
    expect(applied).toEqual([]);
    expect(rowOf(CONV_A).manager_approval_status).toBe("pending");
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("refuses a seal that is not the one minted, before anything is written", async () => {
    const res = await call("POST", `/${CONV_A}/approve`, { house: HOUSE_A, seal: "stale" }, APPROVE_BODY);
    expect(res.status).toBe(403);
    expect(applied).toEqual([]);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it("redeems the seal over the EDITED words it would release, on this conversation, as its own act", async () => {
    await call("POST", `/${CONV_A}/approve`, { house: HOUSE_A }, APPROVE_BODY);
    const redeemed = seal.redeem.mock.calls[0][0];
    expect(redeemed).toMatchObject({
      restaurantId: HOUSE_A,
      actorUserId: "user-1",
      subjectKind: "procurement_conversation",
      subjectId: CONV_A,
      action: "approve_conversation",
    });
    expect(redeemed.args).toMatchObject({ body: APPROVE_BODY.modified_message, conversationId: CONV_A });
  });

  it("with no edit, the seal is over the agent's own words on the row", async () => {
    await call("POST", `/${CONV_A}/approve`, { house: HOUSE_A }, { approved: true, approval_channel: "web_app" });
    expect(seal.redeem.mock.calls[0][0].args.body).toBe("House A asks the vendor for 12 cases");
  });

  it("admits a grantee — the standing a token role cannot express", async () => {
    const res = await call("POST", `/${CONV_A}/approve`, { house: HOUSE_A, role: "grantee" }, APPROVE_BODY);
    expect(res.status).toBe(201);
    expect(authority.assertMaySend).toHaveBeenCalled();
  });

  it("the mint answers another house's conversation 404, before WHO is asked", async () => {
    const res = await call("POST", `/${CONV_B}/approve-seal-challenge`, { house: HOUSE_A }, {});
    expect(res.status).toBe(404);
    expect(authority.assertMaySend).not.toHaveBeenCalled();
    expect(seal.issue).not.toHaveBeenCalled();
  });

  it("the mint refuses staff and issues nothing", async () => {
    const res = await call("POST", `/${CONV_A}/approve-seal-challenge`, { house: HOUSE_A, role: "staff" }, {});
    expect(res.status).toBe(403);
    expect(seal.issue).not.toHaveBeenCalled();
  });

  it("the mint seals the words the approve would release", async () => {
    const res = await call(
      "POST",
      `/${CONV_A}/approve-seal-challenge`,
      { house: HOUSE_A },
      { modified_message: "Ten cases, please" },
    );
    expect(res.status).toBe(201);
    expect(seal.issue.mock.calls[0][0]).toMatchObject({
      subjectKind: "procurement_conversation",
      subjectId: CONV_A,
      action: "approve_conversation",
      args: { body: "Ten cases, please", conversationId: CONV_A },
    });
  });
});
