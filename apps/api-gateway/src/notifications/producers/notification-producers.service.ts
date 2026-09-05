import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import { GoalsService } from "../../analytics/goals.service";
import { ScheduledTenantsService } from "../../communications/scheduled-tenants.service";
import type { ScheduledTenant } from "../../communications/scheduled-tenants.service";
import {
  isKnownTimeZone,
  nextTickAfter,
  wallMinutesIn,
} from "../../calendar/reminder-window";
import {
  ProducerLedgerService,
  type ProducerTally,
} from "./producer-ledger.service";
import { GoalReachedProducer } from "./goal-reached.producer";
import { CeilingHeldProducer } from "./ceiling-held.producer";
import { DeliveryRecordedProducer } from "./delivery-recorded.producer";
import { InvoiceConfirmedProducer } from "./invoice-confirmed.producer";
import { SaleRecordProducer } from "./sale-record.producer";
import { MarketPriceProducer } from "./market-price.producer";
import {
  PRODUCER_CLOCK,
  SYSTEM_CLOCK,
  type ProducerClock,
} from "./producer-clock";
import { GrantSuspendedProducer } from "./grant-suspended.producer";
import { AddedToolProducer } from "./added-tool.producer";
import { ExperimentEndedProducer } from "./experiment-ended.producer";

/**
 * The nine notification producers, and the two crons that run them.
 *
 * WHAT THIS FILE OWNS
 * -------------------
 * Scheduling, tenancy, arming, and the honest account of all three. The
 * producers themselves decide only what happened; `ProducerLedgerService`
 * decides whether it may be said; this decides when anybody looks.
 *
 * OFF BY DEFAULT, AND NOT WIRED TO A DESIGN FLAG
 * ----------------------------------------------
 * These write real rows into real members' inboxes and push them to real
 * phones. `NOTIFICATION_PRODUCERS_ENABLED` is the single env var that arms
 * them, allow-list style — only "true" or "1" — because a typo in an allow-list
 * is silence and a typo in a deny-list is a live sender, and silence is the
 * recoverable failure. Same shape and same reasoning as
 * `CALENDAR_REMINDERS_ENABLED` (calendar/reminder-window.ts:283-300) and
 * `RECURRING_ORDER_REMINDERS_ENABLED` before it. The page's Mudavym design flag
 * decides what a page LOOKS like and must never turn a sender on as a side
 * effect.
 *
 * TWO CADENCES, BECAUSE THE FIVE ARE NOT ONE KIND OF THING
 * -------------------------------------------------------
 * - **Fast, every 15 minutes.** Goal reached, ceiling held, delivery at the door,
 *   invoice certified, a tool grant suspended. These are events with a reader
 *   who may need to act while the truck is still outside, or a period that
 *   closed at local midnight and should not be reported a day late. The grant
 *   suspension joins them (founder, 2026-09-04) because a permission the house
 *   did not change is already being refused by the time anybody reads it.
 * - **Daily, checked hourly.** The service record and the market signal. The
 *   service record cannot be written before its day is settled (see
 *   `service-day.ts`) and the hourly tick is what lets each tenant's own local
 *   settle time be honoured without a per-tenant cron. The market signal is
 *   evaluated once a day on the tenant's wall clock, at
 *   `MARKET_SIGNAL_LOCAL_HOUR` (default 10) — a stated default, not a derived
 *   one, chosen so a price lands before the day's ordering rather than after it.
 *
 * PER TENANT, ISOLATED, AND THE RUN IS RECORDED
 * ---------------------------------------------
 * Both crons go through `ScheduledTenantsService.runPerTenant` (ADR 0022), so
 * only opted-in restaurants are served, one tenant's failure never costs another
 * its run, and every run logs `SCHEDULED_JOB_SUMMARY`. Each producer opens and
 * closes its own `notification_producer_runs` row per tenant per sweep, because
 * a page that says "the house is quiet" while this process has been down for a
 * day is the exact fault ADR 0020 names.
 */

