/**
 * The /conversations LIST routes at the HTTP seam — GET /, GET threads,
 * GET thread/:threadId, GET by-order/:orderId, GET by-provider/:providerId and
 * GET stats/overview — answer only for the caller's house (ADR 0147, ADR 0171).
 *
 * Before this, by-order and by-provider took no `@CurrentUser` and called
 * `listConversations` with no house, and the service filtered the house only
 * `if (options.restaurantId)`, so any signed-in caller who knew an order or vendor
 * id read that house's whole vendor thread. `getStats` had the same conditional,
 * and the list routes passed `user.restaurantId` unchecked, so a session naming
 * no house (a removed member's next login) read and counted every house's.
 *
 * The app below runs the real controller and the real ConversationsService. Only
 * JwtAuthGuard is replaced by a stub that sets the request.user shape
 * JwtStrategy.validate returns. The database is an in-memory set of tables that
 * HONOURS every `.eq` filter, so a route that drops its house filter returns the
 * other house's rows here and the test sees them. Nothing leaves this process.
 */
import { ExecutionContext, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DatabaseService } from "../database/database.service";
import { ConversationsController } from "./conversations.controller";
import { ConversationsService } from "./conversations.service";

const HOUSE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOUSE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORDER_A = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
const ORDER_B = "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b";
const VENDOR_A = "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a";
const VENDOR_B = "1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b";
const VENDOR_NO_HOUSE = "1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c";
const MISSING = "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0";

type Row = Record<string, any>;

let tables: Record<string, Row[]> = {};
/** When set, every query against the named table fails with this database text. */
let failOn: { table: string; message: string } | null = null;

function seed() {
  tables = {
    procurement_orders: [
      { id: ORDER_A, restaurant_id: HOUSE_A },
      { id: ORDER_B, restaurant_id: HOUSE_B },
    ],
    providers: [
      { id: VENDOR_A, restaurant_id: HOUSE_A },
      { id: VENDOR_B, restaurant_id: HOUSE_B },
      { id: VENDOR_NO_HOUSE, restaurant_id: null },
    ],
    procurement_conversations: [
      {
        id: "conv-a1",
        restaurant_id: HOUSE_A,
        order_id: ORDER_A,
        provider_id: VENDOR_A,
        channel: "email",
        direction: "outbound",
        message_text: "House A asks for 12 cases",
        created_at: "2026-09-20T10:00:00Z",
      },
      {
        id: "conv-b1",
        restaurant_id: HOUSE_B,
        order_id: ORDER_B,
        provider_id: VENDOR_B,
        channel: "email",
        direction: "outbound",
        message_text: "House B asks for 40 cases",
        created_at: "2026-09-20T11:00:00Z",
      },
      // A house-B message that names house A's order and vendor ids. Only the
      // house filter keeps it out of house A's by-order and by-provider lists.
      {
        id: "conv-b2",
        restaurant_id: HOUSE_B,
        order_id: ORDER_A,
        provider_id: VENDOR_A,
        channel: "whatsapp",
        direction: "inbound",
        message_text: "House B's private reply",
        created_at: "2026-09-20T12:00:00Z",
      },
    ],
  };
  failOn = null;
}

/** A chainable query over one table; `.eq` filters are real, the rest chain. */
function makeBuilder(table: string) {
  const filters: Array<[string, unknown]> = [];
  const run = () => {
    if (failOn && failOn.table === table) {
      return { data: null, error: { message: failOn.message }, count: null };
    }
    // Postgres refuses a non-uuid against a uuid column (22P02).
    const badId = filters.find(
      ([col, val]) => col === "id" && !/^[0-9a-f-]{36}$/i.test(String(val)),
    );
    if (badId && table !== "procurement_conversations") {
      return {
        data: null,
        error: { message: `invalid input syntax for type uuid: "${badId[1]}"` },
        count: null,
      };
    }
    const rows = (tables[table] ?? []).filter((r) =>
      filters.every(([col, val]) => r[col] === val),
    );
    return { data: rows, error: null, count: rows.length };
  };
  const b: any = {
    select: () => b,
    order: () => b,
    range: () => b,
    ilike: () => b,
    gte: () => b,
    lte: () => b,
    or: () => b,
    eq: (col: string, val: unknown) => {
      filters.push([col, val]);
      return b;
    },
    maybeSingle: async () => {
      const res: any = run();
      if (res.error) return res;
      return { data: res.data[0] ?? null, error: null };
    },
    then: (resolve: any, reject: any) =>
      Promise.resolve(run()).then(resolve, reject),
  };
  return b;
}

const db = {
  supabase: {
    from: jest.fn((table: string) => makeBuilder(table)),
    rpc: jest.fn(async () => ({ data: [], error: null })),
  },
};

let app: INestApplication;
let base: string;

