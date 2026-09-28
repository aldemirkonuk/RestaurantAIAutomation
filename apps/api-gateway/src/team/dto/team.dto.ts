import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

// ── Members ────────────────────────────────────────────────────────────────
export class CreateTeamMemberDto {
  @IsString() displayName: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() position?: string;
  @IsOptional()
  @IsIn(["full_time", "part_time", "trial", "borrowed"])
  employmentType?: string;
  @IsOptional() @IsString() homeLocation?: string;
  @IsOptional() @IsNumber() @Min(0) hourlyWage?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) skills?: string[];
  @IsOptional() @IsDateString() hireDate?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateTeamMemberDto {
  @IsOptional() @IsString() displayName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() position?: string;
  @IsOptional()
  @IsIn(["full_time", "part_time", "trial", "borrowed"])
  employmentType?: string;
  @IsOptional() @IsString() homeLocation?: string;
  @IsOptional() @IsNumber() @Min(0) hourlyWage?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) skills?: string[];
  @IsOptional() @IsDateString() hireDate?: string;
  @IsOptional() @IsIn(["active", "inactive", "trial"]) status?: string;
  @IsOptional() @IsString() notes?: string;
}

// ── Shifts ───────────────────────────────────────────────────────────────
export class CreateShiftDto {
  @IsOptional() @IsUUID() scheduleId?: string;
  @IsOptional() @IsUUID() memberId?: string; // null = open shift
  @IsDateString() shiftDate: string;
  @IsString() startTime: string;
  @IsString() endTime: string;
  @IsOptional() @IsString() role?: string;
  @IsOptional()
  @IsIn(["am", "pm", "double", "split", "training", "borrowed", "open"])
  shiftType?: string;
  @IsOptional() @IsString() note?: string;
}

export class UpdateShiftDto {
  @IsOptional() @IsUUID() memberId?: string;
  @IsOptional() @IsDateString() shiftDate?: string;
  @IsOptional() @IsString() startTime?: string;
  @IsOptional() @IsString() endTime?: string;
  @IsOptional() @IsString() role?: string;
  @IsOptional()
  @IsIn(["am", "pm", "double", "split", "training", "borrowed", "open"])
  shiftType?: string;
  @IsOptional()
  @IsIn(["scheduled", "callout", "covered", "open"])
  state?: string;
  @IsOptional() @IsString() note?: string;
}

export class CalloutDto {
  @IsOptional() @IsString() reason?: string;
}

export class OfferCoverDto {
  @IsArray() @IsUUID("all", { each: true }) memberIds: string[];
}

export class AssignCoverDto {
  @IsUUID() memberId: string;
}

// ── Schedules ──────────────────────────────────────────────────────────────
export class CreateScheduleDto {
  @IsDateString() weekStart: string;
}

export class CopyWeekDto {
  @IsDateString() fromWeekStart: string;
  @IsDateString() toWeekStart: string;
  /**
   * Copying REPLACES the target week — every shift in it is deleted first.
   * Without this flag a non-empty target is a 409 naming the count, so the
   * destruction cannot happen by accident (ADR 0088 T7).
   */
  @IsOptional() @IsBoolean() replaceTarget?: boolean;
}

export class PublishScheduleDto {
  /**
   * Re-publishing erases every read receipt on the schedule — the only record
   * that anyone had seen the previous version. A re-publish over existing
   * receipts is a 409 without this (ADR 0088 T7).
   */
  @IsOptional() @IsBoolean() resetReceipts?: boolean;
}

// ── Certifications ─────────────────────────────────────────────────────────
export class CreateCertDto {
  @IsUUID() memberId: string;
  @IsString() certType: string;
  @IsOptional() @IsDateString() issuedAt?: string;
  @IsOptional() @IsDateString() expiresAt?: string;
  @IsOptional() @IsString() docUrl?: string;
}

export class UpdateCertDto {
  @IsOptional() @IsString() certType?: string;
  @IsOptional() @IsDateString() issuedAt?: string;
  @IsOptional() @IsDateString() expiresAt?: string;
  @IsOptional() @IsString() docUrl?: string;
  @IsOptional()
  @IsIn(["valid", "expiring", "expired", "submitted"])
  status?: string;
}

