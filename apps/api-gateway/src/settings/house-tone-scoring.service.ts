import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { SettingsAuditService } from "../settings-audit/settings-audit.service";

/**
 * Whether Jev reads this house's vendor mail — the per-house switch (ADR 0207,
 * round 3).
 *
 * THE FOUNDER, 2026-09-21: *"this feature can also be disabled"*, and on what
 * may leave for Jev: *"Only with names removed"*. The column is
 * `restaurants.vendor_tone_scoring_enabled`, **false by default** — nothing is
 * sent until an owner or manager turns it on here. Whether it should be on by
 * default is the founder's open question; off is the direction that sends
 * nothing while it is open.
 *
 * THE RULES, the currency's and the time zone's:
 *   1. **Explicit.** Written only from a boolean that arrived in the body.
 *   2. **Audited, or the caller is told it was not.** An accepted change files a
 *      `system_audit_log` row naming the actor and both states; the receipt
 *      comes back as `audited` / `auditReason`.
 *   3. **A failed read is never an empty one.** `readable: false` with the
 *      reason — never read as "off".
 *
 * The role check is `assertCanManageRestaurant` on the controller.
 */

export const TONE_SCORING_AUDIT_ACTION = "vendor_tone_scoring_changed" as const;

export interface HouseToneScoringReadout {
  restaurantId: string;
  /** Null only when the row could not be read. */
  enabled: boolean | null;
  readable: boolean;
  reason: string | null;
  statedAt: string | null;
  statedBy: { userId: string | null; name: string | null } | null;
  audited?: boolean;
  auditReason?: string | null;
}

@Injectable()
export class HouseToneScoringService {
  private readonly logger = new Logger(HouseToneScoringService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly audit: SettingsAuditService,
  ) {}

  async read(restaurantId: string): Promise<HouseToneScoringReadout> {
    const house = await this.readHouse(restaurantId);
    if (house.error !== null)
      return {
        restaurantId,
        enabled: null,
        readable: false,
        reason: house.error,
        statedAt: null,
        statedBy: null,
      };
    const stated = await this.lastStated(restaurantId);
    return {
      restaurantId,
      enabled: house.enabled === true,
      readable: true,
      reason: null,
      statedAt: stated.at,
      statedBy: stated.by,
    };
  }

  async write(
    restaurantId: string,
    enabled: boolean,
    actorUserId: string,
  ): Promise<HouseToneScoringReadout> {
    const before = await this.readHouse(restaurantId);
    if (before.error !== null)
      throw new ServiceUnavailableException(
        "Whether Jev reads this house's vendor mail could not be read, so nothing was changed. Try again.",
      );
    const previous = before.enabled === true;
    const { error } = await this.databaseService.client
      .from("restaurants")
      .update({ vendor_tone_scoring_enabled: enabled })
      .eq("id", restaurantId);
    if (error) {
      this.logger.error(
        `Could not record the tone-scoring switch for ${restaurantId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        "Could not record the switch. Nothing was changed.",
      );
    }
    const receipt =
      previous === enabled
        ? { recorded: false, reason: "nothing changed" }
        : await this.audit.record({
            restaurantId,
            actorUserId,
            action: TONE_SCORING_AUDIT_ACTION,
            register: "tone-scoring",
            entityType: "restaurant",
            entityId: restaurantId,
            subject: "Jev reads vendor mail",
            fields: {
              vendor_tone_scoring_enabled: { from: previous, to: enabled },
            },
          });
    const after = await this.read(restaurantId);
    return { ...after, audited: receipt.recorded, auditReason: receipt.reason };
  }

  private async readHouse(
    restaurantId: string,
  ): Promise<{ enabled: boolean | null; error: string | null }> {
    const { data, error } = await this.databaseService.client
      .from("restaurants")
      .select("vendor_tone_scoring_enabled")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) return { enabled: null, error: error.message };
    if (!data) return { enabled: null, error: "this house has no record" };
    return {
      enabled:
        (data as { vendor_tone_scoring_enabled?: unknown })
          .vendor_tone_scoring_enabled === true,
      error: null,
    };
  }

  private async lastStated(restaurantId: string): Promise<{
    at: string | null;
    by: { userId: string | null; name: string | null } | null;
  }> {
    const { data, error } = await this.databaseService.client
      .from("system_audit_log")
      .select("actor_id, created_at")
      .eq("restaurant_id", restaurantId)
      .eq("action", TONE_SCORING_AUDIT_ACTION)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error || !Array.isArray(data) || data.length === 0)
      return { at: null, by: null };
    const row = data[0] as {
      actor_id: string | null;
      created_at: string | null;
    };
    let name: string | null = null;
    if (row.actor_id) {
      const who = await this.databaseService.client
        .from("users")
        .select("name")
        .eq("user_id", row.actor_id)
        .maybeSingle();
      name = who.error
        ? null
        : ((who.data as { name?: string | null } | null)?.name ?? null);
    }
    return {
      at: row.created_at ?? null,
      by: { userId: row.actor_id ?? null, name },
    };
  }
}
