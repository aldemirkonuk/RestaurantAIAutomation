import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { Transform, Type } from "class-transformer";

export class SearchVendorsDto {
  @ApiPropertyOptional({
    description:
      "Include unverified rows ingested from official permit registries. " +
      "Defaults to false so this endpoint returns only human-curated vendors.",
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === true || value === "true" || value === "1")
  includeRegistry?: boolean;

  @ApiPropertyOptional({
    description: "Search term for vendor name or specialties",
  })
  @IsString()
  @IsOptional()
  q?: string;

  @ApiPropertyOptional({
    description: "Filter by country (default: US)",
    default: "US",
  })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiPropertyOptional({
    description:
      "Filter by vendor type (distributor, importer, wholesaler, etc.)",
  })
  @IsString()
  @IsOptional()
  type?: string;

  @ApiPropertyOptional({
    description: "Max results to return (default: 20, max: 50)",
    default: 20,
  })
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({
    description: "Pagination offset (default: 0)",
    default: 0,
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  offset?: number;
}
