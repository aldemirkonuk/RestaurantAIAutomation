import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { resolveZone } from "../calendar/zoned-time";
import { DatabaseService } from "../database/database.service";
import { SettingsAuditService } from "../settings-audit/settings-audit.service";

/**
 * The clock this house keeps — read, and stated by a person (ADR 0207).
 *
 * THE FOUNDER, 2026-09-21, asked where a house's time zone is set: *"Add it to
 * Settings"*. The vendor scorecard's on-time line reads a delivery against
 * midnight at the end of its expected day ON THE HOUSE'S CLOCK (question 6,
 * "House's local midnight"), from `restaurants.timezone`. That column had no
 * writer a person could reach: the real tenant's value was cleared with the
 * old `America/New_York` default (`20260903170000`), so its on-time line reads
 * the no-zone span — a landing within a day of midnight is listed, not counted
 * — with no control anywhere that could settle it.
 *
 * THE RULES, the currency's (`house-currency.service.ts`), for the same reasons:
 *   1. **Explicit, never silent.** Written only from a zone that arrived in the
 *      request body. Never derived from the country, never defaulted, never
 *      written on a read. The span rule (`procurement/delivery-deadline.ts`)
 *      stays for every house that has not stated one.
 *   2. **Membership checked here.** The zone must be a canonical IANA name
 *      this server's `Intl` lists (`Intl.supportedValuesOf("timeZone")`, plus
 *      `UTC`) AND resolve (`calendar/zoned-time.ts` `resolveZone`). A browser
 *      list is not a validator of an HTTP route: `EST`, `utc`, `+03:00` and
 *      `Mars/Olympus` are refused with a sentence, and the value written is
 *      exactly the one sent.
 *   3. **Audited, or the caller is told it was not.** Every accepted change
 *      files a `system_audit_log` row naming the actor and both zones; the
 *      receipt travels back as `audited` / `auditReason`.
 *   4. **A failed read is never an empty one.** `readable: false` with the
 *      reason; `zone: null` means nobody has stated one.
 *
 * No clear-to-null: un-answering the question every on-time verdict depends
 * on is not the same kind of act as answering it.
 *
 * The role check is NOT here. It is `assertCanManageRestaurant` on the
 * controller — owner or manager, one implementation for every house setting.
 */

export const TIME_ZONE_AUDIT_ACTION = "house_time_zone_changed" as const;

let canonical: Set<string> | null = null;

/** The canonical IANA zones this server knows, plus `UTC`. Derived, never typed. */
export function knownZones(): Set<string> {
  if (canonical) return canonical;
  const intl = Intl as unknown as {
    supportedValuesOf?: (key: string) => string[];
  };
  const list =
    typeof intl.supportedValuesOf === "function"
      ? intl.supportedValuesOf("timeZone")
      : [];
  canonical = new Set([...list, "UTC"]);
  return canonical;
}

/** Null when `zone` may be written; otherwise the sentence the page prints. */
export function notAZoneBecause(zone: unknown): string | null {
  if (typeof zone !== "string" || zone.trim() === "")
    return "A time zone is an IANA name such as Europe/Istanbul or America/Los_Angeles. None was sent, so nothing was recorded.";
  if (zone !== zone.trim())
    return `"${zone}" has spaces around it. Send the zone exactly as the list names it; nothing was recorded.`;
  if (!knownZones().has(zone) || resolveZone(zone) !== zone)
    return `"${zone}" is not a time zone this server knows by that name. Pick one from the list, for example Europe/Istanbul; nothing was recorded.`;
  return null;
}

export interface HouseTimeZoneReadout {
  restaurantId: string;
  /** The stated IANA zone, or null when nobody has stated one. */
  zone: string | null;
  /**
   * A value in the column that this server cannot resolve — kept verbatim so
   * the page can say so, never read as a zone.
   */
  unreadZone: string | null;
  /** `restaurants.country` verbatim, so the page can offer that country's zones first. */
  country: string | null;
  readable: boolean;
  reason: string | null;
  statedAt: string | null;
  statedBy: { userId: string | null; name: string | null } | null;
  audited?: boolean;
  auditReason?: string | null;
}

