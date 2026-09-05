import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RecipientResolverService } from "../../communications/recipient-resolver.service";
import { UxOptimizerService } from "../../ux-optimizer/ux-optimizer.service";
import type { AdminExperimentReport } from "../../ux-optimizer/ux-optimizer.service";
import { EXPERIMENTS } from "../../ux-optimizer/experiments";
import {
  ProducerLedgerService,
  emptyTally,
  type ProducerAudience,
  type ProducerTally,
} from "./producer-ledger.service";
import { dayIn } from "./producer-copy";

/**
 * "The note experiment ended and no winner is recorded."
 *
 * WHY THIS PRODUCER EXISTS
 * ------------------------
 * ADR 0127's addendum gave `note_close_control` an end that arrives on its own:
 * one quarter after its first exposure, derived and frozen in
 * `ux_experiment_state`. That closed the question of WHEN it stops and opened a
 * new one, which the addendum filed against itself as a stated cost
 * (`dashboard.md` §13.23):
 *
 *     "Nothing raises its hand when the window closes. The end arrives on a
 *      date and no notification, no page and no log announces it; a founder who
 *      does not call the route does not learn that the experiment ended."
 *
 * The founder answered it on 2026-09-05 (batch 53): **a notification, to the
 * founder, when it ends unnamed**, carrying both arms' figures and the route
 * that names the winner. Rejected in the same breath: a line on `/admin/health`
 * (owner-gated, so the admin key would have to be forwarded server-side to a
 * page every house's owner can open), and doing nothing.
 *
 * WHAT MAKES IT DIFFERENT FROM THE OTHER EIGHT
 * --------------------------------------------
 * Every other producer sweeps ONE TENANT and reports that tenant's own facts.
 * This one reports a fact about the PRODUCT — an experiment spanning every
 * house — to one reader. Two consequences are built in rather than commented
 * around:
 *
 *   1. **It is not run inside `runPerTenant`.** Running it per tenant would put
 *      the same cross-house figures into every house's inbox, which is exactly
 *      the disclosure the both-arms route is gated to prevent. It runs once per
 *      fast sweep, against the deployment's `DEFAULT_RESTAURANT_ID` and nothing
 *      else. The method is called `sweepFounder`, not `sweepTenant`, so the
 *      difference is visible at every call site.
 *   2. **If `DEFAULT_RESTAURANT_ID` is unset it does not run at all.** It does
 *      not pick a house. An anchor nobody named is a guess, and a guess here
 *      delivers one tenant's product decision into another tenant's inbox.
 *
 * THE FIGURES ARE NOT RECOMPUTED HERE
 * -----------------------------------
 * It calls `UxOptimizerService.adminExperimentReport`, the same method the
 * admin route serves — the pattern `market-price.producer.ts` set when it
 * called `VendorComparisonService.belowTrailingAverage` "rather than repeating
 * its arithmetic, so the box and the book cannot disagree about the same
 * bottle". Two copies of the both-arms count would be two answers to the one
 * question the experiment exists to settle.
 *
 * A side effect worth naming: that method DERIVES and freezes the experiment's
 * window when it is knowable and unstored. So an armed sweep stamps the end
 * date even if the founder never reads the report, which is the better failure
 * mode — the window becomes real on a clock rather than on a page view.
 * Deriving is not deciding: nothing here or there picks an arm.
 *
 * IT NEVER NAMES A WINNER, AND IT NEVER IMPLIES ONE
 * -------------------------------------------------
 * The message prints both arms' integers, in the order the spec declares them,
 * with no percentage of one set beside the other, no arrow and no word like
 * "leading". ADR 0127 D10 is the rule and this is the surface most tempted to
 * break it: a notification that arrives saying "the die won" would settle by
 * announcement a question the founder reserved for themselves.
 */

const PRODUCER = "experiment_ended_unnamed";

/**
 * The env var that names the house this producer reports into. The SAME anchor
 * `RecipientResolverService` uses to decide whether the global MANAGER_EMAIL
 * fallback is allowed (see its `allowDefaultFallback` note and OD-87), so the
 * inbox this writes to and the address it resolves cannot drift apart.
 */
export const FOUNDER_HOUSE_ENV = "DEFAULT_RESTAURANT_ID";

@Injectable()
export class ExperimentEndedProducer {
  private readonly logger = new Logger(ExperimentEndedProducer.name);

  static readonly PRODUCER = PRODUCER;
  static readonly FOUNDER_HOUSE_ENV = FOUNDER_HOUSE_ENV;

  constructor(
    private readonly ux: UxOptimizerService,
    private readonly ledger: ProducerLedgerService,
    private readonly configService: ConfigService,
    private readonly recipients: RecipientResolverService,
  ) {}

  /** The house this producer reports into, or null when nobody named one. */
  founderHouseId(): string | null {
    const raw =
      this.configService.get<string>(FOUNDER_HOUSE_ENV) ??
      process.env[FOUNDER_HOUSE_ENV];
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    return trimmed.length > 0 ? trimmed : null;
  }

