/**
 * What the retention sweep needs from the archive, and the token it asks by.
 *
 * WHY THIS FILE EXISTS, MEASURED RATHER THAN ASSUMED
 * -------------------------------------------------
 * The first shape had `raw-mail-retention.service.ts` import
 * `HouseMailArchiveService` directly. `check_gateway_boots.sh` refused it:
 *
 *   ReferenceError: Cannot access 'IntegrationsOauthService' before initialization
 *     at communications/archive/house-mail-archive.service.js:812
 *     at communications/retention/raw-mail-retention.service.js:25
 *
 * The ring closes at NODE's require time, not Nest's:
 *
 *   integrations-oauth.service  ->  raw-mail-retention.service   (ADR 0118 D15:
 *                                   revoking a grant deletes the mirrored mail)
 *   raw-mail-retention.service  ->  house-mail-archive.service   (D16: the sweep
 *                                   asks which replies have a copy)
 *   house-mail-archive.service  ->  integrations-oauth.service   (D16: the export
 *                                   writes through the Drive grant)
 *
 * `forwardRef` cannot open it — that defers Nest's dependency graph and does
 * nothing about `require`. What breaks it is removing ONE edge, and this is the
 * cheapest of the three: the sweep needs four methods, not a class. This file
 * declares them and a token, imports nothing at all, and is therefore a leaf in
 * the require graph.
 *
 * `emitDecoratorMetadata` is why the token is needed rather than just an
 * `import type`: a type-only parameter type is emitted as `Object`, which Nest
 * cannot resolve. `@Inject(HOUSE_MAIL_ARCHIVE)` names the provider explicitly.
 *
 * NO INDEX SIGNATURE ON ANY RETURN SHAPE. The first draft wrote
 * `[key: string]: unknown` on two of them "to allow the richer real objects
 * through", and it does the opposite: an interface without an index signature is
 * NOT assignable to one with it, so `implements HouseMailArchivePort` failed
 * with TS2416 on both. Width subtyping already does the job — the service's
 * fuller `ArchiveSettings` and `ArchiveExportRun` satisfy these narrow shapes
 * because they have MORE fields, not fewer.
 */

/** The injection token. A string, so a stack trace names it in words. */
export const HOUSE_MAIL_ARCHIVE = "HOUSE_MAIL_ARCHIVE";

/** The three answers a house can give (ADR 0118 D16). */
export type ArchiveMode = "own_cloud" | "mudavym_archive" | "none";

/**
 * The subset of `HouseMailArchiveService` the retention sweep uses. Every method
 * here THROWS on a failed read rather than returning an empty answer — a sweep
 * that cannot tell whether a copy exists must refuse, not guess.
 */
export interface HouseMailArchivePort {
  settingsFor(restaurantId: string): Promise<{
    mode: ArchiveMode;
    chosen: boolean;
    armed: boolean;
    says: string;
  }>;

  /** Which of these conversations have a VERIFIED copy in the house's archive. */
  exportedAmong(
    conversationIds: string[],
    destination?: string,
  ): Promise<Set<string>>;

  /** One last export before a revocation deletes. Never blocks the deletion. */
  runExport(params: {
    restaurantId: string;
    trigger: "scheduled" | "requested" | "revocation";
    sealId?: string | null;
    conversationIds?: string[];
  }): Promise<{
    considered: number;
    exported: number;
    failed: number;
  }>;

  /** The archive half of the consent screen's disclosure. */
  disclosureFor(
    restaurantId: string,
    jurisdiction: string,
  ): Promise<{
    mode: ArchiveMode;
    chosen: boolean;
    armed: boolean;
    says: string;
    intro: string;
    options: { ownCloud: string; mudavym: string; none: string };
    paidTierRefusal: string | null;
    jurisdictionNote: string | null;
    layout: string;
  }>;
}
