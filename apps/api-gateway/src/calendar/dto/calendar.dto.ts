import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsInt,
  IsArray,
  IsDateString,
  IsUUID,
  Min,
  Max,
  ValidateNested,
  IsObject,
} from "class-validator";
import { Transform, Type } from "class-transformer";

// ============================================================================
// ENUMS
// ============================================================================

export enum RecurrenceFrequency {
  DAILY = "daily",
  WEEKLY = "weekly",
  MONTHLY = "monthly",
  YEARLY = "yearly",
  CUSTOM = "custom",
}

export enum RecurrenceEndType {
  NEVER = "never",
  AFTER_COUNT = "after_count",
  ON_DATE = "on_date",
}

export enum CalendarEventStatus {
  PENDING = "pending",
  APPROVED = "approved",
  DISMISSED = "dismissed",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
}

export enum CalendarEventType {
  DELIVERY = "delivery",
  ORDER = "order",
  MEETING = "meeting",
  INVENTORY = "inventory",
  TASTING = "tasting",
  REMINDER = "reminder",
  RECURRING = "recurring",
  CUSTOM = "custom",
  PROVIDER_BIRTHDAY = "provider_birthday",
  HOLIDAY = "holiday",
  DELIVERY_ETA = "delivery_eta",
  PROVIDER_UNAVAILABLE = "provider_unavailable",
  INVENTORY_COUNT = "inventory_count",
  HIGH_VOLUME_EXPECTED = "high_volume_expected",
}

export enum CalendarEventSource {
  MANUAL = "manual",
  AI_DETECTED = "ai_detected",
  SYSTEM_GENERATED = "system_generated",
  ORDER = "order",
  COMMUNICATIONS = "communications",
}

// ============================================================================
// RECURRENCE RULE DTO
// ============================================================================

export class RecurrenceRuleDto {
  @ApiProperty({ enum: RecurrenceFrequency })
  @IsEnum(RecurrenceFrequency)
  frequency: RecurrenceFrequency;

  @ApiPropertyOptional({ default: 1 })
  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  interval?: number;

  @ApiPropertyOptional({
    description: "Days of week (0=Sunday, 6=Saturday)",
    type: [Number],
  })
  @IsArray()
  @IsInt({ each: true })
  @IsOptional()
  daysOfWeek?: number[];

  @ApiPropertyOptional({ description: "Day of month (1-31)" })
  @IsInt()
  @Min(1)
  @Max(31)
  @IsOptional()
  dayOfMonth?: number;

  @ApiPropertyOptional({ description: "Week of month (1-5)" })
  @IsInt()
  @Min(1)
  @Max(5)
  @IsOptional()
  weekOfMonth?: number;

  @ApiPropertyOptional({ description: "Month of year (1-12)" })
  @IsInt()
  @Min(1)
  @Max(12)
  @IsOptional()
  monthOfYear?: number;

  @ApiProperty({ enum: RecurrenceEndType, default: RecurrenceEndType.NEVER })
  @IsEnum(RecurrenceEndType)
  endType: RecurrenceEndType;

  @ApiPropertyOptional({
    description: "Number of occurrences (if endType is after_count)",
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  endAfterCount?: number;

  @ApiPropertyOptional({ description: "End date (if endType is on_date)" })
  @IsDateString()
  @IsOptional()
  endOnDate?: string;
}

// ============================================================================
// CREATE CALENDAR EVENT DTO
// ============================================================================

export class CreateCalendarEventDto {
  @ApiProperty()
  @IsString()
  title: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ enum: CalendarEventType })
  @IsEnum(CalendarEventType)
  eventType: CalendarEventType;

  @ApiProperty({ description: "Event date (YYYY-MM-DD)" })
  @IsDateString()
  eventDate: string;

  @ApiPropertyOptional({ description: "End date for multi-day events" })
  @IsDateString()
  @IsOptional()
  eventDateEnd?: string;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  allDay?: boolean;

  @ApiPropertyOptional({ description: "Event time (HH:MM)" })
  @IsString()
  @IsOptional()
  eventTime?: string;

  @ApiPropertyOptional({ description: "Event end time (HH:MM)" })
  @IsString()
  @IsOptional()
  eventTimeEnd?: string;

  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  providerId?: string;

  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  orderId?: string;

  @ApiPropertyOptional({
    enum: CalendarEventSource,
    default: CalendarEventSource.MANUAL,
  })
  @IsEnum(CalendarEventSource)
  @IsOptional()
  source?: CalendarEventSource;

  @ApiPropertyOptional({
    enum: CalendarEventStatus,
    default: CalendarEventStatus.PENDING,
  })
  @IsEnum(CalendarEventStatus)
  @IsOptional()
  status?: CalendarEventStatus;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  reminderEnabled?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsInt()
  @Min(0)
  @Max(30)
  @IsOptional()
  reminderDaysBefore?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  color?: string;

  @ApiPropertyOptional({ description: "Recurrence rule for recurring events" })
  @ValidateNested()
  @Type(() => RecurrenceRuleDto)
  @IsOptional()
  recurrence?: RecurrenceRuleDto;
}

