import {
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { VendorSendAuthorityService } from "../organizations/vendor-send-authority.service";
import {
  CreateTemplateDto,
  TemplateResponseDto,
  UpdateTemplateDto,
} from "./dto/restaurant-templates.dto";

/** house-letters.service.ts LETTER_TEMPLATE_TYPE, not imported: that file
 *  pulls the composer's whole graph into this module. */
const LETTER_TYPE = "letter";

@Injectable()
export class RestaurantTemplatesService {
  private readonly logger = new Logger(RestaurantTemplatesService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    // Who may touch the house's letter templates (F-1358). @Optional so a
    // spec can build the service without it; without it a letter row is
    // refused, never opened.
    @Optional() private readonly authority?: VendorSendAuthorityService,
  ) {}

  /**
   * The house's vendor letter templates share this table (`type = 'letter'`,
   * house-letters.service.ts LETTER_TEMPLATE_TYPE). They are written by those
   * who may send them: an owner, a manager, or someone an owner lets send
   * (F-1301's rule, ADR 0175 D10). This route stays open to every member for
   * the sign-off name (`sender_identity`, Settings > Email), so the rule is
   * applied per row here rather than with @Roles (F-1358).
   */
  private async maySendLetters(
    userId: string | undefined,
    restaurantId: string,
  ) {
    if (!this.authority || !userId) return { maySend: false, readable: false };
    const standing = await this.authority.readout(userId, restaurantId, {
      canAsk: false,
    });
    return { maySend: standing.maySend, readable: standing.readable };
  }

  private async assertMayWriteLetters(
    userId: string | undefined,
    restaurantId: string,
  ) {
    const standing = await this.maySendLetters(userId, restaurantId);
    if (!standing.maySend) {
      throw new ForbiddenException(
        standing.readable
          ? "Only an owner, a manager or someone allowed to send to vendors can change the house's letter templates. Nothing was changed."
          : "Whether you may change the house's letter templates could not be checked just now, so nothing was changed.",
      );
    }
  }

  private async typeOf(
    restaurantId: string,
    templateId: string,
  ): Promise<string | null> {
    const { data, error } = await this.databaseService.supabase
      .from("communication_templates")
      .select("type")
      .eq("id", templateId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (error) throw error;
    return (data as { type?: string } | null)?.type ?? null;
  }

  async listTemplates(
    restaurantId: string,
    userId?: string,
  ): Promise<TemplateResponseDto[]> {
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

    const rows = (data || []).map((row) => this.mapRow(row));
    if (!rows.some((r) => r.type === LETTER_TYPE)) return rows;
    // A letter's words are kept for those who may send it (F-1358); the row
    // stays listed, its subject and body are left out and it says so.
    if ((await this.maySendLetters(userId, restaurantId)).maySend) return rows;
    return rows.map((r) =>
      r.type === LETTER_TYPE
        ? { ...r, subject: undefined, body: "", bodyWithheld: true }
        : r,
    );
  }

  async createTemplate(
    restaurantId: string,
    dto: CreateTemplateDto,
    userId?: string,
  ): Promise<TemplateResponseDto> {
    if (dto.type === LETTER_TYPE)
      await this.assertMayWriteLetters(userId, restaurantId);
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
    userId?: string,
  ): Promise<TemplateResponseDto> {
    if (
      dto.type === LETTER_TYPE ||
      (await this.typeOf(restaurantId, templateId)) === LETTER_TYPE
    ) {
      await this.assertMayWriteLetters(userId, restaurantId);
    }
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
    userId?: string,
  ): Promise<void> {
    if ((await this.typeOf(restaurantId, templateId)) === LETTER_TYPE) {
      await this.assertMayWriteLetters(userId, restaurantId);
    }
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
