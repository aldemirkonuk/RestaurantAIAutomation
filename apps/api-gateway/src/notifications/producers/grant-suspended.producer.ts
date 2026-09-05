import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import {
  ProducerLedgerService,
  emptyTally,
  type ProducerAudience,
  type ProducerTally,
} from "./producer-ledger.service";
import { clockIn, dayIn } from "./producer-copy";
import type { McpToolSummary } from "../../mcp-runtime/mcp-runtime.types";
import { fingerprintToolList } from "../../mcp-runtime/tool-classification";

/**
 * "A server moved under a grant, and the grant is suspended until a manager
 * re-consents."
 *
 * THE EVENT, AND WHO STAMPS IT
 * ----------------------------
 * `McpConnectionsService.reconcileGrants` (mcp-connections.service.ts:720-798)
 * runs from exactly one place — `writeProbe` (:1582), the single point a fresh
 * `tools/list` lands. It compares every live grant against that list and writes
 * one of two outcomes onto `public.mcp_tool_grants`:
 *
 *   * the tool is GONE — `revoked_at` and `needs_reconsent_at` are both stamped
 *     (:756-763), because a grant naming a tool the server no longer offers is
 *     a permission with no subject;
 *   * the tool's DECLARATION MOVED — only `needs_reconsent_at` is stamped
 *     (:785-791), and `needs_reconsent_reason` carries
 *     `describeAnnotationChange`'s words ("the server changed readOnlyHint true
 *     to false"), never a hash mismatch.
 *
 * Both are permission changes that happened without anybody in the house
 * asking for one, and both make a tool the gate now refuses. The founder's call
 * on 2026-09-04 was "yes, one notification per suspension". This producer is
 * that one notification.
 *
 * WHY IT SWEEPS INSTEAD OF BEING CALLED FROM `reconcileGrants`
 * -----------------------------------------------------------
 * The brief allowed an event-driven emit "if the ledger supports an immediate
 * emit". It does not, and the gap is not small:
 *
 *   1. `ProducerLedgerService.emit` needs a `ProducerAudience` — the awake/
 *      asleep split for the whole house on the house's own wall clock
 *      (`audienceFor`, producer-ledger.service.ts:160-178) — and it needs the
 *      tenant's IANA zone to compute it. `reconcileGrants` has a
 *      `connectionId` and nothing else; it does not even read `restaurant_id`.
 *   2. Quiet hours are a DEFERRAL, not a drop: a member inside their window is
 *      deliberately left unclaimed so a LATER SWEEP serves them
 *      (producer-ledger.service.ts:41-49). An emit with no later sweep behind
 *      it would silently lose every manager who was asleep at probe time —
 *      which is precisely the hour an unattended probe runs.
 *   3. `emit` does not open or close a `notification_producer_runs` row; the
 *      caller does (`runOne`, notification-producers.service.ts:303-337). An
 *      emit from inside a probe would write inbox rows that no run ledger
 *      accounts for, and `/notifications` would show a producer that has never
 *      run while its notifications arrive.
 *
 * So the suspension is DURABLE STATE — `needs_reconsent_at` stays set until a
 * manager grants the tool again — and a sweep over durable state is the shape
 * the other six already have. It rides the FAST cron (every 15 minutes): a
 * refused permission is something a manager needs while they are still at the
 * terminal it broke, not tomorrow morning.
 *
 * SAYING IT ONCE, AND SAYING IT AGAIN WHEN IT HAPPENS AGAIN
 * --------------------------------------------------------
 * The dedupe key is `grant:<grantId>:<toolListHash>`, where the hash is the
 * grant's OWN `tool_list_hash` — what the server's whole list looked like at
 * the moment a manager agreed to it. Two properties fall out of that, and both
 * are tested:
 *
 *   * the same suspension can never be written twice, on any number of sweeps,
 *     because neither half of the key moves while the grant sits suspended
 *     (`reconcileGrants` leaves an already-suspended grant alone, :772 — a
 *     flapping server cannot re-fire this either);
 *   * a re-consent followed by a fresh change DOES write again, because
 *     `grantTool` is revoke-then-insert (mcp-connections.service.ts:648-651):
 *     the new grant is a new row with a new id AND a new list hash.
 *
 * MANAGERS AND OWNERS ONLY, AND WHY THAT NEEDED A NEW READ
 * -------------------------------------------------------
 * The other six producers take the audience `NotificationProducersService`
 * built for the whole house. There is no role-narrowed audience in this family
 * — `ProducerLedgerService.audienceFor` calls
 * `DatabaseService.getRestaurantMemberIds` (database.service.ts:70-90), which
 * is every active member regardless of role. So this producer resolves the
 * roles itself, through `user_restaurant_access` with `role IN ('owner',
 * 'manager')` and `is_active = true` — the same table, the same shape and the
 * same two roles `RecipientResolverService.getUserIdsForRoles`
 * (communications/recipient-resolver.service.ts:205-217) already uses, and the
 * three values `user_restaurant_access_role_known` permits
 * (20260902200000_team_access_role_is_a_known_role.sql:61-64; verified against
 * production 2026-09-02, only `owner` and `manager` exist).
 *
 * It then INTERSECTS that set with the audience it was handed rather than
 * writing to it directly, so the quiet-hours split still decides delivery and a
 * manager who is not an active member of this house cannot be reached through
 * a role row alone.
 *
 * A failed role read THROWS. Falling back to the whole house would tell every
 * member of staff which tools a server may call, and falling back to nobody
 * would be a permission change reported to no one — the exact
 * absence-as-health fault. `runOne` records the throw on the run row and the
 * next tick tries again; the suspension is durable and does not expire.
 *
 * WHAT THIS PRODUCER CANNOT SAY
 * -----------------------------
 * A tool being ADDED to a server is not reported here, because it does not
 * suspend anything: `reconcileGrants` deliberately compares per-tool
 * fingerprints so "a server adding an unrelated tool must not suspend a grant
 * nobody touched" (tool-classification.ts:172-176). There is no row to sweep,
 * and inventing one would mean this producer holding its own opinion about a
 * server's tool list. Filed in the page note §13 rather than faked.
 */

