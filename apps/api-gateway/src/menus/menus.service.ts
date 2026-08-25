import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { CsvParserService } from "./parsers/csv-parser.service";
import { ScanParserService } from "./parsers/scan-parser.service";
import { WineSubmissionsService } from "../wines/wine-submissions.service";
import { ImportMenuDto } from "./dto/import-menu.dto";
import { AddMenuItemDto } from "./dto/add-menu-item.dto";
import { ReviewMenuItemDto } from "./dto/review-menu-item.dto";
import { UpdateOnboardingProgressDto } from "./dto/update-onboarding-progress.dto";
import { WineExtractItem } from "./wine-extract-item.interface";

const FREE_TIER_MANUAL_LIMIT = 25;
const DEFAULT_THRESHOLD_MIN_FALLBACK = 3;
const PRICE_FIELDS = new Set(["by_glass_price", "bottle_price"]);

interface ResolvedItem {
  item: WineExtractItem;
  masterWineId: string | null;
  matched: boolean;
  libraryTier: number | null;
  /** Best library-match score, 0-100. See LibraryResolutionResult. */
  confidence: number | null;
}

interface InsertedMenuItem {
  id: string;
  wine_library_id: string | null;
  name: string;
}

export interface MenuImportReviewItem {
  menuItemId: string;
  submissionId: string | null;
  name: string;
  producer: string | null;
  category: string | null;
  vintage: string | null;
  region: string | null;
  grapeVariety: string | null;
  byGlassPrice: number | null;
  bottlePrice: number | null;
  matched: boolean;
  needsReview: boolean;
}

@Injectable()
export class MenusService {
  private readonly logger = new Logger(MenusService.name);

  constructor(
    private readonly dbService: DatabaseService,
    private readonly csvParser: CsvParserService,
    private readonly scanParser: ScanParserService,
    private readonly wineSubmissions: WineSubmissionsService,
  ) {}

  async importMenu(
    dto: ImportMenuDto,
    userId: string,
  ): Promise<{
    menuId: string;
    itemsExtracted: number;
    submissionsCreated: number;
    items: MenuImportReviewItem[];
  }> {
    const { restaurantId } = dto;

    // 1. Parse input → WineExtractItem[]
    let items: WineExtractItem[];
    if (dto.method === "scan") {
      items = await this.scanParser.parse(dto.data.imageBase64!, restaurantId);
    } else if (dto.method === "csv") {
      items = dto.data.fileBase64
        ? await this.csvParser.parseExcel(dto.data.fileBase64)
        : this.csvParser.parse(dto.data.csvContent!);
    } else {
      items = dto.data.items ?? [];
    }

    // 2. Create or reuse the restaurant's active menu
    const menu = await this.upsertMenu(restaurantId);

    // 3-6: resolve against the wine library, insert menu_items, seed
    // inventory, and create the governance submission trail.
    const reviewItems = await this.resolveAndPersistItems(
      items,
      restaurantId,
      menu.id,
      userId,
      dto.method,
    );

    // 7. Mark menu_uploaded for everyone on this restaurant (matches the
    // restaurant-scoped pattern used by vendor_added / team_member_invited).
    await this.markMenuUploaded(restaurantId);

    return {
      menuId: menu.id,
      itemsExtracted: items.length,
      submissionsCreated: reviewItems.filter((r) => r.submissionId).length,
      items: reviewItems,
    };
  }

  /** Adds one manager-entered wine to an existing menu during the review step. */
  async addMenuItem(
    dto: AddMenuItemDto,
    userId: string,
  ): Promise<MenuImportReviewItem> {
    const { data: menu, error: menuErr } = await this.dbService.supabase
      .from("restaurant_menus")
      .select("id, restaurant_id")
      .eq("id", dto.menuId)
      .maybeSingle();

    if (menuErr || !menu) {
      throw new NotFoundException("Menu not found");
    }

    const item: WineExtractItem = {
      name: dto.name,
      producer: dto.producer,
      category: dto.category,
      vintage: dto.vintage,
      region: dto.region,
      grape_variety: dto.grape_variety,
      by_glass_price: dto.by_glass_price,
      bottle_price: dto.bottle_price,
    };

    const [reviewItem] = await this.resolveAndPersistItems(
      [item],
      menu.restaurant_id,
      menu.id,
      userId,
      "manual",
    );

    // Manager-added rows are always flagged for review, regardless of match.
    await this.dbService.supabase
      .from("menu_items")
      .update({
        status: "flagged",
        review_notes: "Manually added during review",
      })
      .eq("id", reviewItem.menuItemId);

    if (reviewItem.submissionId) {
      await this.dbService.supabase.from("override_events").insert({
        submission_id: reviewItem.submissionId,
        actor_id: userId,
        field_name: "name",
        old_value: null,
        new_value: dto.name,
        reason: "Manually added during import review",
        promotion_status: "pending",
      });
    }

    return { ...reviewItem, needsReview: true };
  }

