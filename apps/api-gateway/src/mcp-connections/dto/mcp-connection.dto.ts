import {
  ArrayMaxSize,
  IsArray,
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
   * Always `false` today, and the reason is a decision rather than a build:
   * calling a tool can bind the restaurant, which is ADR 0013's subject.
   */
  invocation: {
    enabled: boolean;
    reason: string;
  };
  /** So the page can say how long it will wait before it says "unreachable". */
  probeTimeoutMs: number;
}
