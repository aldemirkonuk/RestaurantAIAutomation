/**
 * Who may admit a hand-carried price book, and what happens while nobody has.
 *
 * ===========================================================================
 * THE DECISION THIS ENFORCES (ADR 0128, from ADR 0117 Q18)
 * ===========================================================================
 * The founder, 2026-09-05: *"Yes, it needs an approval however we can't wait
 * 2 people to approve a small decision, or a big one."*
 *
 * `upload-tier.ts` decides how big the decision is, from the book. This file
 * decides who may act on it, and it does so at the JURISDICTION rather than at
 * the house, because that is the level at which the harm reaches:
 * `price_index_postings` has no `restaurant_id` (20260904200000's own header
 * says so on purpose), so one manager's book becomes every house in that
 * state's index line.
 *
 * Measured on production, read-only, 2026-09-05 (the census is in ADR 0128):
 *
 *   * 15 houses. TEN have one owner-or-manager or none.
 *   * 8 jurisdictions. FIVE have exactly ONE person in them.
 *   * US-MI - the only jurisdiction with an uploadable source today - has three
 *     houses and THREE distinct owner-or-manager people.
 *
 * So a rule of "always two" would be a rule of "never" in five of eight
 * jurisdictions, and a rule of "one is always enough" would throw away the one
 * place a real second pair of eyes exists. Hence:
 *
 *   another eligible person confirms  -> `attested`, or `byte_match` when they
 *                                        produced the same bytes themselves
 *   nobody else exists at all         -> the uploader may admit their own book,
 *                                        with a stated reason, recorded
 *                                        `same_person` and never called a
 *                                        second pair of eyes
 *   others exist but have not acted   -> refused until the escalation has
 *                                        fired, then the same override, with a
 *                                        reason. The wait is bounded by
 *                                        `ESCALATION_HOURS`, not by whether a
 *                                        colleague reads their inbox.
 *
 * ===========================================================================
 * WHY BYTES ARE THE ONLY EVIDENCE THAT IS WORTH ANYTHING
 * ===========================================================================
 * A doctored workbook is undetectable by reading it: nobody reads 12,530 rows,
 * and a forged single price is 1 row in 12,530. What a second person CAN do is
 * fetch the book from the issuer themselves and compare the sha256. That is why
 * `confirm` accepts the file, hashes it, and records `byte_match` only when the
 * bytes actually agree - and records `attested` honestly when they do not,
 * rather than letting a click look like a check.
 *
 * ===========================================================================
 * ESCALATION NEVER ADMITS ANYTHING
 * ===========================================================================
 * The sweep tells people again. It does not approve. A clock that approves is
 * silence read as consent, which is the absence-reported-as-health inversion
 * with a timer on it - and it would arrive through the one door in this module
 * that puts numbers on other people's screens.
 */

import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { createHash } from "crypto";
import { DatabaseService } from "../database/database.service";
import { NotificationsService } from "../notifications/notifications.service";
import { SealChallengeService } from "../common/seal/seal-challenge.service";
import { normalizeJurisdiction } from "./price-index.registry";
import { jurisdictionCovers } from "./jurisdiction";
import type { EditionDiff, PriceFingerprint, TierVerdict } from "./upload-tier";

/**
 * Every column this service reads, as module-level `const`s of literal names,
 * for `scripts/check_read_columns_exist.py` (a class static reads to that guard
 * as unreadable - see `payment-methods.service.ts`).
 */
const REVIEW_COLUMNS =
  "id, source_key, state, file_name, file_sha256, edition_date, rows_written, uploaded_by, uploaded_by_restaurant_id, uploaded_at, tier, tier_reasons, tier_note, diff, price_fingerprint, fingerprint_refused_because, status, confirmed_by, confirmed_at, confirmation_evidence, confirmation_reason, confirmation_seal_id, refused_by, refused_at, refusal_reason, escalated_at, created_at";

const BASELINE_COLUMNS = "edition_date, price_fingerprint, status, source_key";

const HOUSE_COLUMNS = "id, name, state_province, country";

const ACCESS_COLUMNS = "user_id, restaurant_id, role, is_active";

/** The seal's act, one string, so the challenge and the redemption agree. */
export const ADMIT_ACTION = "price_index_upload.admit";

/**
 * How long a held book waits before the people who could act are told again.
 *
 * Twenty-four hours. REASONED, not measured: a posted price book is a quarterly
 * artefact, so a day costs the house nothing real; it is long enough that a
 * manager who uploads in the evening is not chased overnight, and short enough
 * that a book does not sit unseen for a week. It is also the bound on how long
 * a one-person-in-practice jurisdiction can be blocked, because the override
 * opens when the escalation fires.
 */
