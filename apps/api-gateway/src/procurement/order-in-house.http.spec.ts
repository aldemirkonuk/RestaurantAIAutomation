/**
 * Every `orders/:id` route answers an id that names no order of this house
 * with one 404 in words (order-in-house.interceptor.ts).
 *
 * A real Nest HTTP app with the three controllers that carry `orders/:id`
 * routes, the real `JwtAuthGuard` (only passport is stood in for), main.ts's
 * ValidationPipe, and services that record every call. The route list is read
 * from the controllers' own metadata, so a route added later is probed too.
 */
import { INestApplication, RequestMethod, ValidationPipe } from "@nestjs/common";
import { INTERCEPTORS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import * as fs from "fs";
import * as path from "path";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TokenBlacklistService } from "../auth/services/token-blacklist.service";
import { DatabaseService } from "../database/database.service";
import { ArrivalAsksController } from "./arrival-asks.controller";
import { ArrivalAsksService } from "./arrival-asks.service";
import { OrderInHouseInterceptor, isOrderIdRoute } from "./order-in-house.interceptor";
import { ProcurementController } from "./procurement.controller";
import { ProcurementService } from "./procurement.service";
import { ReceivingController } from "./receiving.controller";
import { ReceivingService } from "./receiving.service";

const HOUSE = "11111111-1111-4111-8111-111111111111";
const KNOWN = "22222222-2222-4222-8222-222222222222";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";
const HANDLED = { handled: true };

let readFault = false;
const reads: Array<Record<string, unknown>> = [];

function fakeDb(): DatabaseService {
  const supabase: any = {
    from(table: string) {
      const filters: Record<string, unknown> = { table };
      const q: any = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return q;
        },
        maybeSingle: async () => {
          reads.push({ ...filters });
          if (readFault) return { data: null, error: { code: "08006", message: "connection reset" } };
          if (filters.id === "abc") {
            return { data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } };
          }
          const here = filters.id === KNOWN && filters.restaurant_id === HOUSE;
          return { data: here ? { id: KNOWN } : null, error: null };
        },
      };
      return q;
    },
  };
  return { supabase, getClient: () => supabase } as unknown as DatabaseService;
}

const calls: string[] = [];
function recordingService(name: string) {
  return new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "then") return undefined;
        return async () => {
          calls.push(`${name}.${String(prop)}`);
          return HANDLED;
        };
      },
    },
  );
}

const CONTROLLERS = [
  { cls: ProcurementController, prefix: "procurement" },
  { cls: ReceivingController, prefix: "procurement/receiving" },
  { cls: ArrivalAsksController, prefix: "procurement" },
];

type Route = { method: string; path: string; label: string };
function orderRoutes(): Route[] {
  const out: Route[] = [];
  for (const { cls, prefix } of CONTROLLERS) {
    const proto = cls.prototype as any;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      const p = typeof handler === "function" ? Reflect.getMetadata(PATH_METADATA, handler) : undefined;
      if (!isOrderIdRoute(p)) continue;
      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)];
      out.push({ method, path: `/${prefix}/${p}`, label: `${method} ${prefix}/${p}` });
    }
  }
  return out;
}

let app: INestApplication;
let base: string;

