import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { MembersService } from "./members.service";
import {
  SettingsAuditService,
  type AuditReceipt,
} from "../settings-audit/settings-audit.service";
import {
  OperatingHours,
  OperatingHoursError,
  parseOperatingHours,
  toJson,
} from "../common/operating-hours/operating-hours";
import { houseFrame, ZoneSource } from "../common/house-frame";

export interface OperatingHoursResponse {
  restaurantId: string;
  /**
   * The zone the house's day is read in — `houseFrame` (ADR 0207): its own
   * zone, else its country's only zone, else null. Never UTC by default. The
   * same rule the dashboard, the exports and the goals read the house by, so
   * the day line and the dashboard keep one clock (F-838).
   */
  timezone: string | null;
  /** Where `timezone` came from: the house's own record, or its country. */
  timezoneSource: ZoneSource;
  /** null means UNKNOWN — never `{}` and never an all-closed week (ADR 0020). */
  operatingHours: OperatingHours | null;
  updatedAt: string | null;
  /**
   * Present only when the column HOLDS something that does not parse. Without
   * it, corrupt stored hours and never-set hours would both arrive as
   * `operatingHours: null` and render identically as "not set" — the same
   * collapse this endpoint exists to prevent, one level down.
   */
  storedHoursErrors?: string[];
  /**
   * Whether this write reached "What changed here" (F-503). Present on a
   * PUT only; a failed audit row is said, never swallowed.
   */
  audited?: boolean;
  auditReason?: string | null;
}

/**
 * One spelling for a stored week: jsonb hands keys back in its own order, so
 * a plain stringify would file a re-save of the same hours as a change.
 */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/**
 * A week as the reader was shown it, in one spelling, so the week a page
 * read and the week now stored compare equal when they are the same hours.
 * A stored week that does not parse was shown as unknown (`toResponse`), so
 * it compares as null and a sheet opened to repair it is not refused.
 */
function weekKey(v: unknown): string {
  if (v === null || v === undefined) return canonical(null);
  try {
    return canonical(toJson(parseOperatingHours(v)));
  } catch {
    return canonical(null);
  }
}

/** Filed under the "hours" register in `system_audit_log` (F-503). */
export const OPERATING_HOURS_AUDIT_ACTION = "operating_hours_changed" as const;

/**
 * Read and write `restaurants.operating_hours` (ADR 0093 D1).
 *
 * Two properties this service exists to hold:
 *
 * 1. **null survives the round trip.** A venue whose hours are unknown reads
 *    back as `operatingHours: null`, not as `{}` and not as seven empty days.
 *    Those three are different facts — "we do not know", "someone saved an
 *    empty object", "the venue never opens" — and collapsing them is the
 *    fabricated answer ADR 0020 forbids.
 * 2. **A failed read is never an empty one** (ADR 0067). supabase-js resolves
 *    with `{ data, error }`, so a dropped connection and a missing venue both
 *    arrive as `data: null`. Every read below binds `error` and throws on it;
 *    only a genuinely absent row becomes a 404.
 */
@Injectable()
export class OperatingHoursService {
  private readonly logger = new Logger(OperatingHoursService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly membersService: MembersService,
    private readonly audit: SettingsAuditService,
  ) {}

  async getOperatingHours(
    actorUserId: string,
    restaurantId: string,
  ): Promise<OperatingHoursResponse> {
    // Any member may read the hours — they are not sensitive and every surface
    // that renders a service day needs them. Writing is owner/manager (below).
    await this.membersService.assertMembership(actorUserId, restaurantId);

    const { data, error } = await this.databaseService.supabase
      .from("restaurants")
      .select("id, timezone, country, operating_hours, updated_at")
      .eq("id", restaurantId)
      .maybeSingle();

    if (error) {
      // ADR 0067: `data` is null for BOTH "no such restaurant" and "the query
      // failed". Answering a dead read with a 404 — or worse, with
      // `operatingHours: null`, which the UI renders as "hours not set" — would
      // report a failure as a fact about the venue.
      this.logger.error(
        `operating-hours read failed for restaurant ${restaurantId}: ` +
          `${error.code ?? "?"} ${error.message ?? error}`,
      );
      throw new InternalServerErrorException(
        "Could not read this restaurant's operating hours",
      );
    }
    if (!data) throw new NotFoundException("Restaurant not found");

    return this.toResponse(restaurantId, data);
  }

