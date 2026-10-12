import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantGuard } from "../common/tenant/tenant.guard";
import { OrganizationsService } from "../organizations/organizations.service";
import {
  AddHouseTaxRateDto,
  ConfirmHouseTaxBasisDto,
} from "./dto/house-tax-basis.dto";
import {
  HouseTaxBasisService,
  type HouseTaxBasisReadout,
} from "./house-tax-basis.service";

/**
 * Whether this house's till prices include tax, and its rates (F-620 /
 * F-1537, lane 2; founder 2026-10-12, S218: F1 build it, F2 only from now).
 *
 * TENANT SCOPE. Every route takes the house from the signed token
 * (`@CurrentUser("restaurantId")`), never from the path or the body, so there
 * is no house id to tamper with. The one id a body may carry — a rate's item
 * — is looked up inside this house, and any other answers 404 (ADR 0147).
 * The two writes run `assertCanManageRestaurant` first: owner or manager.
 */
@ApiTags("settings")
@ApiBearerAuth("JWT-auth")
@Controller("settings")
@UseGuards(JwtAuthGuard, TenantGuard)
export class HouseTaxBasisController {
  constructor(
    private readonly taxBasis: HouseTaxBasisService,
    private readonly organizations: OrganizationsService,
  ) {}

  private requireHouse(restaurantId: string | undefined, what: string): string {
    if (!restaurantId) {
      throw new HttpException(
        `This session is not attached to a restaurant, so ${what}.`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return restaurantId;
  }

  @Get("tax-basis")
  @ApiOperation({
    summary:
      "Whether this house's till prices include tax, who said so, and its rates",
    description:
      '`basis: "unset"` means nobody at the house has said; figures then read exactly as the till sends them. `proposal` is what the house\'s recorded country suggests and is never written. `readable: false` means the row could not be read, which is a different state and says so.',
  })
  async read(
    @CurrentUser("restaurantId") restaurantId: string,
  ): Promise<HouseTaxBasisReadout> {
    return this.taxBasis.read(
      this.requireHouse(restaurantId, "there is no tax setting to read"),
    );
  }

  @Put("tax-basis")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Say whether this house's till prices include tax — owner or manager only",
    description:
      "One of prices_include_tax, prices_exclude_tax, not_vat_charging. Written with who and when in one update; that moment is the date reports mark as the switch (checks already stored are not recomputed). The answer already recorded writes nothing. Audited as house_tax_basis_confirmed.",
  })
  @ApiResponse({
    status: 403,
    description: "The caller is not an owner or manager of this restaurant.",
  })
  async confirm(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Body() dto: ConfirmHouseTaxBasisDto,
  ): Promise<HouseTaxBasisReadout> {
    const house = this.requireHouse(restaurantId, "nothing was recorded");
    await this.organizations.assertCanManageRestaurant(
      userId,
      house,
      "say whether this restaurant's prices include tax",
    );
    return this.taxBasis.confirm(
      house,
      dto ?? ({} as ConfirmHouseTaxBasisDto),
      userId,
    );
  }

  @Post("tax-rates")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Add one tax rate from a date — owner or manager only",
    description:
      "Rates are appended, never edited: a changed or corrected rate is a new row, and ratePct null withdraws a key from its date. Read only for a house whose prices include tax. Audited as house_tax_rate_added.",
  })
  @ApiResponse({
    status: 403,
    description: "The caller is not an owner or manager of this restaurant.",
  })
  @ApiResponse({
    status: 404,
    description: "The item named is not one of this house's.",
  })
  async addRate(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Body() dto: AddHouseTaxRateDto,
  ): Promise<HouseTaxBasisReadout> {
    const house = this.requireHouse(restaurantId, "nothing was recorded");
    await this.organizations.assertCanManageRestaurant(
      userId,
      house,
      "add a tax rate for this restaurant",
    );
    return this.taxBasis.addRate(
      house,
      dto ?? ({} as AddHouseTaxRateDto),
      userId,
    );
  }
}