const FAST_CRON = "*/15 * * * *";
const FAST_JOB = "notification-producers-fast";
const FAST_INTERVAL_MINUTES = 15;

const DAILY_CRON = "0 * * * *";
const DAILY_JOB = "notification-producers-daily";
const DAILY_INTERVAL_MINUTES = 60;

export const PRODUCERS_FLAG = "NOTIFICATION_PRODUCERS_ENABLED";

/** Only `"true"` and `"1"` (trimmed, lower-cased) arm it. Everything else is OFF. */
export function producersArmed(raw?: string | null): boolean {
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "1";
}

/** The hour, on the tenant's wall clock, the market signal is evaluated. */
export const MARKET_SIGNAL_LOCAL_HOUR_ENV = "MARKET_SIGNAL_LOCAL_HOUR";
export const DEFAULT_MARKET_SIGNAL_LOCAL_HOUR = 10;

export interface ProducerStatus {
  producer: string;
  cron: string;
  intervalMinutes: number;
  /** The scheduled next tick. A schedule is not evidence a process is alive. */
  nextTickAt: string;
  /** `null` means this producer has never run for this restaurant. */
  lastRun: any | null;
  /** `null` when the run ledger could not be read — not "never run". */
  lastRunUnreadable: string | null;
  /**
   * Would this producer write anything on its next tick, as far as we can tell?
   *
   * `true` = armed, served, and its source can supply it. `false` = it will
   * stay silent, and `silentReason` says why in the operator's own words.
   * `null` = we could not determine it (a source read failed), which is a third
   * state and not a quiet yes.
   */
  willWrite: boolean | null;
  silentReason: string | null;
}

export interface ProducersStatus {
  restaurantId: string;
  armed: boolean;
  armedBy: string;
  /**
   * Whether the scheduler enumerates this restaurant at all. `false` carries a
   * reason; `null` means the opt-in register could not be read and the page says
   * that rather than guessing.
   */
  served: boolean | null;
  servedReason: string | null;
  timeZone: string | null;
  /**
   * What the one switch does, in words. There is exactly one and it arms ALL of
   * them — the founder's call on 2026-09-03 ("arm all five"; the ceiling
   * producer added the same day made six, and the grant-suspension producer of
   * 2026-09-04 makes seven). A per-producer switch was rejected:
   * seven env vars is seven ways to have half a house watched and no way to
   * see it.
   */
  armingNote: string;
  producers: ProducerStatus[];
  generatedAt: string;
}

@Injectable()
export class NotificationProducersService {
  private readonly logger = new Logger(NotificationProducersService.name);

  static readonly FAST_JOB = FAST_JOB;
  static readonly DAILY_JOB = DAILY_JOB;
  static readonly FAST_CRON = FAST_CRON;
  static readonly DAILY_CRON = DAILY_CRON;
  static readonly FAST_INTERVAL_MINUTES = FAST_INTERVAL_MINUTES;
  static readonly DAILY_INTERVAL_MINUTES = DAILY_INTERVAL_MINUTES;

  private readonly clock: ProducerClock;

  constructor(
    private readonly configService: ConfigService,
    private readonly tenants: ScheduledTenantsService,
    private readonly ledger: ProducerLedgerService,
    private readonly goals: GoalsService,
    private readonly goalReached: GoalReachedProducer,
    private readonly ceilingHeld: CeilingHeldProducer,
    private readonly deliveryRecorded: DeliveryRecordedProducer,
    private readonly invoiceConfirmed: InvoiceConfirmedProducer,
    private readonly saleRecord: SaleRecordProducer,
    private readonly marketPrice: MarketPriceProducer,
    private readonly grantSuspended: GrantSuspendedProducer,
    private readonly addedTool: AddedToolProducer,
    // The ninth. It is NOT run per tenant — see `runFounderSweep` and the
    // producer's own header. It reports a fact about the product to one reader.
    private readonly experimentEnded: ExperimentEndedProducer,
    // Optional for the same reason the ledger's is: the spec constructs this
    // service positionally, and production keeps the wall clock.
    @Optional() @Inject(PRODUCER_CLOCK) clock?: ProducerClock,
  ) {
    this.clock = clock ?? SYSTEM_CLOCK;
  }

