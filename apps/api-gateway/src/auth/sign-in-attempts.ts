import { HttpException, HttpStatus } from "@nestjs/common";
import * as crypto from "crypto";
import { normalizeEmail } from "../passkeys/sign-in-codes.service";

/**
 * Wrong passwords per address (F-510, 2026-10-09).
 *
 * The per-IP limit cannot stop many addresses guessing at ONE owner's
 * password, so this one counts by the address being signed in to. After
 * `MAX_FAILURES` wrong passwords inside `WINDOW_MS`, that address refuses
 * every password, right or wrong, until the oldest failure ages out.
 *
 * Not an existence oracle: a failure is counted for an address with no
 * account exactly as for one with an account, and the refusal is the same
 * sentence either way, sent before the account is looked up.
 *
 * In-memory and per-process, keyed by a hash of the normalised address so
 * the map never holds an address. Same honest limit as
 * `PasswordResetThrottleGuard`: a restart clears it, and two gateway
 * instances would each allow `MAX_FAILURES`. Moving it to a table is the fix
 * if the gateway ever runs more than one instance.
 */
export class SignInAttempts {
  static readonly WINDOW_MS = 15 * 60 * 1000;
  static readonly MAX_FAILURES = 10;

  // hashed address -> failure timestamps within the window
  private readonly failures = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Throws the 429 when this address has used up its wrong passwords. */
  assertOpen(email: unknown): void {
    if (this.recent(this.key(email)).length >= SignInAttempts.MAX_FAILURES) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message:
            'Too many wrong passwords for this email. Wait 15 minutes and try again, or use "Forgot password?" to set a new one.',
          code: "TOO_MANY_SIGN_IN_ATTEMPTS",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  recordFailure(email: unknown): void {
    const key = this.key(email);
    const times = this.recent(key);
    times.push(this.now());
    this.failures.set(key, times);
    if (this.failures.size > 10_000) this.sweep();
  }

  /** A right password clears the count, as it does everywhere else. */
  clear(email: unknown): void {
    this.failures.delete(this.key(email));
  }

  private recent(key: string): number[] {
    const start = this.now() - SignInAttempts.WINDOW_MS;
    return (this.failures.get(key) ?? []).filter((t) => t > start);
  }

  private sweep(): void {
    const start = this.now() - SignInAttempts.WINDOW_MS;
    for (const [key, times] of this.failures) {
      if (times.every((t) => t <= start)) this.failures.delete(key);
    }
  }

  private key(email: unknown): string {
    return crypto
      .createHash("sha256")
      .update(normalizeEmail(email))
      .digest("hex");
  }
}
