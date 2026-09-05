import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { NotificationsService } from "../../notifications/notifications.service";
import {
  JURISDICTION_RULES,
  RETENTION_DISCLOSURE_COPY,
  RETENTION_MARGIN_DAYS,
  STORAGE_LIMITATION_SOURCES,
  type JurisdictionCode,
  type JurisdictionRule,
  resolveJurisdiction,
  ruleFor,
} from "./retention-rules";

/**
 * The raw mail of a mirrored vendor reply, and how long the house keeps it.
 *
 * ADR 0118 "Retention" (decided 2026-09-05). The rule table, the margin's
 * derivation and the statutes live in `retention-rules.ts`; this file does the
 * three things that touch rows:
 *
 *   DERIVE   `deriveWindow` measures this house's own disputes and writes one
 *            `house_mail_retention_windows` row. Quarterly.
 *   SWEEP    `sweepExpired` deletes the raw mail of mirrored rows past that
 *            figure. Daily. A count is recorded whether or not it changed
 *            anything.
 *   REVOKE   `sweepForRevokedGrant` deletes the raw mail of every row THAT
 *            grant mirrored, immediately, regardless of the window.
 *
 * WHY THIS LIVES UNDER `communications/`
 * --------------------------------------
 * Measured before it was placed. The rows it deletes are in
 * `procurement_conversations`, which is procurement's table — but the thing
 * being retained is mail, the code that put it there is
 * `communications/inbox/house-inbox.service.ts`, the consent it answers is the
 * `gmail_read` grant's, and the sibling of this module is `inbox/`, which
 * reads the same mailbox under the same grant. Retention of mirrored mail is a
 * fact about the reading, not about the order. Procurement never asks how long
 * a body is kept; the reader's consent screen does.
 *
 * WHAT IT NEVER TOUCHES
 * ---------------------
 * The FACTS. `detected_intent`, `detected_sentiment`, `rolling_summary` and
 * every branch of `conversation_context` — `analysis.vendor_offers`,
 * `key_facts`, `commercial_terms`, `classification` — are written by the
 * understand step (`inbound-responder.service.ts:308-339`) onto the house's own
 * order record, and `negotiation_facts.exact_quote` holds the vendor's own
 * wording as a fact. None of it is read or written here. Neither is
 * `procurement_orders`.
 *
 * WHAT IT CANNOT REACH, STATED RATHER THAN IMPLIED
 * -----------------------------------------------
 * `public.conversation_embeddings.message_text` holds a second copy of a
 * message's text beside its vector, written by
 * `services/agent-orchestrator/agents/provider_conversation_agent.py:1161-1175`.
 * That table carries `session_id`, `provider_id` and `restaurant_id` and no
 * `conversation_id`, so there is no deterministic join from a mirrored
 * conversation row to its embedding row, and this sweep does not touch it. That
 * is a gap in the deletion, not a decision that the copy does not matter — it is
 * filed in `06-pages/communications.md` section 9 and named in ADR 0118's
 * consequences rather than left for a reader to discover.
 */

/** 'window_expired' — the scheduled sweep. 'grant_revoked' — a disconnect. */
export type SweepReason = "window_expired" | "grant_revoked";

/** Quarterly: 03:00 on the 1st of January, April, July and October. */
export const RETENTION_DERIVE_CRON = "0 3 1 1,4,7,10 *";
/** Daily: 03:30, half an hour after the derivation so a fresh figure is used. */
export const RETENTION_SWEEP_CRON = "30 3 * * *";

const DAY_MS = 24 * 60 * 60 * 1000;
const ATTACHMENT_BUCKET = "vendor-attachments";

export interface DerivedWindow {
  restaurantId: string;
  figureDays: number;
  marginDays: number;
  basisKind: "dispute_span" | "no_dispute_recorded";
  /** NULL when no dispute was recorded. Never 0 standing in for "none". */
  longestDisputeDays: number | null;
  disputesConsidered: number;
  jurisdiction: JurisdictionCode;
  jurisdictionSource: "restaurants.country" | "unrecorded";
  factsFloorYears: number;
  /** The derivation in words, printed verbatim on the consent screen. */
  basis: string;
}

