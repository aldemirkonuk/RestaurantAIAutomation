import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsUUID, IsObject, IsDateString } from 'class-validator';

export enum OneTapActionType {
  LOW_STOCK = 'low_stock',
  PRICE_CHANGE = 'price_change',
  DELIVERY_CONFIRM = 'delivery_confirm',
  INEQUALITY = 'inequality',
  VINTAGE_SUB = 'vintage_sub',
  STOCK_RECEIPT = 'stock_receipt',
  CUSTOM = 'custom',
  GMAIL_SEND = 'gmail_send',
  GMAIL_CONTEXTUAL = 'gmail_contextual',
}

export enum OneTapActionStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

export enum OneTapPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export class CreateOneTapActionDto {
  @ApiProperty({ description: 'Action title' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ description: 'Action description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Action URL to navigate to' })
  @IsString()
  @IsOptional()
  actionUrl?: string;

  @ApiPropertyOptional({ enum: OneTapActionType, default: OneTapActionType.CUSTOM })
  @IsEnum(OneTapActionType)
  @IsOptional()
  actionType?: OneTapActionType;

  @ApiPropertyOptional({ enum: OneTapPriority, default: OneTapPriority.MEDIUM })
  @IsEnum(OneTapPriority)
  @IsOptional()
  priority?: OneTapPriority;

  @ApiPropertyOptional({ description: 'Color theme', default: 'wine' })
  @IsString()
  @IsOptional()
  color?: string;

  @ApiPropertyOptional({ description: 'Icon name', default: 'Zap' })
  @IsString()
  @IsOptional()
  icon?: string;

  @ApiPropertyOptional({ description: 'Related wine ID' })
  @IsUUID()
  @IsOptional()
  relatedWineId?: string;

  @ApiPropertyOptional({ description: 'Related order ID' })
  @IsUUID()
  @IsOptional()
  relatedOrderId?: string;

  @ApiPropertyOptional({ description: 'Related provider ID' })
  @IsUUID()
  @IsOptional()
  relatedProviderId?: string;

  @ApiPropertyOptional({ description: 'Additional metadata' })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Expiration date' })
  @IsDateString()
  @IsOptional()
  expiresAt?: string;
}

export class UpdateOneTapActionDto {
  @ApiPropertyOptional({ description: 'Action title' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ description: 'Action description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Action URL' })
  @IsString()
  @IsOptional()
  actionUrl?: string;

  @ApiPropertyOptional({ enum: OneTapPriority })
  @IsEnum(OneTapPriority)
  @IsOptional()
  priority?: OneTapPriority;

  @ApiPropertyOptional({ description: 'Color theme' })
  @IsString()
  @IsOptional()
  color?: string;

  @ApiPropertyOptional({ description: 'Icon name' })
  @IsString()
  @IsOptional()
  icon?: string;

  @ApiPropertyOptional({ enum: OneTapActionStatus })
  @IsEnum(OneTapActionStatus)
  @IsOptional()
  status?: OneTapActionStatus;

  @ApiPropertyOptional({ description: 'Additional metadata' })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}

export class ExecuteActionDto {
  @ApiPropertyOptional({ description: 'Execution result data' })
  @IsObject()
  @IsOptional()
  result?: Record<string, any>;
}

export class OneTapActionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  restaurantId: string;

  @ApiPropertyOptional()
  userId?: string;

  @ApiProperty({ enum: OneTapActionType })
  actionType: OneTapActionType;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiPropertyOptional()
  actionUrl?: string;

  @ApiProperty({ enum: OneTapPriority })
  priority: OneTapPriority;

  @ApiProperty()
  color: string;

  @ApiProperty()
  icon: string;

  @ApiProperty({ enum: OneTapActionStatus })
  status: OneTapActionStatus;

  @ApiPropertyOptional()
  relatedWineId?: string;

  @ApiPropertyOptional()
  relatedOrderId?: string;

  @ApiPropertyOptional()
  relatedProviderId?: string;

  @ApiPropertyOptional()
  metadata?: Record<string, any>;

  @ApiPropertyOptional()
  executedAt?: string;

  @ApiPropertyOptional()
  executedBy?: string;

  @ApiPropertyOptional()
  executionResult?: Record<string, any>;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  @ApiPropertyOptional()
  expiresAt?: string;
}

export class OneTapActionListResponseDto {
  @ApiProperty({ type: [OneTapActionResponseDto] })
  actions: OneTapActionResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  pending: number;

  @ApiProperty()
  completed: number;
}
