import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { McpRuntimeService } from "../mcp-runtime/mcp-runtime.service";
import { McpSecretService } from "../mcp-runtime/mcp-secret.service";
import type {
  McpProbeStatus,
  McpToolSummary,
} from "../mcp-runtime/mcp-runtime.types";
import {
  CreateMcpConnectionDto,
  McpConnectionResponse,
  McpRuntimeStateResponse,
} from "./dto/mcp-connection.dto";

/**
 * Model-context (MCP) servers, per user per restaurant.
 *
 * THE READ THROWS. It does not return `[]`.
 * ----------------------------------------
 * `/profile`'s Connections register had to INFER a failed read from an empty
 * array, because `integrations-oauth.service.ts:485-488` logs its query error
 * and returns `[]` — so on the wire, "the query failed" and "nothing is
 * connected" are the same response. That inference is correct today and fragile
 * forever, and it is filed as G3. This module does not repeat it: a query error
 * becomes a 500 with the message the database gave, and the page renders words
 * about a failed read instead of an empty list that reads as "no servers".
 *
 * TENANCY COMES FROM THE JWT, NOT THE BODY.
 * Every method takes `restaurantId` from the controller, which takes it from
 * `req.user.restaurantId` — the signed claim, re-resolved on every request by
 * `JwtStrategy.validate`. Nothing in the request body can widen the scope.
 *
 * THE SECRET IS NOT IN `ROW_COLUMNS`, AND THAT IS THE WHOLE PROTECTION.
 * -------------------------------------------------------------------
 * `secret_encrypted` appears in exactly one select in this file — inside
 * `probe`, which needs it to make the call. Every other read names its columns
 * explicitly and that list does not include it, so no response can carry the
 * ciphertext even if the mapper were changed carelessly: the value is never
 * fetched in the first place. `hasSecret` is derived from `secret_set_at`, a
 * date, rather than from the value's presence.
 *
 * A PROBE IS A CALL, AND A CALL IS TWO FACTS.
 * ------------------------------------------
 * `last_probe_at` is stamped on every probe. `last_used_at` is stamped ONLY when
 * the server answered. The migration header spells out why they are two columns:
 * one timestamp would let a month of failures read as a month of traffic.
 */
@Injectable()
export class McpConnectionsService {
  /**
   * Everything a row shows. `secret_encrypted` is deliberately absent — see the
   * class header. Changing this string is the only way to leak the credential,
   * and `mcp-connections.service.spec.ts` asserts it does not contain it.
   */
  static readonly ROW_COLUMNS =
    "id, name, url, scopes, created_at, last_used_at, last_probe_at, revoked_at, " +
    "secret_set_at, probe_status, probe_detail, probe_tools, probe_tool_count, " +
    "probe_server_name, probe_server_version, probe_protocol_version";

  private readonly logger = new Logger(McpConnectionsService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly runtime: McpRuntimeService,
    private readonly secrets: McpSecretService,
  ) {}

  private static row(r: Record<string, unknown>): McpConnectionResponse {
    const status = r.probe_status as string | null | undefined;
    const tools = Array.isArray(r.probe_tools)
      ? (r.probe_tools as McpToolSummary[])
      : null;

    return {
      id: String(r.id),
      name: String(r.name),
      url: String(r.url),
      scopes: Array.isArray(r.scopes) ? (r.scopes as string[]) : [],
      createdAt: String(r.created_at),
      lastUsedAt: (r.last_used_at as string | null) ?? null,
      lastProbeAt: (r.last_probe_at as string | null) ?? null,
      revokedAt: (r.revoked_at as string | null) ?? null,
      status: r.revoked_at ? "revoked" : "active",
      // From the DATE, never from the ciphertext — which this row never holds.
      hasSecret: Boolean(r.secret_set_at),
      secretSetAt: (r.secret_set_at as string | null) ?? null,
      // Null, not a benign default. A server that has never been probed has no
      // health, and `{status: "ok"}` here would be the whole fault this module
      // was built to avoid.
      probe: status
        ? {
            status: status as McpProbeStatus,
            detail: (r.probe_detail as string | null) ?? null,
            serverName: (r.probe_server_name as string | null) ?? null,
            serverVersion: (r.probe_server_version as string | null) ?? null,
            protocolVersion: (r.probe_protocol_version as string | null) ?? null,
            tools,
            toolCount:
              typeof r.probe_tool_count === "number" ? r.probe_tool_count : null,
          }
        : null,
    };
  }

