import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { DatabaseService } from '../database/database.service';

/** Same branch authority for a JWT request and a delayed browser consent. */
export async function currentRestaurantRole(
  client: DatabaseService['supabase'],
  user: { user_id: string; restaurant_id?: string | null },
  restaurantId: string,
): Promise<string> {
    // A signed house selects the membership to check; the user's home role is
    // not authority in another branch. Re-check revocation and role changes.
    const { data: membership, error } = await client
      .from("user_restaurant_access")
      .select("role, is_active")
      .eq("user_id", user.user_id)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (error)
      throw new ServiceUnavailableException(
        "Branch access could not be verified",
      );
    if (membership) {
      if (
        membership.is_active !== true ||
        !["owner", "manager", "staff"].includes(membership.role)
      ) {
        throw new UnauthorizedException(
          "Access to this branch has been revoked or its role is unreadable",
        );
      }
      return membership.role;
    }
    // ADR 0088 T5: the legacy row proves home membership, not privilege.
    if (restaurantId === user.restaurant_id) return "staff";
    throw new UnauthorizedException("You do not have access to this branch");
}
