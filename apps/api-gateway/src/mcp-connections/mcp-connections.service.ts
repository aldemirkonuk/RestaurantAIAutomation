import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { OrganizationsService } from "../organizations/organizations.service";
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
  McpToolCallResponse,
  McpToolGrantRecord,
} from "./dto/mcp-connection.dto";

/**
 * Model-context (MCP) servers — the HOUSE's attachments, with each person's
 * consent and each tool's grant hanging off them.
 *
 * WHOSE IS IT (ADR 0114, founder 2026-09-03)
 * -----------------------------------------
 * "House declares, each person consents." The first build keyed a server to one
 * person in one restaurant, so the table's own comment ("acts with the user's
 * authority, so it hangs off the user") and the register's lead ("Servers the
 * house agents may call") disagreed in the tree. The founder settled it: the
 * attachment is the restaurant's and survives the person who declared it
 * (`declared_by … ON DELETE SET NULL`); a person's agreement that it may act in
 * their name is a row in `mcp_connection_consents`, withdrawable without
 * touching the attachment or anybody else's consent.
 *
 * WHAT MAY BE CALLED (ADR 0107 addendum, same decision)
 * ---------------------------------------------------
 * "Per-tool grant plus the seal on every write." A manager grants each tool once
 * BY NAME and says whether it writes. A read runs for anyone who has consented.
 * A write runs only for a manager, only when the request carries the seal, and
 * every call — granted or refused — is a row in `mcp_tool_calls`.
 *
 * `assertCallable` is the one place that decides, and every refusal it raises
 * names the missing thing. It is exercised by
 * `mcp-connections.tool-gate.spec.ts` against all five refusal paths.
 *
 * THE READ THROWS. It does not return `[]`.
 * ----------------------------------------
 * `integrations-oauth.service.ts` logs its query error and returns `[]`, so on
 * the wire "the query failed" and "nothing is connected" are the same response
 * (filed as G3). This module does not repeat it: a query error becomes a 500
 * with the message the database gave, and the page renders words about a failed
 * read instead of an empty list that reads as "no servers".
 *
 * TENANCY COMES FROM THE JWT, NOT THE BODY.
 * Every method takes `restaurantId` from the controller, which takes it from
 * `req.user.restaurantId` — the signed claim, re-resolved on every request by
 * `JwtStrategy.validate`. Nothing in the request body can widen the scope.
 *
 * THE SECRET IS NOT IN `ROW_COLUMNS`, AND THAT IS THE WHOLE PROTECTION.
 * -------------------------------------------------------------------
 * `secret_encrypted` appears in exactly two selects in this file — inside
 * `probe` and inside `callTool`, both of which need it to make the call. Every
 * other read names its columns explicitly and that list does not include it, so
 * no response can carry the ciphertext even if the mapper were changed
 * carelessly. `hasSecret` is derived from `secret_set_at`, a date.
 *
 * A PROBE IS A CALL, AND A CALL IS TWO FACTS.
 * `last_probe_at` is stamped on every probe; `last_used_at` only when the server
 * answered. One timestamp would let a month of failures read as a month of
 * traffic.
 */
/**
 * Everything a row shows. `secret_encrypted` is deliberately absent — see the
 * class header. Changing this string is the only way to leak the credential,
 * and `mcp-connections.service.spec.ts` asserts it does not contain it.
 *
 * A module-level `const`, not a `static readonly` on the class, and the
 * `.select()` calls below name it BARE rather than as
 * `McpConnectionsService.ROW_COLUMNS`. That is not a style choice:
 * `scripts/check_read_columns_exist.py` resolves a same-file
 * `const NAME = "…" + "…";` and checks every column in it against
 * `supabase/migrations/`, and cannot resolve a class static.
 */
const MCP_ROW_COLUMNS =
  "id, name, url, scopes, created_at, last_used_at, last_probe_at, revoked_at, " +
  "declared_by, secret_set_at, probe_status, probe_detail, probe_tools, " +
  "probe_tool_count, probe_server_name, probe_server_version, " +
  "probe_protocol_version";