// ============================================================================
// UPDATE CALENDAR EVENT DTO
// ============================================================================

export class UpdateCalendarEventDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: CalendarEventType })
  @IsEnum(CalendarEventType)
  @IsOptional()
  eventType?: CalendarEventType;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  eventDate?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  eventDateEnd?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  allDay?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  eventTime?: string;

  @ApiPropertyOptional({ description: "Event end time (HH:MM)" })
  @IsString()
  @IsOptional()
  eventTimeEnd?: string;

  @ApiPropertyOptional({ enum: CalendarEventStatus })
  @IsEnum(CalendarEventStatus)
  @IsOptional()
  status?: CalendarEventStatus;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  reminderEnabled?: boolean;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  @IsOptional()
  reminderDaysBefore?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  color?: string;

  @ApiPropertyOptional({ description: "For recurring events: update scope" })
  @IsEnum(["this", "this_and_future", "all"])
  @IsOptional()
  updateScope?: "this" | "this_and_future" | "all";
}

// ============================================================================
// QUERY DTOs
// ============================================================================

export class GetCalendarEventsQueryDto {
  @ApiPropertyOptional({ description: "Start date (YYYY-MM-DD)" })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: "End date (YYYY-MM-DD)" })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ enum: CalendarEventType })
  @IsEnum(CalendarEventType)
  @IsOptional()
  eventType?: CalendarEventType;

  @ApiPropertyOptional({ enum: CalendarEventStatus })
  @IsEnum(CalendarEventStatus)
  @IsOptional()
  status?: CalendarEventStatus;

  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  providerId?: string;

  // Query strings arrive as strings. The global ValidationPipe runs with
  // `transform: true` but WITHOUT `enableImplicitConversion` (main.ts:51-57),
  // so without these explicit converters `?limit=50` stays the string "50",
  // fails `@IsInt()` and 400s the whole read. `@Type(() => Boolean)` would be
  // wrong here — `Boolean("false")` is `true` — hence the explicit
  // `@Transform`, which leaves anything that is not a recognised boolean
  // literal untouched so `@IsBoolean()` still rejects it.
  @ApiPropertyOptional({ default: false })
  @Transform(({ value }) => {
    if (value === "true" || value === true) return true;
    if (value === "false" || value === false) return false;
    return value;
  })
  @IsBoolean()
  @IsOptional()
  includeRecurring?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  @IsOptional()
  limit?: number;
}

// ============================================================================
// RESPONSE DTOs
// ============================================================================

export class RecurrenceRuleResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: RecurrenceFrequency })
  frequency: RecurrenceFrequency;

  @ApiProperty()
  interval: number;

  @ApiPropertyOptional()
  daysOfWeek?: number[];

  @ApiPropertyOptional()
  dayOfMonth?: number;

  @ApiPropertyOptional()
  weekOfMonth?: number;

  @ApiPropertyOptional()
  monthOfYear?: number;

  @ApiProperty({ enum: RecurrenceEndType })
  endType: RecurrenceEndType;

  @ApiPropertyOptional()
  endAfterCount?: number;

  @ApiPropertyOptional()
  endOnDate?: string;

  @ApiPropertyOptional()
  lastGeneratedDate?: string;

  @ApiPropertyOptional()
  nextGenerationDate?: string;
}

export class CalendarEventResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  restaurantId: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty({ enum: CalendarEventType })
  eventType: CalendarEventType;

  @ApiProperty()
  eventDate: string;

  @ApiPropertyOptional()
  eventDateEnd?: string;

  @ApiProperty()
  allDay: boolean;

  @ApiPropertyOptional()
  eventTime?: string;

  @ApiPropertyOptional({ description: "Event end time (HH:MM)" })
  eventTimeEnd?: string;

  @ApiPropertyOptional()
  providerId?: string;

  @ApiPropertyOptional()
  orderId?: string;

  @ApiProperty({ enum: CalendarEventSource })
  source: CalendarEventSource;

  @ApiProperty({ enum: CalendarEventStatus })
  status: CalendarEventStatus;

  @ApiProperty()
  reminderEnabled: boolean;

  @ApiProperty()
  reminderDaysBefore: number;

  @ApiPropertyOptional()
  reminderSent?: boolean;

  @ApiPropertyOptional()
  color?: string;

  @ApiProperty()
  isRecurring: boolean;

  @ApiPropertyOptional()
  parentEventId?: string;

  @ApiPropertyOptional()
  occurrenceDate?: string;

  @ApiPropertyOptional()
  recurrenceRule?: RecurrenceRuleResponseDto;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

export class CalendarEventsListResponseDto {
  @ApiProperty({ type: [CalendarEventResponseDto] })
  events: CalendarEventResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  hasMore: boolean;
}

export class GenerateOccurrencesResponseDto {
  @ApiProperty()
  ruleId: string;

  @ApiProperty()
  generatedCount: number;

  @ApiProperty()
  message: string;
}

// ============================================================================
// EVENT TYPE DTOs
// ============================================================================

