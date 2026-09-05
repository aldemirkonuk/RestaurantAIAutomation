/**
 * `GET /billing/provider` is a manager's read (G19, closed 2026-09-03).
 *
 * The measurement: `billing.controller.ts:66-78` took any authenticated member,
 * while `POST /billing/setup-intent` and `POST /billing/sync` both called
 * `assertCanManageRestaurant`. What the route returns is the house's commercial
 * posture — which secrets this deployment holds, which mode the account is in,
 * and whether a signed delivery has ever arrived. Toast gates this behind
 * `Account Admin > Manage Integrations`; Square behind `account & settings`.
 *
 * It is closed together with `GET /payment-methods` deliberately. Gating the
 * cards and leaving the explanation of the cards open would have moved the leak
 * one route to the left rather than closing it.
 *
 * The precedent is `organizations/get-location-is-role-gated.spec.ts`, and so is
 * the shape of this file: assert the CHECK RUNS, and assert the work does NOT
 * happen when it refuses. A test that only asserted the check ran would pass on
 * a controller that called it and then ignored the throw.
 */

import { BadRequestException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { BillingController } from "./billing.controller";
import type { BillingService } from "./billing.service";
import type { StripeConfigService } from "./stripe-config.service";
import type { OrganizationsService } from "../organizations/organizations.service";
import type { SealChallengeService } from "../common/seal/seal-challenge.service";

function req(user: Record<string, unknown> | undefined) {
  return { user } as unknown as Request & {
    user: { userId: string; restaurantId?: string };
  };
}

const STATE = {
  connected: false,
  mode: null,
  secrets: { secretKey: false, webhookSecret: false, publishableKey: false },
  reason: "STRIPE_SECRET_KEY is not set",
  webhookLastReceivedAt: null,
  webhookReason: "No signed delivery has ever been authenticated here.",
};

function build(opts: { allow: boolean }) {
  const organizations = {
    assertCanManageRestaurant: jest.fn(async () => {
      if (!opts.allow) {
        throw new ForbiddenException(
          "Only managers and owners can see how the house pays",
        );
      }
    }),
  } as unknown as OrganizationsService;

  const config = {
    stateWithDelivery: jest.fn().mockResolvedValue(STATE),
  } as unknown as StripeConfigService;

  const controller = new BillingController(
    {} as unknown as BillingService,
    config,
    organizations,
    // The read is not sealed and never calls this — passing a stub proves it,
    // because any redemption attempt would throw on an undefined method.
    {} as unknown as SealChallengeService,
  );
  return { controller, organizations, config };
}

describe("GET /billing/provider", () => {
  it("runs the manager-or-owner check before answering", async () => {
    const { controller, organizations, config } = build({ allow: true });

    await expect(
      controller.provider(req({ userId: "u-mgr", restaurantId: "r1" })),
    ).resolves.toBe(STATE);

    expect(organizations.assertCanManageRestaurant).toHaveBeenCalledWith(
      "u-mgr",
      "r1",
      "see how the house pays",
    );
    expect(config.stateWithDelivery).toHaveBeenCalled();
  });

  it("does not read the provider state at all when the check refuses", async () => {
    const { controller, config } = build({ allow: false });

    await expect(
      controller.provider(req({ userId: "u-staff", restaurantId: "r1" })),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // The point of the fix. A refusal that still read the state and then
    // discarded it would be a gate on the response, not on the question.
    expect(config.stateWithDelivery).not.toHaveBeenCalled();
  });

  it("refuses a session with no tenant rather than answering about no house", async () => {
    const { controller } = build({ allow: true });

    await expect(
      controller.provider(req({ userId: "u-mgr" })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses a request with no user identity", async () => {
    const { controller } = build({ allow: true });

    await expect(controller.provider(req(undefined))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
