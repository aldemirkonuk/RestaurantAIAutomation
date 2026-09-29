import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Put,
  Param,
  ParseUUIDPipe,
  Body,
  HttpException,
  HttpStatus,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import {
  StorageLocationsService,
  isZoneSetupEdit,
} from "./storage-locations.service";
import {
  CreateStorageLocationDto,
  UpdateStorageLocationDto,
  AssignWineToLocationDto,
  SetZoneSetupAccessDto,
} from "./dto/storage-locations.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";

/** `request.user` as `JwtStrategy.validate` builds it — the one field read here. */
interface TokenUser {
  userId?: string | null;
}

/**
 * Zones and the wines placed in them, for the caller's house (ADR 0147).
 *
 * WHO (ADR 0238, the founder 2026-09-29: "managers/owners+ the people they
 * assign"): creating, changing the setup of, and deleting a zone need an
 * owner's or manager's role here, or their assignment
 * (`PUT :restaurantId/setup-access/:userId`). Placing, removing and counting
 * wines stay open to every member (OD-200).
 */

@ApiTags("storage-locations")
@Controller("storage-locations")
@UseGuards(JwtAuthGuard)
export class StorageLocationsController {
  constructor(
    private readonly storageLocationsService: StorageLocationsService,
  ) {}

  @Get(":restaurantId/mappings")
  @ApiOperation({ summary: "List wine-location mappings for a restaurant" })
  @ApiResponse({ status: 200, description: "Returns mappings" })
  async listMappings(@Param("restaurantId") restaurantId: string) {
    try {
      return await this.storageLocationsService.listMappings(restaurantId);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to fetch mappings",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(":restaurantId/mappings")
  @ApiOperation({ summary: "Assign a wine to a location" })
  @ApiResponse({ status: 201, description: "Mapping created or updated" })
  async assignWineToLocation(
    @Param("restaurantId") restaurantId: string,
    @Body() dto: AssignWineToLocationDto,
  ) {
    try {
      return await this.storageLocationsService.assignWineToLocation(
        restaurantId,
        dto,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to assign wine to location",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(":restaurantId/mappings/:wineId")
  @ApiOperation({ summary: "Remove a wine from its location" })
  @ApiResponse({ status: 200, description: "Mapping removed" })
  async removeWineFromLocation(
    @Param("restaurantId") restaurantId: string,
    @Param("wineId") wineId: string,
  ) {
    try {
      return await this.storageLocationsService.removeWineFromLocation(
        restaurantId,
        wineId,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to remove wine from location",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(":restaurantId/locations/:locationId/wines")
  @ApiOperation({ summary: "List enriched wines at a specific location" })
  @ApiResponse({ status: 200, description: "Returns wines at location" })
  async getWinesAtLocation(
    @Param("restaurantId") restaurantId: string,
    @Param("locationId") locationId: string,
  ) {
    try {
      return await this.storageLocationsService.getWinesAtLocation(
        restaurantId,
        locationId,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to fetch wines at location",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(":restaurantId")
  @ApiOperation({ summary: "List all storage locations for a restaurant" })
  @ApiResponse({ status: 200, description: "Returns locations" })
  async listLocations(@Param("restaurantId") restaurantId: string) {
    try {
      return await this.storageLocationsService.listLocations(restaurantId);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to fetch locations",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Whether the caller may set up zones here, and (for an owner or manager)
   * who is assigned — what the web reads to show or hide the setup controls
   * (ADR 0238). The page's gate is a courtesy; the refusal is the 403 on
   * each write below.
   */
  @Get(":restaurantId/setup-access")
  @ApiOperation({
    summary:
      "Whether the caller may set up this house's zones, and who is assigned (owners and managers only)",
  })
  @ApiResponse({ status: 200, description: "{ mine: { allowed, via }, assigned }" })
  async readSetupAccess(
    @CurrentUser() user: TokenUser,
    @Param("restaurantId") restaurantId: string,
  ) {
    return this.storageLocationsService.readSetupAccess(
      user?.userId,
      restaurantId,
    );
  }

  /**
   * An owner or manager assigns, or withdraws, one staff member's right to
   * set up zones (ADR 0238, the founder 2026-09-29: "managers/owners+ the
   * people they assign"). Audited and told; the person is the path's userId,
   * checked against this house's memberships (another house's is a 404).
   */
  @Put(":restaurantId/setup-access/:userId")
  @ApiOperation({
    summary: "Assign or withdraw one staff member's right to set up zones",
  })
  @ApiResponse({ status: 200, description: "The switch, and whether it was audited and told" })
  @ApiResponse({ status: 403, description: "The caller is not an owner or manager of this house" })
  async setSetupAccess(
    @CurrentUser() user: TokenUser,
    @Param("restaurantId") restaurantId: string,
    @Param("userId", new ParseUUIDPipe()) targetUserId: string,
    @Body() dto: SetZoneSetupAccessDto,
  ) {
    return this.storageLocationsService.setSetupAccess(
      user?.userId,
      restaurantId,
      targetUserId,
      dto.allowed,
    );
  }

  @Post(":restaurantId")
  @ApiOperation({ summary: "Create a storage location" })
  @ApiResponse({ status: 201, description: "Location created" })
  @ApiResponse({ status: 403, description: "The caller may not set up zones (ADR 0238)" })
  async createLocation(
    @CurrentUser() user: TokenUser,
    @Param("restaurantId") restaurantId: string,
    @Body() dto: CreateStorageLocationDto,
  ) {
    try {
      await this.storageLocationsService.assertMaySetUpZones(
        user?.userId,
        restaurantId,
      );
      return await this.storageLocationsService.createLocation(
        restaurantId,
        dto,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to create location",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch(":restaurantId/:locationId")
  @ApiOperation({ summary: "Update a storage location" })
  @ApiResponse({ status: 200, description: "Location updated" })
  @ApiResponse({
    status: 403,
    description:
      "The update changes the zone's setup and the caller may not set up zones (ADR 0238); a count alone is open to every member",
  })
  async updateLocation(
    @CurrentUser() user: TokenUser,
    @Param("restaurantId") restaurantId: string,
    @Param("locationId") locationId: string,
    @Body() dto: UpdateStorageLocationDto,
  ) {
    try {
      // A count alone (`current_count`) stays open to every member (OD-200);
      // any other field is the zone's setup.
      if (isZoneSetupEdit(dto)) {
        await this.storageLocationsService.assertMaySetUpZones(
          user?.userId,
          restaurantId,
        );
      }
      return await this.storageLocationsService.updateLocation(
        restaurantId,
        locationId,
        dto,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to update location",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(":restaurantId/:locationId")
  @ApiOperation({ summary: "Delete a storage location (soft)" })
  @ApiResponse({ status: 200, description: "Location deleted" })
  @ApiResponse({ status: 403, description: "The caller may not set up zones (ADR 0238)" })
  async deleteLocation(
    @CurrentUser() user: TokenUser,
    @Param("restaurantId") restaurantId: string,
    @Param("locationId") locationId: string,
  ) {
    try {
      await this.storageLocationsService.assertMaySetUpZones(
        user?.userId,
        restaurantId,
      );
      return await this.storageLocationsService.deleteLocation(
        restaurantId,
        locationId,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to delete location",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
