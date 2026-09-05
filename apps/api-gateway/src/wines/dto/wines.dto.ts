import {
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from "class-validator";
import { Transform } from "class-transformer";

export class GetWinesQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  ids?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  minPrice?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  maxPrice?: number;

  @IsOptional()
  @IsIn(["name", "price", "vintage", "type"])
  sortBy?: "name" | "price" | "vintage" | "type";

  @IsOptional()
  @IsIn(["asc", "desc"])
  sortOrder?: "asc" | "desc";

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  offset?: number;
}

export class WineMetaQueryDto {
  @IsOptional()
  @IsString()
  country?: string;
}

export class WineSuggestionsQueryDto {
  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(1)
  limit?: number;
}

export class SimilarWinesQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(1)
  limit?: number;
}

export class WineSubmissionDto {
  @IsObject()
  payload!: Record<string, any>;
}

export class ProcessWineSubmissionsDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(1)
  limit?: number;
}

export class GetWineSubmissionsQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  offset?: number;
}

/**
 * One library row, as every wine read returns it.
 *
 * WHY THIS CLASS EXISTS (2026-09-05, the founder's batch-57 answer: *"the
 * library DTO/type mirrors it (scripts/check_web_reads_gateway_dto_keys.py
 * pins the web type)"*)
 * ---------------------------------------------------------------------------
 * `WinesService.mapWine` returns an object literal, and the web's `Wine`
 * interface is hand-written prose about that literal. Nothing connected the
 * two, so a key the web declared and the server never sent would type-check
 * forever — the exact defect that guard was built for after `Order` declared
 * `unitPrice` and `totalPrice` that `GET /procurement/orders` has never sent.
 *
 * The consequence is never a crash. `formatMoney(undefined)` returns `"$0"`,
 * and a phantom `abvPercent` would silently read as "no strength stated" on
 * every bottle — which is exactly the state a person typing a strength is
 * trying to leave. So this class is the mirror the guard pins `Wine` against,
 * and it is written out by hand rather than inferred, because the two types do
 * not share a name.
 *
 * Every property is OPTIONAL and that is deliberate rather than lazy:
 * `mapWine` sets several only when the query selected the column, and the
 * codebase's own rule is that `undefined` (never asked) and `null` (asked, and
 * the publisher had nothing) are different facts.
 */
export class WineResponseDto {
  id?: string;
  name?: string;
  /** Full descriptive name, derived server-side. Present only when selected. */
  displayName?: string;
  producer?: string;
  vintage?: number;
  /** `price_reference`, or 0. The library's own reference price. */
  price?: number;
  retailPriceAvg?: number;
  bottleSizeMl?: number;
  bottleSizeOz?: number;
  /**
   * Alcohol by volume, as a percentage, typed by a person onto the shared
   * library row. `undefined` means nobody has stated one; `0` is a real
   * answer. Never defaulted and never inferred from a category — it is the
   * multiplicand in a duty figure.
   */
  abvPercent?: number;
  category?: string;
  region?: string;
  country?: string;
  appellation?: string;
  grapeVariety?: string;
  description?: string;
  tastingNotes?: string;
  /**
   * Declared by the web's `Wine` and NOT SENT by `mapWine` today. Kept here
   * rather than deleted from the client type, because the guard's direction is
   * client-key-must-exist-on-the-DTO and the honest fix for an unsent field is
   * to send it, not to hide the gap. Filed in the page notes rather than
   * papered over.
   */
  pairingNotes?: string;
  /** Same as `pairingNotes`: declared by the client, not yet sent. */
  imageUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  /** Carried by `mapWine` and not yet declared by the web. */
  beverageKind?: string;
  /** Carried by `mapWine` and not yet declared by the web. */
  classificationStatus?: string;
}