  armed(): boolean {
    return producersArmed(
      this.configService.get<string>(PRODUCERS_FLAG) ??
        process.env[PRODUCERS_FLAG],
    );
  }

  private marketHour(): number {
    const raw =
      this.configService.get<string>(MARKET_SIGNAL_LOCAL_HOUR_ENV) ??
      process.env[MARKET_SIGNAL_LOCAL_HOUR_ENV];
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= 23
      ? n
      : DEFAULT_MARKET_SIGNAL_LOCAL_HOUR;
  }

  // ==========================================================================
  // THE CRONS
  // ==========================================================================

  @Cron(FAST_CRON, { name: FAST_JOB })
  async sweepFast(): Promise<void> {
    if (!this.disarmedNotice(FAST_JOB)) return;
    const at = this.clock.now();
    await this.tenants.runPerTenant(FAST_JOB, async (tenant) => {
      await this.runFastForTenant(tenant, at);
    });
    // OUTSIDE the per-tenant loop, and once. The experiment-ended producer
    // reports cross-house figures to one reader; running it inside the loop
    // would put them in every house's inbox, which is the exact disclosure the
    // both-arms route is gated to prevent. Its own failure must not look like a
    // tenant's, so it is caught here rather than left to `runPerTenant`.
    try {
      await this.runFounderSweep(at);
    } catch (error: any) {
      this.logger.error(
        `NOTIFICATION_PRODUCER_FOUNDER_SWEEP_FAILED — ${error?.message}. ` +
          "The per-tenant producers in this sweep already ran and are unaffected.",
      );
    }
  }

  @Cron(DAILY_CRON, { name: DAILY_JOB })
  async sweepDaily(): Promise<void> {
    if (!this.disarmedNotice(DAILY_JOB)) return;
    const at = this.clock.now();
    await this.tenants.runPerTenant(DAILY_JOB, async (tenant) => {
      await this.runDailyForTenant(tenant, at);
    });
  }

  /** True when armed. Logs the disarmed case rather than returning silently. */
  private disarmedNotice(job: string): boolean {
    if (this.armed()) return true;
    this.logger.log(
      `${job} skipped — ${PRODUCERS_FLAG} is not set. These producers are off by ` +
        "default and write nothing until armed. The page reports this as 'built " +
        "but not armed', not as 'nothing happened'.",
    );
    return false;
  }

  // ==========================================================================
  // ONE TENANT
  // ==========================================================================

  /** Public so a spec can drive it with a fixed clock. */
  async runFastForTenant(
    tenant: ScheduledTenant,
    now: Date = this.clock.now(),
  ): Promise<Record<string, ProducerTally>> {
    const timeZone = this.zoneOf(tenant);
    const audience = await this.ledger.audienceFor(tenant.id, timeZone, now);

    return {
      [GoalReachedProducer.PRODUCER]: await this.runOne(
        tenant.id,
        GoalReachedProducer.PRODUCER,
        now,
        () => this.goalReached.sweepTenant(tenant.id, timeZone, audience, now),
      ),
      [CeilingHeldProducer.PRODUCER]: await this.runOne(
        tenant.id,
        CeilingHeldProducer.PRODUCER,
        now,
        () => this.ceilingHeld.sweepTenant(tenant.id, timeZone, audience, now),
      ),
      [DeliveryRecordedProducer.PRODUCER]: await this.runOne(
        tenant.id,
        DeliveryRecordedProducer.PRODUCER,
        now,
        () =>
          this.deliveryRecorded.sweepTenant(tenant.id, timeZone, audience, now),
      ),
      [InvoiceConfirmedProducer.PRODUCER]: await this.runOne(
        tenant.id,
        InvoiceConfirmedProducer.PRODUCER,
        now,
        () =>
          this.invoiceConfirmed.sweepTenant(tenant.id, timeZone, audience, now),
      ),
      // Narrows the audience it is handed to owners and managers itself — the
      // only producer that does, and the reason is in its own header.
      [GrantSuspendedProducer.PRODUCER]: await this.runOne(
        tenant.id,
        GrantSuspendedProducer.PRODUCER,
        now,
        () =>
          this.grantSuspended.sweepTenant(tenant.id, timeZone, audience, now),
      ),
      [AddedToolProducer.PRODUCER]: await this.runOne(
        tenant.id,
        AddedToolProducer.PRODUCER,
        now,
        () => this.addedTool.sweepTenant(tenant.id, timeZone, audience, now),
      ),
    };
  }

