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
 * old `America/Los_Angeles` default (`20260903170000`, :189), so its on-time
 * line reads the no-zone span — a landing within a day of midnight is listed,
 * not counted — with no control anywhere that could settle it.
 *
 * THE RULES, the currency's (`house-currency.service.ts`), for the same reasons:
 *   1. **Attributable, never silent.** A zone is written by a person here
 *      (source `stated`), or, once ADR 0304's PR-2 lands, when an address is
 *      written, from that address or its owner's device, always with its
 *      source. It is never defaulted and never written on a read. The source
 *      counts only while `timezone_source_zone` equals the zone
 *      (`boundSource`); a writer that rewrites `timezone` alone leaves it
 *      unbound, so the zone reads as one with no recorded source (rule 5
 *      may still find its witness), and a rewrite back to the bound zone
 *      binds it again. Until PR-2 lands, sign-up still saves the browser's
 *      zone with no source (ADR 0213 item 62), and this register returns
 *      `source: null` for it. The span rule
 *      (`procurement/delivery-deadline.ts`) stays for every house with no
 *      zone.
 *   2. **Membership checked here.** The zone must be a canonical IANA name
 *      this server's `Intl` lists (`Intl.supportedValuesOf("timeZone")`, plus
 *      `UTC`) AND resolve (`calendar/zoned-time.ts` `resolveZone`). A browser
 *      list is not a validator of an HTTP route: `EST`, `utc`, `+03:00` and
 *      `Mars/Olympus` are refused with a sentence, and the value written is
 *      exactly the one sent.
 *   3. **Audited, or the caller is told it was not.** Every accepted change
 *      of the zone OR of its source files a `system_audit_log` row naming the
 *      actor and both zones (and both sources when the source moved; the
 *      same zone twice when only the source moved, ADR 0304 Decision 5); the
 *      receipt travels back as `audited` / `auditReason`.
 *   4. **A failed read is never an empty one.** `readable: false` with the
 *      reason; `zone: null` means no zone is recorded.
 *   5. **A person is named only as the witness of the zone the house keeps
 *      now** (ADR 0304): the newest audit row must say `to` = that zone, and
 *      a zone bound to `address` or `device` names nobody. An audit write can
 *      fail (`recorded: false`), so an older row may name someone who never
 *      stated the current zone; that row is not read as its witness. The
 *      person named did state this zone value at some time; after a later
 *      failed audit write, someone else may have set it again since.
 *
 * No clear-to-null: un-answering the question every on-time verdict depends
 * on is not the same kind of act as answering it.
 *
 * The role check is NOT here. It is `assertCanManageRestaurant` on the
 * controller — owner or manager, one implementation for every house setting.
 */

export const TIME_ZONE_AUDIT_ACTION = "house_time_zone_changed" as const;

/**
 * Who or what gave a house its zone (ADR 0304, `restaurants.timezone_source`):
 * worked out from its address, the device it was created on, or stated by a
 * person here. Not `house-frame.ts`'s read-time `ZoneSource`.
 */
export type TimeZoneSource = "address" | "device" | "stated";
const TIME_ZONE_SOURCES: ReadonlySet<string> = new Set<TimeZoneSource>([
  "address",
  "device",
  "stated",
]);

/**
 * The row's recorded source, only while it vouches for the zone the row holds
 * now (`timezone_source_zone === timezone`). Anything else — no source, a
 * value outside the three, or a zone rewritten by a writer that does not know
 * these columns — is null: not recorded.
 */
export function boundSource(
  row: {
    timezone: string | null;
    timezone_source?: string | null;
    timezone_source_zone?: string | null;
  } | null,
): TimeZoneSource | null {
  if (!row || row.timezone === null || row.timezone === undefined) return null;
  if ((row.timezone_source_zone ?? null) !== row.timezone) return null;
  const source = row.timezone_source ?? null;
  return source !== null && TIME_ZONE_SOURCES.has(source)
    ? (source as TimeZoneSource)
    : null;
}

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
  /** The recorded IANA zone, or null when none is recorded. */
  zone: string | null;
  /**
   * Where `zone` came from (ADR 0304): `address`, `device` or `stated`, read
   * only while the row's source vouches for this zone; null when the source
   * was never recorded or no longer matches. Shown in Settings → Time zone.
   */
  source: TimeZoneSource | null;
  /**
   * A value in the column that this server cannot resolve — kept verbatim so
   * the page can say so, never read as a zone.
   */
  unreadZone: string | null;
  /** `restaurants.country` verbatim, so the page can offer that country's zones first. */
  country: string | null;
  readable: boolean;
  reason: string | null;
  /**
   * When and by whom this zone was stated: the newest audit row, only when
   * its `to` is this zone (its actor stated this zone value at some time, not
   * necessarily last). Null for a zone bound to `address`/`device`.
   */
  statedAt: string | null;
  statedBy: { userId: string | null; name: string | null } | null;
  audited?: boolean;
  auditReason?: string | null;
}

