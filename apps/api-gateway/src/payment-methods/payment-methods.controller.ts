import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
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
  ) {}

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
  ): Promise<PaymentMethodResponse> {
    const { userId, restaurantId } = this.scope(req);
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "add a payment method",
    );
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
  ): Promise<PaymentMethodResponse> {
    const { userId, restaurantId } = this.scope(req);
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "change which payment method is charged first",
    );
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
  ): Promise<{ removed: string }> {
    const { userId, restaurantId } = this.scope(req);
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "remove a payment method",
    );
    return this.service.remove(restaurantId, id);
  }
}
