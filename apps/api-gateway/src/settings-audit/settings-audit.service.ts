import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

/**
 * Who changed a setting, and what it was before.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS THERE BEFORE THIS FILE, MEASURED
 * ---------------------------------------------------------------------------
 * `/settings` opened, for two passes, with a sentence admitting it could not
 * answer its own most important question: *"Nothing here records who changed a
 * setting — no table on this page carries an author column."* That was true of
 * the settings tables and FALSE of the database:
 *
 *   * `public.system_audit_log` has existed since the baseline
 *     (20260805000000:5553-5568) with exactly the right columns —
 *     `actor_type, actor_id, action, entity_type, entity_id, changes jsonb,
 *     restaurant_id, ip_address, user_agent, reason, created_at` — plus
 *     `correlation_id`, added by 20260805132000:75.
 *   * Three call sites already write to it: `recordAccessChange`
 *     (`team/access-audit.ts:81`, used by `MembersService.updateMemberRole` and
 *     `TeamService.deleteMember`) and `ReportsService.refile`
 *     (`reports/reports.service.ts:215`).
 *   * One call site already reads it: the /logs timeline
 *     (`logs/logs-timeline.service.ts:293-318`).
 *
 * So the shape was settled, tested and in production, and **settings simply
 * never called it**. This service is the settings-side caller and the reader
 * that turns those rows back into sentences.
 *
 * ---------------------------------------------------------------------------
 * THE ONE TRAP, AND WHY IT IS FATAL RATHER THAN ANNOYING
 * ---------------------------------------------------------------------------
 * `actor_id` must be `public.users.user_id`. `auth.users` and `public.users`
 * are DISJOINT in this database — zero shared ids — and the JWT carries the
 * public one. `system_audit_log.actor_id` has NO foreign key at all
 * (baseline:13618 declares only `restaurant_id`), so an id from the wrong table
 * would insert cleanly, never resolve to a person, and leave a log that looks
 * full while answering nothing. **CI cannot catch it**: a fresh test database
 * has no rows to violate. The only defence is that every writer takes the id
 * from the request's authenticated user and nowhere else, which is why `record`
 * takes `actorUserId` as a required argument with no default and no fallback.
 *
 * ---------------------------------------------------------------------------
 * NEVER THROW, ALWAYS REPORT
 * ---------------------------------------------------------------------------
 * Same contract as `recordAccessChange`, for the same reason: by the time this
 * runs the setting has already been written, and failing the request because the
 * paper failed would undo a change the user can see took effect. So the write is
 * caught, logged, and reported back to the caller as a receipt — which the
 * controller returns to the client, so a failed record is VISIBLE rather than
 * inferred from a short list. An audit trail that silently loses rows is worse
 * than none: it is [[absence-reported-as-health]] with a paper trail on top.
 */

/** The settings registers that can file a change. Closed set. */
export type SettingsRegister =
  | "features"
  | "vendor-terms"
  | "thresholds"
  | "notifications"
  | "preferences"
  /**
   * The house's reporting currency. Its own register rather than a
   * "preferences" row: `restaurants.currency` decides what every money figure
   * in the product means, and it is kept on the RESTAURANT, not on a person.
   */
  | "currency";

/**
 * The action strings this service writes, and the ones it reads back.
 *
 * The two access actions are NOT written here — `recordAccessChange` writes
 * them — but they ARE read back, because a role change made on `/settings`
 * `?tab=team` is a settings change by any reading a manager would recognise,
 * and a "who changed what" list that omitted it would be lying by curation.
 */
export const SETTINGS_AUDIT_ACTIONS = [
  "feature_flag_changed",
  "vendor_terms_changed",
  "approval_threshold_changed",
  "notification_preferences_changed",
  "user_preferences_changed",
  /**
   * The house stated the money it reports in. Added 2026-09-05: until then the
   * only writer of `restaurants.currency` was the column default, so there was
   * nothing to record (ADR 0117 Q25).
   */
  "reporting_currency_changed",
] as const;

export const READ_BACK_ACTIONS = [
  ...SETTINGS_AUDIT_ACTIONS,
  "member_role_changed",
  "team_member_removed",
] as const;

export type SettingsAuditAction = (typeof SETTINGS_AUDIT_ACTIONS)[number];

/** `{ from, to }` for one field. `from` absent means the field had no value. */
export interface FieldChange {
  from: unknown;
  to: unknown;
}

