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
 * `/payment-methods` — the Payment register on `/profile`.
 *
 * The restaurant comes from the signed JWT, never from a parameter. Reads are
 * open to any member of the house with a tenant on their token; writes go
 * through the same manager-or-owner rule that guards the restaurant record, so
 * the endpoint's posture and the page's copy say the same thing.
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
  async list(
    @Req() req: Request & { user: AuthenticatedUser },
  ): Promise<PaymentMethodsResponse> {
    const { restaurantId } = this.scope(req);
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
