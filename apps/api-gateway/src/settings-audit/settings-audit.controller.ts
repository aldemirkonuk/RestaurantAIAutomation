import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { TenantGuard } from "../common/tenant/tenant.guard";
import {
  SettingsAuditService,
  type SettingsAuditReadout,
  type SettingsRegister,
} from "./settings-audit.service";

const REGISTERS: SettingsRegister[] = [
  "features",
  "vendor-terms",
  "thresholds",
  "notifications",
  "preferences",
];

/**
 * Reading the settings trail back.
 *
 * TENANT SCOPE. The restaurant is taken from the signed token via
 * `@CurrentUser("restaurantId")` and never from a query parameter, so there is
 * no id to tamper with — a caller cannot read another house's trail by naming
 * it. `TenantGuard` plus the assertion inside `JwtAuthGuard`
 * (`common/tenant/assert-tenant-match.ts`) run before this controller's first
 * line, exactly as they do for `/settings`.
 *
 * READ ONLY, ON PURPOSE. There is no write route and no delete route. A log a
 * manager can edit is not a log, and the whole value of this register is that
 * the person who changed a setting cannot also change the record of it.
 */
@ApiTags("settings")
@ApiBearerAuth("JWT-auth")
@Controller("settings-audit")
@UseGuards(JwtAuthGuard, TenantGuard)
export class SettingsAuditController {
  constructor(private readonly audit: SettingsAuditService) {}

  @Get()
  @ApiOperation({
    summary: "Who changed a setting on this restaurant, and what it was before",
    description:
      "Reads system_audit_log for this restaurant, filtered to the settings actions plus the two team-access actions. Returns `readable: false` with a reason when the log itself could not be read — an unreadable log is never rendered as an empty one.",
  })
  @ApiResponse({ status: 200, description: "The trail, newest first" })
  async list(
    @CurrentUser("restaurantId") restaurantId: string,
    @Query("limit") limit?: string,
    @Query("register") register?: string,
  ): Promise<SettingsAuditReadout> {
    if (!restaurantId) {
      throw new HttpException(
        "This session is not attached to a restaurant, so there is no trail to read.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const parsed = limit === undefined ? 50 : Number(limit);
    if (!Number.isFinite(parsed)) {
      throw new HttpException(
        `limit must be a number; got "${limit}".`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const filter = REGISTERS.find((r) => r === register);
    if (register !== undefined && !filter) {
      throw new HttpException(
        `register must be one of ${REGISTERS.join(", ")}; got "${register}".`,
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      return await this.audit.list(restaurantId, parsed, filter);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error ? error.message : "Failed to read the settings trail",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
