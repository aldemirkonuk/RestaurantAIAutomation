import { randomUUID } from "crypto";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ConflictException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ORG_OWNER } from "./org-role";
import { DatabaseService } from "../database/database.service";
import { resolveSignUpTimezone } from "../auth/sign-up-timezone";
import {
  SettingsAuditService,
  type FieldChange,
} from "../settings-audit/settings-audit.service";
import {
  checkHouseStateCountry,
  resolveHouseCountry,
} from "./house-state-country";

/**
 * What this person is at this restaurant — the ONE implementation of the
 * two-step lookup (`user_restaurant_access`, then the legacy `users.role`).
 *
 * `readError` is set whenever a read the answer depends on failed: the access
 * row (whose absence is what sends us to the legacy home, so an unreadable one
 * leaves the answer unknown even when the legacy row names a role), or the
 * legacy row when it was needed.
 *
 * Module-level so the vendor-send authority (`vendor-send-authority.service.ts`,
 * ADR 0175 D10) can use the same rule without importing this whole service and
 * the module graph behind it. Lifted, not copied: a second copy of "what is
 * this person here" is how a gate and the page that explains it drift apart
 * (`decideApproval`'s header makes the same argument). [2026-09-27, PR #436
 * train 8: until this date the lane's `readRestaurantRole` below WAS a second
 * copy of `OrganizationsService.lookupRestaurantRole`, which main had carried
 * since 2026-09-17; that method's body now lives here, and every reading of
 * the rule, strict or not, goes through this one function.]
 */
export async function lookupRestaurantRole(
  supabase: DatabaseService["supabase"],
  userId: string,
  restaurantId: string,
): Promise<{ role: string | null; readError: string | null }> {
  const { data: access, error: accessError } = await supabase
    .from("user_restaurant_access")
    .select("role")
    .eq("user_id", userId)
    .eq("restaurant_id", restaurantId)
    .eq("is_active", true)
    .maybeSingle();

  const fromAccess = (access as { role?: string } | null)?.role;
  if (fromAccess) return { role: fromAccess, readError: null };

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("role, restaurant_id")
    .eq("user_id", userId)
    .maybeSingle();
  const legacy = user as { role?: string; restaurant_id?: string } | null;
  const role =
    legacy?.restaurant_id === restaurantId ? (legacy.role ?? null) : null;
  const readError = accessError
    ? `this house's access register could not be read (${accessError.message})`
    : userError
      ? `the person's home house could not be read (${userError.message})`
      : null;
  return { role, readError };
}

/**
 * The same answer, read one of two ways.
 *
 * `strict: false` is the historical behaviour `resolveRestaurantRole` keeps: a
 * read that FAILS returns `null`, the same as a person with no row, and every
 * caller must treat `null` as "not proven to outrank anything".
 *
 * `strict: true` throws on a failed read instead. The send gate needs that: a
 * readout that turns "the role could not be read" into "ask a manager" would
 * report an outage as a fact about the person (ADR 0020).
 */
export async function readRestaurantRole(
  supabase: DatabaseService["supabase"],
  userId: string,
  restaurantId: string,
  opts: { strict: boolean },
): Promise<string | null> {
  const { role, readError } = await lookupRestaurantRole(
    supabase,
    userId,
    restaurantId,
  );
  if (readError && opts.strict) {
    throw new InternalServerErrorException(
      `This person's role in the house could not be read (${readError}).`,
    );
  }
  return role;
}

/**
 * A role read that FAILED, as opposed to a person with no role. Thrown only by
 * `OrganizationsService.readRestaurantRole`; its message says which read.
 */
export class RestaurantRoleUnreadableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestaurantRoleUnreadableError";
  }
}

