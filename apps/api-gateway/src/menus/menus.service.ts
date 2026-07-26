import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { CsvParserService } from "./parsers/csv-parser.service";
import { ScanParserService } from "./parsers/scan-parser.service";
import { ImportMenuDto } from "./dto/import-menu.dto";
import { UpdateOnboardingProgressDto } from "./dto/update-onboarding-progress.dto";
import { WineExtractItem } from "./wine-extract-item.interface";

const FREE_TIER_MANUAL_LIMIT = 25;

@Injectable()
export class MenusService {
  private readonly logger = new Logger(MenusService.name);

  constructor(
    private readonly dbService: DatabaseService,
    private readonly csvParser: CsvParserService,
    private readonly scanParser: ScanParserService,
  ) {}

  async importMenu(
    dto: ImportMenuDto,
    userId: string,
  ): Promise<{
    menuId: string;
    itemsExtracted: number;
    submissionsCreated: number;
  }> {
    const { restaurantId } = dto;

    // 1. Parse input → WineExtractItem[]
    let items: WineExtractItem[];
    if (dto.method === "scan") {
      items = await this.scanParser.parse(dto.data.imageBase64!);
    } else if (dto.method === "csv") {
      items = this.csvParser.parse(dto.data.csvContent!);
    } else {
      items = dto.data.items ?? [];
    }

    // 2. Create or reuse active restaurant_menus row
    const menu = await this.upsertMenu(restaurantId);

    // 3. Bulk insert into menu_items
    if (items.length > 0) {
      const menuItemRows = items.map((item, idx) => ({
        menu_id: menu.id,
        restaurant_id: restaurantId,
        name: item.name,
        category: item.category ?? null,
        vintage: item.vintage ?? null,
        region: item.region ?? null,
        grape_variety: item.grape_variety ?? null,
        by_glass_price: item.by_glass_price ?? null,
        bottle_price: item.bottle_price ?? null,
        raw_extracted_text: item.raw_text ?? null,
        source: dto.method,
        status:
          dto.method === "manual" && idx >= FREE_TIER_MANUAL_LIMIT
            ? "flagged"
            : "approved",
        review_notes:
          dto.method === "manual" && idx >= FREE_TIER_MANUAL_LIMIT
            ? "Free tier: exceeds 25 item limit"
            : null,
      }));

      const { error: menuItemsErr } = await this.dbService.supabase
        .from("menu_items")
        .insert(menuItemRows);

      if (menuItemsErr) {
        this.logger.error(
          `Failed to insert menu_items: ${menuItemsErr.message}`,
        );
        throw new Error(`menu_items insert failed: ${menuItemsErr.message}`);
      }
    }

    // 4. Submit to master_wine_library_submissions (fire-and-forget)
    this.submitToWineLibrary(items, restaurantId, userId, menu.id).catch(
      (err) =>
        this.logger.warn(
          `wine library submission failed (non-fatal): ${err.message}`,
        ),
    );

    // 5. Add to inventory with source='menu_import', quantity=0 (fire-and-forget)
    this.addToInventory(items, restaurantId).catch((err) =>
      this.logger.warn(`inventory seeding failed (non-fatal): ${err.message}`),
    );

    // 6. Mark menu_uploaded in onboarding progress
    await this.markMenuUploaded(userId);

    return {
      menuId: menu.id,
      itemsExtracted: items.length,
      submissionsCreated: items.length,
    };
  }

  private async upsertMenu(restaurantId: string): Promise<{ id: string }> {
    const { data: existing } = await this.dbService.supabase
      .from("restaurant_menus")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .maybeSingle();

    if (existing) return existing;

    const { data: created, error } = await this.dbService.supabase
      .from("restaurant_menus")
      .insert({
        restaurant_id: restaurantId,
        name: "Wine List",
        type: "beverage",
        is_active: true,
      })
      .select("id")
      .single();

    if (error || !created) {
      throw new Error(
        `Failed to create restaurant_menus row: ${error?.message}`,
      );
    }

    return created;
  }

