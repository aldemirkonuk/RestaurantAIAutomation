import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

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
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId);
    if (error || !memberships) return [];
    return memberships.map((m) => m.organization_id);
  }

  async getBranchesForUser(userId: string): Promise<RestaurantBranch[]> {
    const orgIds = await this.getUserOrgIds(userId);

    if (orgIds.length === 0) {
      this.logger.debug(
        `No org memberships found for user ${userId} — returning single restaurant fallback`,
      );
      // Fallback: return user's direct restaurant (for users who registered before org system)
      const { data: user } = await this.databaseService.supabase
        .from('users')
        .select('restaurant_id')
        .eq('user_id', userId)
        .maybeSingle();
      if (!user?.restaurant_id) return [];
      const { data: restaurant } = await this.databaseService.supabase
        .from('restaurants')
        .select('id, name, city, chain_id')
        .eq('id', user.restaurant_id)
        .maybeSingle();
      return restaurant
        ? [
            {
              id: restaurant.id,
              name: restaurant.name,
              city: restaurant.city ?? null,
              chain_id: null,
              chain_name: null,
            },
          ]
        : [];
    }

    // Fetch all restaurants belonging to these organizations, with chain info via LEFT JOIN
    const { data: restaurants, error: restErr } =
      await this.databaseService.supabase
        .from('restaurants')
        .select('id, name, city, chain_id, restaurant_chains(name)')
        .in('organization_id', orgIds);

    if (restErr || !restaurants) {
      this.logger.error(
        `Failed to fetch branches for user ${userId}: ${restErr?.message}`,
      );
      return [];
    }

    return restaurants.map((r: any) => ({
      id: r.id,
      name: r.name,
      city: r.city ?? null,
      chain_id: r.chain_id ?? null,
      chain_name: r.restaurant_chains?.name ?? null,
    }));
  }

  async getChainsForUser(userId: string): Promise<RestaurantChain[]> {
    const orgIds = await this.getUserOrgIds(userId);
    if (orgIds.length === 0) return [];

    const { data: chains, error } = await this.databaseService.supabase
      .from('restaurant_chains')
      .select('id, name, cuisine_type')
      .in('organization_id', orgIds)
      .order('name');

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
    dto: { name: string; cuisine_type?: string; description?: string },
  ): Promise<RestaurantChain> {
    const orgIds = await this.getUserOrgIds(userId);
    if (orgIds.length === 0) throw new Error('User has no organization');

    const { data: ownedOrg } = await this.databaseService.supabase
      .from('organizations')
      .select('id')
      .eq('owner_id', userId)
      .maybeSingle();
    const organizationId = ownedOrg?.id ?? orgIds[0];

    const { data: chain, error } = await this.databaseService.supabase
      .from('restaurant_chains')
      .insert({
        organization_id: organizationId,
        name: dto.name,
        cuisine_type: dto.cuisine_type ?? null,
        description: dto.description ?? null,
      })
      .select('id, name, cuisine_type')
      .single();

    if (error || !chain)
      throw new Error(`Failed to create chain: ${error?.message}`);
    return { id: chain.id, name: chain.name, cuisine_type: chain.cuisine_type ?? null };
  }

  async createLocation(
    userId: string,
    dto: {
      name: string;
      address: string;
      city: string;
      phone?: string;
      cuisineType?: string;
      timezone?: string;
      chainId?: string;
    },
  ): Promise<{ id: string; name: string }> {
    let orgIds = await this.getUserOrgIds(userId);

    // Fallback: derive org from the user's existing restaurant if org_member row is missing
    if (orgIds.length === 0) {
      const { data: user } = await this.databaseService.supabase
        .from('users')
        .select('restaurant_id')
        .eq('user_id', userId)
        .maybeSingle();
      if (user?.restaurant_id) {
        const { data: rest } = await this.databaseService.supabase
          .from('restaurants')
          .select('organization_id')
          .eq('id', user.restaurant_id)
          .maybeSingle();
        if (rest?.organization_id) {
          orgIds = [rest.organization_id];
          // Repair the missing membership row so future calls don't need this fallback
          await this.databaseService.supabase.from('organization_members').upsert(
            { organization_id: rest.organization_id, user_id: userId, role: 'owner' },
            { onConflict: 'organization_id,user_id' },
          );
        }
      }
    }

    if (orgIds.length === 0) throw new Error('User has no organization — cannot add location');

    const { data: ownedOrg } = await this.databaseService.supabase
      .from('organizations')
      .select('id')
      .eq('owner_id', userId)
      .maybeSingle();
    const organizationId = ownedOrg?.id ?? orgIds[0];

    const { data: restaurant, error } = await this.databaseService.supabase
      .from('restaurants')
      .insert({
        name: dto.name,
        address: { street: dto.address },
        city: dto.city,
        phone: dto.phone ?? null,
        cuisine_type: dto.cuisineType ?? null,
        timezone: dto.timezone ?? 'America/New_York',
        organization_id: organizationId,
        chain_id: dto.chainId ?? null,
      })
      .select('id, name')
      .single();

    if (error || !restaurant)
      throw new Error(`Failed to create location: ${error?.message}`);
    return { id: restaurant.id, name: restaurant.name };
  }
}
