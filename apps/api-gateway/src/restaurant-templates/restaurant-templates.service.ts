import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  CreateTemplateDto,
  TemplateResponseDto,
  UpdateTemplateDto,
} from "./dto/restaurant-templates.dto";

/**
 * The order letter's purpose key (ADR 0313; `ORDER_REQUEST_TEMPLATE_KEY` in
 * communications/letters/order-request-letter.ts). Kept as a literal so this
 * legacy module does not import the letters module.
 */
export const ORDER_LETTER_CATEGORY = "order_request";

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
    await this.refuseTheOrderLetter(restaurantId, templateId, "changed");
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
    await this.refuseTheOrderLetter(restaurantId, templateId, "removed");
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

  /**
   * The house's order letter is never written here (ADR 0313, 4a-ii). This
   * route is open to every member and carries no prose rules, versions or
   * publish: an edit here would overwrite the owner's draft, and a `type`
   * change would hide the letter from the renderer, so vendors would quietly
   * get Mudavym's default. Its own panel (communications/letters
   * templates/order-request, owner or manager) is the one way in. The row is
   * read first and its STORED purpose decides; the request body is not
   * trusted. A failed read refuses rather than guessing.
   */
  private async refuseTheOrderLetter(
    restaurantId: string,
    templateId: string,
    verb: "changed" | "removed",
  ): Promise<void> {
    const { data, error } = await this.databaseService.supabase
      .from("communication_templates")
      .select("id, category")
      .eq("id", templateId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (error) {
      throw new ServiceUnavailableException(
        `The template could not be read (${error.message}), so it was not ${verb}. Nothing was saved.`,
      );
    }
    if (!data) {
      throw new NotFoundException("This house has no such template. Nothing was saved.");
    }
    if ((data as Record<string, unknown>).category === ORDER_LETTER_CATEGORY) {
      throw new ForbiddenException(
        `The house's order letter is not ${verb} here. An owner or a manager changes it in Communications, Templates, The order letter. Nothing was saved.`,
      );
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
