/**
 * The per-house credential store, and the thing that refuses to hand one out.
 *
 * WHAT THIS ANSWERS
 * -----------------
 * `TextSenderService.send()` returns `transport_not_built` even for a house
 * with a `connected` sender, because "a connected row is a record of a
 * registration and not a wired provider client". This service is what turns
 * that from a permanent truth into a checkable one: a house is wired when
 * `house_text_sender_credentials` holds a live row for its sender AND the
 * platform can decrypt it. Both halves are read here, and each failure gets its
 * own sentence.
 *
 * FOUR OUTCOMES, NOT TWO (ADR 0051 clause 3)
 * ------------------------------------------
 *   `ready`        a credential exists and could be used.
 *   `none`         no credential row for this sender.
 *   `unreadable`   the read FAILED. Not the same as `none`, and folding them
 *                  would tell a manager "you have not connected an account"
 *                  during a database outage.
 *   `unusable`     the row exists and cannot be used — no encryption key
 *                  configured, ciphertext that will not decrypt, a
 *                  platform-path provider with no environment credential.
 *
 * THE TOKEN IS NEVER RETURNED TO A CALLER THAT DID NOT ASK FOR IT
 * ---------------------------------------------------------------
 * `describe()` is the read a SURFACE gets and it carries no secret and no
 * ciphertext. `resolve()` is the read the SEND PATH gets and it holds the
 * plaintext for the length of one call. Two methods rather than one with a
 * flag, because a boolean parameter is one inverted condition away from
 * shipping a token to a page.
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../../../database/database.service";
import { TokenCryptoService } from "../../../common/crypto/token-crypto.service";
import type {
  CredentialOwner,
  TransportCredential,
  TransportProvider,
} from "./text-transport";

/**
 * Every column this service reads, as a module-level `const` of literal names,
 * for `scripts/check_read_columns_exist.py` (a class static reads to that guard
 * as unreadable — see `seal-challenge.service.ts` for the same note).
 */
const CREDENTIAL_COLUMNS =
  "id, sender_id, restaurant_id, provider, owner, account_ref, sender_ref, " +
  "service_ref, access_token_encrypted, token_expires_at, api_version, " +
  "connected_by, connected_at, revoked_at";

export type CredentialReadState = "ready" | "none" | "unreadable" | "unusable";

/** What a SURFACE may see. No token, no ciphertext, no length hint. */
export interface CredentialDescription {
  state: CredentialReadState;
  provider: TransportProvider | null;
  owner: CredentialOwner | null;
  accountRef: string | null;
  apiVersion: string | null;
  connectedAt: string | null;
  /** The sentence the page prints. Always populated. */
  words: string;
}

/** What the SEND PATH gets. Holds a plaintext token, for one call. */
export interface ResolvedCredential {
  state: CredentialReadState;
  credential: TransportCredential | null;
  words: string;
}

/**
 * The environment variables a PLATFORM-path credential comes from.
 *
 * Named here rather than read inline so the absence of one is a stated fact
 * with a name, and so `describe()` can say WHICH secret is missing instead of
 * "not configured".
 */
export const PLATFORM_CREDENTIAL_ENV: Record<TransportProvider, string> = {
  meta_cloud: "META_WHATSAPP_SYSTEM_TOKEN",
  twilio: "TWILIO_AUTH_TOKEN",
};

@Injectable()
export class TextCredentialsService {
  private readonly logger = new Logger(TextCredentialsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: TokenCryptoService,
    private readonly config: ConfigService,
  ) {}

  private get sb() {
    return this.db.client;
  }

