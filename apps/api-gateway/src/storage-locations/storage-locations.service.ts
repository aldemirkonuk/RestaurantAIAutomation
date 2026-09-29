import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  HttpException,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { readRestaurantRole } from "../organizations/organizations.service";
import { recordAccessChange } from "../team/access-audit";
import {
  CreateStorageLocationDto,
  UpdateStorageLocationDto,
  AssignWineToLocationDto,
} from "./dto/storage-locations.dto";

/* ── who may set up a zone (ADR 0238) ─────────────────────────────────────
 *
 * The founder, 2026-09-29, asked "who may create, rename, resize or delete a
 * zone, and who may place wines in zones? Today every house member can do all
 * of it", and answered, verbatim: "managers/owners+ the people they assign".
 *
 * A zone SETUP write is allowed to an owner or manager of the house (their
 * role here, read strictly: a role that cannot be read is a 500, never a
 * pass), and to a staff member an owner or manager assigned it
 * (`user_restaurant_access.zone_setup_access`, migration 20261202120000).
 * Nobody else. Placing and counting wines are NOT setup: the answer does not
 * separate them, so they stay open to every member as before (OD-200).
 *
 * Module-level functions, not only methods, so the cellar floor's rename
 * (`ZonesService.confirm`) asks the same question in the same words. Two
 * copies of "who may set up a zone" is how a gate and its page drift apart.
 */

type Db = DatabaseService["supabase"];

export interface ZoneSetupAccess {
  allowed: boolean;
  /** Why: the house role, or an owner's or manager's assignment. */
  via: "house_role" | "assigned" | null;
}

export const ZONE_SETUP_REFUSAL =
  "Setting up this house's zones (adding, renaming, resizing or deleting one) is for its owners, its managers and the people they assign. You have not been assigned, so nothing was changed. Placing and counting wines stays open to you.";

/** The house role, lower-cased. Strict: a failed read is a 500, never a pass. */
async function roleHere(
  db: Db,
  userId: string,
  restaurantId: string,
): Promise<string> {
  const role = await readRestaurantRole(db, userId, restaurantId, {
    strict: true,
  });
  return (role ?? "").trim().toLowerCase();
}

export async function readZoneSetupAccess(
  db: Db,
  userId: string | null | undefined,
  restaurantId: string,
): Promise<ZoneSetupAccess> {
  if (!userId) return { allowed: false, via: null };
  const role = await roleHere(db, userId, restaurantId);
  if (role === "owner" || role === "manager") {
    return { allowed: true, via: "house_role" };
  }
  // Only a staff member carries the switch. Any other value (none, `admin`,
  // unknown) is not proven to be a member who could be assigned: refused.
  if (role !== "staff") return { allowed: false, via: null };
  const { data, error } = await db
    .from("user_restaurant_access")
    .select("zone_setup_access")
    .eq("user_id", userId)
    .eq("restaurant_id", restaurantId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) {
    // An outage is not a fact about the person (ADR 0020).
    throw new InternalServerErrorException(
      `Whether you may set up this house's zones could not be read (${error.message}), so nothing was changed.`,
    );
  }
  return (data as { zone_setup_access?: boolean } | null)?.zone_setup_access ===
    true
    ? { allowed: true, via: "assigned" }
    : { allowed: false, via: null };
}

/** 403 with nothing written unless this person may set up zones here. */
export async function assertMaySetUpZones(
  db: Db,
  userId: string | null | undefined,
  restaurantId: string,
): Promise<void> {
  const access = await readZoneSetupAccess(db, userId, restaurantId);
  if (!access.allowed) throw new ForbiddenException(ZONE_SETUP_REFUSAL);
}

/**
 * Whether an update touches the zone's setup. Every field but `current_count`
 * does (name, capacity, parent, colour, notes, temperature, humidity, type,
 * description). `current_count` alone is a count, open to every member
 * (OD-200). A count sent WITH any setup field is a setup write.
 */
