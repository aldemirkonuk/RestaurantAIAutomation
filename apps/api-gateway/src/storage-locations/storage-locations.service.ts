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
      capacity: row.capacity_bottles ?? 100,
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
      capacity_bottles: dto.capacity ?? 100,
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
      .single();

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
    const { error } = await client
      .from("storage_locations")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", locationId)
      .eq("restaurant_id", restaurantId);

    if (error) {
      this.logger.error(`Failed to delete location: ${error.message}`);
      throw new HttpException(
        error.message || "Failed to delete location",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
