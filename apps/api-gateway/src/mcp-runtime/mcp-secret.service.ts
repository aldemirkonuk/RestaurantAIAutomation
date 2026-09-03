import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * The per-connection credential for a model-context server, encrypted at rest.
 *
 * WHY NOT `TokenCryptoService`
 * ---------------------------
 * `common/crypto/token-crypto.service.ts` already does AES-256-GCM in exactly
 * this envelope, and this service deliberately matches its `v1.iv.tag.ciphertext`
 * format so an operator reading either column sees the same shape. What it does
 * NOT do is share its key: `INTEGRATION_TOKEN_ENCRYPTION_KEY` unlocks Google and
 * Microsoft refresh tokens, and a key that unlocks two unrelated blast radii is
 * one rotation away from being unrotatable. `MCP_CONNECTION_SECRET_KEY` is its
 * own variable, and there is no fallback to the other one — a silent fallback
 * would mean a deployment that thinks it has not enabled this feature has.
 *
 * THE UNCONFIGURED PATH IS A REFUSAL, NOT A DEGRADATION
 * ----------------------------------------------------
 * With no key, `isConfigured` is false and `encrypt` throws. The caller
 * (`mcp-connections.service.ts`) turns that into a 503 carrying the variable's
 * name, and the page's field is disabled with the same sentence. Nothing writes
 * a plaintext secret, so a NULL `secret_encrypted` never means "stored, but not
 * encrypted".
 *
 * A KEY THAT IS NOT 32 BYTES IS REFUSED, NOT DERIVED
 * --------------------------------------------------
 * Its neighbour SHA-256s a passphrase into a key and warns. That is the right
 * call for a variable already deployed under two names; it is the wrong call for
 * a new one, because it makes a typo'd key silently work — and then a corrected
 * key cannot read what the typo wrote. Here a malformed value leaves the feature
 * OFF and says which variable is wrong, which is the state an operator can fix.
 */
@Injectable()
export class McpSecretService {
  static readonly ENV_VAR = "MCP_CONNECTION_SECRET_KEY";

  private readonly logger = new Logger(McpSecretService.name);
  private readonly key: Buffer | null;
  /** Why there is no key. Null exactly when there is one. */
  private readonly problem: string | null;

  constructor(private readonly configService: ConfigService) {
    const resolved = McpSecretService.resolveKey(
      this.configService.get<string>(McpSecretService.ENV_VAR),
    );
    this.key = resolved.key;
    this.problem = resolved.problem;
    if (this.problem) {
      this.logger.warn(
        `Model-context server secrets are disabled: ${this.problem}`,
      );
    }
  }

  private static resolveKey(raw: string | undefined): {
    key: Buffer | null;
    problem: string | null;
  } {
    if (!raw || raw.trim() === "") {
      return {
        key: null,
        problem: `${McpSecretService.ENV_VAR} is not set, so a model-context server secret cannot be stored or read.`,
      };
    }

    const value = raw.trim();
    if (/^[0-9a-f]{64}$/i.test(value)) {
      return { key: Buffer.from(value, "hex"), problem: null };
    }

    // `Buffer.from(x, "base64")` never throws — it drops what it cannot decode —
    // so the length check is the whole validation, and it must be exact.
    const decoded = Buffer.from(value, "base64");
    if (decoded.length === 32) return { key: decoded, problem: null };

    return {
      key: null,
      problem: `${McpSecretService.ENV_VAR} is set but is not a 32-byte key (expected 64 hex characters or 32 bytes of base64); it is being ignored rather than stretched, so a corrected key can still read what a correct one wrote.`,
    };
  }

  /** True only when a usable key is loaded. */
  get isConfigured(): boolean {
    return this.key !== null;
  }

  /** The sentence a route or a page prints when it is not. Null when it is. */
  get unavailableReason(): string | null {
    return this.problem;
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new Error(
        this.problem ?? `${McpSecretService.ENV_VAR} is not configured`,
      );
    }
    return this.key;
  }

  encrypt(plaintext: string): string {
    const key = this.requireKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  /**
   * Throws on a tampered or truncated envelope — the GCM tag is the point.
   * Callers that must not fail hard use {@link tryDecrypt}.
   */
  decrypt(payload: string): string {
    const key = this.requireKey();
    const [version, ivPart, tagPart, dataPart] = payload.split(".");
    if (version !== "v1" || !ivPart || !tagPart || !dataPart) {
      throw new Error("Unrecognised encrypted secret payload");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivPart, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  /**
   * Decrypt, or say why not — never a `null` that a caller can mistake for "no
   * secret was stored". The probe path turns a non-null reason into a
   * `unconfigured` / `protocol_error` outcome carrying it, so an undecryptable
   * secret is visible on the row rather than silently becoming an anonymous
   * call.
   *
   * The failure message never contains the payload.
   */
  open(payload: string | null | undefined): {
    secret: string | null;
    reason: string | null;
  } {
    if (!payload) return { secret: null, reason: null };
    if (!this.isConfigured) {
      return { secret: null, reason: this.problem };
    }
    try {
      return { secret: this.decrypt(payload), reason: null };
    } catch (err) {
      this.logger.error(
        `Stored model-context secret would not decrypt: ${(err as Error).message}`,
      );
      return {
        secret: null,
        reason:
          "The stored secret for this server would not decrypt with the current key. It was not sent, and it must be set again.",
      };
    }
  }
}
