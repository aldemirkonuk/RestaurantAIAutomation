/**
 * The house's own archive of its mail — the three answers, the layout, and the
 * words each state says (ADR 0118 D16, founder 2026-09-05).
 *
 * Nothing here talks to a database, to Google or to Nest, so every sentence and
 * every path rule below is testable without any of them. The consent screen
 * reads these strings through `/communications/retention/disclosure` and never
 * composes its own — the same rule `AuthorizeIntegration.tsx` already follows
 * for the scope list and the retention figure, for the same reason: a page that
 * writes its own privacy sentence is right on the day it is written.
 */

/** The three answers a house can give. `none` is today's behaviour, stated. */
export const HOUSE_MAIL_ARCHIVE_MODES = [
  "own_cloud",
  "mudavym_archive",
  "none",
] as const;

export type HouseMailArchiveMode = (typeof HOUSE_MAIL_ARCHIVE_MODES)[number];

/** Where an export lands. One per mode that actually writes bytes. */
export const HOUSE_MAIL_EXPORT_DESTINATIONS = [
  "own_cloud_google_drive",
  "mudavym_archive",
] as const;

export type HouseMailExportDestination =
  (typeof HOUSE_MAIL_EXPORT_DESTINATIONS)[number];

/** The seal's action names. One seal approves one act, never a session. */
export const ARCHIVE_ARM_ACTION = "house_mail_archive.choose";
export const ARCHIVE_EXPORT_ACTION = "house_mail_archive.export";

/**
 * The integration whose grant carries an `own_cloud` export.
 *
 * MEASURED, NOT ASSUMED (2026-09-05). `google_drive`'s consented scope list is
 * `https://www.googleapis.com/auth/drive.file`, `openid` and `email`
 * (`integrations-oauth.constants.ts:94-112`), and `drive.file` is Google's
 * create-and-manage scope for files the app itself creates. It CAN create a
 * folder and write a file, and it can read back only what it wrote — which is
 * exactly the read this export needs to verify its own upload. No scope is
 * widened by this build, and none is asked for.
 */
export const ARCHIVE_DRIVE_INTEGRATION_ID = "google_drive" as const;

/**
 * The top-level folder in the house's own Drive. One name, fixed, so a person
 * looking for their mail finds one place rather than a folder per release.
 */
export const ARCHIVE_ROOT_FOLDER_NAME = "Mudavym mail archive";

/** The archive format's own version, written into every exported document. */
export const ARCHIVE_FORMAT_VERSION = 1;

/**
 * THE LAYOUT, DOCUMENTED HERE BECAUSE THE HOUSE HAS TO READ IT WITHOUT US.
 *
 *   Mudavym mail archive/
 *     <restaurant name> (<restaurant id>)/
 *       <vendor>/
 *         <YYYY-MM>/
 *           <conversation id>.json
 *
 * ONE FILE PER CONVERSATION, and it holds everything: the body exactly as it
 * arrived, the headers verbatim, and every attachment inline as base64 with its
 * own sha256. Splitting the attachments into sibling objects was the first
 * shape and it was dropped for a reason worth stating — the export's guarantee
 * is a CONTENT HASH read back out of the house's storage, and a hash over a
 * document whose attachments live elsewhere proves the text arrived and says
 * nothing about the bytes. One file, one hash, one verification.
 *
 * The month folder is the mail's `received_at` in UTC, falling back to
 * `created_at`, so a conversation lands in the month it ARRIVED rather than the
 * month it was exported.
 */
export const ARCHIVE_LAYOUT_DESCRIPTION =
  "Mudavym mail archive/<restaurant> (<id>)/<vendor>/<YYYY-MM>/<conversation id>.json — one JSON document per vendor reply, holding the body exactly as it arrived, the headers verbatim, and every attachment inline as base64 with its own sha256, plus a manifest naming the retention rule the copy was made under.";

