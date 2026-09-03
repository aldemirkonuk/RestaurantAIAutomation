/**
 * What a probe of a model-context server produces.
 *
 * Every field is evidence or null. There is no "unknown" member of the status
 * union and no default: a caller that has never probed holds `null` for the
 * whole outcome, which is a different thing from a probe that came back empty.
 */

/** The five outcomes the runtime can actually tell apart. */
export type McpProbeStatus =
  /** The handshake completed. `tools` is the server's own answer. */
  | "ok"
  /** Nothing answered: DNS, connect, TLS, or the deadline expired. */
  | "unreachable"
  /** Something answered and said no: a 4xx/5xx, or a JSON-RPC error object. */
  | "refused"
  /** Something answered and it was not this protocol: bad envelope, a redirect,
   *  a body over the cap, a version we cannot speak. */
  | "protocol_error"
  /** We could not call at all: the row carries a secret and this deployment
   *  holds no `MCP_CONNECTION_SECRET_KEY` to decrypt it. */
  | "unconfigured";

/**
 * One entry of `tools/list`, reduced to what a register row shows.
 *
 * `inputSchema` is deliberately dropped. It is the largest field a server
 * returns, it is only useful to a caller that can invoke, and nothing in this
 * product invokes yet (ADR 0013's commitment guardrail comes first). Storing it
 * would be keeping an argument spec for a call that cannot be made.
 */
export interface McpToolSummary {
  name: string;
  title: string | null;
  description: string | null;
}

export interface McpProbeOutcome {
  status: McpProbeStatus;
  /** One sentence, in the server's own words where the server supplied any. */
  detail: string;
  /** When we called. Always set — a probe that failed still happened. */
  calledAt: string;
  /** When it answered. Null unless the handshake completed. */
  answeredAt: string | null;
  serverName: string | null;
  serverVersion: string | null;
  /** The version the server negotiated to, not the one we asked for. */
  protocolVersion: string | null;
  /** Null unless `tools/list` answered. `[]` means "answered, offers none". */
  tools: McpToolSummary[] | null;
  /** What the server reported. May exceed `tools.length` when the cap bit. */
  toolCount: number | null;
  /** True when the cap dropped tools the server listed. */
  truncated: boolean;
}

/** The knobs, all read from config with the defaults documented on the service. */
export interface McpProbeLimits {
  timeoutMs: number;
  maxBytes: number;
  maxTools: number;
  allowPrivateEndpoints: boolean;
}
