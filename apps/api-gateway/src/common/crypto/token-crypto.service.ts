import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

/**
 * Authenticated encryption for third-party OAuth tokens at rest.
 *
 * A refresh token for Drive/Graph is a long-lived key to someone else's
 * documents, so it must not sit in the database in plaintext where a read-only
 * leak (log dump, backup, over-broad service-role query) would expose it.
 *
 * AES-256-GCM: the auth tag means tampering fails loudly on decrypt rather
 * than silently yielding garbage. Payload format is `v1.iv.tag.ciphertext`,
 * all base64url, with the version prefix so the scheme can be rotated later
 * without guessing at old rows.
 */
@Injectable()
export class TokenCryptoService {
  private readonly logger = new Logger(TokenCryptoService.name);
  private readonly key: Buffer | null;

  constructor(private readonly configService: ConfigService) {
    this.key = this.resolveKey();
  }

  /** False when no key is configured, so callers can refuse to store tokens. */
  get isConfigured(): boolean {
    return this.key !== null;
  }

  private resolveKey(): Buffer | null {
    const raw =
      this.configService.get<string>("INTEGRATION_TOKEN_ENCRYPTION_KEY") ??
      this.configService.get<string>("TOKEN_ENCRYPTION_KEY");

    if (!raw) {
      this.logger.warn(
        "INTEGRATION_TOKEN_ENCRYPTION_KEY not set — third-party integration connections are disabled",
      );
      return null;
    }

    // Accept 32-byte hex or base64 directly; otherwise derive via SHA-256 so a
    // passphrase still yields a valid 256-bit key instead of a startup crash.
    if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");

    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;

    this.logger.warn(
      "INTEGRATION_TOKEN_ENCRYPTION_KEY is not a 32-byte hex/base64 value — deriving a key via SHA-256",
    );
    return createHash("sha256").update(raw, "utf8").digest();
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new Error(
        "INTEGRATION_TOKEN_ENCRYPTION_KEY is not configured; refusing to handle integration tokens",
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
    const tag = cipher.getAuthTag();

    return [
      "v1",
      iv.toString("base64url"),
      tag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  decrypt(payload: string): string {
    const key = this.requireKey();
    const [version, ivPart, tagPart, dataPart] = payload.split(".");

    if (version !== "v1" || !ivPart || !tagPart || !dataPart) {
      throw new Error("Unrecognised encrypted token payload");
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

  /** Decrypt without throwing, for read paths that can degrade to "reconnect". */
  tryDecrypt(payload: string | null | undefined): string | null {
    if (!payload) return null;
    try {
      return this.decrypt(payload);
    } catch (err) {
      this.logger.error(
        `Failed to decrypt stored integration token: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
