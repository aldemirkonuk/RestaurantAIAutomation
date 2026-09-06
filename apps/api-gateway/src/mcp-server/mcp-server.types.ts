/**
 * The wire types of the INBOUND half of model context.
 *
 * The protocol revision itself is NOT redeclared here. `McpRuntimeService`
 * already pins `2025-06-18` for the client half (`mcp-runtime.service.ts:68`)
 * and the two halves speaking different revisions of the same spec inside one
 * process is the ADR 0013 failure — two copies of one canon — in a new costume.
 * Everything below imports that constant rather than restating it.
 */

/** A JSON-RPC 2.0 request as it arrives. `id` absent means a notification. */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

/** The JSON-RPC codes this server actually emits. */
export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;
export const RPC_INTERNAL_ERROR = -32603;

/**
 * The four behaviour hints, as a SERVER emits them.
 *
 * Deliberately NOT the client half's `McpToolAnnotations`, whose fields are
 * `boolean | null` because it records what someone else said and must keep
 * "said false" apart from "said nothing". A server that does not know what it
 * declares has no business declaring anything, so every field here is a
 * required boolean and the ADR 0107 addendum's reconsent machinery on the other
 * side has a stable fingerprint to hash.
 */
export interface ServerToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

/** What `tools/list` puts on the wire for one tool. */
export interface WireTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: ServerToolAnnotations;
}

/**
 * One row of the catalogue: the wire shape plus the two facts the wire has no
 * field for — which scope the key must hold, and, for a write, the sentence
 * that refuses it.
 */
export interface CatalogTool extends WireTool {
  /** The scope slug a credential must hold. `null` = no scope needed. */
  scope: string | null;
  /**
   * The sentence `tools/call` answers with, naming the human step. Present on
   * every write tool and absent on every read: a read has nothing to refuse,
   * and an optional field that is sometimes a refusal and sometimes a null is
   * how a refusal goes missing.
   */
  refusal?: string;
}

/** What a resolved, live credential carries into a request. */
export interface McpCredential {
  id: string;
  restaurantId: string;
  label: string;
  scopes: string[];
}

/** Express request with a resolved credential attached by the guard. */
export interface McpRequest {
  mcpCredential?: McpCredential;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

/**
 * The provenance every read result carries.
 *
 * `readAt` is when the read happened and `rows` is how many rows the figure
 * summed. Both are required, because §7a of the capability note
 * (`.planning/08-softwares/mudavym-mcp.md`) makes "every figure names the rows
 * it summed and the read time" binding, and an optional provenance is one an
 * implementation forgets.
 */
export interface ReadProvenance {
  readAt: string;
  rows: number;
  source: string;
}

/**
 * A tool result body. Either a value with its provenance, or an absence with a
 * reason — never a `0` or an `[]` standing in for "we could not read".
 */
export type ToolPayload =
  | { value: unknown; provenance: ReadProvenance }
  | { value: null; reason: string; provenance: ReadProvenance };