export interface SweepRun {
  /**
   * NULL only for a revocation of a grant that names no restaurant and
   * mirrored nothing. `house_mail_retention_sweeps.restaurant_id` is NOT NULL,
   * so such a run cannot be recorded there and `says` states that rather than
   * the count silently not existing.
   */
  restaurantId: string | null;
  reason: SweepReason;
  connectionId: string | null;
  considered: number;
  deleted: number;
  attachmentsDeleted: number;
  windowDays: number | null;
  notice: string | null;
  error: string | null;
  /** What happened, in words. Never a bare boolean, never a silent skip. */
  says: string;
}

export interface RetentionDisclosure {
  restaurantId: string;
  /** The figure that governs today. */
  figureDays: number;
  /** Where that figure came from: the stored derivation, or a live measure. */
  figureFrom: "stored_derivation" | "measured_now";
  /** NULL when no quarterly derivation has ever been stored for this house. */
  storedAt: string | null;
  /** Set only when the stored figure and a fresh measure disagree. */
  wouldBeDays: number | null;
  basis: string;
  jurisdiction: {
    code: JurisdictionCode;
    label: string;
    factsFloorYears: number;
    bindsCorrespondence: boolean;
    why: string;
    defaultedBecause: string | null;
    citations: JurisdictionRule["citations"];
  };
  storageLimitation: typeof STORAGE_LIMITATION_SOURCES;
  split: string;
  revocation: string;
  windowIntro: string;
  /** Which grants this disclosure is about. The page must not hard-code it. */
  appliesTo: string[];
}

@Injectable()
export class RawMailRetentionService {
  private readonly logger = new Logger(RawMailRetentionService.name);

