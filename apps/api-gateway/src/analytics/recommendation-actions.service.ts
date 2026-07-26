import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

/**
 * The manager's disposition against a recommendation card. `active` is the
 * default (and the "restored" state); the others change how the card is
 * surfaced:
 *   • dismissed — hidden from the feed until restored (NEW-285)
 *   • snoozed   — hidden until `snoozeUntil`, then auto-reactivates (NEW-286)
 *   • done      — hidden, marked completed, restorable (NEW-287)
 */
export type RecommendationStatus = "active" | "dismissed" | "snoozed" | "done";

export interface RecommendationActionRow {
  ruleKey: string;
  status: RecommendationStatus;
  reason: string | null;
  snoozeUntil: string | null;
  pinned: boolean;
  actedAt: string | null;
  feedback: "helpful" | "not_helpful" | null;
  assignedTo: string | null;
  assignedName: string | null;
  assignedAt: string | null;
  observation: string | null;
  recommendation: string | null;
  category: string | null;
  urgency: string | null;
  updatedAt: string;
}

export interface RecommendationActionPatch {
  status?: RecommendationStatus;
  reason?: string | null;
  /** ISO instant; used with status="snoozed". */
  snoozeUntil?: string | null;
  pinned?: boolean;
  /** Mark that the manager followed the Act deep-link (sets acted_at=now). */
  acted?: boolean;
  feedback?: "helpful" | "not_helpful" | null;
  /** NEW-296: team member id + display name, or null to unassign. */
  assignedTo?: string | null;
  assignedName?: string | null;
}

/** Denormalised snapshot stored so History reads without a recompute. */
export interface RecommendationSnapshot {
  observation?: string;
  recommendation?: string;
  category?: string;
  urgency?: string;
}

/**
 * RecommendationActionsService — durable disposition for recommendation cards.
 *
 * The recommendation engine is deterministic and regenerates cards on every
 * request keyed by a stable `ruleKey`. This service persists what the MANAGER
 * did with each card (dismiss / snooze / mark done / pin / rate) so that state
 * survives recompute and the feed stays quiet on things already handled.
 * Reused by the Reports EngineInsightsPanel (NEW-434) with keys of the form
 * `insight:<candidate_key>`.
 */
@Injectable()
export class RecommendationActionsService {
  private readonly logger = new Logger(RecommendationActionsService.name);

  constructor(private readonly dbService: DatabaseService) {}

  /**
   * Current disposition per ruleKey. Snoozes whose window has elapsed are
   * reported as `active` (lazy expiry — cheap and avoids a background job).
   */
  async getStateMap(
    restaurantId: string,
  ): Promise<Map<string, RecommendationActionRow>> {
    const map = new Map<string, RecommendationActionRow>();
    try {
      const { data, error } = await this.dbService
        .getClient()
        .from("recommendation_actions")
        .select("*")
        .eq("restaurant_id", restaurantId);
      if (error) throw new Error(error.message);
      const now = Date.now();
      for (const r of data || []) {
        const expiredSnooze =
          r.status === "snoozed" &&
          r.snooze_until &&
          new Date(r.snooze_until).getTime() <= now;
        map.set(r.rule_key, {
          ruleKey: r.rule_key,
          status: expiredSnooze ? "active" : (r.status as RecommendationStatus),
          reason: r.reason ?? null,
          snoozeUntil: expiredSnooze ? null : (r.snooze_until ?? null),
          pinned: !!r.pinned,
          actedAt: r.acted_at ?? null,
          feedback: r.feedback ?? null,
          assignedTo: r.assigned_to ?? null,
          assignedName: r.assigned_name ?? null,
          assignedAt: r.assigned_at ?? null,
          observation: r.observation ?? null,
          recommendation: r.recommendation ?? null,
          category: r.category ?? null,
          urgency: r.urgency ?? null,
          updatedAt: r.updated_at,
        });
      }
    } catch (err: any) {
      this.logger.warn(`getStateMap failed: ${err?.message}`);
    }
    return map;
  }