export class EventTypeResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() color: string;
  @ApiPropertyOptional() icon?: string;
  @ApiProperty() isDefault: boolean;
}

export class CreateEventTypeDto {
  @ApiProperty()
  @IsString()
  restaurantId: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  color: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  icon?: string;
}

export class UpdateEventTypeDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  color?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  icon?: string;
}

// ============================================================================
// EVENT STATUS UPDATE DTO
// ============================================================================

export class UpdateEventStatusDto {
  @ApiProperty({ enum: CalendarEventStatus })
  @IsEnum(CalendarEventStatus)
  status: CalendarEventStatus;
}

// ============================================================================
// PERSONAL CALENDAR LINKS (ADR 0111, review trail 2026-09-21)
// ============================================================================

/**
 * The address a calendar app subscribes to. Present ONLY on the answer to the
 * act that made the secret (create or a new link) — the secret is stored as a
 * hash and is never readable again.
 */
export class IssuedCalendarLinkDto {
  @ApiProperty({
    description: "Subscription path, relative to the gateway.",
    example: "/api/v1/calendar/feed/abc123.ics",
  })
  feedUrl: string;

  @ApiProperty({
    description:
      "The subscription URL a calendar client can actually take. NULL when " +
      "the gateway has no configured public origin and the request carried no " +
      "Host header to derive one — never a guessed origin.",
    example: "https://api.mudavym.com/api/v1/calendar/feed/abc123.ics",
    nullable: true,
  })
  absoluteFeedUrl: string | null;

  @ApiProperty({
    description:
      "The same URL under the webcal:// scheme, which is what makes Apple " +
      "Calendar and Outlook subscribe rather than download. NULL whenever " +
      "absoluteFeedUrl is.",
    example: "webcal://api.mudavym.com/api/v1/calendar/feed/abc123.ics",
    nullable: true,
  })
  webcalUrl: string | null;

  @ApiProperty({
    description:
      "Where the absolute origin came from, so a caller can tell a configured " +
      "origin from one inferred from this request's own Host header.",
    enum: ["config", "request", "none"],
    example: "config",
  })
  originSource: "config" | "request" | "none";
}

export class MyCalendarLinkDto {
  @ApiProperty({ description: "Whether the caller has a live link in this house." })
  connected: boolean;

  @ApiProperty({ nullable: true, description: "When the caller first connected." })
  createdAt: string | null;

  @ApiProperty({ nullable: true, description: "When the current secret was made." })
  issuedAt: string | null;

  @ApiProperty({
    nullable: true,
    description:
      "When a calendar app last read this link. NULL means it never has.",
  })
  lastFetchedAt: string | null;

  @ApiProperty({ enum: ["owner", "manager", "staff"] })
  role: "owner" | "manager" | "staff";

  @ApiProperty({ description: "One sentence: what this link shows." })
  scope: string;

  @ApiProperty({
    nullable: true,
    type: [String],
    description:
      "The caller's pick of categories, or null for everything their role allows.",
  })
  categories: string[] | null;

  @ApiProperty({
    description:
      "Every member may narrow their own link by category; a pick only ever shows less than the role allows.",
  })
  canPickCategories: boolean;

  @ApiProperty({ description: "Whether the house's areas model is live yet." })
  areasModelled: boolean;

  @ApiProperty({
    description:
      "True for an owner or manager of a house whose shared calendar link " +
      "was switched off on 2026-09-21 — the page tells them to connect their own.",
  })
  houseLinkRetired: boolean;

  @ApiPropertyOptional({
    type: IssuedCalendarLinkDto,
    nullable: true,
    description:
      "The address, only on the answer to the act that made it. NULL on a " +
      "create that found a link already made (another tab): that secret cannot " +
      "be shown again, so the page offers a new link instead.",
  })
  issued?: IssuedCalendarLinkDto | null;
}

export class CalendarLinkCategoriesDto {
  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    description:
      "Any member, for their own link. The categories it keeps; null or absent " +
      "for everything the caller's role allows. A pick only ever narrows.",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categories?: string[] | null;
}

export class HouseCalendarLinkDto {
  @ApiProperty() userId: string;
  @ApiProperty({ nullable: true }) name: string | null;
  @ApiProperty({
    nullable: true,
    enum: ["owner", "manager", "staff"],
    description:
      "The person's role in this house now; null when they are no longer a member.",
  })
  role: "owner" | "manager" | "staff" | null;
  @ApiProperty({
    description:
      "Whether the caller may stop this link: an owner may stop anyone's, a " +
      "manager a manager's or staff's, never an owner's.",
  })
  canStop: boolean;
  @ApiProperty() createdAt: string;
  @ApiProperty() issuedAt: string;
  @ApiProperty({ nullable: true }) lastFetchedAt: string | null;
}

export class CalendarLinkRevokedResponseDto {
  @ApiProperty({
    description:
      "Whether a live link was actually stopped. False when there was none — " +
      "a no-op, not an error.",
    example: true,
  })
  revoked: boolean;
}
