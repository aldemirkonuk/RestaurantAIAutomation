import { Injectable, Logger } from "@nestjs/common";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { DatabaseService } from "../database/database.service";
import { McpCredential } from "./mcp-server.types";

/** What a mint hands back. `secret` is the only time it is ever readable. */
export interface MintedCredential {
  id: string;
  label: string;
  restaurantId: string;
  scopes: string[];
  /** Shown once. Not stored, not recoverable, not logged. */
  secret: string;
  createdAt: string;
}

/** A register row. Carries no secret and no hash. */
export interface CredentialSummary {
  id: string;
  label: string;
  tokenPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** What a verification actually established. Never a bare boolean. */
export type VerifyOutcome =
  | { ok: true; credential: McpCredential }
  | { ok: false; reason: string };

export const SECRET_PREFIX = "mud_mcp_";

/** Per-credential window. Deliberately not the global guard's IP key (§7.2). */
export const RATE_LIMIT_PER_MINUTE = 60;
const RATE_WINDOW_MS = 60_000;

/**
 * Keys an assistant presents to us, and the counter that stops one assistant
 * eating the house's whole budget.
 *
 * WHY THE RATE LIMIT IS HERE AND NOT `RateLimitGuard`
 * ---------------------------------------------------
 * The global guard keys on `user.id`, then `user.restaurantId`, then the IP
 * (`common/rate-limit/rate-limit.guard.ts:246-266`). An MCP request carries no
 * user, so every assistant in the world calling from one cloud NAT would share
 * one bucket, and a single house's key would be throttled by a stranger's
 * traffic. §7.2 of the capability note names this exact seam. The bucket that
 * means anything here is the credential, and only this module knows which
 * credential a request resolved to.
 *
 * The counter is in-process, like the global guard's. That is honest rather
 * than sufficient: with more than one gateway replica the effective limit is
 * `RATE_LIMIT_PER_MINUTE × replicas`, and `describeLimiter()` says so rather
 * than letting a reader assume otherwise.
 */
@Injectable()
export class McpCredentialsService {
  private readonly logger = new Logger(McpCredentialsService.name);
  private readonly buckets = new Map<
    string,
    { count: number; resetAt: number }
  >();

  constructor(private readonly databaseService: DatabaseService) {}

  /** SHA-256, lowercase hex — the shape `token_hash`'s CHECK constraint requires. */
  static hash(secret: string): string {
    return createHash("sha256").update(secret, "utf8").digest("hex");
  }

  static describeLimiter(): string {
    return (
      `${RATE_LIMIT_PER_MINUTE} calls per credential per 60s, counted in this ` +
      `process. With N gateway replicas the effective ceiling is ` +
      `${RATE_LIMIT_PER_MINUTE}×N; a shared store would be needed to make it exact.`
    );
  }

  /**
   * Mint a key for one house.
   *
   * The secret is 32 random bytes, base64url. It is returned to the caller and
   * never written: only its SHA-256 goes to the table, so a dump of the table
   * grants nothing and this service cannot show a key again even if asked.
   */
  async mint(params: {
    restaurantId: string;
    label: string;
    scopes: string[];
    createdBy: string;
  }): Promise<MintedCredential> {
    const secret = `${SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;
    const scopes = params.scopes
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);

    const { data, error } = await this.databaseService.supabase
      .from("mcp_server_credentials")
      .insert({
        restaurant_id: params.restaurantId,
        label: params.label.trim(),
        token_hash: McpCredentialsService.hash(secret),
        // Enough to tell two keys apart on a register row, far too little to
        // reconstruct one: 32 random bytes remain.
        token_prefix: secret.slice(0, 16),
        scopes,
        created_by: params.createdBy,
      })
      .select("id, label, restaurant_id, scopes, created_at")
      .single();

    if (error) {
      throw new Error(`Could not mint an MCP key: ${error.message}`);
    }

    const row = data as {
      id: string;
      label: string;
      restaurant_id: string;
      scopes: string[] | null;
      created_at: string;
    };

    return {
      id: row.id,
      label: row.label,
      restaurantId: row.restaurant_id,
      scopes: row.scopes ?? [],
      secret,
      createdAt: row.created_at,
    };
  }

  /** This house's keys, newest first. Revoked ones included and marked. */
  async list(restaurantId: string): Promise<CredentialSummary[]> {
    const { data, error } = await this.databaseService.supabase
      .from("mcp_server_credentials")
      .select(
        "id, label, token_prefix, scopes, created_at, last_used_at, revoked_at",
      )
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false });

    // A read error is not an empty register. Throwing is what lets the page say
    // "could not read" instead of drawing a house with no keys.
    if (error) {
      throw new Error(`Could not read the MCP key register: ${error.message}`);
    }

    return (data ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      label: String(r.label),
      tokenPrefix: String(r.token_prefix),
      scopes: (r.scopes as string[] | null) ?? [],
      createdAt: String(r.created_at),
      lastUsedAt: (r.last_used_at as string | null) ?? null,
      revokedAt: (r.revoked_at as string | null) ?? null,
    }));
  }

  /**
   * Soft revoke. Scoped by restaurant in the same statement as the id, so a
   * key id learned from somewhere else cannot be revoked from another house.
   */
  async revoke(params: {
    restaurantId: string;
    credentialId: string;
    revokedBy: string;
  }): Promise<{ revoked: boolean; reason: string | null }> {
    const { data, error } = await this.databaseService.supabase
      .from("mcp_server_credentials")
      .update({
        revoked_at: new Date().toISOString(),
        revoked_by: params.revokedBy,
      })
      .eq("id", params.credentialId)
      .eq("restaurant_id", params.restaurantId)
      .is("revoked_at", null)
      .select("id");

    if (error) {
      throw new Error(`Could not revoke the MCP key: ${error.message}`);
    }

    // Zero rows is not an error and not a success: the key belongs to another
    // house, does not exist, or was already revoked. The caller is told which
    // set of possibilities it is in rather than being told "done".
    if (!data || data.length === 0) {
      return {
        revoked: false,
        reason:
          "No live key of this house carries that id — it is already revoked, it does not exist, or it belongs to another house. Nothing was changed.",
      };
    }
    return { revoked: true, reason: null };
  }

  /**
   * Resolve a presented secret to a live credential.
   *
   * The lookup is by hash, which is a constant-length unique index, and the
   * final comparison is `timingSafeEqual` on the digests. A `.eq()` on the hash
   * is already not a secret-dependent branch in our process, but the extra
   * comparison costs nothing and makes the property local rather than an
   * assumption about PostgREST.
   */
  async verify(presented: string | null): Promise<VerifyOutcome> {
    const secret = (presented ?? "").trim();
    if (!secret) {
      return {
        ok: false,
        reason:
          "No credential presented. This server authenticates with an Authorization: Bearer header carrying a Mudavym MCP key.",
      };
    }
    if (!secret.startsWith(SECRET_PREFIX)) {
      return {
        ok: false,
        reason:
          "That is not a Mudavym MCP key. A key begins with " +
          `\`${SECRET_PREFIX}\` and is minted per house on /connections. A gateway ` +
          "JWT is deliberately NOT accepted here: a browser session is a person's, " +
          "and an assistant's key must be revocable without ending that person's session.",
      };
    }

