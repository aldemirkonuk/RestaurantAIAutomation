import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { EventType, SourcePage } from "../events/dto/event.dto";
import {
  CreateInventoryTransactionDto,
  GetTransactionsQueryDto,
  InventoryTransactionResponseDto,
  TransactionsListResponseDto,
  InventoryBalanceResponseDto,
  TransactionSummaryResponseDto,
  BulkTransactionDto,
  BulkTransactionResponseDto,
  TransactionType,
  TransactionSource,
  StockType,
} from "./dto/inventory-ledger.dto";

// ============================================================================
// DATABASE ROW INTERFACE
// ============================================================================

interface TransactionRow {
  id: string;
  restaurant_id: string;
  inventory_id: string;
  wine_id: string;
  transaction_type: string;
  source: string;
  quantity_change: number;
  quantity_before: number;
  quantity_after: number;
  stock_type: string;
  reference_type: string | null;
  reference_id: string | null;
  pos_transaction_id: string | null;
  order_id: string | null;
  from_location_id: string | null;
  to_location_id: string | null;
  unit_cost: number | null;
  total_cost: number | null;
  performed_by: string | null;
  performed_by_type: string;
  reason: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  transaction_date: string;
  created_at: string;
}

// ============================================================================
// SERVICE
// ============================================================================

@Injectable()
export class InventoryLedgerService {
  private readonly logger = new Logger(InventoryLedgerService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly eventsService: EventsService,
  ) {}

  // ==========================================================================
  // CREATE TRANSACTION
  // ==========================================================================

  async createTransaction(
    restaurantId: string,
    userId: string,
    dto: CreateInventoryTransactionDto,
  ): Promise<InventoryTransactionResponseDto> {
    const startTime = Date.now();

    this.logger.log({
      message: "Creating inventory transaction",
      restaurantId,
      userId,
      inventoryId: dto.inventoryId,
      transactionType: dto.transactionType,
      quantityChange: dto.quantityChange,
    });

    // Validate quantity change is not zero
    if (dto.quantityChange === 0) {
      throw new BadRequestException("Quantity change cannot be zero");
    }

    // record_inventory_transaction referenced a `live_stock` column that does
    // not exist on restaurant_inventory and 500'd against the real database
    // (spine repair, decision A5) — every call now goes through
    // apply_stock_movement, the single stock write primitive, mirroring the
    // reconcile path below. order_id/fromLocationId/toLocationId map onto its
    // p_order_id/p_location_id (transfers are not yet modeled as a single
    // atomic movement — from/to would need two calls, which is out of scope
    // for this port and unchanged from the pre-existing gap).
    const { data, error } = await this.databaseService.supabase.rpc(
      "apply_stock_movement",
      {
        p_inventory_id: dto.inventoryId,
        p_stock_state: dto.stockType || StockType.LIVE,
        p_delta: dto.quantityChange,
        p_transaction_type: dto.transactionType,
        p_source: dto.source,
        p_performed_by: userId,
        p_reason: dto.reason || null,
        p_unit_cost: dto.unitCost || null,
        p_location_id: dto.toLocationId || dto.fromLocationId || null,
        p_order_id: dto.orderId || null,
        p_idempotency_key: dto.idempotencyKey,
        p_reference_type: dto.referenceType || null,
        p_reference_id: dto.referenceId || null,
        p_pos_transaction_id: dto.posTransactionId || null,
        p_notes: dto.notes || null,
        p_metadata: dto.metadata || {},
      },
    );

    if (error) {
      this.logger.error({
        message: "Failed to create inventory transaction",
        restaurantId,
        inventoryId: dto.inventoryId,
        error: error.message,
        durationMs: Date.now() - startTime,
      });
      throw error;
    }
    if (!data) {
      // apply_stock_movement returns the EXISTING transaction id on a replayed
      // idempotency key, and NULL only when p_delta was zero — already
      // rejected above. A NULL here means this call landed on a prior
      // transaction whose id we don't have; that is a caller bug (reusing a
      // key across genuinely different transactions), not a retry.
      throw new BadRequestException(
        "apply_stock_movement returned no transaction id",
      );
    }

    // Fetch the created transaction
    const transaction = await this.getTransaction(restaurantId, data);

    // Emit event to event ingestion system
    try {
      await this.eventsService.createEvent(restaurantId, userId, {
        eventType: EventType.INVENTORY_CHANGE,
        sourcePage: SourcePage.INVENTORY,
        payload: {
          wineId: dto.wineId,
          quantity: dto.quantityChange,
          previousQuantity: transaction.quantityBefore,
          changeType: this.mapTransactionTypeToChangeType(dto.transactionType),
          reason: dto.reason,
          transactionId: transaction.id,
          source: dto.source,
        },
      });
    } catch (e) {
      this.logger.warn("Failed to emit inventory change event", e);
    }

    this.logger.log({
      message: "Inventory transaction created",
      restaurantId,
      transactionId: transaction.id,
      quantityBefore: transaction.quantityBefore,
      quantityAfter: transaction.quantityAfter,
      durationMs: Date.now() - startTime,
    });

    return transaction;
  }

