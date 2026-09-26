/**
 * Who may call the receiving decision queue and the credit ledger (ADR 0167).
 *
 * The founder, 2026-09-19: *"Refuse staff on all four"*, owner or manager on all
 * of them. The four are `GET /procurement/receiving/queue`, `GET
 * /procurement/credits`, `GET /procurement/credits/stats` and `POST
 * /procurement/credits/:id/transition`.
 *
 * Until then the UI drew the split (ReceivingHome picks the manager view or the
 * owner view by role) and the server did not enforce it: both controllers held
 * `JwtAuthGuard` alone, so any signed-in member of a house could read the dollars
 * the staff view leaves out and move a claim to `rejected` or `written_off`.
 * Production gained its first staff row on 2026-09-03 (Sim Bistro), which is what
 * made that a live exposure rather than a theoretical one.
 *
 * TWO HALVES, BECAUSE EACH ALONE CAN PASS BY LOOKING AT NOTHING.
 *
 *   1. A real HTTP request through the real Nest pipeline: the real controllers,
 *      the real `RolesGuard`, real `@Roles` metadata. Only `JwtAuthGuard` is
 *      replaced, by a stub that sets `req.user.role` from a header, because what
 *      is under test is the gate that runs AFTER authentication. A staff caller
 *      gets 403; a caller with no role in the house gets 403; owner, manager and
 *      admin get through (a 404 on the transition, from the stub's empty ledger,
 *      is "through": it is the handler talking, not the guard).
 *   2. The routes staff DO use are still open. The door routes and `unverified`
 *      carry no `@Roles`: a gate that swept them up would stop the person
 *      holding the hand truck, and every test on the four routes above would
 *      still be green.
 *
 * The global `RateLimitGuard` and `TenantGuard` are not in this module, on
 * purpose: they are not what decides a role.
 */

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { DatabaseService } from "../database/database.service";
import { ReceivingController } from "./receiving.controller";
import { ReceivingService } from "./receiving.service";
import { CreditsController } from "./documents/credits.controller";

const HOUSE = "12823c23-277c-5ae9-b49b-e17d33704e04";

/** A Supabase-shaped chain: every method returns it, awaiting it yields an empty ledger. */
function emptyLedger(touched: { from: number }) {
  const result = { data: null, error: null };
  const chain: any = new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "then"
          ? (resolve: (v: unknown) => unknown) =>
              resolve(
                // a list read wants an array; maybeSingle wants null
                { ...result, data: [] },
              )
          : prop === "maybeSingle"
            ? () => Promise.resolve(result)
            : () => chain,
    },
  );
  return {
    getClient: () => ({
      from: () => {
        touched.from += 1;
        return chain;
      },
    }),
  };
}