export const ESCALATION_HOURS = 24;

/** A person who may admit a book in one jurisdiction. */
export interface Admitter {
  userId: string;
  restaurantId: string;
  role: string;
}

/**
 * The pool, and whether it is KNOWN. `readFailed` is not a detail: a pool that
 * could not be read is not an empty pool, and treating it as one would open the
 * self-admission path on a database hiccup.
 */
export interface AdmitterPool {
  people: Admitter[];
  readFailed: boolean;
  housesInJurisdiction: number;
}

export interface ReviewRow {
  id: string;
  sourceKey: string;
  state: string;
  fileName: string;
  fileSha256: string;
  editionDate: string;
  rowsWritten: number;
  uploadedBy: string;
  uploadedByRestaurantId: string | null;
  uploadedAt: string;
  tier: string;
  tierReasons: string[];
  tierNote: string;
  status: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  confirmationEvidence: string | null;
  confirmationReason: string | null;
  refusedBy: string | null;
  refusedAt: string | null;
  refusalReason: string | null;
  escalatedAt: string | null;
}

function mapReview(r: Record<string, unknown>): ReviewRow {
  return {
    id: String(r.id),
    sourceKey: String(r.source_key),
    state: String(r.state),
    fileName: String(r.file_name),
    fileSha256: String(r.file_sha256),
    editionDate: String(r.edition_date).slice(0, 10),
    rowsWritten: Number(r.rows_written ?? 0),
    uploadedBy: String(r.uploaded_by),
    uploadedByRestaurantId: r.uploaded_by_restaurant_id
      ? String(r.uploaded_by_restaurant_id)
      : null,
    uploadedAt: String(r.uploaded_at),
    tier: String(r.tier),
    tierReasons: Array.isArray(r.tier_reasons) ? (r.tier_reasons as string[]) : [],
    tierNote: String(r.tier_note ?? ""),
    status: String(r.status),
    confirmedBy: r.confirmed_by ? String(r.confirmed_by) : null,
    confirmedAt: r.confirmed_at ? String(r.confirmed_at) : null,
    confirmationEvidence: r.confirmation_evidence
      ? String(r.confirmation_evidence)
      : null,
    confirmationReason: r.confirmation_reason
      ? String(r.confirmation_reason)
      : null,
    refusedBy: r.refused_by ? String(r.refused_by) : null,
    refusedAt: r.refused_at ? String(r.refused_at) : null,
    refusalReason: r.refusal_reason ? String(r.refusal_reason) : null,
    escalatedAt: r.escalated_at ? String(r.escalated_at) : null,
  };
}

@Injectable()
export class PriceIndexReviewService {
  private readonly logger = new Logger(PriceIndexReviewService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsService,
    private readonly seals: SealChallengeService,
  ) {}

  // =========================================================================
  // The baseline the next edition is weighed against
  // =========================================================================

  /**
   * The last edition of this book that was actually let into the market.
   *
   * A REFUSED book is never a baseline: comparing the next edition against one
   * somebody rejected would launder the rejected numbers into the bands.
   *
   * `readFailed` is returned rather than swallowed. The caller must treat an
   * unreadable baseline as an untestable comparison, which is
   * `second_pair_of_eyes` - never as "there is nothing to compare with", which
   * would also be `second_pair_of_eyes` today but for the wrong reason and with
   * the wrong sentence.
   */
  async baselineFor(sourceKey: string): Promise<{
    baseline: { fingerprint: PriceFingerprint; editionDate: string } | null;
    readFailed: boolean;
  }> {
    try {
      const { data, error } = await this.db.client
        .from("price_index_upload_reviews")
        .select(BASELINE_COLUMNS)
        .eq("source_key", sourceKey)
        .in("status", ["stood", "confirmed"])
        .not("price_fingerprint", "is", null)
        .order("edition_date", { ascending: false })
        .limit(1);
      if (error) throw error;
      const row = (data ?? [])[0] as Record<string, unknown> | undefined;
      if (!row) return { baseline: null, readFailed: false };
      const fingerprint = row.price_fingerprint as PriceFingerprint | null;
      if (!fingerprint || typeof fingerprint !== "object") {
        return { baseline: null, readFailed: false };
      }
      return {
        baseline: {
          fingerprint,
          editionDate: String(row.edition_date).slice(0, 10),
        },
        readFailed: false,
      };
    } catch (err) {
      this.logger.warn(
        `price_index_upload_reviews baseline read failed for ${sourceKey}: ${(err as Error).message}. ` +
          `The next book will be held rather than compared against a baseline nobody could read.`,
      );
      return { baseline: null, readFailed: true };
    }
  }