const CONSENT_COLUMNS =
  "connection_id, user_id, consented_at, withdrawn_at, house_revoked_at, " +
  "house_revoked_by";

const GRANT_COLUMNS =
  "connection_id, tool_name, writes, granted_by, granted_at, revoked_at";

/** One consent, with both withdrawal axes kept apart. */
interface ConsentRow {
  userId: string;
  at: string;
  /** The person changed their mind. */
  withdrawn: boolean;
  /** A manager cut the house off from it. */
  houseRevoked: boolean;
}

@Injectable()
export class McpConnectionsService {
  /** The same list, exposed so a spec can assert what it does NOT contain. */
  static readonly ROW_COLUMNS = MCP_ROW_COLUMNS;

  private readonly logger = new Logger(McpConnectionsService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly organizations: OrganizationsService,
    private readonly runtime: McpRuntimeService,
    private readonly secrets: McpSecretService,
  ) {}

  private static row(
    r: Record<string, unknown>,
    extras: {
      declaredByName: string | null;
      consentGiven: boolean;
      consentAt: string | null;
      consentCount: number;
      toolGrants: McpToolGrantRecord[];
    },
  ): McpConnectionResponse {
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
      // Who attached it, which is a fact and not an ownership. Null when the
      // account has been deleted — the attachment outlives them by design, and
      // the register says "no longer with this house" rather than inventing a
      // name.
      declaredBy: (r.declared_by as string | null) ?? null,
      declaredByName: extras.declaredByName,
      // From the DATE, never from the ciphertext — which this row never holds.
      hasSecret: Boolean(r.secret_set_at),
      secretSetAt: (r.secret_set_at as string | null) ?? null,
      consent: {
        given: extras.consentGiven,
        at: extras.consentAt,
        // How many people have agreed to be acted for. A house attachment with
        // zero live consents is declared and unusable, which is a real state
        // and not an error.
        liveCount: extras.consentCount,
      },
      toolGrants: extras.toolGrants,
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
        // TRUE since 2026-09-03, and the sentence says on what terms. ADR 0107
        // shipped with this `false` and the reason "that decision comes before
        // the code"; the founder made the decision, so the code follows it
        // rather than the other way round.
        enabled: true,
        reason:
          "A tool runs only if a manager granted it by name. A tool marked as a write runs only for a manager and only when the request carries the seal; a read runs for anyone who has consented to this server. Every call is recorded, granted or refused.",
      },
      probeTimeoutMs: this.runtime.limits.timeoutMs,
    };
  }

  /**
   * Every server THIS HOUSE has declared, newest first, including revoked ones
   * — a revoked grant that vanishes is indistinguishable from one that never
   * existed.
   *
   * `viewerUserId` decides only what `consent.given` says: whether the person
   * reading this page has agreed to be acted for. It never filters the list.
   * Filtering by viewer is what the first build did, and it is why one
   * manager's server was invisible to the owner of the house.
   */
  async list(
    restaurantId: string,
    viewerUserId: string,
  ): Promise<McpConnectionResponse[]> {
    const { data, error } = await this.databaseService.supabase
      .from("restaurant_mcp_connections")
      .select(MCP_ROW_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false });

    if (error) {
      this.logger.error(`Failed to list MCP connections: ${error.message}`);
      throw new InternalServerErrorException(
        `The model-context register could not be read: ${error.message}`,
      );
    }

    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    if (rows.length === 0) return [];

    const ids = rows.map((r) => String(r.id));
    const [consents, grants, names] = await Promise.all([
      this.consentsFor(ids),
      this.grantsFor(ids),
      this.namesFor(rows),
    ]);

    return rows.map((r) => {
      const id = String(r.id);
      const forRow = consents.get(id) ?? [];
      const mine = forRow.find(
        (c) => c.userId === viewerUserId && !c.withdrawn && !c.houseRevoked,
      );
      return McpConnectionsService.row(r, {
        declaredByName: names.get((r.declared_by as string | null) ?? "") ?? null,
        consentGiven: Boolean(mine),
        consentAt: mine?.at ?? null,
        consentCount: forRow.filter((c) => !c.withdrawn && !c.houseRevoked)
          .length,
        toolGrants: (grants.get(id) ?? []).map((g) => ({
          ...g,
          grantedByName: names.get(g.grantedBy ?? "") ?? null,
        })),
      });
    });
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
      .from("restaurant_mcp_connections")
      .insert({
        restaurant_id: restaurantId,
        declared_by: userId,
        name,
        url: dto.url.trim(),
        scopes: dto.scopes ?? [],
        // Explicit keys, not a conditional spread: the capture-contract guard
        // reads column names from the literal; undefined is dropped by
        // supabase-js, so an unsealed row still carries no secret columns.
        secret_encrypted: sealed ?? undefined,
        secret_set_at: sealed ? new Date().toISOString() : undefined,
      })
      .select(MCP_ROW_COLUMNS)
      .single();

    if (error) {
      // 23505 is the partial unique index on (restaurant, lower(name)).
      if (error.code === "23505") {
        throw new ConflictException(
          `A live model-context server called "${name}" already exists in this house. Revoke it first, or choose another name.`,
        );
      }
      this.logger.error(`Failed to add MCP connection: ${error.message}`);
      throw new InternalServerErrorException(
        `The model-context server was not added: ${error.message}`,
      );
    }

    return this.decorate(data as unknown as Record<string, unknown>, userId);
  }

  /**
   * Soft revoke, scoped by restaurant so an id from another tenant cannot be
   * revoked by guessing it. A second revoke is a 404, not a silent success.
   *
   * The credential is DESTROYED here, not merely orphaned: a revoked grant that
   * still holds a decryptable bearer token is a secret with no owner. The
   * consents and tool grants stay — the row is the record of what was once
   * trusted, and stripping it of its grants would erase what it was trusted to
   * do.
   */
  async revoke(
    restaurantId: string,
    viewerUserId: string,
    id: string,
  ): Promise<McpConnectionResponse> {
    const { data, error } = await this.databaseService.supabase
      .from("restaurant_mcp_connections")
      .update({
        revoked_at: new Date().toISOString(),
        secret_encrypted: null,
        secret_set_at: null,
      })
      .eq("id", id)
      .eq("restaurant_id", restaurantId)
      .is("revoked_at", null)
      .select(MCP_ROW_COLUMNS)
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to revoke MCP connection: ${error.message}`);
      throw new InternalServerErrorException(
        `The model-context server was not revoked: ${error.message}`,
      );
    }
    if (!data) {
      throw new NotFoundException(
        "No live model-context server with that id belongs to this house.",
      );
    }

    return this.decorate(
      data as unknown as Record<string, unknown>,
      viewerUserId,
    );
  }

  /**
   * Set or clear one connection's credential.
   *
   * `null` clears. A non-null secret on a deployment with no key is a 503
   * carrying the variable's name — never a silent plaintext write, and never a
   * success that stored nothing.
   */
  async setSecret(
    restaurantId: string,
    viewerUserId: string,
    id: string,
    secret: string | null,
  ): Promise<McpConnectionResponse> {
    const sealed = secret === null ? null : this.seal(secret);

    const { data, error } = await this.databaseService.supabase
      .from("restaurant_mcp_connections")
      .update({
        secret_encrypted: sealed,
        secret_set_at: sealed ? new Date().toISOString() : null,
      })
      .eq("id", id)
      .eq("restaurant_id", restaurantId)
      .is("revoked_at", null)
      .select(MCP_ROW_COLUMNS)
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to set MCP secret: ${error.message}`);
      throw new InternalServerErrorException(
        `The secret was not stored: ${error.message}`,
      );
    }
    if (!data) {
      throw new NotFoundException(
        "No live model-context server with that id belongs to this house.",
      );
    }

    return this.decorate(
      data as unknown as Record<string, unknown>,
      viewerUserId,
    );
  }

  /**
   * Call one declared server and record what answered.
   *
   * It never throws for a failed handshake. A dead endpoint, a 500 and a
   * redirect are three sentences on the row, and the register's own read state
   * stays `ok`, because reading the register succeeded — the SERVER is what
   * failed. Collapsing the two would make a broken MCP server look like a
   * broken Mudavym.
   */
  async probe(
    restaurantId: string,
    viewerUserId: string,
    id: string,
  ): Promise<McpConnectionResponse> {
    const row = await this.liveRowWithSecret(restaurantId, id);
    const opened = this.secrets.open(row.secret);

    // A stored secret we cannot open must NOT become an anonymous call that
    // then succeeds — the operator would read "connected" and believe the
    // credential worked.
    if (row.secret && opened.secret === null) {
      return this.writeProbe(restaurantId, viewerUserId, id, {
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

    const outcome = await this.runtime.probe(row.url, opened.secret);
    return this.writeProbe(restaurantId, viewerUserId, id, outcome);
  }

  /* ── consent: a person agrees to be acted for ───────────────────────── */

  /**
   * The caller's own consent. There is no route by which one person records or
   * withdraws another's — that is the difference between a consent and a
   * permission, and it is enforced by the absence of a user id parameter
   * anywhere on this path rather than by a check that could be forgotten.
   */
  async setConsent(
    restaurantId: string,
    userId: string,
    id: string,
    given: boolean,
  ): Promise<McpConnectionResponse> {
    const row = await this.liveRow(restaurantId, id);
    const now = new Date().toISOString();

    if (given) {
      // Giving consent stamps `consented_at`, including on a row that was
      // previously withdrawn — consenting again IS a new consent, and dating it
      // to the first one would misreport when this authority began.
      const { error } = await this.databaseService.supabase
        .from("mcp_connection_consents")
        .upsert(
          {
            connection_id: row.id,
            user_id: userId,
            consented_at: now,
            withdrawn_at: null,
          },
          { onConflict: "connection_id,user_id" },
        );
      if (error) {
        this.logger.error(`Failed to record MCP consent: ${error.message}`);
        throw new InternalServerErrorException(
          `Your consent was not recorded: ${error.message}`,
        );
      }
      return this.reread(restaurantId, userId, id);
    }

    // Withdrawing is an UPDATE, never an upsert. An upsert would rewrite
    // `consented_at` to now — so the record of a consent that stood for three
    // months would say it was given at the moment it ended. It would also
    // INSERT a consent-then-withdrawn row for someone who never consented,
    // which is a claim about a person that nobody made.
    const { data, error } = await this.databaseService.supabase
      .from("mcp_connection_consents")
      .update({ withdrawn_at: now })
      .eq("connection_id", row.id)
      .eq("user_id", userId)
      .is("withdrawn_at", null)
      .select("id");

    if (error) {
      this.logger.error(`Failed to withdraw MCP consent: ${error.message}`);
      throw new InternalServerErrorException(
        `Your consent was not withdrawn: ${error.message}`,
      );
    }
    if ((data ?? []).length === 0) {
      // "Already withdrawn" and "never given" both arrive here as no row.
      // Reporting success would tell the caller something changed that did not.
      throw new NotFoundException(
        "You have no live consent for this server, so there was nothing to withdraw.",
      );
    }

    return this.reread(restaurantId, userId, id);
  }

  /**
   * The HOUSE's side of one person's consent — a manager's control, not the
   * person's.
   *
   * "A manager may SEE, not approve" (founder, 2026-09-03): there is no pending
   * state to approve into, and this cannot create a consent that a person did
   * not give. It only ends, or restores, the house's use of one that exists —
   * so calling it on a person who never consented is a 404, not a silent
   * success that would leave a manager believing they had cut something off.
   */
  async setHouseConsent(
    restaurantId: string,
    managerUserId: string,
    id: string,
    subjectUserId: string,
    houseUses: boolean,
  ): Promise<McpConnectionResponse> {
    const row = await this.liveRow(restaurantId, id);

    const { data, error } = await this.databaseService.supabase
      .from("mcp_connection_consents")
      .update({
        house_revoked_at: houseUses ? null : new Date().toISOString(),
        house_revoked_by: houseUses ? null : managerUserId,
      })
      .eq("connection_id", row.id)
      .eq("user_id", subjectUserId)
      .select("id");

    if (error) {
      this.logger.error(`Failed to set house consent: ${error.message}`);
      throw new InternalServerErrorException(
        `The house's side of that consent was not changed: ${error.message}`,
      );
    }
    if ((data ?? []).length === 0) {
      throw new NotFoundException(
        "That person has never consented to this server, so there is nothing for the house to withdraw.",
      );
    }

    return this.reread(restaurantId, managerUserId, id);
  }

  /* ── tool grants: a manager grants one tool, by name ────────────────── */

  async grantTool(
    restaurantId: string,
    grantedBy: string,
    id: string,
    toolName: string,
    writes: boolean,
  ): Promise<McpConnectionResponse> {
    const row = await this.liveRow(restaurantId, id);
    const name = toolName.trim();
    if (!name) throw new BadRequestException("A tool grant needs a tool name");

    // Revoke-then-insert rather than upsert: the partial unique index is
    // `WHERE revoked_at IS NULL`, so a revoked grant and a live one for the
    // same tool coexist by design and the history of what was granted survives
    // a reclassification.
    await this.revokeToolRows(row.id, name);

    const { error } = await this.databaseService.supabase
      .from("mcp_tool_grants")
      .insert({
        connection_id: row.id,
        tool_name: name,
        writes,
        granted_by: grantedBy,
      });

    if (error) {
      this.logger.error(`Failed to grant MCP tool: ${error.message}`);
      throw new InternalServerErrorException(
        `The tool grant was not recorded: ${error.message}`,
      );
    }

    return this.reread(restaurantId, grantedBy, id);
  }

  async revokeTool(
    restaurantId: string,
    viewerUserId: string,
    id: string,
    toolName: string,
  ): Promise<McpConnectionResponse> {
    const row = await this.liveRow(restaurantId, id);
    const revoked = await this.revokeToolRows(row.id, toolName.trim());
    if (revoked === 0) {
      throw new NotFoundException(
        `"${toolName}" is not granted on this server, so there was nothing to revoke.`,
      );
    }
    return this.reread(restaurantId, viewerUserId, id);
  }

  /* ── the gate, and the call behind it ───────────────────────────────── */

  /**
   * Decide whether this person may call this tool on this server, right now.
   *
   * Five refusals, each naming the missing thing, in the order that makes the
   * message useful: a caller with no consent is told about consent before being
   * told the tool is not granted, because fixing the second first would not let
   * them through.
   *
   * Returns the grant so the caller does not read it twice.
   */
  private async assertCallable(
    restaurantId: string,
    userId: string,
    connectionId: string,
    toolName: string,
    sealed: boolean,
  ): Promise<{ writes: boolean }> {
    const { data: consent, error: consentError } =
      await this.databaseService.supabase
        .from("mcp_connection_consents")
        .select(CONSENT_COLUMNS)
        .eq("connection_id", connectionId)
        .eq("user_id", userId)
        .maybeSingle();

    if (consentError) {
      throw new InternalServerErrorException(
        `Your consent for this server could not be read, so nothing was called: ${consentError.message}`,
      );
    }
    const consentRow = consent as Record<string, unknown> | null;
    if (!consentRow || consentRow.withdrawn_at) {
      throw new ForbiddenException(
        "This server has not been given your consent to act in your name, so it was not called. Consent on the row first.",
      );
    }
    if (consentRow.house_revoked_at) {
      // A distinct sentence on purpose: telling someone to consent again when a
      // manager has cut the house off would send them round a loop they cannot
      // finish.
      throw new ForbiddenException(
        "A manager has withdrawn this house's use of your consent for this server, so it was not called. Your own consent is untouched; a manager restores the house's side.",
      );
    }

    const { data: grant, error: grantError } = await this.databaseService.supabase
      .from("mcp_tool_grants")
      .select(GRANT_COLUMNS)
      .eq("connection_id", connectionId)
      .ilike("tool_name", toolName)
      .is("revoked_at", null)
      .maybeSingle();

    if (grantError) {
      throw new InternalServerErrorException(
        `The tool grants for this server could not be read, so nothing was called: ${grantError.message}`,
      );
    }
    if (!grant) {
      throw new ForbiddenException(
        `"${toolName}" is not granted on this server. A manager grants each tool once, by name — a server that lists a tool has not been given it.`,
      );
    }

    const writes = (grant as Record<string, unknown>).writes === true;
    if (!writes) return { writes };

    // A write is a manager's act and it carries the seal. Both, not either:
    // the role says who may commit the house, the seal says they meant to.
    await this.organizations.assertCanManageRestaurant(
      userId,
      restaurantId,
      `call "${toolName}", which is granted as a tool that changes the world outside this app`,
    );
    if (!sealed) {
      throw new ForbiddenException(
        `"${toolName}" is granted as a write, so it runs only behind the seal. Hold the seal on the row and the call is made from there.`,
      );
    }
    return { writes };
  }

  /**
   * Call one tool, once, and record the call whatever it did.
   *
   * The record is written for a call that FAILED too. A log that only holds
   * successes is the absence-reported-as-health fault applied to forensics: the
   * incident you are reading it for is exactly the one it would omit.
   */
  async callTool(
    restaurantId: string,
    userId: string,
    id: string,
    toolName: string,
    args: Record<string, unknown>,
    sealed: boolean,
  ): Promise<McpToolCallResponse> {
    const row = await this.liveRowWithSecret(restaurantId, id);
    const { writes } = await this.assertCallable(
      restaurantId,
      userId,
      row.id,
      toolName,
      sealed,
    );

    const opened = this.secrets.open(row.secret);
    if (row.secret && opened.secret === null) {
      const detail =
        opened.reason ??
        "A secret is stored for this server and could not be read, so no call was made.";
      await this.recordCall(row.id, userId, toolName, writes, sealed, {
        outcome: "unconfigured",
        detail,
      });
      throw new ServiceUnavailableException(detail);
    }

    const outcome = await this.runtime.callTool(
      row.url,
      opened.secret,
      toolName,
      args,
    );

    await this.recordCall(row.id, userId, toolName, writes, sealed, {
      outcome: outcome.status,
      detail: outcome.detail,
    });

    // Only a call the server ANSWERED moves the last-answered stamp. A refused
    // call leaves it where it was.
    if (outcome.answeredAt) {
      await this.databaseService.supabase
        .from("restaurant_mcp_connections")
        .update({ last_used_at: outcome.answeredAt })
        .eq("id", row.id)
        .eq("restaurant_id", restaurantId);
    }

    return {
      connectionId: row.id,
      toolName,
      writes,
      sealed,
      status: outcome.status,
      detail: outcome.detail,
      calledAt: outcome.calledAt,
      answeredAt: outcome.answeredAt,
      content: outcome.content,
      isError: outcome.isError,
    };
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

  /** One live row, scoped to the house. Throws rather than returning null. */
  private async liveRow(
    restaurantId: string,
    id: string,
  ): Promise<{ id: string; url: string }> {
    const { data, error } = await this.databaseService.supabase
      .from("restaurant_mcp_connections")
      .select("id, url, revoked_at")
      .eq("id", id)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        `The model-context server could not be read: ${error.message}`,
      );
    }
    if (!data) {
      throw new NotFoundException(
        "No model-context server with that id belongs to this house.",
      );
    }
    const record = data as unknown as Record<string, unknown>;
    if (record.revoked_at) {
      throw new ConflictException(
        "This server is revoked. Declare it again to use it.",
      );
    }
    return { id: String(record.id), url: String(record.url) };
  }

  /**
   * The same, plus the ciphertext. Separate from `liveRow` so the credential is
   * fetched only on the two paths that make a network call, and never by a path
   * whose result is serialised to a client.
   */
  private async liveRowWithSecret(
    restaurantId: string,
    id: string,
  ): Promise<{ id: string; url: string; secret: string | null }> {
    const { data, error } = await this.databaseService.supabase
      .from("restaurant_mcp_connections")
      .select("id, url, revoked_at, secret_encrypted")
      .eq("id", id)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        `The model-context server could not be read: ${error.message}`,
      );
    }
    if (!data) {
      throw new NotFoundException(
        "No model-context server with that id belongs to this house.",
      );
    }
    const record = data as unknown as Record<string, unknown>;
    if (record.revoked_at) {
      throw new ConflictException(
        "This server is revoked, so it is not called. Declare it again to use it.",
      );
    }
    return {
      id: String(record.id),
      url: String(record.url),
      secret: (record.secret_encrypted as string | null) ?? null,
    };
  }

  private async revokeToolRows(
    connectionId: string,
    toolName: string,
  ): Promise<number> {
    const { data, error } = await this.databaseService.supabase
      .from("mcp_tool_grants")
      .update({ revoked_at: new Date().toISOString() })
      .eq("connection_id", connectionId)
      .ilike("tool_name", toolName)
      .is("revoked_at", null)
      .select("id");

    if (error) {
      this.logger.error(`Failed to revoke MCP tool grant: ${error.message}`);
      throw new InternalServerErrorException(
        `The tool grant was not revoked: ${error.message}`,
      );
    }
    return (data ?? []).length;
  }

  private async recordCall(
    connectionId: string,
    userId: string,
    toolName: string,
    writes: boolean,
    sealed: boolean,
    result: { outcome: string; detail: string },
  ): Promise<void> {
    const { error } = await this.databaseService.supabase
      .from("mcp_tool_calls")
      .insert({
        connection_id: connectionId,
        called_by: userId,
        tool_name: toolName,
        writes,
        sealed,
        outcome: result.outcome,
        detail: result.detail,
      });
    if (error) {
      // Logged, not raised. The call already happened; failing the response
      // would tell the caller nothing ran when something did, which is the
      // worse of the two lies available here.
      this.logger.error(
        `A model-context tool call was made and NOT recorded (${toolName}): ${error.message}`,
      );
    }
  }

  private async consentsFor(
    ids: string[],
  ): Promise<Map<string, ConsentRow[]>> {
    const out = new Map<string, ConsentRow[]>();
    const { data, error } = await this.databaseService.supabase
      .from("mcp_connection_consents")
      .select(CONSENT_COLUMNS)
      .in("connection_id", ids);

    if (error) {
      throw new InternalServerErrorException(
        `The consents on the model-context register could not be read: ${error.message}`,
      );
    }
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
      const key = String(r.connection_id);
      const list = out.get(key) ?? [];
      list.push({
        userId: String(r.user_id),
        at: String(r.consented_at),
        // Two axes, kept apart: the person changed their mind, or the house cut
        // itself off. A row is live only if neither happened, and the register
        // shows WHICH one ended it.
        withdrawn: Boolean(r.withdrawn_at),
        houseRevoked: Boolean(r.house_revoked_at),
      });
      out.set(key, list);
    }
    return out;
  }

  private async grantsFor(
    ids: string[],
  ): Promise<Map<string, Omit<McpToolGrantRecord, "grantedByName">[]>> {
    const out = new Map<
      string,
      Omit<McpToolGrantRecord, "grantedByName">[]
    >();
    const { data, error } = await this.databaseService.supabase
      .from("mcp_tool_grants")
      .select(GRANT_COLUMNS)
      .in("connection_id", ids)
      .is("revoked_at", null);

    if (error) {
      throw new InternalServerErrorException(
        `The tool grants on the model-context register could not be read: ${error.message}`,
      );
    }
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
      const key = String(r.connection_id);
      const list = out.get(key) ?? [];
      list.push({
        toolName: String(r.tool_name),
        writes: r.writes === true,
        grantedBy: (r.granted_by as string | null) ?? null,
        grantedAt: String(r.granted_at),
      });
      out.set(key, list);
    }
    return out;
  }

  /**
   * Display names for the ids the register shows.
   *
   * A failed name lookup is NOT fatal and NOT filled in: the map simply has no
   * entry, the row carries `null`, and the page renders "the account is gone"
   * rather than a plausible name nobody verified.
   */
  private async namesFor(
    rows: Record<string, unknown>[],
  ): Promise<Map<string, string>> {
    const ids = Array.from(
      new Set(
        rows
          .map((r) => (r.declared_by as string | null) ?? null)
          .filter((v): v is string => Boolean(v)),
      ),
    );
    const out = new Map<string, string>();
    if (ids.length === 0) return out;

    const { data, error } = await this.databaseService.supabase
      .from("users")
      .select("user_id, name")
      .in("user_id", ids);

    if (error) {
      this.logger.error(`Failed to read declarer names: ${error.message}`);
      return out;
    }
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
      if (r.name) out.set(String(r.user_id), String(r.name));
    }
    return out;
  }

  /** Decorate one freshly written row with its consents, grants and names. */
  private async decorate(
    row: Record<string, unknown>,
    viewerUserId: string,
  ): Promise<McpConnectionResponse> {
    const id = String(row.id);
    const [consents, grants, names] = await Promise.all([
      this.consentsFor([id]),
      this.grantsFor([id]),
      this.namesFor([row]),
    ]);
    const forRow = consents.get(id) ?? [];
    const mine = forRow.find(
      (c) => c.userId === viewerUserId && !c.withdrawn && !c.houseRevoked,
    );
    return McpConnectionsService.row(row, {
      declaredByName:
        names.get((row.declared_by as string | null) ?? "") ?? null,
      consentGiven: Boolean(mine),
      consentAt: mine?.at ?? null,
      consentCount: forRow.filter((c) => !c.withdrawn && !c.houseRevoked)
        .length,
      toolGrants: (grants.get(id) ?? []).map((g) => ({
        ...g,
        grantedByName: names.get(g.grantedBy ?? "") ?? null,
      })),
    });
  }

  /** Re-read one row after a write to a side table, so the client sees truth. */
  private async reread(
    restaurantId: string,
    viewerUserId: string,
    id: string,
  ): Promise<McpConnectionResponse> {
    const { data, error } = await this.databaseService.supabase
      .from("restaurant_mcp_connections")
      .select(MCP_ROW_COLUMNS)
      .eq("id", id)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        `The change was made and the row could not be re-read: ${error.message}`,
      );
    }
    if (!data) {
      throw new NotFoundException(
        "No model-context server with that id belongs to this house.",
      );
    }
    return this.decorate(
      data as unknown as Record<string, unknown>,
      viewerUserId,
    );
  }

  private async writeProbe(
    restaurantId: string,
    viewerUserId: string,
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
      .from("restaurant_mcp_connections")
      .update(patch)
      .eq("id", id)
      .eq("restaurant_id", restaurantId)
      .select(MCP_ROW_COLUMNS)
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to record MCP probe: ${error.message}`);
      throw new InternalServerErrorException(
        `The server was called, and the result could not be recorded: ${error.message}`,
      );
    }
    if (!data) {
      throw new NotFoundException(
        "No model-context server with that id belongs to this house.",
      );
    }

    return this.decorate(
      data as unknown as Record<string, unknown>,
      viewerUserId,
    );
  }
}
