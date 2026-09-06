import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Public } from "../auth/decorators/public.decorator";
import { OrganizationsService } from "../organizations/organizations.service";
import { SealChallengeService } from "../common/seal/seal-challenge.service";
// A pure function and a type — no Nest module edge, so no cycle with
// `PaymentMethodsModule` (which imports `BillingConfigModule`). It is imported
// rather than restated because a second copy of the `create` arguments is a
// second seal that looks identical and is not.
import { paymentSealArgs } from "../payment-methods/payment-seal";
import { BillingService } from "./billing.service";
import { StripeConfigService } from "./stripe-config.service";
import type {
  BillingProviderResponse,
  SetupIntentResponse,
  SyncResponse,
  WebhookResponse,
} from "./dto/billing.dto";

interface AuthenticatedUser {
  userId: string;
  restaurantId?: string;
}

/**
 * `/billing` — the provider path behind `/profile` Register V.
 *
 * Three authenticated routes take their restaurant from the signed JWT and
 * never from a parameter, and ALL THREE go through the manager-or-owner rule
 * the restaurant record uses (`organizations.service.ts`,
 * `assertCanManageRestaurant`), so the endpoint's posture and the page's copy
 * say the same thing.
 *
 * `GET /billing/provider` joined them on 2026-09-03 (G19). It had been readable
 * by any authenticated member, and what it returns is the house's commercial
 * posture: which secrets this deployment holds, which mode the account is in,
 * and whether a signed delivery has ever arrived. That is a manager's fact, and
 * `/payment-methods` — whose rows it explains — is gated the same way in the
 * same pass. Gating one and not the other would have left the explanation
 * readable while the thing explained was not.
 *
 * The fourth is public and authenticated by an HMAC instead — see `webhook`.
 *
 * THE DOOR THE SEAL WAS MISSING FROM (G-PAY-SETUP, 2026-09-05)
 * -----------------------------------------------------------
 * ADR 0110's addendum sealed the three `/payment-methods` writes and recorded,
 * in its own text, that `create` was "guarded on the route nobody uses": no
 * caller in `apps/web` or `apps/mobile` posts to `/payment-methods`. An
 * instrument is attached by minting a SetupIntent HERE, confirming it on
 * Stripe's origin, and reconciling. So the attack the addendum named — a
 * manager's session quietly attaching its own instrument — ran through this
 * controller, past a role check and nothing else.
 *
 * `POST /billing/setup-intent` now redeems a `create` seal before it asks the
 * provider for anything, and stamps the spent seal's id onto the intent. `POST
 * /billing/sync` names the intent it is recording, reads that id back FROM
 * STRIPE, and proves it was redeemed by this person for this house. Two
 * requests, one seal, and the browser cannot author either half of the pairing.
 */
