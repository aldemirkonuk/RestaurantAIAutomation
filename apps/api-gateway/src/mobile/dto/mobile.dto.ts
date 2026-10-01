import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export class RegisterDeviceDto {
  @ApiProperty({ description: "Expo push token (ExponentPushToken[...])" })
  @IsString()
  @MaxLength(200)
  expoPushToken: string;

  @ApiPropertyOptional({ enum: ["ios", "android", "unknown"] })
  @IsOptional()
  @IsIn(["ios", "android", "unknown"])
  platform?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  appVersion?: string;
}

export type DecisionKind =
  | "order_approval"
  | "draft_approval"
  | "receipt_verification"
  | "alert";

export type FeedPriority = "low" | "medium" | "high" | "critical";

/**
 * One card in the mobile decision feed. `id` is stable across refreshes
 * (`${kind}:${entityId}`) so the client can animate removals (Sediment
 * Settle) and dedupe optimistic updates.
 */
export interface FeedItem {
  id: string;
  kind: DecisionKind;
  title: string;
  subtitle: string;
  wineName: string | null;
  providerName: string | null;
  /**
   * The order's money. ABSENT, not null and not 0, when the caller's role in
   * this house does not see money (ADR 0253 round 2: owners and managers only).
   * `null` still means "this card has no amount".
   */
  amount?: number | null;
  quantity: number | null;
  priority: FeedPriority;
  score: number;
  createdAt: string;
  entityId: string;
  orderId: string | null;
  conversationId: string | null;
  notificationId: string | null;
  draftContent: string | null;
  meta: Record<string, any>;
}

export interface FeedResponse {
  items: FeedItem[];
  counts: {
    total: number;
    /** Absent for a caller who does not see money: they get no approve cards. */
    orderApprovals?: number;
    draftApprovals: number;
    receiptVerifications: number;
    alerts: number;
  };
  generatedAt: string;
}

/**
 * The four sales figures are ABSENT for a caller whose role in this house does
 * not see money (ADR 0253 round 2: owners and managers only). Absent is not
 * `null`: `null` means the sales could not be read (no POS feed, a failed
 * read); absent means they are not this person's to see.
 */
export interface TodayPulseResponse {
  revenueToday?: number | null;
  checksToday?: number | null;
  revenueLastWeek?: number | null;
  deltaPct?: number | null;
  pendingDecisions: number;
  criticalCount: number;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
}