describe("receiving queue and credit ledger: owner or manager only (ADR 0167)", () => {
  let app: INestApplication;
  let base: string;
  const touched = { from: 0 };
  const receivingCalls = { managerQueue: 0, listUnverified: 0 };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ReceivingController, CreditsController],
      providers: [
        {
          provide: ReceivingService,
          useValue: {
            managerQueue: async () => {
              receivingCalls.managerQueue += 1;
              return { items: [], unverified: [], totalAtRisk: 0 };
            },
            listUnverified: async () => {
              receivingCalls.listUnverified += 1;
              return [];
            },
          },
        },
        { provide: DatabaseService, useValue: emptyLedger(touched) },
      ],
    })
      // Authentication is not what is under test; the role a request carries is.
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          const role = req.headers["x-test-role"];
          if (!role) return false;
          req.user = {
            userId: "a5bede6d-3c34-4627-8771-a488ba5275de",
            restaurantId: HOUSE,
            // "none" is a session the house has no role for: `JwtStrategy`
            // sets null there, and `@Roles` refuses it.
            role: role === "none" ? null : role,
          };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    touched.from = 0;
    receivingCalls.managerQueue = 0;
    receivingCalls.listUnverified = 0;
  });

  const call = (method: string, path: string, role?: string) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(role ? { "x-test-role": role } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify({ to: "requested" }) } : {}),
    });

  const FOUR_ROUTES: Array<[string, string, string]> = [
    ["the receiving decision queue", "GET", "/procurement/receiving/queue"],
    ["the credit chase list", "GET", "/procurement/credits"],
    ["the recovery figures", "GET", "/procurement/credits/stats"],
    [
      "a credit transition",
      "POST",
      "/procurement/credits/00000000-0000-0000-0000-000000000001/transition",
    ],
  ];

  describe.each(FOUR_ROUTES)("%s (%s %s)", (_what, method, path) => {
    it("refuses a staff caller with 403, and reads nothing", async () => {
      const res = await call(method, path, "staff");
      expect(res.status).toBe(403);
      // The refusal is BEFORE the handler: no ledger read, no queue read.
      expect(touched.from).toBe(0);
      expect(receivingCalls.managerQueue).toBe(0);
    });

    it("refuses a session that has no role in the house with 403", async () => {
      const res = await call(method, path, "none");
      expect(res.status).toBe(403);
      expect(touched.from).toBe(0);
      expect(receivingCalls.managerQueue).toBe(0);
    });

    it.each(["owner", "manager", "admin"])(
      "lets a %s through to the handler",
      async (role) => {
        const res = await call(method, path, role);
        // 200 on the reads. The transition finds no claim in the stub's empty
        // ledger and answers 404: that is the handler, past the guard.
        expect(res.status).toBe(method === "POST" ? 404 : 200);
      },
    );
  });

  it("leaves the routes staff work with open: unverified answers a staff caller", async () => {
    const res = await call("GET", "/procurement/receiving/unverified", "staff");
    expect(res.status).toBe(200);
    expect(receivingCalls.listUnverified).toBe(1);
  });
});

describe("the gate is on the right handlers and only those (metadata)", () => {
  const rolesOn = (proto: object, name: string) =>
    Reflect.getMetadata(
      ROLES_KEY,
      (proto as Record<string, (...a: unknown[]) => unknown>)[name],
    ) as string[] | undefined;
  const guardsOf = (target: object) =>
    (Reflect.getMetadata("__guards__", target) as unknown[]) ?? [];

  const methodsOf = (cls: { prototype: object }) =>
    Object.getOwnPropertyNames(cls.prototype).filter(
      (n) =>
        n !== "constructor" &&
        typeof (cls.prototype as Record<string, unknown>)[n] === "function",
    );

  it("gates every CreditsController handler at the class, JwtAuthGuard first", () => {
    expect(guardsOf(CreditsController)).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, CreditsController)).toEqual([
      "owner",
      "manager",
    ]);
    // Three handlers today. A fourth added later inherits the gate; this
    // fails only if the list below stops naming what the class has.
    expect(methodsOf(CreditsController).sort()).toEqual([
      "list",
      "stats",
      "transition",
    ]);
  });

  it("gates ReceivingController.queue alone, on the method", () => {
    expect(rolesOn(ReceivingController.prototype, "queue")).toEqual([
      "owner",
      "manager",
    ]);
    expect(
      guardsOf(ReceivingController.prototype.queue),
    ).toEqual([RolesGuard]);
    expect(guardsOf(ReceivingController)).toEqual([JwtAuthGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, ReceivingController)).toBeUndefined();
  });

  it("leaves every other ReceivingController handler open to staff", () => {
    const others = methodsOf(ReceivingController).filter((n) => n !== "queue");
    // If this list is empty the test is looking at nothing.
    expect(others.sort()).toEqual([
      "door",
      "receivedSoFar",
      "unverified",
    ]);
    for (const name of others) {
      expect(rolesOn(ReceivingController.prototype, name)).toBeUndefined();
    }
  });
});