  /**
   * Applies a manager's inline correction to one menu_items field.
   *
   * The edit takes effect immediately for this restaurant's own inventory
   * (managers are trusted for their own data) and is logged as an
   * override_events row against the item's submission for global governance
   * review — it does NOT mutate the shared master_wine_library row, since
   * other restaurants may be matched to the same provisional wine.
   */
  async reviewMenuItem(
    menuItemId: string,
    userId: string,
    dto: ReviewMenuItemDto,
  ): Promise<{ menuItemId: string; fieldName: string; newValue: string }> {
    const { data: menuItem, error } = await this.dbService.supabase
      .from("menu_items")
      .select("*")
      .eq("id", menuItemId)
      .maybeSingle();

    if (error || !menuItem) {
      throw new NotFoundException("Menu item not found");
    }

    const oldValue = (menuItem as Record<string, unknown>)[dto.fieldName];
    const isPrice = PRICE_FIELDS.has(dto.fieldName);
    const newValueTyped: string | number = isPrice
      ? parseFloat(dto.newValue.replace(/[^0-9.]/g, ""))
      : dto.newValue;

    if (isPrice && Number.isNaN(newValueTyped as number)) {
      throw new BadRequestException(
        `Invalid numeric value for ${dto.fieldName}`,
      );
    }

    const { error: updateErr } = await this.dbService.supabase
      .from("menu_items")
      .update({
        [dto.fieldName]: newValueTyped,
        status: "flagged",
        review_notes: `Manager corrected ${dto.fieldName}`,
      })
      .eq("id", menuItemId);

    if (updateErr) {
      throw new Error(`Failed to update menu_item: ${updateErr.message}`);
    }

    // Keep the restaurant's own inventory display name in sync.
    if (dto.fieldName === "name" && menuItem.inventory_item_id) {
      await this.dbService.supabase
        .from("restaurant_inventory")
        .update({ wine_name: dto.newValue })
        .eq("id", menuItem.inventory_item_id);
    }

    if (menuItem.submission_id) {
      const { error: overrideErr } = await this.dbService.supabase
        .from("override_events")
        .insert({
          submission_id: menuItem.submission_id,
          actor_id: userId,
          field_name: dto.fieldName,
          old_value:
            oldValue !== null && oldValue !== undefined
              ? String(oldValue)
              : null,
          new_value: String(newValueTyped),
          reason: "Manager correction during menu import review",
          promotion_status: "pending",
        });

      if (overrideErr) {
        this.logger.warn(
          `Failed to log override_event for menu_item ${menuItemId} (non-fatal): ${overrideErr.message}`,
        );
      }
    }

    return { menuItemId, fieldName: dto.fieldName, newValue: dto.newValue };
  }

  /**
   * Read path for the interactive menu (decision 39 — the menus module had
   * no GET at all, which is why no menu page could exist). Returns the
   * restaurant's active menu with its items, newest first within category.
   */
  async getMenu(restaurantId: string): Promise<{
    menuId: string | null;
    name: string | null;
    status: string | null;
    items: Array<Record<string, unknown>>;
  }> {
    const { data: menu, error: menuErr } = await this.dbService.supabase
      .from("restaurant_menus")
      .select("id, name, status")
      .eq("restaurant_id", restaurantId)
      .eq("status", "active")
      .maybeSingle();

    if (menuErr) throw new Error(`Failed to load menu: ${menuErr.message}`);
    if (!menu) return { menuId: null, name: null, status: null, items: [] };

    const { data: items, error: itemsErr } = await this.dbService.supabase
      .from("menu_items")
      .select(
        "id, name, producer, category, vintage, region, country, grape_variety, by_glass_price, bottle_price, wine_library_id, inventory_item_id, source, status, created_at",
      )
      .eq("menu_id", menu.id)
      .order("category", { ascending: true })
      .order("name", { ascending: true });

    if (itemsErr)
      throw new Error(`Failed to load menu items: ${itemsErr.message}`);

    return {
      menuId: menu.id,
      name: menu.name,
      status: menu.status,
      items: items ?? [],
    };
  }

