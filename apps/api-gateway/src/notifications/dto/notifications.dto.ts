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
  IsEmail,
  IsNotEmpty,
  ArrayMinSize,
  ArrayMaxSize,
  Matches,
  MaxLength,
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

// ============================================================================
// POST /notifications/send-email — the house writes to its own people
// ============================================================================

/** Trim a string field before it is validated; leave anything else alone. */
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;
/** Trim every string in an address list; leave anything else alone. */
const trimmedList = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((v) => (typeof v === "string" ? v.trim() : v))
    : value;

/**
 * An address that can only ever be ONE address in ONE header.
 *
 * `@IsEmail` alone is not enough: it accepts a quoted local part, and a quoted
 * local part may carry CR/LF — measured 2026-09-17,
 * `isEmail('"a\r\nBcc: x@evil.test"@vendor.test') === true` — while
 * `GmailService.createMimeMessage` joins To/Cc/Bcc into the header block. So
 * any book entry spelled that way (a vendor contact a manager typed, or a
 * `users.email` written through the unvalidated register body) could add
 * hidden recipients outside the book that the audit counts would never show.
 * Refused here: whitespace, control characters, quotes, backslashes, angle
 * brackets, commas and semicolons. No address in a house's book needs any of
 * them. The mail sender refuses a line break in any header on its own as well.
 */
// The control-character range is the point: refusing CR/LF and friends in an
// address is this pattern's job.
// eslint-disable-next-line no-control-regex
const SINGLE_ADDRESS = /^[^\s\u0000-\u001f\u007f"\\<>,;]+$/;

/**
 * The body of the one notification sender still reachable over HTTP
 * (ADR 0149 answer 15, 2026-09-16). Who may send and to whom is decided by
 * `HouseEmailService` from the token, never from this body: the addresses named
 * here are only REQUESTS, each checked against the house's own members and its
 * vendors' contacts.
 *
 * Until 2026-09-16 this was an inline type with no validation at all: any
 * string reached Gmail as a recipient, and a subject carrying CR/LF reached the
 * MIME header block unescaped (`gmail.service.ts` createMimeMessage).
 */
export class SendHouseEmailDto {
  @ApiProperty({ type: [String], description: "Recipients (1-50)" })
  @Transform(trimmedList)
  @IsArray()
  @ArrayMinSize(1, {
    message:
      "Name at least one recipient. Mudavym sends only to this house's members and the contacts in its vendor book.",
  })
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true, message: "Every recipient must be an email address" })
  @Matches(SINGLE_ADDRESS, {
    each: true,
    message:
      "A recipient may not contain spaces, line breaks, quotes, angle brackets, commas or semicolons",
  })
  to: string[];

  @ApiPropertyOptional({ type: [String] })
  @Transform(trimmedList)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true, message: "Every cc address must be an email address" })
  @Matches(SINGLE_ADDRESS, {
    each: true,
    message:
      "A cc address may not contain spaces, line breaks, quotes, angle brackets, commas or semicolons",
  })
  cc?: string[];

  @ApiPropertyOptional({ type: [String] })
  @Transform(trimmedList)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true, message: "Every bcc address must be an email address" })
  @Matches(SINGLE_ADDRESS, {
    each: true,
    message:
      "A bcc address may not contain spaces, line breaks, quotes, angle brackets, commas or semicolons",
  })
  bcc?: string[];

  @ApiProperty()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: "The email needs a subject" })
  @MaxLength(300)
  @Matches(/^[^\r\n]*$/, { message: "The subject must be a single line" })
  subject: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: "The email has no body" })
  @MaxLength(500_000)
  body_html: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  body_text?: string;
}
