import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  HttpException,
  HttpStatus,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { StorageLocationsService } from "./storage-locations.service";
import {
  CreateStorageLocationDto,
  UpdateStorageLocationDto,
  AssignWineToLocationDto,
} from "./dto/storage-locations.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

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

  @Post(":restaurantId")
  @ApiOperation({ summary: "Create a storage location" })
  @ApiResponse({ status: 201, description: "Location created" })
  async createLocation(
    @Param("restaurantId") restaurantId: string,
    @Body() dto: CreateStorageLocationDto,
  ) {
    try {
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
  async updateLocation(
    @Param("restaurantId") restaurantId: string,
    @Param("locationId") locationId: string,
    @Body() dto: UpdateStorageLocationDto,
  ) {
    try {
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
  async deleteLocation(
    @Param("restaurantId") restaurantId: string,
    @Param("locationId") locationId: string,
  ) {
    try {
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