@ApiTags("billing")
@Controller("billing")
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly config: StripeConfigService,
    private readonly organizations: OrganizationsService,
    private readonly seals: SealChallengeService,
  ) {}

  /**
   * The binding a card-on-file `create` seal carries, in one place.
   *
   * It is byte-identical to the one `POST /payment-methods` redeems
   * (`payment-methods.controller.ts`, `payment-seal.ts`): subject kind
   * `payment_method`, subject the HOUSE's register — there is no instrument yet
   * — act `create`, arguments the three nulls a card that does not exist has.
   *
   * That sameness is deliberate and worth stating. One seal minted at
   * `POST /payment-methods/seal-challenge {"act":"create"}` is spendable at
   * EITHER route, and single use means only one of them. "Permission to put one
   * instrument on file" is one permission; which route records it is our
   * plumbing, not the operator's decision, and making them two seals would mean
   * a manager who held the gesture once could be refused for reasons they
   * cannot see.
   */
  private static readonly CREATE_SEAL = {
    subjectKind: "payment_method",
    action: "create",
  } as const;

  private createSealArgs(): Record<string, unknown> {
    return paymentSealArgs({
      act: "create",
      methodId: null,
      brand: null,
      last4: null,
    });
  }

  private scope(req: Request & { user: AuthenticatedUser }): {
    userId: string;
    restaurantId: string;
  } {
    const user = req.user;
    if (!user?.userId) throw new UnauthorizedException("Missing user identity");
    if (!user.restaurantId) {
      throw new BadRequestException(
        "This session has no active restaurant, so no provider account can be addressed.",
      );
    }
    return { userId: user.userId, restaurantId: user.restaurantId };
  }

  @Get("provider")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "The provider's state: which secrets are set, which mode, and whether a delivery ever arrived",
  })
  @ApiResponse({
    status: 200,
    description:
      "`webhookLastReceivedAt: null` means no signed delivery has EVER been authenticated here. That is not the same as healthy, and `webhookReason` says so in words.",
  })
  @ApiResponse({
    status: 403,
    description:
      "The caller is a member of the house but not a manager or owner. How the house pays is not a staff read (G19).",
  })
  async provider(
    @Req() req: Request & { user: AuthenticatedUser },
  ): Promise<BillingProviderResponse> {
    const { userId, restaurantId } = this.scope(req);
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "see how the house pays",
    );
    return this.config.stateWithDelivery();
  }

  /**
   * Permission to store an instrument — and the moment a person has to prove
   * they asked for it.
   *
   * The seal is redeemed BEFORE the provider is touched. A client secret is the
   * whole capability: whoever holds one can attach an instrument to this house's
   * customer on Stripe's own origin, where none of our guards reach. Minting one
   * and then checking would hand out the capability and audit it afterwards.
   */
  @Post("setup-intent")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Mint a SetupIntent so the browser can attach a card on Stripe's origin",
  })
  @ApiResponse({
    status: 201,
    description:
      "`clientSecret` authorises Stripe.js to attach ONE instrument to ONE customer. It cannot charge, list or read. The intent carries the id of the seal spent to mint it, which `POST /billing/sync` reads back from the provider.",
  })
  @ApiResponse({
    status: 403,
    description:
      "The caller is not a manager or owner, or carried no redeemed seal. `X-Seal-Challenge` is minted by `POST /payment-methods/seal-challenge` with `act: \"create\"` when the hold BEGINS.",
  })
  @ApiResponse({
    status: 503,
    description:
      "STRIPE_SECRET_KEY is not configured, so no intent can be minted and the page's submit stays disabled with this reason.",
  })
  async setupIntent(
    @Req() req: Request & { user: AuthenticatedUser },
    @Headers("x-seal-challenge") challenge?: string,
  ): Promise<SetupIntentResponse> {
    const { userId, restaurantId } = this.scope(req);
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "add a payment method",
    );
    const { sealId } = await this.seals.redeem({
      restaurantId,
      actorUserId: userId,
      subjectKind: BillingController.CREATE_SEAL.subjectKind,
      subjectId: restaurantId,
      action: BillingController.CREATE_SEAL.action,
      args: this.createSealArgs(),
      challenge: challenge ?? null,
    });
    return this.billing.createSetupIntent(restaurantId, sealId);
  }

  /**
   * Reconcile the register against the provider's list.
   *
   * TWO MODES, AND THE ANSWER SAYS WHICH ONE RAN
   * --------------------------------------------
   * With `setupIntentId`: the caller is recording a confirmation it has just
   * made. The provider is asked which seal that intent was minted against and
   * the seal is proven redeemed, by this person, for this house's register. This
   * is the path the card panel takes, and the one that ADDS an instrument.
   *
   * Without it: a plain reconcile — the manager's refresh. It is NOT sealed, and
   * that is a decision rather than an omission (ADR 0110's addendum, the census
   * row for this route). With `setup-intent` sealed, no session can attach an
   * instrument, so the provider's list holds only what this house approved;
   * reconciling writes that list back and can neither attach an instrument, nor
   * choose which one is charged first, nor invent a field. The identical rows
   * arrive unsealed anyway through `payment_method.attached`, which is Stripe's
   * act and not a person's. Sealing this would refuse the refresh button while
   * changing nothing an attacker could do.
   *
   * `provenance` in the response names which of the two happened, so a caller
   * can never read a skipped check as a passed one.
   */
  @Post("sync")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Reconcile this restaurant's register against the provider's list",
  })
  @ApiResponse({
    status: 200,
    description:
      "Returns what was kept and what was DROPPED, plus `provenance`: `sealed-intent` when the named SetupIntent was proven to have been minted against a seal this person redeemed, `reconcile-only` when no intent was named. An instrument removed at the provider disappears here; a sync that only inserted would leave the register showing a card that cannot be charged.",
  })
  @ApiResponse({
    status: 403,
    description:
      "The named SetupIntent belongs to another restaurant, carries no seal, or names one that was never redeemed by this person for this house's register.",
  })
  @HttpCode(200)
  async sync(
    @Req() req: Request & { user: AuthenticatedUser },
    @Body() body?: { setupIntentId?: string },
  ): Promise<SyncResponse> {
    const { userId, restaurantId } = this.scope(req);
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "reconcile the payment register",
    );

    const setupIntentId = (body?.setupIntentId ?? "").trim();
    if (!setupIntentId) return this.billing.sync(restaurantId, "reconcile-only");

    const sealId = await this.billing.sealOnSetupIntent(
      restaurantId,
      setupIntentId,
    );
    await this.seals.assertRedeemed({
      sealId,
      restaurantId,
      actorUserId: userId,
      subjectKind: BillingController.CREATE_SEAL.subjectKind,
      subjectId: restaurantId,
      action: BillingController.CREATE_SEAL.action,
      args: this.createSealArgs(),
    });
    return this.billing.sync(restaurantId, "sealed-intent");
  }

  /**
   * Stripe's own account of what changed.
   *
   * `@Public()` because the caller is Stripe and holds no JWT; the
   * authentication is the HMAC over the EXACT request bytes
   * (`stripe-signature.ts`), which fails closed when
   * `STRIPE_WEBHOOK_SECRET` is unset. The body is parsed from `rawBody` AFTER
   * verification rather than from `@Body()`, so the object we act on is
   * byte-identical to the object we authenticated — a re-serialised body is a
   * different string and would quietly let a mismatch through.
   *
   * Always 200 on a refusal, never 401: Stripe retries a non-2xx for days, and
   * a signature that will never verify (a wrong secret) must not become a
   * retry storm. The body says `received: false` and names the failing check.
   */
  @Public()
  @Post("webhook")
  @HttpCode(200)
  @ApiOperation({
    summary: "Stripe webhook — HMAC-authenticated, idempotent on the event id",
    description:
      "Handles setup_intent.succeeded, payment_method.attached/updated/automatically_updated and payment_method.detached. Every other event type is RECORDED as ignored with its reason. Exactly-once is enforced by the primary key on billing_webhook_events; a delivery that failed halfway is left unhandled so a redelivery is retried rather than swallowed.",
  })
  @ApiHeader({
    name: "Stripe-Signature",
    description:
      "t=<unix>,v1=<hex HMAC-SHA256 of `${t}.${rawBody}` under STRIPE_WEBHOOK_SECRET>. Five-minute tolerance.",
    required: true,
  })
  webhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers("stripe-signature") signature: string | undefined,
  ): Promise<WebhookResponse> {
    return this.billing.handleWebhook(request.rawBody, signature);
  }
}
