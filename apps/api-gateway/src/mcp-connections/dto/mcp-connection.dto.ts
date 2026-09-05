import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";
import type {
  McpProbeStatus,
  McpToolAnnotations,
  McpToolSummary,
} from "../../mcp-runtime/mcp-runtime.types";

/**
 * What the operator types when they add a model-context server.
 *
 * Four fields now, and the fourth is the one the first build refused to add.
 * `20260903094500_user_mcp_connections.sql` said a credential would wait for "a
 * code path that uses one"; `mcp-runtime/` is that path, so `secret` is here,
 * it is optional, and a deployment with no `MCP_CONNECTION_SECRET_KEY` refuses
 * it at the service rather than storing it in the clear.
 *
 * There is still no transport picker and no header map. The transport is fixed
 * to Streamable HTTP over http(s) because a local `command:` transport would run
 * a process on our servers, which is a decision and not a text box.
 */
export class CreateMcpConnectionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  /**
   * `require_tld: false` so `http://localhost:3000` — the address every MCP
   * server is first tried on — is accepted. The scheme restriction is the part
   * that matters and it is enforced here AND by the table's CHECK. Whether the
   * gateway will actually CALL that address is a separate question, answered by
   * `mcp-runtime/mcp-endpoint.guard.ts` at probe time.
   */
  @IsUrl({ protocols: ["http", "https"], require_tld: false })
  @MaxLength(2000)
  url!: string;

  /**
   * Scopes granted, in the house's own vocabulary. Optional and defaulting to
   * empty: "declared, nothing granted yet" is a real state, and an empty array
   * says it. Each entry is a short slug so a scope list cannot become a place to
   * paste prose.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  @Matches(/^[a-z0-9][a-z0-9._:-]*$/, {
    each: true,
    message:
      "each scope must be a lowercase slug (letters, digits, . _ : -), e.g. inventory:read",
  })
  scopes?: string[];

  /**
   * The bearer credential this server expects, if it expects one. Encrypted
   * before it reaches the table and never returned by any route — the register
   * reports `secretSetAt`, which is a date, not a value.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  secret?: string;
}

/**
 * Set or clear one connection's credential.
 *
 * `null` is a legitimate value and means "call this server anonymously from now
 * on" — distinct from omitting the field, which this DTO does not allow, so a
 * malformed body can never be read as a request to drop a credential.
 */
export class SetMcpSecretDto {
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  secret!: string | null;
}

/** One row of the Model context register, as the browser receives it. */
export interface McpConnectionResponse {
  id: string;
  name: string;
  url: string;
  scopes: string[];
  createdAt: string;
  /**
   * When this server last ANSWERED. Null until a probe completes — and it is
   * never stamped by a probe that failed, so a dead server cannot read as busy.
   */
  lastUsedAt: string | null;
  /** When this server was last CALLED, answered or not. Null until probed. */
  lastProbeAt: string | null;
  revokedAt: string | null;
  /** The GRANT's state. Not the server's health — that is `probe`. */
  status: "active" | "revoked";
  /**
   * The person who attached it. A fact, not an ownership: the attachment is the
   * house's and outlives the account (ADR 0114), so this is null once that
   * account is gone and the register says so rather than inventing a name.
   */
  declaredBy: string | null;
  declaredByName: string | null;
  /**
   * The READER's own agreement that this server may act in their name, and how
   * many people have given theirs. `liveCount: 0` on a live attachment is a
   * real state — declared by the house, usable by nobody yet.
   */
  consent: {
    given: boolean;
    at: string | null;
    liveCount: number;
  };
  /**
   * Tools a manager has granted, by name. A tool the server LISTS is not a tool
   * that may be called; only a row here is (ADR 0107 addendum).
   */
  toolGrants: McpToolGrantRecord[];
  /**
   * Whether a credential is stored, and since when. The value itself is not on
   * this interface, in any shape, on purpose.
   */
  hasSecret: boolean;
  secretSetAt: string | null;
  /** Null when this server has never been probed. Never a benign default. */
  probe: McpProbeRecord | null;
}

/** What the last probe found. Every field is evidence or null. */
export interface McpProbeRecord {
  status: McpProbeStatus;
  detail: string | null;
  serverName: string | null;
  serverVersion: string | null;
  protocolVersion: string | null;
  tools: McpToolSummary[] | null;
  toolCount: number | null;
}

/**
 * What this deployment can do with a model-context server, as opposed to what
 * this house has declared. Read once by the page so the register's controls can
 * carry the deployment's own reason instead of page prose.
 */
export interface McpRuntimeStateResponse {
  secretStorage: {
    configured: boolean;
    /** Names the environment variable. Null exactly when configured. */
    reason: string | null;
  };
  /**
   * TRUE since 2026-09-03 (ADR 0107 addendum), and the reason states the terms:
   * a per-tool grant, a manager and the seal for anything that writes. It was
   * `false` while ADR 0013's commitment guardrail had not been extended to
   * tools; the founder extended it, so the flag follows the decision.
   */
  invocation: {
    enabled: boolean;
    reason: string;
  };
  /** So the page can say how long it will wait before it says "unreachable". */
  probeTimeoutMs: number;
}

