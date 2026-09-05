/**
 * `/communications/text-credits` — the meter a house reads, and the one write
 * that changes what it is charged.
 *
 * WHY THIS SITS IN ITS OWN DIRECTORY
 * ----------------------------------
 * `scripts/check_money_routes_are_sealed.py` scans DIRECTORIES, and its rule is
 * that every non-GET route in a money module is sealed. Pointing it at all of
 * `communications/text` would have pulled in six sender and consent routes that
 * are not money — declaring a sender, recording a registration request,
 * revoking, consenting, withdrawing — and each would then have needed an
 * allow-list row. Six exemptions to make one route enforceable is a guard
 * diluted into a formality, so the money route lives where the guard's scope is
 * exactly the money.
 *
 * THREE ROUTES, ONE OF THEM SEALED
 * --------------------------------
 *   `GET  /meter`           the whole readout: month, used, allowance, balance.
 *   `POST /seal-challenge`  mints the one-time seal a purchase must carry back.
 *   `POST /purchase`        redeems it and records the purchase.
 *
 * WHY THE PURCHASE IS SEALED AND THE METER IS NOT
 * -----------------------------------------------
 * ADR 0107's rule is that an act which changes what a house is charged, and
 * which the house cannot undo by asking, carries a person's own gesture rather
 * than a session's role. Buying credits is money leaving; reading the meter is
 * not. Sealing the read would refuse a refresh button while changing nothing an
 * attacker could do — the same reasoning `POST /billing/sync` records for its
 * unsealed reconcile path.
 *
 * THE SEAL IS MINTED WHEN THE HOLD BEGINS, NEVER IN THE REQUEST THAT SPENDS IT.
 * A token fetched by the same request it authorises is the assertion model with
 * extra steps, which is exactly what ADR 0114's `sealed: true` was and what
 * ADR 0107's addendum replaced.
 *
 * WHAT THE SEAL IS BOUND TO, AND WHY IT IS THE AMOUNT
 * ---------------------------------------------------
 * `subjectKind: "text_credit_purchase"`, `subjectId: <the restaurant>` — there
 * is no purchase row yet, the same shape `payment_method`'s `create` seal has —
 * and the ARGUMENTS are the amount and the currency. So a seal held over "50
 * USD" cannot be spent on "500 USD": the args hash changes and the redemption
 * refuses with `arguments_changed`. Binding it to the restaurant alone would
 * let a browser that obtained one gesture spend any amount it liked.
 *
 * NO PAYMENT IS TAKEN HERE. This records that a house bought credits; charging
 * an instrument is `/billing`'s job and is deliberately not wired to this
 * route. Wiring them together is a decision about who is charged and when, and
 * that decision has not been made (see the report's fork Q2).
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { JwtAuthGuard } from "../../../auth/guards/jwt-auth.guard";
import { OrganizationsService } from "../../../organizations/organizations.service";
import { SealChallengeService } from "../../../common/seal/seal-challenge.service";
import { TextUsageService, type MeterReadout } from "../text-usage.service";

interface AuthenticatedUser {
  userId: string;
  restaurantId?: string;
}

/**
 * The arguments a credit-purchase seal is bound to, in ONE place.
 *
 * A pure function rather than two inline object literals, for the reason
 * `paymentSealArgs` exists: a second copy of the arguments is a second seal
 * that looks identical and is not, and the failure mode is a manager who held
 * the gesture being refused for a reason nobody can see.
 */
export function creditPurchaseSealArgs(input: {
  amountMinor: number;
  currency: string;
}): Record<string, unknown> {
  return { amountMinor: input.amountMinor, currency: input.currency };
}

interface PurchaseBody {
  amountMinor?: number;
  currency?: string;
}

@ApiTags("communications")
@Controller("communications/text-credits")
@UseGuards(JwtAuthGuard)
export class TextCreditsController {
  constructor(
    private readonly usage: TextUsageService,
    private readonly organizations: OrganizationsService,
    private readonly seals: SealChallengeService,
  ) {}

  private scope(req: Request & { user: AuthenticatedUser }): {
    userId: string;
    restaurantId: string;
  } {
    const user = req.user;
    if (!user?.userId) throw new UnauthorizedException("Missing user identity");
    if (!user.restaurantId) {
      throw new BadRequestException(
        "This session has no active restaurant, so no message meter can be addressed.",
      );
    }
    return { userId: user.userId, restaurantId: user.restaurantId };
  }

