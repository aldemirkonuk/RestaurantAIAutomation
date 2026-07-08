import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  CreateTemplateDto,
  TemplateResponseDto,
  UpdateTemplateDto,
} from "./dto/restaurant-templates.dto";

@Injectable()
export class RestaurantTemplatesService {
  private readonly logger = new Logger(RestaurantTemplatesService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async listTemplates(restaurantId: string): Promise<TemplateResponseDto[]> {
    const { data, error } = await this.databaseService.supabase
      .from("communication_templates")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) {
      this.logger.error("Failed to list templates", {
        restaurantId,
        error: error.message,
      });
      throw error;
    }

    return (data || []).map((row) => this.mapRow(row));
  }

  async createTemplate(
    restaurantId: string,
    dto: CreateTemplateDto,
  ): Promise<TemplateResponseDto> {
    const { data, error } = await this.databaseService.supabase
      .from("communication_templates")
      .insert({
        restaurant_id: restaurantId,
        name: dto.name,
        subject: dto.subject ?? null,
        body: dto.body,
        type: dto.type,
      })
      .select("*")
      .single();

    if (error) {
      this.logger.error("Failed to create template", {
        restaurantId,
        error: error.message,
      });
      throw error;
    }

    return this.mapRow(data);
  }

  async updateTemplate(
    restaurantId: string,
    templateId: string,
    dto: UpdateTemplateDto,
  ): Promise<TemplateResponseDto> {
    const updatePayload: Record<string, any> = {};
    if (dto.name !== undefined) updatePayload.name = dto.name;
    if (dto.subject !== undefined) updatePayload.subject = dto.subject;
    if (dto.body !== undefined) updatePayload.body = dto.body;
    if (dto.type !== undefined) updatePayload.type = dto.type;

    const { data, error } = await this.databaseService.supabase
      .from("communication_templates")
      .update(updatePayload)
      .eq("id", templateId)
      .eq("restaurant_id", restaurantId)
      .select("*")
      .single();

    if (error) {
      this.logger.error("Failed to update template", {
        templateId,
        error: error.message,
      });
      throw error;
    }

    return this.mapRow(data);
  }

  async deleteTemplate(
    restaurantId: string,
    templateId: string,
  ): Promise<void> {
    const { error } = await this.databaseService.supabase
      .from("communication_templates")
      .update({ is_active: false })
      .eq("id", templateId)
      .eq("restaurant_id", restaurantId);

    if (error) {
      this.logger.error("Failed to delete template", {
        templateId,
        error: error.message,
      });
      throw error;
    }
  }

  private mapRow(row: Record<string, any>): TemplateResponseDto {
    return {
      id: row.id,
      restaurantId: row.restaurant_id,
      name: row.name,
      subject: row.subject ?? undefined,
      body: row.body,
      type: row.type,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
