import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from "class-validator";

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
  @IsOptional() @IsIn(["valid", "expiring", "expired", "submitted"]) status?: string;
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
  @IsString() role: string;
  @IsInt() @Min(0) minStaff: number;
}

// ── Sales ingestion ────────────────────────────────────────────────────────
export class IngestSalesDto {
  @IsUUID() memberId: string;
  @IsDateString() serviceDate: string;
  @IsOptional() @IsInt() @Min(0) covers?: number;
  @IsOptional() @IsNumber() netSales?: number;
  @IsOptional() @IsNumber() wineSales?: number;
  @IsOptional() @IsInt() @Min(0) checks?: number;
  @IsOptional() @IsIn(["manual", "csv", "pos"]) source?: string;
}

// ── Broadcast ──────────────────────────────────────────────────────────────
export class BroadcastDto {
  @IsString() message: string;
  @IsOptional() @IsArray() @IsUUID("all", { each: true }) memberIds?: string[];
  @IsOptional() @IsString() title?: string;
}

// ── Settings ───────────────────────────────────────────────────────────────
export class UpdateTeamSettingsDto {
  @IsOptional() @IsBoolean() laborTrackingEnabled?: boolean;
  @IsOptional() @IsBoolean() wageVisible?: boolean;
  @IsOptional() @IsNumber() laborTargetPct?: number;
}