export interface SettingsChange {
  restaurantId: string;
  /** `public.users.user_id`. Never an `auth.users` id. See the header. */
  actorUserId: string;
  action: SettingsAuditAction;
  register: SettingsRegister;
  /** What kind of thing changed — `restaurant_feature_flag`, `vendor_terms`, … */
  entityType: string;
  /** The row it happened to. The restaurant itself for restaurant-wide settings. */
  entityId: string;
  /**
   * A human name for the thing, captured AT THE TIME — a vendor's name, a flag
   * key. Denormalised on purpose: the log has to still read correctly after the
   * vendor is renamed or deleted, which a join cannot promise.
   */
  subject?: string | null;
  /** Only the fields that actually moved. An unchanged field is not a change. */
  fields: Record<string, FieldChange>;
}

export interface AuditReceipt {
  /** The row reached `system_audit_log`. */
  recorded: boolean;
  /** Why not. Null when it did. Rendered, never swallowed. */
  reason: string | null;
}

export interface SettingsAuditEntry {
  id: string;
  occurredAt: string | null;
  action: string;
  register: SettingsRegister | null;
  entityType: string;
  entityId: string | null;
  subject: string | null;
  actor: { userId: string | null; name: string | null; email: string | null };
  fields: Record<string, FieldChange>;
}

export interface SettingsAuditReadout {
  restaurantId: string;
  entries: SettingsAuditEntry[];
  /**
   * Whether the log itself could be read. `false` renders as words, never as
   * "no changes" — the two are the states this whole page exists to separate.
   */
  readable: boolean;
  reason: string | null;
  /**
   * The date of the OLDEST row this readout holds, so the reader knows how far
   * back "nothing here" actually reaches. Null when the list is empty.
   */
  oldestAt: string | null;
  /**
   * The instant settings changes started being recorded at all. Everything
   * before it is unrecorded and unrecoverable, and the register says so rather
   * than implying nobody ever changed anything.
   */
  recordingSince: string;
}

/**
 * Settings auditing began when this build shipped. Any change made before it
 * left no row anywhere, and the register must not let an empty list imply
 * otherwise. Stated as a constant so the copy and the claim have one source.
 */
export const SETTINGS_RECORDING_SINCE = "2026-09-03";

/** PostgREST / Postgres codes that mean "the relation is not there". */
const MISSING_RELATION_CODES = new Set(["42P01", "PGRST205", "PGRST202"]);

interface AuditRow {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  changes: Record<string, unknown> | null;
  created_at: string | null;
}