  /**
   * How many declared experiments have ended with no winner named.
   *
   * `null` means a read failed, and is NOT zero — the status row prints the
   * third state rather than reporting an unreadable register as a quiet one.
   */
  async endedUnnamedCount(): Promise<number | null> {
    try {
      let n = 0;
      for (const key of Object.keys(EXPERIMENTS)) {
        const report = await this.ux.adminExperimentReport(key);
        if (report.endedWithNoWinnerNamed) n += 1;
      }
      return n;
    } catch (e: any) {
      this.logger.warn(
        `EXPERIMENT_STATE_UNREADABLE — ${e?.message}. Whether an experiment has ended ` +
          "unnamed is unknown; reported as unknown rather than as none.",
      );
      return null;
    }
  }

  /**
   * One sweep, for the founder's house only.
   *
   * Deliberately NOT called `sweepTenant`. See the header: this reports a fact
   * about the product to one reader, not a fact about a house to that house.
   */
  async sweepFounder(
    founderHouseId: string,
    timeZone: string,
    audience: ProducerAudience,
    now: Date,
  ): Promise<ProducerTally> {
    const tally = emptyTally();
    const keys = Object.keys(EXPERIMENTS);

    if (keys.length === 0) {
      // Unreachable while any experiment is declared, and not silently forgiven
      // if it ever is: a producer with nothing to look at must say so rather
      // than report a clean sweep it never made.
      tally.withheldReason =
        "No experiment is declared in ux-optimizer/experiments.ts, so there is no window to watch.";
      return tally;
    }

    let ended = 0;
    for (const key of keys) {
      let report: AdminExperimentReport;
      try {
        // Reading this also derives and freezes the window when it is knowable
        // and unstored — see the header. A failure on ONE experiment must not
        // cost the others their sweep, so it is counted and the loop continues.
        report = await this.ux.adminExperimentReport(key);
      } catch (e: any) {
        tally.failed += 1;
        this.logger.warn(
          `EXPERIMENT_REPORT_UNREADABLE experiment=${key} — ${e?.message}. ` +
            "No notification was written for it; the next sweep tries again.",
        );
        continue;
      }

      if (!report.started) continue;
      if (!report.ended) continue;
      // A named winner is the end of this producer's interest. It speaks only
      // into the gap between the window closing and a person deciding.
      if (report.winnerArm !== null) continue;

      ended += 1;
      const address = await this.founderAddress(founderHouseId);
      const endsAt = report.endsAt ? new Date(report.endsAt) : now;

      await this.ledger.emit(
        { restaurantId: founderHouseId, producer: PRODUCER, audience, tally, now },
        {
          // DEDUPED ON THE EXPERIMENT KEY, so it fires once and not once per
          // sweep for the rest of the quarter. The claim index
          // (restaurant_id, producer, dedupe_key, user_id) is what enforces it;
          // this key is what makes the enforcement mean "this experiment's
          // ending", not "this tick".
          //
          // It carries no date and no count on purpose. A key with `endsAt` in
          // it would be stable too — but if the window were ever re-derived the
          // key would change and the notification would repeat, and the whole
          // point of the frozen row is that it cannot be. A key with the counts
          // in it would fire again on every new figure, which is a running
          // tally and not an ending.
          dedupeKey: `experiment:${key}:ended_unnamed`,
          // The moment the window CLOSED, not the moment this sweep noticed.
          // The inbox row's own created_at is the delivery time; every producer
          // here carries the real instant so the two are never confused.
          occurredAt: Number.isFinite(endsAt.getTime()) ? endsAt : now,
          payload: {
            type: "system_alert",
            title: `The ${key} experiment has ended with no winner named`,
            message: this.sentence(report, timeZone, address),
            // The product is running two faces until somebody decides, and the
            // decision is the founder's alone. Nothing else in this producer's
            // life is high.
            priority: "high",
            // No actionUrl. There is no page: naming the winner is a POST with
            // the admin key, and a link that opened something else would be a
            // control claiming an act it cannot perform (ADR 0083).
            metadata: {
              experimentKey: report.experimentKey,
              question: report.question,
              decidedOn: report.decidedOn,
              founderWords: report.founderWords,
              ratio: report.ratio,
              quarterDays: report.quarterDays,
              firstExposureAt: report.firstExposureAt,
              endsAt: report.endsAt,
              arms: report.arms,
              winnerArm: null,
              winnerRoute: `POST /ux/experiments/${key}/winner`,
              bothArmsRoute: `GET /ux/experiments/${key}/both-arms`,
              routesGate:
                "Both routes require the X-Admin-Key platform-admin service key (ADR 0099). Neither is reachable with a house token.",
              // The ADDRESS ITSELF IS NOT PUT IN THE ROW. It is written to the
              // log instead: this metadata is readable in an inbox, and a
              // personal address does not need to live in a database row to
              // answer the question the row is for. What the row carries is
              // whether the founder is reachable at all.
              founderAddressCount: address.count,
              founderAddressSource: address.source,
              // Stated in the payload so no reader has to infer them.
              houseIdentitiesWithheld: report.houseIdentitiesWithheld,
              abandonedIsAFloor: report.abandonedIsAFloor,
              timeZone,
            },
          },
        },
      );
    }

    if (ended === 0 && tally.withheldReason === null && tally.failed === 0) {
      tally.withheldReason =
        keys.length === 1
          ? `The ${keys[0]} experiment has not ended, or its winner is already named.`
          : "No declared experiment has ended with an unnamed winner.";
    }
    if (tally.emitted === 0 && ended > 0 && tally.withheldReason === null) {
      tally.withheldReason =
        "The ending had already been reported to every reader who could be claimed.";
    }

    return tally;
  }

