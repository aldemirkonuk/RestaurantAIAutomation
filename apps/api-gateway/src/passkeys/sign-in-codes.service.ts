import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
} from "@nestjs/common";
import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { resolveJwtSecret } from "../auth/jwt-secret";
import { DatabaseService } from "../database/database.service";
import { GmailService } from "../communications/gmail.service";
import { signInCodeEmailTemplate } from "../communications/email-templates/sign-in-code.template";

/**
 * Emailed one-time codes (ADR 0229, Proposed; founder 2026-09-25, item 29).
 *
 * THE FOUNDER, confirmed reading: "logged-out with no passkey -> emailed
 * one-time code; enrolling while signed in: signed in within last 10 min =
 * direct, else email code first." Two purposes, one mechanism:
 *
 *   * `sign_in` -- signed out, no passkey on this device. The address is typed
 *     by a stranger, so every answer is the same whether or not it has an
 *     account (below).
 *   * `step_up` -- signed in, proving it is you before a passkey is added. The
 *     address is the account's own, read from the row, never from the body.
 *
 * THE RULES, and why each number:
 *   * Six digits (`randomInt`, a CSPRNG), ten minutes, single use. Six is the
 *     floor NIST SP 800-63B sets for an out-of-band secret and what a phone's
 *     `one-time-code` autofill expects.
 *   * Five wrong tries per code, then that code is dead.
 *   * Twenty wrong tries per address per day across all its codes, then no
 *     code for that address is issued or checked until the day rolls. That
 *     caps an online guesser at 20 in 1,000,000 a day (NIST's ceiling is 100
 *     consecutive failures); the lock touches only this path -- password,
 *     Google and passkeys still work.
 *   * Five codes per address per hour; twenty per requesting address per hour.
 *   * Stored as HMAC-SHA256 under a key derived from the JWT secret, compared
 *     in constant time. A plain hash of six digits is a million guesses away.
 *   * A newer code supersedes older live ones for the same address and purpose.
 *
 * ENUMERATION: `issue('sign_in')` writes a row and returns the same sentence
 * for an address with no account (user_id null, no mail sent), so the limits
 * trip identically either way; the mail is not awaited, so the response time
 * does not say whether one was sent; `verify` gives one refusal sentence for a
 * wrong code, an expired code, and an address with no account.
 */

export const CODE_DIGITS = 6;
export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS_PER_CODE = 5;
export const MAX_FAILED_PER_EMAIL_PER_DAY = 20;
export const MAX_CODES_PER_EMAIL_PER_HOUR = 5;
export const MAX_CODES_PER_SOURCE_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SWEEP_AFTER_MS = 2 * DAY_MS;

export type CodePurpose = "sign_in" | "step_up";

/** The one refusal a wrong, expired, superseded or accountless code gets. */
export const CODE_REFUSAL =
  "That code is not right, or it has expired. Check the newest email from Mudavym, or ask for a new code.";
export const CODE_SPENT =
  "That code was tried too many times and no longer works. Ask for a new code.";
export const DAILY_LOCK =
  "Too many wrong codes for this address today. Sign in another way, or try again tomorrow.";
export const ADDRESS_BUSY =
  "Several codes were already sent to this address in the last hour. Use the newest one, or wait a little and ask again.";
export const SOURCE_BUSY =
  "Too many codes were asked for from this connection. Wait a little and try again.";
export const SIGN_IN_SENT =
  "If an account uses that address, a six-digit code is on its way. It works for ten minutes.";

export function normalizeEmail(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().toLowerCase();
}

interface CodeRow {
  id: string;
  email: string;
  user_id: string | null;
  purpose: CodePurpose;
  code_hash: string;
  attempts: number;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

const CODE_COLUMNS =
  "id, email, user_id, purpose, code_hash, attempts, created_at, expires_at, consumed_at";

@Injectable()
export class SignInCodesService {
  private readonly logger = new Logger(SignInCodesService.name);
  private keyCache: Buffer | null = null;

  constructor(
    private readonly databaseService: DatabaseService,
    @Optional() private readonly gmail?: GmailService,
  ) {}

  private get db() {
    return this.databaseService.client;
  }

  /** Tests may fix the clock; production reads it. */
  now: () => number = () => Date.now();

  private key(): Buffer {
    if (!this.keyCache) {
      this.keyCache = createHmac(
        "sha256",
        resolveJwtSecret(process.env.JWT_SECRET),
      )
        .update("mudavym/sign-in-code/v1")
        .digest();
    }
    return this.keyCache;
  }

  hashCode(purpose: CodePurpose, email: string, code: string): string {
    return createHmac("sha256", this.key())
      .update(`${purpose}\n${email}\n${code}`)
      .digest("hex");
  }

  /** A keyed hash of the caller's address: counted, never kept raw. */
  hashSource(source: string | null | undefined): string | null {
    if (!source) return null;
    return createHmac("sha256", this.key())
      .update(`source\n${source}`)
      .digest("hex");
  }

