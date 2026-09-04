export type IntegrationProvider = "google" | "microsoft";
export type IntegrationId = "google_drive" | "excel" | "gmail_send";

export interface ScopeDisclosure {
  /** The raw scope string sent to the provider. */
  scope: string;
  /** Plain-language description shown on the authorization page. */
  label: string;
  /** Why the app needs it — users approve reasons, not scope URLs. */
  reason: string;
}

export interface IntegrationDefinition {
  id: IntegrationId;
  provider: IntegrationProvider;
  label: string;
  providerLabel: string;
  description: string;
  scopes: ScopeDisclosure[];
  /** What we never ask for, stated explicitly to make the grant legible. */
  notRequested: string[];
}

/**
 * Single source of truth for integration scopes, shared by the consent screen
 * and the authorization redirect. The UI must never invent its own scope list:
 * if the disclosure and the request drift apart, the consent is meaningless.
 *
 * Scopes are deliberately the narrowest that can do the job — `drive.file` and
 * `Files.ReadWrite` limit us to files the app itself creates or the user picks,
 * rather than the user's whole Drive/OneDrive.
 */
export const INTEGRATION_DEFINITIONS: Record<
  IntegrationId,
  IntegrationDefinition
> = {
  google_drive: {
    id: "google_drive",
    provider: "google",
    label: "Google Drive",
    providerLabel: "Google",
    description: "Save exports and menu scans to a folder in your Drive.",
    scopes: [
      {
        scope: "https://www.googleapis.com/auth/drive.file",
        label: "Create and manage files WineOps puts in your Drive",
        reason:
          "Lets us write inventory exports and scanned menus to Drive. Limited to files WineOps creates — your existing documents stay invisible to us.",
      },
      {
        scope: "openid",
        label: "Confirm which Google account you connected",
        reason:
          "So Settings can show the account name and you can spot a wrong-account connection.",
      },
      {
        scope: "email",
        label: "Read your Google account email address",
        reason: "Shown in Settings as the connected account.",
      },
    ],
    notRequested: [
      "Reading files you did not create with WineOps",
      "Your Gmail messages",
      "Deleting your Drive folders",
    ],
  },
  /**
   * The sending mailbox (founder, 2026-09-04: "add the gmail send integration
   * now"; ADR 0118).
   *
   * ONE scope, and it is the narrowest Google publishes for this job.
   * `gmail.send` can create and send a message and can do nothing else: it
   * cannot open, list, search or label a single message in the mailbox — not
   * even the ones it sent itself. `google_drive` above lists "Your Gmail
   * messages" under `notRequested` and that stays exactly true, because reading
   * mail is not what this asks for either.
   *
   * Deliberately NOT folded into `google_drive`. Widening an existing grant's
   * scope list would send every Drive-connected person back through a consent
   * screen for a power they never agreed to, and would make "connected" mean
   * two different things depending on when you connected. A separate id gets a
   * separate row (`UNIQUE (user_id, integration_id)`, 20260826170000:144), a
   * separate consent screen, and a separate disconnect.
   *
   * NO `openid` / `email`. Those are what `google_drive` uses to learn the
   * connected address for its Settings row, and they are read scopes about the
   * person. The founder's line was the send scope and nothing else, so the
   * connected address is NOT recorded for this grant and the sender line names
   * the person who consented instead of asserting an address it never read
   * (`house-sender.service.ts`). The consequence is filed in the report as a
   * founder question rather than quietly solved by asking for one more scope.
   */
  gmail_send: {
    id: "gmail_send",
    provider: "google",
    label: "Gmail — sending only",
    providerLabel: "Google",
    description:
      "Lets this house's own letters leave from your Gmail mailbox, so the envelope matches the sign-off and the vendor's reply comes back to you.",
    scopes: [
      {
        scope: "https://www.googleapis.com/auth/gmail.send",
        label: "Send mail as you — and nothing else",
        reason:
          "A letter written on /communications is sent from your mailbox instead of the address every restaurant on this deployment shares. This scope permits sending only: it grants no ability to open, read, search or list any message in your mailbox, including the letters it sends itself.",
      },
    ],
    notRequested: [
      "Reading, searching or listing any message in your mailbox",
      "Reading even the letters sent through this connection",
      "Your drafts, labels, filters, settings or contacts",
      "Deleting or changing anything already in your mailbox",
      "Sending anything on its own — every letter is written and released by a person, and can be pulled back before it leaves",
    ],
  },
  excel: {
    id: "excel",
    provider: "microsoft",
    label: "Microsoft Excel",
    providerLabel: "Microsoft",
    description: "Export inventory and reports to Excel on OneDrive.",
    scopes: [
      {
        scope: "Files.ReadWrite",
        label: "Create and edit workbooks in your OneDrive",
        reason:
          "Lets us write report workbooks and update them in place instead of making a new file every export.",
      },
      {
        scope: "User.Read",
        label: "Read your basic Microsoft profile",
        reason: "Shown in Settings as the connected account.",
      },
      {
        scope: "offline_access",
        label: "Keep the connection alive",
        reason:
          "Lets scheduled exports run without asking you to sign in to Microsoft every hour.",
      },
    ],
    notRequested: [
      "Reading your Outlook mail",
      "Access to your organisation's SharePoint sites",
      "Sending mail as you",
    ],
  },
};

export const INTEGRATION_IDS = Object.keys(
  INTEGRATION_DEFINITIONS,
) as IntegrationId[];

export function isIntegrationId(value: string): value is IntegrationId {
  return Object.prototype.hasOwnProperty.call(INTEGRATION_DEFINITIONS, value);
}

export function isIntegrationProvider(
  value: string,
): value is IntegrationProvider {
  return value === "google" || value === "microsoft";
}

/** Google needs offline_access expressed as access_type, not as a scope. */
export function scopeStringFor(definition: IntegrationDefinition): string {
  return definition.scopes.map((s) => s.scope).join(" ");
}