const PRODUCER = "grant_suspended";

/** One live-or-revoked connection of this house, with the tools it last showed. */
interface ConnectionRow {
  id: string;
  name: string;
  url: string | null;
  tools: McpToolSummary[] | null;
}

@Injectable()
export class GrantSuspendedProducer {
  private readonly logger = new Logger(GrantSuspendedProducer.name);

  static readonly PRODUCER = PRODUCER;
  static readonly CANDIDATE_CAP = 200;
  /** The two roles that may consent for the house. Not a default — a CHECK. */
  static readonly DECIDING_ROLES = ["owner", "manager"];

  /**
   * Who hears the REPEATS. The first line goes to everyone who can clear the
   * suspension; a suspension still standing a week later is an escalation, and
   * the founder's call is that it climbs to owners only rather than re-pinging
   * every manager weekly until somebody acts.
   */
  static readonly REPEAT_ROLES = ["owner"];

  /** One re-say per week of suspension. */
  static readonly REPEAT_INTERVAL_DAYS = 7;

  /**
   * How many weekly repeats a single suspension may produce.
   *
   * Twelve — a quarter. Not a silencing: the run row keeps naming the
   * suspension every sweep after that, and the status read still counts it. It
   * is a bound on the INBOX, because a grant nobody has cleared in three months
   * is not going to be cleared by a thirteenth identical line, and the register
   * that holds it is `/connections`, not the day book.
   */
  static readonly MAX_REPEATS = 12;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly ledger: ProducerLedgerService,
  ) {}

  async sweepTenant(
    restaurantId: string,
    timeZone: string,
    audience: ProducerAudience,
    // Every date this producer PRINTS still comes from `needs_reconsent_at` on
    // the row — dating a suspension with the sweep's own clock would move the
    // event to whenever anybody happened to look at it. The sweep's instant is
    // used only for ELAPSED time: which week of the suspension this is, and how
    // many days it has stood (the founder's weekly re-say, 2026-09-04).
    now: Date,
  ): Promise<ProducerTally> {
    const tally = emptyTally();

    const connections = await this.connectionsOf(restaurantId);
    if (connections.size === 0) {
      tally.withheldReason =
        "This house has no model-context server on record, so no tool grant of " +
        "its can be suspended.";
      return tally;
    }

    const grants = await this.suspendedGrants(
      Array.from(connections.keys()),
      tally,
    );
    if (grants.length === 0) {
      tally.withheldReason =
        "No tool grant on this house's servers is suspended. Every live grant " +
        "still matches the declaration its manager consented to.";
      return tally;
    }

    // Narrowed AFTER the source read, so a house with no manager still records
    // a truthful run row rather than a silent zero.
    const deciding = await this.decidingAudience(restaurantId, audience);

    // Resolved lazily: a house with no repeat due should not pay for a
    // second role read. `null` means "not asked yet", not "nobody".
    let owners: ProducerAudience | null = null;
    let cappedRepeats = 0;

    for (const grant of grants) {
      const connection = connections.get(String(grant.connection_id));
      if (!connection) {
        // The `.in()` above came from this map, so this is unreachable by
        // construction. It is checked rather than asserted because the
        // alternative is naming a server as "undefined" in a permanent row.
        tally.failed += 1;
        continue;
      }

      const changedAt = new Date(String(grant.needs_reconsent_at));
      if (!Number.isFinite(changedAt.getTime())) {
        tally.failed += 1;
        this.logger.warn(
          `GRANT_SUSPENDED_AT_UNREADABLE restaurant=${restaurantId} grant=${grant.id} — ` +
            "the grant is suspended but needs_reconsent_at is not a readable instant; " +
            "skipped rather than dated with the sweep's own clock.",
        );
        continue;
      }

      const tool = String(grant.tool_name ?? "").trim();
      const reason = String(grant.needs_reconsent_reason ?? "").trim();
      const removed = grant.revoked_at !== null && grant.revoked_at !== undefined;
      // What the whole list looked like when the grant was made, and what it
      // hashes to now. The second is `null` when the server has never been
      // probed successfully — an unknown, not a match and not a mismatch.
      const previousHash = grant.tool_list_hash
        ? String(grant.tool_list_hash)
        : null;
      const currentHash = connection.tools
        ? fingerprintToolList(connection.tools)
        : null;

      // WHICH WEEK OF THE SUSPENSION IS THIS?
      //
      // Week 0 is the original line and its key is unchanged, byte for byte, so
      // a suspension already reported stays reported. Week N >= 1 is a repeat:
      // a new key, a narrower audience, and the elapsed days in the sentence.
      // The arithmetic is on `needs_reconsent_at`, not on when the producer
      // first spoke — a house that armed this producer late still hears the
      // true age of the suspension rather than the age of our knowledge of it.
      const elapsedMs = now.getTime() - changedAt.getTime();
      const daysElapsed = Math.max(0, Math.floor(elapsedMs / 86_400_000));
      const week = Math.floor(
        daysElapsed / GrantSuspendedProducer.REPEAT_INTERVAL_DAYS,
      );

      if (week > GrantSuspendedProducer.MAX_REPEATS) {
        // Bounded, and said out loud rather than silently skipped.
        cappedRepeats += 1;
        continue;
      }

      const isRepeat = week >= 1;
      if (isRepeat && owners === null) {
        owners = await this.repeatAudience(restaurantId, audience);
      }
      const forThisLine = isRepeat ? (owners as ProducerAudience) : deciding;

      await this.ledger.emit(
        {
          restaurantId,
          producer: PRODUCER,
          audience: forThisLine,
          tally,
          now,
        },
        {
          dedupeKey: isRepeat
            ? `grant:${grant.id}:${previousHash ?? "unrecorded"}:week${week}`
            : `grant:${grant.id}:${previousHash ?? "unrecorded"}`,
          occurredAt: changedAt,
          payload: {
            type: "grant_suspended",
            title: removed
              ? `Tool grant revoked — ${tool} on ${connection.name}`
              : isRepeat
                ? `Tool grant still suspended after ${daysElapsed} days — ${tool} on ${connection.name}`
                : `Tool grant suspended — ${tool} on ${connection.name}`,
            message: isRepeat
              ? `${this.sentence({
                  server: connection.name,
                  tool,
                  reason,
                  removed,
                  changedAt,
                  timeZone,
                })} It has stood for ${daysElapsed} days; this is week ${week} of asking.`
              : this.sentence({
                  server: connection.name,
                  tool,
                  reason,
                  removed,
                  changedAt,
                  timeZone,
                }),
            // A permission the house did not change is refused right now. It is
            // not critical — nothing is lost by reading it an hour later — but
            // it outranks a delivery or a certified invoice.
            priority: "high",
            actionUrl: "/connections",
            actionLabel: "Open the server",
            metadata: {
              connectionId: connection.id,
              connectionName: connection.name,
              connectionUrl: connection.url,
              grantId: grant.id,
              tool,
              // Verbatim from the row, so the sentence a manager reads and the
              // sentence the gate refuses with are the same sentence.
              reason: reason || null,
              revoked: removed,
              previousHash,
              currentHash,
              changedAt: changedAt.toISOString(),
              changedAtSource:
                "mcp_tool_grants.needs_reconsent_at, stamped by McpConnectionsService.reconcileGrants " +
                "on the probe that read a new tools/list. It is the moment the change was OBSERVED, " +
                "not the moment the server made it — nothing in this product can see the second.",
              declaredRead: grant.declared_read ?? null,
              declaredAnnotations: grant.declared_annotations ?? null,
              writes: grant.writes ?? null,
              classificationSource: grant.classification_source ?? null,
              grantedBy: grant.granted_by ?? null,
              grantedAt: grant.granted_at ?? null,
              // The repeat's own facts, so a reader can tell a first line from
              // a fourth without counting rows.
              repeat: isRepeat,
              weekOfSuspension: week,
              daysElapsed,
              repeatIntervalDays: GrantSuspendedProducer.REPEAT_INTERVAL_DAYS,
              maxRepeats: GrantSuspendedProducer.MAX_REPEATS,
              audience: isRepeat
                ? "Owners of this restaurant only — a suspension standing a week " +
                  "later escalates rather than re-pinging every manager, resolved " +
                  "through user_restaurant_access.role."
                : "Owners and managers of this restaurant only, resolved through " +
                  "user_restaurant_access.role.",
              timeZone,
            },
          },
        },
      );
    }

    if (tally.emitted === 0 && tally.withheldReason === null) {
      tally.withheldReason =
        deciding.ready.length === 0 && deciding.deferred.length === 0
          ? "This house has a suspended grant and no active owner or manager to tell " +
            "about it. Nobody was written to, and nobody can clear the suspension."
          : cappedRepeats > 0
            ? `Every suspension standing on this house's servers had already been reported, and ${cappedRepeats} has stood past ${GrantSuspendedProducer.MAX_REPEATS} weeks — it is still refused and still on /connections, but it has stopped writing weekly lines.`
            : "Every suspension standing on this house's servers had already been reported.";
    }

    return tally;
  }

  // ==========================================================================
  // WHAT THE STATUS READ MAY SAY
  // ==========================================================================

  /**
   * How many suspended grants this house has standing right now.
   *
   * `null` means a read failed and is NOT zero. A status page that reported an
   * unreadable grant register as "nothing is suspended" would be the
   * absence-as-health fault on the one register whose whole purpose is to say
   * that a permission moved.
   *
   * Two reads rather than a join, because `mcp_tool_grants` carries no
   * `restaurant_id`: the tenant scope is the connection list.
   */
  async suspendedGrantCount(restaurantId: string): Promise<number | null> {
    const client = this.databaseService.getClient();

    const { data: connections, error: connectionError } = await client
      .from("restaurant_mcp_connections")
      .select("id")
      .eq("restaurant_id", restaurantId);

    if (connectionError) {
      this.logger.warn(
        `GRANT_REGISTER_UNREADABLE restaurant=${restaurantId} — ${connectionError.message}. ` +
          "The status read will say the register could not be read, never that nothing is suspended.",
      );
      return null;
    }

    const ids = (connections ?? [])
      .map((r: any) => String(r?.id ?? ""))
      .filter((id: string) => id.length > 0);
    // A house with no server has no suspended grant. That is a measured zero,
    // not an unread one.
    if (ids.length === 0) return 0;

    const { count, error } = await client
      .from("mcp_tool_grants")
      .select("id", { count: "exact", head: true })
      .in("connection_id", ids)
      .not("needs_reconsent_at", "is", null);

    if (error) {
      this.logger.warn(
        `GRANT_REGISTER_UNREADABLE restaurant=${restaurantId} — ${error.message}. ` +
          "The status read will say the register could not be read, never that nothing is suspended.",
      );
      return null;
    }
    return typeof count === "number" ? count : null;
  }

  // ==========================================================================
  // THE SENTENCE
  // ==========================================================================

  /**
   * Names the server, the tool, what changed, when it was seen, and what has to
   * happen next. No exclamation and no instruction to the reader's hands beyond
   * the one fact that only a manager can clear it.
   */
  private sentence(input: {
    server: string;
    tool: string;
    reason: string;
    removed: boolean;
    changedAt: Date;
    timeZone: string;
  }): string {
    const when = `${dayIn(input.changedAt, input.timeZone)} at ${clockIn(input.changedAt, input.timeZone)}`;
    const parts: string[] = [];

    parts.push(
      input.reason
        ? `The server ${input.server} changed the tool ${input.tool}: ${trimStop(input.reason)}.`
        : // The CHECK constraint `chk_mcp_tool_grants_reconsent_reason`
          // (20260904160000:…) forbids a suspension with no reason, so this
          // branch describes a row that should not exist. It says so rather
          // than printing an empty clause.
          `The server ${input.server} changed the tool ${input.tool}, and the change was recorded without a stated reason.`,
    );

    parts.push(`The change was seen on ${when}.`);

    parts.push(
      input.removed
        ? `The grant was revoked because the server no longer lists ${input.tool}. It can only be granted again if the server offers it again.`
        : `The grant is suspended: calls to ${input.tool} are refused until a manager grants it again on the connections page, against the declaration the server is making now.`,
    );

    return parts.join(" ");
  }

  // ==========================================================================
  // THE READS
  // ==========================================================================

  /**
   * This house's servers, by id.
   *
   * Revoked connections are INCLUDED. A grant suspended on a server a manager
   * then removed is still a permission change that happened, and the register
   * is where its record belongs; hiding it would make the row's disappearance
   * look like a resolution.
   */
  private async connectionsOf(
    restaurantId: string,
  ): Promise<Map<string, ConnectionRow>> {
    const { data, error } = await this.databaseService
      .getClient()
      .from("restaurant_mcp_connections")
      .select("id, name, url, probe_tools")
      .eq("restaurant_id", restaurantId);

    if (error) {
      throw new Error(
        `could not read restaurant_mcp_connections: ${error.message}`,
      );
    }

    const out = new Map<string, ConnectionRow>();
    for (const row of (data ?? []) as any[]) {
      if (!row?.id) continue;
      out.set(String(row.id), {
        id: String(row.id),
        name: String(row.name ?? "an unnamed server"),
        url: row.url ? String(row.url) : null,
        tools: Array.isArray(row.probe_tools)
          ? (row.probe_tools as McpToolSummary[])
          : null,
      });
    }
    return out;
  }

  /**
   * Every suspended grant on those connections.
   *
   * `revoked_at` is deliberately NOT filtered out. `reconcileGrants` stamps
   * both `revoked_at` and `needs_reconsent_at` when a tool DISAPPEARS
   * (mcp-connections.service.ts:756-763), so a `revoked_at IS NULL` clause here
   * would drop the loudest case this producer exists for — a server that
   * withdrew a tool the house was relying on.
   *
   * The tenant scope is the connection id list, which came from a
   * `restaurant_id`-filtered read: `mcp_tool_grants` carries no `restaurant_id`
   * of its own (20260903151000:175-198).
   */
  private async suspendedGrants(
    connectionIds: string[],
    tally: ProducerTally,
  ): Promise<any[]> {
    const { data, error } = await this.databaseService
      .getClient()
      .from("mcp_tool_grants")
      .select(
        "id, connection_id, tool_name, writes, granted_by, granted_at, revoked_at, " +
          "declared_read, declared_annotations, tool_fingerprint, tool_list_hash, " +
          "classification_source, needs_reconsent_at, needs_reconsent_reason",
      )
      .in("connection_id", connectionIds)
      .not("needs_reconsent_at", "is", null)
      .order("needs_reconsent_at", { ascending: true })
      .limit(GrantSuspendedProducer.CANDIDATE_CAP + 1);

    if (error) {
      throw new Error(`could not read mcp_tool_grants: ${error.message}`);
    }

    const rows = (data ?? []) as any[];
    tally.truncated = rows.length > GrantSuspendedProducer.CANDIDATE_CAP;
    return tally.truncated
      ? rows.slice(0, GrantSuspendedProducer.CANDIDATE_CAP)
      : rows;
  }

  /**
   * The house's owners and managers, intersected with the audience the sweep
   * was handed so the quiet-hours split still decides delivery.
   *
   * THROWS on a read failure. See the class header: neither fallback is honest.
   */
  /**
   * Owners only, for the weekly repeats.
   *
   * Same intersection with the handed audience as `decidingAudience`, so quiet
   * hours still decide delivery, and the same THROW on a failed read: telling
   * the whole house, or nobody, are both dishonest answers to "who owns this".
   */
  private async repeatAudience(
    restaurantId: string,
    audience: ProducerAudience,
  ): Promise<ProducerAudience> {
    const { data, error } = await this.databaseService
      .getClient()
      .from("user_restaurant_access")
      .select("user_id, role")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .in("role", GrantSuspendedProducer.REPEAT_ROLES);

    if (error) {
      throw new Error(`could not read user_restaurant_access: ${error.message}`);
    }

    const owners = new Set(
      (data ?? [])
        .map((r: any) => String(r?.user_id ?? ""))
        .filter((id: string) => id.length > 0),
    );

    if (owners.size === 0) {
      this.logger.warn(
        `GRANT_SUSPENDED_NO_OWNER restaurant=${restaurantId} — a grant has been ` +
          "suspended for over a week and this house has no active owner in " +
          "user_restaurant_access. The weekly re-say reaches nobody; the run row says so.",
      );
    }

    return {
      ready: audience.ready.filter((u) => owners.has(u)),
      deferred: audience.deferred.filter((u) => owners.has(u)),
    };
  }

  private async decidingAudience(
    restaurantId: string,
    audience: ProducerAudience,
  ): Promise<ProducerAudience> {
    const { data, error } = await this.databaseService
      .getClient()
      .from("user_restaurant_access")
      .select("user_id, role")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .in("role", GrantSuspendedProducer.DECIDING_ROLES);

    if (error) {
      throw new Error(
        `could not read user_restaurant_access: ${error.message}`,
      );
    }

    const deciders = new Set(
      (data ?? [])
        .map((r: any) => String(r?.user_id ?? ""))
        .filter((id: string) => id.length > 0),
    );

    if (deciders.size === 0) {
      this.logger.warn(
        `GRANT_SUSPENDED_NO_DECIDER restaurant=${restaurantId} — a tool grant is ` +
          "suspended and this house has no active owner or manager in " +
          "user_restaurant_access. Nobody was written to; the run row says so.",
      );
    }

    return {
      ready: audience.ready.filter((u) => deciders.has(u)),
      deferred: audience.deferred.filter((u) => deciders.has(u)),
    };
  }
}

/** Drops a trailing full stop so the reason can be joined into a sentence. */
function trimStop(text: string): string {
  return text.replace(/\.\s*$/, "");
}