  // ==========================================================================
  // BULK CREATE
  // ==========================================================================

  async createBulkTransactions(
    restaurantId: string,
    userId: string,
    dto: BulkTransactionDto,
  ): Promise<BulkTransactionResponseDto> {
    const startTime = Date.now();
    const createdIds: string[] = [];
    const errors: { index: number; error: string }[] = [];

    this.logger.log({
      message: "Creating bulk inventory transactions",
      restaurantId,
      count: dto.transactions.length,
    });

    for (let i = 0; i < dto.transactions.length; i++) {
      try {
        const transaction = await this.createTransaction(
          restaurantId,
          userId,
          dto.transactions[i],
        );
        createdIds.push(transaction.id);
      } catch (error) {
        errors.push({ index: i, error: error.message });
      }
    }

    this.logger.log({
      message: "Bulk transactions completed",
      restaurantId,
      successCount: createdIds.length,
      failedCount: errors.length,
      durationMs: Date.now() - startTime,
    });

    return {
      successCount: createdIds.length,
      failedCount: errors.length,
      createdIds,
      errors,
    };
  }

  // ==========================================================================
  // READ
  // ==========================================================================

  async getTransaction(
    restaurantId: string,
    transactionId: string,
  ): Promise<InventoryTransactionResponseDto> {
    const { data, error } = await this.databaseService.supabase
      .from("inventory_transactions")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("id", transactionId)
      .single();

    if (error || !data) {
      throw new BadRequestException(`Transaction not found: ${transactionId}`);
    }

    return this.mapTransaction(data);
  }

  async listTransactions(
    restaurantId: string,
    query: GetTransactionsQueryDto,
  ): Promise<TransactionsListResponseDto> {
    const startTime = Date.now();
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const fromIndex = (page - 1) * limit;
    const toIndex = fromIndex + limit - 1;

    this.logger.debug({
      message: "Listing inventory transactions",
      restaurantId,
      query,
    });

    let supabaseQuery = this.databaseService.supabase
      .from("inventory_transactions")
      .select("*", { count: "exact" })
      .eq("restaurant_id", restaurantId);

    if (query.inventoryId) {
      supabaseQuery = supabaseQuery.eq("inventory_id", query.inventoryId);
    }

    if (query.wineId) {
      supabaseQuery = supabaseQuery.eq("wine_id", query.wineId);
    }

    if (query.transactionType) {
      supabaseQuery = supabaseQuery.eq(
        "transaction_type",
        query.transactionType,
      );
    }

    if (query.source) {
      supabaseQuery = supabaseQuery.eq("source", query.source);
    }

    if (query.startDate) {
      supabaseQuery = supabaseQuery.gte("transaction_date", query.startDate);
    }

    if (query.endDate) {
      supabaseQuery = supabaseQuery.lte("transaction_date", query.endDate);
    }

    const { data, error, count } = await supabaseQuery
      .order("transaction_date", { ascending: false })
      .range(fromIndex, toIndex);

    if (error) {
      this.logger.error({
        message: "Failed to list transactions",
        restaurantId,
        error: error.message,
        durationMs: Date.now() - startTime,
      });
      throw error;
    }

    const transactions = (data || []).map((row: TransactionRow) =>
      this.mapTransaction(row),
    );
    const total = count ?? transactions.length;

    this.logger.debug({
      message: "Transactions listed",
      restaurantId,
      resultCount: transactions.length,
      total,
      durationMs: Date.now() - startTime,
    });

    return {
      transactions,
      total,
      page,
      limit,
      hasMore: fromIndex + transactions.length < total,
    };
  }

