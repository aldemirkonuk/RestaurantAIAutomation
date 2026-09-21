import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { INSIGHT_CANDIDATES } from "./insights/insight-catalog";
import { insightRuleId } from "./insights/suppression";
import {
  DISMISS_REASONS,
  StateBook,
  isDismissReason,
  isRuleWideDismissOrRestore,
  isRuleWideKey,
  mayActRuleWide,
  snoozeHolds,
  stateBookFrom,
} from "./insights/item-state";

/** The `system_audit_log.action` a catalogue on/off files (ADR 0191). */
export type TypeToggleAction =
  | "recommendation_type_turned_on"
  | "recommendation_type_turned_off";

/**
 * The `system_audit_log.action` a rule-wide dismiss or restore files from any
 * other door — the feed's "the whole rule", the Dismissed leaf's return, the
 * bulk bar (founder, 2026-09-21: "owner/manager only and audited EVERYWHERE").
 */
export type RuleWideAction =
  | "recommendation_rule_dismissed"
  | "recommendation_rule_restored";

/** Who is writing, read from the JWT by the controller — never the body. */
export interface RecommendationActor {
  userId: string | null;
  role: string | null;
}

/**
 * Who is writing a recommendation state, from the JWT only (ADR 0191). The
 * role is the house role the token names (`JwtStrategy.validate`, ADR 0162),
 * the same field `RolesGuard` reads. The controller passes `@CurrentUser()`.
 */
export function actorOf(user?: {
  userId?: string;
  role?: string;
}): RecommendationActor {
  return {
    userId: typeof user?.userId === "string" && user.userId ? user.userId : null,
    role: typeof user?.role === "string" && user.role ? user.role : null,
  };
}

/**
 * A rule-wide dismiss or restore by someone who may not make one. The
 * controller turns it into a 403; it is thrown BEFORE anything is written.
 */