  /**
   * Where the founder would be written to, resolved the way this codebase
   * already resolves a recipient.
   *
   * IT SENDS NOTHING. This producer writes a durable inbox row like the other
   * eight; no producer in this directory sends mail, and adding a send path
   * here would be a new outbound channel arriving as a side effect of a
   * measurement. What this call answers is narrower and worth answering: is
   * there an address at all, so that "the founder was notified" is not a claim
   * resting on an inbox nobody reads.
   *
   * `allowDefaultFallback` is left at its default (true) DELIBERATELY, and it is
   * safe here for the one reason OD-87 gives: the fallback names the default
   * restaurant's manager, and the restaurant being asked about IS the default
   * restaurant. That is the only query in this gateway for which the fallback
   * is not a cross-tenant leak.
   *
   * NEVER THROWS. A missing address degrades the sentence; it does not lose the
   * notification.
   */
  private async founderAddress(
    founderHouseId: string,
  ): Promise<{ count: number; source: string }> {
    const source =
      "RecipientResolverService manager query on DEFAULT_RESTAURANT_ID, with the global " +
      "MANAGER_EMAIL fallback allowed. Which of the two answered is not distinguishable " +
      "from its return value and is not claimed here.";
    try {
      const resolved = await this.recipients.resolveRecipients({
        restaurantId: founderHouseId,
        roles: ["manager"],
        channels: ["email"],
      });
      const count = resolved.emails.length;
      this.logger.log(
        `EXPERIMENT_ENDED_RECIPIENT house=${founderHouseId} addresses=${count}` +
          (count > 0 ? ` to=${resolved.emails.join(",")}` : "") +
          " — resolved for the record only; this producer writes an inbox row and sends no mail.",
      );
      return { count, source };
    } catch (e: any) {
      this.logger.warn(
        `EXPERIMENT_ENDED_RECIPIENT_UNRESOLVED house=${founderHouseId} — ${e?.message}. ` +
          "The notification is still written; the row says the address could not be resolved.",
      );
      return {
        count: 0,
        source: `${source} This lookup FAILED (${e?.message ?? "unknown error"}), so no address is known.`,
      };
    }
  }

  /**
   * The sentence. Counts, both arms, no verdict.
   *
   * Plain text and no emoji, which is a rule this directory enforces by scan
   * (`notifications/notification-text-is-plain.spec.ts`) and not by habit.
   */
  private sentence(
    report: AdminExperimentReport,
    timeZone: string,
    address: { count: number; source: string },
  ): string {
    const parts: string[] = [];

    parts.push(
      `The ${report.experimentKey} experiment closed on ` +
        `${report.endsAt ? dayIn(new Date(report.endsAt), timeZone) : "its stated date"}` +
        `, one quarter (${report.quarterDays} days) after its first exposure` +
        `${report.firstExposureAt ? ` on ${dayIn(new Date(report.firstExposureAt), timeZone)}` : ""}.`,
    );

    parts.push(`The question was: ${report.question}`);

    for (const arm of report.arms) {
      parts.push(
        `Arm ${arm.arm} (${arm.sharePct} per cent): ` +
          `${arm.housesAssigned} ${arm.housesAssigned === 1 ? "house" : "houses"}, ` +
          `${arm.exposures} shown, ${arm.completed} closed, ${arm.abandoned} left standing.`,
      );
    }

    parts.push(
      "These are counts and not a verdict. No arm is called the winner here, " +
        "and none is assumed: the arm every house gets from now on is the one you name.",
    );

    parts.push(
      "Every abandon figure is a floor. A tab closed outright records nothing, " +
        "and nothing at all is recorded while a house's arm cannot be read or after the " +
        "window closes. Both arms lose the same cases.",
    );

    parts.push(
      `To name it: POST /ux/experiments/${report.experimentKey}/winner with the arm and, ` +
        "if you want it kept beside the decision, your own words. " +
        `The figures above come from GET /ux/experiments/${report.experimentKey}/both-arms. ` +
        "Both need the X-Admin-Key service key; neither is reachable from a house session, " +
        "and there is no page for either, which is why this arrives as a notification.",
    );

    parts.push(
      address.count > 0
        ? `Your address resolves (${address.count} on file), though this notice itself was written to your inbox and not emailed.`
        : "No address resolves for you on this deployment, so this notice exists only in your inbox.",
    );

    return parts.join(" ");
  }
}
