import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  HttpException,
  HttpStatus,
  ForbiddenException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { ProspectsService } from "./prospects.service";

/**
 * Manager surface for the D1 Prospects lane: list captured cold-email outreach, add a prospect
 * as a real vendor (one tap), dismiss it, or undo a dismiss. Never sends anything.
 *
 * Adding a prospect as a vendor is owner or manager only (see `promote`). Listing, dismissing
 * and restoring stay open to any member of the house.
 *
 * The `/triage` endpoint is operator-only (unattributed cold email that could belong to any
 * tenant) and is gated by the PLATFORM_ADMIN_USER_IDS allowlist — never a tenant role, since
 * these rows are not attributable to a restaurant.
 */
@Controller("prospects")
@UseGuards(JwtAuthGuard)
export class ProspectsController {
  constructor(
    private readonly prospects: ProspectsService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: { userId: string; restaurantId: string },
    @Query("scope") scope?: string,
  ): Promise<any[]> {
    try {
      // Phase 5 — multi-location view. `?scope=all` returns open prospects across every restaurant
      // the caller is a member of (each row carries restaurant_id for chip filtering/labelling).
      // Default stays scoped to the active restaurant.
      if (scope === "all") {
        const ids = await this.prospects.accessibleRestaurantIds(
          user.userId,
          user.restaurantId,
        );
        return await this.prospects.listAcross(ids);
      }
      return await this.prospects.list(user.restaurantId);
    } catch (error: any) {
      throw new HttpException(
        error.message || "Failed to load prospects",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("triage")
  async triage(
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<any[]> {
    this.assertPlatformAdmin(user.userId);
    try {
      return await this.prospects.listUnattributed();
    } catch (error: any) {
      throw new HttpException(
        error.message || "Failed to load triage",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(":id/attachments")
  async attachments(
    @Param("id") id: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<any[]> {
    try {
      return await this.prospects.attachmentsFor(user.restaurantId, id);
    } catch (error: any) {
      throw new HttpException(
        error.message || "Failed to load attachments",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Inserts a `providers` row, i.e. creates a vendor for the house, so it is owner or manager only
   * (ADR 0124 treats a vendor relationship as owner/manager; ADR 0146 set owner-or-manager for a
   * write made on the house's behalf). RolesGuard sits on the handler, so Nest runs it after the
   * class-level JwtAuthGuard that sets the request.user.role it reads.
   */
  @Post(":id/promote")
  @UseGuards(RolesGuard)
  @Roles("owner", "manager")
  async promote(
    @Param("id") id: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ promoted: boolean; providerId?: string; reused?: boolean }> {
    try {
      return await this.prospects.promote(user.restaurantId, id);
    } catch (error: any) {
      // A 503 from an unreadable check stays a 503; only an unexpected throw becomes a 500.
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to add prospect as vendor",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(":id/dismiss")
  async dismiss(
    @Param("id") id: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ dismissed: boolean }> {
    try {
      return await this.prospects.dismiss(user.restaurantId, id);
    } catch (error: any) {
      throw new HttpException(
        error.message || "Failed to dismiss prospect",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(":id/restore")
  async restore(
    @Param("id") id: string,
    @CurrentUser() user: { userId: string; restaurantId: string },
  ): Promise<{ restored: boolean }> {
    try {
      return await this.prospects.restore(user.restaurantId, id);
    } catch (error: any) {
      throw new HttpException(
        error.message || "Failed to restore prospect",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private assertPlatformAdmin(userId: string): void {
    const allow = (
      this.configService.get<string>("PLATFORM_ADMIN_USER_IDS") || ""
    )
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!allow.length || !allow.includes(userId)) {
      throw new ForbiddenException("Operator access required");
    }
  }
}
