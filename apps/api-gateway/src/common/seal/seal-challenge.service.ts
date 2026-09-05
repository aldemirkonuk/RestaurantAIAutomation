import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import {
  SEAL_TTL_MS,
  hashCallArgs,
  hashSealToken,
  digestsMatch,
  newSealToken,
} from "./seal-token";
import {
  SealRefusal,
  SealSubjectKind,
  refusalWords,
  subjectNoun,
} from "./seal-subject";

/**
 * Every column this service reads, as a module-level `const` of literal names,
 * for `scripts/check_read_columns_exist.py` (see `payment-methods.service.ts`
 * for why a class static reads to that guard as unreadable).
 */
const SEAL_COLUMNS =
  "id, subject_kind, subject_id, restaurant_id, actor_user_id, tool_name, args_hash, token_hash, expires_at, redeemed_at";

/**
 * Mint one seal, spend it exactly once, for exactly one act.
 *
 * ===========================================================================
 * WHY THIS EXISTS, AND WHAT IT IS NOT
 * ===========================================================================
 * ADR 0114 shipped the seal as an ASSERTION and said so in its own text:
 * `sealed: true` was a claim in the same request as the thing it claimed about,
 * so anything holding a manager's session could send it. ADR 0107's addendum
 * replaced that for MCP tool writes with challenge-and-redeem. The founder's
 * decision of 2026-09-04 extends the same mechanism to the two places where the
 * assertion was most expensive — sealing an ORDER and changing how the house
 * PAYS — and leaves ordinary sealed settings as a logged assertion, deliberately.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SERVICE DOES NOT DO: mcp-connections
 * ---------------------------------------------------------------------------
 * `McpConnectionsService` keeps its OWN `issueSealChallenge`/`redeemSeal`. That
 * is not an oversight and it is not a fork of the token code — the arithmetic
 * is single-sourced in `seal-token.ts` and both paths import it. What is
 * duplicated is the redemption POLICY, and it is duplicated because
 * `mcp-connections/**` was out of scope for this pass and because that path
 * files its refusals in `mcp_tool_calls` (an MCP-specific log) rather than in
 * `system_audit_log`. Collapsing the two is a real, small follow-up; doing it
 * here, unasked, would have edited a module the brief fenced off.
 *
 * ---------------------------------------------------------------------------
 * THE TWO PROPERTIES THAT ARE NOT IN THIS FILE
 * ---------------------------------------------------------------------------
 * 1. SINGLE USE is a property of the UPDATE, not of this method: the redeeming
 *    statement carries `redeemed_at IS NULL` in its own filter, so two requests
 *    racing the same token cannot both find it unspent. A check-then-write in
 *    TypeScript would be a race with a comment on it.
 * 2. THE TOKEN IS NEVER STORED. `token_hash` holds sha256 of it; the token is
 *    returned once, by `issue`, and never again. A readable table of live seals
 *    is a table of pre-approved purchases.
 *
 * ---------------------------------------------------------------------------
 * EVERY REFUSAL IS FILED BEFORE IT IS THROWN
 * ---------------------------------------------------------------------------
 * A refused seal is precisely the event an incident review is opened for, so a
 * log holding only the acts that went through would omit the one anybody is
 * looking for — the [[absence-reported-as-health]] shape pointed at money. The
 * filing NEVER converts a 403 into a 500: the refusal has already happened, and
 * failing the write because the paper failed would tell the person something
 * false. A failed filing is logged loudly and the refusal still stands.
 */