// ── Time off / swaps ───────────────────────────────────────────────────────
export class CreateTimeOffDto {
  @IsUUID() memberId: string;
  @IsDateString() startDate: string;
  @IsDateString() endDate: string;
  @IsOptional() @IsString() reason?: string;
}

export class ReviewRequestDto {
  @IsIn(["approved", "denied"]) status: "approved" | "denied";
}

// ── Coverage template ──────────────────────────────────────────────────────
export class CreateCoverageTemplateDto {
  @IsOptional() @IsInt() @Min(0) @Max(6) dayOfWeek?: number;
  @IsIn(["am", "pm"]) shiftPeriod: "am" | "pm";
  @IsString() @IsNotEmpty() role: string;
  @IsInt() @Min(0) minStaff: number;
}

// ── Sales ingestion ────────────────────────────────────────────────────────
export class IngestSalesDto {
  @IsUUID() memberId: string;
  @IsDateString() serviceDate: string;
  @IsOptional() @IsInt() @Min(0) covers?: number;
  @IsOptional() @IsNumber() @Min(0) netSales?: number;
  @IsOptional() @IsNumber() @Min(0) wineSales?: number;
  @IsOptional() @IsInt() @Min(0) checks?: number;
  @IsOptional() @IsIn(["manual", "csv", "pos"]) source?: string;
}

export class IngestSalesBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IngestSalesDto)
  rows: IngestSalesDto[];
}

// ── Broadcast ──────────────────────────────────────────────────────────────
export class BroadcastDto {
  @IsString() message: string;
  /**
   * The members to reach. Mutually exclusive with `audience: "everyone"`, and
   * exactly one of the two is REQUIRED: an omitted `memberIds` used to mean
   * "every active linked member", so a control labelled "message this person"
   * that forgot to pass an id messaged the whole restaurant, and the response
   * could not tell one send from the other (ADR 0088 T3).
   */
  @IsOptional() @IsArray() @IsUUID("all", { each: true }) memberIds?: string[];
  /** Say it out loud. The only accepted value is `"everyone"`. */
  @IsOptional() @IsIn(["everyone"]) audience?: "everyone";
  @IsOptional() @IsString() title?: string;
  /**
   * Which channels this message may leave by. Omitting it means
   * `["inbox", "push"]`, which since 2026-09-04 is also the most it can ever
   * be: a crew message no longer sends email or SMS for ANY caller, because the
   * only senders available are the house's shared mailbox and shared SMS
   * account — the ones vendors are written from.
   *
   * `email` and `sms` are still ACCEPTED VALUES on purpose. A caller that names
   * one is not rejected; it is told, in `withheldByProduct`, how many people it
   * would have reached and why it did not. Rejecting the body outright would
   * make an old caller fail with no explanation, and silently dropping the
   * channel would let "we told everyone" stay true-looking while being false.
   */
  @IsOptional()
  @IsArray()
  @IsIn(["inbox", "push", "email", "sms"], { each: true })
  channels?: Array<"inbox" | "push" | "email" | "sms">;
}

// ── Crew notes ─────────────────────────────────────────────────────────────
/**
 * A note about one week. `weekStart` and not `scheduleId` is the required key:
 * a manager writes about Saturday while the week is still a draft, and
 * `schedules` may hold no row for it yet.
 */
export class CreateTeamNoteDto {
  @IsDateString() weekStart: string;
  @IsString() @IsNotEmpty() body: string;
  /** Required and non-empty: a note that names nobody reaches nobody. */
  @IsArray() @ArrayNotEmpty() @IsUUID("all", { each: true }) memberIds: string[];
  @IsOptional() @IsUUID() scheduleId?: string;
}

// ── Settings ───────────────────────────────────────────────────────────────
export class UpdateTeamSettingsDto {
  @IsOptional() @IsBoolean() laborTrackingEnabled?: boolean;
  @IsOptional() @IsBoolean() wageVisible?: boolean;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100)
  laborTargetPct?: number;
}
