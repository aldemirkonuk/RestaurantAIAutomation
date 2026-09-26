/**
 * Who may read a line's history on the receiving desk, and what the route
 * refuses before the handler runs.
 *
 * The history is a desk route, so it takes ADR 0167's rule (founder,
 * 2026-09-19: "Refuse staff on all four", owner or manager on all of them):
 * a staff caller, or a session with no role in the house, gets 403 and nothing
 * is read. The door routes stay open to staff — they record the receipts this
 * reads back.
 *
 * A real HTTP request through the real Nest pipeline: the real controller, the
 * real RolesGuard and @Roles metadata, the real global ValidationPipe options.
 * Only JwtAuthGuard is replaced, by a stub that sets req.user.role from a
 * header, because what is under test is the gate that runs after it.
 */
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { ReceivingController } from "./receiving.controller";
import { ReceivingService } from "./receiving.service";

const HOUSE = "12823c23-277c-5ae9-b49b-e17d33704e04";
const ORDER = "11111111-1111-4111-8111-111111111111";
const MARKER = "2026-09-25T10:03:00+00:00|00000000-0000-4000-8000-000000000003";

describe("GET /procurement/receiving/orders/:id/history", () => {
  let app: INestApplication;
  let base: string;
  const calls: Array<{ restaurantId: string; orderId: string; before: string | null }> = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ReceivingController],
      providers: [
        {
          provide: ReceivingService,
          useValue: {
            lineHistory: async (restaurantId: string, orderId: string, before: string | null) => {
              calls.push({ restaurantId, orderId, before });
              return { orderId, entries: [], total: 0, hasMore: false, nextBefore: null };
            },
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          const role = req.headers["x-test-role"];
          if (!role) return false;
          req.user = {
            userId: "a5bede6d-3c34-4627-8771-a488ba5275de",
            restaurantId: HOUSE,
            role: role === "none" ? null : role,
          };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    // The gateway's own options (main.ts).
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0);
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    calls.length = 0;
  });

  const get = (path: string, role?: string) =>
    fetch(`${base}${path}`, { headers: role ? { "x-test-role": role } : {} });

  it.each(["staff", "none"])("refuses a %s caller with 403 and reads nothing", async (role) => {
    const res = await get(`/procurement/receiving/orders/${ORDER}/history`, role);
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it.each(["owner", "manager", "admin"])("lets a %s through, scoped to the token's house", async (role) => {
    const res = await get(`/procurement/receiving/orders/${ORDER}/history`, role);
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ restaurantId: HOUSE, orderId: ORDER, before: null }]);
  });

  it("passes a page marker through", async () => {
    const res = await get(
      `/procurement/receiving/orders/${ORDER}/history?before=${encodeURIComponent(MARKER)}`,
      "manager",
    );
    expect(res.status).toBe(200);
    expect(calls[0].before).toBe(MARKER);
  });

  it.each([
    ["a timestamp-only marker", "2026-09-25T10:03:00Z"],
    ["a marker carrying a second filter", `${MARKER},id.gt.0`],
  ])("refuses %s with 400 before the handler", async (_what, marker) => {
    const res = await get(
      `/procurement/receiving/orders/${ORDER}/history?before=${encodeURIComponent(marker)}`,
      "manager",
    );
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("refuses an order id that is not a uuid with 400", async () => {
    const res = await get(`/procurement/receiving/orders/not-an-id/history`, "manager");
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("the history's gate sits on its own handler (metadata)", () => {
  it("is owner or manager, on the method, behind the class's JwtAuthGuard", () => {
    const handler = ReceivingController.prototype.lineHistory;
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(["owner", "manager"]);
    expect(Reflect.getMetadata("__guards__", handler)).toEqual([RolesGuard]);
    expect(Reflect.getMetadata("__guards__", ReceivingController)).toEqual([JwtAuthGuard]);
  });

  it("leaves the door routes staff record receipts with open", () => {
    for (const name of ["door", "receivedSoFar", "unverified"] as const) {
      expect(
        Reflect.getMetadata(ROLES_KEY, (ReceivingController.prototype as any)[name]),
      ).toBeUndefined();
    }
  });
});