  /** Public so a spec can drive it with a fixed clock. */
  async runDailyForTenant(
    tenant: ScheduledTenant,
    now: Date = this.clock.now(),
  ): Promise<Record<string, ProducerTally>> {
    const timeZone = this.zoneOf(tenant);
    const audience = await this.ledger.audienceFor(tenant.id, timeZone, now);
    const out: Record<string, ProducerTally> = {};

    // `posConnected` is asked of the one place that decides it. It THROWS on a
    // failed probe rather than answering false — `hasPosHistory`, reached
    // through `getPosRevenueWindow`, both in `analytics/goals.service.ts`
    // (grep the names; no line number, that file is under concurrent edit and
    // moved twice during this session) — so a
    // broken query cannot be reported to a restaurant as "no POS connected".
    const pos = await this.goals.getPosRevenueWindow(tenant.id, 1);

    out[SaleRecordProducer.PRODUCER] = await this.runOne(
      tenant.id,
      SaleRecordProducer.PRODUCER,
      now,
      () =>
        this.saleRecord.sweepTenant(
          tenant.id,
          timeZone,
          audience,
          now,
          pos.posConnected,
        ),
    );

    // The market signal is a once-a-day evaluation on the tenant's own clock.
    // Outside its hour the producer is not run at all, and no run row is opened
    // — an hourly row saying "considered 0" would drown the one that matters.
    const hour = Math.floor(wallMinutesIn(now, timeZone) / 60);
    if (hour === this.marketHour()) {
      out[MarketPriceProducer.PRODUCER] = await this.runOne(
        tenant.id,
        MarketPriceProducer.PRODUCER,
        now,
        () => this.marketPrice.sweepTenant(tenant.id, timeZone, audience, now),
      );
    }

    return out;
  }

  // ==========================================================================
  // THE ONE THAT IS NOT A TENANT
  // ==========================================================================

