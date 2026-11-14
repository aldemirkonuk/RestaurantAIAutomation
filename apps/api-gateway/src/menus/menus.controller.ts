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
import { seesRawLine } from "./menu-line-view";
import { withheldRawText } from "./import-reply-view";
import { ImportMenuDto } from "./dto/import-menu.dto";
import { AddMenuItemDto } from "./dto/add-menu-item.dto";
import { ReviewMenuItemDto } from "./dto/review-menu-item.dto";
import { SetThresholdDto } from "./dto/set-threshold.dto";
import { UpdateOnboardingProgressDto } from "./dto/update-onboarding-progress.dto";
import { MakeMenuCurrentDto } from "./dto/make-menu-current.dto";
import { LinkHouseGoodDto } from "./dto/link-house-good.dto";
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
    description:
      "Every line says kitchen_line. No line is sent its raw line (the row as the import kept it), whoever reads: no page reads it from this route, and a CSV line is the whole row, cost and supplier cells included. A line whose raw line is kept says raw_line_withheld, and the reply says rawLineWithheld.",
  })
  async getMenu(@Param("restaurantId") restaurantId: string) {
    return this.menusService.getMenu(restaurantId, { rawLine: false });
  }

  @Post("import")
  @ApiOperation({
    summary:
      "Read a menu (scan, CSV or manual) and keep it as its own version, in draft",
    description:
      "ADR 0193 (menu versions): every read with a line is kept -- the source file, the extracted lines, who read it and when, and the optional cadence tag and date. It does NOT become the current menu or touch the house's prices; an owner or manager chooses that with POST /menu-versions/:menuId/make-current. A SCAN is read in the background (founder 2026-11-07): the file and a draft version are kept at once and the reply says reading: true; poll GET /menu-versions/:menuId/read. Several photos in data.images are one menu, one version. The same bytes sent again reopen the read they made (reopened, its lines as they are now), unless readAgain is true, the upload names a cadence or menu date the earlier version does not carry, or that version is retired; two sends of the same file at once make one read. A scan that finds no line, or whose AI spend record cannot be read, ends as a failed read with its sentence. A spreadsheet or typed lines are read at once; one with no line is refused (422) and nothing is kept.",
  })
  async importMenu(
    @Body() dto: ImportMenuDto,
    @CurrentUser() user: { userId: string; restaurantId: string; role?: string | null },
  ) {
    const read = await this.menusService.importMenu(dto, user.userId);
    // ADR 0358 D2: any member may read a menu in, but a line's raw text is the
    // row as the file had it -- for a spreadsheet, the cost and supplier cells
    // too -- so only a role that sees money and suppliers is sent it (the same
    // ROLE_POLICY rule GET /menu-versions/:id follows, menu-line-view.ts).
    return withheldRawText(read, seesRawLine(user.role));
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
      "Discard one line from the active menu (ADR 0160 sec110 item 7) -- owner or manager only (ADR 0358 D2). Soft remove — status becomes 'discarded', the row is kept",
  })
  async discardMenuItem(
    @Param("restaurantId") restaurantId: string,
    @Param("id") id: string,
    @CurrentUser() user: { userId?: string },
  ) {
    // ADR 0358 D2: taking a line off the menu is an owner's or a manager's.
    // Checked before anything is read or written. The path's house is the
    // session's own (JwtAuthGuard asserts the tenant match).
    if (!user?.userId) {
      throw new ForbiddenException(
        "Discarding a menu line names the person, and this session names nobody. Nothing was changed.",
      );
    }
    await this.organizations.assertCanManageRestaurant(
      user.userId,
      restaurantId,
      "discard a line from the menu",
    );
    return this.menusService.discardMenuItem(restaurantId, id);
  }
}

