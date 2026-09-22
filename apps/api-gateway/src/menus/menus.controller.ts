import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { TenantGuard } from "../common/tenant/tenant.guard";
import { OrganizationsService } from "../organizations/organizations.service";
import { MenusService } from "./menus.service";
import { ImportMenuDto } from "./dto/import-menu.dto";
import { AddMenuItemDto } from "./dto/add-menu-item.dto";
import { ReviewMenuItemDto } from "./dto/review-menu-item.dto";
import { SetThresholdDto } from "./dto/set-threshold.dto";
import { UpdateOnboardingProgressDto } from "./dto/update-onboarding-progress.dto";
import { MakeMenuCurrentDto } from "./dto/make-menu-current.dto";
import { InboundAddressService } from "../common/orchestrator/inbound-address.service";

/** The two fields of a menu line that are prices (ADR 0193). */
const MENU_PRICE_FIELDS = new Set(["by_glass_price", "bottle_price"]);

@ApiTags("menus")
@Controller("menus")
@UseGuards(JwtAuthGuard)
export class MenusController {
  constructor(
    private readonly menusService: MenusService,
    // ADR 0193, founder 2026-09-21 (answer 1): menu price corrections are an
    // owner's or a manager's, resolved from the house's access rows.
    private readonly organizations: OrganizationsService,
  ) {}

  @Get(":restaurantId")
  @ApiOperation({
    summary:
      "The active menu and its items for a restaurant (the interactive menu's read path)",
  })
  async getMenu(@Param("restaurantId") restaurantId: string) {
    return this.menusService.getMenu(restaurantId);
  }

  @Post("import")
  @ApiOperation({
    summary:
      "Read a menu (scan, CSV or manual) and keep it as its own version, in draft",
    description:
      "ADR 0193 (menu versions): every read is kept -- the source file, the extracted lines, who read it and when, and the optional cadence tag and date. It does NOT become the current menu or touch the house's prices; an owner or manager chooses that with POST /menu-versions/:menuId/make-current. A scan's AI spend ceiling fails CLOSED: if the spend record cannot be read, the read waits (503) and says why.",
  })
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
    @CurrentUser() user: { userId: string; restaurantId?: string },
  ) {
    // restaurantId comes from the JWT, never the body — dto.menuId names
    // WHICH menu, the caller's own restaurantId is what proves they may
    // write to it (menus.service.ts#addMenuItem, fixed 2026-09-17 alongside
    // this build; see that method's docstring for the gap this closes).
    // Whether the caller may PRICE is resolved here and decided in the
    // service, which alone knows whether the menu is the current one.
    const role =
      user.restaurantId && user.userId
        ? await this.organizations.resolveRestaurantRole(user.userId, user.restaurantId)
        : null;
    return this.menusService.addMenuItem(
      dto,
      user.userId,
      user.restaurantId ?? null,
      role === "owner" || role === "manager",
    );
  }

  @Patch("items/:id")
  @ApiOperation({
    summary:
      "Apply a manager correction to one menu item field of the caller's own house. A price correction also updates the house's own bottle/glass price (ADR 0193)",
  })
  async reviewMenuItem(
    @Param("id") id: string,
    @Body() dto: ReviewMenuItemDto,
    @CurrentUser() user: { userId: string; restaurantId?: string },
  ) {
    // The house comes from the JWT, never the body: this route names no
    // restaurant, so the service scopes the menu line to the caller's own
    // (ADR 0193 -- it used to load the line by id alone).
    //
    // A PRICE correction is an owner's or a manager's (founder, 2026-09-21,
    // answer 1: menu price corrections are owner/manager only, audited -- the
    // correction is on the line's override trail, and on the current menu the
    // house price change is a menu_price_versions row naming the person).
    // Checked before anything is written. Other fields are unchanged.
    if (MENU_PRICE_FIELDS.has(dto.fieldName)) {
      if (!user.userId || !user.restaurantId) {
        throw new ForbiddenException(
          "A price correction names the person and the house, and this session names neither. Nothing was changed.",
        );
      }
      await this.organizations.assertCanManageRestaurant(
        user.userId,
        user.restaurantId,
        "correct a price on the menu",
      );
    }
    return this.menusService.reviewMenuItem(
      id,
      user.userId,
      user.restaurantId ?? null,
      dto,
    );
  }

  @Patch(":restaurantId/items/:id/discard")
  @ApiOperation({
    summary:
      "Discard one line from the active menu (ADR 0160 sec110 item 7). Soft remove — status becomes 'discarded', the row is kept",
  })
  async discardMenuItem(
    @Param("restaurantId") restaurantId: string,
    @Param("id") id: string,
  ) {
    return this.menusService.discardMenuItem(restaurantId, id);
  }
}