export class RuleWideActForbidden extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleWideActForbidden";
  }
}

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
  /**
   * Whether this row's key silences a whole rule or catalogue type (no
   * subject, no period). Computed here so the page never parses a key to
   * decide whether "Return it to the book" is an owner/manager act.
   */
  ruleWide: boolean;
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
          ruleWide: isRuleWideKey(String(r.rule_key ?? "")),
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

  /**
   * The ONE shared per-item state every surface reads (ADR 0191, founder
   * 2026-09-21: "Build it right, in order"). Dismissed, done and in-force
   * snoozes, each at the scope its key was written — see
   * `insights/item-state.ts`. The generator (feed sentences, Reports, the
   * rails, the catalogue's live items, the stored read) and the feed's own
   * rules resolve every item against this, and nothing else.
   *
   * `readable: false` means the caller must NOT present its list as clean.
   */
  async readState(restaurantId: string): Promise<{
    book: StateBook;
    readable: boolean;
    problem: string | null;
  }> {
    const { map, readable, problem } = await this.readDispositions(restaurantId);
    return { book: stateBookFrom(map.values()), readable, problem };
  }

  /**
   * The rules a state write has to obey, whatever door it came through.
   *
   *   - A dismissal carries a reason from DISMISS_REASONS — "the reason is a
   *     labelled signal" (founder, 2026-09-21). No label, no dismissal.
   *   - A snooze carries an instant in the future — "the item returns after".
   *     A snooze with no instant was a hidden-for-ever row that no leaf
   *     listed (`listByStatus('snoozed')` drops it) and nothing returned.
   *   - Only a dismissal holds a reason. Done is completion with "no negative
   *     signal", so it never carries one; a snooze or a restore neither.
   *
   * Item-independent, so the bulk path runs it once before any write.
   */
  validateStatePatch(patch: RecommendationActionPatch): void {
    if (patch.status === undefined) return;
    if (patch.status === "dismissed" && !isDismissReason(patch.reason))
      throw new Error(
        `A dismissal needs a reason, one of: ${DISMISS_REASONS.join(", ")}`,
      );
    if (
      patch.status === "snoozed" &&
      !snoozeHolds(patch.snoozeUntil ?? null, Date.now())
    )
      throw new Error("A snooze needs a snoozeUntil instant in the future");
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
      this.validateStatePatch(patch);
      row.status = patch.status;
      // The reason is the dismissal's label and nothing else's: a snooze,
      // a done and a restore each write it back to null, so a row's reason
      // is non-null exactly when it is dismissed (ADR 0191).
      row.reason = patch.status === "dismissed" ? patch.reason : null;
      // Only a snooze holds an instant.
      row.snooze_until =
        patch.status === "snoozed" ? (patch.snoozeUntil ?? null) : null;
    }
    // A reason or an instant sent WITHOUT a status changes no state: the
    // state is (status, reason, instant) together, and half of it is not
    // written on its own.
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
   * Off is a rule-wide dismissal, so it carries a reason from
   * DISMISS_REASONS like every other dismissal (founder, 2026-09-21: "the
   * reason is a labelled signal"); on writes none.
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
    reason: string | null = null,
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
    const patch: RecommendationActionPatch = enabled
      ? { status: "active" }
      : { status: "dismissed", reason };
    // Before any write: off without a label is refused, not stored bare.
    this.validateStatePatch(patch);
    const ruleKey = insightRuleId(candidateKey);
    const row = await this.setAction(
      restaurantId,
      ruleKey,
      patch,
      undefined,
      actorUserId,
    );

    const action: TypeToggleAction = enabled
      ? "recommendation_type_turned_on"
      : "recommendation_type_turned_off";
    const audit = await this.fileAudit(restaurantId, actorUserId, action, {
      entityType: "recommendation_type",
      changes: {
        candidate_key: candidateKey,
        rule_key: ruleKey,
        enabled: { to: enabled },
        ...(enabled ? {} : { reason }),
      },
    });
    return { row, ruleKey, audit };
  }

  /**
   * One state write from the feed, a rail, Reports or the catalogue's live
   * items — with the founder's rule-wide gate applied (2026-09-21, answer 1:
   * rule-wide dismiss and restore are "owner/manager only and audited
   * EVERYWHERE"; staff keep dismissing a single finding or subject).
   *
   * A rule-wide dismiss or restore (`isRuleWideDismissOrRestore`) needs an
   * owner, manager or admin (the `RolesGuard` set), is refused with
   * `RuleWideActForbidden` BEFORE anything is written otherwise, and files a
   * `system_audit_log` row whose receipt is returned. Every other write —
   * this finding, this subject, a pin, a snooze of a live rule — is open to
   * every member exactly as before, and is not audited.
   *
   * Whether a status write over a bare key is a RESTORE depends on the row
   * already there, so it is read first; a failed read refuses the write
   * rather than guess (a gate that opens when it cannot see is not a gate).
   */
  async setActionAs(
    restaurantId: string,
    ruleKey: string,
    patch: RecommendationActionPatch,
    snapshot: RecommendationSnapshot | undefined,
    actor: RecommendationActor,
  ): Promise<{
    row: RecommendationActionRow;
    audit: TypeToggleAuditReceipt | null;
  }> {
    if (!ruleKey?.trim()) throw new Error("ruleKey is required");
    this.validateStatePatch(patch);
    const gated = await this.ruleWideStatus([ruleKey], restaurantId, patch);
    const current = gated.get(ruleKey);
    if (current !== undefined) this.assertMayActRuleWide(actor, 1);
    const row = await this.setAction(
      restaurantId,
      ruleKey,
      patch,
      snapshot,
      actor.userId ?? undefined,
    );
    if (current === undefined) return { row, audit: null };
    const audit = await this.fileRuleWideAudit(
      restaurantId,
      actor.userId as string,
      ruleKey,
      current,
      patch,
    );
    return { row, audit };
  }

  /**
   * The bulk bar's write, under the same gate. Refused WHOLE, before any
   * write, when any item is a rule-wide dismiss or restore the actor may not
   * make — a half-applied bulk act with a 403 for the rest would leave the
   * page unable to say which entries moved.
   */
  async bulkSetActionAs(
    restaurantId: string,
    items: Array<{ ruleKey: string; snapshot?: RecommendationSnapshot }>,
    patch: RecommendationActionPatch,
    actor: RecommendationActor,
  ): Promise<{ updated: number; audit: { recorded: number; missed: number } }> {
    this.validateStatePatch(patch);
    const keys = items.map((i) => i.ruleKey).filter((k) => !!k?.trim());
    const gated = await this.ruleWideStatus(keys, restaurantId, patch);
    if (gated.size > 0) this.assertMayActRuleWide(actor, gated.size);
    let updated = 0;
    const audit = { recorded: 0, missed: 0 };
    for (const it of items) {
      try {
        await this.setAction(
          restaurantId,
          it.ruleKey,
          patch,
          it.snapshot,
          actor.userId ?? undefined,
        );
        updated++;
      } catch (err: any) {
        this.logger.warn(`bulkSetActionAs ${it.ruleKey}: ${err?.message}`);
        continue;
      }
      const current = gated.get(it.ruleKey);
      if (current === undefined) continue;
      const receipt = await this.fileRuleWideAudit(
        restaurantId,
        actor.userId as string,
        it.ruleKey,
        current,
        patch,
      );
      if (receipt.recorded) audit.recorded++;
      else audit.missed++;
    }
    return { updated, audit };
  }

  /**
   * For each key, whether this patch is a rule-wide dismiss or restore —
   * returned as key → the status it has now (null when it has no row).
   * Keys that are not gated are absent from the map. Reads the current rows
   * only for rule-wide keys under a status write; a failed read throws.
   */
  private async ruleWideStatus(
    keys: string[],
    restaurantId: string,
    patch: RecommendationActionPatch,
  ): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    if (patch.status === undefined) return out;
    const wide = keys.filter((k) => isRuleWideKey(k));
    if (wide.length === 0) return out;
    const { data, error } = await this.dbService
      .getClient()
      .from("recommendation_actions")
      .select("rule_key,status")
      .eq("restaurant_id", restaurantId)
      .in("rule_key", wide);
    if (error)
      throw new Error(
        `Could not read the rule's current state, so could not tell whether this lifts a rule-wide dismissal: ${error.message}`,
      );
    const now = new Map<string, string>();
    for (const r of data || []) now.set(String(r.rule_key), String(r.status));
    for (const k of wide) {
      const current = now.get(k) ?? null;
      if (isRuleWideDismissOrRestore(k, patch.status, current))
        out.set(k, current);
    }
    return out;
  }

  private assertMayActRuleWide(actor: RecommendationActor, n: number): void {
    if (!mayActRuleWide(actor.role))
      throw new RuleWideActForbidden(
        n === 1
          ? "Only an owner or manager can dismiss or return a whole rule. Dismiss this finding or this subject instead."
          : `Only an owner or manager can dismiss or return whole rules (${n} in this selection).`,
      );
    if (!actor.userId)
      throw new RuleWideActForbidden(
        "A signed-in user is required to dismiss or return a whole rule — it is filed in the house log.",
      );
  }

  private fileRuleWideAudit(
    restaurantId: string,
    actorUserId: string,
    ruleKey: string,
    current: string | null,
    patch: RecommendationActionPatch,
  ): Promise<TypeToggleAuditReceipt> {
    const action: RuleWideAction =
      patch.status === "dismissed"
        ? "recommendation_rule_dismissed"
        : "recommendation_rule_restored";
    return this.fileAudit(restaurantId, actorUserId, action, {
      entityType: "recommendation_rule",
      changes: {
        rule_key: ruleKey,
        status: { from: current, to: patch.status },
        ...(patch.status === "dismissed" ? { reason: patch.reason } : {}),
      },
    });
  }

  /**
   * One `system_audit_log` row. Never throws — the change it records has
   * already landed — and returns a receipt the client renders when the row
   * did not write (the `recordAccessChange` contract).
   */
  private async fileAudit(
    restaurantId: string,
    actorUserId: string,
    action: TypeToggleAction | RuleWideAction,
    what: { entityType: string; changes: Record<string, unknown> },
  ): Promise<TypeToggleAuditReceipt> {
    let audit: TypeToggleAuditReceipt;
    try {
      const { error } = await this.dbService
        .getClient()
        .from("system_audit_log")
        .insert({
          actor_type: "user",
          actor_id: actorUserId,
          action,
          entity_type: what.entityType,
          // `entity_id` is a uuid column and a rule or candidate key is not a
          // uuid: the restaurant stands as the entity (the settings
          // register's own convention for a house-wide setting) and the key
          // is named in `changes`.
          entity_id: restaurantId,
          changes: what.changes,
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
    return audit;
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
      ruleWide: isRuleWideKey(String(d.rule_key ?? "")),
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
