import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CellarRegistersService } from "./cellar-registers.service";
import { CellarSettingsService } from "./cellar-settings.service";
import { ZonesService } from "./zones.service";
import {
  ConfirmZoneDto,
  SetCellarRegistersDto,
} from "./dto/cellar-registers.dto";
import { SetCellarSettingsDto } from "./dto/cellar-settings.dto";

/**
 * Which registers this house carries.
 *
 * TENANT SCOPE. Both routes name the restaurant in the path, which is what
 * `assertTenantMatch` compares against the JWT inside `JwtAuthGuard`
 * (`common/tenant/assert-tenant-match.ts`) — so a caller cannot read or write
 * another house's answer, and a tenantless session cannot acquire one by
 * naming it. That check runs before this controller's first line.
 */
@ApiTags("cellar")
@Controller("cellar")
@UseGuards(JwtAuthGuard)
export class CellarController {
  constructor(
    private readonly registers: CellarRegistersService,
    private readonly zones: ZonesService,
    private readonly settings: CellarSettingsService,
  ) {}

  @Get(":restaurantId/registers")
  @ApiOperation({
    summary:
      "Which cellar registers this house carries, and how each was decided",
  })
  @ApiResponse({ status: 200, description: "Register readout with sources" })
  async read(@Param("restaurantId") restaurantId: string) {
    try {
      return await this.registers.read(restaurantId);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error
          ? error.message
          : "Failed to read the cellar registers",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /* ── the floor: zones, and whether anybody has ever looked at them ───── */

  @Get(":restaurantId/zones")
  @ApiOperation({
    summary:
      "This house's storage zones, split by whether a human has confirmed the name",
  })
  @ApiResponse({
    status: 200,
    description:
      "Confirmed zones (the floor draws these) and unconfirmed ones (counted, never drawn)",
  })
  async readZones(@Param("restaurantId") restaurantId: string) {
    try {
      return await this.zones.read(restaurantId);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error ? error.message : "Failed to read the zones",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put(":restaurantId/zones/:zoneId")
  @ApiOperation({
    summary: "Confirm a zone's name, or rename it. The actor comes from the JWT",
  })
  @ApiResponse({ status: 200, description: "The zone as it was written" })
  async confirmZone(
    @Param("restaurantId") restaurantId: string,
    @Param("zoneId", new ParseUUIDPipe()) zoneId: string,
    @Body() dto: ConfirmZoneDto,
    @Req() req: { user?: { userId?: string } },
  ) {
    try {
      return await this.zones.confirm(
        restaurantId,
        zoneId,
        dto.name ?? null,
        req.user?.userId ?? null,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const message =
        error instanceof Error ? error.message : "The zone was not written";
      throw new HttpException(
        message,
        /no zone of this house/i.test(message)
          ? HttpStatus.NOT_FOUND
          : HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put(":restaurantId/registers")
  @ApiOperation({ summary: "Record the house's own answer about its registers" })
  @ApiResponse({ status: 200, description: "The readout after the write" })
  async write(
    @Param("restaurantId") restaurantId: string,
    @Body() dto: SetCellarRegistersDto,
    @Req() req: { user?: { userId?: string } },
  ) {
    try {
      // The actor is taken from the JWT, never from the body — the body cannot
      // name who decided this any more than it can name which restaurant.
      return await this.registers.write(
        restaurantId,
        dto,
        req.user?.userId ?? null,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error
          ? error.message
          : "Failed to record the cellar registers",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /* ── two per-house choices: the hold ceremony and the tiles it shows
     (ADR 0160 sec110, items 2 and 6) ───────────────────────────────────── */

  @Get(":restaurantId/settings")
  @ApiOperation({
    summary:
      "This house's cellar settings — the order-hold ceremony and which overview tiles it configured",
  })
  @ApiResponse({ status: 200, description: "Settings readout, defaulted where unconfigured" })
  async readSettings(@Param("restaurantId") restaurantId: string) {
    return this.settings.read(restaurantId);
  }

  @Put(":restaurantId/settings")
  @ApiOperation({
    summary: "Record one or both of the house's cellar settings. The actor comes from the JWT",
  })
  @ApiResponse({ status: 200, description: "The readout after the write" })
  async writeSettings(
    @Param("restaurantId") restaurantId: string,
    @Body() dto: SetCellarSettingsDto,
    @Req() req: { user?: { userId?: string; role?: string } },
  ) {
    try {
      return await this.settings.write(
        restaurantId,
        dto,
        req.user?.userId ?? null,
        req.user?.role ?? null,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = (error as { code?: string } | undefined)?.code;
      throw new HttpException(
        error instanceof Error ? error.message : "Failed to record the cellar settings",
        code === "CELLAR_HOLD_CEREMONY_FORBIDDEN"
          ? HttpStatus.FORBIDDEN
          : HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