interface HouseRow {
  timezone: string | null;
  country: string | null;
  timezone_source: string | null;
  timezone_source_zone: string | null;
}

const NO_WITNESS = { at: null, by: null } as const;

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
        source: null,
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
    const source = zone ? boundSource(house.row) : null;
    // A zone the address or the device gave names no person (ADR 0304).
    const stated =
      zone === null || source === "address" || source === "device"
        ? NO_WITNESS
        : await this.lastStated(restaurantId, house.row?.timezone ?? null);
    return {
      restaurantId,
      zone,
      source,
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
    const previousSource = boundSource(before.row);

    // Three explicit keys: the zone, and the person's word as its source,
    // bound to the zone it vouches for (ADR 0304).
    const { error } = await this.databaseService.client
      .from("restaurants")
      .update({
        timezone: next,
        timezone_source: "stated",
        timezone_source_zone: next,
      })
      .eq("id", restaurantId);
    if (error) {
      this.logger.error(
        `Could not record the time zone for ${restaurantId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        "Could not record the time zone. Nothing was changed.",
      );
    }

    // A move of the zone or of its source is filed; `timezone` is always in
    // the row, so the witness rule reads one key. Re-stating a zone that is
    // already the person's word moves neither and files nothing.
    const sourceMoved = previousSource !== "stated";
    const receipt =
      previous === next && !sourceMoved
        ? { recorded: false, reason: "nothing changed" }
        : await this.audit.record({
            restaurantId,
            actorUserId,
            action: TIME_ZONE_AUDIT_ACTION,
            register: "time-zone",
            entityType: "restaurant",
            entityId: restaurantId,
            subject: "time zone",
            fields: sourceMoved
              ? {
                  timezone: { from: previous, to: next },
                  timezone_source: { from: previousSource, to: "stated" },
                }
              : { timezone: { from: previous, to: next } },
          });

    const after = await this.read(restaurantId);
    return { ...after, audited: receipt.recorded, auditReason: receipt.reason };
  }

  private async readHouse(
    restaurantId: string,
  ): Promise<{ row: HouseRow | null; error: string | null }> {
    const { data, error } = await this.databaseService.client
      .from("restaurants")
      .select("timezone, country, timezone_source, timezone_source_zone")
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

  /**
   * Who stated the zone the house keeps NOW, from `system_audit_log`.
   * Best-effort, like the currency's. Only the newest row is read, and it is
   * the witness only when its `to` is `zone`: a row about another zone names
   * someone who did not choose this one (ADR 0304). A matching row's actor
   * stated this zone value at some time, not necessarily last.
   */
  private async lastStated(
    restaurantId: string,
    zone: string | null,
  ): Promise<{
    at: string | null;
    by: { userId: string | null; name: string | null } | null;
  }> {
    const { data, error } = await this.databaseService.client
      .from("system_audit_log")
      .select("actor_id, created_at, changes")
      .eq("restaurant_id", restaurantId)
      .eq("action", TIME_ZONE_AUDIT_ACTION)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error || !Array.isArray(data) || data.length === 0) {
      if (error)
        this.logger.warn(
          `The time zone's own trail could not be read for ${restaurantId}: ${error.message}`,
        );
      return NO_WITNESS;
    }
    const row = data[0] as {
      actor_id: string | null;
      created_at: string | null;
      changes: {
        fields?: { timezone?: { to?: unknown } | null } | null;
      } | null;
    };
    if (zone === null || row.changes?.fields?.timezone?.to !== zone)
      return NO_WITNESS;
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
