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
  IsIn,
  Matches,
  Min,
  Max,
  ValidateNested,
} from "class-validator";
import { Type, Transform } from "class-transformer";

// ============================================================================
// ENUMS
// ============================================================================

/**
 * The only values a sender reads for `orders_mode` / `reports_mode`
 * (`scheduled-tasks.service.ts` getEffectiveCategoryMode: "off" silences,
 * "both" adds the email, anything else is in-app). Until 2026-09-16 the DTO
 * took any string, so a typo was stored and then read as "in-app only"
 * (ADR 0147 "Named, not fixed").
 */
export const DELIVERY_MODES = ["both", "in_app", "off"] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

/**
 * The only values the low-stock digest reads for `digest_frequency`
 * (`low-stock-alerts.service.ts` treats "off" as off and "daily" as daily).
 */
export const DIGEST_FREQUENCIES = ["daily", "off"] as const;
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];

/**
 * A 24-hour wall-clock time, `HH:mm`, which is what `<input type="time">`
 * sends and what the readers split on ":" (`low-stock-alerts.service.ts`
 * digestTime, `notification_agent.py` quiet hours). "25:00", "8:00", "noon"
 * and "" were all accepted and stored before 2026-09-16.
 */
export const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const HH_MM_MESSAGE = "$property must be a 24-hour time written HH:mm, e.g. 08:30";

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

  @ApiPropertyOptional({ description: "Start time HH:mm (24-hour)" })
  @IsString()
  @Matches(HH_MM, { message: HH_MM_MESSAGE })
  @IsOptional()
  startTime?: string;

  @ApiPropertyOptional({ description: "End time HH:mm (24-hour)" })
  @IsString()
  @Matches(HH_MM, { message: HH_MM_MESSAGE })
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
    enum: DIGEST_FREQUENCIES,
  })
  @IsIn(DIGEST_FREQUENCIES, {
    message: `$property must be one of: ${DIGEST_FREQUENCIES.join(", ")}`,
  })
  @IsOptional()
  digestFrequency?: DigestFrequency;

  @ApiPropertyOptional({ description: "Daily digest send time HH:mm (24-hour)" })
  @IsString()
  @Matches(HH_MM, { message: HH_MM_MESSAGE })
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

  @ApiPropertyOptional({
    description: "'both' | 'in_app' | 'off'",
    enum: DELIVERY_MODES,
  })
  @IsIn(DELIVERY_MODES, {
    message: `$property must be one of: ${DELIVERY_MODES.join(", ")}`,
  })
  @IsOptional()
  ordersMode?: DeliveryMode;

  @ApiPropertyOptional({
    description: "'both' | 'in_app' | 'off'",
    enum: DELIVERY_MODES,
  })
  @IsIn(DELIVERY_MODES, {
    message: `$property must be one of: ${DELIVERY_MODES.join(", ")}`,
  })
  @IsOptional()
  reportsMode?: DeliveryMode;
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
