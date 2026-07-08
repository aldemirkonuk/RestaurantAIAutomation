import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
} from "class-validator";

export class RetroactiveOrderDto {
  @ApiProperty({ description: "Wine name from invoice" })
  @IsString()
  @IsNotEmpty()
  wineName: string;

  @ApiPropertyOptional({ description: "Quantity from invoice" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional({ description: "Invoice total cost" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  finalConfirmedCost?: number;

  @ApiPropertyOptional({ description: "Invoice date (ISO 8601)" })
  @IsOptional()
  @IsString()
  invoiceDate?: string;

  @ApiPropertyOptional({ description: "Invoice number" })
  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @ApiPropertyOptional({
    description: "Raw invoice email body for order_interactions",
  })
  @IsOptional()
  @IsString()
  rawInvoiceContent?: string;
}
