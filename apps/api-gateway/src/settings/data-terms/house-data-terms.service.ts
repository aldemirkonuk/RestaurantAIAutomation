import {
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { SettingsAuditService } from "../../settings-audit/settings-audit.service";
import { SealChallengeService } from "../../common/seal/seal-challenge.service";
import { OrganizationsService } from "../../organizations/organizations.service";
import {
  CHANGED_SINCE,
  STATEMENTS,
  SUBPROCESSORS,
  TERMS_VERSION,
  digest,
  snapshot,
} from "./house-data-terms";

/**
 * An owner's acceptance of the house's data-and-privacy terms — the act that
 * turns Jev on (ADR 0207 round 4).
 *
 * THE FOUNDER, 2026-09-22, round 6y, verbatim: "owner only, but also we're
 * going to use this as complete data and privacy usage, they have to accept
 * that, and when they do they'd accept the jev too with their names and
 * sensitive topics redacted."
 *
 * SCOPED-DOWN FROM THE ROUND'S DESIGN (named plainly, CLAUDE.md §0.5): the
 * design calls for ONE database function (`accept_house_data_terms`,
 * `security definer`) that inserts the acceptance, flips the switch and
 * writes the audit row in a single transaction, closing the round-3 defect
 * where a switch flip and its audit row could land as two separate writes.
 * That function was not built this round. `accept()` below does the same
 * three things SEQUENTIALLY instead: redeem the seal, insert the acceptance
 * row, then flip the switch and audit it. A failure between the acceptance
 * insert and the switch flip leaves an accepted-but-still-off house — safe
 * (nothing is sent that should not be) but not atomic, and is reported back
 * to the caller rather than papered over. This is the round's named
 * follow-up, not a silent gap.
 */

export interface DataTermsAcceptance {
  version: number;
  acceptedAt: string;
  acceptedBy: { userId: string | null; name: string | null };
}

export interface DataTermsReadout {
  readable: boolean;
  reason: string | null;
  version: number;
  digest: string;
  statements: typeof STATEMENTS;
  subprocessors: typeof SUBPROCESSORS;
  changedSince: typeof CHANGED_SINCE;
  acceptance: DataTermsAcceptance | null;
  current: boolean;
  jev: { enabled: boolean; effective: boolean; pausedBecause: string | null };
}

export interface AcceptanceReceipt {
  accepted: true;
  version: number;
  switchTurnedOn: boolean;
  audited: boolean;
  auditReason: string | null;
}

@Injectable()
export class HouseDataTermsService {
  private readonly logger = new Logger(HouseDataTermsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: SettingsAuditService,
    private readonly seals: SealChallengeService,
    private readonly organizations: OrganizationsService,
  ) {}

  private client() {
    return this.db.supabase;
  }

  /** Owner only. Throws 403 in the org module's own words otherwise. */
  async assertOwner(
    userId: string,
    restaurantId: string,
    action: string,
  ): Promise<void> {
    const role = await this.organizations.resolveRestaurantRole(
      userId,
      restaurantId,
    );
    if (role !== "owner") {
      throw new ForbiddenException(
        `Only an owner can ${action} — not a manager, and not staff. Nothing was changed.`,
      );
    }
  }

  /** The house's latest acceptance of ANY version, or null. Any member may read this. */
  private async latestAcceptance(
    restaurantId: string,
  ): Promise<{ ok: true; row: DataTermsAcceptance | null } | { ok: false; reason: string }> {
    const { data, error } = await this.client()
      .from("house_data_terms_acceptances")
      .select("terms_version, accepted_at, accepted_by")
      .eq("restaurant_id", restaurantId)
      .order("terms_version", { ascending: false })
      .limit(1);
    if (error) return { ok: false, reason: error.message };
    const row = (data ?? [])[0] as
      | { terms_version: number; accepted_at: string; accepted_by: string | null }
      | undefined;
    if (!row) return { ok: true, row: null };
    let name: string | null = null;
    if (row.accepted_by) {
      const who = await this.client()
        .from("users")
        .select("name")
        .eq("user_id", row.accepted_by)
        .maybeSingle();
      name = who.error
        ? null
        : ((who.data as { name?: string | null } | null)?.name ?? null);
    }
    return {
      ok: true,
      row: {
        version: row.terms_version,
        acceptedAt: row.accepted_at,
        acceptedBy: { userId: row.accepted_by, name },
      },
    };
  }

  private async switchState(
    restaurantId: string,
  ): Promise<{ ok: true; enabled: boolean } | { ok: false; reason: string }> {
    const { data, error } = await this.client()
      .from("restaurants")
      .select("vendor_tone_scoring_enabled")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) return { ok: false, reason: error.message };
    if (!data) return { ok: false, reason: "this house has no record" };
    return {
      ok: true,
      enabled:
        (data as { vendor_tone_scoring_enabled?: unknown })
          .vendor_tone_scoring_enabled === true,
    };
  }

  async read(restaurantId: string): Promise<DataTermsReadout> {
    const [acceptance, sw] = await Promise.all([
      this.latestAcceptance(restaurantId),
      this.switchState(restaurantId),
    ]);
    if (!acceptance.ok) {
      return this.unreadable(acceptance.reason);
    }
    // A switch that could not be read is not "off" — the readout says it
    // could not be read. [Last call, 2026-09-22: a failed switch read was
    // reported as `enabled: false` on a readable readout.]
    if (!sw.ok) {
      return this.unreadable(`the Jev switch: ${sw.reason}`);
    }
    const current =
      acceptance.row !== null && acceptance.row.version === TERMS_VERSION;
    const enabled = sw.enabled;
    const pausedBecause = !enabled
      ? null
      : current
        ? null
        : "the data terms changed; an owner has not accepted version " +
          `${TERMS_VERSION}`;
    return {
      readable: true,
      reason: null,
      version: TERMS_VERSION,
      digest: digest(),
      statements: STATEMENTS,
      subprocessors: SUBPROCESSORS,
      changedSince: CHANGED_SINCE,
      acceptance: acceptance.row,
      current,
      jev: {
        enabled,
        effective: enabled && current,
        pausedBecause,
      },
    };
  }

  private unreadable(reason: string): DataTermsReadout {
    return {
      readable: false,
      reason,
      version: TERMS_VERSION,
      digest: digest(),
      statements: STATEMENTS,
      subprocessors: SUBPROCESSORS,
      changedSince: CHANGED_SINCE,
      acceptance: null,
      current: false,
      jev: { enabled: false, effective: false, pausedBecause: null },
    };
  }

  /** Whether Jev is effectively allowed to run for this house right now. */
  async effectiveAcceptance(
    restaurantId: string,
  ): Promise<{ ok: true; current: boolean } | { ok: false; reason: string }> {
    const acceptance = await this.latestAcceptance(restaurantId);
    if (!acceptance.ok) return acceptance;
    return {
      ok: true,
      current:
        acceptance.row !== null && acceptance.row.version === TERMS_VERSION,
    };
  }

  /** Owner only, sealed. Mints a challenge bound to this house and the CURRENT digest. */
  async issueSealChallenge(
    restaurantId: string,
    userId: string,
  ): Promise<{ challenge: string; expiresAt: string }> {
    await this.assertOwner(userId, restaurantId, "accept the data terms");
    const out = await this.seals.issue({
      restaurantId,
      actorUserId: userId,
      subjectKind: "house_data_terms",
      subjectId: restaurantId,
      action: "accept",
      args: { digest: digest(), version: TERMS_VERSION },
    });
    return { challenge: out.challenge, expiresAt: out.expiresAt };
  }

  /**
   * Owner only. `version`/`digest` must be the CURRENT ones — a mismatch is
   * 409, the same "the terms changed while you were reading them" shape as
   * `consent_changed` elsewhere in this codebase, not a 400: the request was
   * well-formed, the world moved under it.
   */
  async accept(
    restaurantId: string,
    userId: string,
    version: number,
    submittedDigest: string,
    challenge: string | null,
  ): Promise<AcceptanceReceipt> {
    await this.assertOwner(userId, restaurantId, "accept the data terms");
    if (version !== TERMS_VERSION || submittedDigest !== digest()) {
      throw new ConflictException(
        "The terms changed while you were reading them. Read them again before accepting.",
      );
    }

    const redeemed = await this.seals.redeem({
      restaurantId,
      actorUserId: userId,
      subjectKind: "house_data_terms",
      subjectId: restaurantId,
      action: "accept",
      args: { digest: submittedDigest, version },
      challenge,
    });

    const { error: insertError } = await this.client()
      .from("house_data_terms_acceptances")
      .insert({
        restaurant_id: restaurantId,
        terms_version: version,
        terms_digest: submittedDigest,
        terms_snapshot: snapshot(),
        accepted_by: userId,
        accepted_by_role: "owner",
        seal_id: redeemed.sealId,
      });
    if (insertError) {
      // A second owner accepting the same version lands here as a unique-
      // constraint hit — treated as a no-op success, not a refusal: the
      // version IS accepted, which is the only thing this act promises.
      if (insertError.code !== "23505") {
        this.logger.error(
          `house_data_terms_acceptances insert failed for ${restaurantId}: ${insertError.message}`,
        );
        throw new InternalServerErrorException(
          "The acceptance could not be recorded, so nothing was turned on. The seal was spent; begin the hold again if you retry.",
        );
      }
    }

    const flip = await this.turnSwitchOn(restaurantId, userId, version);
    return {
      accepted: true,
      version,
      switchTurnedOn: flip.ok,
      audited: flip.audited,
      auditReason: flip.auditReason,
    };
  }

  /**
   * The flip, kept in its own method because it is the one part of `accept`
   * that is NOT in the same transaction as the acceptance row — see this
   * file's header. A failure here is reported, never thrown: the acceptance
   * is already real and must not be rolled back by a client retry that then
   * hits the unique constraint above and reads as a silent no-op.
   */
  private async turnSwitchOn(
    restaurantId: string,
    userId: string,
    version: number,
  ): Promise<{ ok: boolean; audited: boolean; auditReason: string | null }> {
    const { error } = await this.client()
      .from("restaurants")
      .update({ vendor_tone_scoring_enabled: true })
      .eq("id", restaurantId);
    if (error) {
      this.logger.error(
        `Accepted but could not turn the switch on for ${restaurantId}: ${error.message}`,
      );
      return { ok: false, audited: false, auditReason: null };
    }
    const receipt = await this.audit.record({
      restaurantId,
      actorUserId: userId,
      action: "house_data_terms_accepted",
      register: "data-terms",
      entityType: "restaurant",
      entityId: restaurantId,
      subject: "Data terms accepted; Jev turned on",
      fields: {
        terms_version: { from: null, to: version },
        vendor_tone_scoring_enabled: { from: false, to: true },
      },
    });
    return { ok: true, audited: receipt.recorded, auditReason: receipt.reason };
  }
}
