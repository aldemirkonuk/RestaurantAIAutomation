import { IsUUID } from "class-validator";

/**
 * Body of POST /auth/held-memberships/accept (ADR 0229 fork 13): the held
 * membership (its `user_restaurant_access` id, as `GET /auth/houses` lists it
 * under `held`) the signed-in, verified person accepts. A membership id, not a
 * house id: the route acts on the person's own row, like
 * `POST /auth/invite/:code/accept` acts on an invite, and names no house for
 * the tenant check to compare (ADR 0019 keeps `@AllowsTenantChange` on one
 * route only).
 */
export class AcceptHeldMembershipDto {
  @IsUUID(undefined, { message: "Choose a house to join." })
  membershipId: string;
}
