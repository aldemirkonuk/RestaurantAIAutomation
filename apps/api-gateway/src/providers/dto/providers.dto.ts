import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from "class-validator";

export class CreateProviderDto {
  @ApiPropertyOptional({
    description:
      "UUID of a vendor_catalogue entry. When provided, provider details are auto-filled from the catalogue.",
  })
  @IsUUID()
  @IsOptional()
  catalogue_vendor_id?: string;

  @ApiPropertyOptional({
    description: "Required when catalogue_vendor_id is not provided.",
  })
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
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({
    description:
      "Vendor type (distributor, importer, wholesaler, winery_direct, broker, other)",
  })
  @IsString()
  @IsOptional()
  type?: string;

  @ApiPropertyOptional({ description: "Vendor phone number" })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ description: "Vendor email address" })
  @IsString()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ description: "Vendor website URL" })
  @IsString()
  @IsOptional()
  website?: string;

  @ApiPropertyOptional({ description: "Primary contact name at the vendor" })
  @IsString()
  @IsOptional()
  contactName?: string;
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
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  contactFirstName?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  contactLastName?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  website?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  physicalAddress?: string;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  rating?: number;

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

  @ApiPropertyOptional({ description: "Payment terms (e.g. Net 30, COD)" })
  @IsString()
  @IsOptional()
  paymentTerms?: string;

  @ApiPropertyOptional({
    description:
      "Vendor type (distributor, importer, wholesaler, winery_direct, broker, other)",
  })
  @IsString()
  @IsOptional()
  type?: string;
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
  phone?: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  contactFirstName?: string;

  @ApiPropertyOptional()
  contactLastName?: string;

  @ApiPropertyOptional()
  physicalAddress?: string;

  @ApiPropertyOptional()
  website?: string;

  @ApiPropertyOptional()
  rating?: number;

  @ApiPropertyOptional()
  notes?: string;

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

  @ApiPropertyOptional({
    description:
      "UUID of the linked vendor_catalogue entry, null for custom vendors",
  })
  catalogueVendorId?: string | null;

  @ApiPropertyOptional({
    description:
      "True if this provider was manually created; false if sourced from catalogue",
  })
  isCustom?: boolean;

  @ApiPropertyOptional({ description: "Payment terms (e.g. Net 30, COD)" })
  paymentTerms?: string;

  @ApiPropertyOptional({
    description: "Business type: Distributor, Importer, Wholesaler, etc.",
  })
  primaryBusinessType?: string;

  @ApiPropertyOptional({
    description: "Known personnel / contacts (legacy array)",
  })
  knownPersonnel?: string[];
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

// --- Provider Locations DTOs ---

export class CreateProviderLocationDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: "office | warehouse | store | other" })
  @IsString()
  @IsOptional()
  type?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isPrimary?: boolean;
}

export class UpdateProviderLocationDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: "office | warehouse | store | other" })
  @IsString()
  @IsOptional()
  type?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isPrimary?: boolean;
}