export function isZoneSetupEdit(dto: UpdateStorageLocationDto): boolean {
  return Object.entries(dto ?? {}).some(
    ([key, value]) => key !== "current_count" && value !== undefined,
  );
}

// Matches the actual storage_locations table in production
interface StorageLocationRow {
  id: string;
  restaurant_id: string;
  zone: string;
  section?: string | null;
  shelf?: string | null;
  position?: string | null;
  full_location?: string | null;
  capacity_bottles?: number | null;
  current_occupancy?: number | null;
  temperature_zone?: string | null;
  temperature_min?: number | null;
  temperature_max?: number | null;
  humidity_controlled?: boolean | null;
  color_code?: string | null;
  display_order?: number | null;
  notes?: string | null;
  is_active?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
}

interface WineLocationMappingRow {
  id: string;
  restaurant_id: string;
  wine_id: string;
  location_id: string;
  quantity?: number | null;
  assigned_at?: string | null;
}

export interface EnrichedWineAtLocation {
  wineId: string;
  wineName: string;
  producer: string;
  vintage: string | null;
  quantity: number;
  assignedAt: string;
}

@Injectable()
export class StorageLocationsService {
  private readonly logger = new Logger(StorageLocationsService.name);

  constructor(private readonly dbService: DatabaseService) {}

  private mapLocation(row: StorageLocationRow) {
    // Build a human-friendly name from zone + section
    const name = row.section
      ? `${row.zone} – ${row.section}`
      : (row.zone ?? "Unknown Location");

    // Build a temperature string from numeric range if available
    let temperature: string | undefined;
    if (row.temperature_zone) {
      temperature = row.temperature_zone;
    } else if (row.temperature_min != null && row.temperature_max != null) {
      temperature = `${row.temperature_min}–${row.temperature_max}°C`;
    }

    return {
      id: row.id,
      name,
      description: row.full_location ?? undefined,
      // ADR 0051: a capacity nobody recorded is unknown. `?? 100` handed the
      // web a fabricated denominator for the cellar map's fill bar.
      capacity: row.capacity_bottles ?? null,
      current_count: row.current_occupancy ?? 0,
      temperature,
      humidity:
        row.humidity_controlled != null
          ? row.humidity_controlled
            ? "Controlled"
            : "None"
          : undefined,
      notes: row.notes ?? undefined,
      color: row.color_code ?? "#6b7280",
      created_at: row.created_at ?? undefined,
      updated_at: row.updated_at ?? undefined,
    };
  }

  private mapMapping(row: WineLocationMappingRow) {
    return {
      wineId: row.wine_id,
      locationId: row.location_id,
      quantity: row.quantity ?? 1,
      assignedAt: row.assigned_at ?? new Date().toISOString(),
    };
  }

