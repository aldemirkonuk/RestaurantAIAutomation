/**
 * What every floor service shares: who is asking, the house's clock and the
 * house's warn/late minutes. ADR 0345 (Proposed), built under OD-242.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
} from "@nestjs/common";
import type { SupabaseClient } from "@supabase/supabase-js";
import { houseFrame } from "../common/house-frame";
import { localDateIn } from "../notifications/producers/service-day";

export type FloorRole = "owner" | "manager" | "staff";

export interface FloorActor {
  userId: string;
  restaurantId: string;
  role: FloorRole;
}

/**
 * The person on the verified token, in the house the token names. The house is
 * never the URL's or the body's (ADR 0164). `admin` does not widen into a
 * manager here: RolesGuard already refused it on every floor route.
 */
export function floorActorOf(req: any): FloorActor {
  const u = req?.user ?? {};
  const restaurantId = typeof u.restaurantId === "string" ? u.restaurantId.trim() : "";
  if (!restaurantId) {
    throw new BadRequestException("No active restaurant on this session.");
  }
  if (!u.userId) throw new ForbiddenException("Missing user identity");
  const raw = typeof u.role === "string" ? u.role.toLowerCase() : "";
  if (raw !== "owner" && raw !== "manager" && raw !== "staff") {
    throw new ForbiddenException("You hold no floor role in this house.");
  }
  return { userId: u.userId, restaurantId, role: raw };
}

export const isManagerRole = (a: FloorActor) => a.role === "owner" || a.role === "manager";

/** The checker's defaults, and the migration's (`floor_settings`). */
export const DEFAULT_WARN_MIN = 6;
export const DEFAULT_LATE_MIN = 10;

export interface FloorHouse {
  name: string | null;
  /** The house's IANA zone (houseFrame); null when none resolves. */
  zone: string | null;
  warnAfterMin: number;
  lateAfterMin: number;
}

/**
 * The house row and its floor settings. A failed read throws: an unreadable
 * setting is never read as the default (ADR 0351 › A failed read).
 */
export async function readFloorHouse(
  sb: SupabaseClient,
  restaurantId: string,
): Promise<FloorHouse> {
  const [house, settings] = await Promise.all([
    sb.from("restaurants").select("name, timezone, country").eq("id", restaurantId).maybeSingle(),
    sb
      .from("floor_settings")
      .select("warn_after_min, late_after_min")
      .eq("restaurant_id", restaurantId)
      .maybeSingle(),
  ]);
  if (house.error) throw new InternalServerErrorException("The house could not be read.");
  if (settings.error) {
    throw new InternalServerErrorException("The floor settings could not be read.");
  }
  const row = (house.data ?? null) as { name?: string; timezone?: string; country?: string } | null;
  const s = (settings.data ?? null) as { warn_after_min?: number; late_after_min?: number } | null;
  return {
    name: row?.name ?? null,
    zone: houseFrame(row).zone,
    warnAfterMin: s?.warn_after_min ?? DEFAULT_WARN_MIN,
    lateAfterMin: s?.late_after_min ?? DEFAULT_LATE_MIN,
  };
}

/** Hours after local midnight that still belong to the day before. */
export const SERVICE_DAY_ROLLOVER_HOURS = 6;

/**
 * The house-local service date at `now`: the house's calendar date six hours
 * ago, so a table seated at 01:00 belongs to the evening before.
 *
 * Open as OD-242, the executor's reading under OD-242: ADR 0351's full
 * service-day rule (ending at the later of six hours past midnight and an hour
 * after the last recorded opening window) needs the venue's recorded hours and
 * is not built here. The six hours are main's constant
 * (`notifications/producers/service-day.ts`).
 *
 * No zone means no date: never UTC (ADR 0351 › The house's clock).
 */
export function serviceDateOf(zone: string | null, now: number): string | null {
  if (!zone) return null;
  return localDateIn(new Date(now - SERVICE_DAY_ROLLOVER_HOURS * 3_600_000), zone);
}

export function requireServiceDate(zone: string | null, now: number): string {
  const d = serviceDateOf(zone, now);
  if (!d) {
    throw new ConflictException({
      code: "HOUSE_ZONE_NOT_SET",
      message:
        "This house has no time zone, so the floor cannot tell which service day it is. An owner or manager sets it in Settings › Time zone.",
    });
  }
  return d;
}

/** A Postgres unique violation, which every "one open X" index answers with. */
export const isUniqueViolation = (error: { code?: string } | null | undefined) =>
  error?.code === "23505";