  // =========================================================================
  // Writing the review
  // =========================================================================

  /**
   * The decision already on record for these exact bytes, if there is one.
   *
   * `UNIQUE (source_key, file_sha256)` means the same book is one decision, so
   * a second upload of it must be told what happened to the first rather than
   * meeting a unique-violation the uploader cannot read. `readFailed` is
   * separate from `null`: "no decision exists" and "we could not look" must not
   * both come back as "go ahead".
   */
  async existingFor(
    sourceKey: string,
    fileSha256: string,
  ): Promise<{ review: ReviewRow | null; readFailed: boolean }> {
    try {
      const { data, error } = await this.db.client
        .from("price_index_upload_reviews")
        .select(REVIEW_COLUMNS)
        .eq("source_key", sourceKey)
        .eq("file_sha256", fileSha256)
        .maybeSingle();
      if (error) throw error;
      return {
        review: data ? mapReview(data as Record<string, unknown>) : null,
        readFailed: false,
      };
    } catch (err) {
      this.logger.warn(
        `could not check whether ${fileSha256.slice(0, 12)} was already decided: ${(err as Error).message}`,
      );
      return { review: null, readFailed: true };
    }
  }

  /**
   * Stamp a routine book's rows as admitted, with no confirmation asked for.
   *
   * The SAME statement a confirmation uses, deliberately: one way for a row to
   * become the market, so a routine book and a confirmed one cannot end up
   * admitted by two different pieces of code that disagree.
   */
  async admitRoutine(review: ReviewRow, admittedAt: string): Promise<number> {
    return this.admitPostings(review, admittedAt);
  }

