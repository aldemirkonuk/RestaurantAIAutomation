import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class SeatDto {
  @IsUUID()
  tableId!: string;

  /** E9: optional, never guessed. Omitted = NULL. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  partySize?: number;
}

export class LeaveDto {
  @IsOptional()
  @IsBoolean()
  confirmShort?: boolean;
}

export class FoodUpDto {
  @IsUUID()
  tableId!: string;

  @IsOptional()
  @IsIn(["drinks", "starters", "mains", "dessert", "other"])
  course?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  note?: string;
}

export class OnBreakDto {
  @IsOptional()
  @IsUUID()
  coverUserId?: string;
}

export class SectionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sort?: number;
}

export class SectionUpdateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sort?: number;
}

export class SectionTablesDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID("all", { each: true })
  tableIds!: string[];
}

export class AssignDto {
  @IsUUID()
  userId!: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsUUID()
  tableId?: string;
}

export class ReassignProposeDto {
  @IsUUID()
  fromUserId!: string;
}

export class ReassignMoveDto {
  @IsUUID()
  tableId!: string;

  @IsUUID()
  toUserId!: string;
}

export class ReassignApplyDto {
  @IsUUID()
  fromUserId!: string;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReassignMoveDto)
  moves!: ReassignMoveDto[];
}

export class FloorSettingsDto {
  @IsInt()
  @Min(1)
  @Max(120)
  warnAfterMin!: number;

  @IsInt()
  @Min(2)
  @Max(240)
  lateAfterMin!: number;
}

export class OutTonightDto {
  @IsOptional()
  @IsUUID()
  menuItemId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label?: string;
}

export class ConfirmLinkDto {
  /** The member this till name is. Omitted = the proposed person. */
  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class ReportQueryDto {
  /** YYYY-MM-DD, a house-local service date. Omitted = today's. */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  date?: string;
}

/** A new table (ADR 0347 D3). Anything left out is stored as NULL (D4). */
export class CreateTableDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  seats?: number;

  @IsOptional()
  @IsBoolean()
  is_outdoor?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  x_pos?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  y_pos?: number;

  @IsOptional()
  @IsIn(["round", "rect"])
  shape?: string;
}

/**
 * A change to one table (ADR 0347 D6). `null` clears seats, shape or a
 * coordinate; `tray: true` clears the place (D5). The names match the web
 * client's `TablePatch`.
 */
export class TablePatchDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label?: string;

  @IsOptional()
  @IsBoolean()
  hidden?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  seats?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  x_pos?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  y_pos?: number | null;

  @IsOptional()
  @IsIn(["round", "rect"])
  shape?: string | null;

  @IsOptional()
  @IsBoolean()
  tray?: boolean;
}

/**
 * 2 to 8 tables. The checker's mergeTables took exactly 2; taking up to 8 is
 * the executor's reading under OD-242 (a long table is several pushed
 * together), and a pair is still the only shape given an orientation.
 */
export class MergeDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(8)
  @IsUUID("all", { each: true })
  tableIds!: string[];
}
