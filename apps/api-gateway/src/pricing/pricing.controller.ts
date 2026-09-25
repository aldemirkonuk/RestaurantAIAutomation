import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { TenantGuard } from "../common/tenant/tenant.guard";
import { OrganizationsService } from "../organizations/organizations.service";
import { TargetMarginService, type TargetMarginReadout } from "./target-margin.service";
import { MarginAdviceService, type HouseAdvice } from "./margin-advice.service";
import { PriceLocksService, type LockActResult, type LockReadout } from "./price-locks.service";
import {
  AcceptPriceAdviceDto,
  ChangeLockedPriceDto,
  ConfirmPourSizeDto,
  ConfirmWinePourDto,
  LockPriceDto,
  MoveLockDto,
  ReleaseLockDto,
  SetTargetMarginDto,
} from "./dto/pricing.dto";

/**
 * A house's target margin, and price advice toward it (ADR 0193).
 *
 * THE FOUNDER, 2026-09-21: "... advise the manager or owner to increase
 * decrease the prices so that the profit margin is where it's needed. We don't
 * want market average because that will be already shown in another column."
 *
 * TENANT SCOPE. Every route takes the restaurant from the signed token
 * (`@CurrentUser("restaurantId")`) and never from the path or the body, so
 * there is no id to tamper with. The two writes also run
 * `assertCanManageRestaurant`: only an owner or a manager may state the
 * house's target or accept a price change -- the founder's own words name
 * "the manager or owner".
 *
 * PRICE LOCKS (ADR 0193 round 3; the founder, 2026-09-21: "add a section to
 * that where you can lock price"). Anyone of the house may READ the locks;
 * setting, changing, moving and releasing one runs the same
 * `assertCanManageRestaurant` gate BEFORE any write (L8), evaluated at the
 * time of the act, and the lock row itself is the audit (L9).
 */
