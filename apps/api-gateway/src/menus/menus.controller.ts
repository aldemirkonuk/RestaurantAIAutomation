import {
  Body,
  Controller,
  Delete,
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
import { ImportMenuDto } from "./dto/import-menu.dto";
import { AddMenuItemDto } from "./dto/add-menu-item.dto";
import { ReviewMenuItemDto } from "./dto/review-menu-item.dto";
import { SetThresholdDto } from "./dto/set-threshold.dto";
import { UpdateOnboardingProgressDto } from "./dto/update-onboarding-progress.dto";
import { MakeMenuCurrentDto } from "./dto/make-menu-current.dto";
import {
  AssignMenuLinesDto,
  ConfirmMenuLineDto,
  ConfirmMenuSectionDto,
  CreateMenuSectionDto,
  MoveMenuSectionDto,
  RenameMenuSectionDto,
  ReorderMenuSectionsDto,
  ReparentMenuSectionDto,
  SetMenuSectionCategoryDto,
} from "./dto/menu-section.dto";
import { MenuSectionsService } from "./menu-sections.service";
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
      "ADR 0193 (menu versions): every read is kept -- the source file, the extracted lines, who read it and when, and the optional cadence tag and date. It does NOT become the current menu or touch the house's prices; an owner or manager chooses that with POST /menu-versions/:menuId/make-current. A scan's AI spend ceiling fails CLOSED: if the spend record cannot be read, the read waits (503) and says why.",
  })
  // F-475 (2026-10-09): left open to every member on purpose. A read only makes
  // a draft (ADR 0193 §7); making it current is the owner/manager act, and the
  // /menu page draws "Read a menu" for every role (MenuVersions.tsx ReadMenuForm,
  // canManage gates only the make-current buttons). The zip-bomb risk is closed
  // by the size check in parsers/xlsx-size-guard.ts, not by narrowing who reads.
  async importMenu(
    @Body() dto: ImportMenuDto,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ) {
    return this.menusService.importMenu(dto, user.userId);
  }

  @Post("items")
  @ApiOperation({
    summary:
      "Add one wine to a menu. On the current menu, owner or manager only",
  })
  async addMenuItem(
    @Body() dto: AddMenuItemDto,
    @CurrentUser() user: { userId: string; restaurantId?: string },
  ) {
    // restaurantId comes from the JWT, never the body — dto.menuId names
    // WHICH menu, the caller's own restaurantId is what proves they may
    // write to it (menus.service.ts#addMenuItem, fixed 2026-09-17 alongside
    // this build; see that method's docstring for the gap this closes).
    // Whether the caller is an owner or a manager is resolved here and decided
    // in the service, which alone knows whether the menu is the current one:
    // only they may add to the current menu (F-698); a draft is open to the
    // house.
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
    // A NAME correction is held to the same rule (F-920): it also renames the
    // house's own wine in stock, and /menu offers Edit only to an owner or a
    // manager. Checked before anything is written.
    if (dto.fieldName === "name") {
      if (!user.userId || !user.restaurantId) {
        throw new ForbiddenException(
          "A rename names the person and the house, and this session names neither. Nothing was changed.",
        );
      }
      await this.organizations.assertCanManageRestaurant(
        user.userId,
        user.restaurantId,
        "rename a wine on the menu",
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
      "Discard one line from the active menu (ADR 0160 sec110 item 7). Soft remove — status becomes 'discarded', the row is kept. Owner or manager only",
  })
  async discardMenuItem(
    @Param("restaurantId") restaurantId: string,
    @Param("id") id: string,
    @CurrentUser() user: { userId?: string },
  ) {
    // Taking a line off the guest menu is an owner's or a manager's, the same
    // people who may price one (POST /menus/items above; coordinator's call
    // for the founder, 2026-10-08, F-268). Checked before anything is written.
    if (!user?.userId) {
      throw new ForbiddenException(
        "Taking a line off the menu names the person, and this session names no one. Nothing was changed.",
      );
    }
    await this.organizations.assertCanManageRestaurant(
      user.userId,
      restaurantId,
      "take a line off the menu",
    );
    // F-484: the person is passed so the discard is filed under their name
    // (a `menu_line_discarded` row in system_audit_log, read on /logs).
    return this.menusService.discardMenuItem(restaurantId, id, user.userId);
  }

  @Get(":restaurantId/discarded")
  @ApiOperation({
    summary:
      "The lines taken off the current menu, so an owner or manager can see them and put one back (F-268)",
  })
  async getDiscardedLines(@Param("restaurantId") restaurantId: string) {
    return this.menusService.getDiscardedLines(restaurantId);
  }

  @Patch(":restaurantId/items/:id/restore")
  @ApiOperation({
    summary:
      "Put a discarded line back on the menu, at the status it had when it was discarded (in review when that was never kept). Owner or manager only",
  })
  async restoreMenuItem(
    @Param("restaurantId") restaurantId: string,
    @Param("id") id: string,
    @CurrentUser() user: { userId?: string },
  ) {
    // Putting a line back is the same act as taking it off (F-268): an
    // owner's or a manager's, checked before anything is written.
    if (!user?.userId) {
      throw new ForbiddenException(
        "Putting a line back on the menu names the person, and this session names no one. Nothing was changed.",
      );
    }
    await this.organizations.assertCanManageRestaurant(
      user.userId,
      restaurantId,
      "put a line back on the menu",
    );
    // F-1419: filed under the person, as the discard is (F-484).
    return this.menusService.restoreMenuItem(restaurantId, id, user.userId);
  }
}

