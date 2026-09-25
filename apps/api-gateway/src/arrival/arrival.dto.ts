import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  Allow,
} from "class-validator";
import {
  FOLIOS,
  type Folio,
  type Target,
  type ConfigurationInput,
} from "./arrival-contract";

export class ConfigurationInputDto implements ConfigurationInput {
  @IsIn([
    "currency",
    "cellar",
    "threshold",
    "vendor_terms",
    "vendor_currency",
    "notifications",
    "menu_item",
  ])
  target!: Target;
  @IsString() @MaxLength(50) field!: string;
  // Validated against the closed target/field schema in validateConfiguration.
  @Allow() value!: unknown;
  @IsOptional() @IsUUID() subjectId?: string;
}
export class ProposeBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ConfigurationInputDto)
  rows!: ConfigurationInputDto[];
  @IsIn(["spoken", "inferred", "invoice"]) provenance!:
    | "spoken"
    | "inferred"
    | "invoice";
  @IsOptional() @IsUUID() evidenceId?: string;
}
export class SkipFolioDto {
  @IsIn(FOLIOS) folio!: Folio;
}
export class BatchRevisionDto {
  @IsInt() @Min(0) @Max(1000000) revision!: number;
}
export class EvidenceDto {
  @IsUUID() documentId!: string;
  @IsOptional() @IsUUID() providerId?: string;
}

export class MenuEvidenceDto {
  @IsIn(["scan", "csv"]) method!: "scan" | "csv";
  @IsString() @MaxLength(14000000) content!: string;
  @IsOptional() @IsBoolean() binary?: boolean;
}
