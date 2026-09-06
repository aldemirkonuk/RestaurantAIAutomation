/**
 * A person asserts that one of this house's items is exposed to a series.
 *
 * THE FOUNDER'S ANSWER TO Q5, 2026-09-05, verbatim: *"the exposure-assertion
 * route — an owner or manager asserts 'this item is exposed to this series with
 * this pass-through' as a sealed named act (ADR 0107 pattern), a failed write
 * says why; then the dark alert has a testable path."*
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS ONE IS A REAL SEAL AND THE ARMING ACT IS NOT
 * ─────────────────────────────────────────────────────────────────────────────
 * `mcp_seal_challenges.actor_user_id` is `UUID NOT NULL REFERENCES
 * public.users(user_id)` and the row carries a `restaurant_id`. An owner or a
 * manager has both, so this act goes through `SealChallengeService` exactly as
 * every other sealed act does — no second copy of the redemption policy, which
 * `seal-challenge.service.ts`'s own header calls a fork even when the token
 * arithmetic is shared. The ADMIN arming act has neither a user nor a tenant
 * (ADR 0099's guard says so in its own words), which is why that one carries
 * the proposal hash instead and says so out loud.
 *
 * WHY IT IS SEALED AT ALL. An exposure is the join that turns a world index
 * into a claim about this kitchen's eggs. Once it exists, a rule may interrupt
 * a person about that item on the strength of a number published by somebody
 * who has never heard of this house. It is not undoable by the next request
 * either — it is retired, never deleted, so a mistake stays in the record. The
 * seal's `args_hash` binds the act to the ITEM, the SERIES and the PASS-THROUGH
 * that were on the screen, so an exposure held open at 0.20 cannot be spent
 * after somebody made it 0.90.
 *
 * WHAT IT REFUSES TO INFER. Everything. No model proposes an exposure, no
 * category maps to a series, and `pass_through` defaults to NULL with basis
 * `unset` — which is the common case and is said in words on the screen. The
 * category leader's own product infers item-level exposures and publishes no
 * accuracy figure of any kind; under ADR 0083 this product may not.
 */

import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { SealChallengeService } from "../common/seal/seal-challenge.service";
import { SERIES } from "./commodity.registry";

/** The act a seal is minted for. One seal approves one act, not a session. */
export const EXPOSURE_ACTION = "assert_exposure";
export const RETIRE_ACTION = "retire_exposure";

/** What the caller is asserting. `null` pass-through is the common case. */
export interface ExposureAssertion {
  seriesKey: string;
  houseItemId: string;
  passThrough: number | null;
  passThroughBasis: "issuer_published" | "house_measured" | "unset";
  lagDays: number | null;
  lagBasis: "issuer_published" | "house_measured" | "unset";
  note: string | null;
}

/** What happened. A refusal always says why, and never as an empty result. */
export interface ExposureOutcome {
  written: boolean;
  reason:
    | "asserted"
    | "retired"
    | "unknown_series"
    | "series_not_registered"
    | "item_not_this_house"
    | "figure_without_a_basis"
    | "already_asserted"
    | "write_failed"
    | "unreadable";
  detail: string;
  exposureId: string | null;
}

@Injectable()
export class CommodityExposureService {
  private readonly logger = new Logger(CommodityExposureService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly seals: SealChallengeService,
  ) {}

  /**
   * The arguments the seal is bound to.
   *
   * The PASS-THROUGH is in here on purpose: it is the number that decides how
   * loudly the assistant later speaks about this item, and a seal that ignored
   * it would let an exposure approved at "we do not know" be written at "ninety
   * percent of every move reaches your invoice".
   */
  private sealArgs(a: ExposureAssertion): Record<string, unknown> {
    return {
      seriesKey: a.seriesKey,
      houseItemId: a.houseItemId,
      passThrough: a.passThrough,
      passThroughBasis: a.passThroughBasis,
      lagDays: a.lagDays,
      lagBasis: a.lagBasis,
    };
  }

