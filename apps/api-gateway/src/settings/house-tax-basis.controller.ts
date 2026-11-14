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
import { SetHouseTaxBasisDto } from "./dto/house-tax-basis.dto";
import { HouseTaxBasisService, type HouseTaxBasisReadout } from "./house-tax-basis.service";

/**
 * The house's tax answers (ADR 0359 C2/C3). Its own controller rather than two
 * more routes on `SettingsController`, so the five specs that build that
 * controller by hand keep their constructor.
 */
@ApiTags("settings")
@ApiBearerAuth("JWT-auth")
@Controller("settings")
@UseGuards(JwtAuthGuard, TenantGuard)
export class HouseTaxBasisController {
  constructor(
    private readonly houseTaxBasis: HouseTaxBasisService,
    private readonly organizations: OrganizationsService,
  ) {}

  @Get("tax-basis")
  @ApiOperation({
    summary: "Whether the house's prices hold tax, whether it reclaims the tax it pays, and who said so",
    description:
      "`basis: \"unset\"` means nobody has answered, and every delivery is costed as its paper prints it. `readable: false` means the row could not be READ, which is a different state and says so in words. `since` is the first answer's moment: deliveries verified before it keep the cost they were posted at.",
  })
  @ApiResponse({ status: 200, description: "The tax-basis readout" })
  async read(@CurrentUser("restaurantId") restaurantId: string): Promise<HouseTaxBasisReadout> {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so there is no tax answer to read.",
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.houseTaxBasis.read(restaurantId);
  }

  @Put("tax-basis")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "State whether the house's prices hold tax and whether it reclaims it — owner or manager only",
    description:
      "Both answers are sent together. A house that charges no VAT reclaims none, and `reclaimsInputTax: true` beside `not_vat_charging` is refused. The response carries `audited` and `auditReason`.",
  })
  @ApiResponse({ status: 200, description: "The readout after the write" })
  @ApiResponse({
    status: 403,
    description: "The caller is not an owner or manager of this restaurant. What the house's stock costs is not a per-person setting.",
  })
  async write(
    @CurrentUser("restaurantId") restaurantId: string,
    @Body() dto: SetHouseTaxBasisDto,
    @CurrentUser("userId") userId: string,
  ): Promise<HouseTaxBasisReadout> {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so nothing was recorded.",
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "state whether this restaurant's prices hold tax and whether it reclaims it",
    );
    // The author comes from the signed token: `public.users.user_id`.
    return this.houseTaxBasis.write(restaurantId, dto?.basis, dto?.reclaimsInputTax, userId);
  }
}