  /**
   * What this DEPLOYMENT can do, as opposed to what this house declared.
   *
   * Read separately from the list so an absent encryption key is one sentence
   * the page can print beside a disabled field, rather than an error the whole
   * register has to fail on.
   */
  runtimeState(): McpRuntimeStateResponse {
    return {
      secretStorage: {
        configured: this.secrets.isConfigured,
        reason: this.secrets.unavailableReason,
      },
      invocation: {
        // Not "not implemented". Not present, and it stays that way until the
        // commitment guardrail (ADR 0013) covers model-context dispatch: a tool
        // call can send an email or place an order, which binds the house.
        enabled: false,
        reason:
          "Tools can be listed but not called. Calling one could commit this restaurant to money, which is the subject of the commitment guardrail (ADR 0013); that decision comes before the code, so no invocation path exists in this gateway.",
      },
      probeTimeoutMs: this.runtime.limits.timeoutMs,
    };
  }

  /**
   * Every server this user has declared for this restaurant, newest first,
   * including revoked ones — a revoked grant that vanishes is indistinguishable
   * from one that never existed.
   */
  async list(
    userId: string,
    restaurantId: string,
  ): Promise<McpConnectionResponse[]> {
    const { data, error } = await this.databaseService.supabase
      .from("user_mcp_connections")
      .select(McpConnectionsService.ROW_COLUMNS)
      .eq("user_id", userId)
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false });

    if (error) {
      this.logger.error(`Failed to list MCP connections: ${error.message}`);
      throw new InternalServerErrorException(
        `The model-context register could not be read: ${error.message}`,
      );
    }

    return (data ?? []).map((r) =>
      McpConnectionsService.row(r as unknown as Record<string, unknown>),
    );
  }

  async create(
    userId: string,
    restaurantId: string,
    dto: CreateMcpConnectionDto,
  ): Promise<McpConnectionResponse> {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException("A server needs a name");

    // Refuse before writing anything. A row created and then failed on the
    // secret would leave a server declared that the operator believes is
    // credentialed.
    const sealed = dto.secret ? this.seal(dto.secret) : null;

    const { data, error } = await this.databaseService.supabase
      .from("user_mcp_connections")
      .insert({
        user_id: userId,
        restaurant_id: restaurantId,
        name,
        url: dto.url.trim(),
        scopes: dto.scopes ?? [],
        ...(sealed
          ? { secret_encrypted: sealed, secret_set_at: new Date().toISOString() }
          : {}),
      })
      .select(McpConnectionsService.ROW_COLUMNS)
      .single();

    if (error) {
      // 23505 is the partial unique index on (user, restaurant, lower(name)).
      // Reported as a conflict with the real reason rather than a 500, because
      // "you already have a live server called that" is something the operator
      // can act on.
      if (error.code === "23505") {
        throw new ConflictException(
          `A live model-context server called "${name}" already exists here. Revoke it first, or choose another name.`,
        );
      }
      this.logger.error(`Failed to add MCP connection: ${error.message}`);
      throw new InternalServerErrorException(
        `The model-context server was not added: ${error.message}`,
      );
    }

    return McpConnectionsService.row(data as unknown as Record<string, unknown>);
  }

  /**
   * Soft revoke, scoped by user AND restaurant so an id from another tenant
   * cannot be revoked by guessing it. A second revoke is a 404, not a silent
   * success — "already gone" and "never yours" must not report the same way as
   * "revoked just now".
   *
   * The credential is DESTROYED here, not merely orphaned: a revoked grant that
   * still holds a decryptable bearer token is a secret with no owner.
   */
  async revoke(
    userId: string,
    restaurantId: string,
    id: string,
  ): Promise<McpConnectionResponse> {
    const { data, error } = await this.databaseService.supabase
      .from("user_mcp_connections")
      .update({
        revoked_at: new Date().toISOString(),
        secret_encrypted: null,
        secret_set_at: null,
      })
      .eq("id", id)
      .eq("user_id", userId)
      .eq("restaurant_id", restaurantId)
      .is("revoked_at", null)
      .select(McpConnectionsService.ROW_COLUMNS)
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to revoke MCP connection: ${error.message}`);
      throw new InternalServerErrorException(
        `The model-context server was not revoked: ${error.message}`,
      );
    }
    if (!data) {
      throw new NotFoundException(
        "No live model-context server with that id belongs to you here.",
      );
    }

    return McpConnectionsService.row(data as unknown as Record<string, unknown>);
  }

  /**
   * Set or clear one connection's credential.
   *
   * `null` clears. A non-null secret on a deployment with no key is a 503
   * carrying the variable's name — never a silent plaintext write, and never a
   * success that stored nothing.
   */
  async setSecret(
    userId: string,
    restaurantId: string,
    id: string,
    secret: string | null,
  ): Promise<McpConnectionResponse> {
    const sealed = secret === null ? null : this.seal(secret);

    const { data, error } = await this.databaseService.supabase
      .from("user_mcp_connections")
      .update({
        secret_encrypted: sealed,
        secret_set_at: sealed ? new Date().toISOString() : null,
      })
      .eq("id", id)
      .eq("user_id", userId)
      .eq("restaurant_id", restaurantId)
      .is("revoked_at", null)
      .select(McpConnectionsService.ROW_COLUMNS)
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to set MCP secret: ${error.message}`);
      throw new InternalServerErrorException(
        `The secret was not stored: ${error.message}`,
      );
    }
    if (!data) {
      throw new NotFoundException(
        "No live model-context server with that id belongs to you here.",
      );
    }

    return McpConnectionsService.row(data as unknown as Record<string, unknown>);
  }

  /**
   * Call one declared server and record what answered.
   *
   * This is the method that makes `last_used_at` capable of being non-null —
   * the column `20260903094500` created nullable and predicted would stay null
   * "until something calls". This is that something.
   *
   * It never throws for a failed handshake. A dead endpoint, a 500 and a
   * redirect are three sentences on the row, and the register's own read state
   * stays `ok`, because reading the register succeeded — the SERVER is what
   * failed. Collapsing the two would make a broken MCP server look like a broken
   * Mudavym.
   */
  async probe(
    userId: string,
    restaurantId: string,
    id: string,
  ): Promise<McpConnectionResponse> {
    const { data: row, error: readError } = await this.databaseService.supabase
      .from("user_mcp_connections")
      // The ONE place `secret_encrypted` is selected, and it never leaves this
      // method: what is returned to the caller is re-read through ROW_COLUMNS.
      .select("id, url, revoked_at, secret_encrypted")
      .eq("id", id)
      .eq("user_id", userId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (readError) {
      this.logger.error(`Failed to read MCP connection: ${readError.message}`);
      throw new InternalServerErrorException(
        `The model-context server could not be read: ${readError.message}`,
      );
    }
    if (!row) {
      throw new NotFoundException(
        "No model-context server with that id belongs to you here.",
      );
    }
    if ((row as unknown as Record<string, unknown>).revoked_at) {
      throw new ConflictException(
        "This server is revoked, so it is not called. Declare it again to use it.",
      );
    }

    const stored = (row as unknown as Record<string, unknown>).secret_encrypted as
      | string
      | null;
    const opened = this.secrets.open(stored);

    // A stored secret we cannot open must NOT become an anonymous call that
    // then succeeds — the operator would read "connected" and believe the
    // credential worked.
    if (stored && opened.secret === null) {
      return this.writeProbe(userId, restaurantId, id, {
        status: "unconfigured",
        detail:
          opened.reason ??
          "A secret is stored for this server and could not be read, so no call was made.",
        calledAt: new Date().toISOString(),
        answeredAt: null,
        serverName: null,
        serverVersion: null,
        protocolVersion: null,
        tools: null,
        toolCount: null,
        truncated: false,
      });
    }

    const outcome = await this.runtime.probe(
      String((row as unknown as Record<string, unknown>).url),
      opened.secret,
    );

    return this.writeProbe(userId, restaurantId, id, outcome);
  }

  /* ── internals ─────────────────────────────────────────────────────── */

  private seal(secret: string): string {
    if (!this.secrets.isConfigured) {
      throw new ServiceUnavailableException(
        this.secrets.unavailableReason ??
          "This deployment cannot store a model-context server secret.",
      );
    }
    const trimmed = secret.trim();
    if (!trimmed) {
      throw new BadRequestException(
        "An empty secret is not a secret. Send null to clear it instead.",
      );
    }
    return this.secrets.encrypt(trimmed);
  }

  private async writeProbe(
    userId: string,
    restaurantId: string,
    id: string,
    outcome: Awaited<ReturnType<McpRuntimeService["probe"]>>,
  ): Promise<McpConnectionResponse> {
    const patch: Record<string, unknown> = {
      last_probe_at: outcome.calledAt,
      probe_status: outcome.status,
      probe_detail: outcome.detail,
      probe_tools: outcome.tools,
      probe_tool_count: outcome.toolCount,
      probe_server_name: outcome.serverName,
      probe_server_version: outcome.serverVersion,
      probe_protocol_version: outcome.protocolVersion,
    };
    // Only a server that ANSWERED gets its last-answered stamp moved. A failed
    // probe leaves the previous answer where it was, so the row keeps saying
    // "it last worked on the 3rd" instead of quietly refreshing to now.
    if (outcome.answeredAt) patch.last_used_at = outcome.answeredAt;

    const { data, error } = await this.databaseService.supabase
      .from("user_mcp_connections")
      .update(patch)
      .eq("id", id)
      .eq("user_id", userId)
      .eq("restaurant_id", restaurantId)
      .select(McpConnectionsService.ROW_COLUMNS)
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to record MCP probe: ${error.message}`);
      throw new InternalServerErrorException(
        `The server was called, and the result could not be recorded: ${error.message}`,
      );
    }
    if (!data) {
      throw new NotFoundException(
        "No model-context server with that id belongs to you here.",
      );
    }

    return McpConnectionsService.row(data as unknown as Record<string, unknown>);
  }
}