export interface RestaurantBranch {
  id: string;
  name: string;
  city: string | null;
  chain_id: string | null;
  chain_name: string | null;
  /**
   * When this branch's row was last written.
   *
   * `restaurants.updated_at` exists (baseline_from_production.sql:3566-3583)
   * AND is genuinely maintained — `update_restaurants_updated_at BEFORE UPDATE`
   * (baseline:12300) stamps it on every write, so this is a real last-changed
   * date and not a disguised creation date. It was simply never selected, so
   * `/settings`' Locations register had to render an em dash over a date the
   * database was holding (p4 audit BLOCKER 3). Nullable because the column is
   * nullable and because a branch reached through the URA or legacy fallback
   * may arrive from a cached session that predates this field.
   */
  updated_at: string | null;
}

export interface RestaurantChain {
  id: string;
  name: string;
  cuisine_type: string | null;
  /**
   * When this chain's row was last written.
   *
   * `restaurant_chains.updated_at` is `NOT NULL DEFAULT now()`
   * (baseline_from_production.sql:5053-5060) but the table carries **no**
   * `BEFORE UPDATE` trigger — grep the baseline: `update_updated_at_column` is
   * attached to `restaurants` (:12300) and `user_preferences` (:12342) and not
   * to this table. So returning the column alone would have made a rename
   * invisible and reported a creation date as a change date. `renameChain`
   * therefore stamps it explicitly; see the note there (p4 audit BLOCKER 2).
   */
  updated_at: string | null;
}

/** The settings-log action a house's state or country change files (ADR 0289). */
export const HOUSE_STATE_COUNTRY_AUDIT_ACTION = "house_state_country_changed";

/**
 * What `PATCH /organizations/locations/:id` answers (ADR 0289).
 *
 * `stateAndCountry` says what happened to the pair: it was not part of the
 * request, it was sent and already recorded that way, or it moved. `audited`
 * and `auditReason` are the settings log's receipt for a move — the same
 * shape `PUT /settings/time-zone` returns — so a change the log failed to
 * record is said, never inferred from a short list.
 */
