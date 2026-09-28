import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

/**
 * THE HOUSE'S ZONES, AND WHETHER ANYBODY HAS EVER LOOKED AT THEM.
 *
 * The cellar floor (sketch 092 direction A, carried into 095 as a strip) is the
 * only surface on this page that answers *where*, and it is the one surface
 * where a fabricated room is not a cosmetic problem — it is a picture of a
 * building that does not exist.
 *
 * MEASURED on production 2026-09-04: `public.storage_locations` holds **4 rows
 * across 2 tenants**, and all four carry one of the four names the
 * seeded-defaults sweep named. (87 rows across 7 tenants was the 2026-09-02
 * figure; 83 have since been deleted, and the proportion went from 84-of-87 to
 * 4-of-4.) Two of the demo tenant's three also report a `current_occupancy`
 * that disagrees with the inventory rows actually assigned to them — 180/32/45
 * against 17/17/16.
 *
 * SO THE FLOOR DRAWS CONFIRMED ZONES ONLY, in the same infer-then-confirm shape
 * the register set already uses: the house's zones are listed with the names
 * they currently carry, a manager confirms or renames each once, and only the
 * confirmed ones are ever drawn. The rest are a sentence with a count and the
 * control beside it — never a drawn zone, and never a zero.
 *
 * WHAT IS DELIBERATELY NOT HERE. No `current_occupancy` on the wire. That
 * column disagrees with the inventory rows assigned to the same zone on the
 * only tenant that has both, so the count of items ACTUALLY assigned is
 * returned instead and the surface says which it is. Confirming a zone's NAME
 * is not confirming a seeder's arithmetic.
 */

/**
 * The columns the zone read selects. A module-level const because
 * `scripts/check_read_columns_exist.py` resolves one and checks every column
 * against the migrations; an inlined list is a read nobody is checking.
 */
const ZONE_COLUMNS =
  "id, restaurant_id, zone, section, name, capacity_bottles, display_order, is_active, created_at, zone_confirmed_at, zone_confirmed_by, zone_provenance";

const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204", "PGRST205"]);

export type ZoneProvenance =
  | "unconfirmed"
  | "confirmed"
  | "renamed"
  | "created";

export interface ZoneVM {
  id: string;
  /** The name it currently carries. On an unconfirmed row this is a proposal. */
  name: string;
  zone: string | null;
  section: string | null;
  capacityBottles: number | null;
  /**
   * Inventory rows ASSIGNED to this zone — counted, not read off
   * `current_occupancy`, which disagrees with them where both exist.
   */
  itemsAssigned: number | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  provenance: ZoneProvenance;
}

export interface ZonesResult {
  restaurantId: string;
  /** Drawn on the floor. Never anything else. */
  confirmed: ZoneVM[];
  /** Counted in a sentence, listed only inside the confirm control. */
  unconfirmed: ZoneVM[];
  counts: { confirmed: number; unconfirmed: number; total: number };
  readable: boolean;
  reason: string | null;
  /** True once the confirm columns exist on this database. */
  confirmable: boolean;
  scopeNote: string;
}

export const ZONES_SCOPE_NOTE =
  "A zone is drawn on the floor only once somebody in this house has confirmed its name. Every row here was written by a seeder or an import until a manager says otherwise, so an unconfirmed zone is counted in words and never drawn as a room. Capacity is the row's own figure; what is in it is counted from the inventory rows assigned to it, not from current_occupancy, which disagrees with them.";

interface ZoneRow {
  id: string;
  restaurant_id: string;
  zone: string | null;
  section: string | null;
  name: string | null;
  capacity_bottles: number | null;
  display_order: number | null;
  is_active: boolean | null;
  created_at: string | null;
  zone_confirmed_at: string | null;
  zone_confirmed_by: string | null;
  zone_provenance: string | null;
}

function provenanceOf(v: string | null): ZoneProvenance {
  return v === "confirmed" || v === "renamed" || v === "created"
    ? v
    : "unconfirmed";
}

/** The label a row carries, without inventing one for a row that has none. */
export function zoneLabel(r: {
  name: string | null;
  zone: string | null;
  section: string | null;
}): string {
  const composed = [r.zone, r.section].filter(Boolean).join(" - ");
  return (r.name ?? "").trim() || composed || "Unnamed zone";
}

export function toZone(r: ZoneRow, itemsAssigned: number | null): ZoneVM {
  return {
    id: r.id,
    name: zoneLabel(r),
    zone: r.zone,
    section: r.section,
    capacityBottles: r.capacity_bottles,
    itemsAssigned,
    confirmedAt: r.zone_confirmed_at,
    confirmedBy: r.zone_confirmed_by,
    provenance: provenanceOf(r.zone_provenance),
  };
}

/**
 * Split by confirmation, and by confirmation ALONE. A row's provenance word is
 * carried for the reader; the split is on the timestamp, because that is the
 * column the constraint ties the word to.
 */