  // ── Shared pipeline: resolve against the library, insert, seed inventory ──

  private async resolveAndPersistItems(
    items: WineExtractItem[],
    restaurantId: string,
    menuId: string,
    userId: string,
    method: "scan" | "csv" | "manual",
  ): Promise<MenuImportReviewItem[]> {
    if (items.length === 0) return [];

    // Resolve every item against master_wine_library BEFORE inserting
    // menu_items — wine_library_id and restaurant_inventory.master_wine_id
    // are both FK targets and must point at a real row, not be populated
    // asynchronously after the fact.
    //
    // One batched call, not one per wine. This used to be a bounded-concurrency
    // loop of individual lookups; against the pooler each round trip is
    // ~320-380ms and almost none of that is query time. Measured on a real
    // 182-wine extraction scaled to RL Restaurant's 485 wines, batching took
    // 183.12s down to 0.91s.
    //
    // A whole-batch failure is fatal here on purpose. Per-wine failures were
    // caught as non-fatal and turned into masterWineId: null, which is how an
    // import could report success while linking nothing; if the single call
    // covering every wine fails, the import genuinely cannot proceed and should
    // say so rather than write a menu of unlinked items.
    let resolved: ResolvedItem[];
    try {
      const results = await this.wineSubmissions.resolveLibraryWinesBatch(
        items.map((item) => ({
          name: item.name,
          producer: item.producer,
          vintage: item.vintage,
          region: item.region,
          grapeVariety: item.grape_variety,
        })),
      );
      resolved = items.map((item, idx) => ({
        item,
        masterWineId: results[idx]?.masterWineId ?? null,
        matched: results[idx]?.matched ?? false,
        libraryTier: results[idx]?.libraryTier ?? null,
        confidence: results[idx]?.confidence ?? null,
      }));
    } catch (err) {
      this.logger.error(`Library resolution failed for menu: ${err.message}`);
      throw new Error(`Menu import failed during library resolution: ${err.message}`);
    }

    // Unlinked items are the ones a manager has to fix by hand, so say how
    // many there are rather than leaving it to be discovered in the UI.
    const unlinked = resolved.filter((r) => !r.masterWineId).length;
    if (unlinked > 0) {
      this.logger.error(
        `Menu import: ${unlinked}/${resolved.length} item(s) could not be ` +
          `linked to the wine library and will have no inventory row`,
      );
    }

    const menuItemRows = resolved.map(({ item, masterWineId }, idx) => ({
      menu_id: menuId,
      restaurant_id: restaurantId,
      name: item.name,
      producer: item.producer ?? null,
      category: item.category ?? null,
      vintage: item.vintage ?? null,
      region: item.region ?? null,
      grape_variety: item.grape_variety ?? null,
      by_glass_price: item.by_glass_price ?? null,
      bottle_price: item.bottle_price ?? null,
      raw_extracted_text: item.raw_text ?? null,
      wine_library_id: masterWineId,
      source: method,
      status:
        method === "manual" && idx >= FREE_TIER_MANUAL_LIMIT
          ? "flagged"
          : "approved",
      review_notes:
        method === "manual" && idx >= FREE_TIER_MANUAL_LIMIT
          ? "Free tier: exceeds 25 item limit"
          : null,
    }));

    const { data, error: menuItemsErr } = await this.dbService.supabase
      .from("menu_items")
      .insert(menuItemRows)
      .select("id, wine_library_id, name");

    if (menuItemsErr) {
      this.logger.error(`Failed to insert menu_items: ${menuItemsErr.message}`);
      throw new Error(`menu_items insert failed: ${menuItemsErr.message}`);
    }

    // A single bulk INSERT ... RETURNING preserves VALUES-clause order in
    // practice (no ON CONFLICT / trigger reordering here), so index-aligned
    // zipping with `resolved` is safe and avoids an N+1 re-fetch.
    const insertedMenuItems: InsertedMenuItem[] = data ?? [];

    // Seed restaurant_inventory (awaited — previously fire-and-forget into a
    // table named "inventory" that does not exist in this schema).
    const inventoryMap = await this.addToInventory(
      insertedMenuItems,
      restaurantId,
    );
    await this.backfillMenuItemColumn(inventoryMap, "inventory_item_id");

    // Provenance trail for governance (awaited, non-fatal on failure so a
    // submissions-table hiccup never blocks the manager's own inventory).
    let submissionMap = new Map<string, string>();
    try {
      submissionMap = await this.submitToWineLibrary(
        resolved,
        insertedMenuItems,
        restaurantId,
        userId,
      );
      await this.backfillMenuItemColumn(submissionMap, "submission_id");
    } catch (err) {
      this.logger.warn(
        `wine library submission failed (non-fatal): ${err.message}`,
      );
    }

    return resolved.map((r, idx) => {
      const menuItem = insertedMenuItems[idx];
      return {
        menuItemId: menuItem?.id,
        submissionId: menuItem
          ? (submissionMap.get(menuItem.id) ?? null)
          : null,
        name: r.item.name,
        producer: r.item.producer ?? null,
        category: r.item.category ?? null,
        vintage: r.item.vintage ?? null,
        region: r.item.region ?? null,
        grapeVariety: r.item.grape_variety ?? null,
        byGlassPrice: r.item.by_glass_price ?? null,
        bottlePrice: r.item.bottle_price ?? null,
        matched: r.matched,
        needsReview: !r.matched,
      };
    });
  }

