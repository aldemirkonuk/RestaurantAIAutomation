import { Logger } from "@nestjs/common";

/**
 * A password reset retires every passkey of the account (ADR 0229; the
 * founder, 2026-09-26, round 6, item 37, verbatim: "password reset RETIRES
 * every passkey (kept as revoked, not deleted)").
 *
 * Why: a passkey is a sign-in method (item 29). Someone who got into the
 * account can add one within ten minutes of signing in, and a reset that only
 * changed the password would leave that door open. A reset is the owner taking
 * the account back through the mailbox, so it closes every door the account
 * had except the new password (and Google, and the emailed code, which both
 * run through the same mailbox).
 *
 * How:
 *   * Rows are never deleted: `revoked_at` = now and `revoked_by` = the
 *     account itself. A reset is made from no session -- the proof is the
 *     emailed link, which only the account's mailbox received -- so the
 *     account is the actor. The cause is written where it can be read back:
 *     one `system_audit_log` row per retired passkey, action
 *     `passkey_revoked`, `reason` `password_reset`.
 *   * One compare-and-set statement (`revoked_at is null`): a passkey removed
 *     a moment earlier on /profile keeps its own time and actor.
 *   * A failed write THROWS -- the caller must not report a reset whose
 *     passkeys still sign in. A failed audit row is logged and counted, never
 *     thrown: the passkeys are already retired.
 *
 * Lives in `passkeys/` so the knowledge of the table stays here, but takes the
 * database client as an argument: `AuthService` calls it, and `PasskeysModule`
 * already imports `AuthModule`, so injecting `PasskeysService` there would be a
 * module cycle.
 */

export const PASSWORD_RESET_REASON = "password_reset";

export interface RetiredPasskeys {
  /** How many live passkeys this call retired (0 when there were none). */
  retired: number;
  /** How many of those got their audit row. */
  audited: number;
}

interface RetireDb {
  from(table: string): any;
}

const logger = new Logger("RetirePasskeys");

export async function retireEveryPasskey(
  db: RetireDb,
  userId: string,
  reason: typeof PASSWORD_RESET_REASON,
  now: Date = new Date(),
): Promise<RetiredPasskeys> {
  const revokedAt = now.toISOString();
  const { data, error } = await db
    .from("user_passkeys")
    .update({ revoked_at: revokedAt, revoked_by: userId })
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("id, nickname, device_type, backed_up, rp_id, revoked_at");
  if (error) {
    throw new Error(
      `the passkeys of ${userId} could not be retired: ${error.message}`,
    );
  }
  const rows = (data as Array<Record<string, unknown>> | null) ?? [];

  let audited = 0;
  for (const row of rows) {
    try {
      const { error: auditError } = await db.from("system_audit_log").insert({
        actor_type: "user",
        actor_id: userId,
        action: "passkey_revoked",
        entity_type: "user_passkey",
        entity_id: row.id,
        changes: {
          nickname: row.nickname ?? null,
          device_type: row.device_type ?? null,
          backed_up: row.backed_up ?? null,
          rp_id: row.rp_id ?? null,
          revoked_at: row.revoked_at ?? revokedAt,
        },
        restaurant_id: null,
        reason,
      });
      if (auditError) {
        logger.error(
          `passkey ${String(row.id)} was retired by a ${reason} but the audit row failed: ${auditError.message}`,
        );
      } else {
        audited += 1;
      }
    } catch (e) {
      logger.error(
        `passkey ${String(row.id)} was retired by a ${reason} but the audit row threw: ${(e as Error).message}`,
      );
    }
  }
  return { retired: rows.length, audited };
}
