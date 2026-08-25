import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { Type } from "class-transformer";

export class MatchVendorsDto {
  @ApiPropertyOptional({
    description:
      "Vendor name as typed so far, matched against the curated catalogue by trigram similarity.",
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({
    description:
      "Vendor address as typed so far. Optional second signal — a match on address alone (e.g. a DBA name) still surfaces.",
  })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({
    description: "Restrict candidates to this country (ISO alpha-2).",
  })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiPropertyOptional({
    description: "Max candidates to return (default: 5, max: 10)",
    default: 5,
  })
  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  @Type(() => Number)
  limit?: number;
}