/**
 * The menus a house has read and kept, the current one, and the act of
 * choosing it (ADR 0193; founder, 2026-09-21, answer 7).
 *
 * TENANT SCOPE comes from the signed token (`@CurrentUser("restaurantId")`),
 * never from the path or the body. Reads are for any member of the house;
 * a line's raw line goes only to a role that sees money and suppliers
 * (ROLE_POLICY, menu-line-view.ts), because a CSV line is the whole row,
 * and so does the kept source file (F-1386). Making a menu current is an
 * owner's or a manager's.
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

  @Get(":menuId/source")
  @ApiOperation({
    summary: "A five-minute link to the kept source file (photo, PDF or CSV)",
    description:
      "Only for a role whose ROLE_POLICY row sees money and suppliers (owner, manager, admin by alias); anyone else gets a 403 that says why, whatever the file is. 404 with the stored reason when the source was not kept.",
  })
  async source(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("role") role: string | null,
    @Param("menuId", new ParseUUIDPipe()) menuId: string,
  ) {
    // F-1386 (tech-debt.d/2026-10-08-fix-a-menu-line-carries-its-raw-line.md
    // entry (i), the coordinator's rule): a kept CSV or workbook is every
    // row, cost and supplier cells included, and the gateway cannot tell a
    // printed menu PDF from a costed list, so every kept file goes only to
    // the viewer who would be sent the raw line.
    if (!seesRawLine(role)) {
      throw new ForbiddenException(
        "The menu's kept file is for an owner or a manager, because a file can carry costs and suppliers.",
      );
    }
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
    // F-1292: a menu read only in part is made current only when the person
    // said so; the service refuses it otherwise.
    if (dto?.partReadAccepted === true)
      return this.menusService.makeCurrent(
        house,
        menuId,
        userId,
        dto.fingerprint ?? null,
        true,
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
    // The house-wide low-stock number is an owner's or a manager's (F-1060).
    private readonly organizations: OrganizationsService,
  ) {}

  @Get("progress")
  @ApiOperation({ summary: "Get the authenticated user's onboarding progress" })
  async getProgress(
    @CurrentUser() user: { userId: string; restaurantId?: string | null },
  ) {
    return this.menusService.getOnboardingProgress(
      user.userId,
      user.restaurantId ?? null,
    );
  }

  @Patch("progress")
  @ApiOperation({ summary: "Update onboarding progress fields" })
  async updateProgress(
    @Body() dto: UpdateOnboardingProgressDto,
    @CurrentUser() user: { userId: string; restaurantId?: string | null },
  ) {
    return this.menusService.updateOnboardingProgress(
      user.userId,
      user.restaurantId ?? null,
      dto,
    );
  }

  @Get("threshold")
  @ApiOperation({
    summary:
      "The house's low-stock number and how many items it carries now — owner or manager only (the low-stock step and Settings open on them)",
  })
  @ApiResponse({
    status: 403,
    description: "The caller is not an owner or manager of this restaurant.",
  })
  async getThreshold(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
  ) {
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      "set the low-stock number",
    );
    // F-1414: the saved number too, so the field opens on it, not on 6.
    const [carried, defaultThresholdMin] = await Promise.all([
      this.menusService.countCarriedItems(restaurantId),
      this.menusService.readDefaultThreshold(restaurantId),
    ]);
    return { carried, default_threshold_min: defaultThresholdMin };
  }

  @Patch("threshold")
  @ApiOperation({
    summary:
      "Set the restaurant's default low-stock threshold — owner or manager only",
    description:
      "The default reaches items added from now on. Items carried now keep their own par unless applyToCarried is true, which sets the number on every item the house carries and says how many.",
  })
  @ApiResponse({
    status: 403,
    description: "The caller is not an owner or manager of this restaurant.",
  })
  async setThreshold(
    @CurrentUser("userId") userId: string,
    @Body() dto: SetThresholdDto,
  ) {
    await this.organizations.assertCanManageRestaurant(
      userId,
      dto.restaurantId,
      "set the low-stock number",
    );
    return this.menusService.setDefaultThreshold(
      dto.restaurantId,
      dto.thresholdMin,
      dto.applyToCarried === true,
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

/**
 * A menu's sections, edited in the review and on the Full menu (ADR 0340
 * rules 6, 9, 10, 12, 18; lane 3b). Every route, the read included, is an
 * owner's or a manager's: sections are how the house files its drinks, and
 * the change log names who did what. The house and the actor come from the
 * signed token, never the path or the body; a menu, section or line of
 * another house is a 404 (ADR 0147). On a live menu a rename, a reparent
 * that keeps the drink category, a reorder and a delete are allowed; a
 * category, a kind, a line move and a confirmation are a review's (409).
 */
