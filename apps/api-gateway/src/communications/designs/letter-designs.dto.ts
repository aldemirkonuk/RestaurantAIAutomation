import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class CreateLetterDesignDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiProperty({ description: "One of the vendor letter purposes." })
  @IsString()
  @MaxLength(60)
  purpose: string;

  @ApiPropertyOptional({ description: "Starting blocks; checked against the block catalogue." })
  @IsOptional()
  @IsArray()
  blocks?: unknown[];
}

export class UpdateLetterDesignDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  purpose?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  look?: string;

  @ApiPropertyOptional({ description: "The whole draft block list; checked against the catalogue." })
  @IsOptional()
  @IsArray()
  blocks?: unknown[];
}

export class RestoreLetterDesignDto {
  @ApiProperty({ description: "A published version number to copy back into the draft." })
  @IsInt()
  @Min(1)
  version: number;
}