  /**
   * `opts.explicit` says the request actually carried an `operatingHours` key.
   * A body that omitted it is REFUSED rather than treated as null: a renamed or
   * misspelt field would otherwise erase a venue's hours and report success.
   *
   * `opts.expected`, when sent, is the week the caller's sheet opened on
   * (F-1373). The sheet saves the whole week, so a second manager who fixed
   * Tuesday while the first fixed Friday lost Tuesday. Now, when the stored
   * week is no longer the one that was read, nothing is written and a 409
   * says so.
   */
  async putOperatingHours(
    actorUserId: string,
    restaurantId: string,
    raw: unknown,
    opts: { explicit: boolean; expected?: unknown } = { explicit: true },
  ): Promise<OperatingHoursResponse> {
    await this.membersService.assertMembership(
      actorUserId,
      restaurantId,
      "owner|manager",
    );

    if (!opts.explicit) {
      throw new BadRequestException({
        message: "operating_hours invalid",
        errors: [
          "body must carry an `operatingHours` key — null is an explicit " +
            "answer, a missing key is not",
        ],
      });
    }

    // `null` is a legitimate value to write: it is how an owner says "I do not
    // know / no longer want to claim these hours". It is NOT the same as saving
    // seven empty days, which claims the venue never opens.
    let toStore: Record<string, unknown> | null = null;
    if (raw !== null && raw !== undefined) {
      try {
        toStore = toJson(parseOperatingHours(raw));
      } catch (e) {
        if (e instanceof OperatingHoursError) {
          throw new BadRequestException({
            message: "operating_hours invalid",
            errors: e.errors,
          });
        }
        throw e;
      }
    }

    // The value before, for "What changed here" (F-503). A failed read here
    // refuses the write, the same rule the read path holds (ADR 0067): an
    // audit row whose `from` is a guess is worse than none.
    const prior = await this.databaseService.supabase
      .from("restaurants")
      .select("operating_hours, updated_at")
      .eq("id", restaurantId)
      .maybeSingle();
    if (prior.error) {
      this.logger.error(
        `operating-hours read-before-write failed for restaurant ${restaurantId}: ` +
          `${prior.error.code ?? "?"} ${prior.error.message ?? prior.error}`,
      );
      throw new InternalServerErrorException(
        "Could not read this restaurant's operating hours, so nothing was changed",
      );
    }
    if (!prior.data) throw new NotFoundException("Restaurant not found");
    const previous =
      (prior.data as { operating_hours?: unknown }).operating_hours ?? null;
    const guarded = "expected" in opts;
    const changedSince = () =>
      new ConflictException(
        "Someone else changed the opening hours after you opened this sheet, so your change was not saved. " +
          "Close it and open it again to see their hours, then make your change.",
      );
    if (guarded && weekKey(previous) !== weekKey(opts.expected))
      throw changedSince();

    let write = this.databaseService.supabase
      .from("restaurants")
      .update({
        operating_hours: toStore,
        updated_at: new Date().toISOString(),
      })
      .eq("id", restaurantId);
    // Between the read above and this write, the row must not have moved.
    const priorAt = (prior.data as { updated_at?: string | null }).updated_at;
    if (guarded && priorAt) write = write.eq("updated_at", priorAt);
    const { data, error } = await write
      .select("id, timezone, country, operating_hours, updated_at")
      .maybeSingle();

    if (error) {
      this.logger.error(
        `operating-hours write failed for restaurant ${restaurantId}: ` +
          `${error.code ?? "?"} ${error.message ?? error}`,
      );
      throw new InternalServerErrorException(
        "Could not save this restaurant's operating hours",
      );
    }
    // An UPDATE that matched no row returns `data: null` with no error. Saying
    // "saved" over that would be the write-path form of the same lie.
    if (!data) {
      if (guarded && priorAt) throw changedSince();
      throw new NotFoundException("Restaurant not found");
    }

    const receipt: AuditReceipt =
      canonical(previous) === canonical(toStore)
        ? { recorded: false, reason: "nothing changed" }
        : await this.audit.record({
            restaurantId,
            actorUserId,
            action: OPERATING_HOURS_AUDIT_ACTION,
            register: "hours",
            entityType: "restaurant",
            entityId: restaurantId,
            subject: "opening hours",
            fields: { operating_hours: { from: previous, to: toStore } },
          });

    return {
      ...this.toResponse(restaurantId, data),
      audited: receipt.recorded,
      auditReason: receipt.reason,
    };
  }

  /**
   * The stored row as the API shape.
   *
   * A stored value that does not parse is a real possibility — the column's
   * CHECK only enforces `jsonb_typeof = 'object'`, and rows can be written by a
   * script or by an older contract. It is reported as `operatingHours: null`
   * PLUS `storedHoursErrors`, never repaired into something a caller would
   * treat as the venue's hours and never silently identical to "not set".
   */
  private toResponse(
    restaurantId: string,
    row: {
      timezone?: string | null;
      country?: string | null;
      operating_hours?: unknown;
      updated_at?: string | null;
    },
  ): OperatingHoursResponse {
    const frame = houseFrame(row);
    const base: OperatingHoursResponse = {
      restaurantId,
      timezone: frame.zone,
      timezoneSource: frame.zoneSource,
      operatingHours: null,
      updatedAt: row.updated_at ?? null,
    };
    const stored = row.operating_hours;
    if (stored === null || stored === undefined) return base;
    try {
      base.operatingHours = toJson(
        parseOperatingHours(stored),
      ) as OperatingHours;
      return base;
    } catch (e) {
      const errors = e instanceof OperatingHoursError ? e.errors : [String(e)];
      this.logger.error(
        `restaurants.operating_hours for ${restaurantId} does not parse and is ` +
          `reported as unknown: ${errors.join("; ")}`,
      );
      return { ...base, storedHoursErrors: errors };
    }
  }
}