  constructor(
    private readonly db: DatabaseService,
    /**
     * Optional ONLY so the specs can construct this service with one argument.
     * Every caller that can revoke a grant resolves it — `IntegrationsModule`
     * imports `RetentionModule`, which imports `NotificationsModule`. When it
     * is genuinely absent the sweep does not pretend a notice went out: it
     * writes the reason into `house_mail_retention_sweeps.notice` and says so
     * in `says`.
     */
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  // =========================================================================
  // DERIVE
  // =========================================================================

  /**
   * Measure one house's window from its own disputes.
   *
   * THE MEASUREMENT. A dispute is a `procurement_credits` row — the house's own
   * claim ledger, whose states run open, requested, promised, credited,
   * rejected, written_off (baseline:4353). Its span is measured from the START
   * OF THE CONVERSATION on the disputed order, not from the claim's own
   * `opened_at`: a claim is opened after the argument has been going for a
   * while, and the mail that matters is the mail from before it was opened. The
   * span ends at `settled_at`, or at now while the claim is still open — which
   * is what "the longest OPEN dispute" means.
   *
   * WHAT HAPPENS WHEN THERE ARE NO DISPUTES. The figure is the margin alone,
   * `basis_kind` is `no_dispute_recorded`, and `longest_dispute_days` is NULL
   * rather than 0. This is the SHORTEST window this rule can produce, which is
   * the right direction: a house with no evidence of long disputes gets the
   * most privacy-preserving answer, and the figure lengthens the first time a
   * dispute actually runs long. Measured on this deployment 2026-09-05: the one
   * tenant readable through the local gateway (`550e8400-...`) has zero
   * `procurement_credits` and zero `procurement_conversations`, so this is the
   * ORDINARY case here and not an edge one.
   *
   * A FAILED READ IS NEVER "NO DISPUTES". supabase-js resolves `{ data, error }`
   * and never throws, so a swallowed error would turn an unreadable claim
   * ledger into "this house has never disputed anything" and shorten the window
   * on the strength of a database outage. Every read below either binds `error`
   * and throws, or is not made.
   */
  async computeWindow(restaurantId: string): Promise<DerivedWindow> {
    const { data: houseRows, error: houseError } = await this.db.supabase
      .from("restaurants")
      .select("id, country, state_province")
      .eq("id", restaurantId)
      .limit(1);
    if (houseError) {
      throw new ServiceUnavailableException(
        `The restaurant's country could not be read, so its retention rule cannot be resolved: ${houseError.message}`,
      );
    }
    const house = houseRows?.[0] ?? null;
    if (!house) {
      throw new NotFoundException(
        `No restaurant with id ${restaurantId}, so there is no house to derive a window for.`,
      );
    }

    const country = (house.country as string | null) ?? null;
    const jurisdiction = resolveJurisdiction(
      country,
      (house.state_province as string | null) ?? null,
    );
    const rule = ruleFor(jurisdiction);
    const jurisdictionSource: DerivedWindow["jurisdictionSource"] =
      jurisdiction === "UNKNOWN" ? "unrecorded" : "restaurants.country";

    const { data: credits, error: creditsError } = await this.db.supabase
      .from("procurement_credits")
      .select("id, order_id, opened_at, settled_at, state")
      .eq("restaurant_id", restaurantId);
    if (creditsError) {
      throw new ServiceUnavailableException(
        `The house's disputes could not be read, so the window cannot be derived — deriving one anyway would report a database failure as "this house has never disputed anything": ${creditsError.message}`,
      );
    }

    const claims = credits ?? [];
    const orderIds = Array.from(
      new Set(
        claims
          .map((c) => (c.order_id as string | null) ?? null)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    // The conversation start for each disputed order. One read, not one per
    // claim: `.in()` over the ids the claims already named.
    const conversationStart = new Map<string, number>();
    if (orderIds.length) {
      const { data: rows, error: convError } = await this.db.supabase
        .from("procurement_conversations")
        .select("order_id, created_at")
        .in("order_id", orderIds);
      if (convError) {
        throw new ServiceUnavailableException(
          `The disputed orders' conversations could not be read, so the span cannot be measured from them: ${convError.message}`,
        );
      }
      for (const row of rows ?? []) {
        const orderId = (row.order_id as string | null) ?? null;
        const at = Date.parse((row.created_at as string | null) ?? "");
        if (!orderId || !Number.isFinite(at)) continue;
        const seen = conversationStart.get(orderId);
        if (seen === undefined || at < seen) conversationStart.set(orderId, at);
      }
    }

    const now = Date.now();
    let longestDays: number | null = null;
    for (const claim of claims) {
      const openedAt = Date.parse((claim.opened_at as string | null) ?? "");
      const orderId = (claim.order_id as string | null) ?? null;
      const fromConversation = orderId
        ? (conversationStart.get(orderId) ?? null)
        : null;

      const candidates = [openedAt, fromConversation].filter(
        (v): v is number => typeof v === "number" && Number.isFinite(v),
      );
      if (!candidates.length) continue;
      const start = Math.min(...candidates);

      const settled = Date.parse((claim.settled_at as string | null) ?? "");
      const end = Number.isFinite(settled) ? settled : now;
      if (end < start) continue;

      const days = Math.ceil((end - start) / DAY_MS);
      if (longestDays === null || days > longestDays) longestDays = days;
    }

    const marginDays = RETENTION_MARGIN_DAYS;
    const basisKind: DerivedWindow["basisKind"] =
      longestDays === null ? "no_dispute_recorded" : "dispute_span";
    const figureDays =
      longestDays === null ? marginDays : longestDays + marginDays;

    const basis =
      longestDays === null
        ? `This restaurant has recorded no dispute with a vendor, so there is no span to measure. The window is the margin alone - ${marginDays} days, one re-derivation interval - which is the shortest figure this rule can produce. It lengthens the first time a dispute actually runs long. ${claims.length === 0 ? "No claim has ever been opened here." : `${claims.length} claim${claims.length === 1 ? " was" : "s were"} read and none could be dated.`}`
        : `The longest dispute this restaurant has recorded ran ${longestDays} day${longestDays === 1 ? "" : "s"}, measured from the first message on that order to the day the claim was settled (or to today, while it is still open), across ${claims.length} claim${claims.length === 1 ? "" : "s"}. The window is that span plus a margin of ${marginDays} days - one re-derivation interval, so a dispute opened the day after a derivation cannot expire mail on a figure that is already three months out of date. Total: ${figureDays} days.`;

    return {
      restaurantId,
      figureDays,
      marginDays,
      basisKind,
      longestDisputeDays: longestDays,
      disputesConsidered: claims.length,
      jurisdiction,
      jurisdictionSource,
      factsFloorYears: rule.factsFloorYears,
      basis,
    };
  }

  /** Measure, then store. The quarterly cron's unit of work. */
  async deriveWindow(restaurantId: string): Promise<DerivedWindow> {
    const derived = await this.computeWindow(restaurantId);

    // Explicit keys, no conditional spread: every column named on every write,
    // so a row can never be short of a field because a branch did not run.
    const { error } = await this.db.supabase
      .from("house_mail_retention_windows")
      .upsert(
        {
          restaurant_id: derived.restaurantId,
          figure_days: derived.figureDays,
          basis: derived.basis,
          basis_kind: derived.basisKind,
          longest_dispute_days: derived.longestDisputeDays,
          disputes_considered: derived.disputesConsidered,
          margin_days: derived.marginDays,
          jurisdiction: derived.jurisdiction,
          jurisdiction_source: derived.jurisdictionSource,
          facts_floor_years: derived.factsFloorYears,
          derived_at: new Date().toISOString(),
        },
        { onConflict: "restaurant_id" },
      );
    if (error) {
      throw new ServiceUnavailableException(
        `The derived window for ${restaurantId} was not stored, so the sweep would keep obeying the old figure: ${error.message}`,
      );
    }
    return derived;
  }

  /**
   * Re-derive for every house that could have mirrored mail.
   *
   * The population is deliberately narrow: a house with no `gmail_read` grant
   * and no mirrored row has never had a person's mailbox read, and writing a
   * retention figure for it would be a claim about a house that has nothing to
   * retain. `houses()` says which and why.
   */
  async deriveAll(): Promise<{
    houses: number;
    derived: DerivedWindow[];
    errors: Array<{ restaurantId: string; message: string }>;
  }> {
    const houses = await this.housesWithMirroredMail();
    const derived: DerivedWindow[] = [];
    const errors: Array<{ restaurantId: string; message: string }> = [];
    for (const restaurantId of houses) {
      try {
        derived.push(await this.deriveWindow(restaurantId));
      } catch (err) {
        errors.push({
          restaurantId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { houses: houses.length, derived, errors };
  }

  // =========================================================================
  // SWEEP
  // =========================================================================

  /**
   * The scheduled sweep, over every house that could have mirrored mail.
   *
   * A row is recorded for each house whether or not anything was deleted
   * (ADR 0078). A daily table containing only the days something was deleted
   * would make "how often does the sweep find something" 100% by construction,
   * which is the fault this repo has already named twice.
   */
  async sweepExpired(): Promise<SweepRun[]> {
    const houses = await this.housesWithMirroredMail();
    const runs: SweepRun[] = [];
    for (const restaurantId of houses) {
      runs.push(await this.sweepHouse(restaurantId));
    }
    return runs;
  }

  async sweepHouse(restaurantId: string): Promise<SweepRun> {
    const { data: windows, error: windowError } = await this.db.supabase
      .from("house_mail_retention_windows")
      .select("figure_days, derived_at")
      .eq("restaurant_id", restaurantId)
      .limit(1);
    if (windowError) {
      return this.recordSweep({
        restaurantId,
        reason: "window_expired",
        connectionId: null,
        considered: 0,
        deleted: 0,
        attachmentsDeleted: 0,
        windowDays: null,
        notice: null,
        error: `The house's window could not be read: ${windowError.message}`,
        says: `Nothing was swept for this house: its retention window could not be read (${windowError.message}). No mail was deleted, and that is recorded rather than passed over.`,
      });
    }

    const figureDays = (windows?.[0]?.figure_days as number | undefined) ?? null;
    if (figureDays === null) {
      return this.recordSweep({
        restaurantId,
        reason: "window_expired",
        connectionId: null,
        considered: 0,
        deleted: 0,
        attachmentsDeleted: 0,
        windowDays: null,
        notice: null,
        error: null,
        says:
          "No window has been derived for this house yet, so nothing was deleted. A house with no derivation is not a house with a window of zero, and the sweep refuses to invent one.",
      });
    }

    const cutoff = new Date(Date.now() - figureDays * DAY_MS).toISOString();

    // received_at is the mail's own arrival time (the bridge writes it from the
    // Gmail internalDate, rabbitmq-bridge.service.ts:750); created_at is when
    // the row was written. The window is about the MAIL, so received_at is the
    // clock, and a row with no received_at falls back to created_at rather than
    // being skipped silently.
    const { data: rows, error: rowsError } = await this.db.supabase
      .from("procurement_conversations")
      .select("id, received_at, created_at")
      .eq("restaurant_id", restaurantId)
      .not("mirrored_by_grant_id", "is", null)
      .is("raw_deleted_at", null);
    if (rowsError) {
      return this.recordSweep({
        restaurantId,
        reason: "window_expired",
        connectionId: null,
        considered: 0,
        deleted: 0,
        attachmentsDeleted: 0,
        windowDays: figureDays,
        notice: null,
        error: `The house's mirrored rows could not be read: ${rowsError.message}`,
        says: `Nothing was swept for this house: its mirrored replies could not be read (${rowsError.message}). No mail was deleted.`,
      });
    }

    const candidates = rows ?? [];
    const expired = candidates.filter((r) => {
      const at = (r.received_at as string | null) ?? (r.created_at as string | null);
      return typeof at === "string" && at < cutoff;
    });

    const outcome = await this.deleteRawFor(
      expired.map((r) => String(r.id)),
      "window_expired",
    );

    return this.recordSweep({
      restaurantId,
      reason: "window_expired",
      connectionId: null,
      considered: candidates.length,
      deleted: outcome.deleted,
      attachmentsDeleted: outcome.attachmentsDeleted,
      windowDays: figureDays,
      notice: null,
      error: outcome.error,
      says: `${candidates.length} mirrored repl${candidates.length === 1 ? "y" : "ies"} still holding raw mail were looked at against a ${figureDays}-day window; ${outcome.deleted} were past it and had their body, headers and attachment bytes deleted. The order's own facts on all ${candidates.length} are untouched.`,
    });
  }

  /**
   * Revocation. Immediate, and the window is irrelevant to it.
   *
   * Scoped to `mirrored_by_grant_id = <this grant>` and nothing else. A
   * shared-mailbox reply on the same order is not covered by this person's
   * grant and is not touched; nor is a reply mirrored under a SECOND person's
   * grant in the same house, which is why the scope is the connection and not
   * the restaurant.
   */
  async sweepForRevokedGrant(params: {
    connectionId: string;
    /** May be empty: a grant made before a tenant was on the token has none. */
    restaurantId: string | null;
    ownerUserId: string | null;
  }): Promise<SweepRun> {
    const { data: rows, error: rowsError } = await this.db.supabase
      .from("procurement_conversations")
      .select("id, restaurant_id")
      .eq("mirrored_by_grant_id", params.connectionId)
      .is("raw_deleted_at", null);
    if (rowsError) {
      return this.recordSweep({
        restaurantId: params.restaurantId || null,
        reason: "grant_revoked",
        connectionId: params.connectionId,
        considered: 0,
        deleted: 0,
        attachmentsDeleted: 0,
        windowDays: null,
        notice: null,
        error: `The grant's mirrored rows could not be read: ${rowsError.message}`,
        says: `The grant was revoked but its mirrored mail could NOT be deleted: the rows could not be read (${rowsError.message}). The mail is still there.`,
      });
    }

    const found = rows ?? [];
    const ids = found.map((r) => String(r.id));
    // The house comes from the grant when it has one, and otherwise from the
    // rows themselves — a grant recorded before a tenant was on the token still
    // mirrored mail into some restaurant's book, and that mail must still go.
    const restaurantId =
      params.restaurantId ||
      ((found[0]?.restaurant_id as string | null) ?? null);

    const outcome = await this.deleteRawFor(ids, "grant_revoked");

    const notice = restaurantId
      ? await this.tellTheOwner({
          restaurantId,
          ownerUserId: params.ownerUserId,
          deleted: outcome.deleted,
          attachmentsDeleted: outcome.attachmentsDeleted,
        })
      : "No notice was sent: this grant names no restaurant and mirrored nothing, so there is no house whose members could be written to.";

    return this.recordSweep({
      restaurantId,
      reason: "grant_revoked",
      connectionId: params.connectionId,
      considered: ids.length,
      deleted: outcome.deleted,
      attachmentsDeleted: outcome.attachmentsDeleted,
      windowDays: null,
      notice,
      error: outcome.error,
      says: `The grant was disconnected. ${ids.length} mirrored repl${ids.length === 1 ? "y" : "ies"} still held raw mail; ${outcome.deleted} had their body, headers and attachment bytes deleted immediately. Every order fact those replies produced stays on this restaurant's own record.`,
    });
  }

  // =========================================================================
  // THE DELETION ITSELF
  // =========================================================================

  /**
   * Replace the raw mail on these rows with a tombstone, and remove the
   * attachment bytes.
   *
   * `message_text` is `text NOT NULL` on the production baseline, so it CANNOT
   * be nulled without a constraint change on a table five subsystems write to.
   * It is replaced with a sentence naming the date and the reason. An empty
   * string would read as "the vendor sent nothing", which is the same class of
   * lie as a silent skip.
   */
  private async deleteRawFor(
    conversationIds: string[],
    reason: SweepReason,
  ): Promise<{
    deleted: number;
    attachmentsDeleted: number;
    error: string | null;
  }> {
    if (!conversationIds.length) {
      return { deleted: 0, attachmentsDeleted: 0, error: null };
    }

    const at = new Date().toISOString();
    const tombstone =
      reason === "grant_revoked"
        ? `[The raw mail was deleted on ${at.slice(0, 10)} because the mailbox grant that mirrored it was disconnected. What this reply established about the order - price, dates, commitments and the exact wording they were stated in - is on the order's own record and was not deleted.]`
        : `[The raw mail was deleted on ${at.slice(0, 10)} because this restaurant's mail retention window ran out. What this reply established about the order - price, dates, commitments and the exact wording they were stated in - is on the order's own record and was not deleted.]`;

    const attachments = await this.deleteAttachmentBytes(conversationIds, at);

    const { data: updated, error } = await this.db.supabase
      .from("procurement_conversations")
      .update({
        message_text: tombstone,
        content: null,
        email_headers: {},
        raw_deleted_at: at,
        raw_deleted_reason: reason,
      })
      .in("id", conversationIds)
      .select("id");

    if (error) {
      return {
        deleted: 0,
        attachmentsDeleted: attachments.deleted,
        error: `The raw mail was NOT deleted: ${error.message}`,
      };
    }

    return {
      deleted: (updated ?? []).length,
      attachmentsDeleted: attachments.deleted,
      error: attachments.error,
    };
  }

  private async deleteAttachmentBytes(
    conversationIds: string[],
    at: string,
  ): Promise<{ deleted: number; error: string | null }> {
    const { data: rows, error } = await this.db.supabase
      .from("conversation_attachments")
      .select("id, storage_path")
      .in("conversation_id", conversationIds)
      .is("bytes_deleted_at", null);
    if (error) {
      return {
        deleted: 0,
        error: `The attachments could not be read, so their bytes are still in the bucket: ${error.message}`,
      };
    }

    const items = rows ?? [];
    if (!items.length) return { deleted: 0, error: null };

    const paths = items
      .map((r) => (r.storage_path as string | null) ?? null)
      .filter((p): p is string => Boolean(p));

    if (paths.length) {
      const { error: removeError } = await this.db.supabase.storage
        .from(ATTACHMENT_BUCKET)
        .remove(paths);
      if (removeError) {
        return {
          deleted: 0,
          error: `The attachment bytes were NOT removed from ${ATTACHMENT_BUCKET}: ${removeError.message}`,
        };
      }
    }

    const { data: stamped, error: stampError } = await this.db.supabase
      .from("conversation_attachments")
      .update({ bytes_deleted_at: at })
      .in(
        "id",
        items.map((r) => String(r.id)),
      )
      .select("id");
    if (stampError) {
      return {
        deleted: paths.length,
        error: `The attachment bytes were removed but the rows were not stamped, so a later sweep will try again: ${stampError.message}`,
      };
    }

    return { deleted: (stamped ?? []).length, error: null };
  }

  // =========================================================================
  // THE NOTICE
  // =========================================================================

  /**
   * Tell the person whose mailbox it was, through the funnel the notification
   * producers use (`NotificationsService.persistForRestaurant`), targeted at
   * that one person with `onlyUserIds`.
   *
   * NOT A NINTH PRODUCER, and the reason is not scope. `ProducerLedgerService`
   * DEFERS a member who is inside their quiet hours so a later sweep can serve
   * them (producer-ledger.service.ts:48-49). That is right for "a price moved"
   * and wrong for "your mail was deleted a moment ago": the notice is the
   * receipt for an irreversible act the person just asked for, and it must not
   * wait until morning. The funnel is the same single door either way.
   */
  private async tellTheOwner(params: {
    restaurantId: string;
    ownerUserId: string | null;
    deleted: number;
    attachmentsDeleted: number;
  }): Promise<string> {
    if (!this.notifications) {
      return "No notice was sent: the notifications service was not available in this injector. The deletion still happened; nobody was told by the app.";
    }
    if (!params.ownerUserId) {
      return "No notice was sent: the grant had no recorded owner to address it to. The deletion still happened.";
    }

    const message =
      params.deleted === 0
        ? "You disconnected the mailbox grant. There was no mirrored mail left to delete, so nothing was removed. Nothing more will be read."
        : `You disconnected the mailbox grant. ${params.deleted} mirrored vendor repl${params.deleted === 1 ? "y" : "ies"} had ${params.deleted === 1 ? "its" : "their"} body, headers and ${params.attachmentsDeleted} attachment${params.attachmentsDeleted === 1 ? "" : "s"} deleted straight away. What those replies established about your orders - prices, dates and commitments - stays on the restaurant's own record.`;

    const { inserted } = await this.notifications.persistForRestaurant(
      params.restaurantId,
      {
        type: "mail_retention_deleted",
        title: "Mirrored mail deleted",
        message,
        priority: "medium",
        actionUrl: "/connections",
        actionLabel: "Connections",
        metadata: {
          deleted: params.deleted,
          attachments_deleted: params.attachmentsDeleted,
          reason: "grant_revoked",
        },
      },
      { broadcast: false, onlyUserIds: [params.ownerUserId] },
    );

    return inserted > 0
      ? `The owner of the grant was told: ${message}`
      : "No notice landed: the owner is no longer an active member of this restaurant, so there was nobody inside the tenant to write to.";
  }

  // =========================================================================
  // THE DISCLOSURE THE CONSENT SCREEN READS
  // =========================================================================

  /**
   * What a person is told BEFORE they grant. Read-only: it never writes a
   * derivation row, because a page load is not a quarterly derivation.
   *
   * When a stored figure exists it is the one reported, because it is the one
   * the sweep obeys. A fresh measure is taken anyway and reported alongside
   * only when the two disagree — a consent screen that showed today's measure
   * while the sweep obeyed last quarter's would be describing a rule nothing
   * enforces.
   */
  async disclosureFor(restaurantId: string): Promise<RetentionDisclosure> {
    const live = await this.computeWindow(restaurantId);

    const { data: stored, error } = await this.db.supabase
      .from("house_mail_retention_windows")
      .select("figure_days, basis, derived_at")
      .eq("restaurant_id", restaurantId)
      .limit(1);
    if (error) {
      throw new ServiceUnavailableException(
        `The stored retention window could not be read, and this page will not print a figure it cannot source: ${error.message}`,
      );
    }

    const row = stored?.[0] ?? null;
    const storedFigure = (row?.figure_days as number | undefined) ?? null;
    const storedAt = (row?.derived_at as string | null) ?? null;
    const rule = JURISDICTION_RULES[live.jurisdiction];

    const figureDays = storedFigure ?? live.figureDays;
    const figureFrom: RetentionDisclosure["figureFrom"] =
      storedFigure === null ? "measured_now" : "stored_derivation";
    const disagrees =
      storedFigure !== null && storedFigure !== live.figureDays;

    const basis =
      storedFigure === null
        ? `${live.basis} No quarterly derivation has been stored for this restaurant yet, so this is the figure measured just now and the figure the first derivation will store.`
        : disagrees
          ? `${(row?.basis as string) ?? live.basis} Measured again just now the figure would be ${live.figureDays} days; the quarterly derivation moves it, and until then the figure above is the one in force.`
          : ((row?.basis as string) ?? live.basis);

    return {
      restaurantId,
      figureDays,
      figureFrom,
      storedAt,
      wouldBeDays: disagrees ? live.figureDays : null,
      basis,
      jurisdiction: {
        code: rule.code,
        label: rule.label,
        factsFloorYears: rule.factsFloorYears,
        bindsCorrespondence: rule.bindsCorrespondence,
        why: rule.why,
        defaultedBecause: rule.defaultedBecause ?? null,
        citations: rule.citations,
      },
      storageLimitation: STORAGE_LIMITATION_SOURCES,
      split: RETENTION_DISCLOSURE_COPY.split,
      revocation: RETENTION_DISCLOSURE_COPY.revocation,
      windowIntro: RETENTION_DISCLOSURE_COPY.windowIntro,
      appliesTo: ["gmail_read"],
    };
  }

  // =========================================================================
  // SHARED READS
  // =========================================================================

  /**
   * The houses this module has anything to do.
   *
   * A house qualifies if it has a live `gmail_read` grant OR already holds a
   * mirrored row. The second half matters: a person can revoke a grant and
   * leave mirrored mail behind, and a population built only from live grants
   * would stop sweeping exactly the mail that most needs sweeping.
   */
  private async housesWithMirroredMail(): Promise<string[]> {
    const houses = new Set<string>();

    const { data: grants, error: grantError } = await this.db.supabase
      .from("integration_oauth_connections")
      .select("restaurant_id")
      .eq("integration_id", "gmail_read")
      .is("revoked_at", null);
    if (grantError) {
      throw new ServiceUnavailableException(
        `The reading grants could not be enumerated, so no house can be swept: ${grantError.message}`,
      );
    }
    for (const g of grants ?? []) {
      const id = (g.restaurant_id as string | null) ?? null;
      if (id) houses.add(id);
    }

    const { data: mirrored, error: mirroredError } = await this.db.supabase
      .from("procurement_conversations")
      .select("restaurant_id")
      .not("mirrored_by_grant_id", "is", null)
      .is("raw_deleted_at", null);
    if (mirroredError) {
      throw new ServiceUnavailableException(
        `The mirrored replies could not be enumerated, so no house can be swept: ${mirroredError.message}`,
      );
    }
    for (const row of mirrored ?? []) {
      const id = (row.restaurant_id as string | null) ?? null;
      if (id) houses.add(id);
    }

    return Array.from(houses);
  }

  /**
   * Write the count. Called on EVERY path out of a sweep, including the ones
   * that deleted nothing and the ones that failed — that is the whole point of
   * the table (ADR 0078).
   */
  private async recordSweep(run: SweepRun): Promise<SweepRun> {
    if (!run.restaurantId) {
      return {
        ...run,
        says: `${run.says} No count was written: this run names no restaurant, and house_mail_retention_sweeps is keyed to one. Nothing was deleted either, so the missing row records nothing that happened.`,
      };
    }

    const { error } = await this.db.supabase
      .from("house_mail_retention_sweeps")
      .insert({
        restaurant_id: run.restaurantId,
        reason: run.reason,
        connection_id: run.connectionId,
        considered: run.considered,
        deleted: run.deleted,
        attachments_deleted: run.attachmentsDeleted,
        window_days: run.windowDays,
        notice: run.notice,
        error: run.error,
      });
    if (error) {
      // The sweep itself may well have deleted mail. Losing the count does not
      // undo that, so this is logged loudly and carried back in `says` rather
      // than thrown: a thrown error here would make a successful deletion look
      // like a failed one.
      this.logger.error(
        `Retention sweep for ${run.restaurantId} could not be recorded: ${error.message}`,
      );
      return {
        ...run,
        says: `${run.says} The count itself could not be written (${error.message}), so this run is missing from house_mail_retention_sweeps.`,
      };
    }
    return run;
  }
}