  /* ── issuing ─────────────────────────────────────────────────────────── */

  /**
   * Signed out: email a code to whoever holds this address. The answer never
   * says whether the address has an account.
   */
  async issueForSignIn(
    emailRaw: unknown,
    source: string | null,
  ): Promise<{ sent: true; message: string; expiresInSeconds: number }> {
    const email = normalizeEmail(emailRaw);
    if (!email.includes("@") || email.length < 3 || email.length > 320) {
      throw new BadRequestException("Type the email address you sign in with.");
    }
    const { data: user, error } = await this.db
      .from("users")
      .select("user_id, name, email")
      .eq("email", email)
      .maybeSingle();
    if (error) {
      // Not an answer about the address: every address gets this on a failed read.
      throw new InternalServerErrorException(
        "We could not send a code just now. Nothing was sent; try again.",
      );
    }
    const person = user as { user_id: string; name: string | null } | null;
    const code = await this.store(
      "sign_in",
      email,
      person?.user_id ?? null,
      source,
    );
    if (person) {
      // Deliberately not awaited: the response time must not say whether a
      // mail went out. A failed send is logged; the person can ask again.
      void this.send(email, person.name, code, "sign_in").catch(() => false);
    }
    return {
      sent: true,
      message: SIGN_IN_SENT,
      expiresInSeconds: CODE_TTL_MS / 1000,
    };
  }

  /**
   * Signed in, proving it is you: the code goes to the account's own address,
   * read from the row. Awaited and reported -- the person is signed in, so
   * there is nothing to enumerate, and "sent" must be true.
   */
  async issueForStepUp(
    userId: string,
    source: string | null,
  ): Promise<{ sent: boolean; sentTo: string; expiresInSeconds: number }> {
    const { data: user, error } = await this.db
      .from("users")
      .select("user_id, name, email")
      .eq("user_id", userId)
      .maybeSingle();
    const person = user as {
      user_id: string;
      name: string | null;
      email: string | null;
    } | null;
    if (error || !person) {
      throw new InternalServerErrorException(
        "Your account could not be read, so no code was sent.",
      );
    }
    const email = normalizeEmail(person.email);
    if (!email) {
      throw new BadRequestException(
        "This account has no email address to send a code to.",
      );
    }
    const code = await this.store("step_up", email, person.user_id, source);
    const sent = await this.send(email, person.name, code, "step_up");
    if (!sent) {
      throw new HttpException(
        "The code could not be emailed just now. Nothing was added; try again in a minute.",
        HttpStatus.BAD_GATEWAY,
      );
    }
    return {
      sent: true,
      sentTo: maskEmail(email),
      expiresInSeconds: CODE_TTL_MS / 1000,
    };
  }