@ApiTags("pricing")
@Controller("pricing")
@UseGuards(JwtAuthGuard, TenantGuard)
export class PricingController {
  constructor(
    private readonly targets: TargetMarginService,
    private readonly advice: MarginAdviceService,
    private readonly organizations: OrganizationsService,
    private readonly locks: PriceLocksService,
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

  @Get("target-margin")
  @ApiOperation({
    summary: "The margin this house needs on a bottle and on a glass, and who stated it",
    description:
      "PERCENT of the selling price (65 = cost is 35 percent of the price). `bottlePct`/`glassPct` null means not set, and price advice then says \"no target set\". `readable: false` means the row could not be read, which is a different state and says so.",
  })
  async getTargetMargin(
    @CurrentUser("restaurantId") restaurantId: string,
  ): Promise<TargetMarginReadout> {
    return this.targets.read(this.requireHouse(restaurantId, "there is no target margin to read"));
  }

  @Put("target-margin")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "State the margin this house needs — owner or manager only",
    description:
      "bottlePct / glassPct are PERCENT between 5 and 95 (null = none for that kind, at least one required); bandPct is 'close enough' as a PERCENT of the advised price, 0 to 20, required. No defaults. Audited; the response carries `audited` / `auditReason`.",
  })
  @ApiResponse({ status: 403, description: "The caller is not an owner or manager of this restaurant." })
  async setTargetMargin(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Body() dto: SetTargetMarginDto,
  ): Promise<TargetMarginReadout> {
    const house = this.requireHouse(restaurantId, "nothing was recorded");
    await this.organizations.assertCanManageRestaurant(
      userId,
      house,
      "state the margin this restaurant needs",
    );
    return this.targets.write(house, dto ?? ({} as SetTargetMarginDto), userId);
  }

  @Put("pour-size")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Confirm the pour this house serves, once — owner or manager only",
    description:
      "Glass price advice waits until this is done (founder, 2026-09-21); bottle advice never reads it. Writes restaurants.default_pour_ml with who and when in one update. Audited as pour_size_confirmed; the response carries `audited` / `auditReason`.",
  })
  @ApiResponse({ status: 403, description: "The caller is not an owner or manager of this restaurant." })
  async confirmPourSize(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Body() dto: ConfirmPourSizeDto,
  ): Promise<TargetMarginReadout> {
    const house = this.requireHouse(restaurantId, "nothing was recorded");
    await this.organizations.assertCanManageRestaurant(
      userId,
      house,
      "confirm this restaurant's pour size",
    );
    return this.targets.confirmPour(house, dto ?? ({} as ConfirmPourSizeDto), userId);
  }

  @Put("wines/:inventoryId/pour")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Confirm ONE wine's own pour — owner or manager only",
    description:
      "Founder, 2026-09-21 (round 6c): \"Yes, confirmed per wine\". Glass advice for this wine uses this pour once confirmed; otherwise the house's confirmed pour. null sends the wine back to the house's pour. Writes pour_size_ml with who and when in one update; a later change of the pour by any other path clears the confirmation. Audited as pour_size_confirmed on the wine.",
  })
  @ApiResponse({ status: 403, description: "The caller is not an owner or manager of this restaurant." })
  async confirmWinePour(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Param("inventoryId", new ParseUUIDPipe()) inventoryId: string,
    @Body() dto: ConfirmWinePourDto,
  ) {
    const house = this.requireHouse(restaurantId, "nothing was recorded");
    await this.organizations.assertCanManageRestaurant(
      userId,
      house,
      "confirm a wine's pour size",
    );
    return this.targets.confirmWinePour(house, inventoryId, dto ?? ({} as ConfirmWinePourDto), userId);
  }

  @Get("locks")
  @ApiOperation({
    summary: "Every open price lock of this house, with what says whether it still makes sense",
    description:
      "ADR 0193 L17/L23. Grouped by whether the wine is on the current menu (a lock whose wine left the menu stays, dormant, and is listed as 'locked, not on the current menu'); removed wines are listed. Each lock carries its age and facts computed now (off target, advice unknown and why, author no longer manages the house, not on the current menu, wine removed, the current menu reads another price). Nothing expires. A failed read answers readable: false with the reason, never an empty list.",
  })
  async getLocks(@CurrentUser("restaurantId") restaurantId: string): Promise<LockReadout> {
    return this.locks.list(this.requireHouse(restaurantId, "there are no locks to read"));
  }

  @Post("locks")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Lock the house's price for one kind of one wine, as it is now — owner or manager only",
    description:
      "ADR 0193 L1/L2. 409 when the kind has no price (nothing to lock) or is already locked. While locked, no menu, correction, edit or accepted advice changes it.",
  })
  @ApiResponse({ status: 403, description: "The caller is not an owner or manager of this restaurant." })
  async lockPrice(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Body() dto: LockPriceDto,
  ): Promise<LockActResult> {
    const house = this.requireHouse(restaurantId, "nothing was locked");
    await this.organizations.assertCanManageRestaurant(userId, house, "lock a price");
    return this.locks.lock(house, dto.inventoryId, dto.kind, userId, dto.note ?? null);
  }

  @Post("locks/:lockId/release")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Release a price lock — owner or manager only; the price does not change",
    description: "ADR 0193 L16/L24. Only a person ends a lock. The answer says when the current menu reads another price.",
  })
  @ApiResponse({ status: 403, description: "The caller is not an owner or manager of this restaurant." })
  async releaseLock(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Param("lockId", new ParseUUIDPipe()) lockId: string,
    @Body() dto: ReleaseLockDto,
  ): Promise<LockActResult> {
    const house = this.requireHouse(restaurantId, "nothing was released");
    await this.organizations.assertCanManageRestaurant(userId, house, "release a price lock");
    return this.locks.release(house, lockId, userId, dto?.note ?? null);
  }

  @Post("locks/:lockId/change")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Change a locked price and keep it locked, one act — owner or manager only",
    description:
      "ADR 0193 L6. Names the open lock the page showed; 409 (nothing changed) when another lock is open now. Writes the new price as a manual change by the person and opens a new lock that takes over from the old.",
  })
  @ApiResponse({ status: 403, description: "The caller is not an owner or manager of this restaurant." })
  async changeLockedPrice(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Param("lockId", new ParseUUIDPipe()) lockId: string,
    @Body() dto: ChangeLockedPriceDto,
  ): Promise<LockActResult> {
    const house = this.requireHouse(restaurantId, "nothing was changed");
    await this.organizations.assertCanManageRestaurant(userId, house, "change a locked price");
    return this.locks.changeAndKeep(house, lockId, dto?.price, userId, dto?.note ?? null);
  }

  @Post("locks/:lockId/move")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Move a lock to another wine of this house at a price you name — owner or manager only",
    description:
      "ADR 0193 L20: a renamed or re-vintaged wine is a different wine, so a lock follows it only when a person links it. The price is required (400 without it). One act: the old lock is released, the target's price is written as a manual change by the person, and the target is locked.",
  })
  @ApiResponse({ status: 403, description: "The caller is not an owner or manager of this restaurant." })
  async moveLock(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Param("lockId", new ParseUUIDPipe()) lockId: string,
    @Body() dto: MoveLockDto,
  ): Promise<LockActResult> {
    const house = this.requireHouse(restaurantId, "nothing was changed");
    await this.organizations.assertCanManageRestaurant(userId, house, "move a price lock");
    return this.locks.move(house, lockId, dto?.targetInventoryId, dto?.price, userId, dto?.note ?? null);
  }

  @Get("advice")
  @ApiOperation({
    summary: "Per-wine advice toward the house's target margin: raise to X, lower to Y, on target, or why not",
    description:
      "For every active wine and for each of bottle and glass: the house's price, the recorded cost (invoiced lot WAC, then last purchase price, else unknown), the margin, and the advised price = cost / (1 - target). Never uses the market average. Nothing is changed by this read. A failed read is a 500, never an empty list.",
  })
  async getAdvice(@CurrentUser("restaurantId") restaurantId: string): Promise<HouseAdvice> {
    return this.advice.adviseHouse(this.requireHouse(restaurantId, "there is no advice to read"));
  }

  @Post("advice/:inventoryId/accept")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Accept one wine's price advice — one tap, owner or manager only",
    description:
      "The advice is re-computed here; if it is no longer the price the page showed, 409 and nothing changes. On accept: one pricing_analyses row (the why) and the price written through set_house_menu_price with change_source 'agent_accepted' and changed_by from the token.",
  })
  @ApiResponse({ status: 409, description: "No advice stands for this wine now, or it changed since it was shown." })
  async acceptAdvice(
    @CurrentUser("restaurantId") restaurantId: string,
    @CurrentUser("userId") userId: string,
    @Param("inventoryId", new ParseUUIDPipe()) inventoryId: string,
    @Body() dto: AcceptPriceAdviceDto,
  ) {
    const house = this.requireHouse(restaurantId, "nothing was changed");
    await this.organizations.assertCanManageRestaurant(
      userId,
      house,
      "change a wine's price",
    );
    return this.advice.accept(house, inventoryId, dto.kind, dto.advisedPrice, userId);
  }
}