  /** File one upload's review row. Throws: an unrecorded decision is not one. */
  async record(input: {
    sourceKey: string;
    state: string;
    fileName: string;
    fileSha256: string;
    editionDate: string;
    rowsWritten: number;
    uploadedBy: string;
    uploadedByRestaurantId: string | null;
    uploadedAt: string;
    verdict: TierVerdict;
    diff: EditionDiff;
    fingerprint: PriceFingerprint | null;
    fingerprintRefusedBecause: string | null;
  }): Promise<ReviewRow> {
    const routine = input.verdict.tier === "routine";
    const diffJson = { ...input.diff } as Record<string, unknown>;
    const { data, error } = await this.db.client
      .from("price_index_upload_reviews")
      .insert({
        source_key: input.sourceKey,
        state: input.state,
        file_name: input.fileName,
        file_sha256: input.fileSha256,
        edition_date: input.editionDate,
        rows_written: input.rowsWritten,
        uploaded_by: input.uploadedBy,
        uploaded_by_restaurant_id: input.uploadedByRestaurantId,
        uploaded_at: input.uploadedAt,
        tier: input.verdict.tier,
        tier_reasons: input.verdict.reasons,
        tier_note: input.verdict.sentences.join(" ") || "Nothing held this book.",
        // Written through a local, NOT cast inline. `as unknown as
        // Record<string, unknown>` carries a comma inside its type arguments,
        // and `check_order_capture_contract.py` splits a payload on top-level
        // commas — so an inline cast makes this whole insert unreadable to the
        // guard that exists to prove every written column is declared.
        diff: diffJson,
        price_fingerprint: input.fingerprint,
        fingerprint_refused_because: input.fingerprintRefusedBecause,
        // 'stood', never 'confirmed': nobody confirmed a routine book, and a
        // status that said otherwise would be a lie in a column.
        status: routine ? "stood" : "pending",
        confirmed_by: null,
        confirmed_at: null,
        confirmation_evidence: null,
        confirmation_reason: null,
        confirmation_seal_id: null,
        refused_by: null,
        refused_at: null,
        refusal_reason: null,
        escalated_at: null,
      })
      .select(REVIEW_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return mapReview(data as Record<string, unknown>);
  }

  // =========================================================================
  // Who may act
  // =========================================================================

  /**
   * The jurisdiction one house is in: its province, or its country when it
   * records no province.
   *
   * The SAME precedence `PriceIndexService.forHouse` reads, deliberately - a
   * manager who is shown an index line for a state must be able to act on the
   * books held for that same state, and two answers to "which jurisdiction is
   * this house in" is how those two come apart.
   */
  async jurisdictionOfHouse(restaurantId: string | null): Promise<string | null> {
    if (!restaurantId) return null;
    try {
      const { data, error } = await this.db.client
        .from("restaurants")
        .select(HOUSE_COLUMNS)
        .eq("id", restaurantId)
        .maybeSingle();
      if (error) throw error;
      const row = (data ?? null) as Record<string, unknown> | null;
      if (!row) return null;
      return (
        normalizeJurisdiction(
          typeof row.state_province === "string" ? row.state_province : null,
        ) ??
        normalizeJurisdiction(
          typeof row.country === "string" ? row.country : null,
        )
      );
    } catch (err) {
      this.logger.warn(
        `could not read the jurisdiction of house ${restaurantId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Every owner or manager of a house in this jurisdiction, optionally minus
   * one person.
   *
   * Coverage is CONTAINMENT in both directions: a house recorded as `US-MI` is
   * in a `US-MI` book's jurisdiction, and a house recorded only as `US` is not
   * (a missing address is not a match). The same `jurisdictionCovers` the
   * register itself reads, so who SEES a book and who may ADMIT it cannot
   * drift apart.
   */
  async admittersFor(
    state: string,
    excludeUserId?: string | null,
  ): Promise<AdmitterPool> {
    let houses: Array<{ id: string; jurisdiction: string | null }> = [];
    try {
      const { data, error } = await this.db.client
        .from("restaurants")
        .select(HOUSE_COLUMNS);
      if (error) throw error;
      houses = ((data ?? []) as Array<Record<string, unknown>>).map((h) => ({
        id: String(h.id),
        jurisdiction:
          normalizeJurisdiction(
            typeof h.state_province === "string" ? h.state_province : null,
          ) ??
          normalizeJurisdiction(
            typeof h.country === "string" ? h.country : null,
          ),
      }));
    } catch (err) {
      this.logger.warn(
        `could not read the houses in ${state}: ${(err as Error).message}. ` +
          `The pool is UNKNOWN, not empty.`,
      );
      return { people: [], readFailed: true, housesInJurisdiction: 0 };
    }

    const inJurisdiction = houses
      .filter((h) => h.jurisdiction && jurisdictionCovers(state, h.jurisdiction))
      .map((h) => h.id);
    if (inJurisdiction.length === 0) {
      return { people: [], readFailed: false, housesInJurisdiction: 0 };
    }

    try {
      const { data, error } = await this.db.client
        .from("user_restaurant_access")
        .select(ACCESS_COLUMNS)
        .in("restaurant_id", inJurisdiction)
        .eq("is_active", true)
        .in("role", ["owner", "manager"]);
      if (error) throw error;
      const seen = new Set<string>();
      const people: Admitter[] = [];
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const userId = String(row.user_id);
        if (excludeUserId && userId === excludeUserId) continue;
        if (seen.has(userId)) continue;
        seen.add(userId);
        people.push({
          userId,
          restaurantId: String(row.restaurant_id),
          role: String(row.role),
        });
      }
      return {
        people,
        readFailed: false,
        housesInJurisdiction: inJurisdiction.length,
      };
    } catch (err) {
      this.logger.warn(
        `could not read who may admit a book in ${state}: ${(err as Error).message}. ` +
          `The pool is UNKNOWN, not empty.`,
      );
      return {
        people: [],
        readFailed: true,
        housesInJurisdiction: inJurisdiction.length,
      };
    }
  }

  // =========================================================================
  // Reading the reviews
  // =========================================================================

  /** One review, or a 404 with a sentence. Never a null the caller must guess at. */
  async byId(reviewId: string): Promise<ReviewRow> {
    const { data, error } = await this.db.client
      .from("price_index_upload_reviews")
      .select(REVIEW_COLUMNS)
      .eq("id", reviewId)
      .maybeSingle();
    if (error) {
      throw new Error(
        `The book's record could not be read, so nothing was changed: ${error.message}`,
      );
    }
    if (!data) {
      throw new NotFoundException(
        "No uploaded book with that id is on record in this register.",
      );
    }
    return mapReview(data as Record<string, unknown>);
  }

  /**
   * The books this jurisdiction is waiting on, newest first, and the recent
   * decisions beside them.
   *
   * `readFailed` travels with the result rather than becoming an empty list:
   * "no book is waiting" and "we could not find out" are different sentences
   * and the panel prints a different one for each.
   */
  async forJurisdiction(state: string): Promise<{
    pending: ReviewRow[];
    recent: ReviewRow[];
    readFailed: boolean;
  }> {
    try {
      const { data, error } = await this.db.client
        .from("price_index_upload_reviews")
        .select(REVIEW_COLUMNS)
        .eq("state", state)
        .order("uploaded_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      const rows = ((data ?? []) as Array<Record<string, unknown>>).map(mapReview);
      return {
        pending: rows.filter((r) => r.status === "pending"),
        recent: rows.filter((r) => r.status !== "pending").slice(0, 10),
        readFailed: false,
      };
    } catch (err) {
      this.logger.warn(
        `price_index_upload_reviews read failed for ${state}: ${(err as Error).message}`,
      );
      return { pending: [], recent: [], readFailed: true };
    }
  }

  /**
   * How many books this state is holding, for the register's silence sentence.
   *
   * `null` means UNKNOWN. A held book that reads as "no index line here" would
   * tell a Michigan house to give up on a book its own manager already carried
   * in, which is exactly the fault ADR 0117 corrected for Illinois.
   */
  async pendingCountFor(state: string): Promise<number | null> {
    try {
      const { count, error } = await this.db.client
        .from("price_index_upload_reviews")
        .select("id", { count: "exact", head: true })
        .eq("state", state)
        .eq("status", "pending");
      if (error) throw error;
      return count ?? 0;
    } catch (err) {
      this.logger.warn(
        `could not count held books for ${state}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  // =========================================================================
  // The seal
  // =========================================================================

  /**
   * The arguments the seal is minted over: WHICH book and WHY it is held.
   *
   * The sha256 stops a seal from one book being spent on another; the tier
   * reasons stop a seal minted while a book was held for one reason being spent
   * after the reason changed. Both are exactly the `args_hash` job that stops
   * an order of 2,000 being approved after somebody made it 20,000.
   */
  sealArgs(review: ReviewRow): Record<string, unknown> {
    return {
      sha256: review.fileSha256,
      tier: review.tier,
      reasons: [...review.tierReasons].sort(),
      rows: review.rowsWritten,
    };
  }

  async challenge(
    review: ReviewRow,
    actor: { userId: string; restaurantId: string },
  ) {
    return this.seals.issue({
      restaurantId: actor.restaurantId,
      actorUserId: actor.userId,
      subjectKind: "price_index_upload",
      subjectId: review.id,
      action: ADMIT_ACTION,
      args: this.sealArgs(review),
    });
  }

  // =========================================================================
  // Admitting and refusing
  // =========================================================================

  /**
   * Let a held book into the market.
   *
   * The order is deliberate: eligibility, then the seal, then the flip. A seal
   * redeemed for an act that would be refused anyway is a seal somebody is then
   * told meant nothing, which teaches people the seal is decoration
   * (`seal-challenge.service.ts`'s own rule).
   */
  async confirm(
    review: ReviewRow,
    actor: { userId: string; restaurantId: string },
    input: { challenge?: string | null; reason?: string | null; fileBase64?: string | null },
  ): Promise<{ review: ReviewRow; postingsAdmitted: number; sentence: string }> {
    if (review.status !== "pending") {
      throw new ForbiddenException(
        `This book is already ${review.status === "stood" ? "in the market: it was routine, and nobody was asked to confirm it" : review.status}. Nothing was changed.`,
      );
    }

    const pool = await this.admittersFor(review.state, review.uploadedBy);
    if (pool.readFailed) {
      // Fail CLOSED. If we cannot tell whether somebody else exists, we cannot
      // tell whether this is a second pair of eyes or a self-admission, and
      // guessing would put the weaker answer on the record as the stronger one.
      throw new ForbiddenException(
        "Who else may admit a book in this jurisdiction could not be read, so this admission cannot be told apart from a self-admission. Nothing was changed. This is unknown, not nobody.",
      );
    }

    const isUploader = actor.userId === review.uploadedBy;
    const reason = (input.reason ?? "").trim();

    if (!isUploader) {
      const eligible = pool.people.some((p) => p.userId === actor.userId);
      if (!eligible) {
        throw new ForbiddenException(
          `A book for ${review.state} is admitted by an owner or manager of a house in that jurisdiction. Your houses are not in it, so nothing was changed.`,
        );
      }
    } else if (pool.people.length > 0 && !review.escalatedAt) {
      const hours = ESCALATION_HOURS;
      throw new ForbiddenException(
        `${pool.people.length} other owner${pool.people.length === 1 ? "" : "s"} or manager${pool.people.length === 1 ? "" : "s"} in ${review.state} can admit this book, and a second pair of eyes has to be a different pair. If nobody has acted ${hours} hours after the upload, they are told again and you may admit it yourself with a stated reason. Nothing was changed.`,
      );
    } else if (!reason) {
      throw new ForbiddenException(
        pool.people.length === 0
          ? `There is no second owner or manager anywhere in ${review.state}, so you may admit your own book — but say why, in a sentence. It goes on the record beside the book and beside every line it draws.`
          : `Nobody else has acted since this book was escalated, so you may admit your own book — but say why, in a sentence. It goes on the record beside the book.`,
      );
    }

    // What the confirmation is actually worth, decided from what was produced
    // rather than from what was clicked.
    let evidence: "byte_match" | "attested" | "same_person";
    let byteNote = "";
    if (isUploader) {
      evidence = "same_person";
    } else if (input.fileBase64 && input.fileBase64.trim()) {
      const sha = createHash("sha256")
        .update(Buffer.from(input.fileBase64, "base64"))
        .digest("hex");
      if (sha !== review.fileSha256) {
        throw new ForbiddenException(
          `The file you fetched is not the file that was uploaded: its sha256 is ${sha.slice(0, 12)} and the book on record is ${review.fileSha256.slice(0, 12)}. That is the whole point of the comparison, so nothing was changed. Either the edition moved, or one of these two files is not the Commission's.`,
        );
      }
      evidence = "byte_match";
      byteNote =
        " The bytes were fetched independently and match, which is the only evidence a book whose issuer publishes no signature can carry.";
    } else {
      evidence = "attested";
    }

    const { sealId } = await this.seals.redeem({
      restaurantId: actor.restaurantId,
      actorUserId: actor.userId,
      subjectKind: "price_index_upload",
      subjectId: review.id,
      action: ADMIT_ACTION,
      args: this.sealArgs(review),
      challenge: input.challenge,
    });

    const admittedAt = new Date().toISOString();
    const { data, error } = await this.db.client
      .from("price_index_upload_reviews")
      .update({
        status: "confirmed",
        confirmed_by: actor.userId,
        confirmed_at: admittedAt,
        confirmation_evidence: evidence,
        confirmation_reason: reason || null,
        confirmation_seal_id: sealId,
      })
      .eq("id", review.id)
      // The single-use property of the ADMISSION, in the statement rather than
      // in a check-then-write: two requests racing this book cannot both find
      // it pending.
      .eq("status", "pending")
      .select(REVIEW_COLUMNS);
    if (error) {
      throw new Error(
        `The book's record could not be updated, so nothing was admitted: ${error.message}`,
      );
    }
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      throw new ForbiddenException(
        "This book was decided by another request a moment ago, so this one was refused. Exactly one decision runs per book.",
      );
    }
    const updated = mapReview(rows[0]);

    const postingsAdmitted = await this.admitPostings(review, admittedAt);

    const sentence =
      evidence === "same_person"
        ? `Admitted by the same person who carried it in${pool.people.length === 0 ? `, because ${review.state} has no second owner or manager` : ", after the escalation and nobody else acting"}. This is not a second pair of eyes and the record says so.`
        : `Admitted by a second owner or manager.${byteNote}`;

    await this.tell(updated, pool, {
      title: `A price book for ${review.state} was admitted`,
      message: `${updated.fileName} (${updated.editionDate}) is now the index line for ${review.state}. ${sentence} ${updated.tierNote}`,
      priority: "medium",
      groupKey: `price_index_admitted:${updated.id}`,
    });

    return { review: updated, postingsAdmitted, sentence };
  }

