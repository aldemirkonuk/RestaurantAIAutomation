import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "crypto";
import { DatabaseService } from "../../database/database.service";
import {
  declaredClassification,
  fingerprintTool,
} from "../../mcp-runtime/tool-classification";
import type { McpToolSummary } from "../../mcp-runtime/mcp-runtime.types";
import {
  ProducerLedgerService,
  emptyTally,
  type ProducerAudience,
  type ProducerTally,
} from "./producer-ledger.service";
import { clockIn, dayIn } from "./producer-copy";

/**
 * "This server is offering a tool it was not offering before."
 *
 * AN INFORMATION LINE, NOT A SUSPENSION — THE FOUNDER'S CALL (2026-09-04)
 * ----------------------------------------------------------------------
 * The seventh producer (`grant-suspended`) reports a grant the gate now
 * REFUSES: a tool the house consented to has changed its declaration, so the
 * permission is suspended until somebody re-consents. That is a wall, and it
 * needs a decision.
 *
 * A tool being ADDED is not that. The gate does not refuse it, no grant moves,
 * and nothing the house already agreed to has changed — `fingerprintToolList`'s
 * own header says so: the gate compares per-tool fingerprints "because a server
 * adding an unrelated tool must not suspend a grant nobody touched"
 * (tool-classification.ts:181-190). Until this producer, that correct decision
 * had a consequence nobody had noticed: **an added tool was reported by
 * nothing at all.** The seventh producer's commit message filed it in as many
 * words. This is that file closed.
 *
 * So the line is informational. It names the server, the tool and what the
 * server declared about it, and it touches no grant. The reader is told a fact,
 * not handed a decision.
 *
 * WHY THIS PRODUCER NEEDED A TABLE, MEASURED FIRST
 * ------------------------------------------------
 * `restaurant_mcp_connections.probe_tools` is the tools/list result
 * (20260903104500:89-92) and it is OVERWRITTEN by every probe —
 * `probe_tools: outcome.tools`, `mcp-connections.service.ts:1666`. There is no
 * previous list anywhere in the schema, so nothing could tell an added tool
 * from one that had always been there. `notification_mcp_tool_sightings`
 * (20260904230000) is the producer's own memory; see that migration for why it
 * is a table here rather than a column on somebody else's row.
 *
 * THE FIRST SWEEP ANNOUNCES NOTHING, AND THAT IS DELIBERATE
 * ---------------------------------------------------------
 * A connection with no sightings at all has no baseline, so every tool on it
 * would read as new and arming this producer would post one line per tool per
 * server into the day book. The first sweep of a connection SEEDS its sightings
 * silently and says so in the run row. Only a tool that appears after a
 * baseline exists is announced.
 *
 * `unknown` IS A WRITE
 * --------------------
 * Classification comes from `declaredClassification`, whose rule is the
 * founder's: a tool the server declared nothing about "is classified as a
 * write" (tool-classification.ts:61-72). This producer never renders an
 * undeclared tool as read-only.
 */

const PRODUCER = "added_tool";

/** Stable across sweeps, and NEW after a removal — see `dedupeKey`. */
function firstSeenHash(firstSeenAt: string, tool: McpToolSummary): string {
  return createHash("sha256")
    .update(`${firstSeenAt}|${fingerprintTool(tool)}`)
    .digest("hex")
    .slice(0, 16);
}

interface SightingRow {
  id: string;
  connection_id: string;
  tool_name: string;
  first_seen_at: string;
  gone_at: string | null;
}

@Injectable()
export class AddedToolProducer {
  private readonly logger = new Logger(AddedToolProducer.name);

