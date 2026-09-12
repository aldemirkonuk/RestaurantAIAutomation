import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { MembersService } from "./members.service";
import {
  OperatingHours,
  OperatingHoursError,
  parseOperatingHours,
  toJson,
} from "../common/operating-hours/operating-hours";

export interface OperatingHoursResponse {
  restaurantId: string;
  /** The venue's IANA zone, or null when it has none. Never defaulted. */
  timezone: string | null;
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
}

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
      .select("id, timezone, operating_hours, updated_at")
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
   */
  async putOperatingHours(
    actorUserId: string,
    restaurantId: string,
    raw: unknown,
    opts: { explicit: boolean } = { explicit: true },
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

    const { data, error } = await this.databaseService.supabase
      .from("restaurants")
      .update({
        operating_hours: toStore,
        updated_at: new Date().toISOString(),
      })
      .eq("id", restaurantId)
      .select("id, timezone, operating_hours, updated_at")
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
    if (!data) throw new NotFoundException("Restaurant not found");

    return this.toResponse(restaurantId, data);
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
      operating_hours?: unknown;
      updated_at?: string | null;
    },
  ): OperatingHoursResponse {
    const base: OperatingHoursResponse = {
      restaurantId,
      timezone: row.timezone ?? null,
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
