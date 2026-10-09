import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { SettingsAuditService } from "../settings-audit/settings-audit.service";

/**
 * Where the house stands — its street address and its map point — read, and
 * stated by an owner or manager after sign-up (F-174).
 *
 * The calendar's weather reads `restaurants.latitude`/`longitude` and nothing
 * else (`weather/weather.service.ts`). Only sign-up wrote that pair, so a
 * house that typed its address by hand, or moved, had no way to set it: the
 * calendar said "Set the address on Settings", and Settings had no address.
 *
 * THE RULES:
 *   1. **The point comes from a place a person picked** (ADR 0111 row B: "take
 *      the geocode as well"). The page sends the pair the address search
 *      returned for the place chosen. This route never geocodes typed text and
 *      never invents a point.
 *   2. **Both numbers, finite and in range, or nothing is written** — the
 *      sign-up rule (`auth.service.ts` `coordinateColumns`). There is no clear
 *      route: un-setting the point the forecast hangs on is not the same act
 *      as setting it.
 *   3. **Audited, or the caller is told it was not.** A move of the street or
 *      the point files a `house_location_changed` row with both values; the
 *      receipt travels back as `audited` / `auditReason`.
 *   4. **A failed read is never an empty one.** `readable: false` with the
 *      reason; `street: null` / `latitude: null` mean nothing is recorded.
 *
 * WHAT IT DOES NOT TOUCH. The city, state and country stay with the location
 * editor (ADR 0289 keeps state and country to owners). The time zone stays
 * where ADR 0304 puts it: it is worked out from the jurisdiction, never from
 * this point. `google_place_id` is not written: its one-house-per-place rule
 * is still open (ADR 0265), and nothing reads it back.
 *
 * The role check is NOT here. It is `assertCanManageRestaurant` on the
 * controller — owner or manager, the same gate as the currency and the zone.
 */

export const LOCATION_AUDIT_ACTION = "house_location_changed" as const;

/** Null when the three may be written; otherwise the sentence the page prints. */
export function notALocationBecause(
  street: unknown,
  latitude: unknown,
  longitude: unknown,
): string | null {
  if (typeof street !== "string" || street.trim() === "")
    return "An address is needed with the map point. None was sent, so nothing was recorded.";
  if (street.length > 300)
    return "That address is longer than 300 characters, so nothing was recorded.";
  const finite = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v);
  if (!finite(latitude) || !finite(longitude))
    return "The map point needs both a latitude and a longitude as numbers. Pick the address from the search list; nothing was recorded.";
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180)
    return "That map point is not on Earth (latitude runs −90 to 90, longitude −180 to 180), so nothing was recorded.";
  return null;
}

export interface HouseLocationReadout {
  restaurantId: string;
  /** `restaurants.address.street` (or a plain-text address), or null when none is recorded. */
  street: string | null;
  /** Both, or neither: a half pair is not a point and reads as none. */
  latitude: number | null;
  longitude: number | null;
  readable: boolean;
  reason: string | null;
  audited?: boolean;
  auditReason?: string | null;
}

interface HouseRow {
  address: unknown;
  latitude: number | string | null;
  longitude: number | string | null;
}

/** `decimal` columns arrive as strings from PostgREST; a non-number is none. */
function coordinate(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The street from the `address` jsonb: `{ street }` as every writer stores it, or plain text. */
function streetOf(address: unknown): string | null {
  if (typeof address === "string") return address.trim() || null;
  if (address && typeof address === "object") {
    const street = (address as { street?: unknown }).street;
    if (typeof street === "string") return street.trim() || null;
  }
  return null;
}

/** The `address` jsonb as an object to merge into; plain text or none is `{}`. */
function addressObject(address: unknown): Record<string, unknown> {
  return address && typeof address === "object" && !Array.isArray(address)
    ? (address as Record<string, unknown>)
    : {};
}

@Injectable()
export class HouseLocationService {
  private readonly logger = new Logger(HouseLocationService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly audit: SettingsAuditService,
  ) {}

  async read(
    restaurantId: string,
    already?: { row: HouseRow | null; error: string | null },
  ): Promise<HouseLocationReadout> {
    const house = already ?? (await this.readHouse(restaurantId));
    if (house.error !== null) {
      return {
        restaurantId,
        street: null,
        latitude: null,
        longitude: null,
        readable: false,
        reason: house.error,
      };
    }
    const latitude = coordinate(house.row?.latitude);
    const longitude = coordinate(house.row?.longitude);
    const point = latitude !== null && longitude !== null;
    return {
      restaurantId,
      street: streetOf(house.row?.address),
      latitude: point ? latitude : null,
      longitude: point ? longitude : null,
      readable: true,
      reason: null,
    };
  }

  async write(
    restaurantId: string,
    street: unknown,
    latitude: unknown,
    longitude: unknown,
    actorUserId: string,
  ): Promise<HouseLocationReadout> {
    const refusal = notALocationBecause(street, latitude, longitude);
    if (refusal) throw new BadRequestException(refusal);
    const next = {
      street: (street as string).trim(),
      latitude: latitude as number,
      longitude: longitude as number,
    };

    const house = await this.readHouse(restaurantId);
    const before = await this.read(restaurantId, house);
    if (!before.readable) {
      // The trail must name what the location WAS; a row that could not be
      // read would be recorded as "none", which is a false record.
      throw new ServiceUnavailableException(
        "The current address could not be read, so nothing was changed. Try again.",
      );
    }

    const { error } = await this.databaseService.client
      .from("restaurants")
      .update({
        // Only the street moves: any other key a writer kept in the jsonb stays.
        address: { ...addressObject(house.row?.address), street: next.street },
        latitude: next.latitude,
        longitude: next.longitude,
      })
      .eq("id", restaurantId);
    if (error) {
      this.logger.error(
        `Could not record the location for ${restaurantId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        "Could not record the address. Nothing was changed.",
      );
    }

    // Only what moved is filed; re-sending the same place files nothing.
    const fields: Record<string, { from: unknown; to: unknown }> = {};
    if (before.street !== next.street)
      fields.street = { from: before.street, to: next.street };
    if (before.latitude !== next.latitude)
      fields.latitude = { from: before.latitude, to: next.latitude };
    if (before.longitude !== next.longitude)
      fields.longitude = { from: before.longitude, to: next.longitude };
    const receipt = await this.audit.record({
      restaurantId,
      actorUserId,
      action: LOCATION_AUDIT_ACTION,
      register: "location",
      entityType: "restaurant",
      entityId: restaurantId,
      subject: "address and map point",
      fields,
    });

    const after = await this.read(restaurantId);
    return { ...after, audited: receipt.recorded, auditReason: receipt.reason };
  }

  private async readHouse(
    restaurantId: string,
  ): Promise<{ row: HouseRow | null; error: string | null }> {
    const { data, error } = await this.databaseService.client
      .from("restaurants")
      .select("address, latitude, longitude")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) {
      this.logger.error(
        `Could not read the location for ${restaurantId}: ${error.message}`,
      );
      return { row: null, error: error.message };
    }
    return { row: (data as HouseRow | null) ?? null, error: null };
  }
}