/**
 * The menus a house has read and kept, the current one, and the act of
 * choosing it (ADR 0193; founder, 2026-09-21, answer 7).
 *
 * TENANT SCOPE comes from the signed token (`@CurrentUser("restaurantId")`),
 * never from the path or the body. Reads are for any member of the house;
 * a line's raw line goes only to a role that sees money and suppliers
 * (ROLE_POLICY, menu-line-view.ts), because a CSV line is the whole row.
 * Making a menu current is an owner's or a manager's.
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
  @ApiOperation({
    summary: "One kept menu of this house and its lines",
    description:
      "Every line says kitchen_line. A line's raw line (the row as the import kept it) is sent only to a role whose ROLE_POLICY row sees money and suppliers (owner, manager, admin by alias). Anyone else gets no such key, raw_line_withheld on a line whose raw line is kept, and rawLineWithheld on the reply.",
  })
  async one(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("role") role: string | null,
    @Param("menuId", new ParseUUIDPipe()) menuId: string,
  ) {
    return this.menusService.getVersion(this.house(restaurantId), menuId, { rawLine: seesRawLine(role) });
  }

  @Get(":menuId/read")
  @ApiOperation({
    summary: "Where a background menu read stands, and what it found once done",
    description:
      "state is reading, done or failed (failure says why, in words). When done, reply is what POST /menus/import would have answered had it waited; a line's raw text is sent only to a role that sees money and suppliers (ADR 0358 D2). A read the server stopped hearing from for half an hour is said to have failed.",
  })
  async read(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("role") role: string | null,
    @Param("menuId", new ParseUUIDPipe()) menuId: string,
  ) {
    const status = await this.menusService.readStatus(this.house(restaurantId), menuId);
    return status.reply ? { ...status, reply: withheldRawText(status.reply, seesRawLine(role)) } : status;
  }

  @Get(":menuId/source")
  @ApiOperation({
    summary: "A five-minute link to the kept source file (photo, PDF or CSV) -- owner or manager only",
    description: "403 for anyone but an owner or a manager of the house (ADR 0358 D2). 404 with the stored reason when the source was not kept.",
  })
  async source(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Param("menuId", new ParseUUIDPipe()) menuId: string,
  ) {
    // ADR 0358 D2: the kept file is the whole menu as sent -- a spreadsheet
    // carries cost and supplier columns -- so a link to it is an owner's or a
    // manager's.
    const house = this.house(restaurantId);
    await this.organizations.assertCanManageRestaurant(userId, house, "open a kept menu file");
    return this.menusService.sourceUrl(house, menuId);
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
    return this.menusService.makeCurrent(house, menuId, userId, dto?.fingerprint ?? null, dto?.takeOff ?? []);
  }

  @Patch(":menuId/items/:itemId/house-good")
  @ApiOperation({
    summary: "Link a line of a kept menu to one of the house's own goods -- owner or manager only (r28 G21)",
    description:
      "For a line the read found to fit two or more of the house's goods (houseCandidates) and so linked to none. 409 on the current menu (its lines were carried when it was chosen) and for a good removed on Inventory; 400 for a dish; 404 for a menu, line or good that is not this house's. The plan of this menu changes, so a plan shown before the link is refused at make-current.",
  })
  @ApiResponse({ status: 403, description: "The caller is not an owner or manager of this restaurant." })
  async linkHouseGood(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Param("menuId", new ParseUUIDPipe()) menuId: string,
    @Param("itemId", new ParseUUIDPipe()) itemId: string,
    @Body() dto: LinkHouseGoodDto,
  ) {
    const house = this.house(restaurantId);
    await this.organizations.assertCanManageRestaurant(userId, house, "link a menu line to a house good");
    return this.menusService.linkLineToHouseGood(house, menuId, itemId, dto.inventoryItemId);
  }
}

@ApiTags("onboarding")
@Controller("onboarding")
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(
    private readonly menusService: MenusService,
    private readonly inboundAddress: InboundAddressService,
    private readonly organizations: OrganizationsService,
  ) {}

  @Get("progress")
  @ApiOperation({
    summary: "The setup of the house this session is in",
    description:
      "Read from the house's own tables every time: a menu read, a menu made current, a supplier, an invite. A GET writes nothing. activated = the house has a current menu with a live line. next_steps (goods_listed, mailbox_connected, invoice: none/waiting/checked) lead past the menu to the house's costs; they never decide completed_at or activated, and a fact whose read failed is null, not false. 404 when the session is in no house.",
  })
  async getProgress(
    @CurrentUser() user: { userId: string; restaurantId?: string },
  ) {
    return this.menusService.getOnboardingProgress(
      user.userId,
      user.restaurantId,
    );
  }

  @Patch("progress")
  @ApiOperation({
    summary: "Put the setup checklist away (the person's own flag)",
    description:
      "Only checklist_dismissed is written. menu_uploaded, vendor_added and team_member_invited are read from the house and a body that names them changes nothing. Answers the progress read.",
  })
  async updateProgress(
    @Body() dto: UpdateOnboardingProgressDto,
    @CurrentUser() user: { userId: string; restaurantId?: string },
  ) {
    return this.menusService.updateOnboardingProgress(
      user.userId,
      user.restaurantId,
      dto,
    );
  }

  @Patch("threshold")
  @ApiOperation({
    summary:
      "Set the house's default low-stock threshold (an owner or a manager, in the session's house)",
  })
  async setThreshold(
    @Body() dto: SetThresholdDto,
    @CurrentUser() user: { userId: string; restaurantId?: string },
  ) {
    // The house is the session's. A body that names another house is refused,
    // never followed (it used to be taken from the body alone).
    if (!user.restaurantId) {
      throw new ForbiddenException(
        "This session is in no house, so no threshold was set.",
      );
    }
    if (dto.restaurantId && dto.restaurantId !== user.restaurantId) {
      throw new ForbiddenException(
        "That is not the house this session is in. No threshold was set.",
      );
    }
    await this.organizations.assertCanManageRestaurant(
      user.userId,
      user.restaurantId,
      "set the low-stock threshold",
    );
    return this.menusService.setDefaultThreshold(
      user.restaurantId,
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
