import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { currencyCode, notACurrencyBecause } from "../common/iso-4217";
import {
  AuctionLotRecordResponseDto,
  CreateAuctionLotRecordDto,
} from "./dto/inventory.dto";

/**
 * An auction lot's own details, kept — auction house, lot number, sale date,
 * and its hammer price and buyer's premium WITH a currency.
 *
 * Built 2026-09-21 (founder answer 2, "Build all now") to close the gap
 * `AuctionLotStart.tsx` and `inventory.md` §9 already named 2026-09-06: "An
 * auction lot's own details have nowhere to live". See
 * `20260921113900_an_auction_lot_keeps_its_own_details.sql` for why this is
 * its own table, linked to `restaurant_inventory` rather than to a specific
 * `inventory_lots` row.
 */

interface AuctionLotRecordRow {
  id: string;
  inventory_id: string;
  auction_house: string;
  lot_number: string;
  sale_date: string;
  hammer_price: number;
  buyers_premium: number;
  currency: string;
  bottles: number;
  recorded_by_name: string;
  created_at: string;
}

const SELECT_COLUMNS =
  "id, inventory_id, auction_house, lot_number, sale_date, hammer_price, buyers_premium, currency, bottles, recorded_by_name, created_at";

@Injectable()
export class AuctionLotRecordsService {
  private readonly logger = new Logger(AuctionLotRecordsService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  private mapRow(row: AuctionLotRecordRow): AuctionLotRecordResponseDto {
    return {
      id: row.id,
      inventoryId: row.inventory_id,
      auctionHouse: row.auction_house,
      lotNumber: row.lot_number,
      saleDate: row.sale_date,
      hammerPrice: Number(row.hammer_price),
      buyersPremium: Number(row.buyers_premium),
      currency: row.currency,
      bottles: row.bottles,
      recordedByName: row.recorded_by_name,
      createdAt: row.created_at,
    };
  }

  async create(
    restaurantId: string,
    userId: string,
    recordedByName: string,
    dto: CreateAuctionLotRecordDto,
  ): Promise<AuctionLotRecordResponseDto> {
    // ISO-4217 MEMBERSHIP, not just three capital letters — the same split
    // every other currency column in this schema uses (the migration's CHECK
    // enforces shape only). Never inferred: this is exactly what the sheet's
    // picker held, or the request is refused.
    const code = currencyCode(dto.currency);
    if (!code) {
      throw new BadRequestException(
        `${notACurrencyBecause(dto.currency)} Nothing was recorded.`,
      );
    }

    const trimmedRecordedByName = (recordedByName || "").trim();
    if (!trimmedRecordedByName) {
      throw new BadRequestException(
        "Your account has no name on file, so this lot cannot record who entered it.",
      );
    }

    // The record holds both NOT NULL with a non-blank CHECK; a blank one is
    // the caller's mistake and gets a 400 that names it, not a constraint 500.
    const auctionHouse = (dto.auctionHouse ?? "").trim();
    const lotNumber = (dto.lotNumber ?? "").trim();
    if (!auctionHouse || !lotNumber) {
      throw new BadRequestException(
        "An auction lot's record needs its auction house and its lot number. Nothing was recorded.",
      );
    }

    // The inventory item must be this house's own — never trust the id alone.
    // A failed read here is refused, never treated as "not found" (a
    // ServiceUnavailable read failure and a genuine 404 are different facts).
    const { data: inv, error: invError } = await this.databaseService.supabase
      .from("restaurant_inventory")
      .select("id")
      .eq("id", dto.inventoryId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (invError) {
      this.logger.error({
        message: "Failed to verify inventory item before recording auction lot",
        restaurantId,
        inventoryId: dto.inventoryId,
        error: invError.message,
      });
      throw invError;
    }
    if (!inv) {
      throw new BadRequestException(
        `No inventory item ${dto.inventoryId} belongs to this restaurant. Nothing was recorded.`,
      );
    }

    const { data, error } = await this.databaseService.supabase
      .from("auction_lot_records")
      .insert({
        restaurant_id: restaurantId,
        inventory_id: dto.inventoryId,
        auction_house: auctionHouse,
        lot_number: lotNumber,
        sale_date: dto.saleDate,
        hammer_price: dto.hammerPrice,
        buyers_premium: dto.buyersPremium,
        currency: code,
        bottles: dto.bottles,
        recorded_by: userId,
        recorded_by_name: trimmedRecordedByName,
      })
      .select(SELECT_COLUMNS)
      .single();

    if (error) {
      this.logger.error({
        message: "Failed to write auction lot record",
        restaurantId,
        error: error.message,
      });
      throw error;
    }

    return this.mapRow(data as AuctionLotRecordRow);
  }

  /** Every auction record for one inventory entry, newest first. A failed read is an error — never an empty list. */
  async listForInventoryItem(
    restaurantId: string,
    inventoryId: string,
  ): Promise<AuctionLotRecordResponseDto[]> {
    const { data, error } = await this.databaseService.supabase
      .from("auction_lot_records")
      .select(SELECT_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .eq("inventory_id", inventoryId)
      .order("created_at", { ascending: false });

    if (error) {
      this.logger.error({
        message: "Failed to read auction lot records",
        restaurantId,
        inventoryId,
        error: error.message,
      });
      throw error;
    }

    return (data || []).map((row) => this.mapRow(row as AuctionLotRecordRow));
  }
}