@Injectable()
export class SealChallengeService {
  private readonly logger = new Logger(SealChallengeService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Mint one challenge for one hold.
   *
   * The caller checks the ROLE and the STATE of the subject before calling this
   * — a seal issued for an act that would be refused anyway is a seal a manager
   * holds and is then told meant nothing, which teaches people that the seal is
   * decoration.
   *
   * `args` is whatever must not change between the gesture and the write. For
   * an order that is its total; for a payment method it is which instrument and
   * which act. It is hashed, never stored in the clear.
   */
  async issue(params: {
    restaurantId: string;
    actorUserId: string;
    subjectKind: SealSubjectKind;
    subjectId: string;
    action: string;
    args: Record<string, unknown>;
  }): Promise<{ challenge: string; expiresAt: string; action: string }> {
    const token = newSealToken();
    const expiresAt = new Date(Date.now() + SEAL_TTL_MS).toISOString();

    const { error } = await this.databaseService.supabase
      .from("mcp_seal_challenges")
      .insert({
        subject_kind: params.subjectKind,
        subject_id: params.subjectId,
        restaurant_id: params.restaurantId,
        actor_user_id: params.actorUserId,
        tool_name: params.action,
        args_hash: hashCallArgs(params.args),
        token_hash: hashSealToken(token),
        expires_at: expiresAt,
      });

    if (error) {
      this.logger.error(
        `Failed to issue a seal challenge for ${params.subjectKind} ${params.subjectId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        `The seal was not issued, so nothing can be approved with it: ${error.message}`,
      );
    }

    return { challenge: token, expiresAt, action: params.action };
  }

  /**
   * Spend one challenge, exactly once, for exactly this act.
   *
   * Returns the id of the seal it SPENT when the seal is good. Every other path
   * throws with a whole sentence naming the thing that did not match; none of
   * them returns a boolean, because a boolean is a thing a caller can forget to
   * check, and the id is not a status — it is the receipt.
   *
   * WHY THE ID COMES BACK (2026-09-05, the payment pipeline)
   * -------------------------------------------------------
   * Most callers ignore it: they redeem and then write, in one request, and the
   * redemption IS the proof. One does not. `POST /billing/setup-intent` redeems
   * a seal and hands the browser a client secret; the instrument is then
   * attached on STRIPE's origin and only a LATER request — `POST /billing/sync`
   * — records it here. Those are two requests with a card form between them, so
   * the second one has to be able to prove the first was sealed. It does that by
   * naming this id, which the first request stamped onto the SetupIntent's own
   * metadata at the provider, and by asking `assertRedeemed` below.
   */
  async redeem(params: {
    restaurantId: string;
    actorUserId: string;
    subjectKind: SealSubjectKind;
    subjectId: string;
    action: string;
    args: Record<string, unknown>;
    challenge: string | null | undefined;
  }): Promise<{ sealId: string }> {
    const refuse = async (reason: SealRefusal): Promise<never> => {
      const sentence = refusalWords(reason, params.subjectKind);
      await this.fileRefusal(params, reason, sentence);
      throw new ForbiddenException(sentence);
    };

    const challenge = (params.challenge ?? "").trim();
    if (!challenge) return refuse("absent");

    const { data, error } = await this.databaseService.supabase
      .from("mcp_seal_challenges")
      .select(SEAL_COLUMNS)
      .eq("token_hash", hashSealToken(challenge))
      .maybeSingle();

    if (error) {
      // NOT a refusal: the seal could not be CHECKED, which is a different fact
      // from "the seal was bad", and filing it as one would put a refusal on a
      // manager's record for a database outage.
      throw new InternalServerErrorException(
        `The seal could not be checked, so nothing was changed: ${error.message}`,
      );
    }

    const seal = (data as Record<string, unknown> | null) ?? null;
    if (!seal) return refuse("unknown");

    if (!digestsMatch(String(seal.token_hash), hashSealToken(challenge))) {
      // Unreachable through the `.eq()` above, and kept because that `.eq()` is
      // one edit away from being something looser.
      return refuse("unknown");
    }
    if (seal.redeemed_at) return refuse("spent");
    if (String(seal.actor_user_id) !== params.actorUserId) {
      return refuse("other_actor");
    }
    if (String(seal.subject_kind) !== params.subjectKind) {
      return refuse("other_subject");
    }
    if (String(seal.subject_id) !== params.subjectId) {
      return refuse("other_subject");
    }
    if (
      String(seal.tool_name).trim().toLowerCase() !==
      params.action.trim().toLowerCase()
    ) {
      return refuse("other_action");
    }
    if (String(seal.args_hash) !== hashCallArgs(params.args)) {
      return refuse("arguments_changed");
    }
    if (new Date(String(seal.expires_at)).getTime() <= Date.now()) {
      return refuse("expired");
    }

    const { data: spent, error: spendError } = await this.databaseService.supabase
      .from("mcp_seal_challenges")
      .update({ redeemed_at: new Date().toISOString() })
      .eq("id", String(seal.id))
      .is("redeemed_at", null)
      .select("id");

    if (spendError) {
      throw new InternalServerErrorException(
        `The seal could not be redeemed, so nothing was changed: ${spendError.message}`,
      );
    }
    if ((spent ?? []).length === 0) return refuse("raced");
    return { sealId: String(seal.id) };
  }

  /**
   * Prove a seal was ALREADY spent, by this person, for this act, on this
   * subject — the mirror of `redeem`, for the case where the act and the record
   * of it are two different requests.
   *
   * ---------------------------------------------------------------------------
   * WHY THIS IS NOT A SECOND REDEMPTION
   * ---------------------------------------------------------------------------
   * `redeem` spends. This one does not, and must not: the seal was spent by
   * `POST /billing/setup-intent`, and a second spend would refuse the very
   * request that is trying to prove the first one happened. What it asserts is
   * that the row named by `sealId` is (a) a seal this house issued, (b) to this
   * actor, (c) for this subject and act, over these arguments, and (d) REDEEMED.
   *
   * (d) is the whole point. A seal that exists and was never spent is a seal
   * somebody minted and abandoned; treating its existence as approval is the
   * [[absence-reported-as-health]] inversion at the one seam that touches money,
   * so it has its own refusal (`unredeemed`) and its own sentence.
   *
   * ---------------------------------------------------------------------------
   * THE ID IS NOT A SECRET, AND THAT IS WHY THE OTHER FIVE CHECKS EXIST
   * ---------------------------------------------------------------------------
   * A seal id travels through Stripe's metadata and comes back on a read. It is
   * a uuid, not a token, so this method NEVER treats knowing one as authority:
   * every field is compared against the caller's own scope, and the arguments
   * are re-hashed. Knowing an id buys nothing that the actor and subject checks
   * do not immediately take away.
   */
  async assertRedeemed(params: {
    sealId: string | null | undefined;
    restaurantId: string;
    actorUserId: string;
    subjectKind: SealSubjectKind;
    subjectId: string;
    action: string;
    args: Record<string, unknown>;
  }): Promise<void> {
    const refuse = async (reason: SealRefusal): Promise<never> => {
      const sentence = refusalWords(reason, params.subjectKind);
      await this.fileRefusal(params, reason, sentence);
      throw new ForbiddenException(sentence);
    };

    const sealId = (params.sealId ?? "").trim();
    // No id at all is `absent`, not `unknown`: nothing named a seal, so the
    // sentence has to be the one that tells the operator to begin the hold.
    if (!sealId) return refuse("absent");

    const { data, error } = await this.databaseService.supabase
      .from("mcp_seal_challenges")
      .select(SEAL_COLUMNS)
      .eq("id", sealId)
      .maybeSingle();

    if (error) {
      // NOT a refusal — the seal could not be CHECKED, which is a different
      // fact from "the seal was bad". Same rule as `redeem`.
      throw new InternalServerErrorException(
        `The seal could not be checked, so nothing was changed: ${error.message}`,
      );
    }

    const seal = (data as Record<string, unknown> | null) ?? null;
    if (!seal) return refuse("unknown");

    if (String(seal.restaurant_id) !== params.restaurantId) {
      // A seal from another house is not this house's approval. `redeem` gets
      // this for free — it is found by a 32-byte token nobody else holds —
      // whereas this method is found by an id, so the house is checked here.
      return refuse("other_subject");
    }
    if (String(seal.actor_user_id) !== params.actorUserId) {
      return refuse("other_actor");
    }
    if (String(seal.subject_kind) !== params.subjectKind) {
      return refuse("other_subject");
    }
    if (String(seal.subject_id) !== params.subjectId) {
      return refuse("other_subject");
    }
    if (
      String(seal.tool_name).trim().toLowerCase() !==
      params.action.trim().toLowerCase()
    ) {
      return refuse("other_action");
    }
    if (String(seal.args_hash) !== hashCallArgs(params.args)) {
      return refuse("arguments_changed");
    }
    if (!seal.redeemed_at) return refuse("unredeemed");
    // `expires_at` is deliberately NOT checked. It bounds how long a seal may
    // be SPENT, and this seal was already spent inside that window; refusing
    // here would mean a card form left open for three minutes recorded nothing,
    // with a sentence blaming the operator for the bank's 3-D Secure step.
  }

  /**
   * File the refusal in `system_audit_log`. Never throws — see the class header.
   */
  private async fileRefusal(
    params: {
      restaurantId: string;
      actorUserId: string;
      subjectKind: SealSubjectKind;
      subjectId: string;
      action: string;
    },
    reason: SealRefusal,
    sentence: string,
  ): Promise<void> {
    try {
      const { error } = await this.databaseService.supabase
        .from("system_audit_log")
        .insert({
          actor_type: "user",
          actor_id: params.actorUserId,
          action: "seal_refused",
          entity_type: params.subjectKind,
          entity_id: params.subjectId,
          changes: {
            subjectKind: params.subjectKind,
            subjectId: params.subjectId,
            act: params.action,
            refusal: reason,
            noun: subjectNoun(params.subjectKind),
            sentence,
          },
          restaurant_id: params.restaurantId,
          reason: sentence,
        });
      if (error) {
        this.logger.error(
          `SEAL_REFUSAL_UNRECORDED ${params.subjectKind}=${params.subjectId} act=${params.action} reason=${reason} — ` +
            `${error.message}. The refusal stands; the paper did not.`,
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `SEAL_REFUSAL_UNRECORDED ${params.subjectKind}=${params.subjectId} act=${params.action} reason=${reason} — ` +
          `${message}. The refusal stands; the paper did not.`,
      );
    }
  }
}
