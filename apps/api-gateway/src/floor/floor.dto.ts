import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
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
