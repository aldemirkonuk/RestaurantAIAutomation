export type IntegrationProvider = "google" | "microsoft";
export type IntegrationId =
  | "google_drive"
  | "excel"
  | "gmail_send"
  | "gmail_read";

export interface ScopeDisclosure {
  /** The raw scope string sent to the provider. */
  scope: string;
  /** Plain-language description shown on the authorization page. */
  label: string;
  /** Why the app needs it — users approve reasons, not scope URLs. */
  reason: string;
}

/**
 * What happens to what we fetch, in the four questions a person actually has.
 *
 * A scope list answers "what may this app touch?" and stops there. The founder's
 * rule for the read grant (2026-09-04) is that *everything valuable is welcome
 * but no person's privacy is touched by surprise*, and "by surprise" is decided
 * by the three questions a scope URL cannot answer: what we deliberately do NOT
 * fetch even though the scope would permit it, where what we do fetch is
 * written, and who can then read it.
 *
 * REQUIRED on every definition, not optional. An optional field would be
 * present on the one grant whose author thought about it and absent on the
 * others, and a reader cannot tell "this grant stores nothing" from "nobody
 * wrote the sentence" — which is this repo's named cardinal fault applied to a
 * consent screen. `every-grant-says-where-the-data-lands.spec.ts` fails the
 * build if any of the four is blank.
 */