export function splitZones(zones: ZoneVM[]): {
  confirmed: ZoneVM[];
  unconfirmed: ZoneVM[];
} {
  return {
    confirmed: zones.filter((z) => z.confirmedAt !== null),
    unconfirmed: zones.filter((z) => z.confirmedAt === null),
  };
}

@Injectable()
export class ZonesService {
  private readonly logger = new Logger(ZonesService.name);

  constructor(private readonly dbService: DatabaseService) {}

  async read(restaurantId: string): Promise<ZonesResult> {
    const client = this.dbService.getClient();
    const { data, error } = await client
      .from("storage_locations")
      .select(ZONE_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (error) {
      const code = String((error as { code?: string }).code);
      this.logger.error(`storage_locations read failed: ${error.message}`);
      const missing = MISSING_COLUMN_CODES.has(code);
      return {
        restaurantId,
        confirmed: [],
        unconfirmed: [],
        counts: { confirmed: 0, unconfirmed: 0, total: 0 },
        readable: false,
        // The interesting case: the confirm columns are not on this database
        // yet. The floor must say the zones are UNREAD, never draw them
        // unconfirmed and never report zero rooms.
        reason: missing
          ? "The zone-confirmation columns are not on this database yet — migration 20260904130000_a_zone_is_confirmed_or_it_is_not_drawn.sql has not been applied here. This house's zones are unread, not absent."
          : error.message,
        confirmable: !missing,
        scopeNote: ZONES_SCOPE_NOTE,
      };
    }

    const rows = (data ?? []) as unknown as ZoneRow[];

    // What is actually in each zone, counted from the rows assigned to it. One
    // read for every zone rather than one per zone.
    const assigned = new Map<string, number>();
    const { data: items, error: itemsError } = await client
      .from("restaurant_inventory")
      .select("id, storage_location_id")
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .not("storage_location_id", "is", null);
    if (itemsError) {
      this.logger.warn(
        `zone occupancy count failed, reporting unknown: ${itemsError.message}`,
      );
    } else {
      for (const it of (items ?? []) as { storage_location_id: string }[]) {
        const k = it.storage_location_id;
        assigned.set(k, (assigned.get(k) ?? 0) + 1);
      }
    }

    const zones = rows.map((r) =>
      // Null, not zero, when the count could not be read at all: a zone whose
      // contents are unknown must not render as an empty room.
      toZone(r, itemsError ? null : (assigned.get(r.id) ?? 0)),
    );
    const { confirmed, unconfirmed } = splitZones(zones);

    return {
      restaurantId,
      confirmed,
      unconfirmed,
      counts: {
        confirmed: confirmed.length,
        unconfirmed: unconfirmed.length,
        total: zones.length,
      },
      readable: true,
      reason: null,
      confirmable: true,
      scopeNote: ZONES_SCOPE_NOTE,
    };
  }

  /**
   * Confirm a zone, or rename it. One write, the actor filed.
   *
   * `name` is optional: absent means "the name as it stands is right"
   * (`confirmed`), present and different means `renamed`. There is no
   * "unconfirm": a zone somebody has looked at stays looked-at, and a wrong
   * name is fixed by renaming it again.
   */
  async confirm(
    restaurantId: string,
    zoneId: string,
    name: string | null,
    userId: string | null,
  ): Promise<{ zone: ZoneVM; provenance: ZoneProvenance }> {
    const client = this.dbService.getClient();

    // Read first, scoped to the tenant, so a zone id from another house cannot
    // be written by naming this one in the path.
    const { data: existing, error: readError } = await client
      .from("storage_locations")
      .select(ZONE_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .eq("id", zoneId)
      .is("deleted_at", null)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!existing) {
      throw new Error("No zone of this house has that id.");
    }

    const row = existing as unknown as ZoneRow;
    const current = zoneLabel(row);
    const next = (name ?? "").trim();
    const renamed = next !== "" && next !== current;
    const provenance: ZoneProvenance = renamed ? "renamed" : "confirmed";

    const patch: Record<string, unknown> = {
      zone_confirmed_at: new Date().toISOString(),
      zone_confirmed_by: userId,
      zone_provenance: provenance,
      updated_at: new Date().toISOString(),
    };
    if (renamed) patch.name = next;

    const { data: written, error: writeError } = await client
      .from("storage_locations")
      .update(patch)
      .eq("restaurant_id", restaurantId)
      .eq("id", zoneId)
      .select(ZONE_COLUMNS)
      .maybeSingle();
    if (writeError) throw new Error(writeError.message);
    if (!written) {
      // A write that matched nothing is never reported as a success — the
      // legacy cellar's "Reorder" did exactly that.
      throw new Error("The zone was not written.");
    }

    return {
      zone: toZone(written as unknown as ZoneRow, null),
      provenance,
    };
  }
}