  private async store(
    purpose: CodePurpose,
    email: string,
    userId: string | null,
    source: string | null,
  ): Promise<string> {
    const now = this.now();
    const sourceHash = this.hashSource(source);

    // Housekeeping, best effort.
    await this.db
      .from("sign_in_codes")
      .delete()
      .lt("created_at", new Date(now - SWEEP_AFTER_MS).toISOString());

    const recent = await this.recentForEmail(email, now);
    this.assertNotLockedForTheDay(recent, now);
    const lastHour = recent.filter(
      (r) => new Date(r.created_at).getTime() > now - HOUR_MS,
    );
    if (lastHour.length >= MAX_CODES_PER_EMAIL_PER_HOUR) {
      throw new HttpException(ADDRESS_BUSY, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (sourceHash) {
      const { data: fromSource, error } = await this.db
        .from("sign_in_codes")
        .select("id")
        .eq("requested_from", sourceHash)
        .gte("created_at", new Date(now - HOUR_MS).toISOString());
      if (error) {
        throw new InternalServerErrorException(
          "We could not send a code just now. Nothing was sent; try again.",
        );
      }
      if (
        ((fromSource as unknown[]) ?? []).length >=
        MAX_CODES_PER_SOURCE_PER_HOUR
      ) {
        throw new HttpException(SOURCE_BUSY, HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    // A newer code supersedes the older live ones for this address and purpose.
    await this.db
      .from("sign_in_codes")
      .update({ expires_at: new Date(now).toISOString() })
      .eq("email", email)
      .eq("purpose", purpose)
      .is("consumed_at", null)
      .gt("expires_at", new Date(now).toISOString());

    const code = String(randomInt(0, 10 ** CODE_DIGITS)).padStart(
      CODE_DIGITS,
      "0",
    );
    const { error } = await this.db.from("sign_in_codes").insert({
      email,
      user_id: userId,
      purpose,
      code_hash: this.hashCode(purpose, email, code),
      attempts: 0,
      requested_from: sourceHash,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + CODE_TTL_MS).toISOString(),
    });
    if (error) {
      this.logger.error(`Could not store a ${purpose} code: ${error.message}`);
      throw new InternalServerErrorException(
        "We could not send a code just now. Nothing was sent; try again.",
      );
    }
    return code;
  }

  private async send(
    email: string,
    name: string | null,
    code: string,
    purpose: CodePurpose,
  ): Promise<boolean> {
    if (!this.gmail) {
      this.logger.error(`No mail service: a ${purpose} code was not sent.`);
      return false;
    }
    try {
      const result = await this.gmail.sendEmail({
        to: [email],
        subject:
          purpose === "sign_in"
            ? `${code} is your Mudavym sign-in code`
            : `${code} is your Mudavym confirmation code`,
        html: signInCodeEmailTemplate({ name, code, purpose }),
      });
      if (!result.success) {
        this.logger.warn(
          `A ${purpose} code was not delivered: ${result.error}`,
        );
        return false;
      }
      return true;
    } catch (e) {
      this.logger.error(
        `A ${purpose} code could not be sent: ${(e as Error).message}`,
      );
      return false;
    }
  }

  /* ── checking ────────────────────────────────────────────────────────── */

  /**
   * Check a code. Returns the account it signs in (sign_in) or proves (step_up).
   * For step_up the code must belong to `expectedUserId`.
   */
  async verify(
    purpose: CodePurpose,
    emailRaw: unknown,
    codeRaw: unknown,
    expectedUserId: string | null = null,
  ): Promise<string> {
    const email = normalizeEmail(emailRaw);
    const code = typeof codeRaw === "string" ? codeRaw.replace(/\s+/g, "") : "";
    if (!email || !new RegExp(`^\\d{${CODE_DIGITS}}$`).test(code)) {
      throw new BadRequestException(
        `Type the ${CODE_DIGITS}-digit code from the email.`,
      );
    }
    const now = this.now();
    const recent = await this.recentForEmail(email, now);
    this.assertNotLockedForTheDay(recent, now);

    const live = recent
      .filter((r) => r.purpose === purpose && !r.consumed_at)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (!live || new Date(live.expires_at).getTime() <= now) {
      throw new BadRequestException(CODE_REFUSAL);
    }
    if (live.attempts >= MAX_ATTEMPTS_PER_CODE) {
      throw new BadRequestException(CODE_SPENT);
    }

    const expected = Buffer.from(live.code_hash, "hex");
    const given = Buffer.from(this.hashCode(purpose, email, code), "hex");
    const matches =
      expected.length === given.length && timingSafeEqual(expected, given);

    if (!matches) {
      // Compare-and-set on the count, so two racing guesses cannot share one.
      await this.db
        .from("sign_in_codes")
        .update({ attempts: live.attempts + 1 })
        .eq("id", live.id)
        .eq("attempts", live.attempts);
      throw new BadRequestException(
        live.attempts + 1 >= MAX_ATTEMPTS_PER_CODE ? CODE_SPENT : CODE_REFUSAL,
      );
    }

    // Consume once: only the request that flips consumed_at from null wins.
    const { data: consumed, error } = await this.db
      .from("sign_in_codes")
      .update({ consumed_at: new Date(now).toISOString() })
      .eq("id", live.id)
      .is("consumed_at", null)
      .select("id, user_id")
      .maybeSingle();
    if (error) {
      throw new InternalServerErrorException(
        "The code could not be checked just now. Nothing was done; try again.",
      );
    }
    const row = consumed as { id: string; user_id: string | null } | null;
    // No account at this address, or another request used the code first.
    if (!row || !row.user_id) throw new BadRequestException(CODE_REFUSAL);
    if (expectedUserId !== null && row.user_id !== expectedUserId) {
      throw new BadRequestException(CODE_REFUSAL);
    }
    return row.user_id;
  }

  /** Step-up: the address is the account's own, read from the row. */
  async verifyStepUp(userId: string, codeRaw: unknown): Promise<void> {
    const { data: user, error } = await this.db
      .from("users")
      .select("email")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !user) {
      throw new InternalServerErrorException(
        "Your account could not be read, so the code was not checked.",
      );
    }
    await this.verify(
      "step_up",
      (user as { email: string | null }).email,
      codeRaw,
      userId,
    );
  }

  private async recentForEmail(email: string, now: number): Promise<CodeRow[]> {
    const { data, error } = await this.db
      .from("sign_in_codes")
      .select(CODE_COLUMNS)
      .eq("email", email)
      .gte("created_at", new Date(now - DAY_MS).toISOString());
    if (error) {
      throw new InternalServerErrorException(
        "Codes could not be read just now. Nothing was done; try again.",
      );
    }
    return (data as CodeRow[] | null) ?? [];
  }

  private assertNotLockedForTheDay(recent: CodeRow[], now: number): void {
    const failed = recent
      .filter((r) => new Date(r.created_at).getTime() > now - DAY_MS)
      .reduce((n, r) => n + (Number(r.attempts) || 0), 0);
    if (failed >= MAX_FAILED_PER_EMAIL_PER_DAY) {
      throw new HttpException(DAILY_LOCK, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}

/** "m•••@example.com" -- enough to recognise, not enough to harvest. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "your email address";
  return `${local.slice(0, 1)}•••@${domain}`;
}