  /** The row, or the reason there is none. Shared by both public methods. */
  private async readRow(
    restaurantId: string,
    senderId: string,
  ): Promise<
    | { ok: true; row: Record<string, unknown> | null }
    | { ok: false; reason: string }
  > {
    const { data, error } = await this.sb
      .from("house_text_sender_credentials")
      .select(CREDENTIAL_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .eq("sender_id", senderId)
      .is("revoked_at", null)
      .maybeSingle();

    if (error) {
      // supabase-js resolves `{ data, error }` and never throws, so a caller
      // that ignored `error` here would turn an outage into "this house has
      // connected nothing" — printed beside a disabled control, as a fact.
      this.logger.error(
        `house_text_sender_credentials read failed: ${error.message}`,
      );
      return { ok: false, reason: error.message };
    }
    return { ok: true, row: (data as Record<string, unknown> | null) ?? null };
  }

  /** What a page may see. */
  async describe(
    restaurantId: string,
    senderId: string,
  ): Promise<CredentialDescription> {
    const read = await this.readRow(restaurantId, senderId);
    if (!read.ok) {
      return {
        state: "unreadable",
        provider: null,
        owner: null,
        accountRef: null,
        apiVersion: null,
        connectedAt: null,
        words: `This sender's provider connection could not be read, so whether it is wired is unknown: ${read.reason}. That is not the same as it being unconnected.`,
      };
    }
    if (!read.row) {
      return {
        state: "none",
        provider: null,
        owner: null,
        accountRef: null,
        apiVersion: null,
        connectedAt: null,
        words:
          "No provider account is connected to this sender. The registration is recorded; the account that would carry the message is not.",
      };
    }

    const row = read.row;
    const provider = row.provider as TransportProvider;
    const owner = row.owner as CredentialOwner;
    const usable = this.usability(row);

    return {
      state: usable.ok ? "ready" : "unusable",
      provider,
      owner,
      accountRef: (row.account_ref as string | null) ?? null,
      apiVersion: (row.api_version as string | null) ?? null,
      connectedAt: (row.connected_at as string | null) ?? null,
      words: usable.ok
        ? owner === "house"
          ? "This house's own provider account is connected to this sender. Messages would be billed to the house by its provider, and Mudavym bills only the platform."
          : "This sender runs on Mudavym's own provider account. Messages past the plan's allowance are paid for with credits."
        : usable.reason,
    };
  }

  /** What the send path gets. */
  async resolve(
    restaurantId: string,
    senderId: string,
  ): Promise<ResolvedCredential> {
    const read = await this.readRow(restaurantId, senderId);
    if (!read.ok) {
      return {
        state: "unreadable",
        credential: null,
        words: `This sender's provider connection could not be read, so nothing was attempted: ${read.reason}.`,
      };
    }
    if (!read.row) {
      return {
        state: "none",
        credential: null,
        words:
          "No provider account is connected to this sender, so there is nothing to hand the message to. Nothing was sent and nothing was queued.",
      };
    }

    const row = read.row;
    const usable = this.usability(row);
    if (!usable.ok) {
      return { state: "unusable", credential: null, words: usable.reason };
    }

    const owner = row.owner as CredentialOwner;
    const provider = row.provider as TransportProvider;
    const token =
      owner === "house"
        ? this.crypto.tryDecrypt(row.access_token_encrypted as string | null)
        : (this.config.get<string>(PLATFORM_CREDENTIAL_ENV[provider]) ?? null);

    if (!token) {
      // Reached when `usability` said yes and the decrypt then failed, which is
      // a tampered or key-rotated ciphertext. Reported as unusable rather than
      // as an empty token, because an empty Bearer would produce a 401 from the
      // provider and the manager would be told the provider refused them.
      return {
        state: "unusable",
        credential: null,
        words:
          owner === "house"
            ? "This house's stored provider credential could not be decrypted, so nothing was attempted. The connection needs to be made again; nothing was sent."
            : `Mudavym's own ${provider} credential is not configured on this deployment, so nothing was attempted.`,
      };
    }

    return {
      state: "ready",
      credential: {
        provider,
        owner,
        accessToken: token,
        accountRef: (row.account_ref as string | null) ?? null,
        senderRef: (row.sender_ref as string | null) ?? null,
        serviceRef: (row.service_ref as string | null) ?? null,
        apiVersion: (row.api_version as string | null) ?? null,
      },
      words:
        owner === "house"
          ? "This house's own provider account carries it."
          : "Mudavym's provider account carries it.",
    };
  }

  /**
   * Can this row be used at all, without decrypting anything.
   *
   * Separated from `resolve` so `describe` can answer a page without ever
   * touching a ciphertext.
   */
  private usability(
    row: Record<string, unknown>,
  ): { ok: true } | { ok: false; reason: string } {
    const owner = row.owner as CredentialOwner;
    const provider = row.provider as TransportProvider;

    if (owner === "house") {
      if (!row.access_token_encrypted) {
        return {
          ok: false,
          reason:
            "This house's provider account is recorded but its credential is missing, so nothing can be sent through it. The connection needs to be made again.",
        };
      }
      if (!this.crypto.isConfigured) {
        // The key is a DEPLOYMENT fact and the house cannot fix it. Saying so
        // is the difference between a manager reconnecting an account that was
        // never broken and a manager telling us the page is wrong.
        return {
          ok: false,
          reason:
            "This deployment holds no encryption key, so a stored provider credential cannot be read. Nothing can be sent, and this is ours to fix rather than the house's.",
        };
      }
      const expires = row.token_expires_at as string | null;
      if (expires && Date.parse(expires) <= Date.now()) {
        return {
          ok: false,
          reason: `This house's provider credential expired on ${expires}. Nothing can be sent through it until the account is connected again.`,
        };
      }
      return { ok: true };
    }

    const envName = PLATFORM_CREDENTIAL_ENV[provider];
    if (!this.config.get<string>(envName)) {
      return {
        ok: false,
        reason: `Mudavym's own ${provider} credential (${envName}) is not configured on this deployment, so no message can leave through this sender. Nothing is queued.`,
      };
    }
    return { ok: true };
  }
}
