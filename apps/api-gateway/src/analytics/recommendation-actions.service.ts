import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { INSIGHT_CANDIDATES } from "./insights/insight-catalog";
import { insightRuleId } from "./insights/suppression";
import { SuppressionTarget } from "./insights/suppression";
import {
  DISMISS_REASONS,
  PersonalBook,
  RecordedAs,
  StateBook,
  historyActOf,
  isDismissReason,
  isRuleWideDismissOrRestore,
  isRuleWideKey,
  mayActRuleWide,
  personalBookFrom,
  personalView,
  planAct,
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
  /**
   * The areas this person leads — the areas lane's typed hook (ADR 0191
   * round 3, answer 4: snooze for everyone is owners/managers, "and area
   * leads in their area once the areas lane lands"). Always empty here:
   * nothing in this lane builds areas.
   */
  leadsAreas?: ReadonlyArray<string>;
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
    leadsAreas: [],
  };
}

/**
 * A state write that is not made, said in words (ADR 0191 round 3): a staff
 * member asking to snooze for everyone, a write with no signed-in person to
 * keep in the history, or a malformed snooze. `forbidden` → 403, otherwise
 * 400. Thrown BEFORE anything is written.
 */
export class ActRefused extends Error {
  constructor(
    message: string,
    readonly forbidden: boolean,
  ) {
    super(message);
    this.name = "ActRefused";
  }
}

/** One person's own snooze, as `recommendation_personal_snoozes` holds it. */
export interface PersonalSnoozeRow {
  ruleKey: string;
  snoozeUntil: string;
  observation: string | null;
  recommendation: string | null;
  category: string | null;
  urgency: string | null;
  updatedAt: string | null;
}

/** What one write through the gated path did, and what it filed. */
export interface ActWriteResult {
  /** The house state row, or null when the write was the person's own snooze. */
  row: RecommendationActionRow | null;
  /** The house-log receipt of a rule-wide dismiss or restore, else null. */
  audit: TypeToggleAuditReceipt | null;
  /** The append-only history's receipt for a house status write, else null. */
  history: TypeToggleAuditReceipt | null;
  /** What the write was recorded as — "Already handled" says `done`. */
  recordedAs: RecordedAs;
  /** The person's own snooze, when that is what the write became. */
  personal: PersonalSnoozeRow | null;
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
  /**
   * Who a snooze hides the card from (ADR 0191 round 3): `me` — the person
   * alone, anyone may; `house` — everyone, owners and managers. Absent: the
   * house from an owner or manager, the person alone from anyone else.
   */
  snoozeFor?: string | null;
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
    history: TypeToggleAuditReceipt;
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
    // What the toggle lifts or replaces, for the append-only history (round
    // 3, "Keep every label"). A failed read refuses the toggle: the history
    // is the record, and a row it cannot place is not written blind.
    const { current } = await this.ruleWideStatus([ruleKey], restaurantId, patch);
    const row = await this.setAction(
      restaurantId,
      ruleKey,
      patch,
      undefined,
      actorUserId,
    );
    const history = await this.recordHistory(
      restaurantId,
      actorUserId,
      ruleKey,
      current.get(ruleKey) ?? null,
      patch,
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
    return { row, ruleKey, audit, history };
  }