  static readonly PRODUCER = PRODUCER;
  static readonly CANDIDATE_CAP = 200;
  /** The two roles that may act on what a server offers. Same as the seventh. */
  static readonly DECIDING_ROLES = ["owner", "manager"];

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly ledger: ProducerLedgerService,
  ) {}

  async sweepTenant(
    restaurantId: string,
    timeZone: string,
    audience: ProducerAudience,
    now: Date,
  ): Promise<ProducerTally> {
    const tally = emptyTally();
    const client = this.databaseService.getClient();

    const { data, error } = await client
      .from("restaurant_mcp_connections")
      .select("id, name, probe_status, probe_tools, last_probe_at")
      .eq("restaurant_id", restaurantId)
      .is("revoked_at", null)
      .limit(AddedToolProducer.CANDIDATE_CAP + 1);

    if (error) {
      throw new Error(`could not read restaurant_mcp_connections: ${error.message}`);
    }

    const rows = (data ?? []) as any[];
    tally.truncated = rows.length > AddedToolProducer.CANDIDATE_CAP;
    const connections = tally.truncated
      ? rows.slice(0, AddedToolProducer.CANDIDATE_CAP)
      : rows;

    if (connections.length === 0) {
      tally.withheldReason =
        "This house has declared no model-context server, so there is nothing that can offer a tool.";
      return tally;
    }

    // Only a probe that ANSWERED says what a server offers. `unreachable`,
    // `refused` and `protocol_error` say nothing, and treating their absent
    // list as "every tool was removed" would stamp gone_at across the board and
    // then re-announce the whole catalogue on the next good probe.
    const answered = connections.filter(
      (c) => c.probe_status === "ok" && Array.isArray(c.probe_tools),
    );
    const unanswered = connections.length - answered.length;

    if (answered.length === 0) {
      tally.withheldReason = `${connections.length} declared server(s), none of which has answered a probe, so what they offer is unknown — not empty.`;
      return tally;
    }

    const sightings = await this.openSightings(
      restaurantId,
      answered.map((c) => c.id),
    );

    let seeded = 0;
    let removed = 0;
    let stillOffered = 0;
    const deciders = await this.decidingAudience(restaurantId, audience);

    for (const conn of answered) {
      const tools = (conn.probe_tools as McpToolSummary[]).filter(
        (t) => t && typeof t.name === "string" && t.name.trim().length > 0,
      );
      const open = sightings.get(conn.id) ?? new Map<string, SightingRow>();
      const currentNames = new Set(
        tools.map((t) => t.name.trim().toLowerCase()),
      );

      // A tool that has left the list closes its run. Not announced: a removal
      // is a revocation and belongs to the grant register, not the day book.
      for (const [name, row] of open) {
        if (!currentNames.has(name)) {
          await this.closeRun(row.id, now);
          removed += 1;
        }
      }

      const isBaseline = open.size === 0;

      for (const tool of tools) {
        const key = tool.name.trim().toLowerCase();
        const existing = open.get(key);
        if (existing) {
          await this.touch(existing.id, now);
          stillOffered += 1;
          continue;
        }

        const declared = declaredClassification(tool);
        const classification = declared.declaredRead ? "read_only" : "write";
        const sighting = await this.openRun(
          restaurantId,
          conn.id,
          tool.name.trim(),
          classification,
          now,
        );
        if (!sighting) {
          tally.failed += 1;
          continue;
        }

        if (isBaseline) {
          // First sight of this server. Seeded, not announced — see the header.
          seeded += 1;
          continue;
        }

        await this.ledger.emit(
          { restaurantId, producer: PRODUCER, audience: deciders, tally, now },
          {
            dedupeKey: `server:${conn.id}:tool:${tool.name.trim().toLowerCase()}:${firstSeenHash(sighting.first_seen_at, tool)}`,
            occurredAt: conn.last_probe_at
              ? new Date(conn.last_probe_at)
              : now,
            payload: {
              type: "mcp_tool_added",
              title: `${conn.name || "A model-context server"} is offering a new tool: ${tool.name.trim()}`,
              message: this.sentence(conn, tool, declared, now, timeZone),
              // An information line. The seventh producer's suspension is the
              // one that needs somebody; this one is a record.
              priority: "low",
              actionUrl: "/profile",
              actionLabel: "Open connections",
              metadata: {
                connectionId: conn.id,
                serverName: conn.name ?? null,
                toolName: tool.name.trim(),
                classification,
                classificationBasis: declared.basis,
                // The founder's rule, carried so a reader can check the word
                // against the reason it was chosen.
                unknownIsWrite: true,
                declaredReadOnly: declared.declaredRead,
                toolFingerprint: fingerprintTool(tool),
                firstSeenAt: sighting.first_seen_at,
                lastProbeAt: conn.last_probe_at ?? null,
                // Said out loud: this producer moves no permission.
                grantTouched: false,
                grantNote:
                  "No grant was created, changed or suspended. A server adding a tool does not alter what the house has already consented to.",
                timeZone,
              },
            },
          },
        );
      }
    }

    if (tally.emitted === 0 && tally.withheldReason === null) {
      const bits = [
        `${answered.length} server(s) answered a probe`,
        `${stillOffered} tool(s) already on the books`,
      ];
      if (seeded > 0) {
        bits.push(
          `${seeded} tool(s) recorded as the first sight of their server and deliberately NOT announced — a baseline, so arming this producer does not post one line per tool`,
        );
      }
      if (removed > 0) {
        bits.push(
          `${removed} tool(s) no longer offered, whose runs were closed (a removal is a revocation and is not said here)`,
        );
      }
      if (unanswered > 0) {
        bits.push(
          `${unanswered} declared server(s) have not answered a probe, so what they offer is unknown rather than empty`,
        );
      }
      tally.withheldReason = `${bits.join("; ")}.`;
    }

    return tally;
  }

  /** How many tools this house could still hear about — for the status read. */
  async watchedServerCount(restaurantId: string): Promise<number | null> {
    const { count, error } = await this.databaseService
      .getClient()
      .from("restaurant_mcp_connections")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .is("revoked_at", null);
    if (error) {
      this.logger.warn(
        `ADDED_TOOL_REGISTER_UNREADABLE restaurant=${restaurantId} — ${error.message}. ` +
          "The status read will say the register could not be read, never that it is empty.",
      );
      return null;
    }
    return typeof count === "number" ? count : null;
  }

  private sentence(
    conn: any,
    tool: McpToolSummary,
    declared: { declaredRead: boolean; basis: string },
    now: Date,
    timeZone: string,
  ): string {
    const seenAt = conn.last_probe_at ? new Date(conn.last_probe_at) : now;
    const parts: string[] = [];
    parts.push(
      `Seen on ${dayIn(seenAt, timeZone)} at ${clockIn(seenAt, timeZone)}.`,
    );
    parts.push(
      declared.declaredRead
        ? "The server declares it read-only."
        : "The server does not declare it read-only, so the house classifies it as a write.",
    );
    parts.push(declared.basis);
    parts.push(
      "No grant was changed. Nothing can call it until a manager grants it on the connections page.",
    );
    return parts.join(" ");
  }

  // ==========================================================================
  // THE SIGHTING LEDGER
  // ==========================================================================

  private async openSightings(
    restaurantId: string,
    connectionIds: string[],
  ): Promise<Map<string, Map<string, SightingRow>>> {
    const out = new Map<string, Map<string, SightingRow>>();
    if (!connectionIds.length) return out;
    const { data, error } = await this.databaseService
      .getClient()
      .from("notification_mcp_tool_sightings")
      .select("id, connection_id, tool_name, first_seen_at, gone_at")
      .eq("restaurant_id", restaurantId)
      .in("connection_id", connectionIds)
      .is("gone_at", null);
    if (error) {
      // Throwing hands the tenant to `runPerTenant`. An empty map here would
      // make every tool on every server look new and post the catalogue.
      throw new Error(
        `could not read notification_mcp_tool_sightings: ${error.message}`,
      );
    }
    for (const row of (data ?? []) as SightingRow[]) {
      const perConn =
        out.get(row.connection_id) ?? new Map<string, SightingRow>();
      perConn.set(String(row.tool_name).trim().toLowerCase(), row);
      out.set(row.connection_id, perConn);
    }
    return out;
  }

  private async openRun(
    restaurantId: string,
    connectionId: string,
    toolName: string,
    classification: string,
    now: Date,
  ): Promise<SightingRow | null> {
    const { data, error } = await this.databaseService
      .getClient()
      .from("notification_mcp_tool_sightings")
      .insert({
        restaurant_id: restaurantId,
        connection_id: connectionId,
        tool_name: toolName,
        classification,
        first_seen_at: now.toISOString(),
        last_seen_at: now.toISOString(),
        gone_at: null,
      })
      .select("id, connection_id, tool_name, first_seen_at, gone_at")
      .single();
    if (error) {
      // 23505 = the partial unique index fired, so another sweep opened the run
      // first. Not an error worth a notification; the other sweep says it.
      const code = (error as { code?: string }).code;
      if (code !== "23505") {
        this.logger.error(
          `ADDED_TOOL_SIGHTING_INSERT_FAILED restaurant=${restaurantId} ` +
            `connection=${connectionId} tool=${toolName} — ${error.message}. ` +
            "Nothing was said about this tool on this tick.",
        );
      }
      return null;
    }
    return (data ?? null) as SightingRow | null;
  }

  private async touch(id: string, now: Date): Promise<void> {
    const { error } = await this.databaseService
      .getClient()
      .from("notification_mcp_tool_sightings")
      .update({ last_seen_at: now.toISOString() })
      .eq("id", id);
    if (error) {
      this.logger.warn(
        `ADDED_TOOL_SIGHTING_TOUCH_FAILED id=${id} — ${error.message}`,
      );
    }
  }

  private async closeRun(id: string, now: Date): Promise<void> {
    const { error } = await this.databaseService
      .getClient()
      .from("notification_mcp_tool_sightings")
      .update({ gone_at: now.toISOString() })
      .eq("id", id);
    if (error) {
      this.logger.warn(
        `ADDED_TOOL_SIGHTING_CLOSE_FAILED id=${id} — ${error.message}. ` +
          "The run stays open, so a re-sighting will not read as a re-addition.",
      );
    }
  }

  /**
   * Owners and managers, intersected with the audience the sweep was handed so
   * the quiet-hours split still decides delivery. Same shape and same reasoning
   * as `GrantSuspendedProducer.decidingAudience`; a failed role read THROWS,
   * because writing to the whole house instead would tell every server their
   * permissions, and writing to nobody would be a silent producer.
   */
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
      .in("role", AddedToolProducer.DECIDING_ROLES);
    if (error) {
      throw new Error(`could not read user_restaurant_access: ${error.message}`);
    }
    const deciders = new Set(
      (data ?? [])
        .map((r: any) => String(r?.user_id ?? ""))
        .filter((id: string) => id.length > 0),
    );
    return {
      ready: audience.ready.filter((u) => deciders.has(u)),
      deferred: audience.deferred.filter((u) => deciders.has(u)),
    };
  }
}
