import { IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateWineSubmissionDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  producer!: string;

  @IsOptional()
  @Transform(({ value }) => (value === null || value === undefined ? undefined : Number(value)))
  @IsNumber()
  vintage?: number | null;

  @IsOptional()
  @Transform(({ value }) => (value === null || value === undefined ? undefined : Number(value)))
  @IsNumber()
  priceReference?: number | null;

  @IsOptional()
  @IsString()
  primaryType?: string;

  @IsOptional()
  @IsString()
  grapeVariety?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  appellation?: string;

  @IsOptional()
  @IsString()
  subRegion?: string;

  @IsOptional()
  @IsObject()
  wineStructure?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  sensoryProfile?: Record<string, unknown>;

  @IsOptional()
  @Transform(({ value }) => (value === null || value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(50)
  @Max(18000)
  bottleSizeMl?: number;
}

export class SubmissionListQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class ProcessSubmissionsDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
