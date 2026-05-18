import { Injectable, Logger, HttpException, HttpStatus, Optional, Inject } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { OrchestratorService } from '../common/orchestrator/orchestrator.service';
import {
  CreateInventoryItemDto,
  UpdateInventoryItemDto,
  MapToastItemDto,
  BulkMapToastItemsDto,
} from './dto/inventory.dto';

const ML_PER_OZ = 29.5735;

function roundOz(ml: number): number {
  return Math.round((ml / ML_PER_OZ) * 10) / 10;
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly dbService: DatabaseService,
    @Optional() @Inject(OrchestratorService) private readonly orchestratorService?: OrchestratorService,
  ) {}

  private mapInventoryItem(row: Record<string, any>): Record<string, any> {
    const wineBottleMl = row.master_wine_library?.bottle_size_ml ?? 750;
    const defaultPourMl = row.restaurants?.default_pour_ml ?? 150;
    const effectiveBottleSizeMl = row.bottle_size_ml ?? wineBottleMl;
    const pourSizeMl = row.pour_size_ml ?? defaultPourMl;
    const glassesPerBottle =
      row.glasses_per_bottle_override ??
      (pourSizeMl > 0 ? Math.floor(effectiveBottleSizeMl / pourSizeMl) : undefined);

    // Extract wine name before stripping the nested master_wine_library object.
    // Prefer the denormalized column; fall back to the joined library row.
    const wineName: string | null = row.wine_name || row.master_wine_library?.name || null;

    const result = { ...row };
    if (row.master_wine_library) delete result.master_wine_library;
    if (row.restaurants) delete result.restaurants;

    return {
      ...result,
      wineName,
      wine_name: wineName,
      bottleSizeMl: effectiveBottleSizeMl,
      bottleSizeOz: roundOz(effectiveBottleSizeMl),
      pourSizeMl,
      pourSizeOz: roundOz(pourSizeMl),
      glassesPerBottle,
      saleType: row.sale_type ?? undefined,
      menuPriceGlass: row.menu_price_glass ?? undefined,
      glassesPerBottleOverride: row.glasses_per_bottle_override ?? undefined,
    };
  }

  async getRestaurantInventory(restaurantId: string) {
    this.logger.log(`Fetching inventory for restaurant: ${restaurantId}`);
    const data = await this.dbService.getRestaurantInventory(restaurantId);
    return (data || []).map((row) => this.mapInventoryItem(row));
  }

  async getLowStockItems(restaurantId: string) {
    this.logger.log(`Fetching low stock items for restaurant: ${restaurantId}`);
    return await this.dbService.getLowStockItems(restaurantId);
  }

  async getInventoryItem(restaurantId: string, itemId: string) {
    const client = this.dbService.getClient();

    const { data, error } = await client
      .from('restaurant_inventory')
      .select(`
        *,
        master_wine_library (bottle_size_ml),
        restaurants (default_pour_ml, measurement_unit)
      `)
      .eq('restaurant_id', restaurantId)
      .eq('id', itemId)
      .single();

    if (error) throw error;
    return data ? this.mapInventoryItem(data) : null;
  }

  /**
   * Create a new inventory item
   */
  async createInventoryItem(restaurantId: string, dto: CreateInventoryItemDto) {
    const client = this.dbService.getClient();

    // Look up the canonical wine name once; used in both the re-activation and INSERT paths.
    let masterWineName: string | null = null;
    try {
      const { data: mw } = await client
        .from('master_wine_library')
        .select('name')
        .eq('id', dto.wineId)
        .single();
      masterWineName = mw?.name ?? null;
    } catch { /* non-fatal — wine_name stays null */ }

    // Check if this wine already exists in the restaurant's inventory (active OR soft-deleted)
    const { data: existing } = await client
      .from('restaurant_inventory')
      .select('id, is_active')
      .eq('restaurant_id', restaurantId)
      .eq('master_wine_id', dto.wineId)
      .single();

    if (existing) {
      if (!existing.is_active) {
        // Soft-deleted item: re-activate it so the order can proceed
        const { data: reactivated, error: reactivateError } = await client
          .from('restaurant_inventory')
          .update({
            is_active: true,
            stock_live: dto.stockLive ?? 0,
            provider_id: dto.providerId || null,
            ...(masterWineName ? { wine_name: masterWineName } : {}),
          })
          .eq('id', existing.id)
          .select(`*, master_wine_library (name, bottle_size_ml), restaurants (default_pour_ml, measurement_unit)`)
          .single();

        if (reactivateError) {
          this.logger.error(`Failed to reactivate inventory item: ${reactivateError.message}`);
          throw new HttpException(reactivateError.message, HttpStatus.BAD_REQUEST);
        }

        this.logger.log({ message: 'Inventory item reactivated', restaurantId, wineId: dto.wineId, inventoryId: existing.id });
        return this.mapInventoryItem(reactivated);
      }

      // Active item: return its ID so the caller can skip re-creation
      throw new HttpException(
        { message: 'This wine already exists in inventory.', existingId: existing.id },
        HttpStatus.CONFLICT,
      );
    }

    // Create the inventory item
    const insertData: Record<string, any> = {
      restaurant_id: restaurantId,
      master_wine_id: dto.wineId,
      provider_id: dto.providerId || null,
      stock_live: dto.stockLive,
      threshold_min: dto.thresholdMin || 6,
      threshold_max: dto.thresholdMax || 24,
      toast_item_guid: dto.toastItemGuid || null,
      is_active: true,
      wine_name: masterWineName,
    };
    if (dto.saleType !== undefined) insertData.sale_type = dto.saleType;
    if (dto.pourSizeMl !== undefined) insertData.pour_size_ml = dto.pourSizeMl;
    if (dto.menuPriceGlass !== undefined) insertData.menu_price_glass = dto.menuPriceGlass;
    if (dto.bottleSizeMl !== undefined) insertData.bottle_size_ml = dto.bottleSizeMl;
    if (dto.glassesPerBottleOverride !== undefined) insertData.glasses_per_bottle_override = dto.glassesPerBottleOverride;

    const { data, error } = await client
      .from('restaurant_inventory')
      .insert(insertData)
      .select(`
        *,
        master_wine_library (name, bottle_size_ml),
        restaurants (default_pour_ml, measurement_unit)
      `)
      .single();

    if (error) {
      this.logger.error(`Failed to create inventory item: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }

    this.logger.log({
      message: 'Inventory item created',
      restaurantId,
      wineId: dto.wineId,
      inventoryId: data.id,
    });

    return this.mapInventoryItem(data);
  }

  async getInventorySummary(restaurantId: string) {
    const rawInventory = await this.dbService.getRestaurantInventory(restaurantId);
    const inventory = rawInventory ?? [];
    const rawLowStock = await this.dbService.getLowStockItems(restaurantId);
    const lowStock = rawLowStock ?? [];

    const totalItems = inventory.length;
    const totalBottles = inventory.reduce((sum: number, item: any) => sum + (item.stock_live || 0), 0);
    const lowStockCount = lowStock.length;
    const criticalCount = inventory.filter(item => (item.stock_live || 0) === 0).length;
    
    // Count Toast mappings
    const toastMappedCount = inventory.filter(item => item.toast_item_guid).length;
    const toastUnmappedCount = totalItems - toastMappedCount;

    return {
      totalItems,
      totalBottles,
      lowStockCount,
      criticalCount,
      healthyCount: totalItems - lowStockCount,
      toastMappedCount,
      toastUnmappedCount,
    };
  }

  /**
   * Update an inventory item.
   * After DB update, publishes stock.manual_override event to RabbitMQ
   * so the Buffer Manager can evaluate threshold breaches.
   */
  async updateInventoryItem(
    restaurantId: string,
    itemId: string,
    dto: UpdateInventoryItemDto,
  ) {
    const client = this.dbService.getClient();

    // Fetch old values for event payload (before update)
    const { data: oldItem } = await client
      .from('restaurant_inventory')
      .select('stock_live, shadow_stock, threshold_min, master_wine_id')
      .eq('restaurant_id', restaurantId)
      .eq('id', itemId)
      .single();

    // Build update object with snake_case column names
    const updateData: Record<string, any> = {};
    if (dto.providerId !== undefined) updateData.provider_id = dto.providerId;
    if (dto.stockLive !== undefined) updateData.stock_live = dto.stockLive;
    if (dto.shadowStock !== undefined) updateData.shadow_stock = dto.shadowStock;
    if (dto.thresholdMin !== undefined) updateData.threshold_min = dto.thresholdMin;
    if (dto.thresholdMax !== undefined) updateData.threshold_max = dto.thresholdMax;
    if (dto.toastItemGuid !== undefined) updateData.toast_item_guid = dto.toastItemGuid;
    if (dto.isActive !== undefined) updateData.is_active = dto.isActive;
    if (dto.saleType !== undefined) updateData.sale_type = dto.saleType;
    if (dto.pourSizeMl !== undefined) updateData.pour_size_ml = dto.pourSizeMl;
    if (dto.menuPriceGlass !== undefined) updateData.menu_price_glass = dto.menuPriceGlass;
    if (dto.bottleSizeMl !== undefined) updateData.bottle_size_ml = dto.bottleSizeMl;
    if (dto.glassesPerBottleOverride !== undefined) updateData.glasses_per_bottle_override = dto.glassesPerBottleOverride;

    const { data, error } = await client
      .from('restaurant_inventory')
      .update(updateData)
      .eq('restaurant_id', restaurantId)
      .eq('id', itemId)
      .select(`
        *,
        master_wine_library (bottle_size_ml),
        restaurants (default_pour_ml, measurement_unit)
      `)
      .single();

    if (error) {
      this.logger.error(`Failed to update inventory item: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }

    this.logger.log({
      message: 'Inventory item updated',
      restaurantId,
      itemId,
      updatedFields: Object.keys(updateData),
    });

    // Publish stock.manual_override event if stock_live was changed
    if (dto.stockLive !== undefined && this.orchestratorService) {
      try {
        await this.orchestratorService.publishEvent(
          'stock.events',
          'stock.manual_override',
          {
            restaurant_id: restaurantId,
            inventory_id: itemId,
            wine_id: oldItem?.master_wine_id || null,
            old_stock_live: oldItem?.stock_live ?? 0,
            new_stock_live: dto.stockLive,
            old_shadow_stock: oldItem?.shadow_stock ?? 0,
            new_shadow_stock: dto.shadowStock ?? oldItem?.shadow_stock ?? 0,
            threshold_min: oldItem?.threshold_min ?? 6,
            source: 'manual_override',
            timestamp: new Date().toISOString(),
          },
        );
        this.logger.log(`Published stock.manual_override event for item ${itemId}`);
      } catch (pubErr) {
        this.logger.warn(`Failed to publish stock.manual_override: ${pubErr?.message}`);
      }
    }

    return this.mapInventoryItem(data);
  }

  /**
   * Map a Toast item GUID to an inventory item
   */
  async mapToastItem(restaurantId: string, dto: MapToastItemDto) {
    const client = this.dbService.getClient();

    // Verify the inventory item belongs to this restaurant
    const { data: existing, error: checkError } = await client
      .from('restaurant_inventory')
      .select('id, toast_item_guid')
      .eq('restaurant_id', restaurantId)
      .eq('id', dto.inventoryId)
      .single();

    if (checkError || !existing) {
      throw new HttpException('Inventory item not found', HttpStatus.NOT_FOUND);
    }

    // Check if this Toast GUID is already mapped to another item
    const { data: duplicate } = await client
      .from('restaurant_inventory')
      .select('id')
      .eq('restaurant_id', restaurantId)
      .eq('toast_item_guid', dto.toastItemGuid)
      .neq('id', dto.inventoryId)
      .single();

    if (duplicate) {
      throw new HttpException(
        'Toast item GUID is already mapped to another inventory item',
        HttpStatus.CONFLICT,
      );
    }

    // Update the mapping
    const { data, error } = await client
      .from('restaurant_inventory')
      .update({ toast_item_guid: dto.toastItemGuid })
      .eq('id', dto.inventoryId)
      .select(`
        *,
        master_wine_library (bottle_size_ml),
        restaurants (default_pour_ml, measurement_unit)
      `)
      .single();

    if (error) {
      this.logger.error(`Failed to map Toast item: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }

    this.logger.log({
      message: 'Toast item mapped',
      restaurantId,
      inventoryId: dto.inventoryId,
      toastItemGuid: dto.toastItemGuid,
    });

    return this.mapInventoryItem(data);
  }

  /**
   * Bulk map Toast items to inventory
   */
  async bulkMapToastItems(restaurantId: string, dto: BulkMapToastItemsDto) {
    const results = {
      success: [] as string[],
      failed: [] as { inventoryId: string; error: string }[],
    };

    for (const mapping of dto.mappings) {
      try {
        await this.mapToastItem(restaurantId, mapping);
        results.success.push(mapping.inventoryId);
      } catch (error) {
        results.failed.push({
          inventoryId: mapping.inventoryId,
          error: error.message,
        });
      }
    }

    this.logger.log({
      message: 'Bulk Toast mapping completed',
      restaurantId,
      successCount: results.success.length,
      failedCount: results.failed.length,
    });

    return results;
  }

  /**
   * Get unmapped inventory items (items without Toast GUID)
   */
  async getUnmappedItems(restaurantId: string) {
    const client = this.dbService.getClient();

    const { data, error } = await client
      .from('restaurant_inventory')
      .select(`
        id,
        restaurant_id,
        master_wine_id,
        stock_live,
        is_active,
        created_at,
        master_wine_library (
          name,
          producer,
          vintage
        )
      `)
      .eq('restaurant_id', restaurantId)
      .is('toast_item_guid', null)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to get unmapped items: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    return data || [];
  }

  /**
   * Find inventory by Toast item GUID
   */
  async findByToastGuid(restaurantId: string, toastItemGuid: string) {
    const client = this.dbService.getClient();

    const { data, error } = await client
      .from('restaurant_inventory')
      .select(`
        *,
        master_wine_library (
          name,
          producer,
          vintage,
          bottle_size_ml
        ),
        restaurants (default_pour_ml, measurement_unit)
      `)
      .eq('restaurant_id', restaurantId)
      .eq('toast_item_guid', toastItemGuid)
      .eq('is_active', true)
      .single();

    if (error) {
      return null;
    }

    return data ? this.mapInventoryItem(data) : null;
  }

  /**
   * Soft-delete an inventory item (set is_active = false)
   */
  async softDeleteItem(restaurantId: string, itemId: string): Promise<void> {
    const client = this.dbService.getClient();

    // Try by restaurant_inventory.id (PK) first
    const { data: byPk, error: pkError } = await client
      .from('restaurant_inventory')
      .update({ is_active: false })
      .eq('restaurant_id', restaurantId)
      .eq('id', itemId)
      .select('id');

    if (pkError) {
      this.logger.error(`softDeleteItem (by PK) error: ${pkError.message}`);
      throw new HttpException(pkError.message, HttpStatus.BAD_REQUEST);
    }

    if (byPk && byPk.length > 0) {
      this.logger.log({ message: 'Inventory item soft-deleted by PK', restaurantId, itemId });
      return;
    }

    // Fallback: caller may have passed master_wine_id instead of restaurant_inventory.id
    this.logger.warn(`softDeleteItem: no row matched id=${itemId}; retrying by master_wine_id`);
    const { data: byWineId, error: wineError } = await client
      .from('restaurant_inventory')
      .update({ is_active: false })
      .eq('restaurant_id', restaurantId)
      .eq('master_wine_id', itemId)
      .select('id');

    if (wineError) {
      this.logger.error(`softDeleteItem (by master_wine_id) error: ${wineError.message}`);
      throw new HttpException(wineError.message, HttpStatus.BAD_REQUEST);
    }

    if (!byWineId || byWineId.length === 0) {
      this.logger.error(`softDeleteItem: item not found — id=${itemId}, restaurantId=${restaurantId}`);
      throw new HttpException(
        `Inventory item not found (id: ${itemId})`,
        HttpStatus.NOT_FOUND,
      );
    }

    this.logger.log({ message: 'Inventory item soft-deleted by master_wine_id', restaurantId, itemId });
  }

  /**
   * Remove Toast item mapping
   */
  async unmapToastItem(restaurantId: string, inventoryId: string) {
    const client = this.dbService.getClient();

    const { data, error } = await client
      .from('restaurant_inventory')
      .update({ toast_item_guid: null })
      .eq('restaurant_id', restaurantId)
      .eq('id', inventoryId)
      .select(`
        *,
        master_wine_library (bottle_size_ml),
        restaurants (default_pour_ml, measurement_unit)
      `)
      .single();

    if (error) {
      this.logger.error(`Failed to unmap Toast item: ${error.message}`);
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }

    this.logger.log({
      message: 'Toast item unmapped',
      restaurantId,
      inventoryId,
    });

    return this.mapInventoryItem(data);
  }
}