  // ==========================================================================
  // BALANCE QUERIES
  // ==========================================================================

  async getBalanceAt(
    restaurantId: string,
    inventoryId: string,
    asOf: string,
    stockType: StockType = StockType.LIVE,
  ): Promise<InventoryBalanceResponseDto> {
    const { data, error } = await this.databaseService.supabase.rpc(
      "get_inventory_balance_at",
      {
        p_inventory_id: inventoryId,
        p_as_of: asOf,
        p_stock_type: stockType,
      },
    );

    if (error) {
      this.logger.error({
        message: "Failed to get balance at point in time",
        inventoryId,
        asOf,
        error: error.message,
      });
      throw error;
    }

    return {
      inventoryId,
      balance: data || 0,
      asOf,
      stockType,
    };
  }

  async getTransactionHistory(
    restaurantId: string,
    inventoryId: string,
    days: number = 30,
  ): Promise<InventoryTransactionResponseDto[]> {
    const startDate = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data, error } = await this.databaseService.supabase
      .from("inventory_transactions")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("inventory_id", inventoryId)
      .gte("transaction_date", startDate)
      .order("transaction_date", { ascending: false });

    if (error) {
      throw error;
    }

    return (data || []).map((row: TransactionRow) => this.mapTransaction(row));
  }

  // ==========================================================================
  // SUMMARY & ANALYTICS
  // ==========================================================================

  async getTransactionSummary(
    restaurantId: string,
    startDate: string,
    endDate: string,
  ): Promise<TransactionSummaryResponseDto> {
    const { data, error } = await this.databaseService.supabase
      .from("inventory_transactions")
      .select("transaction_type, source, quantity_change")
      .eq("restaurant_id", restaurantId)
      .gte("transaction_date", startDate)
      .lte("transaction_date", endDate);

    if (error) {
      throw error;
    }

    const transactions = data || [];

    // Calculate summaries
    let totalIn = 0;
    let totalOut = 0;
    const byType: Record<string, { count: number; quantity: number }> = {};
    const bySource: Record<string, { count: number; quantity: number }> = {};

    for (const txn of transactions) {
      const qty = txn.quantity_change;

      if (qty > 0) {
        totalIn += qty;
      } else {
        totalOut += Math.abs(qty);
      }

      // By type
      if (!byType[txn.transaction_type]) {
        byType[txn.transaction_type] = { count: 0, quantity: 0 };
      }
      byType[txn.transaction_type].count++;
      byType[txn.transaction_type].quantity += qty;

      // By source
      if (!bySource[txn.source]) {
        bySource[txn.source] = { count: 0, quantity: 0 };
      }
      bySource[txn.source].count++;
      bySource[txn.source].quantity += qty;
    }

    return {
      restaurantId,
      period: `${startDate} to ${endDate}`,
      totalIn,
      totalOut,
      netChange: totalIn - totalOut,
      transactionCount: transactions.length,
      byType,
      bySource,
    };
  }

  // ==========================================================================
  // RECONCILIATION
  // ==========================================================================

  async reconcileInventory(
    restaurantId: string,
    userId: string,
    inventoryId: string,
    wineId: string,
    actualCount: number,
    notes?: string,
  ): Promise<InventoryTransactionResponseDto> {
    // Read current live quantity from the projection. Phase 2 made
    // inventory_lots the source of truth; restaurant_inventory.stock_live is a
    // trigger-maintained projection — reading it is correct and cheap, but we
    // must NOT write it directly (that is what apply_stock_movement is for).
    const { data: currentData, error: currentError } =
      await this.databaseService.supabase
        .from("restaurant_inventory")
        .select("stock_live")
        .eq("id", inventoryId)
        .single();

    if (currentError || !currentData) {
      throw new BadRequestException(`Inventory item not found: ${inventoryId}`);
    }

    const currentStock = currentData.stock_live || 0;
    const difference = actualCount - currentStock;

    if (difference === 0) {
      throw new BadRequestException("No adjustment needed - counts match");
    }

    // Apply the adjustment through the single Phase 2 write primitive, which
    // writes the inventory_lots layer and the inventory_transactions ledger row
    // atomically (delta-based, version-locked, negative-guarded). This replaces
    // the removed record_inventory_transaction RPC that direct-updated the
    // ghost `live_stock` column.
    const reason = notes
      ? `Physical count reconciliation: Expected ${currentStock}, Actual ${actualCount} — ${notes}`
      : `Physical count reconciliation: Expected ${currentStock}, Actual ${actualCount}`;

    const { data: transactionId, error: rpcError } =
      await this.databaseService.supabase.rpc("apply_stock_movement", {
        p_inventory_id: inventoryId,
        p_stock_state: "live",
        p_delta: difference,
        p_transaction_type: "reconciliation",
        p_source: "reconciliation",
        p_performed_by: userId,
        p_reason: reason,
        // Every stock write carries a key now (decision A7). A reconcile is a
        // one-off correction rather than something retried over flaky
        // signal, so a per-call timestamped key is sufficient — it only
        // needs to survive one request, not an offline outbox.
        p_idempotency_key: `reconcile:${inventoryId}:${Date.now()}`,
      });

    if (rpcError || !transactionId) {
      this.logger.error({
        message: "Reconciliation apply_stock_movement failed",
        inventoryId,
        wineId,
        error: rpcError?.message,
      });
      throw new BadRequestException(
        rpcError?.message || "Failed to apply reconciliation movement",
      );
    }

    return this.getTransaction(restaurantId, transactionId as string);
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private mapTransaction(row: TransactionRow): InventoryTransactionResponseDto {
    return {
      id: row.id,
      restaurantId: row.restaurant_id,
      inventoryId: row.inventory_id,
      wineId: row.wine_id,
      transactionType: row.transaction_type as TransactionType,
      source: row.source as TransactionSource,
      quantityChange: row.quantity_change,
      quantityBefore: row.quantity_before,
      quantityAfter: row.quantity_after,
      stockType: row.stock_type as StockType,
      referenceType: row.reference_type || undefined,
      referenceId: row.reference_id || undefined,
      posTransactionId: row.pos_transaction_id || undefined,
      orderId: row.order_id || undefined,
      fromLocationId: row.from_location_id || undefined,
      toLocationId: row.to_location_id || undefined,
      unitCost: row.unit_cost || undefined,
      totalCost: row.total_cost || undefined,
      performedBy: row.performed_by || undefined,
      performedByType: row.performed_by_type,
      reason: row.reason || undefined,
      notes: row.notes || undefined,
      metadata: row.metadata,
      transactionDate: row.transaction_date,
      createdAt: row.created_at,
    };
  }

  private mapTransactionTypeToChangeType(
    type: TransactionType,
  ): "add" | "remove" | "adjust" | "transfer" {
    switch (type) {
      case TransactionType.PURCHASE:
      case TransactionType.RETURN:
      case TransactionType.INITIAL:
        return "add";
      case TransactionType.SALE:
      case TransactionType.WASTE:
      case TransactionType.COMP:
        return "remove";
      case TransactionType.TRANSFER:
        return "transfer";
      default:
        return "adjust";
    }
  }
}