async function call(route: Route, id: string) {
  const res = await fetch(`${base}${route.path.replace(":id", id)}`, {
    method: route.method,
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: route.method === "GET" ? undefined : "{}",
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  const passport = Object.getPrototypeOf(JwtAuthGuard.prototype);
  jest.spyOn(passport, "canActivate").mockImplementation(async (ctx: any) => {
    ctx.switchToHttp().getRequest().user = {
      userId: "u1",
      restaurantId: HOUSE,
      role: "owner",
      emailVerified: true,
    };
    return true;
  });
  const moduleRef = await Test.createTestingModule({
    controllers: CONTROLLERS.map((c) => c.cls),
    providers: [
      { provide: ProcurementService, useValue: recordingService("procurement") },
      { provide: ReceivingService, useValue: recordingService("receiving") },
      { provide: ArrivalAsksService, useValue: recordingService("arrival") },
      { provide: DatabaseService, useValue: fakeDb() },
      { provide: TokenBlacklistService, useValue: { isBlacklisted: async () => false } },
    ],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app?.close();
  jest.restoreAllMocks();
});

beforeEach(() => {
  calls.length = 0;
  reads.length = 0;
  readFault = false;
});

const ROUTES = orderRoutes();

describe("the probe covers every orders/:id route on the three controllers", () => {
  it("finds the 36 routes measured on 2026-11-13", () => {
    expect(ROUTES.length).toBe(36);
    expect(ROUTES.map((r) => r.label)).toEqual(
      expect.arrayContaining([
        "GET procurement/orders/:id",
        "PATCH procurement/orders/:id",
        "DELETE procurement/orders/:id",
        "POST procurement/orders/:id/ai-pause",
        "GET procurement/orders/:id/conversations",
        "POST procurement/receiving/orders/:id/door",
        "GET procurement/receiving/orders/:id/history",
        "POST procurement/orders/:id/arrival-answers",
      ]),
    );
  });
});

describe("an id that names no order of this house", () => {
  it.each(ROUTES.map((r) => [r.label, r]))("%s answers 404 in words for an unknown id", async (_l, route) => {
    const res = await call(route as Route, UNKNOWN);
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe("order_not_found");
    expect(res.body.message).toMatch(/^No order with that id belongs to this restaurant/);
  });

  it.each(ROUTES.map((r) => [r.label, r]))("%s answers 404 for an id that is not a uuid", async (_l, route) => {
    const res = await call(route as Route, "abc");
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe("order_not_found");
  });

  it("does nothing on a write: no write route's handler runs", async () => {
    for (const route of ROUTES.filter((r) => r.method !== "GET")) {
      await call(route, UNKNOWN);
    }
    expect(calls).toEqual([]);
  });

  it("says nothing was done on a write and nothing more on a read", async () => {
    const write = await call(ROUTES.find((r) => r.label === "POST procurement/orders/:id/ai-pause")!, UNKNOWN);
    expect(write.body.message).toBe(
      "No order with that id belongs to this restaurant, so nothing was done.",
    );
    const read = await call(ROUTES.find((r) => r.label === "GET procurement/orders/:id/attachments")!, UNKNOWN);
    expect(read.body.message).toBe("No order with that id belongs to this restaurant.");
  });

  it("asks about this house's order and no other", async () => {
    await call(ROUTES.find((r) => r.method === "GET")!, UNKNOWN);
    expect(reads).toEqual([{ table: "procurement_orders", restaurant_id: HOUSE, id: UNKNOWN }]);
  });
});

describe("an order that is this house's", () => {
  it.each(ROUTES.filter((r) => r.method === "GET").map((r) => [r.label, r]))(
    "%s answers with the handler's own reply",
    async (_l, route) => {
      const res = await call(route as Route, KNOWN);
      expect(res.status).toBe(200);
      // The handler's reply, as that handler shapes it (GET draft wraps two reads).
      expect(JSON.stringify(res.body)).toContain('"handled":true');
    },
  );

  it("lets every write through to its handler or its own body check, never a 404", async () => {
    for (const route of ROUTES.filter((r) => r.method !== "GET")) {
      const res = await call(route, KNOWN);
      expect([route.label, res.status]).not.toEqual([route.label, 404]);
    }
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe("a read of the order that fails is not a not-found", () => {
  it("leaves a read's answer to its handler", async () => {
    readFault = true;
    const res = await call(ROUTES.find((r) => r.label === "GET procurement/orders/:id/conversations")!, UNKNOWN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(HANDLED);
  });

  it("leaves a write to its handler", async () => {
    readFault = true;
    const res = await call(ROUTES.find((r) => r.label === "POST procurement/orders/:id/ai-pause")!, UNKNOWN);
    expect(res.status).not.toBe(404);
    expect(calls).toContain("procurement.setOrderAiPaused");
  });
});

describe("a controller that adds an orders/:id route carries the interceptor", () => {
  it("every *.controller.ts with an orders/:id route applies OrderInHouseInterceptor", () => {
    const root = path.join(__dirname, "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(".controller.ts")) files.push(full);
      }
    };
    walk(root);
    const routeDecorator = /@(Get|Post|Patch|Put|Delete)\(\s*["'`]\/?orders\/:id(\/|["'`])/;
    const missing = files
      .filter((f) => routeDecorator.test(fs.readFileSync(f, "utf8")))
      .filter((f) => !/@UseInterceptors\([^)]*OrderInHouseInterceptor/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(root, f));
    expect(missing).toEqual([]);
  });

  it.each(CONTROLLERS.map((c) => [c.cls.name, c.cls]))("%s carries it at class level", (_n, cls) => {
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, cls)).toContain(OrderInHouseInterceptor);
  });
});