  async setAction(
    restaurantId: string,
    ruleKey: string,
    patch: RecommendationActionPatch,
    snapshot?: RecommendationSnapshot,
    createdBy?: string,
  ): Promise<RecommendationActionRow> {
    if (!ruleKey?.trim()) throw new Error("ruleKey is required");
    const row: Record<string, any> = {
      restaurant_id: restaurantId,
      rule_key: ruleKey,
      updated_at: new Date().toISOString(),
    };
    if (patch.status !== undefined) {
      const allowed: RecommendationStatus[] = [
        "active",
        "dismissed",
        "snoozed",
        "done",
      ];
      if (!allowed.includes(patch.status))
        throw new Error(`Invalid status '${patch.status}'`);
      row.status = patch.status;
      // Restoring clears the reason/snooze so the card comes back clean.
      if (patch.status === "active" && patch.snoozeUntil === undefined)
        row.snooze_until = null;
    }
    if (patch.reason !== undefined) row.reason = patch.reason;
    if (patch.snoozeUntil !== undefined) row.snooze_until = patch.snoozeUntil;
    if (patch.pinned !== undefined) row.pinned = patch.pinned;
    if (patch.acted) row.acted_at = new Date().toISOString();
    if (patch.feedback !== undefined) row.feedback = patch.feedback;
    if (patch.assignedTo !== undefined) {
      row.assigned_to = patch.assignedTo;
      // Clearing the assignee clears its denormalised name + timestamp too.
      row.assigned_at = patch.assignedTo ? new Date().toISOString() : null;
      if (!patch.assignedTo) row.assigned_name = null;
    }
    if (patch.assignedName !== undefined) row.assigned_name = patch.assignedName;
    if (snapshot?.observation !== undefined) row.observation = snapshot.observation;
    if (snapshot?.recommendation !== undefined)
      row.recommendation = snapshot.recommendation;
    if (snapshot?.category !== undefined) row.category = snapshot.category;
    if (snapshot?.urgency !== undefined) row.urgency = snapshot.urgency;
    if (createdBy) row.created_by = createdBy;

    const { data, error } = await this.dbService
      .getClient()
      .from("recommendation_actions")
      .upsert(row, { onConflict: "restaurant_id,rule_key" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return this.toRow(data);
  }

  async bulkSetAction(
    restaurantId: string,
    items: Array<{ ruleKey: string; snapshot?: RecommendationSnapshot }>,
    patch: RecommendationActionPatch,
    createdBy?: string,
  ): Promise<number> {
    let n = 0;
    for (const it of items) {
      try {
        await this.setAction(
          restaurantId,
          it.ruleKey,
          patch,
          it.snapshot,
          createdBy,
        );
        n++;
      } catch (err: any) {
        this.logger.warn(`bulkSetAction ${it.ruleKey}: ${err?.message}`);
      }
    }
    return n;
  }

  /** Cards currently in a given non-active state (for the status tabs). */
  async listByStatus(
    restaurantId: string,
    status: RecommendationStatus | "all",
  ): Promise<RecommendationActionRow[]> {
    let q = this.dbService
      .getClient()
      .from("recommendation_actions")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("updated_at", { ascending: false });
    if (status !== "all") q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const now = Date.now();
    return (data || [])
      .map((d) => this.toRow(d))
      .filter((r) => {
        // Hide snoozes that have expired from the "snoozed" tab.
        if (status === "snoozed")
          return r.snoozeUntil ? new Date(r.snoozeUntil).getTime() > now : false;
        return true;
      });
  }

  /** NEW-302: everything the manager has acted on / dismissed / completed. */
  async listHistory(restaurantId: string): Promise<RecommendationActionRow[]> {
    const { data, error } = await this.dbService
      .getClient()
      .from("recommendation_actions")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .or("status.in.(dismissed,done),acted_at.not.is.null")
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data || []).map((d) => this.toRow(d));
  }

  // ---- Digest preferences (NEW-303) ---------------------------------------

  async getDigestPref(restaurantId: string) {
    const { data } = await this.dbService
      .getClient()
      .from("recommendation_digest_prefs")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    return {
      digestEnabled: !!data?.digest_enabled,
      digestHour: data?.digest_hour ?? 7,
      digestMinUrgency: data?.digest_min_urgency ?? "this_week",
      recipientEmail: data?.recipient_email ?? null,
      lastSentAt: data?.last_sent_at ?? null,
    };
  }

  async setDigestPref(
    restaurantId: string,
    patch: {
      digestEnabled?: boolean;
      digestHour?: number;
      digestMinUrgency?: string;
      recipientEmail?: string | null;
    },
  ) {
    const row: Record<string, any> = {
      restaurant_id: restaurantId,
      updated_at: new Date().toISOString(),
    };
    if (patch.digestEnabled !== undefined) row.digest_enabled = patch.digestEnabled;
    if (patch.digestHour !== undefined)
      row.digest_hour = Math.min(23, Math.max(0, Math.round(patch.digestHour)));
    if (patch.digestMinUrgency !== undefined) {
      const allowed = ["now", "this_week", "this_month"];
      if (!allowed.includes(patch.digestMinUrgency))
        throw new Error("Invalid digestMinUrgency");
      row.digest_min_urgency = patch.digestMinUrgency;
    }
    if (patch.recipientEmail !== undefined)
      row.recipient_email = patch.recipientEmail;
    const { error } = await this.dbService
      .getClient()
      .from("recommendation_digest_prefs")
      .upsert(row, { onConflict: "restaurant_id" });
    if (error) throw new Error(error.message);
    return this.getDigestPref(restaurantId);
  }

  private toRow(d: any): RecommendationActionRow {
    return {
      ruleKey: d.rule_key,
      status: d.status,
      reason: d.reason ?? null,
      snoozeUntil: d.snooze_until ?? null,
      pinned: !!d.pinned,
      actedAt: d.acted_at ?? null,
      feedback: d.feedback ?? null,
      assignedTo: d.assigned_to ?? null,
      assignedName: d.assigned_name ?? null,
      assignedAt: d.assigned_at ?? null,
      observation: d.observation ?? null,
      recommendation: d.recommendation ?? null,
      category: d.category ?? null,
      urgency: d.urgency ?? null,
      updatedAt: d.updated_at,
    };
  }
}