  /**
   * The experiment-ended sweep. One house, named by env, or nothing.
   *
   * Returns `null` when it did not run, and that is a different answer from a
   * tally of zero: `null` means nobody named the house this reports into, so no
   * run row is opened and no claim is taken. It does NOT fall back to a
   * restaurant of its own choosing — an anchor nobody named is a guess, and a
   * guess delivers one tenant's product decision into another tenant's inbox.
   *
   * Public so a spec can drive it with a fixed clock.
   */
  async runFounderSweep(
    now: Date = this.clock.now(),
  ): Promise<ProducerTally | null> {
    const houseId = this.experimentEnded.founderHouseId();
    if (!houseId) {
      this.logger.log(
        `${ExperimentEndedProducer.PRODUCER} skipped — ` +
          `${ExperimentEndedProducer.FOUNDER_HOUSE_ENV} is not set on this deployment, ` +
          "so there is no inbox this producer may write to. It does not choose one.",
      );
      return null;
    }

    // Only for the sentence's dates and for quiet hours. A house the scheduler
    // does not enumerate still gets this producer — it is the founder's inbox,
    // not a served tenant's — so an unknown zone degrades the wording rather
    // than cancelling the notice.
    let timeZone = "UTC";
    try {
      const mine = (await this.tenants.list()).find((t) => t.id === houseId);
      if (mine) timeZone = this.zoneOf(mine);
      else
        this.logger.warn(
          `${ExperimentEndedProducer.PRODUCER} house=${houseId} is not enumerated by the ` +
            "scheduler; using UTC for the dates in the notice. The notice is still written.",
        );
    } catch (e: any) {
      this.logger.warn(
        `${ExperimentEndedProducer.PRODUCER} could not read the tenant register (${e?.message}); ` +
          "using UTC for the dates in the notice.",
      );
    }

    // `audienceFor` is inside the run body on purpose: it throws on a failed
    // read, and a throw outside `runOne` would leave no run row saying why the
    // sweep produced nothing.
    return this.runOne(houseId, ExperimentEndedProducer.PRODUCER, now, async () => {
      const audience = await this.ledger.audienceFor(houseId, timeZone, now);
      return this.experimentEnded.sweepFounder(houseId, timeZone, audience, now);
    });
  }

  /**
   * Open a run row, run the producer, close the row — whatever happens.
   *
   * A throw is re-thrown after the row is closed with its message, so
   * `runPerTenant` still records `SCHEDULED_JOB_TENANT_FAILED` and the other
   * producers in the same sweep are unaffected: each `runOne` is awaited
   * separately and one failing does not cancel the ones already done.
   */
  private async runOne(
    restaurantId: string,
    producer: string,
    now: Date,
    body: () => Promise<ProducerTally>,
  ): Promise<ProducerTally> {
    const runId = await this.ledger.openRun(restaurantId, producer, now);
    try {
      const tally = await body();
      await this.ledger.closeRun(runId, tally, this.clock.now(), null);
      return tally;
    } catch (error: any) {
      const tally: ProducerTally = {
        considered: 0,
        emitted: 0,
        deferredQuietHours: 0,
        alreadyClaimed: 0,
        failed: 1,
        truncated: false,
        withheldReason: null,
      };
      await this.ledger.closeRun(
        runId,
        tally,
        this.clock.now(),
        error?.message ?? "unknown",
      );
      this.logger.error(
        `NOTIFICATION_PRODUCER_FAILED restaurant=${restaurantId} producer=${producer} — ` +
          `${error?.message}. The run row carries the error; the other producers in ` +
          "this sweep are unaffected.",
      );
      return tally;
    }
  }

  private zoneOf(tenant: ScheduledTenant): string {
    if (isKnownTimeZone(tenant.timezone)) return tenant.timezone;
    this.logger.error(
      `NOTIFICATION_PRODUCER_TIMEZONE_UNKNOWN restaurant=${tenant.id} ` +
        `timezone=${JSON.stringify(tenant.timezone)} — falling back to UTC. ` +
        "Quiet hours and service days for this house will be wrong until the column is fixed.",
    );
    return "UTC";
  }

  // ==========================================================================
  // WHAT THE PAGE IS ALLOWED TO SAY
  // ==========================================================================

