/**
 * POST /senders/trust and GET /senders/reputation, at the HTTP seam.
 *
 * Trusting a domain lifts the SPF/DKIM quarantine for every letter from it
 * (SenderReputationService.isTrusted, read by inbound-responder.service.ts), so
 * WHO may do it and WHAT it may name are the whole of this controller.
 *
 * The app below runs the real RolesGuard and a global ValidationPipe with the
 * options main.ts installs. Only JwtAuthGuard is replaced, by a stub that sets
 * the request.user shape JwtStrategy.validate returns (userId, restaurantId,
 * role). The server listens on 127.0.0.1 inside this process; nothing leaves it.
 */
import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { ROLES_KEY } from "../../auth/decorators/roles.decorator";
import { DatabaseService } from "../../database/database.service";
import { SenderReputationService } from "./sender-reputation.service";
import { SenderTrustController } from "./sender-trust.controller";

const HOUSE = "11111111-1111-4111-8111-111111111111";
const VENDOR = "22222222-2222-4222-8222-222222222222";

const reputation = { setTrust: jest.fn(), list: jest.fn() };

/** The providers read the controller may make; scripted per test. */
let providersResult: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};
const dbCalls: Array<[string, unknown[]]> = [];
const db = {
  supabase: {
    from: jest.fn((table: string) => {
      dbCalls.push(["from", [table]]);
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is"]) {
        b[m] = (...args: unknown[]) => {
          dbCalls.push([m, args]);
          return b;
        };
      }
      b.maybeSingle = async () => providersResult;
      return b;
    }),
  },
};

let app: INestApplication;
let base: string;

async function call(
  method: "GET" | "POST",
  path: string,
  role: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-role": role },
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

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [SenderTrustController],
    providers: [
      { provide: SenderReputationService, useValue: reputation },
      { provide: DatabaseService, useValue: db },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        req.user = {
          userId: "user-1",
          restaurantId: HOUSE,
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
  dbCalls.length = 0;
  providersResult = { data: null, error: null };
  reputation.setTrust.mockImplementation(async (_house: string, t: string) =>
    t.includes("@") ? t.split("@")[1] : t,
  );
  reputation.list.mockResolvedValue([]);
});

describe("who may use /senders", () => {
  it("refuses a staff member POST /senders/trust with 403 and writes nothing", async () => {
    const res = await call("POST", "/senders/trust", "staff", {
      domain: "vendor.example",
      trusted: true,
    });
    expect(res.status).toBe(403);
    expect(reputation.setTrust).not.toHaveBeenCalled();
  });

  it("refuses a staff member GET /senders/reputation with 403", async () => {
    const res = await call("GET", "/senders/reputation", "staff");
    expect(res.status).toBe(403);
    expect(reputation.list).not.toHaveBeenCalled();
  });

  it.each(["owner", "manager"])("admits %s on both routes", async (role) => {
    const trust = await call("POST", "/senders/trust", role, {
      domain: "vendor.example",
      trusted: true,
    });
    expect(trust.status).toBe(201);
    expect(trust.body).toEqual({ domain: "vendor.example", trusted: true });
    const list = await call("GET", "/senders/reputation", role);
    expect(list.status).toBe(200);
    expect(reputation.list).toHaveBeenCalledWith(HOUSE);
  });

  it("lists JwtAuthGuard BEFORE RolesGuard, and asks for owner or manager", () => {
    const guards: unknown[] =
      Reflect.getMetadata("__guards__", SenderTrustController) ?? [];
    expect(guards[0]).toBe(JwtAuthGuard);
    expect(guards.indexOf(RolesGuard)).toBeGreaterThan(0);
    expect(Reflect.getMetadata(ROLES_KEY, SenderTrustController)).toEqual([
      "owner",
      "manager",
    ]);
  });
});

describe("providerId must name a vendor of this house", () => {
  it("keeps the web's body shape ({domain, trusted}, Promotions.tsx) working with no provider read", async () => {
    const res = await call("POST", "/senders/trust", "manager", {
      domain: "vendor.example",
      trusted: false,
    });
    expect(res.status).toBe(201);
    expect(reputation.setTrust).toHaveBeenCalledWith(
      HOUSE,
      "vendor.example",
      false,
      null,
    );
    expect(db.supabase.from).not.toHaveBeenCalled();
  });

  it("refuses a providerId that is not a vendor of this house, and writes nothing", async () => {
    providersResult = { data: null, error: null };
    const res = await call("POST", "/senders/trust", "manager", {
      domain: "vendor.example",
      trusted: true,
      providerId: VENDOR,
    });
    expect(res.status).toBe(400);
    expect(reputation.setTrust).not.toHaveBeenCalled();
  });

  it("refuses a providerId that is not a uuid, and never reads", async () => {
    const res = await call("POST", "/senders/trust", "manager", {
      domain: "vendor.example",
      trusted: true,
      providerId: "not-a-uuid",
    });
    expect(res.status).toBe(400);
    expect(reputation.setTrust).not.toHaveBeenCalled();
    expect(db.supabase.from).not.toHaveBeenCalled();
  });

  it("answers 503 when the providers read fails, never trusting on an unread check", async () => {
    providersResult = { data: null, error: { message: "boom" } };
    const res = await call("POST", "/senders/trust", "manager", {
      domain: "vendor.example",
      trusted: true,
      providerId: VENDOR,
    });
    expect(res.status).toBe(503);
    expect(reputation.setTrust).not.toHaveBeenCalled();
  });

  it("accepts a providerId of this house, reading it by id AND house AND not deleted", async () => {
    providersResult = { data: { id: VENDOR }, error: null };
    const res = await call("POST", "/senders/trust", "owner", {
      domain: "vendor.example",
      trusted: true,
      providerId: VENDOR,
    });
    expect(res.status).toBe(201);
    expect(reputation.setTrust).toHaveBeenCalledWith(
      HOUSE,
      "vendor.example",
      true,
      VENDOR,
    );
    expect(dbCalls).toEqual(
      expect.arrayContaining([
        ["from", ["providers"]],
        ["eq", ["id", VENDOR]],
        ["eq", ["restaurant_id", HOUSE]],
        ["is", ["deleted_at", null]],
      ]),
    );
  });
});

describe("trusted must be a boolean", () => {
  it('refuses trusted: "false" rather than reading the string as trust', async () => {
    const res = await call("POST", "/senders/trust", "manager", {
      domain: "vendor.example",
      trusted: "false",
    });
    expect(res.status).toBe(400);
    expect(reputation.setTrust).not.toHaveBeenCalled();
  });

  it("keeps an omitted trusted meaning trust (the existing contract)", async () => {
    const res = await call("POST", "/senders/trust", "manager", {
      email: "Rep <rep@vendor.example>",
    });
    expect(res.status).toBe(201);
    expect(reputation.setTrust).toHaveBeenCalledWith(
      HOUSE,
      "Rep <rep@vendor.example>",
      true,
      null,
    );
  });

  it("still refuses a body with neither domain nor email", async () => {
    const res = await call("POST", "/senders/trust", "manager", {
      trusted: true,
    });
    expect(res.status).toBe(400);
    expect(reputation.setTrust).not.toHaveBeenCalled();
  });
});