  /**
   * Validate the two money fields once, so the seal and the spend cannot
   * disagree about what they are for.
   */
  private money(body: PurchaseBody | undefined): {
    amountMinor: number;
    currency: string;
  } {
    const amountMinor = body?.amountMinor;
    const currency = (body?.currency ?? "").toUpperCase();
    if (!Number.isInteger(amountMinor) || (amountMinor as number) <= 0) {
      throw new BadRequestException(
        "A credit purchase names a whole number of minor units above zero. Send `amountMinor`.",
      );
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new BadRequestException(
        "A credit purchase names its currency as a three-letter ISO 4217 code. An amount with no currency is not money. Send `currency`.",
      );
    }
    return { amountMinor: amountMinor as number, currency };
  }

  @Get("meter")
  @ApiOperation({
    summary:
      "This house's message meter: month, messages used, allowance, credit balance",
  })
  @ApiResponse({
    status: 200,
    description:
      "`allowance: null` means NO ALLOWANCE STATED and is never zero — the number is set from measured usage after a quarter of it. `usedThisMonth: null` means the count could not be READ, which is not the same as none. `readable: false` names which read failed.",
  })
  @ApiResponse({
    status: 403,
    description:
      "The caller is a member of the house but not a manager or owner. What the house is charged is not a staff read (G19).",
  })
  async meter(
    @Req() req: Request & { user: AuthenticatedUser },
  ): Promise<MeterReadout> {
    const { userId, restaurantId } = this.scope(req);
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "see this house's message meter",
    );
    return this.usage.readout(restaurantId);
  }

  @Post("seal-challenge")
  @ApiOperation({
    summary: "Mint the one-time seal a credit purchase has to carry back",
  })
  @ApiResponse({
    status: 201,
    description:
      "`challenge` (returned once, never stored in the clear) and `expiresAt`. Bound to this actor, this house and THIS AMOUNT AND CURRENCY, so a seal held over one figure cannot be spent on another.",
  })
  async sealChallenge(
    @Req() req: Request & { user: AuthenticatedUser },
    @Body() body: PurchaseBody,
  ): Promise<{ challenge: string; expiresAt: string; act: string }> {
    const { userId, restaurantId } = this.scope(req);
    const { amountMinor, currency } = this.money(body);

    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "seal a purchase of message credits",
    );

    const issued = await this.seals.issue({
      restaurantId,
      actorUserId: userId,
      subjectKind: "text_credit_purchase",
      subjectId: restaurantId,
      action: "purchase",
      args: creditPurchaseSealArgs({ amountMinor, currency }),
    });
    return {
      challenge: issued.challenge,
      expiresAt: issued.expiresAt,
      act: issued.action,
    };
  }

  @Post("purchase")
  @HttpCode(200)
  @ApiOperation({ summary: "Record a purchase of message credits" })
  @ApiHeader({
    name: "X-Seal-Challenge",
    description:
      "The one-time seal minted by POST /communications/text-credits/seal-challenge for THIS amount and currency, when the hold began.",
    required: true,
  })
  @ApiResponse({
    status: 200,
    description:
      "The recorded entry and the meter as it stands after it. NO PAYMENT IS TAKEN by this route: it records that credits were bought, and charging an instrument is /billing's job.",
  })
  @ApiResponse({
    status: 403,
    description:
      "The caller is not a manager or owner, or carried no redeemed seal, or carried one minted for a different amount.",
  })
  async purchase(
    @Req() req: Request & { user: AuthenticatedUser },
    @Body() body: PurchaseBody,
    @Headers("x-seal-challenge") challenge?: string,
  ): Promise<{
    recorded: boolean;
    entryId: string | null;
    words: string;
    meter: MeterReadout;
  }> {
    const { userId, restaurantId } = this.scope(req);
    const { amountMinor, currency } = this.money(body);

    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "buy message credits",
    );

    // REDEEMED BEFORE ANYTHING IS WRITTEN. The order is the point: redeeming
    // after the insert would record a purchase and then decide whether it was
    // allowed, which is auditing a capability instead of gating it.
    const { sealId } = await this.seals.redeem({
      restaurantId,
      actorUserId: userId,
      subjectKind: "text_credit_purchase",
      subjectId: restaurantId,
      action: "purchase",
      args: creditPurchaseSealArgs({ amountMinor, currency }),
      challenge: challenge ?? null,
    });

    const recorded = await this.usage.recordPurchase({
      restaurantId,
      sealId,
      amountMinor,
      currency,
      recordedBy: userId,
      paymentRef: null,
    });

    return { ...recorded, meter: await this.usage.readout(restaurantId) };
  }
}