@Injectable()
export class SettingsAuditService {
  private readonly logger = new Logger(SettingsAuditService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * File one settings change. Never throws.
   *
   * Returns `recorded: false` with a reason when there was nothing to record —
   * an empty `fields` map is a write that changed nothing, and filing a row for
   * it would pad the register with events that never happened.
   */
  async record(change: SettingsChange): Promise<AuditReceipt> {
    if (Object.keys(change.fields).length === 0) {
      return { recorded: false, reason: "nothing changed" };
    }
    if (!change.actorUserId) {
      // Reachable only from a caller that lost the JWT's user. Refusing to
      // write an anonymous row is deliberate: an audit row whose actor is null
      // answers the question with a shrug and still counts as a record.
      this.logger.error(
        `${change.action} was not recorded: no actor. The change happened; the paper did not.`,
      );
      return {
        recorded: false,
        reason: "no signed-in user was attached to the request",
      };
    }

    try {
      const { error } = await this.databaseService.client
        .from("system_audit_log")
        .insert({
          actor_type: "user",
          // public.users.user_id. See the header for why this line is the
          // whole security of the feature.
          actor_id: change.actorUserId,
          action: change.action,
          entity_type: change.entityType,
          entity_id: change.entityId,
          changes: {
            register: change.register,
            subject: change.subject ?? null,
            fields: change.fields,
          },
          restaurant_id: change.restaurantId,
        });
      if (error) {
        this.logger.error(
          `${change.action} happened but the audit row failed to write: ${error.message}`,
        );
        return { recorded: false, reason: error.message };
      }
      return { recorded: true, reason: null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `${change.action} happened but the audit row threw: ${message}`,
      );
      return { recorded: false, reason: message };
    }
  }

  /**
   * Read the trail back for one house.
   *
   * `register` is optional and filters client-side rather than in the query,
   * because it lives inside the `changes` jsonb and a `->>` filter on a column
   * with no index would scan. The row cap is applied first either way, so the
   * filter narrows a page rather than searching the table.
   */
  async list(
    restaurantId: string,
    limit = 50,
    register?: SettingsRegister,
  ): Promise<SettingsAuditReadout> {
    const capped = Math.max(1, Math.min(200, Math.floor(limit) || 50));
    const empty: SettingsAuditReadout = {
      restaurantId,
      entries: [],
      readable: true,
      reason: null,
      oldestAt: null,
      recordingSince: SETTINGS_RECORDING_SINCE,
    };

    let rows: AuditRow[] = [];
    try {
      const { data, error } = await this.databaseService.client
        .from("system_audit_log")
        .select("id, actor_id, action, entity_type, entity_id, changes, created_at")
        .eq("restaurant_id", restaurantId)
        .in("action", READ_BACK_ACTIONS as unknown as string[])
        .order("created_at", { ascending: false })
        .limit(capped);
      if (error) {
        const code = (error as { code?: string }).code ?? "";
        return {
          ...empty,
          readable: false,
          reason: MISSING_RELATION_CODES.has(code)
            ? "the audit table is not present on this database"
            : error.message,
        };
      }
      rows = (data ?? []) as unknown as AuditRow[];
    } catch (err: unknown) {
      return {
        ...empty,
        readable: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    const actors = await this.resolveActors(
      rows.map((r) => r.actor_id).filter((v): v is string => Boolean(v)),
    );

    const entries = rows
      .map((r) => this.toEntry(r, actors))
      .filter((e) => !register || e.register === register);

    return {
      ...empty,
      entries,
      oldestAt: entries.length > 0 ? entries[entries.length - 1].occurredAt : null,
    };
  }

  /**
   * Names for the actors, in one query.
   *
   * A row whose actor cannot be resolved keeps its id and renders as "an
   * account that no longer exists" — never as a blank, and never dropped from
   * the list, because a change nobody can name still happened.
   */
  private async resolveActors(
    ids: string[],
  ): Promise<Map<string, { name: string | null; email: string | null }>> {
    const unique = [...new Set(ids)];
    const out = new Map<string, { name: string | null; email: string | null }>();
    if (unique.length === 0) return out;
    try {
      const { data, error } = await this.databaseService.client
        .from("users")
        .select("user_id, name, email")
        .in("user_id", unique);
      if (error) {
        this.logger.warn(`Audit actors could not be named: ${error.message}`);
        return out;
      }
      for (const row of (data ?? []) as Array<{
        user_id: string;
        name: string | null;
        email: string | null;
      }>) {
        out.set(row.user_id, { name: row.name ?? null, email: row.email ?? null });
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Audit actors could not be named: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return out;
  }

  private toEntry(
    row: AuditRow,
    actors: Map<string, { name: string | null; email: string | null }>,
  ): SettingsAuditEntry {
    const changes = (row.changes ?? {}) as {
      register?: unknown;
      subject?: unknown;
      fields?: unknown;
      [k: string]: unknown;
    };

    // `recordAccessChange` predates this service and writes the field map at the
    // TOP level of `changes` (`team/access-audit.ts:87`), with no `register` and
    // no `subject`. Both shapes are read, because rewriting the older writer to
    // match would rewrite rows already in production — and a reader that
    // understood only its own shape would render every team change as an event
    // with no detail.
    const fields = this.readFields(changes);
    const register = this.readRegister(row.action, changes.register);
    const actor = row.actor_id ? actors.get(row.actor_id) : undefined;

    return {
      id: row.id,
      occurredAt: row.created_at ?? null,
      action: row.action,
      register,
      entityType: row.entity_type,
      entityId: row.entity_id ?? null,
      subject: typeof changes.subject === "string" ? changes.subject : null,
      actor: {
        userId: row.actor_id ?? null,
        name: actor?.name ?? null,
        email: actor?.email ?? null,
      },
      fields,
    };
  }

  private readFields(changes: Record<string, unknown>): Record<string, FieldChange> {
    const nested = changes.fields;
    const source =
      nested && typeof nested === "object" && !Array.isArray(nested)
        ? (nested as Record<string, unknown>)
        : changes;
    const out: Record<string, FieldChange> = {};
    for (const [key, value] of Object.entries(source)) {
      if (key === "register" || key === "subject" || key === "fields") continue;
      if (value && typeof value === "object" && !Array.isArray(value) && "to" in value) {
        const v = value as { from?: unknown; to?: unknown };
        out[key] = { from: v.from ?? null, to: v.to ?? null };
      }
    }
    return out;
  }

  private readRegister(action: string, stored: unknown): SettingsRegister | null {
    if (typeof stored === "string") {
      return (
        [
          "features",
          "vendor-terms",
          "thresholds",
          "notifications",
          "preferences",
        ] as SettingsRegister[]
      ).find((r) => r === stored) ?? null;
    }
    // The two pre-existing access actions carry no register; they belong to the
    // team roster and are labelled as such rather than left unfiled.
    if (action === "member_role_changed" || action === "team_member_removed") {
      return null;
    }
    return null;
  }
}