  private async upsertMenu(restaurantId: string): Promise<{ id: string }> {
    const { data: existing } = await this.dbService.supabase
      .from("restaurant_menus")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("status", "active")
      .maybeSingle();

    if (existing) return existing;

    const { data: created, error } = await this.dbService.supabase
      .from("restaurant_menus")
      .insert({
        restaurant_id: restaurantId,
        name: "Wine List",
        menu_type: "beverage",
        status: "active",
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
    resolved: ResolvedItem[],
    insertedMenuItems: InsertedMenuItem[],
    restaurantId: string,
    userId: string,
  ): Promise<Map<string, string>> {
    const rows: Record<string, unknown>[] = [];
    const correspondingMenuItemIds: string[] = [];

    resolved.forEach((r, idx) => {
      if (!r.masterWineId) return;
      const menuItem = insertedMenuItems[idx];
      if (!menuItem) return;

      rows.push({
        restaurant_id: restaurantId,
        submitted_by: userId,
        status: r.matched ? "merged" : "pending_review",
        decision_reason: r.matched ? "library_match" : "provisional_created",
        matched_master_id: r.masterWineId,
        payload: r.item,
        normalized_fields: {
          // Was `name.toLowerCase().trim()`, a third normalizer writing the
          // same field name as the library's normalized_name but folding
          // nothing — so "Château Margaux" stayed "château margaux" here and
          // was "chateau margaux" everywhere else.
          normalized_name: this.wineSubmissions.normalizeText(r.item.name),
          normalized_producer: this.wineSubmissions.normalizeText(
            r.item.producer,
          ),
          producer: r.item.producer ?? null,
          vintage: r.item.vintage ?? null,
          region: r.item.region ?? null,
          grape_variety: r.item.grape_variety ?? null,
        },
      });
      correspondingMenuItemIds.push(menuItem.id);
    });

    const menuItemToSubmission = new Map<string, string>();
    if (rows.length === 0) return menuItemToSubmission;

    const { data, error } = await this.dbService.supabase
      .from("master_wine_library_submissions")
      .insert(rows)
      .select("id");

    if (error) throw new Error(error.message);

    (data ?? []).forEach((row, i) => {
      const menuItemId = correspondingMenuItemIds[i];
      if (menuItemId) menuItemToSubmission.set(menuItemId, row.id);
    });

    return menuItemToSubmission;
  }

  /**
   * Seeds restaurant_inventory for every menu item that resolved to a
   * master_wine_library row. Returns a menuItemId → restaurant_inventory.id
   * map so the caller can backfill menu_items.inventory_item_id.
   */
  private async addToInventory(
    menuItems: InsertedMenuItem[],
    restaurantId: string,
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const validItems = menuItems.filter((i) => i.wine_library_id);
    if (validItems.length === 0) return result;

    const thresholdMin = await this.getDefaultThresholdMin(restaurantId);

    for (const item of validItems) {
      const { data: existing } = await this.dbService.supabase
        .from("restaurant_inventory")
        .select("id")
        .eq("restaurant_id", restaurantId)
        .eq("master_wine_id", item.wine_library_id)
        .maybeSingle();

      if (existing?.id) {
        result.set(item.id, existing.id);
        continue;
      }

      const { data: created, error } = await this.dbService.supabase
        .from("restaurant_inventory")
        .insert({
          restaurant_id: restaurantId,
          master_wine_id: item.wine_library_id,
          wine_name: item.name,
          threshold_min: thresholdMin,
          is_active: true,
        })
        .select("id")
        .single();

      if (error) {
        this.logger.warn(
          `inventory seeding failed for "${item.name}" (non-fatal): ${error.message}`,
        );
        continue;
      }
      if (created) result.set(item.id, created.id);
    }

    return result;
  }

  private async getDefaultThresholdMin(restaurantId: string): Promise<number> {
    const { data } = await this.dbService.supabase
      .from("restaurants")
      .select("default_threshold_min")
      .eq("id", restaurantId)
      .maybeSingle();
    return data?.default_threshold_min ?? DEFAULT_THRESHOLD_MIN_FALLBACK;
  }

  private async backfillMenuItemColumn(
    menuItemToValue: Map<string, string>,
    column: "inventory_item_id" | "submission_id",
  ): Promise<void> {
    for (const [menuItemId, value] of menuItemToValue.entries()) {
      const { error } = await this.dbService.supabase
        .from("menu_items")
        .update({ [column]: value })
        .eq("id", menuItemId);

      if (error) {
        this.logger.warn(
          `Failed to backfill ${column} for menu_item ${menuItemId}: ${error.message}`,
        );
      }
    }
  }

  private async markMenuUploaded(restaurantId: string): Promise<void> {
    const { error } = await this.dbService.supabase
      .from("user_onboarding_progress")
      .update({ menu_uploaded: true })
      .eq("restaurant_id", restaurantId);

    if (error) {
      this.logger.warn(
        `Failed to mark menu_uploaded for restaurant ${restaurantId}: ${error.message}`,
      );
      return;
    }

    // Check every user's progress row for this restaurant and set
    // completed_at for anyone who has now finished all three tasks.
    const { data: rows } = await this.dbService.supabase
      .from("user_onboarding_progress")
      .select(
        "id, menu_uploaded, vendor_added, team_member_invited, completed_at",
      )
      .eq("restaurant_id", restaurantId);

    const toComplete = (rows ?? []).filter(
      (row) =>
        row.menu_uploaded &&
        row.vendor_added &&
        row.team_member_invited &&
        !row.completed_at,
    );

    for (const row of toComplete) {
      const { error: completedErr } = await this.dbService.supabase
        .from("user_onboarding_progress")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", row.id);

      if (completedErr) {
        this.logger.warn(
          `Failed to set completed_at for onboarding row ${row.id}: ${completedErr.message}`,
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

    // Restaurant-scoped self-heal: user_onboarding_progress is keyed by
    // user_id, so an invitee who joins after the owner already uploaded a
    // menu would otherwise see "Upload your wine menu" as still pending.
    // Auto-satisfy it from the restaurant's actual state instead.
    let menuUploaded = !!data.menu_uploaded;
    if (!menuUploaded) {
      const { data: activeMenu } = await this.dbService.supabase
        .from("restaurant_menus")
        .select("id")
        .eq("restaurant_id", data.restaurant_id)
        .eq("status", "active")
        .maybeSingle();

      if (activeMenu) {
        menuUploaded = true;
        const { error: healErr } = await this.dbService.supabase
          .from("user_onboarding_progress")
          .update({ menu_uploaded: true })
          .eq("id", data.id);
        if (healErr) {
          this.logger.warn(
            `Failed to self-heal menu_uploaded for onboarding row ${data.id}: ${healErr.message}`,
          );
        }
      }
    }

    const { data: restaurant } = await this.dbService.supabase
      .from("restaurants")
      .select("threshold_configured")
      .eq("id", data.restaurant_id)
      .maybeSingle();
    const thresholdConfigured = !!restaurant?.threshold_configured;

    return {
      ...data,
      menu_uploaded: menuUploaded,
      threshold_configured: thresholdConfigured,
      // "Activated" = the two soft-gate essentials — the manager has a
      // working inventory and a low-stock signal. Vendor/team are optional.
      activated: menuUploaded && thresholdConfigured,
    };
  }

  async setDefaultThreshold(
    restaurantId: string,
    thresholdMin: number,
  ): Promise<{ default_threshold_min: number; threshold_configured: true }> {
    const { error } = await this.dbService.supabase
      .from("restaurants")
      .update({
        default_threshold_min: thresholdMin,
        threshold_configured: true,
      })
      .eq("id", restaurantId);

    if (error) {
      throw new Error(`Failed to set default threshold: ${error.message}`);
    }

    return { default_threshold_min: thresholdMin, threshold_configured: true };
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
