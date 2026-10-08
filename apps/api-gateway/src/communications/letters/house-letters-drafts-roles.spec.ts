/**
 * Who may reach `HouseLettersController`'s drafts and discard (ADR 0167,
 * extended; PR #476 audit round 1, R1).
 *
 * `GET /communications/letters/drafts` and `POST /:id/discard` carried only
 * `JwtAuthGuard` — no `@Roles` at all. `drafts()` returns each draft's full
 * body, which for a credit-claim draft (ADR 0230) is the letter text carrying
 * the claimed dollar amount, reason, invoice/order numbers and count —
 * precisely the figures ADR 0167 already refuses staff on the credit ledger
 * itself (`GET /procurement/credits`). A route that answered them unguarded
 * let a staff member read them by another door, and `discard` let them kill a
 * manager's own draft. Both now carry `@Roles("owner", "manager")`, the exact
 * decision ADR 0167 already made for the same figures.
 *
 * The order letter (ADR 0313, 4a-ii) adds four routes to the same gate:
 * preview, publish, reset and restore are owner or manager. Its save stays on
 * `POST /templates`, which is still open to every member for the five
 * composer purposes; the order letter's own rule there is checked in the
 * service against the STORED purpose (house-letters-templates.spec.ts), so it
 * is pinned below as ungated on the route, on purpose.
 *
 * TWO HALVES, same reason as `receiving-credits-roles.spec.ts`: a real HTTP
 * request through the real `RolesGuard` (only `JwtAuthGuard` stubbed), AND a
 * check that every OTHER route on this controller is untouched — writing and
 * sending a letter by hand was never part of ADR 0167, which named only the
 * credit ledger's own four routes.
 */

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { ROLES_KEY } from "../../auth/decorators/roles.decorator";
import { HouseLettersController } from "./house-letters.controller";
import { HouseLettersService } from "./house-letters.service";
import { HouseSenderService } from "./house-sender.service";
import { HouseLettersCron } from "./house-letters.cron";
import { HouseInboxCron } from "../inbox/house-inbox.cron";
import { HouseInboxService } from "../inbox/house-inbox.service";

const HOUSE = "12823c23-277c-5ae9-b49b-e17d33704e04";

describe("HouseLettersController.drafts / .discard: owner or manager only (ADR 0167)", () => {
  let app: INestApplication;
  let base: string;
  const calls = { drafts: 0, discardDraft: 0, queued: 0, orderLetter: 0 };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HouseLettersController],
      providers: [
        {
          provide: HouseLettersService,
          useValue: {
            drafts: async () => {
              calls.drafts += 1;
              return [];
            },
            discardDraft: async () => {
              calls.discardDraft += 1;
              return { id: "x", status: "HOUSE_CANCELLED", says: "Discarded." };
            },
            queued: async () => {
              calls.queued += 1;
              return [];
            },
            previewOrderLetter: async () => {
              calls.orderLetter += 1;
              return { previewHash: null, refusals: [], samples: [] };
            },
            publishOrderLetter: async () => {
              calls.orderLetter += 1;
              return { published: true };
            },
            resetOrderLetter: async () => {
              calls.orderLetter += 1;
              return { published: true };
            },
            restoreOrderLetter: async () => {
              calls.orderLetter += 1;
              return { restored: true };
            },
            orderLetter: async () => {
              calls.orderLetter += 1;
              return { mayEdit: false };
            },
          },
        },
        { provide: HouseSenderService, useValue: {} },
        { provide: HouseLettersCron, useValue: { lastRun: () => null } },
        { provide: HouseInboxCron, useValue: { lastRun: () => null } },
        { provide: HouseInboxService, useValue: {} },
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
    calls.drafts = 0;
    calls.discardDraft = 0;
    calls.queued = 0;
    calls.orderLetter = 0;
  });

  const call = (method: string, path: string, role?: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(role ? { "x-test-role": role } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const GATED_ROUTES: Array<[string, string, string, unknown, number]> = [
    ["the drafts list", "GET", "/communications/letters/drafts", undefined, 200],
    [
      "discard",
      "POST",
      "/communications/letters/00000000-0000-0000-0000-000000000001/discard",
      undefined,
      201,
    ],
    // The order letter (ADR 0313): each body is valid, so a 403 is the gate's.
    ["order letter preview", "POST", "/communications/letters/templates/order-request/preview", {}, 200],
    [
      "order letter publish",
      "POST",
      "/communications/letters/templates/order-request/publish",
      { previewHash: "a".repeat(64) },
      201,
    ],
    ["order letter reset", "POST", "/communications/letters/templates/order-request/reset", {}, 201],
    [
      "order letter restore",
      "POST",
      "/communications/letters/templates/order-request/restore",
      { versionId: "00000000-0000-4000-8000-000000000001" },
      201,
    ],
  ];

  describe.each(GATED_ROUTES)("%s (%s %s)", (_what, method, path, body, ok) => {
    it("refuses a staff caller with 403, and reads nothing", async () => {
      const res = await call(method, path, "staff", body);
      expect(res.status).toBe(403);
      expect(calls.drafts).toBe(0);
      expect(calls.discardDraft).toBe(0);
      expect(calls.orderLetter).toBe(0);
    });

    it("refuses a session that has no role in the house with 403", async () => {
      const res = await call(method, path, "none", body);
      expect(res.status).toBe(403);
    });

    it("refuses admin with 403 (ADR 0164: exact-match, not implicitly admitted)", async () => {
      const res = await call(method, path, "admin", body);
      expect(res.status).toBe(403);
    });

    it.each(["owner", "manager"])(
      "lets a %s through to the handler",
      async (role) => {
        const res = await call(method, path, role, body);
        // Past the guard: the handler's own status (GET 200; POST 201 unless
        // the route sets @HttpCode, as preview does with 200).
        expect(res.status).toBe(ok);
      },
    );
  });

  it("the order letter's READ answers a staff caller (staff see it read-only)", async () => {
    const res = await call("GET", "/communications/letters/templates/order-request", "staff");
    expect(res.status).toBe(200);
    expect(calls.orderLetter).toBe(1);
  });

  it("leaves the routes a human letter-writer uses open: queued answers a staff caller", async () => {
    const res = await call("GET", "/communications/letters/queued", "staff");
    expect(res.status).toBe(200);
    expect(calls.queued).toBe(1);
  });
});