export interface DataHandlingDisclosure {
  /** What is actually fetched, in words. Narrower than the scope, usually. */
  reads: string;
  /** What the scope would permit and we deliberately never ask for. */
  doesNotRead: string;
  /** Where what is fetched is written, named as a table or a store. */
  landsIn: string;
  /** Who can then read it, and who cannot. */
  visibleTo: string;
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
  /** What happens to what we fetch. Rendered under the scope list. */
  dataHandling: DataHandlingDisclosure;
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
    dataHandling: {
      reads:
        "Only files this app itself created in your Drive — the exports and menu scans it wrote — plus the email address of the Google account you connected, so the row can name it.",
      doesNotRead:
        "Anything else in your Drive. `drive.file` cannot see a document this app did not create, so there is no list, no search and no read of your own files.",
      landsIn:
        "Nothing from Drive is copied into Mudavym. The grant is used to WRITE exports out; the connected address is stored on `integration_oauth_connections.account_email`, and the tokens beside it are AES-256-GCM encrypted.",
      visibleTo:
        "You, on /profile. A manager or owner of a restaurant this grant is recorded against sees that it exists and whose it is, and may stop the house using it — they can never read your Drive through it and can never revoke it for you.",
    },
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
    dataHandling: {
      reads:
        "Nothing. `gmail.send` is a one-way door: it can hand Gmail a message to send and cannot open, list or search anything, including the messages it sent itself.",
      doesNotRead:
        "Your mailbox, in every sense — inbox, sent, drafts, labels, filters, settings and contacts. Not even the address it sends from: Gmail stamps that itself, which is why the sender line names the person who consented rather than an address.",
      landsIn:
        "The letters this house writes, on `procurement_conversations`, alongside the vendor replies already there. The letter is written before it is sent and is readable in this house's conversation book from the moment it is queued.",
      visibleTo:
        "Everyone who works in this restaurant, because a letter to a vendor is the house's record and a second manager must be able to pull one back inside its two-minute window. Nobody outside this restaurant.",
    },
  },
  /**
   * The receiving mailbox (founder, 2026-09-04: the send grant stays send-only
   * "on condition the house can also receive on its own mailbox and have the
   * whole comms there", and asked how — "a second grant, read-only,
   * house-declared and person-consented"; ADR 0118, receive half).
   *
   * ONE scope, and it is a SECOND grant rather than a second scope on
   * `gmail_send`, for the same reason `gmail_send` is not a second scope on
   * `google_drive`: `UNIQUE (user_id, integration_id)` (20260826170000:144)
   * makes an id a grant, so a separate id gets a separate consent screen, a
   * separate row and a separate disconnect. Somebody who agreed to let this
   * house's letters LEAVE from their mailbox has not thereby agreed to let it
   * READ their mailbox, and the two questions have to be asked one at a time.
   *
   * `gmail.readonly` is the narrowest scope Google publishes that can fetch a
   * message body. `gmail.metadata` is narrower still and is useless here — it
   * returns headers and labels and no body, so a vendor's price would never
   * reach the book. `gmail.modify` would let us label or archive what we read
   * and is refused: this reads and changes nothing.
   *
   * WHAT NARROWS IT BELOW THE SCOPE. `gmail.readonly` permits reading the whole
   * mailbox. The reader does not: every request it makes carries a `from:`
   * filter built from the addresses in THIS house's vendor book, and any
   * message whose From is not an exact book address is discarded before it is
   * looked at (`communications/inbox/house-inbox.service.ts`). Both bounds are
   * load-bearing — Gmail's `from:` matches display names and partial tokens, so
   * the query alone is not a guarantee. The `dataHandling` block below is what
   * the person reads before agreeing, and it says this in words.
   *
   * NO `openid` / `email`, for the same reason as the send grant: the founder's
   * line was the one scope. The house's inbox rows therefore name the person
   * who consented, never an address we never read.
   */
  gmail_read: {
    id: "gmail_read",
    provider: "google",
    label: "Gmail — reading vendor replies only",
    providerLabel: "Google",
    description:
      "Lets a vendor's reply to this house land in the house's own conversation book, instead of arriving in a mailbox only you can see.",
    scopes: [
      {
        scope: "https://www.googleapis.com/auth/gmail.readonly",
        label: "Read mail in your mailbox — used only for the vendors in this house's book",
        reason:
          "Google offers no scope that can read one sender and not another, so this is the narrowest one that can fetch a vendor's reply at all. What Mudavym actually asks Gmail for is narrower than what the scope permits: every request carries a from: filter built from the vendor addresses in this house's book, and a message from anyone else is discarded without being read. It can never send, label, archive or delete anything.",
      },
    ],
    notRequested: [
      "Mail from anyone who is not a vendor in this house's book — colleagues, family, your bank, everything else",
      "Anything that arrived before this house switched the reader on; it starts from the moment you consent and never looks backwards",
      "Sending mail as you, which is a separate connection you agree to separately",
      "Changing anything at all: no labelling, no archiving, no marking read, no deleting",
      "Your drafts, filters, settings, contacts or chat",
    ],
    dataHandling: {
      reads:
        "Mail from the vendor addresses in this restaurant's book, and nothing else. The book is `providers.contact_email`, `providers.primary_contact.email` and `provider_contacts.email` for this restaurant — the same list the composer may write to. An empty book means no request is made at all.",
      doesNotRead:
        "Every other message in your mailbox. Mail from an address that is not in the book is never fetched (the from: filter) and, if Gmail's fuzzy sender matching returns one anyway, it is discarded on arrival without its body being stored, logged or shown. Nothing that arrived before you consented is ever read: the cursor starts at the moment the grant is switched on.",
      landsIn:
        "This restaurant's conversation book — `procurement_conversations` — through the same path a reply to the shared mailbox already takes, so a house-mailbox reply and a shared-mailbox reply are the same kind of row. Attachments land in the private `vendor-attachments` store.",
      visibleTo:
        "Everyone who works in this restaurant, which is the point of the grant: a vendor reply stops being private to whoever's inbox it happened to reach. Nobody outside this restaurant, and no other restaurant on this deployment. You can disconnect at any time, and a manager can stop the house using the grant without touching it — either one stops the reading on the next run.",
    },
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
    dataHandling: {
      reads:
        "Workbooks this app writes to your OneDrive, and your basic Microsoft profile so the row can name the connected account.",
      doesNotRead:
        "Your Outlook mail, your calendar, your organisation's SharePoint sites. `Files.ReadWrite` is scoped to your own OneDrive and this app only opens the workbooks it wrote.",
      landsIn:
        "Nothing from OneDrive is copied into Mudavym. The grant is used to WRITE report workbooks out; the connected profile name is stored on `integration_oauth_connections.account_email` and the tokens beside it are AES-256-GCM encrypted.",
      visibleTo:
        "You, on /profile. A manager or owner of a restaurant this grant is recorded against sees that it exists and whose it is, and may stop the house using it — never read through it, never revoke it for you.",
    },
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
