/**
 * The two new registers boot, and they are guarded.
 *
 * WHY A MODULE TEST AND NOT ONLY A SERVICE TEST
 * ---------------------------------------------
 * `scripts/check_gateway_boots.sh` exists because `tsc --noEmit` and a passing
 * jest suite both miss the failure that actually took production down: a
 * controller carrying `@UseGuards(JwtAuthGuard)` whose module forgets to import
 * `AuthModule`. The guard resolves in the context of the module that declares
 * the controller, `AuthModule` is not `@Global()`, and the result kills the
 * whole app rather than one route.
 *
 * That guard could not be run end to end while this was written — the local
 * gateway was not listening and the full `AppModule` graph fails to resolve on
 * an unrelated in-flight change in `AnalyticsModule` (`DayExclusionsService` is
 * not exported into its context). Stated rather than skipped. What this file
 * does instead is resolve the two NEW module graphs on their own, which is
 * exactly the class of defect the boot guard catches, scoped to the code this
 * pass added.
 *
 * It also pins the tenancy rule that a service test cannot see: a token with no
 * restaurant produces a REFUSAL, never an empty register. An empty list there
 * would say "you have no servers" about a question we never managed to ask.
 */

import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import type { Request } from "express";
import { DatabaseService } from "../database/database.service";
import { ModelClientModule } from "../common/model-client/model-client.module";
import { McpConnectionsModule } from "./mcp-connections.module";
import { McpConnectionsController } from "./mcp-connections.controller";
import { McpConnectionsService } from "./mcp-connections.service";
import { PaymentMethodsModule } from "../payment-methods/payment-methods.module";
import { PaymentMethodsController } from "../payment-methods/payment-methods.controller";
import { PaymentMethodsService } from "../payment-methods/payment-methods.service";
import { OrganizationsService } from "../organizations/organizations.service";

const fakeDb = {
  supabase: {
    from: () => ({
      select: () => ({}),
    }),
  },
} as unknown as DatabaseService;

/**
 * `ModelClientModule` is here because it is `@Global()` and `AppModule` is the
 * only place that registers it; `AuthModule` reaches it transitively through
 * `OrchestratorModule`. Supplying it is what makes this a test of MY module's
 * wiring rather than a rediscovery of an existing global.
 */
async function build(mod: typeof McpConnectionsModule | typeof PaymentMethodsModule) {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      ModelClientModule,
      mod,
    ],
  })
    .overrideProvider(DatabaseService)
    .useValue(fakeDb)
    .compile();
}

/** A request shaped like the one `JwtStrategy.validate` produces. */
function req(user: Record<string, unknown> | undefined) {
  return { user } as unknown as Request & {
    user: { userId: string; restaurantId?: string };
  };
}

describe("McpConnectionsModule", () => {
  it("resolves its own dependency graph, guard included", async () => {
    const moduleRef = await build(McpConnectionsModule);

    expect(moduleRef.get(McpConnectionsController)).toBeInstanceOf(
      McpConnectionsController,
    );
    expect(moduleRef.get(McpConnectionsService)).toBeInstanceOf(
      McpConnectionsService,
    );
    await moduleRef.close();
  });

  it("refuses a session with no active restaurant instead of returning an empty register", async () => {
    const controller = new McpConnectionsController(
      {} as unknown as McpConnectionsService,
    );

    await expect(controller.list(req({ userId: "u1" }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.list(req({ userId: "u1" }))).rejects.toThrow(
      /no active restaurant/i,
    );
  });

  it("refuses a request with no user identity", async () => {
    const controller = new McpConnectionsController(
      {} as unknown as McpConnectionsService,
    );

    await expect(controller.list(req(undefined))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("takes the tenant from the token, never from the caller", async () => {
    const service = { list: jest.fn().mockResolvedValue([]) };
    const controller = new McpConnectionsController(
      service as unknown as McpConnectionsService,
    );

    await controller.list(req({ userId: "u1", restaurantId: "r-from-token" }));
    expect(service.list).toHaveBeenCalledWith("u1", "r-from-token");
  });
});

describe("PaymentMethodsModule", () => {
  it("resolves its own dependency graph, guard and organisations dependency included", async () => {
    const moduleRef = await build(PaymentMethodsModule);

    expect(moduleRef.get(PaymentMethodsController)).toBeInstanceOf(
      PaymentMethodsController,
    );
    expect(moduleRef.get(PaymentMethodsService)).toBeInstanceOf(
      PaymentMethodsService,
    );
    await moduleRef.close();
  });

  it("puts the manager-or-owner check in front of the write, using the shared rule", async () => {
    const organizations = {
      assertCanManageRestaurant: jest.fn().mockResolvedValue(undefined),
    };
    const service = { create: jest.fn().mockResolvedValue({}) };
    const controller = new PaymentMethodsController(
      service as unknown as PaymentMethodsService,
      organizations as unknown as OrganizationsService,
    );

    await controller.create(req({ userId: "u1", restaurantId: "r1" }), {
      kind: "card",
      providerRef: "pm_1",
    });

    expect(organizations.assertCanManageRestaurant).toHaveBeenCalledWith(
      "u1",
      "r1",
      "add a payment method",
    );
  });

  it("does not run the write when the role check refuses", async () => {
    const organizations = {
      assertCanManageRestaurant: jest.fn().mockRejectedValue(new Error("nope")),
    };
    const service = { create: jest.fn() };
    const controller = new PaymentMethodsController(
      service as unknown as PaymentMethodsService,
      organizations as unknown as OrganizationsService,
    );

    await expect(
      controller.create(req({ userId: "u1", restaurantId: "r1" }), {
        kind: "card",
        providerRef: "pm_1",
      }),
    ).rejects.toThrow("nope");
    expect(service.create).not.toHaveBeenCalled();
  });

  it("leaves the read open to any member with a tenant on their token", async () => {
    const service = {
      list: jest
        .fn()
        .mockResolvedValue({ provider: { connected: false }, methods: [] }),
    };
    const controller = new PaymentMethodsController(
      service as unknown as PaymentMethodsService,
      { assertCanManageRestaurant: jest.fn() } as unknown as OrganizationsService,
    );

    await expect(
      controller.list(req({ userId: "u-staff", restaurantId: "r1" })),
    ).resolves.toMatchObject({ methods: [] });
    expect(service.list).toHaveBeenCalledWith("r1");
  });
});