describe("the gate is on drafts/discard and the order letter's writes, and only those (metadata)", () => {
  const rolesOn = (proto: object, name: string) =>
    Reflect.getMetadata(
      ROLES_KEY,
      (proto as Record<string, (...a: unknown[]) => unknown>)[name],
    ) as string[] | undefined;
  const guardsOnMethod = (proto: object, name: string) =>
    (Reflect.getMetadata(
      "__guards__",
      (proto as Record<string, (...a: unknown[]) => unknown>)[name],
    ) as unknown[]) ?? [];
  const guardsOnClass = (target: object) =>
    (Reflect.getMetadata("__guards__", target) as unknown[]) ?? [];

  it("the class carries only JwtAuthGuard — the roles gate is method-level", () => {
    expect(guardsOnClass(HouseLettersController)).toEqual([JwtAuthGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, HouseLettersController)).toBeUndefined();
  });

  it("gates drafts, discard and the order letter's preview/publish/reset/restore, owner or manager, RolesGuard added on the method", () => {
    for (const name of [
      "drafts",
      "discard",
      "previewOrderLetter",
      "publishOrderLetter",
      "resetOrderLetter",
      "restoreOrderLetter",
    ]) {
      expect(rolesOn(HouseLettersController.prototype, name)).toEqual([
        "owner",
        "manager",
      ]);
      expect(guardsOnMethod(HouseLettersController.prototype, name)).toEqual([
        RolesGuard,
      ]);
    }
  });

  it("leaves every other handler ungated (writing and sending a letter by hand is not part of ADR 0167)", () => {
    // upsertTemplate stays ungated ON THE ROUTE: the five composer purposes
    // keep their roles (ADR 0313 R2), and the order letter's owner-or-manager
    // rule is the service's, against the stored purpose. orderLetter is the
    // read staff see read-only.
    for (const name of [
      "senderIdentity",
      "book",
      "queued",
      "templates",
      "upsertTemplate",
      "orderLetter",
      "queue",
      "cancel",
    ]) {
      expect(rolesOn(HouseLettersController.prototype, name)).toBeUndefined();
      expect(guardsOnMethod(HouseLettersController.prototype, name)).toEqual(
        [],
      );
    }
  });
});