  /**
   * Begin the hold. The seal is issued here and spent by `assert`, so
   * `sealed: true` can never be an assertion in the same request as the thing
   * it claims about (ADR 0107/0116 addenda).
   *
   * The state of the act is checked BEFORE the seal is minted: a seal issued
   * for a write that would be refused anyway is a seal a manager holds and is
   * then told meant nothing, which teaches people the seal is decoration.
   */
  async challenge(
    actor: { userId: string; restaurantId: string },
    a: ExposureAssertion,
  ): Promise<
    | { issued: true; challenge: string; expiresAt: string; action: string }
    | { issued: false; reason: string; detail: string }
  > {
    const guard = await this.precheck(actor, a);
    if (guard) return { issued: false, reason: guard.reason, detail: guard.detail };
    const c = await this.seals.issue({
      restaurantId: actor.restaurantId,
      actorUserId: actor.userId,
      subjectKind: "commodity_exposure",
      // The ITEM is the subject: the act is about this house's item, and one
      // item may be exposed to several series. The series travels in the args.
      subjectId: a.houseItemId,
      action: EXPOSURE_ACTION,
      args: this.sealArgs(a),
    });
    return { issued: true, ...c };
  }

  /** Everything that would refuse this assertion, checked before anything else. */
  private async precheck(
    actor: { userId: string; restaurantId: string },
    a: ExposureAssertion,
  ): Promise<{ reason: ExposureOutcome["reason"]; detail: string } | null> {
    if (!SERIES[a.seriesKey]) {
      return {
        reason: "unknown_series",
        detail: `"${a.seriesKey}" is not a series this register knows, so nothing can be mapped to it.`,
      };
    }
    // The figure and its basis are one fact, and the database's own CHECK says
    // so. It is checked HERE too so the person reads a sentence rather than a
    // constraint name.
    if ((a.passThrough === null) !== (a.passThroughBasis === "unset")) {
      return {
        reason: "figure_without_a_basis",
        detail:
          "A pass-through figure states where it came from, and a basis with no figure states nothing. Either give a share and say whether the ISSUER published it or this HOUSE measured it, or leave both out — which is the honest common case, and the assistant then says the series moved and says it does not know how much of that reaches this item.",
      };
    }
    if ((a.lagDays === null) !== (a.lagBasis === "unset")) {
      return {
        reason: "figure_without_a_basis",
        detail:
          "A lag states where it came from, the same way a pass-through does. Either give the days and its basis, or leave both out.",
      };
    }

    // THE ITEM MUST BE THIS HOUSE'S. Taken from the authenticated principal and
    // never from the body: without this a manager could map another house's item.
    try {
      const { data, error } = await this.db.client
        .from("restaurant_inventory")
        .select("id, restaurant_id")
        .eq("id", a.houseItemId)
        .eq("restaurant_id", actor.restaurantId)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return {
          reason: "item_not_this_house",
          detail:
            "That item is not on this house's shelf, so no exposure was written. An exposure is a fact about one house's own item.",
        };
      }
    } catch (err) {
      return {
        reason: "unreadable",
        detail: `This house's items could not be read, so nothing was written and nothing is claimed either way: ${(err as Error).message}`,
      };
    }
    return null;
  }

  /**
   * Spend the seal and write the assertion.
   *
   * `redeem` throws a whole sentence naming what did not match, which is the
   * behaviour every other sealed act in this codebase relies on — so it is NOT
   * caught here and turned into a soft outcome. A refused seal must reach the
   * caller as a refusal.
   */
  async assert(
    actor: { userId: string; restaurantId: string },
    a: ExposureAssertion,
    challenge: string | null,
  ): Promise<ExposureOutcome> {
    const guard = await this.precheck(actor, a);
    if (guard) return { written: false, ...guard, exposureId: null };

    await this.seals.redeem({
      restaurantId: actor.restaurantId,
      actorUserId: actor.userId,
      subjectKind: "commodity_exposure",
      subjectId: a.houseItemId,
      action: EXPOSURE_ACTION,
      args: this.sealArgs(a),
      challenge,
    });

    let seriesId: string;
    try {
      const { data, error } = await this.db.client
        .from("commodity_index_series")
        .select("id, series_key")
        .eq("series_key", a.seriesKey)
        .maybeSingle();
      if (error) throw error;
      const row = data as Record<string, unknown> | null;
      if (!row) {
        return {
          written: false,
          reason: "series_not_registered",
          detail:
            "This series is declared in the registry and has no row in the register yet, so there is nothing to map to. A series is written by a fetch or an upload first.",
          exposureId: null,
        };
      }
      seriesId = String(row.id);
    } catch (err) {
      return {
        written: false,
        reason: "unreadable",
        detail: `The series register could not be read, so nothing was written: ${(err as Error).message}`,
        exposureId: null,
      };
    }

    try {
      const { data, error } = await this.db.client
        .from("house_item_commodity_exposure")
        .insert({
          restaurant_id: actor.restaurantId,
          house_item_id: a.houseItemId,
          series_id: seriesId,
          pass_through: a.passThrough,
          pass_through_basis: a.passThroughBasis,
          lag_days: a.lagDays,
          lag_basis: a.lagBasis,
          asserted_by: actor.userId,
          asserted_at: new Date().toISOString(),
          note: a.note,
        })
        .select("id")
        .single();
      if (error) throw error;
      return {
        written: true,
        reason: "asserted",
        detail:
          a.passThroughBasis === "unset"
            ? "Recorded. This house has never measured how much of a move in this series reaches this item's invoice, so no figure for that is given and the assistant will say so."
            : `Recorded, with a pass-through of ${((a.passThrough ?? 0) * 100).toFixed(1)}% on a ${a.passThroughBasis === "issuer_published" ? "figure the issuer published" : "measurement this house made"}.`,
        exposureId: String((data as { id: string }).id),
      };
    } catch (err) {
      const message = (err as Error).message;
      // 23505 is the partial UNIQUE on live exposures. Named rather than
      // reported as a generic failure, because "you already said this" and
      // "the write broke" are different facts and only one is the person's to act on.
      if (/duplicate key|23505/i.test(message)) {
        return {
          written: false,
          reason: "already_asserted",
          detail:
            "This item is already mapped to this series and the mapping is live. Retire the existing one before asserting a different pass-through — a mapping that changed is a new assertion, and the old one stays in the record.",
          exposureId: null,
        };
      }
      return {
        written: false,
        reason: "write_failed",
        detail: `The exposure was not written: ${message}. Nothing is claimed about this item's mapping.`,
        exposureId: null,
      };
    }
  }

  /**
   * Retire one, naming a person and a reason. RETIRED, NEVER DELETED — ADR
   * 0115's rule, and the reason is evidential: a mapping that was true and
   * stopped being true is the only record that an alert once had a basis.
   *
   * Not sealed. The seal guards the act that lets a rule speak about an item;
   * retiring is the direction that takes it away, and the same friction on the
   * off direction is how a wrong mapping stays live for another ten minutes.
   */
  async retire(
    actor: { userId: string; restaurantId: string },
    exposureId: string,
    reason: string,
  ): Promise<ExposureOutcome> {
    const said = (reason ?? "").trim();
    if (!said) {
      return {
        written: false,
        reason: "figure_without_a_basis",
        detail:
          "A retirement names a reason, or it is not a retirement — the record has to say why a mapping stopped being true.",
        exposureId: null,
      };
    }
    try {
      const { data, error } = await this.db.client
        .from("house_item_commodity_exposure")
        .update({
          retired_at: new Date().toISOString(),
          retired_by: actor.userId,
          retired_reason: said,
        })
        .eq("id", exposureId)
        // Scoped to the caller's own house, and to a LIVE row: retiring an
        // already-retired mapping would overwrite who retired it and when.
        .eq("restaurant_id", actor.restaurantId)
        .is("retired_at", null)
        .select("id");
      if (error) throw error;
      const rows = (data ?? []) as Array<{ id: string }>;
      if (rows.length === 0) {
        return {
          written: false,
          reason: "item_not_this_house",
          detail:
            "No live exposure of this house has that id, so nothing was retired. It may already be retired, which stays in the record rather than being changed again.",
          exposureId: null,
        };
      }
      return {
        written: true,
        reason: "retired",
        detail:
          "Retired, not deleted. The mapping stays in the record with your name and your reason on it, so an alert that once fired on it can still be accounted for.",
        exposureId: rows[0].id,
      };
    } catch (err) {
      return {
        written: false,
        reason: "write_failed",
        detail: `The exposure was not retired: ${(err as Error).message}. It may still be live.`,
        exposureId: null,
      };
    }
  }
}
