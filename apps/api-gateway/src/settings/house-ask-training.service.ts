import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { SettingsAuditService } from "../settings-audit/settings-audit.service";

/**
 * Whether this house's /ask questions may be used for training.
 *
 * THE FOUNDER, 2026-09-21, round 6r, his pick verbatim: **"Same as the wine
 * pool (Recommended)"** -- the option's words: "A notice in our Terms and on
 * /ask, and an owner opt-out per house. Names are removed before any export.
 * We ask a lawyer about KVKK and GDPR before the first real training run."
 * (ADR 0145, round-6r amendment.)
 *
 * The rules, and where each is enforced:
 *   1. **Default: not opted out.** No row in `ask_training_opt_outs` means
 *      the house has not opted out. That is his default, stated, not a guess;
 *      a failed READ is never that default -- it answers `readable: false`.
 *   2. **Owner only.** `write` resolves the caller's role IN THIS HOUSE from
 *      `user_restaurant_access` (`OrganizationsService.resolveRestaurantRole`),
 *      never from the token or the body, and refuses anything but `owner` --
 *      a manager, staff, `admin`, or a role that could not be read. The row
 *      itself can only say `set_by_role = 'owner'` (a CHECK). `RolesGuard`
 *      cannot express this: it lets a manager through any owner gate.
 *   3. **Audited, or the caller is told it was not.** Every accepted write
 *      files a `system_audit_log` row (`ask_training_opt_out_changed`) naming
 *      the actor and both values, and the receipt comes back as `audited`.
 *   4. **What it governs.** `ask_folio_training_export` leaves out every house
 *      whose row says `opted_out` (20260922220500). Answering the question and
 *      the folio book are not affected: an opted-out house's asks are still
 *      recorded, because that is how its own answers are kept and audited.
 */

export const ASK_TRAINING_AUDIT_ACTION = "ask_training_opt_out_changed" as const;

export interface HouseAskTrainingReadout {
  restaurantId: string;
  /** True when this house's asks are left out of any training export. */
  optedOut: boolean;
  /** False when the setting could not be READ: never read as "not opted out". */
  readable: boolean;
  reason: string | null;
  /** Null when nobody has answered: the default (not opted out) is in force. */
  statedAt: string | null;
  statedBy: { userId: string | null; name: string | null } | null;
  audited?: boolean;
  auditReason?: string | null;
}

interface OptOutRow {
  opted_out: boolean;
  set_by: string | null;
  set_at: string | null;
}

@Injectable()
export class HouseAskTrainingService {
  private readonly logger = new Logger(HouseAskTrainingService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly organizations: OrganizationsService,
    private readonly audit: SettingsAuditService,
  ) {}

  async read(restaurantId: string): Promise<HouseAskTrainingReadout> {
    const found = await this.readRow(restaurantId);
    if (found.error !== null) {
      return { restaurantId, optedOut: false, readable: false, reason: found.error, statedAt: null, statedBy: null };
    }
    const row = found.row;
    return {
      restaurantId,
      optedOut: row?.opted_out === true,
      readable: true,
      reason: null,
      statedAt: row?.set_at ?? null,
      statedBy: row ? { userId: row.set_by, name: await this.nameOf(row.set_by) } : null,
    };
  }

  /** Opt this house out of, or back into, training use. The house's owner only. */
  async write(restaurantId: string, optedOut: unknown, actorUserId: string): Promise<HouseAskTrainingReadout> {
    if (typeof optedOut !== "boolean") {
      throw new BadRequestException("Say true to keep this house's questions out of training, or false to allow it. Nothing was recorded.");
    }
    const role = await this.organizations.resolveRestaurantRole(actorUserId, restaurantId);
    if (role !== "owner") {
      throw new ForbiddenException(
        "Only the house's owner can choose whether its questions may be used for training. Nothing was recorded.",
      );
    }
    const before = await this.readRow(restaurantId);
    if (before.error !== null) {
      // The previous value is half of the audit row; without it the change is not written.
      throw new InternalServerErrorException("The current setting could not be read, so nothing was changed.");
    }
    const { error } = await this.databaseService.client
      .from("ask_training_opt_outs")
      .upsert(
        { restaurant_id: restaurantId, opted_out: optedOut, set_by: actorUserId, set_by_role: "owner", set_at: new Date().toISOString() },
        { onConflict: "restaurant_id" },
      );
    if (error) {
      this.logger.error(`Could not record the training choice for ${restaurantId}: ${error.message}`);
      throw new InternalServerErrorException("Could not record the training choice. Nothing was changed.");
    }
    const receipt = await this.audit.record({
      restaurantId,
      actorUserId,
      action: ASK_TRAINING_AUDIT_ACTION,
      register: "ask-training",
      entityType: "restaurant",
      entityId: restaurantId,
      subject: "questions used for training",
      fields: { ask_training_opted_out: { from: before.row?.opted_out === true, to: optedOut } },
    });
    const after = await this.read(restaurantId);
    return { ...after, audited: receipt.recorded, auditReason: receipt.reason };
  }

  private async readRow(restaurantId: string): Promise<{ row: OptOutRow | null; error: string | null }> {
    const { data, error } = await this.databaseService.client
      .from("ask_training_opt_outs")
      .select("opted_out, set_by, set_at")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (error) {
      this.logger.error(`Could not read the training choice for ${restaurantId}: ${error.message}`);
      return { row: null, error: error.message };
    }
    return { row: (data as OptOutRow | null) ?? null, error: null };
  }

  /** `public.users.user_id`; a failed lookup answers null, never the id. */
  private async nameOf(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const { data, error } = await this.databaseService.client.from("users").select("name").eq("user_id", userId).maybeSingle();
    if (error) {
      this.logger.warn(`The training choice's author could not be named: ${error.message}`);
      return null;
    }
    return (data as { name?: string | null } | null)?.name ?? null;
  }
}
