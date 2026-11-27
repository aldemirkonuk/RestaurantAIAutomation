/**
 * The "send a test letter" check (founder /goal 2026-11-07: "check if the
 * email comes and how"). Pure: the code, the subject that carries it, and
 * reading it back out of an arriving subject.
 *
 * THE OWNER SENDS IT, NOT MUDAVYM (the session's call under the 2026-11-07
 * /goal). The page hands the owner a `mailto:` with the house's Mudavym
 * address and a subject carrying a code; they send it from any mailbox, the
 * way a vendor would. That proves the path a vendor's letter takes, and no
 * mail leaves Mudavym for it. Rejected: Mudavym sending the letter to itself
 * from the house's sending grant — it needs a grant most houses do not have
 * yet, proves only our own loop rather than a vendor's path, and real outbound
 * mail from this path needs the founder's word.
 */

import { randomInt } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Letters and digits with no look-alikes (no 0/O, 1/I), as the migration's CHECK. */
export const TEST_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** The subject's fixed words. A vendor's letter never carries them by chance. */
export const TEST_SUBJECT_PREFIX = "Mudavym test letter";

const CODE_IN_SUBJECT = new RegExp(
  `${TEST_SUBJECT_PREFIX}\\s+([${TEST_CODE_ALPHABET}]{4}-[${TEST_CODE_ALPHABET}]{4})\\b`,
  "i",
);

/** A fresh code: `K7QM-2RZD`. */
export function newTestCode(): string {
  const pick = () =>
    Array.from(
      { length: 4 },
      () => TEST_CODE_ALPHABET[randomInt(TEST_CODE_ALPHABET.length)],
    ).join("");
  return `${pick()}-${pick()}`;
}

export function testSubject(code: string): string {
  return `${TEST_SUBJECT_PREFIX} ${code}`;
}

/**
 * The code in an arriving subject, upper-cased, or null. A reply keeps the
 * code ("Re: Mudavym test letter K7QM-2RZD"), and that still counts: the
 * letter arrived.
 */
export function testCodeIn(subject: string | null | undefined): string | null {
  // Spaces as a person types them, or a mail client folds them, are one space
  // (QA round 26, #974): "MUDAVYM  TEST  LETTER" is still the test letter.
  const m = CODE_IN_SUBJECT.exec(String(subject ?? "").replace(/\s+/g, " "));
  return m ? m[1].toUpperCase() : null;
}

/**
 * Mark a test letter arrived. Scoped twice: the house is the one the letter's
 * own recipient address resolved to, AND the code must belong to that house.
 * A code copied into a letter to another house's address matches nothing.
 *
 * Only the first arrival is kept (`.is("arrived_at", null)`; guarded by
 * test-letter-arrives.spec.ts). A later copy of a code this house already
 * holds is a `repeat`: still the house's own test letter, so the caller keeps
 * it out of the vendor pipeline (QA round 26, #974) instead of publishing it
 * as a stranger's letter.
 *
 *   marked — an open check of this house was marked arrived now
 *   repeat — this house has the code, already arrived; nothing was changed
 *   none   — not this house's code; the letter is somebody's real mail
 *
 * Throws on a failed write or read, so the caller can say it failed instead of
 * guessing either way.
 */
export async function recordTestLetterArrival(
  client: SupabaseClient,
  restaurantId: string,
  code: string,
  from: string,
  at: Date = new Date(),
): Promise<"marked" | "repeat" | "none"> {
  const { data, error } = await client
    .from("mail_setup_checks")
    .update({ arrived_at: at.toISOString(), arrived_from: from.slice(0, 320) })
    .eq("restaurant_id", restaurantId)
    .eq("code", code)
    .is("arrived_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  if (Array.isArray(data) && data.length > 0) return "marked";
  const known = await client
    .from("mail_setup_checks")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("code", code)
    .limit(1);
  if (known.error) throw new Error(known.error.message);
  return Array.isArray(known.data) && known.data.length > 0 ? "repeat" : "none";
}
