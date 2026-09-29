import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  CreateStorageLocationDto,
  UpdateStorageLocationDto,
  AssignWineToLocationDto,
} from "./dto/storage-locations.dto";

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
  /** The zone this one sits inside; NULL = top level (migration 20261202110000). */
  parent_id?: string | null;
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
      parent_id: row.parent_id ?? null,
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

  /**
   * A zone's parent must be a live zone of the same restaurant, not the zone
   * itself, and not a zone already inside it (a cycle). Founder answer
   * 2026-09-29 ("Add parent column (Recommended)"), migration
   * 20261202110000_a_zone_can_sit_inside_another_zone. The database enforces
   * the same rules in trigger storage_locations_parent_guard, so this is the
   * wording a person reads, not the only wall; `dbRefusal` turns the trigger's
   * 23514 into the same 422 for a race this read could not see.
   *
   * One read of the restaurant's live zones (id, parent_id), walked in memory.
   * A parent that is not in that set is answered the same whether it belongs
   * to another restaurant or does not exist, so the answer says nothing about
   * another house's zones.
   */
  private async refuseBadParent(
    restaurantId: string,
    locationId: string | null,
    parentId: string | null | undefined,
  ) {
    if (parentId == null) return;
    if (locationId !== null && parentId === locationId) {
      throw new HttpException(
        "A zone cannot sit inside itself: this zone was not changed.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const { data, error } = await this.dbService.supabase
      .from("storage_locations")
      .select("id, parent_id")
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null);
    if (error) {
      this.logger.error(`Failed to read the zone tree: ${error.message}`);
      throw new HttpException(
        error.message || "Failed to check the parent zone",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    const parentOf = new Map<string, string | null>();
    for (const r of (data ?? []) as {
      id: string;
      parent_id?: string | null;
    }[]) {
      parentOf.set(r.id, r.parent_id ?? null);
    }
    if (!parentOf.has(parentId)) {
      throw new HttpException(
        "The parent zone is not a zone of this restaurant: this zone was not changed.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (locationId === null) return; // a new zone has nothing inside it yet
    const seen = new Set<string>();
    let at: string | null = parentId;
    while (at != null && !seen.has(at)) {
      if (at === locationId) {
        throw new HttpException(
          "That parent is already inside this zone; a zone cannot sit inside its own contents. This zone was not changed.",
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      seen.add(at);
      at = parentOf.get(at) ?? null;
    }
  }

  /**
   * The parent guard's refusals (trigger storage_locations_parent_guard and
   * CHECK storage_locations_parent_is_not_self, both 23514) and a parent id
   * that is no row at all (the foreign key, 23503) are the caller's to fix:
   * a 422 in the database's words, not a 500.
   *
   * A write that lost a lock race (40P01 deadlock_detected, 40001
   * serialization_failure) wrote nothing and succeeds if sent again, so it is
   * a 409 that says so. The known case (verifier nit on #515, 2026-09-29): a
   * soft delete of a parent and a concurrent move of a zone under it take
   * the parent's row, the child's row and the house's advisory lock in
   * opposite orders, and Postgres aborts one. Taking the advisory lock first
   * in the orphan trigger would not remove it: the delete's UPDATE locks the
   * parent's row before any row trigger runs, and the move's guard waits on
   * that row while holding the advisory lock.
   */
  private dbRefusal(
    error: { code?: string; message?: string },
    fallback: string,
  ) {
    if (error.code === "40P01" || error.code === "40001") {
      return new HttpException(
        "Another change to this house's zones was being saved at the same moment, so this one was not saved. Nothing was changed: try again.",
        HttpStatus.CONFLICT,
      );
    }
    const callersToFix = error.code === "23514" || error.code === "23503";
    return new HttpException(
      error.message || fallback,
      callersToFix
        ? HttpStatus.UNPROCESSABLE_ENTITY
        : HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  async createLocation(restaurantId: string, dto: CreateStorageLocationDto) {
    await this.refuseBadParent(restaurantId, null, dto.parent_id);
    const client = this.dbService.supabase;
    const payload: Record<string, unknown> = {
      restaurant_id: restaurantId,
      parent_id: dto.parent_id ?? null,
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
      throw this.dbRefusal(error, "Failed to create location");
    }
    return this.mapLocation(data as StorageLocationRow);
  }

  async updateLocation(
    restaurantId: string,
    locationId: string,
    dto: UpdateStorageLocationDto,
  ) {
    await this.refuseBadParent(restaurantId, locationId, dto.parent_id);
    const client = this.dbService.supabase;
    const payload: Record<string, unknown> = {};
    // Absent = leave the parent alone; null = move the zone to the top level.
    if (dto.parent_id !== undefined) payload.parent_id = dto.parent_id;
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
      .single();

    if (error) {
      this.logger.error(`Failed to update location: ${error.message}`);
      throw this.dbRefusal(error, "Failed to update location");
    }
    if (!data) {
      throw new HttpException("Location not found", HttpStatus.NOT_FOUND);
    }
    return this.mapLocation(data as StorageLocationRow);
  }

  /**
   * A soft delete. The zones inside it are not deleted: trigger
   * storage_locations_orphans_go_top_level (migration 20261202110000) clears
   * their parent_id in the same statement, so they become top-level zones.
   */
  async deleteLocation(restaurantId: string, locationId: string) {
    const client = this.dbService.supabase;
    const { error } = await client
      .from("storage_locations")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", locationId)
      .eq("restaurant_id", restaurantId);

    if (error) {
      this.logger.error(`Failed to delete location: ${error.message}`);
      throw this.dbRefusal(error, "Failed to delete location");
    }
    return { success: true };
  }

  async assignWineToLocation(
    restaurantId: string,
    dto: AssignWineToLocationDto,
  ) {
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
