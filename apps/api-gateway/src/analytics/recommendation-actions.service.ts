import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { INSIGHT_CANDIDATES } from "./insights/insight-catalog";
import { insightRuleId } from "./insights/suppression";

/** The `system_audit_log.action` a catalogue on/off files (ADR 0191). */
export type TypeToggleAction =
  | "recommendation_type_turned_on"
  | "recommendation_type_turned_off";

/** Whether the audit row reached `system_audit_log`, and why not. */
export interface TypeToggleAuditReceipt {
  recorded: boolean;
  reason: string | null;
}

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
   *
   * Kept for callers that genuinely cannot act on a read failure. Prefer
   * `readDispositions()`: an empty map from a broken query and an empty map
   * from a restaurant nobody has dismissed anything on are the same value here,
   * and the difference decides whether a dismissed card comes back.
   */
  async getStateMap(
    restaurantId: string,
  ): Promise<Map<string, RecommendationActionRow>> {
    return (await this.readDispositions(restaurantId)).map;
  }

  /**
   * The disposition map AND whether it was actually read.
   *
   * `readable: false` is the honest shape of "the dismissals could not be
   * loaded". The feed must say so, because the alternative — showing every
   * entry as if nothing had ever been dismissed — is precisely the failure the
   * founder named: a dismissal that does not hold, reported as a clean page.
   */
  async readDispositions(restaurantId: string): Promise<{
    map: Map<string, RecommendationActionRow>;
    readable: boolean;
    problem: string | null;
  }> {
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
      const problem = err?.message || "recommendation_actions could not be read";
      this.logger.warn(`readDispositions failed: ${problem}`);
      return { map, readable: false, problem };
    }
    return { map, readable: true, problem: null };
  }

  /**
   * Every suppression key currently in force for this restaurant.
   *
   * A suppression is a `dismissed` row, and its `rule_key` IS the key — see
   * `insights/suppression.ts` for the grammar (`rule#subject#grain`, with the
   * bare rule key as the canonical `rule#*#*`). Nothing else is inspected: a
   * snoozed row wakes on its own, a done row is a closed account, and neither
   * is a standing instruction to never show something again.
   *
   * `readable: false` means the caller must NOT present its list as clean.
   */
  async listSuppressions(restaurantId: string): Promise<{
    keys: Set<string>;
    readable: boolean;
    problem: string | null;
  }> {
    const { map, readable, problem } = await this.readDispositions(restaurantId);
    const keys = new Set<string>();
    for (const [key, row] of map) if (row.status === "dismissed") keys.add(key);
    return { keys, readable, problem };
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
    if (patch.assignedName !== undefined)
      row.assigned_name = patch.assignedName;
    if (snapshot?.observation !== undefined)
      row.observation = snapshot.observation;
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

  /**
   * Turn one catalogue type on or off for the house, and file who did it
   * (ADR 0191 — the founder, 2026-09-21: "owner/manager only, audited").
   *
   * The write is the SAME `recommendation_actions` row a rule-scope dismiss
   * already writes: the bare `insight:<candidateKey>` key, which
   * `InsightGeneratorService.generate()` filters every live instance of the
   * type against. No parallel store.
   *
   * "Audited" means a row in `system_audit_log` — the house's audit trail,
   * the one `recordAccessChange` (team/access-audit.ts) and the settings
   * register write, and the one /logs reads back. `recommendation_actions`
   * alone cannot be the audit: it is one row per key, upserted, so turning a
   * type back on overwrites `created_by` and erases who turned it off.
   *
   * The audit write never throws, on the same contract as
   * `recordAccessChange`: the change has already landed, and failing the
   * request because the paper failed would report a change that took effect
   * as one that did not. The receipt goes back to the caller and to the
   * client, so a lost audit row is visible instead of inferred from a short
   * log. `actorUserId` is required — `public.users.user_id` from the JWT,
   * never the body — and the controller refuses the toggle without one.
   */
  async setTypeEnabled(
    restaurantId: string,
    candidateKey: string,
    enabled: boolean,
    actorUserId: string,
  ): Promise<{
    row: RecommendationActionRow;
    ruleKey: string;
    audit: TypeToggleAuditReceipt;
  }> {
    if (!actorUserId) throw new Error("a signed-in actor is required");
    // Only a type the catalogue actually lists. Without this, the owner door
    // would write any string — including an instance-scope `a#b#c` key —
    // and file it in the audit log as a "type".
    if (!INSIGHT_CANDIDATES.some((c) => c.key === candidateKey))
      throw new Error(`Unknown catalogue type '${candidateKey}'`);
    const ruleKey = insightRuleId(candidateKey);
    const row = await this.setAction(
      restaurantId,
      ruleKey,
      { status: enabled ? "active" : "dismissed" },
      undefined,
      actorUserId,
    );

    const action: TypeToggleAction = enabled
      ? "recommendation_type_turned_on"
      : "recommendation_type_turned_off";
    let audit: TypeToggleAuditReceipt;
    try {
      const { error } = await this.dbService
        .getClient()
        .from("system_audit_log")
        .insert({
          actor_type: "user",
          actor_id: actorUserId,
          action,
          entity_type: "recommendation_type",
          // `entity_id` is a uuid column and a candidate key is not a uuid:
          // the restaurant stands as the entity (the settings register's own
          // convention for a house-wide setting) and the type is named in
          // `changes`.
          entity_id: restaurantId,
          changes: {
            candidate_key: candidateKey,
            rule_key: ruleKey,
            enabled: { to: enabled },
          },
          restaurant_id: restaurantId,
          reason: null,
        });
      audit = error
        ? { recorded: false, reason: error.message }
        : { recorded: true, reason: null };
    } catch (err: any) {
      audit = { recorded: false, reason: err?.message || String(err) };
    }
    if (!audit.recorded)
      this.logger.error(
        `${action} happened but the audit row did not write: ${audit.reason}`,
      );
    return { row, ruleKey, audit };
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
          return r.snoozeUntil
            ? new Date(r.snoozeUntil).getTime() > now
            : false;
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
      // `false` when no row exists for this house at all — the caller must
      // not read the defaults below (`digestEnabled: false, digestHour: 7`)
      // as a fact about what the house chose. See sketch 120's read-shape
      // note: a house that never touched this setting must never be shown
      // as "armed the post, then turned it off, at 07:00".
      set: !!data,
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
    if (patch.digestEnabled !== undefined)
      row.digest_enabled = patch.digestEnabled;
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
