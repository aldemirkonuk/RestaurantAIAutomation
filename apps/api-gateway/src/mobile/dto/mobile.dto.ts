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
  amount: number | null;
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
    orderApprovals: number;
    draftApprovals: number;
    receiptVerifications: number;
    alerts: number;
  };
  generatedAt: string;
}

/**
 * Why tonight's sales are or are not known (F-674): `known` (read from the
 * house's register), `no_register` (it has never sent a check), `zone_unset`
 * (the house has no time zone, so no "tonight"), `unread` (the read failed).
 */
export type PulseSalesState = "known" | "no_register" | "zone_unset" | "unread";

export interface TodayPulseResponse {
  salesState: PulseSalesState;
  revenueToday: number | null;
  checksToday: number | null;
  revenueLastWeek: number | null;
  deltaPct: number | null;
  /** null when the decision feed could not be read — unknown, not zero. */
  pendingDecisions: number | null;
  criticalCount: number | null;
  /** The house's midnight that opened tonight; null when it has no zone. */
  windowStart: string | null;
  windowEnd: string;
  generatedAt: string;
}