  /**
   * Everything `/notifications` needs to describe these producers truthfully.
   *
   * The load-bearing fields are `armed` and `served`. Off, or not enumerated by
   * the scheduler, and this restaurant gets nothing at all — a page that drew a
   * next-run time over either would be promising a run that will not happen.
   */
  async statusFor(
    restaurantId: string,
    now: Date = this.clock.now(),
  ): Promise<ProducersStatus> {
    let served: boolean | null = null;
    let servedReason: string | null = null;
    let timeZone: string | null = null;
    try {
      const tenants = await this.tenants.list();
      const mine = tenants.find((t) => t.id === restaurantId);
      served = !!mine;
      timeZone = mine?.timezone ?? null;
      if (!mine) {
        servedReason =
          "This restaurant is not enumerated by the scheduler, so these producers do " +
          "not run for it. It is opted in with one row in restaurant_feature_flags " +
          `(flag_name = '${ScheduledTenantsService.OPT_IN_FLAG}', enabled = true).`;
      }
    } catch (e: any) {
      served = null;
      servedReason = `The opt-in register could not be read (${e?.message ?? "unknown error"}), so whether these producers serve this restaurant is unknown.`;
    }

    const rows: Array<[string, string, number]> = [
      [GoalReachedProducer.PRODUCER, FAST_CRON, FAST_INTERVAL_MINUTES],
      [CeilingHeldProducer.PRODUCER, FAST_CRON, FAST_INTERVAL_MINUTES],
      [DeliveryRecordedProducer.PRODUCER, FAST_CRON, FAST_INTERVAL_MINUTES],
      [InvoiceConfirmedProducer.PRODUCER, FAST_CRON, FAST_INTERVAL_MINUTES],
      [GrantSuspendedProducer.PRODUCER, FAST_CRON, FAST_INTERVAL_MINUTES],
      [AddedToolProducer.PRODUCER, FAST_CRON, FAST_INTERVAL_MINUTES],
      [ExperimentEndedProducer.PRODUCER, FAST_CRON, FAST_INTERVAL_MINUTES],
      [SaleRecordProducer.PRODUCER, DAILY_CRON, DAILY_INTERVAL_MINUTES],
      [MarketPriceProducer.PRODUCER, DAILY_CRON, DAILY_INTERVAL_MINUTES],
    ];

    const armed = this.armed();

    // The one source-level silence we can see from here without running a
    // sweep. Measured rather than assumed: `vendor_price_observations` held
    // zero rows on 2026-09-03, so the market producer would be armed, served
    // and mute, and a page that only said "armed" would be lying by omission.
    let marketSightings: number | null = null;
    let declaredServers: number | null = null;
    if (armed && served !== false) {
      marketSightings = await this.marketPrice.visibleObservationCount(
        restaurantId,
        now,
      );
      declaredServers = await this.addedTool.watchedServerCount(restaurantId);
    }

    // The same shape for the seventh: a house whose servers have moved under
    // nothing has no suspension to report, and that silence is a fact rather
    // than a fault. `null` is a failed read and is reported as one.
    let suspendedGrants: number | null = null;
    if (armed && served !== false) {
      suspendedGrants =
        await this.grantSuspended.suspendedGrantCount(restaurantId);
    }

    // The ninth producer is not decided by the two questions above. It does not
    // run through `runPerTenant`, so the opt-in register does not gate it, and
    // it writes into exactly one house named by env.
    const founderHouse = this.experimentEnded.founderHouseId();
    let endedUnnamed: number | null = null;
    if (armed && founderHouse !== null && founderHouse === restaurantId) {
      endedUnnamed = await this.experimentEnded.endedUnnamedCount();
    }

    const producers: ProducerStatus[] = [];
    for (const [producer, cron, interval] of rows) {
      let lastRun: any | null = null;
      let unreadable: string | null = null;
      try {
        lastRun = await this.ledger.lastRun(restaurantId, producer);
      } catch (e: any) {
        // Distinct from "never run": the page must not report a read failure as
        // a producer that has been idle.
        unreadable = e?.message ?? "unknown error";
      }

      let willWrite: boolean | null = true;
      let silentReason: string | null = null;
      if (!armed) {
        willWrite = false;
        silentReason =
          `${PRODUCERS_FLAG} is not set on this deployment. Setting it to "true" arms ` +
          `all ${rows.length} producers at once — there is no per-producer switch.`;
      } else if (producer === ExperimentEndedProducer.PRODUCER) {
        // AHEAD OF THE `served` BRANCHES ON PURPOSE. This producer runs outside
        // `runPerTenant`, so whether the scheduler enumerates this restaurant
        // does not decide whether it speaks — saying it did would be a true
        // sentence about the other eight printed against the one it is false
        // for. What decides is DEFAULT_RESTAURANT_ID.
        if (founderHouse === null) {
          willWrite = false;
          silentReason =
            `${ExperimentEndedProducer.FOUNDER_HOUSE_ENV} is not set on this deployment, so this ` +
            "producer has no inbox to write to. It does not choose one.";
        } else if (founderHouse !== restaurantId) {
          willWrite = false;
          silentReason =
            "This producer reports a cross-house experiment to one reader and writes only into " +
            `the house named by ${ExperimentEndedProducer.FOUNDER_HOUSE_ENV}, which is not this one. ` +
            "It is not silent here because anything failed.";
        } else if (endedUnnamed === null) {
          willWrite = null;
          silentReason =
            "The experiment register could not be read, so whether an experiment has ended " +
            "with no winner named is unknown.";
        } else if (endedUnnamed === 0) {
          willWrite = false;
          silentReason =
            "No declared experiment has ended with an unnamed winner. It speaks once a window " +
            "closes — one quarter after that experiment's first exposure — and stops as soon as " +
            "a winner is named (ADR 0127).";
        }
      } else if (served === false) {
        willWrite = false;
        silentReason =
          servedReason ??
          "The scheduler does not enumerate this restaurant, so no producer runs for it.";
      } else if (served === null) {
        willWrite = null;
        silentReason = servedReason;
      } else if (producer === GrantSuspendedProducer.PRODUCER) {
        if (suspendedGrants === null) {
          willWrite = null;
          silentReason =
            "The tool-grant register could not be read, so whether this house has a " +
            "suspended grant is unknown.";
        } else if (suspendedGrants === 0) {
          willWrite = false;
          silentReason =
            "No tool grant on this house's model-context servers is suspended, so this " +
            "producer will stay silent even though it is armed. It speaks when a probe " +
            "finds that a server changed or withdrew a tool a manager had granted.";
        }
      } else if (producer === AddedToolProducer.PRODUCER) {
        if (declaredServers === null) {
          willWrite = null;
          silentReason =
            "The connections register could not be read, so whether this producer has a server to watch is unknown.";
        } else if (declaredServers === 0) {
          willWrite = false;
          silentReason =
            "This house has declared no model-context server, so no server can offer it a new tool. " +
            "It speaks the first time a declared server's probe lists a tool it was not listing before.";
        }
      } else if (producer === MarketPriceProducer.PRODUCER) {
        if (marketSightings === null) {
          willWrite = null;
          silentReason =
            "The price register could not be read, so whether this producer has anything to compare is unknown.";
        } else if (marketSightings === 0) {
          willWrite = false;
          silentReason =
            "The price register holds no sighting this restaurant can see in the last 30 days, so this producer " +
            "will stay silent even though it is armed. It speaks once a price is recorded — by a scrape " +
            "(POST /vendor-intel/scrape) or by hand (POST /vendor-intel/observations).";
        }
      }

      producers.push({
        producer,
        cron,
        intervalMinutes: interval,
        nextTickAt: nextTickAfter(now, interval).toISOString(),
        lastRun,
        lastRunUnreadable: unreadable,
        willWrite,
        silentReason,
      });
    }

    return {
      restaurantId,
      armed,
      armedBy: PRODUCERS_FLAG,
      served,
      servedReason,
      timeZone,
      armingNote:
        `${PRODUCERS_FLAG} is the only switch and it arms all ${rows.length} producers ` +
        "for this deployment at once. It is deliberately not wired to the page's design " +
        "flag: a design flag decides what a page looks like, never whether a house gets " +
        "woken up. Which restaurants are then served is a separate question — see `served`.",
      producers,
      generatedAt: now.toISOString(),
    };
  }
}