  /**
   * One state write from the feed, a rail, Reports or the catalogue's live
   * items — routed by the founder's round-3 answers (`planAct`) and gated by
   * round 2's (2026-09-21, answer 1: rule-wide dismiss and restore are
   * "owner/manager only and audited EVERYWHERE"; staff keep dismissing a
   * single finding or subject).
   *
   * Routing first, before anything is read or written:
   *   - "Already handled" is recorded as done; "Not now" and any snooze a
   *     staff member makes are that person's own snooze, which hides the card
   *     from them alone and is never written to the house state or history;
   *   - a staff member asking to snooze for everyone is refused (403).
   *
   * Then the house write:
   *   - a rule-wide dismiss or restore (`isRuleWideDismissOrRestore`) needs
   *     an owner, manager or admin (the `RolesGuard` set), is refused with
   *     `RuleWideActForbidden` BEFORE anything is written otherwise, and files
   *     a `system_audit_log` row whose receipt is returned;
   *   - every status write — dismiss, restore, done, snooze — is kept in the
   *     append-only history with its label, who and when (answer 2, "Keep
   *     every label"), and needs a signed-in person to name. The state row
   *     keeps the latest; the history is the record.
   *
   * What the write lifts depends on the row already there, so it is read
   * first; a failed read refuses the write rather than guess (a gate that
   * opens when it cannot see is not a gate, and a history row that cannot
   * say what it replaced is not a record).
   */
  async setActionAs(
    restaurantId: string,
    ruleKey: string,
    patch: RecommendationActionPatch,
    snapshot: RecommendationSnapshot | undefined,
    actor: RecommendationActor,
  ): Promise<ActWriteResult> {
    if (!ruleKey?.trim()) throw new Error("ruleKey is required");
    const route = planAct(patch, actor, this.cardAreasOf(ruleKey), Date.now());
    if (route.to === "refused") throw new ActRefused(route.why, route.forbidden);
    if (route.to === "personal") {
      const personal = await this.snoozeForMe(
        restaurantId,
        ruleKey,
        route.snoozeUntil,
        snapshot,
        actor,
      );
      return {
        row: null,
        audit: null,
        history: null,
        recordedAs: route.recordedAs,
        personal,
      };
    }
    const housePatch = this.routedPatch(patch, route);
    this.validateStatePatch(housePatch);
    this.assertNamedActor(housePatch, actor);
    const { gated, current } = await this.ruleWideStatus(
      [ruleKey],
      restaurantId,
      housePatch,
    );
    if (gated.has(ruleKey)) this.assertMayActRuleWide(actor, 1);
    const row = await this.setAction(
      restaurantId,
      ruleKey,
      housePatch,
      snapshot,
      actor.userId ?? undefined,
    );
    const history =
      housePatch.status === undefined
        ? null
        : await this.recordHistory(
            restaurantId,
            actor.userId as string,
            ruleKey,
            current.get(ruleKey) ?? null,
            housePatch,
          );
    const out: ActWriteResult = {
      row,
      audit: null,
      history,
      recordedAs: route.recordedAs,
      personal: null,
    };
    if (!gated.has(ruleKey)) return out;
    out.audit = await this.fileRuleWideAudit(
      restaurantId,
      actor.userId as string,
      ruleKey,
      gated.get(ruleKey) ?? null,
      housePatch,
    );
    return out;
  }

  /**
   * The bulk bar's write, under the same routing and gate. Refused WHOLE,
   * before any write, when any item is a rule-wide dismiss or restore the
   * actor may not make, or a snooze for everyone they may not make — a
   * half-applied bulk act with a 403 for the rest would leave the page unable
   * to say which entries moved.
   */
  async bulkSetActionAs(
    restaurantId: string,
    items: Array<{ ruleKey: string; snapshot?: RecommendationSnapshot }>,
    patch: RecommendationActionPatch,
    actor: RecommendationActor,
  ): Promise<{
    updated: number;
    audit: { recorded: number; missed: number };
    history: { recorded: number; missed: number };
    snoozedForYou: number;
  }> {
    const now = Date.now();
    const routed = items
      .filter((i) => !!i.ruleKey?.trim())
      .map((it) => ({
        it,
        route: planAct(patch, actor, this.cardAreasOf(it.ruleKey), now),
      }));
    for (const r of routed)
      if (r.route.to === "refused")
        throw new ActRefused(r.route.why, r.route.forbidden);
    const house = routed.filter((r) => r.route.to === "house");
    const mine = routed.filter((r) => r.route.to === "personal");
    // Every house item routes to the same fields: the route depends on the
    // patch and the actor, and on a card's areas only for who a snooze is
    // for — which sends a card to `personal`, never to different fields.
    const housePatch =
      house.length > 0 ? this.routedPatch(patch, house[0].route) : null;
    if (housePatch) {
      this.validateStatePatch(housePatch);
      this.assertNamedActor(housePatch, actor);
    }
    const { gated, current } = housePatch
      ? await this.ruleWideStatus(
          house.map((r) => r.it.ruleKey),
          restaurantId,
          housePatch,
        )
      : { gated: new Map<string, string | null>(), current: new Map() };
    if (gated.size > 0) this.assertMayActRuleWide(actor, gated.size);
    let updated = 0;
    const audit = { recorded: 0, missed: 0 };
    const history = { recorded: 0, missed: 0 };
    for (const { it } of house) {
      try {
        await this.setAction(
          restaurantId,
          it.ruleKey,
          housePatch as RecommendationActionPatch,
          it.snapshot,
          actor.userId ?? undefined,
        );
        updated++;
      } catch (err: any) {
        this.logger.warn(`bulkSetActionAs ${it.ruleKey}: ${err?.message}`);
        continue;
      }
      if (housePatch?.status !== undefined) {
        const kept = await this.recordHistory(
          restaurantId,
          actor.userId as string,
          it.ruleKey,
          current.get(it.ruleKey) ?? null,
          housePatch as RecommendationActionPatch,
        );
        if (kept.recorded) history.recorded++;
        else history.missed++;
      }
      if (!gated.has(it.ruleKey)) continue;
      const receipt = await this.fileRuleWideAudit(
        restaurantId,
        actor.userId as string,
        it.ruleKey,
        gated.get(it.ruleKey) ?? null,
        housePatch as RecommendationActionPatch,
      );
      if (receipt.recorded) audit.recorded++;
      else audit.missed++;
    }
    let snoozedForYou = 0;
    for (const { it, route } of mine) {
      try {
        await this.snoozeForMe(
          restaurantId,
          it.ruleKey,
          (route as { snoozeUntil: string }).snoozeUntil,
          it.snapshot,
          actor,
        );
        updated++;
        snoozedForYou++;
      } catch (err: any) {
        if (err instanceof ActRefused) throw err;
        this.logger.warn(`bulk snooze-for-me ${it.ruleKey}: ${err?.message}`);
      }
    }
    return { updated, audit, history, snoozedForYou };
  }