/** One granted tool. `writes` is the manager's classification, not the server's. */
export interface McpToolGrantRecord {
  toolName: string;
  /**
   * The classification the gate uses. TRUE means this tool changes the world
   * outside this app: it runs only for a manager and only behind the seal.
   *
   * It is the SERVER's declaration unless the granting manager tightened it —
   * see `classificationSource`. It can never be looser than the declaration.
   */
  writes: boolean;
  /**
   * What the server itself declared via `annotations.readOnlyHint` at grant
   * time. TRUE = it declared the tool read-only. FALSE = it declared otherwise.
   * NULL = it declared nothing, or had never been probed — which carries the
   * same permission as FALSE and is a different fact, so the register shows
   * both.
   */
  declaredRead: boolean | null;
  /** The four hints as the server sent them. Null when it sent none. */
  declaredAnnotations: McpToolAnnotations | null;
  /**
   * 'declared' — the manager accepted the server's classification.
   * 'manager_override' — the server declared a read and the manager granted it
   * as a write. The opposite override does not exist.
   */
  classificationSource: "declared" | "manager_override";
  /**
   * Set when the server's declaration has moved since this grant was made. A
   * grant with this set is REFUSED at the gate until a manager grants it again.
   */
  needsReconsentAt: string | null;
  /** What changed, in words. Never null when `needsReconsentAt` is set. */
  needsReconsentReason: string | null;
  /** The whole tool list as it stood when this was granted. An audit fact. */
  toolListHash: string | null;
  /**
   * What the LAST sealed call on this tool was worth: 'proven' = a one-time
   * challenge was redeemed for exactly that call; 'asserted' = the caller
   * claimed the seal and nothing checked it (every call before 2026-09-04).
   * Null = no sealed call has ever been made, which is a third state and not a
   * quiet 'asserted'.
   */
  lastSeal: "proven" | "asserted" | null;
  grantedBy: string | null;
  grantedByName: string | null;
  grantedAt: string;
}

/**
 * Grant one tool by name.
 *
 * `writes` is REQUIRED and has no default anywhere in the stack — table,
 * DTO or UI. Classifying a tool is the granting manager's act; a default would
 * let an unclassified tool be granted as a read, which is the
 * absence-reported-as-health fault applied to money.
 */
export class GrantMcpToolDto {
  @IsBoolean()
  writes!: boolean;

  /**
   * The one-time seal, minted by `POST :id/tools/:tool/grant-seal` when the
   * hold began.
   *
   * THERE IS NO `sealed` FIELD, and its absence is the point. Until 2026-09-04
   * (second pass) this DTO carried `sealed?: boolean` and a re-consent was
   * gated on it — a claim the CLIENT set, travelling in the same request as the
   * thing it claimed about, which is precisely the flaw ADR 0114 named and the
   * call path had already closed. Whether a grant was sealed is now a fact the
   * SERVER derives, by redeeming this token or refusing to.
   *
   * Required for any grant that classifies a tool as a write, and for any
   * re-consent. Not required to grant a declared read, which takes a permission
   * away rather than giving one.
   */
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(200)
  challenge?: string;
}

/**
 * Call one granted tool.
 *
 * `sealed` is the client's assertion that the hold-to-approve ceremony
 * completed. It is required for a tool granted as a write and recorded on every
 * call. What it proves is bounded and stated in ADR 0114: it is an assertion by
 * an authenticated manager, logged with their id — not a cryptographic proof of
 * the gesture. The gate that actually holds is the grant plus the role.
 */
export class CallMcpToolDto {
  @IsOptional()
  @IsObject()
  args?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  sealed?: boolean;

  /**
   * The one-time challenge issued when the hold BEGAN, from
   * `POST :id/tools/:tool/seal-challenge`.
   *
   * Required in practice for every tool granted as a write since 2026-09-04:
   * the gateway redeems it exactly once and refuses a replay, a different
   * actor, a different tool, different arguments or an expired token. `sealed`
   * alone no longer buys a write — which was ADR 0114's stated limitation, now
   * closed.
   */
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(200)
  challenge?: string;
}

/** The arguments a hold is being begun over, so the seal can be bound to them. */
export class SealChallengeDto {
  @IsOptional()
  @IsObject()
  args?: Record<string, unknown>;
}

/**
 * Begin the hold on a GRANT.
 *
 * `writes` is the classification the manager is about to agree to, and it is
 * sent here so the seal is refused NOW if it could never be granted — a seal a
 * manager holds and is then told meant nothing teaches people that the seal is
 * decoration. There are no other arguments: what the seal is bound to (the tool
 * and the tool list the manager is looking at) is derived by the server from
 * the same function the redemption uses, so a client cannot change what its own
 * seal covers.
 */
export class GrantSealChallengeDto {
  @IsBoolean()
  writes!: boolean;
}

/**
 * One challenge, returned ONCE.
 *
 * The token is never stored in plaintext and never appears on any other
 * response. A route that could read one back would be a route that hands out
 * pre-approved purchases.
 */
export interface McpSealChallengeResponse {
  challenge: string;
  expiresAt: string;
  toolName: string;
}

/** Whether the caller agrees this server may act in their name. */
export class SetMcpConsentDto {
  @IsBoolean()
  given!: boolean;
}

/**
 * A manager's side of somebody else's consent.
 *
 * `houseUses: false` ends the house's use of that person's consent; their own
 * consent, and their own credential, are untouched. There is no field here that
 * could create, approve or hold a consent pending — a manager may see, not
 * approve (founder, 2026-09-03), and the DTO is where that is enforced by not
 * being expressible.
 */
export class SetHouseConsentDto {
  @IsString()
  @MinLength(1)
  userId!: string;

  @IsBoolean()
  houseUses!: boolean;
}

/** What one tool call did. `status` is the transport; `isError` is the tool. */
export interface McpToolCallResponse {
  connectionId: string;
  toolName: string;
  writes: boolean;
  sealed: boolean;
  /** 'proven' when a challenge was redeemed for this call. Null on a read. */
  sealProof: "proven" | "asserted" | null;
  status: McpProbeStatus;
  detail: string;
  calledAt: string;
  answeredAt: string | null;
  content: string | null;
  isError: boolean | null;
}