    const digest = McpCredentialsService.hash(secret);
    const { data, error } = await this.databaseService.supabase
      .from("mcp_server_credentials")
      .select("id, restaurant_id, label, scopes, token_hash, revoked_at")
      .eq("token_hash", digest)
      .maybeSingle();

    if (error) {
      // A failed read is not a failed credential. Saying so keeps a database
      // outage from being reported to the client as "your key is invalid",
      // which would send an operator to rotate a key that was never the fault.
      this.logger.error(`MCP credential lookup failed: ${error.message}`);
      return {
        ok: false,
        reason:
          "Could not check the credential — the key register did not answer. This is not a statement about the key.",
      };
    }
    if (!data) {
      return { ok: false, reason: "That key is not one of ours." };
    }

    const row = data as {
      id: string;
      restaurant_id: string;
      label: string;
      scopes: string[] | null;
      token_hash: string;
      revoked_at: string | null;
    };

    const a = Buffer.from(digest, "hex");
    const b = Buffer.from(row.token_hash, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: "That key is not one of ours." };
    }
    if (row.revoked_at) {
      return {
        ok: false,
        reason: `That key was revoked on ${row.revoked_at}. Mint a new one on /connections.`,
      };
    }

    return {
      ok: true,
      credential: {
        id: row.id,
        restaurantId: row.restaurant_id,
        label: row.label,
        scopes: row.scopes ?? [],
      },
    };
  }

  /**
   * True while this credential is inside its window.
   *
   * Returns the remaining allowance too, so the caller can put it on the
   * response rather than the client having to hit the wall to learn the shape.
   */
  consume(credentialId: string): {
    allowed: boolean;
    remaining: number;
    resetAt: number;
  } {
    const now = Date.now();
    const bucket = this.buckets.get(credentialId);
    if (!bucket || bucket.resetAt <= now) {
      const resetAt = now + RATE_WINDOW_MS;
      this.buckets.set(credentialId, { count: 1, resetAt });
      return {
        allowed: true,
        remaining: RATE_LIMIT_PER_MINUTE - 1,
        resetAt,
      };
    }
    if (bucket.count >= RATE_LIMIT_PER_MINUTE) {
      return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
    }
    bucket.count += 1;
    return {
      allowed: true,
      remaining: RATE_LIMIT_PER_MINUTE - bucket.count,
      resetAt: bucket.resetAt,
    };
  }

  /** Stamp a real use. Never called on a refused or unauthorised request. */
  async stampUse(credentialId: string): Promise<void> {
    const { error } = await this.databaseService.supabase
      .from("mcp_server_credentials")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", credentialId);
    if (error) {
      // Warn rather than throw: a failed stamp must not fail the read the
      // client actually asked for. The cost is a stale `last_used_at`, and
      // saying so in a log is what keeps that from being read as "never used".
      this.logger.warn(
        `MCP last_used_at not stamped for ${credentialId} — the register will understate use: ${error.message}`,
      );
    }
  }

  /**
   * One row per inbound request.
   *
   * `askedBy` is a parameter and is passed `null` by every call site in this
   * build, because MCP presents a key and not a person. It is here as a
   * parameter rather than a hardcoded null so that the day a client carries an
   * end-user identity, the column is filled by the caller who actually knows
   * it — and never by a default that invents one.
   */
  async logCall(entry: {
    credentialId: string | null;
    restaurantId: string | null;
    method: string;
    toolName: string | null;
    outcome: "ok" | "refused" | "error" | "unauthorized" | "rate_limited";
    detail: string | null;
    durationMs: number | null;
    askedBy: string | null;
  }): Promise<void> {
    const { error } = await this.databaseService.supabase
      .from("mcp_server_call_log")
      .insert({
        credential_id: entry.credentialId,
        restaurant_id: entry.restaurantId,
        method: entry.method,
        tool_name: entry.toolName,
        outcome: entry.outcome,
        detail: entry.detail ? entry.detail.slice(0, 500) : null,
        duration_ms: entry.durationMs,
        asked_by: entry.askedBy,
      });
    if (error) {
      this.logger.warn(
        `MCP call not logged (${entry.method}) — the ledger is now a floor, not a count: ${error.message}`,
      );
    }
  }
}
