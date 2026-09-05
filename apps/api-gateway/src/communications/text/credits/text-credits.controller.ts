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
 * THE PAYMENT IS TAKEN HERE, SINCE 2026-09-05 (founder, Q2: *"Wire it to the
 * card on file, sealed"*; rejected: leave it unwired). The order is the whole
 * design and it is not negotiable:
 *
 *   1. the role check, 2. the seal redeemed, 3. THE CHARGE, 4. the ledger row.
 *
 * A refused charge writes nothing and says why. A charge is never attempted
 * without a redeemed seal, and a credit never exists without a PaymentIntent
 * id on it — enforced again at the database by
 * `house_message_credits_purchase_is_paid`.
 *
 * IDEMPOTENT ON THE SEAL, TWICE OVER. Stripe's idempotency key is derived from
 * the seal id, so a repeated charge returns the original intent; and
 * `uq_house_message_credits_purchase_seal` makes a second credit row for one
 * seal impossible. The seal itself is single-use, so a replayed request is
 * refused before it reaches either.
 *
 * THAT WINDOW IS CLOSED SINCE 2026-09-06 (founder: *"Close it now with the
 * intent row"*). The order is now five steps, and the third exists only so the
 * fourth can crash safely:
 *
 *   1. the role check
 *   2. the seal redeemed
 *   3. THE INTENT ROW written, then moved to `charge_may_exist` BEFORE the
 *      provider is asked — a state written after the call could never describe
 *      a crash during it
 *   4. the charge
 *   5. the credit, and the intent settled against it
 *
 * So there is no longer a moment where money can move with nothing on disk to
 * say so. A crash anywhere past step 3 leaves a row a reconcile can resolve by
 * asking the provider what the seal actually produced —
 * `PurchaseIntentReconciler`, reachable from
 * `scripts/reconcile_message_credit_purchases.py`.
 *
 * THE RESPONSE NEVER AGAIN SAYS `charged: true, recorded: false`. It carries one
 * `state` — the intent's own — because two booleans that can disagree are two
 * facts a caller has to reconcile in its head, and the whole point of the intent
 * row is that the reconciling is done here, on disk.
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
import { ServiceKeyGuard } from "../../../auth/guards/service-key.guard";
import { Public } from "../../../auth/decorators/public.decorator";
import { OrganizationsService } from "../../../organizations/organizations.service";
import { SealChallengeService } from "../../../common/seal/seal-challenge.service";
import { BillingService } from "../../../billing/billing.service";
import { TextUsageService, type MeterReadout } from "../text-usage.service";
import { PurchaseIntentService } from "./purchase-intent.service";
import {
  PurchaseIntentReconciler,
  type ReconcileRun,
} from "./purchase-intent.reconciler";

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
    private readonly billing: BillingService,
    private readonly intents: PurchaseIntentService,
    private readonly reconciler: PurchaseIntentReconciler,
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
      "One `state`, never a pair of booleans that can disagree: `settled` (charged and credited), `voided` (nothing charged, and proven so), or `charge_may_exist` (the provider was asked and the answer is not known yet — a reconcile will resolve it, and the response says so rather than claiming a failure).",
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
    state: "settled" | "voided" | "charge_may_exist";
    settled: boolean;
    paymentIntentId: string | null;
    entryId: string | null;
    intentId: string | null;
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

    // 2. REDEEMED BEFORE ANYTHING ELSE HAPPENS. Redeeming after the charge would
    // take money and then decide whether it was allowed, which is auditing a
    // capability instead of gating it.
    const { sealId } = await this.seals.redeem({
      restaurantId,
      actorUserId: userId,
      subjectKind: "text_credit_purchase",
      subjectId: restaurantId,
      action: "purchase",
      args: creditPurchaseSealArgs({ amountMinor, currency }),
      challenge: challenge ?? null,
    });

    // 3a. THE INTENT ROW, before the provider exists to this request.
    const opened = await this.intents.open({
      restaurantId,
      sealId,
      amountMinor,
      currency,
      intendedBy: userId,
    });
    if (opened.state === "failed") {
      // Nothing was asked of the provider, so nothing can have been charged.
      // Voiding is not needed: no row exists to void.
      return {
        state: "voided",
        settled: false,
        paymentIntentId: null,
        entryId: null,
        intentId: null,
        words: `This purchase was not started, so nothing was charged: ${opened.reason}. The hold you gave has been used up, so buying again starts a new one.`,
        meter: await this.usage.readout(restaurantId),
      };
    }
    const intent = opened.intent;

    // A replay of a seal that already settled: answer with what happened rather
    // than charging again. Unreachable through the seal (single use) and kept
    // because a reconcile can call this path.
    if (intent.state === "settled") {
      return {
        state: "settled",
        settled: true,
        paymentIntentId: intent.paymentRef,
        entryId: intent.creditEntryId,
        intentId: intent.id,
        words:
          "This purchase was already charged and credited; nothing was charged again.",
        meter: await this.usage.readout(restaurantId),
      };
    }

    // 3b. SAY ON DISK THAT A CHARGE MAY EXIST, BEFORE ASKING. If this write
    // fails we must not charge: the only way to reach the provider is through a
    // row that already admits the provider may have been reached.
    const attempting = await this.intents.markAttempting(intent.id);
    if (!attempting.ok) {
      return {
        state: "voided",
        settled: false,
        paymentIntentId: null,
        entryId: null,
        intentId: intent.id,
        words: `Nothing was charged, because this purchase could not be marked as attempted first: ${attempting.reason}. Recording the attempt before making it is what stops money moving with nothing on record.`,
        meter: await this.usage.readout(restaurantId),
      };
    }

    // 4. THE CHARGE.
    const charge = await this.billing.chargeForMessageCredits({
      restaurantId,
      amountMinor,
      currency,
      sealId,
    });

    if (!charge.charged) {
      // The provider answered and refused. That IS proof, so the intent is
      // voided here rather than left for a reconcile.
      await this.intents.void({
        intentId: intent.id,
        reason: `the provider refused the charge (${charge.reason}): ${charge.words}`,
      });
      return {
        state: "voided",
        settled: false,
        paymentIntentId: null,
        entryId: null,
        intentId: intent.id,
        words: `${charge.words} Nothing was recorded and this house's balance is unchanged. The hold you gave has been used up, so buying again starts a new one.`,
        meter: await this.usage.readout(restaurantId),
      };
    }

    // 5. THE CREDIT, then the intent settled against it.
    const recorded = await this.usage.recordPurchase({
      restaurantId,
      sealId,
      amountMinor,
      currency,
      recordedBy: userId,
      paymentRef: charge.paymentIntentId,
    });

    if (!recorded.recorded || !recorded.entryId) {
      // THE OLD HOLE, NOW A KNOWN STATE. The money moved and the credit did not,
      // and the intent row says exactly that on disk. The response does NOT
      // report a contradiction for a person to resolve — it names the state and
      // says a reconcile will finish it.
      return {
        state: "charge_may_exist",
        settled: false,
        paymentIntentId: charge.paymentIntentId,
        entryId: null,
        intentId: intent.id,
        words: `The card was charged and the credit has not landed yet (${recorded.words}). This purchase is recorded as unfinished and will be completed by a reconcile against the provider; nothing is lost and nothing will be charged twice.`,
        meter: await this.usage.readout(restaurantId),
      };
    }

    const settled = await this.intents.settle({
      intentId: intent.id,
      paymentRef: charge.paymentIntentId,
      creditEntryId: recorded.entryId,
      detail: "settled by the purchase request itself",
    });

    return {
      state: settled.ok ? "settled" : "charge_may_exist",
      settled: settled.ok,
      paymentIntentId: charge.paymentIntentId,
      entryId: recorded.entryId,
      intentId: intent.id,
      words: settled.ok
        ? `${charge.words} ${recorded.words}`
        : `${charge.words} ${recorded.words} The purchase record could not be closed (${settled.reason}); the credit IS on this house's meter, so no money is unaccounted for, and a reconcile will tidy the record.`,
      meter: await this.usage.readout(restaurantId),
    };
  }

  /**
   * Finish every purchase that did not.
   *
   * WHY THIS IS A SERVICE-KEY ROUTE AND NOT A SEALED ONE. A seal binds an act to
   * a PERSON who made a gesture. There is no person here: the caller is the
   * founder's own runner (`scripts/reconcile_message_credit_purchases.py`) or an
   * operator, and what it does is not a new decision — it ASKS THE PROVIDER what
   * already happened and writes down the answer. It cannot charge, it cannot
   * choose an amount, and it cannot void anything the provider has not been
   * asked about. `ServiceKeyGuard` (ADR 0099) authenticates the machine and
   * fails closed when `ADMIN_API_KEY` is unset.
   *
   * `@Public()` does not mean unauthenticated: Nest requires every class guard
   * as well as the method ones, so it short-circuits the class-level
   * `JwtAuthGuard` in order to let `ServiceKeyGuard` be what decides — the same
   * shape `POST /communications/email` and the commodity admin routes use.
   *
   * NO TENANT FROM A SESSION. `ServiceKeyGuard`'s own header says a route using
   * it must derive neither a user nor a tenant from `request.user`, so the
   * optional restaurant filter comes from the body and narrows a read that is
   * otherwise fleet-wide by design — an unresolved charge belongs to whoever it
   * belongs to, and the reconcile must not miss one because a session pointed
   * somewhere else.
   *
   * IT IS SAFE TO RUN AT ANY TIME, INCLUDING TWICE. Settled rows are not in the
   * open set; the credit write is protected by
   * `uq_house_message_credits_purchase_seal`; and an intent younger than the
   * provider's own search lag is left alone rather than judged.
   */
  @Public()
  @UseGuards(ServiceKeyGuard)
  @Post("reconcile")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Ask the provider what unfinished purchases actually did, and record it",
  })
  @ApiHeader({
    name: "X-Admin-Key",
    description:
      "ADMIN_API_KEY. The caller is a machine; there is no session and no seal.",
    required: true,
  })
  @ApiResponse({
    status: 200,
    description:
      "`considered: null` means the open set could not be READ — never that there was nothing open. Each result carries the outcome and the sentence behind it, including `too_young_to_judge`, which is a refusal to decide rather than a failure.",
  })
  async reconcile(
    @Body() body?: { restaurantId?: string },
  ): Promise<ReconcileRun> {
    return this.reconciler.run({ restaurantId: body?.restaurantId });
  }
}