@ApiTags("menus")
@Controller("menu-versions")
@UseGuards(JwtAuthGuard, TenantGuard)
export class MenuSectionsController {
  constructor(
    private readonly sections: MenuSectionsService,
    private readonly organizations: OrganizationsService,
  ) {}

  /** The session's house, after the owner-or-manager check. */
  private async manager(
    restaurantId: string | undefined,
    userId: string,
    action: string,
  ): Promise<string> {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so it has no menus.",
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      action,
    );
    return restaurantId;
  }

  @Get(":menuId/sections")
  @ApiOperation({
    summary: "A menu's sections in the house's order — owner or manager only",
  })
  @ApiResponse({
    status: 403,
    description: "The caller is not an owner or manager of this restaurant.",
  })
  async list(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Param("menuId", new ParseUUIDPipe()) menuId: string,
  ) {
    const house = await this.manager(
      restaurantId,
      userId,
      "read a menu's sections",
    );
    return this.sections.list(house, menuId);
  }

  @Post(":menuId/sections")
  @ApiOperation({ summary: "Add a section — owner or manager only; logged" })
  @ApiResponse({
    status: 409,
    description: "A section with that name is already there.",
  })
  async create(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Param("menuId", new ParseUUIDPipe()) menuId: string,
    @Body() dto: CreateMenuSectionDto,
  ) {
    const house = await this.manager(
      restaurantId,
      userId,
      "add a section to a menu",
    );
    return this.sections.create(
      house,
      menuId,
      userId,
      dto.title,
      dto.parentId ?? null,
      dto.drinkCategory ?? null,
    );
  }

  @Post(":menuId/sections/order")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Reorder the sections under one parent — owner or manager only; logged",
  })
  async reorder(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Param("menuId", new ParseUUIDPipe()) menuId: string,
    @Body() dto: ReorderMenuSectionsDto,
  ) {
    const house = await this.manager(
      restaurantId,
      userId,
      "reorder a menu's sections",
    );
    return this.sections.reorder(
      house,
      menuId,
      userId,
      dto.parentId ?? null,
      dto.ids,
    );
  }

  @Patch(":menuId/sections/:sectionId")
  @ApiOperation({
    summary: "Rename a section — owner or manager only; the key stays; logged",
  })
  async rename(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Param("menuId", new ParseUUIDPipe()) menuId: string,
    @Param("sectionId", new ParseUUIDPipe()) sectionId: string,
    @Body() dto: RenameMenuSectionDto,
  ) {
    const house = await this.manager(
      restaurantId,
      userId,
      "rename a menu section",
    );
    return this.sections.rename(house, menuId, sectionId, userId, dto.title);
  }

  @Post(":menuId/sections/:sectionId/parent")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Put a section inside another (or at the top level) — owner or manager only; logged",
  })
  @ApiResponse({
    status: 409,
    description:
      "On a live menu, the move would change the drink category its lines are filed under.",
  })
  async reparent(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Param("menuId", new ParseUUIDPipe()) menuId: string,
    @Param("sectionId", new ParseUUIDPipe()) sectionId: string,
    @Body() dto: ReparentMenuSectionDto,
  ) {
    const house = await this.manager(
      restaurantId,
      userId,
      "move a menu section",
    );
    return this.sections.reparent(
      house,
      menuId,
      sectionId,
      userId,
      dto.parentId ?? null,
    );
  }

  @Delete(":menuId/sections/:sectionId")
  @ApiOperation({
    summary:
      "Delete a section with no subsections; its lines go to Unsorted — owner or manager only; logged",
  })
  @ApiResponse({
    status: 409,
    description: "The section has sections inside it.",
  })
  async remove(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Param("menuId", new ParseUUIDPipe()) menuId: string,
    @Param("sectionId", new ParseUUIDPipe()) sectionId: string,
  ) {
    const house = await this.manager(
      restaurantId,
      userId,
      "delete a menu section",
    );
    return this.sections.remove(house, menuId, sectionId, userId);
  }

  @Post(":menuId/sections/:sectionId/move")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Move a section to the upload's Drinks, Food or Desserts draft — owner or manager only; logged",
    description:
      "Drafts of one upload only (409 otherwise). The target draft is made in the same step when the upload produced none. The section lands at the target's top level. Lines moved onto the Drinks draft are resolved against the library.",
  })
  async move(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Param("menuId", new ParseUUIDPipe()) menuId: string,
    @Param("sectionId", new ParseUUIDPipe()) sectionId: string,
    @Body() dto: MoveMenuSectionDto,
  ) {
    const house = await this.manager(
      restaurantId,
      userId,
      "move a menu section to another menu",
    );
    return this.sections.moveToKind(house, menuId, sectionId, userId, dto.kind);
  }

  @Post(":menuId/sections/:sectionId/category")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Set a section's drink category on a draft — owner or manager only; logged",
    description: "409 on a live or kept menu.",
  })
  async setCategory(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Param("menuId", new ParseUUIDPipe()) menuId: string,
    @Param("sectionId", new ParseUUIDPipe()) sectionId: string,
    @Body() dto: SetMenuSectionCategoryDto,
  ) {
    const house = await this.manager(
      restaurantId,
      userId,
      "set a menu section's drink category",
    );
    return this.sections.setCategory(
      house,
      menuId,
      sectionId,
      userId,
      dto.drinkCategory ?? null,
    );
  }

  @Post(":menuId/sections/:sectionId/confirm")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Confirm a section's lines as drinks or dishes on a draft — owner or manager only; logged",
    description:
      "Lines that agree take the kind; the rest are named for their own tap. Lines that became drinks are resolved against the library.",
  })
  async confirmSection(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Param("menuId", new ParseUUIDPipe()) menuId: string,
    @Param("sectionId", new ParseUUIDPipe()) sectionId: string,
    @Body() dto: ConfirmMenuSectionDto,
  ) {
    const house = await this.manager(
      restaurantId,
      userId,
      "confirm a menu section",
    );
    return this.sections.confirmSection(
      house,
      menuId,
      sectionId,
      userId,
      dto.lineKind,
      dto.drinkCategory ?? null,
    );
  }

  @Post(":menuId/lines/section")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Put lines in a section, or Unsorted, on a draft — owner or manager only; logged",
  })
  async assignLines(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Param("menuId", new ParseUUIDPipe()) menuId: string,
    @Body() dto: AssignMenuLinesDto,
  ) {
    const house = await this.manager(
      restaurantId,
      userId,
      "move lines between menu sections",
    );
    return this.sections.assignLines(
      house,
      menuId,
      userId,
      dto.sectionId ?? null,
      dto.lineIds,
    );
  }

  @Post(":menuId/lines/:lineId/confirm")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Confirm one line as a drink or a dish on a draft — owner or manager only; logged",
  })
  async confirmLine(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Param("menuId", new ParseUUIDPipe()) menuId: string,
    @Param("lineId", new ParseUUIDPipe()) lineId: string,
    @Body() dto: ConfirmMenuLineDto,
  ) {
    const house = await this.manager(
      restaurantId,
      userId,
      "confirm a menu line",
    );
    return this.sections.confirmLine(
      house,
      menuId,
      lineId,
      userId,
      dto.lineKind,
      dto.drinkCategory ?? null,
    );
  }

  @Post(":menuId/lines/:lineId/keep")
  @ApiOperation({
    summary:
      "Keep a Gone line: copy the live menu's line into this draft — owner or manager only; logged",
    description:
      "`menuId` is the draft; `lineId` is a line of the house's live menu of the same kind. 409 when the draft already has it.",
  })
  async keepGoneLine(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Param("menuId", new ParseUUIDPipe()) menuId: string,
    @Param("lineId", new ParseUUIDPipe()) lineId: string,
  ) {
    const house = await this.manager(
      restaurantId,
      userId,
      "keep a line on the menu",
    );
    return this.sections.keepGoneLine(house, menuId, lineId, userId);
  }
}
