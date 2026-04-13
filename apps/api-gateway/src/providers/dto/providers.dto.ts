import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateProviderDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  companyName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  primaryContact?: Record<string, any>;

  @ApiPropertyOptional()
  @IsArray()
  @IsOptional()
  alternativeContacts?: Record<string, any>[];

  @ApiPropertyOptional()
  @IsOptional()
  address?: Record<string, any>;

  @ApiPropertyOptional()
  @IsArray()
  @IsOptional()
  specialties?: string[];

  @ApiPropertyOptional()
  @IsArray()
  @IsOptional()
  regionsCovered?: string[];

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  minimumOrder?: number;

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  leadTimeDays?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  tier?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateProviderDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  companyName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  primaryContact?: Record<string, any>;

  @ApiPropertyOptional()
  @IsArray()
  @IsOptional()
  alternativeContacts?: Record<string, any>[];

  @ApiPropertyOptional()
  @IsOptional()
  address?: Record<string, any>;

  @ApiPropertyOptional()
  @IsArray()
  @IsOptional()
  specialties?: string[];

  @ApiPropertyOptional()
  @IsArray()
  @IsOptional()
  regionsCovered?: string[];

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  minimumOrder?: number;

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  leadTimeDays?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  tier?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;
}

export class ProviderRatingDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional()
  @IsOptional()
  categories?: Record<string, number>;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  comment?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  orderId?: string;
}

export class ProviderResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  companyName?: string;

  @ApiPropertyOptional()
  primaryContact?: Record<string, any>;

  @ApiPropertyOptional()
  specialties?: string[];

  @ApiPropertyOptional()
  regionsCovered?: string[];

  @ApiPropertyOptional()
  minimumOrder?: number;

  @ApiPropertyOptional()
  leadTimeDays?: number;

  @ApiPropertyOptional()
  reliabilityScore?: number;

  @ApiPropertyOptional()
  tier?: string;

  @ApiPropertyOptional()
  isActive?: boolean;

  @ApiPropertyOptional()
  lastContactDate?: string;

  @ApiPropertyOptional()
  lastContactNotes?: string;
}

// --- Provider Contacts DTOs ---

export class CreateProviderContactDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  role?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isPrimary?: boolean;
}

export class UpdateProviderContactDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  role?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isPrimary?: boolean;
}

export class ProviderContactResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  providerId: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  phone?: string;

  @ApiPropertyOptional()
  role?: string;

  @ApiProperty()
  isPrimary: boolean;
}

// --- Search / Import DTOs ---

export class UpdateContactDateDto {
  @ApiProperty()
  @IsString()
  lastContactDate: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;
}

export class BulkImportProvidersDto {
  @ApiProperty()
  @IsString()
  restaurantId: string;

  @ApiProperty({ type: [CreateProviderDto] })
  @IsArray()
  providers: CreateProviderDto[];
}

export class BulkImportResultDto {
  @ApiProperty()
  imported: number;

  @ApiProperty()
  failed: number;

  @ApiProperty({ type: [String] })
  errors: string[];
}