interface HouseRow {
  timezone: string | null;
  country: string | null;
}

@Injectable()
export class HouseTimeZoneService {
  private readonly logger = new Logger(HouseTimeZoneService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly audit: SettingsAuditService,
  ) {}

  async read(restaurantId: string): Promise<HouseTimeZoneReadout> {
    const house = await this.readHouse(restaurantId);
    if (house.error !== null) {
      return {
        restaurantId,
        zone: null,
        unreadZone: null,
        country: null,
        readable: false,
        reason: house.error,
        statedAt: null,
        statedBy: null,
      };
    }
    const recorded = house.row?.timezone?.trim() || null;
    const zone = recorded && resolveZone(recorded) ? recorded : null;
    const stated = await this.lastStated(restaurantId);
    return {
      restaurantId,
      zone,
      unreadZone: recorded && !zone ? recorded : null,
      country: house.row?.country ?? null,
      readable: true,
      reason: null,
      statedAt: stated.at,
      statedBy: stated.by,
    };
  }

  async write(
    restaurantId: string,
    zone: unknown,
    actorUserId: string,
  ): Promise<HouseTimeZoneReadout> {
    const refusal = notAZoneBecause(zone);
    if (refusal) throw new BadRequestException(refusal);
    const next = zone as string;

    const before = await this.readHouse(restaurantId);
    if (before.error !== null) {
      // The trail must name what the zone WAS; a row that could not be read
      // would be recorded as "none", which is a false record. Nothing is written.
      throw new ServiceUnavailableException(
        "The current time zone could not be read, so nothing was changed. Try again.",
      );
    }
    const previous = before.row?.timezone ?? null;

    const { error } = await this.databaseService.client
      .from("restaurants")
      .update({ timezone: next })
      .eq("id", restaurantId);
    if (error) {
      this.logger.error(
        `Could not record the time zone for ${restaurantId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        "Could not record the time zone. Nothing was changed.",
      );
    }

    const receipt =
      previous === next
        ? { recorded: false, reason: "nothing changed" }
        : await this.audit.record({
            restaurantId,
            actorUserId,
            action: TIME_ZONE_AUDIT_ACTION,
            register: "time-zone",
            entityType: "restaurant",
            entityId: restaurantId,
            subject: "time zone",
            fields: { timezone: { from: previous, to: next } },
          });

    const after = await this.read(restaurantId);
    return { ...after, audited: receipt.recorded, auditReason: receipt.reason };
  }

  private async readHouse(
    restaurantId: string,
  ): Promise<{ row: HouseRow | null; error: string | null }> {
    const { data, error } = await this.databaseService.client
      .from("restaurants")
      .select("timezone, country")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) {
      this.logger.error(
        `Could not read the time zone for ${restaurantId}: ${error.message}`,
      );
      return { row: null, error: error.message };
    }
    return { row: (data as HouseRow | null) ?? null, error: null };
  }

  /** Who last stated it, from `system_audit_log`. Best-effort, like the currency's. */
  private async lastStated(restaurantId: string): Promise<{
    at: string | null;
    by: { userId: string | null; name: string | null } | null;
  }> {
    const { data, error } = await this.databaseService.client
      .from("system_audit_log")
      .select("actor_id, created_at")
      .eq("restaurant_id", restaurantId)
      .eq("action", TIME_ZONE_AUDIT_ACTION)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error || !Array.isArray(data) || data.length === 0) {
      if (error)
        this.logger.warn(
          `The time zone's own trail could not be read for ${restaurantId}: ${error.message}`,
        );
      return { at: null, by: null };
    }
    const row = data[0] as {
      actor_id: string | null;
      created_at: string | null;
    };
    let name: string | null = null;
    if (row.actor_id) {
      const who = await this.databaseService.client
        .from("users")
        .select("name")
        .eq("user_id", row.actor_id)
        .maybeSingle();
      name = who.error
        ? null
        : ((who.data as { name?: string | null } | null)?.name ?? null);
    }
    return {
      at: row.created_at ?? null,
      by: { userId: row.actor_id ?? null, name },
    };
  }
}