  /** Never let this book in. The rows stay written and stay out of the market. */
  async refuse(
    review: ReviewRow,
    actor: { userId: string; restaurantId: string },
    reason: string,
  ): Promise<ReviewRow> {
    if (review.status !== "pending") {
      throw new ForbiddenException(
        `This book is already ${review.status}, so nothing was changed.`,
      );
    }
    const words = (reason ?? "").trim();
    if (!words) {
      throw new ForbiddenException(
        "A refusal names its reason. The person who carried the book in reads it, and a refusal with no reason teaches them nothing about what to bring instead. Nothing was changed.",
      );
    }
    const pool = await this.admittersFor(review.state, null);
    if (pool.readFailed) {
      throw new ForbiddenException(
        "Who may act on a book in this jurisdiction could not be read, so nothing was changed. This is unknown, not nobody.",
      );
    }
    const eligible =
      actor.userId === review.uploadedBy ||
      pool.people.some((p) => p.userId === actor.userId);
    if (!eligible) {
      throw new ForbiddenException(
        `A book for ${review.state} is refused by an owner or manager of a house in that jurisdiction, or by the person who carried it in. Nothing was changed.`,
      );
    }

    const { data, error } = await this.db.client
      .from("price_index_upload_reviews")
      .update({
        status: "refused",
        refused_by: actor.userId,
        refused_at: new Date().toISOString(),
        refusal_reason: words,
      })
      .eq("id", review.id)
      .eq("status", "pending")
      .select(REVIEW_COLUMNS);
    if (error) {
      throw new Error(
        `The book's record could not be updated, so nothing was refused: ${error.message}`,
      );
    }
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      throw new ForbiddenException(
        "This book was decided by another request a moment ago, so this one was refused. Exactly one decision runs per book.",
      );
    }
    const updated = mapReview(rows[0]);
    await this.tell(updated, pool, {
      title: `A price book for ${review.state} was refused`,
      message: `${updated.fileName} (${updated.editionDate}) will not be an index line. ${words}`,
      priority: "medium",
      groupKey: `price_index_refused:${updated.id}`,
    });
    return updated;
  }

  /**
   * Stamp the rows this book wrote as admitted.
   *
   * Keyed on the sha256 rather than on a foreign key: the bytes are already the
   * identity of an upload everywhere else in this module, `upload_sha256` is
   * indexed for exactly this seek, and `UNIQUE (source_key, file_sha256)` on the
   * review means one book's bytes name one decision.
   *
   * A failure here is LOUD and does not roll the decision back: the decision is
   * recorded and re-running it is safe (`admitted_at IS NULL` is in the filter),
   * whereas a silent partial admission would put half a book on screens.
   */
  private async admitPostings(
    review: ReviewRow,
    admittedAt: string,
  ): Promise<number> {
    const { data, error } = await this.db.client
      .from("price_index_postings")
      .update({ admitted_at: admittedAt })
      .eq("upload_sha256", review.fileSha256)
      .is("admitted_at", null)
      .select("id");
    if (error) {
      this.logger.error(
        `PRICE_BOOK_ADMITTED_BUT_ROWS_NOT_STAMPED review=${review.id} sha256=${review.fileSha256.slice(0, 12)} — ` +
          `${error.message}. The decision stands; the rows are still held. Re-running the admission is safe.`,
      );
      return 0;
    }
    return (data ?? []).length;
  }

  // =========================================================================
  // Telling people
  // =========================================================================

  /**
   * Announce a book to the people who can act on it, house by house.
   *
   * `persistForRestaurant` with `onlyUserIds` rather than a broadcast: the
   * register is jurisdiction-wide but the inbox is not, and a book waiting in
   * Michigan is not news for the staff of a Michigan house who could not admit
   * it if they wanted to.
   *
   * Never throws. A book that was admitted and whose announcement failed is
   * still admitted, and turning that into a 500 would tell the operator
   * something false about what happened.
   */
  private async tell(
    review: ReviewRow,
    pool: AdmitterPool,
    payload: {
      title: string;
      message: string;
      priority: "low" | "medium" | "high" | "critical";
      groupKey: string;
    },
  ): Promise<void> {
    const byHouse = new Map<string, string[]>();
    for (const p of pool.people) {
      byHouse.set(p.restaurantId, [
        ...(byHouse.get(p.restaurantId) ?? []),
        p.userId,
      ]);
    }
    // The uploader's own house hears about its own book, when the upload said
    // which house that was. It is optional (see the column's comment), and an
    // unknown house is skipped rather than guessed at — the people who can
    // ACT on the book are the pool above, and they are told either way.
    if (
      review.uploadedByRestaurantId &&
      !byHouse.has(review.uploadedByRestaurantId)
    ) {
      byHouse.set(review.uploadedByRestaurantId, [review.uploadedBy]);
    }
    for (const [restaurantId, userIds] of byHouse) {
      try {
        await this.notifications.persistForRestaurant(
          restaurantId,
          {
            type: "price_index_upload",
            title: payload.title,
            message: payload.message,
            priority: payload.priority,
            actionUrl: "/notifications",
            actionLabel: "Open the price book",
            groupKey: payload.groupKey,
            metadata: {
              reviewId: review.id,
              sourceKey: review.sourceKey,
              state: review.state,
              fileName: review.fileName,
              fileSha256: review.fileSha256,
              editionDate: review.editionDate,
              tier: review.tier,
              tierReasons: review.tierReasons,
              status: review.status,
              rowsWritten: review.rowsWritten,
            },
          },
          { broadcast: false, onlyUserIds: userIds, dedupeWithinMinutes: 60 },
        );
      } catch (err) {
        this.logger.warn(
          `could not tell house ${restaurantId} about price book ${review.id}: ${(err as Error).message}. ` +
            `The decision stands; the announcement did not.`,
        );
      }
    }
  }

  /** Announce a book that is waiting. Public: the upload service calls it. */
  async announceHeld(review: ReviewRow, pool: AdmitterPool): Promise<void> {
    const who =
      pool.readFailed
        ? "Who else could admit it could not be read, so this may be the only person who can."
        : pool.people.length === 0
          ? `There is no second owner or manager anywhere in ${review.state}, so the person who carried it in may admit it themselves with a stated reason.`
          : `${pool.people.length} other owner${pool.people.length === 1 ? "" : "s"} or manager${pool.people.length === 1 ? "" : "s"} in ${review.state} can admit it.`;
    await this.tell(review, pool, {
      title: `A price book for ${review.state} is waiting`,
      message: `${review.fileName} (${review.editionDate}, ${review.rowsWritten} rows) is held out of the market until somebody admits it. ${review.tierNote} ${who}`,
      priority: "high",
      groupKey: `price_index_held:${review.id}`,
    });
  }

  /** Announce a routine book. A notice, not a request. */
  async announceStood(review: ReviewRow, pool: AdmitterPool): Promise<void> {
    await this.tell(review, pool, {
      title: `A price book for ${review.state} was brought in`,
      message: `${review.fileName} (${review.editionDate}, ${review.rowsWritten} rows) is now the index line for ${review.state}. It sat inside every band this register checks, so one person's upload stood and nobody was asked to confirm it. ${review.tierNote}`,
      priority: "low",
      groupKey: `price_index_stood:${review.id}`,
    });
  }

  // =========================================================================
  // Escalation - which tells people, and never decides anything
  // =========================================================================

  @Cron(CronExpression.EVERY_HOUR, { name: "price-index-held-book-escalation" })
  async escalationSweep(now: Date = new Date()): Promise<{
    escalated: number;
    checked: number;
    withheldReason: string | null;
  }> {
    const cutoff = new Date(
      now.getTime() - ESCALATION_HOURS * 3_600_000,
    ).toISOString();
    let rows: ReviewRow[] = [];
    try {
      const { data, error } = await this.db.client
        .from("price_index_upload_reviews")
        .select(REVIEW_COLUMNS)
        .eq("status", "pending")
        .is("escalated_at", null)
        .lt("uploaded_at", cutoff)
        .limit(50);
      if (error) throw error;
      rows = ((data ?? []) as Array<Record<string, unknown>>).map(mapReview);
    } catch (err) {
      // Throwing here would be a failed sweep reported as a quiet one. The
      // reason travels back with the count so a caller can tell "nothing was
      // waiting" from "we could not look".
      this.logger.warn(
        `held-book escalation could not read the register: ${(err as Error).message}`,
      );
      return {
        escalated: 0,
        checked: 0,
        withheldReason:
          "The register of held books could not be read on this tick. This is unknown, not empty.",
      };
    }

    if (rows.length === 0) {
      return {
        escalated: 0,
        checked: 0,
        withheldReason: `No book has been waiting longer than ${ESCALATION_HOURS} hours without the people who could act being told again.`,
      };
    }

    let escalated = 0;
    for (const review of rows) {
      const pool = await this.admittersFor(review.state, review.uploadedBy);
      const hours = Math.floor(
        (now.getTime() - new Date(review.uploadedAt).getTime()) / 3_600_000,
      );
      await this.tell(review, pool, {
        title: `A price book for ${review.state} has been waiting ${hours} hours`,
        message:
          `${review.fileName} (${review.editionDate}) is still held out of the market. ${review.tierNote} ` +
          (pool.people.length === 0
            ? `Nobody else in ${review.state} can admit it, so it is now open to the person who carried it in, with a stated reason.`
            : `Nobody has admitted or refused it. It is now also open to the person who carried it in, with a stated reason, because a book cannot wait forever on somebody else's inbox.`) +
          " Waiting does not admit it: nothing goes on screens until a person decides.",
        priority: "high",
        groupKey: `price_index_escalated:${review.id}`,
      });
      const { error } = await this.db.client
        .from("price_index_upload_reviews")
        .update({ escalated_at: now.toISOString() })
        .eq("id", review.id)
        .is("escalated_at", null);
      if (error) {
        this.logger.warn(
          `could not stamp the escalation on book ${review.id}: ${error.message}. ` +
            `The people were told; the stamp was not written, so the next tick will tell them again.`,
        );
        continue;
      }
      escalated += 1;
    }

    return { escalated, checked: rows.length, withheldReason: null };
  }
}
