import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RestaurantTemplatesService } from "./restaurant-templates.service";
import {
  CreateTemplateDto,
  TemplateResponseDto,
  UpdateTemplateDto,
} from "./dto/restaurant-templates.dto";

@ApiTags("restaurant-templates")
@Controller("restaurants")
@UseGuards(JwtAuthGuard)
export class RestaurantTemplatesController {
  constructor(private readonly templatesService: RestaurantTemplatesService) {}

  @Get(":restaurantId/templates")
  @ApiOperation({ summary: "List communication templates" })
  @ApiResponse({ status: 200, type: [TemplateResponseDto] })
  async listTemplates(
    @Param("restaurantId") restaurantId: string,
    @CurrentUser() user: { userId?: string },
  ): Promise<TemplateResponseDto[]> {
    try {
      return await this.templatesService.listTemplates(
        restaurantId,
        user?.userId,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to list templates",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(":restaurantId/templates")
  @ApiOperation({ summary: "Create a communication template" })
  @ApiResponse({ status: 201, type: TemplateResponseDto })
  async createTemplate(
    @Param("restaurantId") restaurantId: string,
    @Body() dto: CreateTemplateDto,
    @CurrentUser() user: { userId?: string },
  ): Promise<TemplateResponseDto> {
    try {
      return await this.templatesService.createTemplate(
        restaurantId,
        dto,
        user?.userId,
      );
    } catch (error) {
      // A refusal (a letter template, F-1358) reaches the caller as itself.
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to create template",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch(":restaurantId/templates/:templateId")
  @ApiOperation({ summary: "Update a communication template" })
  @ApiResponse({ status: 200, type: TemplateResponseDto })
  async updateTemplate(
    @Param("restaurantId") restaurantId: string,
    @Param("templateId") templateId: string,
    @Body() dto: UpdateTemplateDto,
    @CurrentUser() user: { userId?: string },
  ): Promise<TemplateResponseDto> {
    try {
      return await this.templatesService.updateTemplate(
        restaurantId,
        templateId,
        dto,
        user?.userId,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to update template",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(":restaurantId/templates/:templateId")
  @ApiOperation({ summary: "Delete a communication template" })
  @ApiResponse({ status: 200, description: "Template deleted" })
  async deleteTemplate(
    @Param("restaurantId") restaurantId: string,
    @Param("templateId") templateId: string,
    @CurrentUser() user: { userId?: string },
  ): Promise<{ success: boolean }> {
    try {
      await this.templatesService.deleteTemplate(
        restaurantId,
        templateId,
        user?.userId,
      );
      return { success: true };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error.message || "Failed to delete template",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
