import {
  BadRequestException,
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
 * never from a parameter, and the two that touch the provider additionally go
 * through the manager-or-owner rule the restaurant record uses
 * (`organizations.service.ts`, `assertCanManageRestaurant`), so the endpoint's
 * posture and the page's copy say the same thing.
 *
 * The fourth is public and authenticated by an HMAC instead — see `webhook`.
 */
@ApiTags("billing")
@Controller("billing")
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly config: StripeConfigService,
    private readonly organizations: OrganizationsService,
  ) {}

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
  provider(): Promise<BillingProviderResponse> {
    return this.config.stateWithDelivery();
  }

  @Post("setup-intent")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Mint a SetupIntent so the browser can attach a card on Stripe's origin",
  })
  @ApiResponse({
    status: 201,
    description:
      "`clientSecret` authorises Stripe.js to attach ONE instrument to ONE customer. It cannot charge, list or read.",
  })
  @ApiResponse({
    status: 503,
    description:
      "STRIPE_SECRET_KEY is not configured, so no intent can be minted and the page's submit stays disabled with this reason.",
  })
  async setupIntent(
    @Req() req: Request & { user: AuthenticatedUser },
  ): Promise<SetupIntentResponse> {
    const { userId, restaurantId } = this.scope(req);
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "add a payment method",
    );
    return this.billing.createSetupIntent(restaurantId);
  }

  @Post("sync")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Reconcile this restaurant's register against the provider's list",
  })
  @ApiResponse({
    status: 200,
    description:
      "Returns what was kept and what was DROPPED. An instrument removed at the provider disappears here; a sync that only inserted would leave the register showing a card that cannot be charged.",
  })
  @HttpCode(200)
  async sync(
    @Req() req: Request & { user: AuthenticatedUser },
  ): Promise<SyncResponse> {
    const { userId, restaurantId } = this.scope(req);
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "reconcile the payment register",
    );
    return this.billing.sync(restaurantId);
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