  private async submitToWineLibrary(
    items: WineExtractItem[],
    restaurantId: string,
    userId: string,
    menuId: string,
  ): Promise<void> {
    if (items.length === 0) return;

    const submissions = items.map((item) => ({
      restaurant_id: restaurantId,
      submitted_by: userId,
      source_type: "menu_scan",
      source_ref: menuId,
      status: "pending",
      payload: item,
      normalized_fields: {
        normalized_name: item.name.toLowerCase().trim(),
        vintage: item.vintage ?? null,
        region: item.region ?? null,
        grape_variety: item.grape_variety ?? null,
      },
    }));

    const { error } = await this.dbService.supabase
      .from("master_wine_library_submissions")
      .insert(submissions);

    if (error) throw new Error(error.message);
  }

  private async addToInventory(
    items: WineExtractItem[],
    restaurantId: string,
  ): Promise<void> {
    if (items.length === 0) return;

    const inventoryRows = items.map((item) => ({
      restaurant_id: restaurantId,
      name: item.name,
      category: item.category ?? null,
      vintage: item.vintage ?? null,
      region: item.region ?? null,
      grape_variety: item.grape_variety ?? null,
      source: "menu_import",
      quantity: 0,
    }));

    const { error } = await this.dbService.supabase
      .from("inventory")
      .insert(inventoryRows);
    if (error) throw new Error(error.message);
  }

  private async markMenuUploaded(userId: string): Promise<void> {
    const { error } = await this.dbService.supabase
      .from("user_onboarding_progress")
      .update({ menu_uploaded: true })
      .eq("user_id", userId);

    if (error) {
      this.logger.warn(
        `Failed to mark menu_uploaded for user ${userId}: ${error.message}`,
      );
      return;
    }

    // Check if all tasks done → set completed_at
    const { data: row } = await this.dbService.supabase
      .from("user_onboarding_progress")
      .select("menu_uploaded, vendor_added, team_member_invited, completed_at")
      .eq("user_id", userId)
      .single();

    if (
      row?.menu_uploaded &&
      row?.vendor_added &&
      row?.team_member_invited &&
      !row?.completed_at
    ) {
      const { error: completedErr } = await this.dbService.supabase
        .from("user_onboarding_progress")
        .update({ completed_at: new Date().toISOString() })
        .eq("user_id", userId);

      if (completedErr) {
        this.logger.warn(
          `Failed to set completed_at for user ${userId}: ${completedErr.message}`,
        );
      }
    }
  }

  async getOnboardingProgress(userId: string) {
    const { data, error } = await this.dbService.supabase
      .from("user_onboarding_progress")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;
    if (!data)
      throw new NotFoundException(
        "Onboarding progress not found for this user",
      );
    return data;
  }

  async updateOnboardingProgress(
    userId: string,
    dto: UpdateOnboardingProgressDto,
  ) {
    const updates: Record<string, boolean | string> = {};
    if (dto.menu_uploaded !== undefined)
      updates.menu_uploaded = dto.menu_uploaded;
    if (dto.vendor_added !== undefined) updates.vendor_added = dto.vendor_added;
    if (dto.team_member_invited !== undefined)
      updates.team_member_invited = dto.team_member_invited;
    if (dto.checklist_dismissed !== undefined)
      updates.checklist_dismissed = dto.checklist_dismissed;

    // Auto-set completed_at when all three tasks become true
    const current = await this.getOnboardingProgress(userId);
    const merged = { ...current, ...updates };
    if (
      merged.menu_uploaded &&
      merged.vendor_added &&
      merged.team_member_invited &&
      !current.completed_at
    ) {
      updates.completed_at = new Date().toISOString();
    }

    const { data, error } = await this.dbService.supabase
      .from("user_onboarding_progress")
      .update(updates)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}