async function get(
  path: string,
  as: { house?: string | null } = {},
): Promise<{ status: number; body: any; text: string }> {
  const headers: Record<string, string> = { "x-test-role": "manager" };
  if (as.house !== null) headers["x-test-house"] = as.house ?? HOUSE_A;
  const res = await fetch(`${base}/conversations${path}`, { headers });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* a non-JSON body is kept as text */
  }
  return { status: res.status, body, text };
}

const idsOf = (body: any): string[] =>
  (body?.conversations ?? []).map((c: Row) => c.id).sort();

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ConversationsController],
    providers: [
      ConversationsService,
      { provide: DatabaseService, useValue: db },
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
  jest.clearAllMocks();
  seed();
});

describe("another house's order or vendor id answers 404, the same as a missing one", () => {
  it("GET by-order/:orderId with house B's order → 404, and nothing of house B's is sent", async () => {
    const res = await get(`/by-order/${ORDER_B}`);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("House B");
  });

  it("GET by-provider/:providerId with house B's vendor → 404, and nothing of house B's is sent", async () => {
    const res = await get(`/by-provider/${VENDOR_B}`);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("House B");
  });

  it("answers a foreign id exactly as it answers an id that does not exist", async () => {
    const foreignOrder = await get(`/by-order/${ORDER_B}`);
    const missingOrder = await get(`/by-order/${MISSING}`);
    expect(foreignOrder).toEqual(missingOrder);
    const foreignVendor = await get(`/by-provider/${VENDOR_B}`);
    const missingVendor = await get(`/by-provider/${MISSING}`);
    expect(foreignVendor).toEqual(missingVendor);
  });

  it("a vendor row with no house is not this house's: 404", async () => {
    const res = await get(`/by-provider/${VENDOR_NO_HOUSE}`);
    expect(res.status).toBe(404);
  });

  it("a malformed id is a 404 and never reaches the database", async () => {
    expect((await get("/by-order/not-a-uuid")).status).toBe(404);
    expect((await get("/by-provider/not-a-uuid")).status).toBe(404);
    expect(db.supabase.from).not.toHaveBeenCalled();
  });
});

describe("the caller's own house gets its own rows and never another's", () => {
  it("GET by-order/:orderId lists house A's messages on that order, not house B's that name it", async () => {
    const res = await get(`/by-order/${ORDER_A}`);
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual(["conv-a1"]);
    expect(res.text).not.toContain("House B");
  });

  it("GET by-provider/:providerId lists house A's messages with that vendor, not house B's", async () => {
    const res = await get(`/by-provider/${VENDOR_A}`);
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual(["conv-a1"]);
    expect(res.text).not.toContain("House B");
  });

  it("GET / lists house A's messages only", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual(["conv-a1"]);
  });

  it("GET stats/overview counts house A's messages only", async () => {
    const res = await get("/stats/overview");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.byChannel).toEqual({ email: 1 });
  });

  it("house B, asking for its own order, gets its own message on it", async () => {
    const res = await get(`/by-order/${ORDER_B}`, { house: HOUSE_B });
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual(["conv-b1"]);
  });
});

describe("a session that names no house is refused, not handed an unfiltered query", () => {
  it.each([
    ["/"],
    ["/threads"],
    [`/thread/${ORDER_A}`],
    [`/by-order/${ORDER_A}`],
    [`/by-provider/${VENDOR_A}`],
    ["/stats/overview"],
  ])("GET %s → 403, and the database is never asked", async (path) => {
    const res = await get(path, { house: null });
    expect(res.status).toBe(403);
    expect(db.supabase.from).not.toHaveBeenCalled();
    expect(db.supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("the service itself refuses a list or a count with no house", () => {
  const service = () => app.get(ConversationsService);

  it("listConversations throws without a house instead of listing every house's", async () => {
    await expect(
      service().listConversations({
        restaurantId: undefined as unknown as string,
        orderId: ORDER_A,
        page: 1,
        limit: 20,
        sortBy: "created_at",
        sortOrder: "desc",
      }),
    ).rejects.toThrow(/restaurantId is required/);
    expect(db.supabase.from).not.toHaveBeenCalled();
  });

  it("getStats throws without a house instead of counting every house's", async () => {
    await expect(
      service().getStats(undefined as unknown as string),
    ).rejects.toThrow(/restaurantId is required/);
    expect(db.supabase.from).not.toHaveBeenCalled();
  });
});

describe("a failed ownership read is a failure, not an empty list, and its text does not leave", () => {
  it.each([
    ["procurement_orders", `/by-order/${ORDER_A}`],
    ["providers", `/by-provider/${VENDOR_A}`],
  ])("%s read fails → 500 with a fixed sentence", async (table, path) => {
    failOn = { table, message: 'relation "secret_internal" does not exist' };
    const res = await get(path);
    expect(res.status).toBe(500);
    expect(res.text).not.toContain("secret_internal");
    expect(res.body.message).toBe("Failed to get conversations");
  });
});
