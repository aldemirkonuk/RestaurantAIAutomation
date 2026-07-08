import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserPreferencesService } from "./user-preferences.service";
import {
  UpdatePreferencesDto,
  UserPreferencesResponseDto,
} from "./dto/user-preferences.dto";

@ApiTags("user-preferences")
@Controller("users")
@UseGuards(JwtAuthGuard)
export class UserPreferencesController {
  constructor(private readonly preferencesService: UserPreferencesService) {}

  @Get(":userId/preferences")
  @ApiOperation({ summary: "Get user preferences" })
  @ApiResponse({ status: 200, type: UserPreferencesResponseDto })
  async getPreferences(
    @Param("userId") userId: string,
  ): Promise<UserPreferencesResponseDto> {
    try {
      return await this.preferencesService.getPreferences(userId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch user preferences",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch(":userId/preferences")
  @ApiOperation({ summary: "Update user preferences (deep merge)" })
  @ApiResponse({ status: 200, type: UserPreferencesResponseDto })
  async updatePreferences(
    @Param("userId") userId: string,
    @Body() dto: UpdatePreferencesDto,
  ): Promise<UserPreferencesResponseDto> {
    try {
      return await this.preferencesService.updatePreferences(
        userId,
        dto.preferences,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to update user preferences",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
