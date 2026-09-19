/**
 * Can this number receive a text? (ADR 0121 P0 item 2.)
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * ADR 0121's P0 names the gap in one sentence: *"`provider_contacts.phone_type`
 * already exists and defaults to `'main_line'`; nothing sets it. A text sender
 * that cannot tell a landline from a mobile will text a landline."*
 *
 * Both halves were true when it was written. `provider_contacts.phone_type` is
 * declared `text DEFAULT 'main_line'` in the production baseline
 * (`supabase/migrations/20260805000000_baseline_from_production.sql:4677`) and
 * no gateway write path passed it: `addProviderContact` and
 * `updateProviderContact` built their payloads without the column, so every row
 * in the book acquired `'main_line'` from the default whatever the vendor's
 * number actually was. The web sheet's picker
 * (`EditProviderModal.tsx:1504`) wrote to local state that never reached the
 * server.
 *
 * THE DEFAULT IS THE FAULT, AND IT IS NOT REPAIRABLE BY READING HARDER
 * --------------------------------------------------------------------
 * A row carrying `'main_line'` may be a value a manager chose or a value the
 * column invented — the two are byte-identical and no query can separate them.
 * That is [[absence-reported-as-health]] in the column: an unanswered question
 * wearing the costume of an answer.
 *
 * So this file does not pretend to recover the answer. It returns TWO facts,
 * never one:
 *
 *   `reach`   what we would do about it — mobile, landline, or unstated.
 *   `stated`  whether a person actually said so.
 *
 * and `'main_line'` is the one value that comes back `landline` with
 * `stated: false`. The direction of that reading is deliberate: reading an
 * unchosen value as a LANDLINE withholds a text, and reading it as a mobile
 * would send one to a desk phone. A withheld text is recoverable by asking the
 * house; a text read aloud by a switchboard is not.
 *
 * WHAT FIXES IT GOING FORWARD, WITHOUT A MIGRATION
 * ------------------------------------------------
 * The write path now names the column on every insert and update, and passes
 * an explicit `null` when the caller said nothing. An explicit NULL is not the
 * default — PostgREST sends the key, so Postgres does not substitute — which
 * makes "nobody has said" expressible for the first time and distinguishable
 * from "somebody said main line". Old rows keep whatever they hold and are
 * reported as `stated: false`; nothing is backfilled, because inventing the
 * answer is the fault this file is about.
 */

/**
 * The vocabulary the vendor sheet offers (`EditProviderModal.tsx:79`).
 *
 * `mobile` is accepted as a synonym of `cell` because it is the word a US
 * carrier and a Turkish operator both use, and a value the API accepts but the
 * sheet never sends would otherwise be a silent rejection.
 */
export const PHONE_TYPES = [
  "main_line",
  "cell",
  "mobile",
  "direct",
  "whatsapp",
  "fax",
  "office",
] as const;

export type PhoneType = (typeof PHONE_TYPES)[number];

/** What we may do with the number. Three values, never two. */
export type PhoneReach = "mobile" | "landline" | "unstated";

export interface PhoneReachability {
  /** The stored value, verbatim, or `null`. Never normalised away. */
  phoneType: string | null;
  reach: PhoneReach;
  /**
   * True only when a person chose this. `'main_line'` is `false` because it is
   * the column's DEFAULT and a chosen one is indistinguishable from an
   * invented one.
   */
  stated: boolean;
  /** The sentence a surface shows. Always populated, never a bare code. */
  says: string;
}

/**
 * The one value the column invents on its own
 * (`baseline_from_production.sql:4677`). Exported so a test can fail if the
 * default ever changes underneath this reading rather than silently agreeing
 * with a new one.
 */
export const PHONE_TYPE_COLUMN_DEFAULT = "main_line";

const MOBILE: ReadonlySet<string> = new Set(["cell", "mobile", "whatsapp"]);
const LANDLINE: ReadonlySet<string> = new Set([
  "main_line",
  "direct",
  "fax",
  "office",
]);

/** Is this a value the API will store? Anything else is refused, not coerced. */
export function isPhoneType(value: unknown): value is PhoneType {
  return (
    typeof value === "string" && (PHONE_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Classify one stored `phone_type`.
 *
 * Takes `unknown` because the value arrives off a database row: an `as string`
 * here would turn a column renamed underneath us into `undefined` flowing on as
 * though it were data.
 */
export function phoneReachability(value: unknown): PhoneReachability {
  const raw = typeof value === "string" && value.length > 0 ? value : null;

  if (raw === null) {
    return {
      phoneType: null,
      reach: "unstated",
      stated: false,
      says: "Nobody has said whether this is a mobile or a landline, so nothing is texted to it. Set the number's type on the vendor's contact sheet.",
    };
  }

  const normalised = raw.trim().toLowerCase();

  if (MOBILE.has(normalised)) {
    return {
      phoneType: raw,
      reach: "mobile",
      stated: true,
      says: `Recorded as a ${normalised === "whatsapp" ? "WhatsApp number" : "mobile"}, so a text can reach it.`,
    };
  }

  if (normalised === PHONE_TYPE_COLUMN_DEFAULT) {
    return {
      phoneType: raw,
      // Landline, deliberately: withholding a text is recoverable and texting a
      // switchboard is not.
      reach: "landline",
      // NOT stated. `main_line` is what the column writes when nobody answers,
      // so a row carrying it is not evidence that anybody did.
      stated: false,
      says: "This number is recorded as a main line, which is also what the book writes when nobody has said. Nothing is texted to it until somebody confirms the type on the vendor's contact sheet.",
    };
  }

  if (LANDLINE.has(normalised)) {
    return {
      phoneType: raw,
      reach: "landline",
      stated: true,
      says: `Recorded as a ${normalised === "fax" ? "fax line" : normalised === "office" ? "office line" : "direct line"}, so a text is not sent to it.`,
    };
  }

  // A value outside the vocabulary. NOT folded into landline: the honest answer
  // is that we do not recognise it, and a surface that said "landline" would be
  // asserting something nobody wrote.
  return {
    phoneType: raw,
    reach: "unstated",
    stated: false,
    says: `This number's type is recorded as "${raw}", which this build does not recognise, so nothing is texted to it.`,
  };
}

/** Shorthand for the send path: may a text be addressed to this number? */
export function isTextable(value: unknown): boolean {
  return phoneReachability(value).reach === "mobile";
}
