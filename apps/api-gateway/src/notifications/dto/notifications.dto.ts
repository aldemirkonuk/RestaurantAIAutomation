import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsInt,
  IsArray,
  IsUUID,
  IsObject,
  Min,
  Max,
  ValidateNested,
} from "class-validator";
import { Type, Transform } from "class-transformer";

// ============================================================================
// ENUMS
// ============================================================================

export enum NotificationType {
  INVENTORY_LOW_STOCK = "inventory_low_stock",
  ORDER_PENDING = "order_pending",
  ORDER_DELIVERED = "order_delivered",
  PRICE_CHANGE = "price_change",
  DELIVERY_SCHEDULED = "delivery_scheduled",
  CALENDAR_REMINDER = "calendar_reminder",
  SYSTEM = "system",
  AI_SUGGESTION = "ai_suggestion",
  DRAFT_READY = "draft_ready",
  CONSTRAINT_TRIGGERED = "constraint_triggered",
  UNKNOWN_SENDER = "unknown_sender",
  INVOICE_RECEIVED = "invoice_received",
}

export enum NotificationStatus {
  UNREAD = "unread",
  READ = "read",
  ARCHIVED = "archived",
}

export enum NotificationPriority {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

// ============================================================================
// QUERY DTOs
// ============================================================================

export class GetNotificationsQueryDto {
  @ApiPropertyOptional({
    description:
      "Ignored unless it names the caller: the token decides the user",
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: "Restaurant ID filter" })
  @IsUUID()
  @IsOptional()
  restaurantId?: string;

  @ApiPropertyOptional({ enum: NotificationType })
  @IsOptional()
  type?: string;

  @ApiPropertyOptional({ enum: NotificationStatus })
  @IsEnum(NotificationStatus)
  @IsOptional()
  status?: NotificationStatus;

  @ApiPropertyOptional({ description: "Filter from date (ISO)" })
  @IsString()
  @IsOptional()
  dateFrom?: string;

  @ApiPropertyOptional({ description: "Filter to date (ISO)" })
  @IsString()
  @IsOptional()
  dateTo?: string;

  @ApiPropertyOptional({ default: 1 })
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}

export class GetUnreadQueryDto {
  @ApiPropertyOptional({
    description:
      "Ignored unless it names the caller: the token decides the user",
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: "Restaurant ID filter" })
  @IsUUID()
  @IsOptional()
  restaurantId?: string;

  @ApiPropertyOptional({ default: 50 })
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}

export class GetUnreadCountQueryDto {
  @ApiPropertyOptional({
    description:
      "Ignored unless it names the caller: the token decides the user",
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: "Restaurant ID filter" })
  @IsUUID()
  @IsOptional()
  restaurantId?: string;
}

export class GetPreferencesQueryDto {
  // The user comes from the token. A supplied id is accepted only when it names
  // the caller (the web client sends its own); any other id is a 403.
  @ApiPropertyOptional({
    description:
      "Optional. Must equal the signed-in user's id if sent; the token decides.",
  })
  @IsUUID()
  @IsOptional()
  userId?: string;
}

export class GetHistoryQueryDto {
  @ApiPropertyOptional({
    description:
      "Ignored unless it names the caller: the token decides the user",
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ default: 30 })
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  days?: number;
}

export class MarkAllReadQueryDto {
  @ApiPropertyOptional({
    description:
      "Ignored unless it names the caller: the token decides the user",
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: "Restaurant ID filter" })
  @IsUUID()
  @IsOptional()
  restaurantId?: string;
}

export class DeleteAllReadQueryDto {
  @ApiPropertyOptional({
    description:
      "Ignored unless it names the caller: the token decides the user",
  })
  @IsOptional()
  @IsUUID()
  userId?: string;
}

// ============================================================================
// BODY DTOs
// ============================================================================

export class BulkIdsDto {
  @ApiProperty({ description: "Array of notification IDs", type: [String] })
  @IsArray()
  @IsUUID("4", { each: true })
  ids: string[];
}

export class QuietHoursDto {
  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @ApiPropertyOptional({ description: "Start time HH:mm" })
  @IsString()
  @IsOptional()
  startTime?: string;

  @ApiPropertyOptional({ description: "End time HH:mm" })
  @IsString()
  @IsOptional()
  endTime?: string;
}

export class CategoriesDto {
  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  inventory?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  orders?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  calendar?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  system?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  ai?: boolean;
}

export class LowStockPrefsDto {
  @ApiPropertyOptional({ description: "Master switch for low-stock alerts" })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: "Alert the moment a wine first crosses par",
  })
  @IsBoolean()
  @IsOptional()
  instantFirstAlert?: boolean;

  @ApiPropertyOptional({ description: "Critical (≤50% par) sends immediately" })
  @IsBoolean()
  @IsOptional()
  criticalImmediate?: boolean;

  @ApiPropertyOptional({
    description: "'daily' | 'off' — reminder for still-low wines",
  })
  @IsString()
  @IsOptional()
  digestFrequency?: string;

  @ApiPropertyOptional({ description: "Daily digest send time HH:mm" })
  @IsString()
  @IsOptional()
  digestTime?: string;
}

export class UpdatePreferencesDto {
  // Kept whitelisted so the web client's body (which carries its own id) still
  // passes forbidNonWhitelisted. The token decides; a different id is a 403.
  @ApiPropertyOptional({
    description:
      "Optional. Must equal the signed-in user's id if sent; the token decides.",
  })
  @IsUUID()
  @IsOptional()
  userId?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  email?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  push?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  sms?: boolean;

  @ApiPropertyOptional()
  @ValidateNested()
  @Type(() => CategoriesDto)
  @IsOptional()
  categories?: CategoriesDto;

  @ApiPropertyOptional()
  @ValidateNested()
  @Type(() => QuietHoursDto)
  @IsOptional()
  quietHours?: QuietHoursDto;

  @ApiPropertyOptional()
  @ValidateNested()
  @Type(() => LowStockPrefsDto)
  @IsOptional()
  lowStock?: LowStockPrefsDto;

  @ApiPropertyOptional({ description: "'both' | 'in_app' | 'off'" })
  @IsString()
  @IsOptional()
  ordersMode?: string;

  @ApiPropertyOptional({ description: "'both' | 'in_app' | 'off'" })
  @IsString()
  @IsOptional()
  reportsMode?: string;
}

export class PushSubscribeDto {
  @ApiPropertyOptional({
    description:
      "Ignored unless it names the caller: the token decides the user",
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiProperty({ description: "Web Push subscription object" })
  @IsObject()
  subscription: Record<string, any>;
}

export class PushUnsubscribeDto {
  @ApiPropertyOptional({
    description:
      "Ignored unless it names the caller: the token decides the user",
  })
  @IsOptional()
  @IsUUID()
  userId?: string;
}
