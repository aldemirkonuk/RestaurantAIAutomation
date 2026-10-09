import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantGuard } from "../common/tenant/tenant.guard";
import { OrganizationsService } from "../organizations/organizations.service";
import { SetHouseLocationDto } from "./dto/house-location.dto";
import { HouseLocationService, type HouseLocationReadout } from "./house-location.service";

/**
 * The house's address and map point (F-174). The calendar's weather reads the
 * point and nothing else; before this route only sign-up could write it.
 *
 * Its own controller under `/settings`, beside `SettingsController`, as the
 * /ask training choice is, so the route carries no dependency the other
 * registers do not need. The house is the token's, never a parameter. The read
 * is any member of the house; the write is an owner or a manager, the same
 * gate as the currency and the time zone.
 */
@ApiTags("settings")
@ApiBearerAuth("JWT-auth")
@Controller("settings")
@UseGuards(JwtAuthGuard, TenantGuard)
export class HouseLocationController {
  constructor(
    private readonly houseLocation: HouseLocationService,
    private readonly organizations: OrganizationsService,
  ) {}

  @Get("location")
  @ApiOperation({
    summary: "The house's street address and map point",
    description:
      "`latitude: null` means no map point is recorded, so the calendar can read no forecast. Both numbers or neither: a half pair reads as none. `readable: false` means the row could not be READ, which is a different state and says so in words.",
  })
  @ApiResponse({ status: 200, description: "The location readout" })
  async read(@CurrentUser("restaurantId") restaurantId: string): Promise<HouseLocationReadout> {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so there is no address to read.",
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.houseLocation.read(restaurantId);
  }

  @Put("location")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Set the house's address and map point — owner or manager only",
    description:
      "The street and a finite latitude/longitude pair travel together, from the place picked in the address search. Nothing is geocoded here and nothing is defaulted. The response carries `audited` and `auditReason`.",
  })
  @ApiResponse({ status: 200, description: "The readout after the write" })
  @ApiResponse({
    status: 403,
    description: "The caller is not an owner or manager of this restaurant.",
  })
  async write(
    @CurrentUser("restaurantId") restaurantId: string,
    @Body() dto: SetHouseLocationDto,
    @CurrentUser("userId") userId: string,
  ): Promise<HouseLocationReadout> {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so nothing was recorded.",
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "set the address and map point of this restaurant",
    );
    // The author comes from the signed token (`public.users.user_id`).
    return this.houseLocation.write(
      restaurantId,
      dto?.street,
      dto?.latitude,
      dto?.longitude,
      userId,
    );
  }
}
