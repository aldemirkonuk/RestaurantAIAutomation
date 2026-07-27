import { randomUUID } from "crypto";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

export interface RestaurantBranch {
  id: string;
  name: string;
  city: string | null;
  chain_id: string | null;
  chain_name: string | null;
}

export interface RestaurantChain {
  id: string;
  name: string;
  cuisine_type: string | null;
}

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  private async getUserOrgIds(userId: string): Promise<string[]> {
    const { data: memberships, error } = await this.databaseService.supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", userId);
    if (error || !memberships) return [];
    return memberships.map((m) => m.organization_id);
  }

  /**
   * Returns the org IDs for a user. If no org membership row exists (legacy users
   * who registered before the org system), derives org from the user's restaurant_id
   * and repairs the missing membership row.
   */
  private async getUserOrgIdsWithFallback(userId: string): Promise<string[]> {
    let orgIds = await this.getUserOrgIds(userId);
    if (orgIds.length > 0) return orgIds;

    this.logger.debug(
      `No org memberships found for user ${userId} — trying restaurant_id fallback`,
    );
    const { data: user } = await this.databaseService.supabase
      .from("users")
      .select("restaurant_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (user?.restaurant_id) {
      const { data: rest } = await this.databaseService.supabase
        .from("restaurants")
        .select("organization_id")
        .eq("id", user.restaurant_id)
        .maybeSingle();
      if (rest?.organization_id) {
        orgIds = [rest.organization_id];
        // Repair missing membership so future calls skip this fallback.
        // Default to 'member' — never silently escalate a legacy user to 'owner'.
        await this.databaseService.supabase.from("organization_members").upsert(
          {
            organization_id: rest.organization_id,
            user_id: userId,
            role: "member",
          },
          { onConflict: "organization_id,user_id" },
        );
      }
    }
    return orgIds;
  }

  async updateLocationChain(
    userId: string,
    restaurantId: string,
    chainId: string | null,
  ): Promise<void> {
    await this.updateLocation(userId, restaurantId, { chainId });
  }

  /**
   * Manager or owner at this restaurant (via user_restaurant_access).
   * Falls back to users.role when URA row is missing (legacy).
   */
  private async assertManagerOrOwner(
    userId: string,
    restaurantId: string,
  ): Promise<void> {
    const { data: access } = await this.databaseService.supabase
      .from("user_restaurant_access")
      .select("role")
      .eq("user_id", userId)
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .maybeSingle();

    let role = access?.role as string | undefined;
    if (!role) {
      const { data: user } = await this.databaseService.supabase
        .from("users")
        .select("role, restaurant_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (user?.restaurant_id === restaurantId) role = user.role;
    }

    if (role !== "owner" && role !== "manager") {
      throw new ForbiddenException(
        "Only managers and owners can edit restaurant details",
      );
    }
  }

  async getLocation(
    userId: string,
    restaurantId: string,
  ): Promise<{
    id: string;
    name: string;
    city: string | null;
    email: string | null;
    phone: string | null;
  }> {
    const orgIds = await this.getUserOrgIdsWithFallback(userId);
    if (orgIds.length === 0)
      throw new ForbiddenException("User has no organization");

    const { data: rest } = await this.databaseService.supabase
      .from("restaurants")
      .select("id, name, city, email, phone")
      .eq("id", restaurantId)
      .in("organization_id", orgIds)
      .maybeSingle();
    if (!rest)
      throw new NotFoundException("Restaurant not found or access denied");

    return {
      id: rest.id,
      name: rest.name,
      city: rest.city ?? null,
      email: rest.email ?? null,
      phone: rest.phone ?? null,
    };
  }

  async updateLocation(
    userId: string,
    restaurantId: string,
    dto: {
      chainId?: string | null;
      name?: string;
      city?: string;
      email?: string;
      phone?: string;
    },
  ): Promise<void> {
    const orgIds = await this.getUserOrgIdsWithFallback(userId);
    if (orgIds.length === 0)
      throw new ForbiddenException("User has no organization");

    const { data: rest } = await this.databaseService.supabase
      .from("restaurants")
      .select("organization_id")
      .eq("id", restaurantId)
      .in("organization_id", orgIds)
      .maybeSingle();
    if (!rest)
      throw new NotFoundException("Restaurant not found or access denied");

    const touchesOps =
      dto.name !== undefined ||
      dto.city !== undefined ||
      dto.email !== undefined ||
      dto.phone !== undefined ||
      dto.chainId !== undefined;
    if (touchesOps) {
      await this.assertManagerOrOwner(userId, restaurantId);
    }

    if (dto.chainId !== undefined && dto.chainId !== null) {
      const { data: chain } = await this.databaseService.supabase
        .from("restaurant_chains")
        .select("organization_id")
        .eq("id", dto.chainId)
        .in("organization_id", orgIds)
        .maybeSingle();
      if (!chain)
        throw new NotFoundException("Chain not found or access denied");
    }

    const patch: Record<string, unknown> = {};
    if (dto.chainId !== undefined) patch.chain_id = dto.chainId;
    if (dto.name?.trim()) patch.name = dto.name.trim();
    if (dto.city !== undefined) patch.city = dto.city?.trim() || null;
    if (dto.email !== undefined) patch.email = dto.email.trim() || null;
    if (dto.phone !== undefined) patch.phone = dto.phone.trim() || null;

    if (Object.keys(patch).length === 0) return;

    const { error } = await this.databaseService.supabase
      .from("restaurants")
      .update(patch)
      .eq("id", restaurantId)
      .in("organization_id", orgIds);
    if (error)
      throw new InternalServerErrorException("Failed to update location");
  }

  async renameChain(
    userId: string,
    chainId: string,
    name: string,
  ): Promise<void> {
    const orgIds = await this.getUserOrgIdsWithFallback(userId);
    if (orgIds.length === 0)
      throw new ForbiddenException("User has no organization");

    const { data: existing } = await this.databaseService.supabase
      .from("restaurant_chains")
      .select("id")
      .eq("id", chainId)
      .in("organization_id", orgIds)
      .maybeSingle();
    if (!existing)
      throw new NotFoundException("Chain not found or access denied");

    const { error } = await this.databaseService.supabase
      .from("restaurant_chains")
      .update({ name: name.trim() })
      .eq("id", chainId)
      .in("organization_id", orgIds);
    if (error) throw new InternalServerErrorException("Failed to rename chain");
  }

  async deleteChain(userId: string, chainId: string): Promise<void> {
    const orgIds = await this.getUserOrgIdsWithFallback(userId);
    if (orgIds.length === 0)
      throw new ForbiddenException("User has no organization");

    const { data: existing } = await this.databaseService.supabase
      .from("restaurant_chains")
      .select("id")
      .eq("id", chainId)
      .in("organization_id", orgIds)
      .maybeSingle();
    if (!existing)
      throw new NotFoundException("Chain not found or access denied");

    // Detach all locations first so the delete doesn't fail on FK
    await this.databaseService.supabase
      .from("restaurants")
      .update({ chain_id: null })
      .eq("chain_id", chainId)
      .in("organization_id", orgIds);

    const { error } = await this.databaseService.supabase
      .from("restaurant_chains")
      .delete()
      .eq("id", chainId)
      .in("organization_id", orgIds);
    if (error) throw new InternalServerErrorException("Failed to delete chain");
  }

  async getBranchesForUser(userId: string): Promise<RestaurantBranch[]> {
    const orgIds = await this.getUserOrgIdsWithFallback(userId);
    const byId = new Map<string, RestaurantBranch>();

    const mapRow = (r: any): RestaurantBranch => ({
      id: r.id,
      name: r.name,
      city: r.city ?? null,
      chain_id: r.chain_id ?? null,
      chain_name: r.restaurant_chains?.name ?? null,
    });

    if (orgIds.length > 0) {
      const { data: restaurants, error: restErr } =
        await this.databaseService.supabase
          .from("restaurants")
          .select("id, name, city, chain_id, restaurant_chains(name)")
          .in("organization_id", orgIds);

      if (restErr) {
        this.logger.error(
          `Failed to fetch branches for user ${userId}: ${restErr.message}`,
        );
      } else {
        for (const r of restaurants ?? []) byId.set(r.id, mapRow(r));
      }
    }

    // Legacy / org-less restaurants: still list anything the user can access via URA.
    const { data: uraRows, error: uraErr } =
      await this.databaseService.supabase
        .from("user_restaurant_access")
        .select(
          "restaurant_id, restaurants(id, name, city, chain_id, restaurant_chains(name))",
        )
        .eq("user_id", userId)
        .eq("is_active", true);

    if (uraErr) {
      this.logger.error(
        `Failed to fetch URA branches for user ${userId}: ${uraErr.message}`,
      );
    } else {
      for (const row of uraRows ?? []) {
        const r = (row as any).restaurants;
        if (r?.id && !byId.has(r.id)) byId.set(r.id, mapRow(r));
      }
    }

    // Final fallback: users.restaurant_id (pre-org single-restaurant accounts)
    if (byId.size === 0) {
      const { data: user } = await this.databaseService.supabase
        .from("users")
        .select("restaurant_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (user?.restaurant_id) {
        const { data: r } = await this.databaseService.supabase
          .from("restaurants")
          .select("id, name, city, chain_id, restaurant_chains(name)")
          .eq("id", user.restaurant_id)
          .maybeSingle();
        if (r) byId.set(r.id, mapRow(r));
      }
    }

    return [...byId.values()];
  }

  async getChainsForUser(userId: string): Promise<RestaurantChain[]> {
    const orgIds = await this.getUserOrgIdsWithFallback(userId);
    if (orgIds.length === 0) return [];

    const { data: chains, error } = await this.databaseService.supabase
      .from("restaurant_chains")
      .select("id, name, cuisine_type")
      .in("organization_id", orgIds)
      .order("name");

    if (error || !chains) {
      this.logger.error(
        `Failed to fetch chains for user ${userId}: ${error?.message}`,
      );
      return [];
    }

    return chains.map((c) => ({
      id: c.id,
      name: c.name,
      cuisine_type: c.cuisine_type ?? null,
    }));
  }

  async createChain(
    userId: string,
    dto: {
      name: string;
      cuisine_type?: string;
      description?: string;
      restaurantId?: string;
    },
  ): Promise<RestaurantChain> {
    const orgIds = await this.getUserOrgIdsWithFallback(userId);
    if (orgIds.length === 0)
      throw new ForbiddenException("User has no organization");

    const { data: ownedOrg } = await this.databaseService.supabase
      .from("organizations")
      .select("id")
      .eq("owner_id", userId)
      .maybeSingle();
    // Fall back to the single org the user belongs to (member/manager); only throw when truly ambiguous
    const organizationId =
      ownedOrg?.id ?? (orgIds.length === 1 ? orgIds[0] : null);
    if (!organizationId) {
      throw new BadRequestException(
        "Cannot determine target organization — please specify organizationId",
      );
    }

    const { data: chain, error } = await this.databaseService.supabase
      .from("restaurant_chains")
      .insert({
        organization_id: organizationId,
        name: dto.name,
        cuisine_type: dto.cuisine_type ?? null,
        description: dto.description ?? null,
      })
      .select("id, name, cuisine_type")
      .single();

    if (error || !chain)
      throw new InternalServerErrorException("Failed to create chain");

    if (dto.restaurantId) {
      try {
        await this.updateLocationChain(userId, dto.restaurantId, chain.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(
          `Chain created but failed to assign restaurant ${dto.restaurantId}: ${msg}`,
        );
        // Do NOT rethrow — chain is valid, partial assignment is recoverable via Edit Location
      }
    }

    return {
      id: chain.id,
      name: chain.name,
      cuisine_type: chain.cuisine_type ?? null,
    };
  }

  async createLocation(
    userId: string,
    dto: {
      name: string;
      address: string;
      city: string;
      country?: string;
      stateProvince?: string;
      postalCode?: string;
      phone?: string;
      cuisineType?: string;
      timezone?: string;
      chainId?: string;
    },
  ): Promise<{ id: string; name: string }> {
    const orgIds = await this.getUserOrgIdsWithFallback(userId);

    if (orgIds.length === 0)
      throw new ForbiddenException("User has no organization");

    const { data: ownedOrg } = await this.databaseService.supabase
      .from("organizations")
      .select("id")
      .eq("owner_id", userId)
      .maybeSingle();
    const organizationId =
      ownedOrg?.id ?? (orgIds.length === 1 ? orgIds[0] : null);
    if (!organizationId) {
      throw new BadRequestException(
        "Cannot determine target organization — please specify organizationId",
      );
    }

    // Verify that the supplied chainId belongs to one of the user's orgs
    if (dto.chainId) {
      const { data: chain } = await this.databaseService.supabase
        .from("restaurant_chains")
        .select("organization_id")
        .eq("id", dto.chainId)
        .in("organization_id", orgIds)
        .maybeSingle();
      if (!chain)
        throw new NotFoundException("Chain not found or access denied");
    }

    const slugBase = dto.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const slug = `${slugBase}-${randomUUID().slice(0, 8)}`;

    const { data: restaurant, error } = await this.databaseService.supabase
      .from("restaurants")
      .insert({
        name: dto.name,
        slug,
        address: { street: dto.address },
        city: dto.city,
        country: dto.country ?? null,
        state_province: dto.stateProvince ?? null,
        postal_code: dto.postalCode ?? null,
        phone: dto.phone ?? null,
        cuisine_type: dto.cuisineType ?? null,
        timezone: dto.timezone ?? "America/New_York",
        organization_id: organizationId,
        chain_id: dto.chainId ?? null,
      })
      .select("id, name")
      .single();

    if (error || !restaurant)
      throw new InternalServerErrorException("Failed to create location");
    return { id: restaurant.id, name: restaurant.name };
  }
}