  /** The patch a house route writes: the caller's fields, the routed state. */
  private routedPatch(
    patch: RecommendationActionPatch,
    route: { to: string } & Partial<{
      status: string | undefined;
      reason: string | null | undefined;
      snoozeUntil: string | null | undefined;
    }>,
  ): RecommendationActionPatch {
    const out: RecommendationActionPatch = { ...patch };
    delete out.snoozeFor;
    if (route.status === undefined) return out;
    out.status = route.status as RecommendationStatus;
    out.reason = route.reason;
    out.snoozeUntil = route.snoozeUntil;
    return out;
  }

  /**
   * The areas a card belongs to — the areas lane's hook (round 3, answer 4).
   * No card carries an area until that lane lands, so this is always empty
   * and "snooze for everyone" is owners and managers only.
   */
  cardAreasOf(_ruleKey: string): ReadonlyArray<string> {
    return [];
  }

  /**
   * For each key under a status write: the status it has now (null when it
   * has no row) in `current`, and — in `gated` — the keys this patch would
   * dismiss or lift as a WHOLE rule, with that same status. A write that
   * changes no status reads nothing. A failed read throws: what a write
   * lifts decides both the gate and the history row.
   */
  private async ruleWideStatus(
    keys: string[],
    restaurantId: string,
    patch: RecommendationActionPatch,
  ): Promise<{
    gated: Map<string, string | null>;
    current: Map<string, string | null>;
  }> {
    const gated = new Map<string, string | null>();
    const current = new Map<string, string | null>();
    if (patch.status === undefined || keys.length === 0)
      return { gated, current };
    const { data, error } = await this.dbService
      .getClient()
      .from("recommendation_actions")
      .select("rule_key,status")
      .eq("restaurant_id", restaurantId)
      .in("rule_key", keys);
    if (error)
      throw new Error(
        `Could not read the item's current state, so could not tell whether this lifts a rule-wide dismissal, or keep it in the history: ${error.message}`,
      );
    const now = new Map<string, string>();
    for (const r of data || []) now.set(String(r.rule_key), String(r.status));
    for (const k of keys) {
      const was = now.get(k) ?? null;
      current.set(k, was);
      if (isRuleWideDismissOrRestore(k, patch.status, was)) gated.set(k, was);
    }
    return { gated, current };
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

  /**
   * Every house status write names who made it — the history is "who and
   * when" (round 3, answer 2). No person, no write.
   */
  private assertNamedActor(
    patch: RecommendationActionPatch,
    actor: RecommendationActor,
  ): void {
    if (patch.status !== undefined && !actor.userId)
      throw new ActRefused(
        "A signed-in user is required — every dismiss, restore, done and snooze is kept with who made it.",
        true,
      );
  }

  /**
   * One row in the append-only history (round 3, answer 2 — the founder:
   * "Keep every label"). Dismiss, restore, done and snooze, each with the
   * status it lifted, its label, who and when. Never throws, on the audit
   * contract: the state has already changed, and failing the request because
   * the paper failed would report a change that took effect as one that did
   * not. The receipt goes back to the client, which says when it missed.
   */
  private async recordHistory(
    restaurantId: string,
    actorUserId: string,
    ruleKey: string,
    from: string | null,
    patch: RecommendationActionPatch,
  ): Promise<TypeToggleAuditReceipt> {
    const act = historyActOf(String(patch.status));
    let receipt: TypeToggleAuditReceipt;
    if (!act) {
      receipt = {
        recorded: false,
        reason: `no history act for status '${patch.status}'`,
      };
    } else {
      try {
        const { error } = await this.dbService
          .getClient()
          .from("recommendation_action_history")
          .insert({
            restaurant_id: restaurantId,
            rule_key: ruleKey,
            act,
            status_from: from,
            status_to: patch.status,
            reason: patch.status === "dismissed" ? (patch.reason ?? null) : null,
            snooze_until:
              patch.status === "snoozed" ? (patch.snoozeUntil ?? null) : null,
            rule_wide: isRuleWideKey(ruleKey),
            actor_id: actorUserId,
          });
        receipt = error
          ? { recorded: false, reason: error.message }
          : { recorded: true, reason: null };
      } catch (err: any) {
        receipt = { recorded: false, reason: err?.message || String(err) };
      }
    }
    if (!receipt.recorded)
      this.logger.error(
        `${act ?? patch.status} on ${ruleKey} happened but the history row did not write: ${receipt.reason}`,
      );
    return receipt;
  }

  // ---- The person's own snooze (round 3, answer 4 — "Only them") -----------

  /**
   * Hide one card from ONE person until `snoozeUntil`. Everyone else keeps
   * seeing it; nothing is written to the house state, its history or the
   * house log — the founder: a staff snooze is "Only them", and it is not
   * written to the house history. The row holds the key, the instant and the
   * card's own text for the person's Snoozed leaf, and nothing about why
   * (KVKK: the minimum). It is deleted when the person wakes it, and expired
   * rows are cleared on the person's next snooze.
   */
  private async snoozeForMe(
    restaurantId: string,
    ruleKey: string,
    snoozeUntil: string,
    snapshot: RecommendationSnapshot | undefined,
    actor: RecommendationActor,
  ): Promise<PersonalSnoozeRow> {
    if (!actor.userId)
      throw new ActRefused(
        "A signed-in user is required to snooze a card for yourself.",
        true,
      );
    if (!snoozeHolds(snoozeUntil, Date.now()))
      throw new ActRefused(
        "A snooze needs a snoozeUntil instant in the future",
        false,
      );
    const row: Record<string, unknown> = {
      restaurant_id: restaurantId,
      user_id: actor.userId,
      rule_key: ruleKey,
      snooze_until: snoozeUntil,
      updated_at: new Date().toISOString(),
    };
    if (snapshot?.observation !== undefined)
      row.observation = snapshot.observation;
    if (snapshot?.recommendation !== undefined)
      row.recommendation = snapshot.recommendation;
    if (snapshot?.category !== undefined) row.category = snapshot.category;
    if (snapshot?.urgency !== undefined) row.urgency = snapshot.urgency;
    const { data, error } = await this.dbService
      .getClient()
      .from("recommendation_personal_snoozes")
      .upsert(row, { onConflict: "restaurant_id,user_id,rule_key" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    void this.clearExpiredForMe(restaurantId, actor.userId);
    return this.toPersonal(data);
  }

  /** Housekeeping: drop this person's snoozes that have ended. Never throws. */
  private async clearExpiredForMe(
    restaurantId: string,
    userId: string,
  ): Promise<void> {
    try {
      const { error } = await this.dbService
        .getClient()
        .from("recommendation_personal_snoozes")
        .delete()
        .eq("restaurant_id", restaurantId)
        .eq("user_id", userId)
        .lte("snooze_until", new Date().toISOString());
      if (error)
        this.logger.warn(`clearing ended personal snoozes: ${error.message}`);
    } catch (err: any) {
      this.logger.warn(`clearing ended personal snoozes: ${err?.message}`);
    }
  }

  /**
   * Wake a card for this person — their own snooze on it ends now. Returns
   * whether there was one. A failed delete throws: "it is back" must not be
   * said over a snooze that still holds.
   */
  async wakeForMe(
    restaurantId: string,
    userId: string,
    ruleKey: string,
  ): Promise<{ woke: boolean }> {
    if (!userId)
      throw new ActRefused("A signed-in user is required.", true);
    if (!ruleKey?.trim()) throw new Error("ruleKey is required");
    const { data, error } = await this.dbService
      .getClient()
      .from("recommendation_personal_snoozes")
      .delete()
      .eq("restaurant_id", restaurantId)
      .eq("user_id", userId)
      .eq("rule_key", ruleKey)
      .select("rule_key");
    if (error) throw new Error(error.message);
    return { woke: Array.isArray(data) && data.length > 0 };
  }

  /** This person's snoozes still in force, newest first. A failed read throws. */
  async listForMe(
    restaurantId: string,
    userId: string,
  ): Promise<PersonalSnoozeRow[]> {
    if (!userId)
      throw new ActRefused("A signed-in user is required.", true);
    const { data, error } = await this.dbService
      .getClient()
      .from("recommendation_personal_snoozes")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("user_id", userId)
      .gt("snooze_until", new Date().toISOString())
      .order("snooze_until", { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map((d) => this.toPersonal(d));
  }

  /**
   * This person's snoozes as a book — `readable: false` when they could not
   * be read, which a caller must say rather than show a clean list.
   */
  async readPersonalBook(
    restaurantId: string,
    userId: string,
  ): Promise<{ book: PersonalBook; readable: boolean; problem: string | null }> {
    try {
      const rows = await this.listForMe(restaurantId, userId);
      return { book: personalBookFrom(rows), readable: true, problem: null };
    } catch (err: any) {
      const problem = err?.message || "personal snoozes could not be read";
      this.logger.warn(`readPersonalBook failed: ${problem}`);
      return { book: new Map(), readable: false, problem };
    }
  }

  /**
   * The personal step, for a surface a named person is looking at (their
   * feed, their catalogue, their rails and Reports): drop what they snoozed
   * for themselves. Readers with no person — the digest, the MCP reader, the
   * stored cache — never call it, so the house state stays the one truth.
   */
  async viewFor<T>(
    restaurantId: string,
    userId: string | null,
    items: T[],
    targetOf: (item: T) => SuppressionTarget,
  ): Promise<{
    kept: T[];
    hiddenForYou: number;
    personalSnoozesReadable: boolean;
  }> {
    if (!userId)
      return { kept: items, hiddenForYou: 0, personalSnoozesReadable: false };
    const { book, readable } = await this.readPersonalBook(restaurantId, userId);
    const view = personalView(items, targetOf, book);
    return { ...view, personalSnoozesReadable: readable };
  }

  private toPersonal(d: any): PersonalSnoozeRow {
    return {
      ruleKey: String(d?.rule_key ?? ""),
      snoozeUntil: String(d?.snooze_until ?? ""),
      observation: d?.observation ?? null,
      recommendation: d?.recommendation ?? null,
      category: d?.category ?? null,
      urgency: d?.urgency ?? null,
      updatedAt: d?.updated_at ?? null,
    };
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

  /**
   * `digest_hour ?? 7` and `digest_min_urgency ?? "this_week"` are the
   * COLUMN'S OWN defaults, applied here so a never-written house still gets a
   * usable value if something schedules off this read. They are not an
   * answer: a house that has never opened `recommendation_digest_prefs` looks,
   * from this shape alone, identical to one that explicitly chose 07:00 and
   * "this week or sooner" — the exact collapse ADR 0020 forbids, one column
   * default at a time.
   *
   * `stated` (added 2026-09-17, settings page sketch 109A honesty pass) and
   * `set` (recommendations page name, PR #420) are the same boolean under two
   * names: `true` when a row exists for this restaurant, `false` when `data`
   * is null and every value above is the service's own default rather than
   * something a person chose. Additive either way — a caller that ignores
   * both fields sees the same response it always has.
   */
  async getDigestPref(restaurantId: string) {
    // A failed read throws. Until 2026-09-16 it returned the defaults below —
    // "digest off, 07:00" — for a preference that could not be read, which was
    // harmless while nothing sent the digest and is not now that the sender
    // reads this row (analytics/digest/recommendation-digest.service.ts).
    const { data, error } = await this.dbService
      .getClient()
      .from("recommendation_digest_prefs")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (error)
      throw new Error(
        `recommendation_digest_prefs could not be read: ${error.message}`,
      );
    return {
      // `false` when no row exists for this house at all — the caller must
      // not read the defaults below (`digestEnabled: false, digestHour: 7`)
      // as a fact about what the house chose. See sketch 120's read-shape
      // note: a house that never touched this setting must never be shown
      // as "armed the post, then turned it off, at 07:00".
      // `set` is the recommendations page's name (PR #420); `stated` is the
      // settings honesty field (sketch 109A / main). Same boolean both ways.
      set: !!data,
      stated: !!data,
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
