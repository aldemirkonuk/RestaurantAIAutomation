import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { MenusService } from "./menus.service";
import { ImportMenuDto } from "./dto/import-menu.dto";
import { AddMenuItemDto } from "./dto/add-menu-item.dto";
import { ReviewMenuItemDto } from "./dto/review-menu-item.dto";
import { SetThresholdDto } from "./dto/set-threshold.dto";
import { UpdateOnboardingProgressDto } from "./dto/update-onboarding-progress.dto";
import { InboundAddressService } from "../common/orchestrator/inbound-address.service";

@ApiTags("menus")
@Controller("menus")
@UseGuards(JwtAuthGuard)
export class MenusController {
  constructor(private readonly menusService: MenusService) {}

  @Post("import")
  @ApiOperation({ summary: "Import menu via scan, CSV, or manual entry" })
  async importMenu(
    @Body() dto: ImportMenuDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ) {
    return this.menusService.importMenu(dto, user.userId);
  }

  @Post("items")
  @ApiOperation({ summary: "Add one wine to a menu during the review step" })
  async addMenuItem(
    @Body() dto: AddMenuItemDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.menusService.addMenuItem(dto, user.userId);
  }

  @Patch("items/:id")
  @ApiOperation({ summary: "Apply a manager correction to one menu item field" })
  async reviewMenuItem(
    @Param("id") id: string,
    @Body() dto: ReviewMenuItemDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.menusService.reviewMenuItem(id, user.userId, dto);
  }
}

@ApiTags("onboarding")
@Controller("onboarding")
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(
    private readonly menusService: MenusService,
    private readonly inboundAddress: InboundAddressService,
  ) {}

  @Get("progress")
  @ApiOperation({ summary: "Get the authenticated user's onboarding progress" })
  async getProgress(@CurrentUser() user: { userId: string }) {
    return this.menusService.getOnboardingProgress(user.userId);
  }

  @Patch("progress")
  @ApiOperation({ summary: "Update onboarding progress fields" })
  async updateProgress(
    @Body() dto: UpdateOnboardingProgressDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.menusService.updateOnboardingProgress(user.userId, dto);
  }

  @Patch("threshold")
  @ApiOperation({
    summary: "Set the restaurant's default low-stock threshold (get-started step 3)",
  })
  async setThreshold(@Body() dto: SetThresholdDto) {
    return this.menusService.setDefaultThreshold(dto.restaurantId, dto.thresholdMin);
  }

  @Get("vendor-email")
  @ApiOperation({
    summary: "Get (provisioning if needed) this restaurant's inbound vendor email address",
  })
  async getVendorEmail(@CurrentUser() user: { restaurantId: string }) {
    const address = await this.inboundAddress.addressFor(user.restaurantId);
    return { address };
  }
}
