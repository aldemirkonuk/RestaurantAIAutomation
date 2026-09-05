/**
 * The two platform-admin routes, at the controller seam.
 *
 * A SEPARATE FILE ON PURPOSE. `ux-optimizer.experiments.spec.ts` is the service
 * half and is already long; this one pins the GATE, which is the half a service
 * test cannot see at all.
 *
 * The founder, 2026-09-05 (batch 45): the founder ALONE may read both arms'
 * figures, and the founder alone names the arm that becomes the product. That
 * sentence is only true if two things hold, and neither is visible in the
 * service:
 *
 *   1. `both-arms` and `winner` are gated by the platform-admin service key —
 *      not by a JWT, which every logged-in house has, and not by a role, since
 *      `RolesGuard` knows only owner / manager / staff, all three of which are
 *      roles WITHIN a house.
 *   2. NO OTHER ROUTE on this controller became public in the process.
 *      `@Public()` is what lets `ServiceKeyGuard` decide instead of the JWT, and
 *      a `@Public()` that landed on the wrong handler would open a tenant route
 *      to the internet while every test still passed.
 *
 * It also compiles the module, because adding a guard to a controller is the
 * exact class of change that kills the whole application at boot rather than
 * one route (`check_gateway_boots.sh`'s own headline).
 */

import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { DatabaseService } from "../database/database.service";
import { ModelClientModule } from "../common/model-client/model-client.module";
import { ServiceKeyGuard } from "../auth/guards/service-key.guard";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";
import { UxOptimizerModule } from "./ux-optimizer.module";
import { UxOptimizerController } from "./ux-optimizer.controller";

const fakeDb = {
  getClient: () => ({ from: () => ({ select: () => ({}) }) }),
} as unknown as DatabaseService;

/** The two acts the founder reserved, and their handler names. */
const ADMIN_ROUTES = ["experimentBothArms", "nameExperimentWinner"] as const;

/** Everything else on this controller. Each one must still need a JWT. */
const TENANT_ROUTES = [
  "ingest",
  "overrides",
  "summary",
  "propose",
  "listProposals",
  "review",
  "rollback",
  "experiment",
  "recordExperimentEvent",
  "experimentReport",
  "learnings",
] as const;

function handler(name: string): (...args: unknown[]) => unknown {
  const fn = (UxOptimizerController.prototype as unknown as Record<string, unknown>)[
    name
  ];
  if (typeof fn !== "function")
    throw new Error(
      `UxOptimizerController has no handler "${name}" — this list is stale, which is the one way this file could pass by looking at nothing`,
    );
  return fn as (...args: unknown[]) => unknown;
}

function guardsOn(name: string): unknown[] {
  return (Reflect.getMetadata("__guards__", handler(name)) as unknown[]) ?? [];
}

function isPublic(name: string): boolean {
  return Reflect.getMetadata(IS_PUBLIC_KEY, handler(name)) === true;
}

describe("the platform-admin gate on the experiment routes", () => {
  it("gates both-arms and winner with the SERVICE KEY, not a JWT", () => {
    for (const route of ADMIN_ROUTES) {
      // @Public() short-circuits the class-level JwtAuthGuard so the method
      // guard is what actually decides. Without it the route would need BOTH a
      // house's token and the admin key, and the founder holds no house token.
      expect(isPublic(route)).toBe(true);
      expect(guardsOn(route)).toContain(ServiceKeyGuard);
    }
  });

  it("leaves every other route needing a token — no route went public by accident", () => {
    for (const route of TENANT_ROUTES) {
      expect(isPublic(route)).toBe(false);
      expect(guardsOn(route)).not.toContain(ServiceKeyGuard);
    }
  });

  it("names every handler on the controller, so a new route cannot slip past unlisted", () => {
    const declared = new Set<string>([...ADMIN_ROUTES, ...TENANT_ROUTES]);
    const onTheClass = Object.getOwnPropertyNames(
      UxOptimizerController.prototype,
    ).filter(
      (n) =>
        n !== "constructor" &&
        typeof (
          UxOptimizerController.prototype as unknown as Record<string, unknown>
        )[n] === "function",
    );
    // A guard that checks a hand-written list is only as good as the list. This
    // is the line that makes the list keep up.
    expect(onTheClass.sort()).toEqual([...declared].sort());
  });
});

describe("ServiceKeyGuard on these routes", () => {
  function ctx(header?: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: header === undefined ? {} : { "x-admin-key": header },
        }),
      }),
    } as unknown as ExecutionContext;
  }

  function guardWith(key: string | undefined): ServiceKeyGuard {
    const config = {
      get: (_name: string, fallback: string) => key ?? fallback,
    } as unknown as ConfigService;
    return new ServiceKeyGuard(config);
  }

  const priorKey = process.env.ADMIN_API_KEY;
  afterEach(() => {
    if (priorKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = priorKey;
  });

  it("admits the key the gateway and the orchestrator already share", () => {
    process.env.ADMIN_API_KEY = "the-admin-key";
    expect(guardWith("the-admin-key").canActivate(ctx("the-admin-key"))).toBe(
      true,
    );
  });

  it("refuses a request with no key and a request with the wrong one", () => {
    process.env.ADMIN_API_KEY = "the-admin-key";
    expect(() => guardWith("the-admin-key").canActivate(ctx())).toThrow(
      UnauthorizedException,
    );
    expect(() => guardWith("the-admin-key").canActivate(ctx("nearly"))).toThrow(
      UnauthorizedException,
    );
  });

  it("FAILS CLOSED when ADMIN_API_KEY is unset — a missing secret is not a permission", () => {
    delete process.env.ADMIN_API_KEY;
    // The tempting one-liner (`presented === expected`) compares "" to "" here
    // and would open both routes to the internet the moment the secret was
    // removed.
    expect(() => guardWith(undefined).canActivate(ctx(""))).toThrow(
      /not configured/,
    );
    expect(() => guardWith(undefined).canActivate(ctx())).toThrow(
      /not configured/,
    );
  });
});

describe("UxOptimizerModule with the admin guard attached", () => {
  it("still resolves its whole dependency graph", async () => {
    // Adding @UseGuards to a controller resolves the guard in the module that
    // declares it. If ConfigModule were missing here, the application would
    // fail to boot — not just these two routes.
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        // @Global in the running app (ModelClientService, NfVerdictService); a
        // testing module gets no globals it did not import.
        ModelClientModule,
        UxOptimizerModule,
      ],
    })
      .overrideProvider(DatabaseService)
      .useValue(fakeDb)
      .compile();

    expect(moduleRef.get(UxOptimizerController)).toBeInstanceOf(
      UxOptimizerController,
    );
    await moduleRef.close();
  });
});
