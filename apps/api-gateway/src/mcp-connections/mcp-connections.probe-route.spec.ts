/**
 * The runtime routes, at the controller seam.
 *
 * A SEPARATE FILE ON PURPOSE. `mcp-connections.controller.spec.ts` is shared
 * with the payment register and is being edited by another build in the same
 * worktree; the three routes added by the MCP runtime pass get their own file so
 * neither pass has to merge the other's assertions.
 *
 * What it pins that a service test cannot see:
 *   · the tenant on a probe comes from the TOKEN, never from a parameter — the
 *     one thing that separates "check my server" from "check anyone's server";
 *   · `GET /mcp-connections/runtime` is still scoped, because what this
 *     deployment is configured with is not a public question;
 *   · the extended module graph still resolves with `McpRuntimeModule` pulled
 *     in, which is the class of failure `check_gateway_boots.sh` exists for.
 */

import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import type { Request } from "express";
import { DatabaseService } from "../database/database.service";
import { ModelClientModule } from "../common/model-client/model-client.module";
import { McpConnectionsModule } from "./mcp-connections.module";
import { McpConnectionsController } from "./mcp-connections.controller";
import { OrganizationsService } from "../organizations/organizations.service";
import { McpConnectionsService } from "./mcp-connections.service";
import { McpRuntimeService } from "../mcp-runtime/mcp-runtime.service";
import { McpSecretService } from "../mcp-runtime/mcp-secret.service";

const fakeDb = {
  supabase: { from: () => ({ select: () => ({}) }) },
} as unknown as DatabaseService;

function req(user: Record<string, unknown> | undefined) {
  return { user } as unknown as Request & {
    user: { userId: string; restaurantId?: string };
  };
}

describe("McpConnectionsModule with the runtime attached", () => {
  it("still resolves its whole dependency graph, guard and wire client included", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        ModelClientModule,
        McpConnectionsModule,
      ],
    })
      .overrideProvider(DatabaseService)
      .useValue(fakeDb)
      .compile();

    expect(moduleRef.get(McpConnectionsController)).toBeInstanceOf(
      McpConnectionsController,
    );
    // Imported by this module rather than registered in AppModule, so if that
    // wiring is wrong nothing else in the gateway would notice.
    expect(moduleRef.get(McpRuntimeService, { strict: false })).toBeInstanceOf(
      McpRuntimeService,
    );
    expect(moduleRef.get(McpSecretService, { strict: false })).toBeInstanceOf(
      McpSecretService,
    );
    await moduleRef.close();
  });
});

/**
 * A manager check that passes.
 *
 * Probing, setting a secret and revoking became manager-or-owner acts under ADR
 * 0114, so the controller needs the shared rule injected. These tests are about
 * SCOPE — that the tenant comes from the token — so the role check is satisfied
 * rather than exercised; its own refusals are pinned in
 * mcp-connections.controller.spec.ts and mcp-connections.tool-gate.spec.ts.
 */
function allowManager(): OrganizationsService {
  return {
    assertCanManageRestaurant: jest.fn().mockResolvedValue(undefined),
  } as unknown as OrganizationsService;
}

describe("POST /mcp-connections/:id/probe", () => {
  it("takes the tenant from the token, never from the caller", async () => {
    const service = { probe: jest.fn().mockResolvedValue({}) };
    const controller = new McpConnectionsController(
      service as unknown as McpConnectionsService,
      allowManager(),
    );

    await controller.probe(
      req({ userId: "u1", restaurantId: "r-from-token" }),
      "id-1",
    );
    expect(service.probe).toHaveBeenCalledWith("r-from-token", "u1", "id-1");
  });

  it("refuses a session with no active restaurant", async () => {
    const controller = new McpConnectionsController(
      {} as unknown as McpConnectionsService,
      allowManager(),
    );
    await expect(
      controller.probe(req({ userId: "u1" }), "id-1"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses a request with no user identity", async () => {
    const controller = new McpConnectionsController(
      {} as unknown as McpConnectionsService,
      allowManager(),
    );
    await expect(
      controller.probe(req(undefined), "id-1"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe("PUT /mcp-connections/:id/secret", () => {
  it("passes an explicit null through as a clear, scoped by the token", async () => {
    const service = { setSecret: jest.fn().mockResolvedValue({}) };
    const controller = new McpConnectionsController(
      service as unknown as McpConnectionsService,
      allowManager(),
    );

    await controller.setSecret(req({ userId: "u1", restaurantId: "r1" }), "id-1", {
      secret: null,
    });
    expect(service.setSecret).toHaveBeenCalledWith("r1", "u1", "id-1", null);
  });

  it("never hands the secret back to the caller", async () => {
    // The route returns the ROW, and the row type has no secret field at all —
    // this asserts the actual object, because a type is not a runtime promise.
    const row = {
      id: "id-1",
      hasSecret: true,
      secretSetAt: "2026-09-03T09:30:00.000Z",
    };
    const service = { setSecret: jest.fn().mockResolvedValue(row) };
    const controller = new McpConnectionsController(
      service as unknown as McpConnectionsService,
      allowManager(),
    );

    const returned = await controller.setSecret(
      req({ userId: "u1", restaurantId: "r1" }),
      "id-1",
      { secret: "the-house-token" },
    );
    expect(JSON.stringify(returned)).not.toContain("the-house-token");
    expect(JSON.stringify(returned)).not.toContain("secret_encrypted");
  });
});

describe("GET /mcp-connections/runtime", () => {
  it("is scoped: what this deployment holds is not a public question", () => {
    const controller = new McpConnectionsController(
      { runtimeState: jest.fn() } as unknown as McpConnectionsService,
      allowManager(),
    );
    expect(() => controller.runtime(req(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it("returns the deployment's own state", () => {
    const state = {
      secretStorage: { configured: false, reason: "MCP_CONNECTION_SECRET_KEY is not set" },
      invocation: { enabled: true, reason: "granted by name; the seal on a write" },
      probeTimeoutMs: 8000,
    };
    const controller = new McpConnectionsController(
      { runtimeState: () => state } as unknown as McpConnectionsService,
      allowManager(),
    );
    expect(controller.runtime(req({ userId: "u1", restaurantId: "r1" }))).toBe(
      state,
    );
  });
});