export interface LocationUpdateReceipt {
  stateAndCountry: "not-sent" | "unchanged" | "changed";
  audited: boolean;
  auditReason: string | null;
}

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  /**
   * `settingsAudit` files a house's state or country change (ADR 0289).
   *
   * `@Optional()`, and the reason is a second provider, not a convenience:
   * `CommunicationsModule` provides this class directly
   * (`communications/communications.module.ts`, ADR 0149 #19) for
   * `resolveRestaurantRole` alone, and it cannot import `SettingsAuditModule`
   * — that module imports `AuthModule`, which closes the load-time ring
   * auth → communications → settings-audit → auth that module's own comment
   * describes. `OrganizationsModule` imports `SettingsAuditModule`, so the
   * instance behind the route always has it (`check_gateway_boots.sh` builds
   * the real graph). An instance without it never claims a record: the
   * receipt says `audited: false` and names why.
   */
  constructor(
    private readonly databaseService: DatabaseService,
    @Optional() private readonly settingsAudit?: SettingsAuditService,
  ) {}

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
   *
   * `action` only shapes the refusal message. It exists because this helper now
   * guards a READ as well as a write (`getLocation`), and "Only managers and
   * owners can edit restaurant details" would have been a false explanation for
   * a refused GET.
   */
  private async assertManagerOrOwner(
    userId: string,
    restaurantId: string,
    action = "edit restaurant details",
  ): Promise<void> {
    const role = await this.resolveRestaurantRole(userId, restaurantId);

    if (role !== "owner" && role !== "manager") {
      throw new ForbiddenException(
        `Only managers and owners can ${action}`,
      );
    }
  }

  /**
   * What this person is at this restaurant, or `null` if nothing says.
   *
   * The two-step lookup `assertManagerOrOwner` has always done, lifted out and
   * made public because a second caller now needs the ANSWER rather than the
   * refusal: `ProcurementService.approveOrder` has to compare the actor's rank
   * against the rank a threshold rule demands, which is a three-way comparison
   * (`owner` ⪰ `manager` ⪰ anything else), not a yes/no.
   *
   * Lifted rather than copied. A second implementation of "what is this person
   * here" is how the settings page and the gate that enforces it drift apart —
   * the same argument `decideApproval`'s header makes about the policy itself.
   *
   * `userId` is `public.users.user_id` — the id the JWT carries. `auth.users`
   * and `public.users` are DISJOINT in this database, so an `auth.users` id
   * would silently resolve to nobody and every order would read as unroled.
   *
   * A read that FAILS is indistinguishable here from a person with no row, and
   * both return `null`. Callers must therefore treat `null` as "not proven to
   * outrank anything", never as "staff" and never as permission.
   */
  async resolveRestaurantRole(
    userId: string,
    restaurantId: string,
  ): Promise<string | null> {
    return readRestaurantRole(this.databaseService.supabase, userId, restaurantId, {
      strict: false,
    });
  }

  /**
   * The same answer, for a caller that must not read an outage as "no role".
   *
   * Added 2026-09-17 (ADR 0149 #19 review): the mail relay's person door said
   * "could not be shown to hold any role" — a 403 — when the database was down,
   * because `resolveRestaurantRole` above returns `null` for both. Here a
   * failed read THROWS `RestaurantRoleUnreadableError`, so the caller can say
   * 503; `null` still means a genuine absence.
   *
   * One lookup, two readings of it: the rule for "what is this person here"
   * stays in one place (`lookupRestaurantRole`), and the permissive reading's
   * behaviour is unchanged for its existing callers.
   */
  async readRestaurantRole(
    userId: string,
    restaurantId: string,
  ): Promise<string | null> {
    const { role, readError } = await lookupRestaurantRole(
      this.databaseService.supabase,
      userId,
      restaurantId,
    );
    if (readError) throw new RestaurantRoleUnreadableError(readError);
    return role;
  }

  /**
   * The same check, for modules outside this one.
   *
   * `payment-methods` needs it (billing belongs to the house's managers, not to
   * whoever is signed in) and duplicating the two-step URA-then-legacy lookup
   * there would have produced a second, untested copy of the rule that decides
   * who may spend money. One implementation, one spec.
   */
  async assertCanManageRestaurant(
    userId: string,
    restaurantId: string,
    action: string,
  ): Promise<void> {
    return this.assertManagerOrOwner(userId, restaurantId, action);
  }

  /**
   * The restaurant record behind `/profile` and `/settings`.
   *
   * THE READ IS GATED, AND IT WAS NOT (2026-09-03)
   * ----------------------------------------------
   * Until now this method checked organisation membership and stopped, while
   * `updateLocation` called `assertManagerOrOwner` for the same columns. Both
   * clients gate the fetch on the client side only, so any member of the
   * organisation calling `GET /organizations/locations/:id` directly — past the
   * UI — could read the restaurant's billing email and phone. The write posture
   * and the read posture disagreed, and the profile page had to describe the
   * gap in prose instead of stating a rule. It now states one: the same role
   * check runs on both sides, so "managers and owners" is true of the endpoint,
   * not only of the button.
   *
   * `subscription_tier` is added here for the same reason. The column exists
   * (`restaurants.subscription_tier`, baseline_from_production.sql:3582,
   * default 'pilot') and was read by exactly one consumer, the model-spend
   * ceiling, so the browser had no way to name the plan and `/profile` rendered
   * an em dash. Returning it is the whole fix; it is deliberately returned raw
   * (never defaulted to 'free' or 'pilot' in this layer) so an absent value
   * stays absent all the way to the page.
   *
   * `country`, `stateProvince` and `callerRole` are added for ADR 0289: the
   * location editor shows the pair, and lets the caller change it only when
   * `callerRole` is `owner` for THIS house. The role is a fresh, strict read
   * of the target house rather than the token's role, which names the house
   * the session is working in — not necessarily the branch being edited.
   * `callerRole` is `null` when that read failed: the record is still
   * returned (the manager-or-owner gate above it is unchanged), and the
   * editor says the role could not be confirmed instead of guessing.
   * The server stays the authority: `updateLocation` reads the role again.
   */
  async getLocation(
    userId: string,
    restaurantId: string,
  ): Promise<{
    id: string;
    name: string;
    city: string | null;
    email: string | null;
    phone: string | null;
    subscriptionTier: string | null;
    country: string | null;
    stateProvince: string | null;
    callerRole: string | null;
  }> {
    const orgIds = await this.getUserOrgIdsWithFallback(userId);
    if (orgIds.length === 0)
      throw new ForbiddenException("User has no organization");

    const { data: rest } = await this.databaseService.supabase
      .from("restaurants")
      .select(
        "id, name, city, email, phone, subscription_tier, country, state_province",
      )
      .eq("id", restaurantId)
      .in("organization_id", orgIds)
      .maybeSingle();
    if (!rest)
      throw new NotFoundException("Restaurant not found or access denied");

    // Membership proves the restaurant is visible; it does not prove the caller
    // may read its billing contact. Ordered after the lookup so a restaurant
    // outside the org stays a 404 rather than leaking its existence via a 403.
    await this.assertManagerOrOwner(
      userId,
      restaurantId,
      "read the restaurant record",
    );

    let callerRole: string | null;
    try {
      const role = await this.readRestaurantRole(userId, restaurantId);
      callerRole = role ? role.trim().toLowerCase() : null;
    } catch (err) {
      if (!(err instanceof RestaurantRoleUnreadableError)) throw err;
      callerRole = null;
    }

    return {
      id: rest.id,
      name: rest.name,
      city: rest.city ?? null,
      email: rest.email ?? null,
      phone: rest.phone ?? null,
      subscriptionTier: rest.subscription_tier ?? null,
      country: rest.country ?? null,
      stateProvince: rest.state_province ?? null,
      callerRole,
    };
  }

  /**
   * The owner gate for a house's state and country (ADR 0289 R1): the
   * caller's role in the TARGET house, read strictly — a failed read is a 503
   * that says so, never a 403 that blames the person. The house role, the
   * same reading `authority-grants.service.ts` `assertOwner` and the web's
   * `isOwner` use; not the organisation role that gates opening a location
   * (ADR 0164), which awaits the founder's confirmation in ADR 0289.
   */
  private async assertHouseOwnerForPlace(
    userId: string,
    restaurantId: string,
  ): Promise<void> {
    let role: string | null;
    try {
      role = await this.readRestaurantRole(userId, restaurantId);
    } catch (err) {
      if (!(err instanceof RestaurantRoleUnreadableError)) throw err;
      this.logger.error(
        `updateLocation could not read ${userId}'s role at ${restaurantId}: ${err.message}`,
      );
      throw new ServiceUnavailableException(
        `Your role in this house could not be read (${err.message}), so the state and country were not changed. Nothing was changed; try again.`,
      );
    }
    if ((role ?? "").trim().toLowerCase() !== "owner") {
      throw new ForbiddenException(
        "Only an owner of this house can change its state or country, not a manager. Nothing was changed.",
      );
    }
  }

  /**
   * Edit one location. Name, city, chain and billing contact: managers and
   * owners, unchanged. State and country (ADR 0289): owners of this house
   * only, checked against the one country table, written together in the
   * same UPDATE, and filed in the settings log when either moved.
   *
   * The order is the contract. The role is checked before anything is
   * validated or written, so a manager's PATCH that carries a name AND a state
   * is refused whole rather than half-applied; the pair is validated before
   * the write, so a refused state leaves the name unwritten too; and there is
   * one UPDATE, so the pair cannot land without the rest or the rest without
   * the pair. The settings log is written after it, never throws, and its
   * receipt is returned: when the row cannot be written the change stands and
   * the answer says so (the `PUT /settings/time-zone` contract).
   *
   * Currency and time zone never move with the country. They are stated
   * separately, by their own audited settings (ADR 0207).
   */
  async updateLocation(
    userId: string,
    restaurantId: string,
    dto: {
      chainId?: string | null;
      name?: string;
      city?: string;
      email?: string;
      phone?: string;
      country?: string | null;
      stateProvince?: string | null;
    },
  ): Promise<LocationUpdateReceipt> {
    const orgIds = await this.getUserOrgIdsWithFallback(userId);
    if (orgIds.length === 0)
      throw new ForbiddenException("User has no organization");

    // The row's name and place are read here, with the membership check, so
    // the log can name what the state and country WERE. Its error is read:
    // before ADR 0289 a failed read was destructured away and answered as
    // "not found", a 404 for an outage.
    const { data: rest, error: restError } = await this.databaseService.supabase
      .from("restaurants")
      .select("organization_id, name, country, state_province")
      .eq("id", restaurantId)
      .in("organization_id", orgIds)
      .maybeSingle();
    if (restError) {
      this.logger.error(
        `updateLocation could not read restaurant ${restaurantId}: ${restError.message}`,
      );
      throw new ServiceUnavailableException(
        "This location could not be read, so nothing was changed. Try again.",
      );
    }
    if (!rest)
      throw new NotFoundException("Restaurant not found or access denied");

    const placeSent =
      dto.country !== undefined || dto.stateProvince !== undefined;
    const touchesOps =
      dto.name !== undefined ||
      dto.city !== undefined ||
      dto.email !== undefined ||
      dto.phone !== undefined ||
      dto.chainId !== undefined;
    if (placeSent) {
      // An owner of this house is also past the manager-or-owner gate.
      await this.assertHouseOwnerForPlace(userId, restaurantId);
    } else if (touchesOps) {
      await this.assertManagerOrOwner(userId, restaurantId);
    }

    // The pair's own changes, decided before anything is written.
    const placeFields: Record<string, FieldChange> = {};
    const placePatch: Record<string, unknown> = {};
    if (placeSent) {
      const checked = checkHouseStateCountry(dto.country, dto.stateProvince);
      if ("refused" in checked) throw new BadRequestException(checked.refused);

      const storedCountry: string | null = rest.country ?? null;
      const storedState: string | null =
        typeof rest.state_province === "string" && rest.state_province.trim()
          ? rest.state_province
          : null;
      // The country moved when it names a different country, not when it is
      // spelled differently: a house recorded as "US" that is sent "United
      // States" keeps the spelling it has, and no false change is filed.
      const storedCode = resolveHouseCountry(storedCountry)?.code ?? null;
      if (storedCode !== checked.country.code) {
        placePatch.country = checked.country.name;
        placeFields.country = { from: storedCountry, to: checked.country.name };
      }
      if ((storedState ?? null) !== checked.state) {
        placePatch.state_province = checked.state;
        placeFields.state_province = { from: storedState, to: checked.state };
      }
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

    const patch: Record<string, unknown> = { ...placePatch };
    if (dto.chainId !== undefined) patch.chain_id = dto.chainId;
    if (dto.name?.trim()) patch.name = dto.name.trim();
    if (dto.city !== undefined) patch.city = dto.city?.trim() || null;
    if (dto.email !== undefined) patch.email = dto.email.trim() || null;
    if (dto.phone !== undefined) patch.phone = dto.phone.trim() || null;

    const placeMoved = Object.keys(placeFields).length > 0;
    const quiet: LocationUpdateReceipt = placeSent
      ? {
          stateAndCountry: "unchanged",
          audited: false,
          auditReason: "nothing changed",
        }
      : {
          stateAndCountry: "not-sent",
          audited: false,
          auditReason: "the state and country were not part of this change",
        };

    if (Object.keys(patch).length === 0) return quiet;

    const { error } = await this.databaseService.supabase
      .from("restaurants")
      .update(patch)
      .eq("id", restaurantId)
      .in("organization_id", orgIds);
    if (error)
      throw new InternalServerErrorException("Failed to update location");

    if (!placeMoved) return quiet;

    if (!this.settingsAudit) {
      // Reachable only from an instance built without the settings log (a
      // test, or a module that provides this class for its role reads). The
      // change stands; the receipt does not pretend it was recorded.
      this.logger.error(
        `${HOUSE_STATE_COUNTRY_AUDIT_ACTION} at ${restaurantId} was not recorded: this instance has no settings log.`,
      );
      return {
        stateAndCountry: "changed",
        audited: false,
        auditReason:
          "the settings log is not wired into this service, so the change was not recorded",
      };
    }
    const receipt = await this.settingsAudit.record({
      restaurantId,
      actorUserId: userId,
      action: HOUSE_STATE_COUNTRY_AUDIT_ACTION,
      register: "state-and-country",
      entityType: "restaurant",
      entityId: restaurantId,
      // The house's name AFTER this write, captured now so the log still
      // reads correctly after a later rename.
      subject:
        typeof patch.name === "string" ? patch.name : (rest.name ?? null),
      fields: placeFields,
    });
    return {
      stateAndCountry: "changed",
      audited: receipt.recorded,
      auditReason: receipt.reason,
    };
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

    // `updated_at` is stamped by hand because `restaurant_chains` has no
    // `BEFORE UPDATE` trigger (see `RestaurantChain.updated_at`). Without this
    // line the column would keep the row's creation time for ever, and
    // `/settings` would print that as "last changed" — a fabricated answer of
    // exactly the kind ADR 0020 forbids.
    const { error } = await this.databaseService.supabase
      .from("restaurant_chains")
      .update({ name: name.trim(), updated_at: new Date().toISOString() })
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

  /**
   * The houses the switcher lists: the person's memberships, an active
   * `user_restaurant_access` row each, and nothing else (ADR 0164, "Membership
   * only"; research R6).
   *
   * Until 2026-09-18 this listed every house of every organisation the person
   * belonged to, then their access rows, then, when both were empty, the house
   * their `users` row named. So the switcher offered houses the switch route
   * refuses under membership only (7 person-house pairs in production, all
   * simulation accounts), and a person who had left a house kept seeing it
   * there, because no removal touches `organization_members`.
   *
   * The read refuses on error rather than carrying on: an empty list sends the
   * person to the chooser's "no houses" page, so "could not read" must never
   * look like "you have none".
   */
  async getBranchesForUser(userId: string): Promise<RestaurantBranch[]> {
    const { data: uraRows, error: uraErr } = await this.databaseService.supabase
      .from("user_restaurant_access")
      .select(
        "restaurant_id, restaurants(id, name, city, chain_id, updated_at, restaurant_chains(name))",
      )
      .eq("user_id", userId)
      .eq("is_active", true);

    if (uraErr) {
      this.logger.error(
        `Failed to fetch the houses of user ${userId}: ${uraErr.message}`,
      );
      throw new ServiceUnavailableException("Could not read branches");
    }

    const byId = new Map<string, RestaurantBranch>();
    for (const row of uraRows ?? []) {
      const r = (row as any).restaurants;
      if (r?.id && !byId.has(r.id)) {
        byId.set(r.id, {
          id: r.id,
          name: r.name,
          city: r.city ?? null,
          chain_id: r.chain_id ?? null,
          chain_name: r.restaurant_chains?.name ?? null,
          updated_at: r.updated_at ?? null,
        });
      }
    }
    return [...byId.values()];
  }

  async getChainsForUser(userId: string): Promise<RestaurantChain[]> {
    const orgIds = await this.getUserOrgIdsWithFallback(userId);
    if (orgIds.length === 0) return [];

    const { data: chains, error } = await this.databaseService.supabase
      .from("restaurant_chains")
      .select("id, name, cuisine_type, updated_at")
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
      updated_at: c.updated_at ?? null,
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
      .select("id, name, cuisine_type, updated_at")
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
      updated_at: chain.updated_at ?? null,
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
    // Organisation owners only (ADR 0164, the founder 2026-09-18): the caller
    // must hold an `organization_members` row with role `owner` in the
    // organisation the location goes into, and they become the new house's
    // owner (below). Until 2026-09-18 any organisation member could, staff
    // included, and became its owner: a house-level staff member could open a
    // house and own it (PR #393 audit note 2; v3.0-TECH-DEBT 44.1u). See
    // organizations/org-role.ts for why that column can now carry the answer.
    const { data: orgRows, error: orgRowsError } =
      await this.databaseService.supabase
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", userId);
    if (orgRowsError) {
      this.logger.error(
        `createLocation could not read ${userId}'s organisations: ${orgRowsError.message}`,
      );
      throw new ServiceUnavailableException(
        "Could not confirm who owns this organisation. Nothing was created; try again.",
      );
    }
    const ownedOrgIds = (orgRows ?? [])
      .filter((r: { role?: string | null }) => r.role === ORG_OWNER)
      .map((r: { organization_id: string }) => r.organization_id);

    if (ownedOrgIds.length === 0) {
      throw new ForbiddenException({
        message: "Only an owner of the organisation can open a new location.",
        code: "NOT_ORGANISATION_OWNER",
      });
    }

    // The organisation the location goes into: the chain's, when one is named
    // (and the caller must own it), else the one organisation they own.
    let organizationId: string | null = null;
    if (dto.chainId) {
      const { data: chain, error: chainError } =
        await this.databaseService.supabase
          .from("restaurant_chains")
          .select("organization_id")
          .eq("id", dto.chainId)
          .maybeSingle();
      if (chainError) {
        this.logger.error(
          `createLocation could not read chain ${dto.chainId}: ${chainError.message}`,
        );
        throw new ServiceUnavailableException(
          "Could not read that group. Nothing was created; try again.",
        );
      }
      if (!chain || !ownedOrgIds.includes(chain.organization_id)) {
        throw new NotFoundException("Chain not found or access denied");
      }
      organizationId = chain.organization_id;
    } else if (ownedOrgIds.length === 1) {
      organizationId = ownedOrgIds[0];
    } else {
      throw new BadRequestException(
        "You own more than one organisation. Choose a group for the new location so it is clear which one it opens in.",
      );
    }

    // Organisation owners only closed "an owner of nothing can still open a
    // location" for someone with NO organisation row at all — but not for an
    // organisation owner who is an active member of no HOUSE in that
    // organisation (e.g. removed from every house of it; ADR 0164 "Open items
    // for the founder (a)" / OPEN-DECISIONS.md OD-131(a)). The founder's
    // answer, 2026-09-19 (batch-4, `founder-sketch-decisions-106-115.md`): the
    // organisation role is kept EITHER WAY — a house-level removal never
    // touches `organization_members` — but opening a location now also
    // requires an active `user_restaurant_access` row in a house of the SAME
    // organisation being opened into.
    const { data: activeAccess, error: activeAccessError } =
      await this.databaseService.supabase
        .from("user_restaurant_access")
        .select("restaurant_id")
        .eq("user_id", userId)
        .eq("is_active", true);
    if (activeAccessError) {
      this.logger.error(
        `createLocation could not read ${userId}'s active houses: ${activeAccessError.message}`,
      );
      throw new ServiceUnavailableException(
        "Could not confirm your active house membership. Nothing was created; try again.",
      );
    }
    const activeRestaurantIds = (activeAccess ?? []).map(
      (r: { restaurant_id: string }) => r.restaurant_id,
    );
    let hasHouseInOrg = false;
    if (activeRestaurantIds.length > 0) {
      const { data: orgHouses, error: orgHousesError } =
        await this.databaseService.supabase
          .from("restaurants")
          .select("id")
          .eq("organization_id", organizationId)
          .in("id", activeRestaurantIds);
      if (orgHousesError) {
        this.logger.error(
          `createLocation could not read ${userId}'s houses in organisation ${organizationId}: ${orgHousesError.message}`,
        );
        throw new ServiceUnavailableException(
          "Could not confirm your active house membership. Nothing was created; try again.",
        );
      }
      hasHouseInOrg = (orgHouses ?? []).length > 0;
    }
    if (!hasHouseInOrg) {
      throw new ForbiddenException({
        message:
          "Only an organisation owner with an active house in this organisation can open a new location.",
        code: "NO_ACTIVE_HOUSE_IN_ORGANISATION",
      });
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
        // An unanswered question is stored as nothing. Until 2026-09-03 this
        // wrote "America/New_York" for a caller that sent no zone, which is the
        // same fault as the column default the same day's migration dropped
        // (`20260903170000_a_default_is_not_an_answer.sql`) — an invented answer
        // nothing downstream can tell from a chosen one. The scheduled jobs now
        // carry the absence and run that house's per-tenant work in UTC while
        // saying so (`communications/scheduled-tenants.service.ts`,
        // TIMEZONE_NOT_SET).
        //
        // And a sent zone is trusted no further than `Intl` vouches for it
        // (founder item 62, 2026-09-27, "Browser zone, else none"): this
        // route's only caller, AddLocationDialog, sends the browser's zone
        // exactly as the two sign-up routes do, so it gets the same rule —
        // Intl's resolved name, or nothing for an absent, unknown or
        // bare-offset value. Until 2026-09-28 any string the client sent
        // became the new house's clock (TD-2026-09-27-CREATE-LOCATION-
        // TIMEZONE-UNVALIDATED, v3.0-TECH-DEBT.md).
        timezone: resolveSignUpTimezone(dto.timezone),
        organization_id: organizationId,
        chain_id: dto.chainId ?? null,
      })
      .select("id, name")
      .single();

    if (error || !restaurant)
      throw new InternalServerErrorException("Failed to create location");

    // The creator must be able to USE the location they just created.
    // `MembersService.assertMembership` (restaurants/members.service.ts:25)
    // authorises on a `user_restaurant_access` row, falling back only to
    // `users.restaurant_id` — which still points at the creator's original
    // restaurant. Without this insert the very next call on the new location
    // (e.g. GET /restaurants/:id/operating-hours) answers 403. Same columns
    // `registerRestaurant` writes for the founding owner (auth.service.ts:759).
    const { error: accessError } = await this.databaseService.supabase
      .from("user_restaurant_access")
      .insert({
        user_id: userId,
        restaurant_id: restaurant.id,
        role: "owner",
        invited_via: null,
        is_active: true,
      });

    if (accessError) {
      // A restaurant nobody can reach is worse than no restaurant: it is an
      // orphan row that still occupies its slug and shows up in org listings.
      // Roll it back, same discipline as `registerRestaurant`'s catch block.
      const { error: rollbackError } = await this.databaseService.supabase
        .from("restaurants")
        .delete()
        .eq("id", restaurant.id);
      this.logger.error(
        `createLocation rollback: access grant failed for user ${userId} on ` +
          `restaurant ${restaurant.id}: ${accessError.message}` +
          (rollbackError
            ? ` — ROLLBACK ALSO FAILED (${rollbackError.message}); ` +
              `restaurant ${restaurant.id} is orphaned`
            : ""),
      );
      throw new InternalServerErrorException("Failed to create location");
    }

    return { id: restaurant.id, name: restaurant.name };
  }
}
