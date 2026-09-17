import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { OrganizationsService } from "../organizations/organizations.service";
import { PaymentMethodsService } from "./payment-methods.service";
import { SealChallengeService } from "../common/seal/seal-challenge.service";
import {
  PaymentSealAct,
  isPaymentSealAct,
  paymentSealArgs,
} from "./payment-seal";
import {
  CreatePaymentMethodDto,
  PaymentMethodResponse,
  PaymentMethodsResponse,
} from "./dto/payment-method.dto";

interface AuthenticatedUser {
  userId: string;
  restaurantId?: string;
}

/**
 * `/payment-methods` — the house's cards on file (`/connections` Register II;
 * `/profile` links here while the Connections flag is on).
 *
 * The restaurant comes from the signed JWT, never from a parameter.
 *
 * THE READ IS GATED, AND IT WAS NOT (G19, 2026-09-03)
 * --------------------------------------------------
 * Until now `GET /payment-methods` took any authenticated member of the house
 * while every write called `assertCanManageRestaurant`, and the page gated only
 * the controls (`PaymentRegister.tsx:370-385` rendered the rows for every
 * role). `payment_methods` has no `user_id` column at all
 * (`20260903094600_payment_methods.sql:53`) — it is a house object, and the day
 * `STRIPE_SECRET_KEY` is set a staff member's own page would have shown the
 * house's instruments. Toast gates this behind `Account Admin > Manage
 * Integrations`, Square behind `account & settings`. The read now runs the same
 * check as the write, so "managers and owners" is true of the endpoint and not
 * only of the button. The refusal is a 403 whose message names the action, and
 * the page renders it in words rather than as an empty register.
 */
@ApiTags("payment-methods")
@Controller("payment-methods")
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true }))
export class PaymentMethodsController {
  constructor(
    private readonly service: PaymentMethodsService,
    private readonly organizations: OrganizationsService,
    private readonly seals: SealChallengeService,
  ) {}

  /**
   * The seal on a payment write is REDEEMED, not asserted (founder,
   * 2026-09-04; ADR 0110 addendum).
   *
   * Every write below ran behind `assertCanManageRestaurant` and nothing else,
   * which answers "may this ROLE do it" and cannot answer "did a PERSON do it".
   * Anything holding a manager's session could attach an instrument, make it
   * the one charged first, or detach the house's card, and the gateway had no
   * way to tell that from a manager's own thumb. ADR 0110 records that no
   * charge path exists yet; that is exactly why this is cheap to fix now.
   *
   * Two checks, not one: the ROLE is asserted when the seal is issued AND again
   * when the write arrives, so a manager demoted between the two cannot spend a
   * token they were legitimately given.
   */
  private async assertSealed(
    userId: string,
    restaurantId: string,
    act: PaymentSealAct,
    methodId: string | null,
    challenge: string | undefined,
  ): Promise<void> {
    // An ABSENT seal is refused before the instrument is read. Reading first
    // would answer a caller with no seal with whatever the read said — which,
    // when the register itself is unreachable, is a 500 about a table rather
    // than the sentence telling them to begin the hold. The cheap, certain
    // refusal comes first.
    const present = (challenge ?? "").trim().length > 0;
    const facts =
      !present || methodId === null
        ? { methodId: methodId ?? null, brand: null, last4: null }
        : await this.service.sealFacts(restaurantId, methodId);

    await this.seals.redeem({
      restaurantId,
      actorUserId: userId,
      subjectKind: "payment_method",
      // `create` has no instrument yet, so its subject is the house's register.
      // See `payment-seal.ts` for why that is stated rather than inferred.
      subjectId: methodId ?? restaurantId,
      action: act,
      args: paymentSealArgs({ act, ...facts }),
      challenge: challenge ?? null,
    });
  }

  /**
   * Begin the hold. Returns a one-time seal, once.
   *
   * Minted when the gesture STARTS, never at the moment of the write — a token
   * fetched by the same request it authorises is the assertion model with extra
   * steps.
   */
  @Post("seal-challenge")
  @ApiOperation({
    summary: "Mint the one-time seal a payment-method write has to carry back",
  })
  @ApiResponse({
    status: 201,
    description:
      "`challenge` (returned once, never stored in the clear), `expiresAt` and `act`. Bound to this actor, this act and this instrument's own brand and last four — so it cannot be spent by another person, on another instrument, for another act, or after the row behind that id became a different card.",
  })
  @ApiResponse({
    status: 403,
    description: "The caller is not a manager or owner of this house.",
  })
  async sealChallenge(
    @Req() req: Request & { user: AuthenticatedUser },
    @Body() body: { act?: string; methodId?: string },
  ): Promise<{ challenge: string; expiresAt: string; act: string }> {
    const { userId, restaurantId } = this.scope(req);
    const act = body?.act;
    if (!isPaymentSealAct(act)) {
      throw new BadRequestException(
        'A seal names the act it approves. Send `act` as one of "create", "set_default" or "remove".',
      );
    }
    const methodId = act === "create" ? null : (body?.methodId ?? null);
    if (act !== "create" && !methodId) {
      throw new BadRequestException(
        `A seal for "${act}" names the instrument it is for. Send \`methodId\`.`,
      );
    }

    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "seal a change to how this house pays",
    );