  /**
   * The path's house is checked by `JwtAuthGuard` (`assertTenantMatch`); a
   * location id after it is not, and this client is service-role, so no RLS
   * stands behind the query either. Every route that takes a location id asks
   * here first. Another house's id answers exactly like a missing one, a 404,
   * so the refusal does not confirm the id exists (ADR 0147).
   */
  private async assertLocationIsTheHouses(
    restaurantId: string,
    locationId: string,
  ): Promise<void> {
    const { data, error } = await this.dbService.supabase
      .from("storage_locations")
      .select("id")
      .eq("id", locationId)
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) {
      this.logger.error(`Failed to read location: ${error.message}`);
      throw new HttpException(
        "The location could not be read, so nothing was done.",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    if (!data) {
      throw new HttpException(
        "No storage location of this house has that id.",
        HttpStatus.NOT_FOUND,
      );
    }
  }

  /** 403 unless the caller may set up zones here (ADR 0238). */
  async assertMaySetUpZones(
    userId: string | null | undefined,
    restaurantId: string,
  ): Promise<void> {
    await assertMaySetUpZones(this.dbService.supabase, userId, restaurantId);
  }

  /**
   * What the web reads to show or hide the setup controls: the caller's own
   * answer, and — for an owner or manager only — who in the house is
   * assigned. A staff member is told only about themself.
   */
  async readSetupAccess(
    userId: string | null | undefined,
    restaurantId: string,
  ): Promise<{ mine: ZoneSetupAccess; assigned: string[] | null }> {
    const db = this.dbService.supabase;
    const mine = await readZoneSetupAccess(db, userId, restaurantId);
    if (mine.via !== "house_role") return { mine, assigned: null };
    const { data, error } = await db
      .from("user_restaurant_access")
      .select("user_id")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .eq("role", "staff")
      .eq("zone_setup_access", true);
    if (error) {
      throw new InternalServerErrorException(
        `Who is assigned to set up zones here could not be read (${error.message}).`,
      );
    }
    return {
      mine,
      assigned: ((data ?? []) as Array<{ user_id: string }>).map(
        (r) => r.user_id,
      ),
    };
  }

  /**
   * An owner or a manager of THIS house assigns, or withdraws, one staff
   * member's right to set up zones (ADR 0238, the founder 2026-09-29:
   * "managers/owners+ the people they assign"). Only a staff member with an
   * active membership here is assigned (an owner or manager has the right by
   * role); withdrawing is allowed whatever the person's role now, so a grant
   * left from before a promotion can be cleared. Every change is a
   * `zone_setup_access_changed` row in `system_audit_log` and a notice to the
   * person; a save that moves nothing records nothing. The write is a
   * compare-and-set on the before-state, so two saves at once cannot both
   * report a change.
   */
  async setSetupAccess(
    actorUserId: string | null | undefined,
    restaurantId: string,
    targetUserId: string,
    allowed: boolean,
  ): Promise<{
    userId: string;
    allowed: boolean;
    changed: boolean;
    audited: boolean;
    notified: boolean;
  }> {
    const db = this.dbService.supabase;
    if (!actorUserId) {
      throw new ForbiddenException(
        "This session names nobody, so it cannot assign anyone. Nothing was changed.",
      );
    }
    const actorRole = await roleHere(db, actorUserId, restaurantId);
    if (actorRole !== "owner" && actorRole !== "manager") {
      throw new ForbiddenException(
        "Only an owner or a manager of this house assigns who may set up its zones. Nothing was changed.",
      );
    }
    const { data: target, error: readErr } = await db
      .from("user_restaurant_access")
      .select("role, is_active, zone_setup_access")
      .eq("user_id", targetUserId)
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .maybeSingle();
    if (readErr) {
      throw new InternalServerErrorException(
        `This person's access here could not be read (${readErr.message}), so nothing was changed.`,
      );
    }
    const row = target as {
      role?: string | null;
      zone_setup_access?: boolean | null;
    } | null;
    if (!row) {
      // Another house's person answers like a missing one (ADR 0147).
      throw new NotFoundException("That person is not a member of this house.");
    }
    const targetRole = (row.role ?? "").trim().toLowerCase();
    if (allowed && targetRole !== "staff") {
      throw new BadRequestException(
        targetRole === "owner" || targetRole === "manager"
          ? `That person is ${targetRole === "owner" ? "an owner" : "a manager"} here and sets up zones already. Nothing was changed.`
          : "Only a staff member of this house is assigned to set up zones. Nothing was changed.",
      );
    }
    const before = row.zone_setup_access === true;
    if (before === allowed) {
      return {
        userId: targetUserId,
        allowed,
        changed: false,
        audited: false,
        notified: false,
      };
    }
    const { data: written, error: writeErr } = await db
      .from("user_restaurant_access")
      .update({ zone_setup_access: allowed })
      .eq("user_id", targetUserId)
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .eq("zone_setup_access", before)
      .select("user_id");
    if (writeErr) {
      this.logger.error(
        `setSetupAccess could not write the zone switch for ${targetUserId}: ${writeErr.message}`,
      );
      throw new InternalServerErrorException(
        "The zone setup switch was not saved, so this person's access is unchanged.",
      );
    }
    if (!written || (written as unknown[]).length === 0) {
      throw new ConflictException(
        "This person's access changed while you were looking. Nothing was saved; reload and try again.",
      );
    }
    const receipt = await recordAccessChange(db, this.logger, {
      restaurantId,
      actorUserId,
      targetUserId,
      action: "zone_setup_access_changed",
      entityType: "restaurant_member",
      entityId: targetUserId,
      changes: { zone_setup_access: { from: before, to: allowed } },
      notice: allowed
        ? {
            title: "You can now set up zones",
            message:
              "An owner or manager of this restaurant assigned you to set up its storage zones: you can add, rename, resize and delete them. Your other rights are unchanged.",
          }
        : {
            title: "You no longer set up zones",
            message:
              "An owner or manager of this restaurant withdrew your right to set up its storage zones. You can still place and count wines in them.",
          },
    });
    return { userId: targetUserId, allowed, changed: true, ...receipt };
  }

  async listLocations(restaurantId: string) {
    const client = this.dbService.supabase;
    const { data, error } = await client
      .from("storage_locations")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .order("display_order", { ascending: true, nullsFirst: false });

    if (error) {
      this.logger.error(`Failed to list locations: ${error.message}`);
      throw new HttpException(
        error.message || "Failed to fetch locations",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return (data || []).map((r) => this.mapLocation(r as StorageLocationRow));
  }

  async listMappings(restaurantId: string) {
    const client = this.dbService.supabase;
    const { data, error } = await client
      .from("wine_location_mappings")
      .select("*")
      .eq("restaurant_id", restaurantId);

    if (error) {
      this.logger.error(`Failed to list mappings: ${error.message}`);
      throw new HttpException(
        error.message || "Failed to fetch mappings",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return (data || []).map((r) =>
      this.mapMapping(r as WineLocationMappingRow),
    );
  }

  async createLocation(restaurantId: string, dto: CreateStorageLocationDto) {
    const client = this.dbService.supabase;
    const payload: Record<string, unknown> = {
      restaurant_id: restaurantId,
      zone: dto.name ?? "New Location",
      // capacity_bottles is NOT NULL, so this column cannot hold "unknown".
      // The honest consequence is that the caller must supply one — the DTO
      // now requires it — rather than the server inventing 100 on their behalf.
      capacity_bottles: dto.capacity,
      current_occupancy: 0,
      color_code: dto.color ?? "#6b7280",
      notes: dto.notes ?? null,
      is_active: true,
    };

    const { data, error } = await client
      .from("storage_locations")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      this.logger.error(`Failed to create location: ${error.message}`);
      throw new HttpException(
        error.message || "Failed to create location",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return this.mapLocation(data as StorageLocationRow);
  }

  async updateLocation(
    restaurantId: string,
    locationId: string,
    dto: UpdateStorageLocationDto,
  ) {
    const client = this.dbService.supabase;
    const payload: Record<string, unknown> = {};
    if (dto.name !== undefined) payload.zone = dto.name;
    if (dto.capacity !== undefined) payload.capacity_bottles = dto.capacity;
    if (dto.current_count !== undefined)
      payload.current_occupancy = dto.current_count;
    if (dto.color !== undefined) payload.color_code = dto.color;
    if (dto.notes !== undefined) payload.notes = dto.notes;
    payload.updated_at = new Date().toISOString();

    const { data, error } = await client
      .from("storage_locations")
      .update(payload)
      .eq("id", locationId)
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .select("*")
      // Not `.single()`: another house's (or a missing) id matched no row and
      // `.single()` turned that into a 500. No row is the 404 below.
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to update location: ${error.message}`);
      throw new HttpException(
        error.message || "Failed to update location",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    if (!data) {
      throw new HttpException("Location not found", HttpStatus.NOT_FOUND);
    }
    return this.mapLocation(data as StorageLocationRow);
  }

  async deleteLocation(restaurantId: string, locationId: string) {
    const client = this.dbService.supabase;
    const { data, error } = await client
      .from("storage_locations")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", locationId)
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .select("id");

    if (error) {
      this.logger.error(`Failed to delete location: ${error.message}`);
      throw new HttpException(
        error.message || "Failed to delete location",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    // A delete that matched nothing (another house's id, a missing one, or one
    // already deleted) used to answer `{ success: true }` having touched no row.
    if (!data || (data as unknown[]).length === 0) {
      throw new HttpException(
        "No storage location of this house has that id.",
        HttpStatus.NOT_FOUND,
      );
    }
    return { success: true };
  }

  async assignWineToLocation(
    restaurantId: string,
    dto: AssignWineToLocationDto,
  ) {
    // The mapping row carries the caller's house, but `location_id` is only a
    // foreign key to `storage_locations(id)`: it would accept another house's
    // zone. Refused before anything is written.
    await this.assertLocationIsTheHouses(restaurantId, dto.locationId);
    const client = this.dbService.supabase;
    const quantity = dto.quantity ?? 1;

    const { data, error } = await client
      .from("wine_location_mappings")
      .upsert(
        {
          restaurant_id: restaurantId,
          wine_id: dto.wineId,
          location_id: dto.locationId,
          quantity,
          assigned_at: new Date().toISOString(),
        },
        {
          onConflict: "restaurant_id,wine_id",
        },
      )
      .select("*")
      .single();

    if (error) {
      this.logger.error(`Failed to assign wine to location: ${error.message}`);
      throw new HttpException(
        error.message || "Failed to assign wine to location",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return this.mapMapping(data as WineLocationMappingRow);
  }

  async getWinesAtLocation(
    restaurantId: string,
    locationId: string,
  ): Promise<EnrichedWineAtLocation[]> {
    // Another house's zone is a 404, not an empty one.
    await this.assertLocationIsTheHouses(restaurantId, locationId);
    const client = this.dbService.supabase;

    const { data: mappings, error: mappingsError } = await client
      .from("wine_location_mappings")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("location_id", locationId);

    if (mappingsError) {
      this.logger.error(
        `Failed to get wines at location: ${mappingsError.message}`,
      );
      throw new HttpException(
        mappingsError.message || "Failed to fetch wines at location",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    if (!mappings || mappings.length === 0) return [];

    const wineIds = (mappings as WineLocationMappingRow[]).map(
      (m) => m.wine_id,
    );

    const { data: wines } = await client
      .from("master_wine_library")
      .select("id, wine_name, name, producer, vintage")
      .in("id", wineIds);

    const wineMap = new Map<
      string,
      { wineName: string; producer: string; vintage: string | null }
    >();
    (wines || []).forEach((w: Record<string, unknown>) => {
      wineMap.set(w.id as string, {
        wineName:
          (w.wine_name as string) || (w.name as string) || (w.id as string),
        producer: (w.producer as string) || "",
        vintage: (w.vintage as string) ?? null,
      });
    });

    return (mappings as WineLocationMappingRow[]).map((m) => {
      const wineInfo = wineMap.get(m.wine_id);
      return {
        wineId: m.wine_id,
        wineName: wineInfo?.wineName ?? m.wine_id,
        producer: wineInfo?.producer ?? "",
        vintage: wineInfo?.vintage ?? null,
        quantity: m.quantity ?? 1,
        assignedAt: m.assigned_at ?? new Date().toISOString(),
      };
    });
  }

  async removeWineFromLocation(restaurantId: string, wineId: string) {
    const client = this.dbService.supabase;
    const { error } = await client
      .from("wine_location_mappings")
      .delete()
      .eq("restaurant_id", restaurantId)
      .eq("wine_id", wineId);

    if (error) {
      this.logger.error(
        `Failed to remove wine from location: ${error.message}`,
      );
      throw new HttpException(
        error.message || "Failed to remove wine from location",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return { success: true };
  }
}
