export type IntegrationProvider = "google" | "microsoft";
export type IntegrationId = "google_drive" | "excel";

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