/**
 * The menus a house has read and kept, the current one, and the act of
 * choosing it (ADR 0193; founder, 2026-09-21, answer 7).
 *
 * TENANT SCOPE comes from the signed token (`@CurrentUser("restaurantId")`),
 * never from the path or the body. Reads are for any member of the house;
 * making a menu current is an owner's or a manager's.
 */
@ApiTags("menus")
@Controller("menu-versions")
@UseGuards(JwtAuthGuard, TenantGuard)
export class MenuVersionsController {
  constructor(
    private readonly menusService: MenusService,
    private readonly organizations: OrganizationsService,
  ) {}

  private house(restaurantId: string | undefined): string {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so it has no menus.",
        HttpStatus.BAD_REQUEST,
      );
    }
    return restaurantId;
  }

  @Get()
  @ApiOperation({
    summary: "Every menu this house has read, newest first, with the current one and the last one used",
    description: "A failed read is a 500, never an empty history.",
  })
  async list(@CurrentUser("restaurantId") restaurantId: string) {
    return this.menusService.listVersions(this.house(restaurantId));
  }

  @Get(":menuId")
  @ApiOperation({ summary: "One kept menu of this house and its lines" })
  async one(
    @CurrentUser("restaurantId") restaurantId: string,
    @Param("menuId", new ParseUUIDPipe()) menuId: string,
  ) {
    return this.menusService.getVersion(this.house(restaurantId), menuId);
  }

  @Get(":menuId/source")
  @ApiOperation({
    summary: "A five-minute link to the kept source file (photo, PDF or CSV)",
    description: "404 with the stored reason when the source was not kept.",
  })
  async source(
    @CurrentUser("restaurantId") restaurantId: string,
    @Param("menuId", new ParseUUIDPipe()) menuId: string,
  ) {
    return this.menusService.sourceUrl(this.house(restaurantId), menuId);
  }

  @Get(":menuId/plan")
  @ApiOperation({
    summary: "What choosing this menu would do, per line and per kind, before anyone chooses it",
    description:
      "ADR 0193 round 3 (L13; the founder, 2026-09-21: \"add a section to that where you can lock price\"). Per line and per kind: the house price, the menu price and the result (change, unchanged, held_by_lock, blank_kept, blank_never_priced, not_linked, new_wine); for a price that would be replaced, who set it and when; the lock that holds a kind; every open lock whose wine is NOT on this menu (kept, dormant); and a fingerprint that make-current requires. Nothing is written. A failed read is a 500, never a plan with a hole in it.",
  })
  async plan(
    @CurrentUser("restaurantId") restaurantId: string,
    @Param("menuId", new ParseUUIDPipe()) menuId: string,
  ) {
    return this.menusService.planFor(this.house(restaurantId), menuId);
  }

  @Post(":menuId/make-current")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Make a kept menu the current one — owner or manager only, naming the plan it was shown",
    description:
      "Requires the fingerprint of GET /menu-versions/:menuId/plan: 400 without it, 409 (nothing changed) when the plan recomputed now differs. Archives the house's current menu (who and when: that is 'the last one used'), stamps this one current, then carries its lines to the house's inventory and prices DATED BY THE CHOICE (an older menu chosen again brings its prices back), except a kind a price lock holds, which is reported and named. A blank price keeps the house's price and flags the line; a line with no price for a wine the house has none for is flagged too. Says per outcome how many lines did what, and names any line whose price failed or was held.",
  })
  @ApiResponse({ status: 403, description: "The caller is not an owner or manager of this restaurant." })
  @ApiResponse({ status: 409, description: "The plan changed since it was shown. Nothing was changed." })
  async makeCurrent(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Param("menuId", new ParseUUIDPipe()) menuId: string,
    @Body() dto: MakeMenuCurrentDto,
  ) {
    const house = this.house(restaurantId);
    await this.organizations.assertCanManageRestaurant(
      userId,
      house,
      "choose the current menu",
    );
    return this.menusService.makeCurrent(house, menuId, userId, dto?.fingerprint ?? null);
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
    summary:
      "Set the restaurant's default low-stock threshold (get-started step 3)",
  })
  async setThreshold(@Body() dto: SetThresholdDto) {
    return this.menusService.setDefaultThreshold(
      dto.restaurantId,
      dto.thresholdMin,
    );
  }

  @Get("vendor-email")
  @ApiOperation({
    summary:
      "Get (provisioning if needed) this restaurant's inbound vendor email address",
  })
  async getVendorEmail(@CurrentUser() user: { restaurantId: string }) {
    const address = await this.inboundAddress.addressFor(user.restaurantId);
    return { address };
  }
}