    const facts =
      methodId === null
        ? { methodId: null, brand: null, last4: null }
        : await this.service.sealFacts(restaurantId, methodId);

    const issued = await this.seals.issue({
      restaurantId,
      actorUserId: userId,
      subjectKind: "payment_method",
      subjectId: methodId ?? restaurantId,
      action: act,
      args: paymentSealArgs({ act, ...facts }),
    });
    return {
      challenge: issued.challenge,
      expiresAt: issued.expiresAt,
      act: issued.action,
    };
  }

  private scope(req: Request & { user: AuthenticatedUser }): {
    userId: string;
    restaurantId: string;
  } {
    const user = req.user;
    if (!user?.userId) throw new UnauthorizedException("Missing user identity");
    if (!user.restaurantId) {
      throw new BadRequestException(
        "This session has no active restaurant, so a payment register cannot be addressed.",
      );
    }
    return { userId: user.userId, restaurantId: user.restaurantId };
  }

  @Get()
  @ApiOperation({
    summary: "List payment methods, with the state of the provider behind them",
  })
  @ApiResponse({
    status: 200,
    description:
      "`methods` plus `provider`. An empty `methods` with `provider.connected === false` means no instrument CAN exist, which is not the same as none being on file.",
  })
  @ApiResponse({
    status: 403,
    description:
      "The caller is a member of the house but not a manager or owner. The house's instruments are not a staff read (G19).",
  })
  async list(
    @Req() req: Request & { user: AuthenticatedUser },
  ): Promise<PaymentMethodsResponse> {
    const { userId, restaurantId } = this.scope(req);
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "see how the house pays",
    );
    return this.service.list(restaurantId);
  }

  @Post()
  @ApiOperation({ summary: "Record a payment method returned by the provider" })
  @ApiResponse({
    status: 503,
    description:
      "Returned in this deployment: no provider credential is configured, so no instrument can be recorded.",
  })
  async create(
    @Req() req: Request & { user: AuthenticatedUser },
    @Body() dto: CreatePaymentMethodDto,
    @Headers("x-seal-challenge") challenge?: string,
  ): Promise<PaymentMethodResponse> {
    const { userId, restaurantId } = this.scope(req);
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "add a payment method",
    );
    await this.assertSealed(userId, restaurantId, "create", null, challenge);
    return this.service.create(restaurantId, dto);
  }

  @Patch(":id/default")
  @ApiOperation({
    summary: "Make this the instrument the house is charged first",
  })
  @ApiResponse({
    status: 200,
    description:
      "The default is written at the PROVIDER before the local flag is flipped — \"charged first\" is a fact about the Stripe customer, not about our column.",
  })
  @ApiResponse({
    status: 503,
    description:
      "No provider credential is configured, so there is nothing to charge and nothing to prefer.",
  })
  async setDefault(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("x-seal-challenge") challenge?: string,
  ): Promise<PaymentMethodResponse> {
    const { userId, restaurantId } = this.scope(req);
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "change which payment method is charged first",
    );
    await this.assertSealed(userId, restaurantId, "set_default", id, challenge);
    return this.service.setDefault(restaurantId, id);
  }

  @Delete(":id")
  @ApiOperation({
    summary:
      "Detach a payment method at the provider, then remove it from this restaurant",
  })
  @ApiResponse({
    status: 200,
    description:
      "The removed id. The detach happens FIRST: dropping our row alone would leave a live instrument on the customer that the next reconcile would faithfully restore.",
  })
  async remove(
    @Req() req: Request & { user: AuthenticatedUser },
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("x-seal-challenge") challenge?: string,
  ): Promise<{ removed: string }> {
    const { userId, restaurantId } = this.scope(req);
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "remove a payment method",
    );
    await this.assertSealed(userId, restaurantId, "remove", id, challenge);
    return this.service.remove(restaurantId, id);
  }
}
