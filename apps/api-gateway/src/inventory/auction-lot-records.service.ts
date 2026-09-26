import { BadRequestException, Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { currencyCode, notACurrencyBecause } from "../common/iso-4217";
import { lotBookedCost } from "./auction-lot-cost";
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
 * `20260926140400_an_auction_lot_keeps_its_own_details.sql` for why this is
 * its own table, linked to `restaurant_inventory` rather than to a specific
 * `inventory_lots` row.
 */

interface AuctionLotRecordRow {
  id: string;
  inventory_id: string;
  auction_house: string;
  lot_number: string | null;
  sale_date: string;
  hammer_price: number;
  buyers_premium: number;
  currency: string;
  bottles: number;
  house_currency: string | null;
  exchange_rate: number | string | null;
  house_unit_cost: number | string | null;
  booked_unit_cost: number | string | null;
  recorded_by_name: string;
  created_at: string;
}

const SELECT_COLUMNS =
  "id, inventory_id, auction_house, lot_number, sale_date, hammer_price, buyers_premium, currency, bottles, house_currency, exchange_rate, house_unit_cost, booked_unit_cost, recorded_by_name, created_at";

const numOrNull = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);

@Injectable()
export class AuctionLotRecordsService {
  private readonly logger = new Logger(AuctionLotRecordsService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  private mapRow(row: AuctionLotRecordRow): AuctionLotRecordResponseDto {
    return {
      id: row.id,
      inventoryId: row.inventory_id,
      auctionHouse: row.auction_house,
      lotNumber: row.lot_number ?? null,
      saleDate: row.sale_date,
      hammerPrice: Number(row.hammer_price),
      buyersPremium: Number(row.buyers_premium),
      currency: row.currency,
      bottles: row.bottles,
      houseCurrency: row.house_currency ?? null,
      exchangeRate: numOrNull(row.exchange_rate),
      houseUnitCost: numOrNull(row.house_unit_cost),
      bookedUnitCost: numOrNull(row.booked_unit_cost),
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

    // The auction house is NOT NULL with a non-blank CHECK; a blank one is the
    // caller's mistake and gets a 400 that names it, not a constraint 500.
    // The lot number is OPTIONAL since 2026-09-21 (founder answer 11): a blank
    // one is recorded as not stated (NULL), never as an empty string.
    const auctionHouse = (dto.auctionHouse ?? "").trim();
    const lotNumber = (dto.lotNumber ?? "").trim() || null;
    if (!auctionHouse) {
      throw new BadRequestException(
        "An auction lot's record needs its auction house. Nothing was recorded.",
      );
    }

    // WHAT THE BOOK WAS GIVEN, IN THE HOUSE'S MONEY (founder answer 10,
    // 2026-09-21): a typed house cost wins, else a stated rate, else the lot's
    // own per-bottle cost when it is in the house's currency — never a
    // looked-up rate. The house's currency is READ here, strictly; the
    // bottles were carried at `bookedUnitCost`, and a record is refused unless
    // that is the figure the stated numbers give, so the record never
    // disagrees with the lot it describes.
    const { data: house, error: houseError } = await this.databaseService.supabase
      .from("restaurants")
      .select("id, currency")
      .eq("id", restaurantId)
      .maybeSingle();
    if (houseError) {
      throw new InternalServerErrorException(
        `The house's currency could not be read (${houseError.message}), so the lot's cost cannot be checked. Nothing was recorded.`,
      );
    }
    const houseCurrency = currencyCode((house as { currency?: string | null } | null)?.currency ?? null);
    const cost = lotBookedCost({
      hammer: dto.hammerPrice,
      premium: dto.buyersPremium,
      bottles: dto.bottles,
      currency: code,
      houseCurrency,
      exchangeRate: dto.exchangeRate ?? null,
      houseUnitCost: dto.houseUnitCost ?? null,
    });
    if (!cost.ok) {
      throw new BadRequestException(`${cost.why} Nothing was recorded.`);
    }
    if (Math.abs(cost.booked - dto.bookedUnitCost) > 0.004) {
      throw new BadRequestException(
        `The bottles were carried in at ${dto.bookedUnitCost} ${houseCurrency} each, but the figures stated for this lot give ${cost.booked} ${houseCurrency}. Nothing was recorded; correct the lot on the item so the two agree.`,
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
        house_currency: houseCurrency,
        exchange_rate: dto.exchangeRate ?? null,
        house_unit_cost: dto.houseUnitCost ?? null,
        booked_unit_cost: cost.booked,
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
