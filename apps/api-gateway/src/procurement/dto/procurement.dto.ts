import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum ProcurementOrderStatus {
  PENDING = 'PENDING',
  APPROVAL_NEEDED = 'APPROVAL_NEEDED',
  NEGOTIATING = 'NEGOTIATING',
  APPROVED = 'APPROVED',
  CONFIRMED = 'CONFIRMED',
  IN_TRANSIT = 'IN_TRANSIT',
  DELIVERED = 'DELIVERED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
}

export class CreateOrderDto {
  @ApiProperty()
  @IsString()
  inventoryId: string;

  @ApiProperty()
  @IsString()
  providerId: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  unitType?: string;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  quotedPrice?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  negotiatedPrice?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  finalPrice?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  totalCost?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isEmergency?: boolean;

  @ApiPropertyOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  priorityLevel?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  expectedDeliveryDate?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  managerNotes?: string;
}

export class UpdateOrderDto {
  @ApiPropertyOptional({ enum: ProcurementOrderStatus })
  @IsEnum(ProcurementOrderStatus)
  @IsOptional()
  status?: ProcurementOrderStatus;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  quotedPrice?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  negotiatedPrice?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  finalPrice?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  totalCost?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  managerNotes?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  rejectionReason?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  deliveryNotes?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  trackingNumber?: string;

  @ApiPropertyOptional()
  @IsInt()
  @IsOptional()
  quantityReceived?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  priceVerified?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  invoiceImageUrl?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  discrepancyNotes?: string;
}

export class OrderFilterDto {
  @ApiPropertyOptional({ enum: ProcurementOrderStatus })
  @IsEnum(ProcurementOrderStatus)
  @IsOptional()
  status?: ProcurementOrderStatus;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  providerId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  dateTo?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsString()
  @IsOptional()
  sortOrder?: string;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}

export class OrderResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  orderNumber: string;

  @ApiProperty()
  restaurantId: string;

  @ApiProperty()
  inventoryId: string;

  @ApiProperty()
  providerId: string;

  @ApiProperty()
  quantity: number;

  @ApiPropertyOptional()
  unitType?: string;

  @ApiPropertyOptional()
  bottlesTotal?: number;

  @ApiPropertyOptional()
  quotedPrice?: number;

  @ApiPropertyOptional()
  negotiatedPrice?: number;

  @ApiPropertyOptional()
  finalPrice?: number;

  @ApiPropertyOptional()
  totalCost?: number;

  @ApiProperty({ enum: ProcurementOrderStatus })
  status: ProcurementOrderStatus;

  @ApiPropertyOptional()
  requestedAt?: string;

  @ApiPropertyOptional()
  approvedAt?: string;

  @ApiPropertyOptional()
  deliveredAt?: string;

  @ApiPropertyOptional()
  completedAt?: string;

  @ApiPropertyOptional()
  isEmergency?: boolean;

  @ApiPropertyOptional()
  priorityLevel?: number;

  @ApiPropertyOptional()
  wineName?: string;
}

export class OrderListResponseDto {
  @ApiProperty({ type: [OrderResponseDto] })
  orders: OrderResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  hasMore: boolean;
}