/**
 * Fold a name into a Drive-safe folder segment.
 *
 * Drive itself accepts almost anything in a name, so this is not an escaping
 * requirement — it is a legibility one: the segment goes into a path a person
 * types and a script globs. A name that folds to nothing gets a stated
 * fallback rather than an empty segment, because a path with `//` in it is a
 * path nobody can name.
 */
export function archiveSegment(raw: string | null | undefined): string {
  const folded = String(raw ?? "")
    .normalize("NFKD")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return folded.length ? folded : "unnamed";
}

/** `YYYY-MM` in UTC, from an ISO timestamp. */
export function archiveMonth(iso: string | null | undefined): string {
  const at = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(at)) return "undated";
  return new Date(at).toISOString().slice(0, 7);
}

/**
 * THE OD-23 REFUSAL, IN THE ONE PLACE IT IS WRITTEN.
 *
 * The founder chose to offer a Mudavym-kept archive on a billed tier. Nobody
 * has decided what it costs or who pays — that is OD-23, and it is open. This
 * build therefore records a house's choice of the paid archive and REFUSES to
 * arm it, in these words, on every path: the settings write, the export run,
 * and the consent screen. The one outcome that is never produced is a silent
 * free tier, because a tier that quietly costs nothing is a promise nobody
 * priced and a bill somebody eventually gets.
 */
export const ARCHIVE_PAID_TIER_REFUSAL =
  "Mudavym's own archive is a paid tier and its price is not decided: OD-23 (the revenue target and pricing, still the founder's call) is open, and no ADR fixes a figure. This house's choice of the Mudavym archive is recorded and the archive is NOT armed - nothing is being kept past the window, and nothing is being billed. Arming it without a price would be a free tier nobody agreed to give away, and a bill this house never saw coming.";

/**
 * What the consent screen prints about the archive. One object, keyed by the
 * state the house is actually in, so the page renders a sentence rather than
 * choosing one.
 */
export const ARCHIVE_DISCLOSURE_COPY = {
  intro:
    "You can also keep the mail itself, past the window, in storage this restaurant controls. Two ways are offered and neither is on by default.",
  ownCloudOffer:
    "Export it to this restaurant's own cloud. Every mirrored reply - the body, the headers and any attachment - is written as one file into a folder in the Google Drive this restaurant has already connected, and read back and checked before Mudavym deletes its copy. The files are the restaurant's own: they stay in that Drive when the grant is disconnected, when the window ends, and if this restaurant stops using Mudavym altogether.",
  mudavymOffer:
    "Or Mudavym keeps it past the window in an archive of its own, and bills for the storage. This is not switched on: see below.",
  noneOffer:
    "Or neither, which is what happens if nothing is chosen: the mail is deleted when the window runs out and no copy of it exists outside your own mailbox.",
  /**
   * Türkiye is not a footnote here. TTK 6102 Art. 82(1)(b) requires a trader to
   * keep the commercial letters it RECEIVED for ten years, and ADR 0118 D14
   * records that a vendor's reply about an order is squarely inside that. With
   * no archive configured, Mudavym deletes its mirror on the window and the
   * house's own compliance rests on the mailbox the mail was read from - which
   * the house must be TOLD, not left to assume.
   */
  turkiyeWithoutArchive:
    "This restaurant's rule is Türkiye's, and TTK 6102 Art. 82 requires a trader to keep the commercial letters it received for ten years. Mudavym holds a mirror, not the original, and deletes that mirror when the window ends - so with no archive configured, the copy that satisfies that duty is the one still in the mailbox this mail was read from. Keeping it is this restaurant's own responsibility, and nothing here does it for you.",
  turkiyeWithArchive:
    "This restaurant's rule is Türkiye's, and TTK 6102 Art. 82 requires a trader to keep the commercial letters it received for ten years. With the archive armed, every mirrored reply is written into storage this restaurant controls before Mudavym deletes its copy, and that exported file is the one this restaurant keeps for those ten years.",
  neverAsked:
    "Nobody has chosen for this restaurant yet, so the third answer applies: the mail is deleted when the window runs out and nothing is exported. That is a default, not a decision, and it is stated here rather than left silent.",
} as const;
