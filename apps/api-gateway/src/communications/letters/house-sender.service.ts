/**
 * Which address this house's own letters leave from — and, far more often, why
 * none of them may leave at all yet.
 *
 * THE DECISION THIS ENFORCES (founder, 2026-09-03 / 2026-09-04; ADR 0118)
 * ----------------------------------------------------------------------
 * A house sends from its OWN connected mailbox, or from a Mudavym subdomain
 * address we provision for it. Never from the mailbox every restaurant on this
 * deployment shares — `gmail.service.ts:78-80`, `GMAIL_SENDER_EMAIL` falling
 * back to `notifications@mudavym.com`. That fallback is exactly what the house
 * composer retires for manager-written letters: the sign-off inside the letter
 * carries the house's name and the envelope carries ours, which is the one
 * thing `/communications` may never claim.
 *
 * The subdomain line is a PAID option (founder, 2026-09-04). A house on a free
 * plan sends from its own connected mailbox; the price itself is OD-23 and is
 * NOT stated here or on the page — the row says which tier the option belongs
 * to and nothing about what it costs.
 *
 * WHAT THIS READS, AND WHY IT IS A SCOPE CHECK RATHER THAN A FLAG
 * --------------------------------------------------------------
 * A grant is only a sending identity if the person actually granted sending.
 * `integration_oauth_connections.scopes` is a `TEXT[]` written from the consent
 * screen's own disclosure (20260826170000:133; integrations-oauth.service.ts
 * :502-513), so the question "may we send as this account?" has a literal
 * stored answer and is asked of that answer — never of a config flag, and never
 * of the mere existence of a Google connection.
 *
 * WHAT CHANGED ON 2026-09-04 (founder: "add the gmail send integration now")
 * ------------------------------------------------------------------------
 * Until today `INTEGRATION_DEFINITIONS` declared `google_drive` and `excel`
 * only, neither requested `gmail.send`, and this resolver therefore returned
 * `kind: "none"` for every house on the deployment — correctly, because there
 * was no consent screen anywhere that asked for sending.
 *
 * There is now: `gmail_send` (integrations-oauth.constants.ts), a separate
 * integration asking for `https://www.googleapis.com/auth/gmail.send` and for
 * nothing else. What did NOT change is the rule underneath: the Drive grant's
 * scopes were not widened, `google_drive` still lists "Your Gmail messages"
 * under `notRequested`, and a house that has connected Drive is still `none`
 * here. A person consents to sending separately, by name, or nothing may leave.
 *
 * So the answer for a given house is now a fact about that house rather than a
 * fact about the deployment: `none` until somebody consents, `house_mailbox`
 * the moment somebody does.
 *
 * FOUR STATES, NOT TWO (ADR 0051 clause 3). `none` and `unknown` are different
 * facts — "this house has no sending identity" and "we could not read whether
 * it has one" — and a reader who cannot tell them apart is being told the
 * second is the first.
 *
 * WHAT CHANGED ON 2026-09-04, SECOND (founder: the send grant stays send-only
 * "on condition the house can also receive on its own mailbox and have the
 * whole comms there")
 * ---------------------------------------------------------------------------
 * A sending identity was never the whole answer to "where is this house's
 * conversation?". A letter leaving from the house's own mailbox whose reply
 * lands in the mailbox every restaurant here shares is HALF a conversation, and
 * a sender line that said only "sends from X" was quietly reporting the half it
 * could see as the whole.
 *
 * So this resolver now answers on two axes — `gmail_send` and `gmail_read` —
 * and `conversation.where` states the four combinations in words:
 * `whole_conversation_here`, `letters_leave_only`, `replies_arrive_only`,
 * `shared_mailbox`, plus `unknown` for a failed read of the grants, which is a
 * fact about our knowledge rather than a fifth placement.
 *
 * READING NEEDS TWO THINGS, AND THE LINE SAYS BOTH. A person's consent (a
 * `gmail_read` grant) and the house's switch (`enable_house_inbox_read`) are
 * different facts, and neither implies the other. A house where somebody
 * consented and the switch is off is NOT being read, and the line says so
 * rather than showing the consent and letting a manager infer the rest.
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../../database/database.service";
import { INTEGRATION_DEFINITIONS } from "../../integrations/integrations-oauth.constants";
import {
  GMAIL_READ_SCOPE,
  HOUSE_INBOX_FLAG,
  isHouseInboxReadEnabled,
} from "../inbox/house-inbox-flag";

/**
 * The integration that asks for sending. Read from the catalogue rather than
 * named as a string here: the resolver's refusal sentence tells a manager which
 * row to click, and a hand-typed label drifts from the row the moment one of
 * them is renamed.
 */
export const GMAIL_SEND_DEFINITION = INTEGRATION_DEFINITIONS.gmail_send;

/**
 * The house-inbox switch as an owner sees it: the label of its row in
 * Settings (apps/web/src/pages/settings/next/FeaturesSection.tsx, "Read this
 * house's mailbox"). The sentence names this, never the flag key
 * (HOUSE_INBOX_FLAG), which is a column name nobody in a restaurant reads.
 */
export const HOUSE_INBOX_SWITCH_LABEL = "Read this house's mailbox";

/**
 * Whether a person with this house role may turn the switch on: owners and
 * managers, the same rule PUT /settings/feature-flags enforces
 * (assertManagerOrOwner). `null` when no role was given, so the sentence
 * falls back to the rule itself rather than guessing at the reader.
 */
export function mayTurnTheReaderOn(role: string | null | undefined): boolean | null {
  if (typeof role !== "string" || role.trim() === "") return null;
  const r = role.trim().toLowerCase();
  return r === "owner" || r === "manager";
}

/**
 * The Gmail scope that permits sending as the granting account.
 *
 * Asserted against the catalogue in the spec rather than trusted: this constant
 * decides whether a stored grant counts, and the definition decides what is
 * actually asked for. If they ever disagree, either every house silently loses
 * its sender or one silently gains a sender it never consented to.
 */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/**
 * The undo window on a plain-button send, in milliseconds.
 *
 * Not a new number: it is the window the autonomous vendor-reply path already
 * stages a guardrail-clear reply for (`AUTO_SEND_UNDO_MS` in
 * `common/orchestrator/inbound-responder.service.ts`). The founder's decision
 * was "the AI reply path's shape" for a house's own mailbox, so the shape
 * includes its duration. Re-declared rather than imported so this module does
 * not reach into the orchestrator's internals at runtime — but that constant is
 * now EXPORTED and `house-letters.spec.ts` asserts the two are equal against it.
 * Until 2026-09-04 it was private and the spec could only compare this value to
 * a hardcoded literal, so the header's claim that "the spec asserts the two
 * agree" was false: the AI path's window could have drifted and nothing would
 * have failed. Found by the audit of 5e0a59a6, fixed the same day.
 */
export const HOUSE_LETTER_UNDO_MS = 2 * 60 * 1000;

export type HouseSenderKind =
  | "house_mailbox"
  | "mudavym_subdomain"
  | "none"
  | "unknown";

/**
 * Where this house's conversation with a vendor actually lives.
 *
 * Four placements and one non-placement. `unknown` is not a fifth arrangement:
 * it is the answer when the grants could not be read, and collapsing it into
 * `shared_mailbox` would tell a manager their house is on the shared mailbox
 * when the truth is that we do not know (ADR 0051 clause 3).
 */
export type HouseConversationPlacement =
  | "whole_conversation_here"
  | "letters_leave_only"
  | "replies_arrive_only"
  | "shared_mailbox"
  | "unknown";

export interface HouseConversationState {
  where: HouseConversationPlacement;
  /** The whole answer in one paragraph. Always populated; never a bare em dash. */
  words: string;
  /** The sending half, restated so a surface never has to infer it from `kind`. */
  sending: { granted: boolean | "unknown" };
  /**
   * The receiving half. `consented` is a person's decision; `switchedOn` is
   * this restaurant's. Both are required before a single message is read, and
   * they are separate fields because they are separate facts — a surface that
   * showed one boolean would have to lie about the other.
   */
  receiving: {
    consented: boolean | "unknown";
    switchedOn: boolean;
    /** The flag whose value `switchedOn` is, named so it can be found. */
    switch: string;
  };
}

export interface HouseSenderIdentity {
  kind: HouseSenderKind;
  /** The address a letter would leave from, or null when none may. */
  address: string | null;
  /** True only when a letter may actually be queued. */
  sendable: boolean;
  /**
   * What pressing Send costs the writer.
   *   seal — the hold-to-approve die, for the Mudavym subdomain: one house's
   *          letter affects every other house's deliverability on that domain.
   *   undo — a plain button and a window, for the house's own mailbox.
   *   none — nothing may be sent, so nothing is offered.
   */
  ceremony: "seal" | "undo" | "none";
  undoMs: number | null;
  /** The sender line, in words. Always populated; never a bare em dash. */
  words: string;
  /** The grant this identity rests on, when it rests on one. */
  grant: {
    connectionId: string;
    integrationId: string;
    accountEmail: string | null;
    personUserId: string;
  } | null;
  /**
   * The deployment mailbox, named so the page can say what it is NOT using.
   * Never selectable.
   */
  deployment: { address: string; refusedBecause: string };
  /** What is missing before a kind becomes reachable. One sentence each. */
  missing: string[];
  /** The subdomain option's commercial standing, in words. No price, ever. */
  subdomain: { provisioned: boolean; tier: "paid"; words: string };
  /** Where the WHOLE conversation lives, not just the outbound half. */
  conversation: HouseConversationState;
}

@Injectable()
export class HouseSenderService {
  private readonly logger = new Logger(HouseSenderService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  private deploymentMailbox(): string {
    // Must agree with gmail.service.ts (`||`): a variable set but empty still
    // sends from the default, so the page must name that address, never nobody.
    return (
      (this.config.get<string>("GMAIL_SENDER_EMAIL") ?? "").trim() ||
      "notifications@mudavym.com"
    );
  }

  /**
   * The name of the person whose grant a letter would ride on.
   *
   * Never throws and never invents: a failed read or a nameless row returns
   * null, and the caller says "another member of this house" rather than
   * printing an empty gap or a user id at a vendor.
   */
  private async personName(userId: string): Promise<string | null> {
    try {
      const { data, error } = await this.db.client
        .from("users")
        .select("name")
        .eq("user_id", userId)
        .maybeSingle();
      if (error || !data) return null;
      const name = (data as Record<string, unknown>).name;
      return typeof name === "string" && name.trim() ? name.trim() : null;
    } catch {
      return null;
    }
  }

  private base(): Pick<
    HouseSenderIdentity,
    "deployment" | "subdomain" | "missing"
  > {
    const provisioned = Boolean(
      this.config.get<string>("MUDAVYM_SENDING_DOMAIN"),
    );
    return {
      deployment: {
        address: this.deploymentMailbox(),
        refusedBecause:
          "This mailbox belongs to the deployment, not to this house — every restaurant here shares it. A letter that leaves from it says it is from the house in the sign-off and says it is from us in the envelope, so the composer will not use it.",
      },
      subdomain: {
        provisioned,
        tier: "paid",
        words: provisioned
          ? "A Mudavym address is provisioned for this house."
          : "A Mudavym address on our own sending domain is a paid-tier option and is not provisioned for any house yet: there is no domain, no DKIM or SPF records, no DMARC policy and no inbound parse route. A house on the free plan sends from its own connected mailbox.",
      },
      missing: [],
    };
  }

  /**
   * Resolve the house's sending identity.
   *
   * `userId` is the person asking. It is used only to attribute a grant the
   * house may use; it never widens what the house may do.
   *
   * `viewer.role` is the asker's role in this house, when the caller has it
   * (the sender read does; the dispatcher does not). It changes only who the
   * sentence says may turn the reading switch on (r21 walk D3: an owner was
   * told "An owner or a manager can turn it on", about a switch they hold).
   */
  async resolve(
    restaurantId: string,
    userId: string,
    viewer: { role?: string | null } = {},
  ): Promise<HouseSenderIdentity> {
    const base = this.base();
    const viewerMaySwitch = mayTurnTheReaderOn(viewer.role);

    // BOTH axes come from ONE read of the same rows. The house's Google grants
    // answer "may a letter leave?" and "may a reply be read?" together, and
    // asking twice would let the two halves of one sentence disagree.
    const { data, error } = await this.db.client
      .from("integration_oauth_connections")
      .select(
        "id, user_id, integration_id, provider, account_email, scopes, restaurant_id, revoked_at, connected_at",
      )
      .eq("restaurant_id", restaurantId)
      .eq("provider", "google")
      .is("revoked_at", null)
      // Oldest grant first (gap G11): with no house choice and no grant of
      // the asker's own, "the house's first live one" was whatever order
      // Postgres returned, so two reads could name two different mailboxes.
      .order("connected_at", { ascending: true })
      .order("id", { ascending: true });

    const rows = error
      ? []
      : ((data ?? []) as unknown as Record<string, unknown>[]);
    const scopesOf = (r: Record<string, unknown>): string[] =>
      Array.isArray(r.scopes) ? (r.scopes as string[]) : [];
    const withSend = rows.filter((r) => scopesOf(r).includes(GMAIL_SEND_SCOPE));
    // Which mailboxes are read, by the address their grant recorded (r36 mail
    // audit, gap 3): the setup words name them rather than saying "this
    // house's mailbox" of whichever one it is.
    const readAddresses = Array.from(
      new Set(
        rows
          .filter((r) => scopesOf(r).includes(GMAIL_READ_SCOPE))
          .map((r) => (typeof r.account_email === "string" ? r.account_email.trim().toLowerCase() : ""))
          .filter(Boolean),
      ),
    );
    const readConsented: boolean | "unknown" = error
      ? "unknown"
      : rows.some((r) => scopesOf(r).includes(GMAIL_READ_SCOPE));
    // The switch is read even when the grants could not be, because "nobody
    // switched it on" stays true and useful either way.
    const readSwitchedOn = await isHouseInboxReadEnabled(
      this.db.client,
      restaurantId,
    );

    if (base.subdomain.provisioned) {
      // Reachable only once a domain exists. Written now so the shape is real
      // rather than retro-fitted, and so the ceremony fork has both arms.
      const domain = this.config.get<string>("MUDAVYM_SENDING_DOMAIN")!;
      return {
        ...base,
        kind: "mudavym_subdomain",
        address: `siparis@${domain}`,
        sendable: true,
        ceremony: "seal",
        undoMs: null,
        words: `Sends as siparis@${domain}, the house's own line on Mudavym's sending domain. Because one house's letter affects every other house's deliverability on that domain, Send is held rather than clicked.`,
        grant: null,
        conversation: this.conversation({
          sendGranted: true,
          sendAddress: `siparis@${domain}`,
          readConsented,
          readAddresses,
          readSwitchedOn,
          viewerMaySwitch,
          deploymentAddress: base.deployment.address,
        }),
      };
    }

    // The house's own connected mailbox. A grant qualifies when it is live,
    // Google's, attached to THIS house, and carries the send scope.
    if (error) {
      // Not "none". We do not know.
      this.logger.error(
        `House sender could not be resolved for ${restaurantId}: ${error.message}`,
      );
      return this.unreadable(base, error.message, readSwitchedOn);
    }

    if (withSend.length === 0) {
      const missing = [
        `No connected Google account for this house has granted ${GMAIL_SEND_SCOPE}. The consent that asks for it exists — "${GMAIL_SEND_DEFINITION.label}" on /connections, which requests that one scope and no other — but nobody in this house has been through it yet.`,
      ];
      if (rows.length > 0) {
        missing.push(
          `${rows.length} Google ${rows.length === 1 ? "grant is" : "grants are"} connected to this house, but ${rows.length === 1 ? "it was" : "they were"} granted for files, not for sending. Sending as this account needs its own consent, asked for by name; the file grant is not widened to cover it.`,
        );
      }
      return {
        ...base,
        kind: "none",
        address: null,
        sendable: false,
        ceremony: "none",
        undoMs: null,
        words:
          rows.length > 0
            ? `No house sender. This house has connected a Google account, but it granted file access, not sending — a letter cannot leave in its name until sending is asked for and agreed to separately. Connect "${GMAIL_SEND_DEFINITION.label}" on /connections; it asks for one permission, to send, and cannot read a single message.`
            : `No house sender. This house has not connected a mailbox of its own, and a Mudavym address is a paid-tier option that is not provisioned yet. Connect "${GMAIL_SEND_DEFINITION.label}" on /connections; nothing is sent until somebody has.`,
        grant: null,
        missing,
        conversation: this.conversation({
          sendGranted: false,
          sendAddress: null,
          readConsented,
          readAddresses,
          readSwitchedOn,
          viewerMaySwitch,
          deploymentAddress: base.deployment.address,
        }),
      };
    }

    // The house's own choice comes first: an owner or manager picked which
    // connected mailbox the house's letters leave from (the Mail setup page).
    // A choice that points at a grant which no longer sends is ignored, so a
    // revoked mailbox never strands the house. A choice that could not be
    // READ is not ignored: which address a vendor sees is the point, so the
    // answer is "could not be read", never a quiet guess.
    const houseChoice = await this.houseChoice(restaurantId);
    if (houseChoice.failed) {
      this.logger.error(
        `House sender choice could not be read for ${restaurantId}: ${houseChoice.failed}`,
      );
      return this.unreadable(base, houseChoice.failed, readSwitchedOn);
    }
    // A choice counts only when the person who made it is the person whose
    // mailbox it is (QA round 26, #973; the session's call under the
    // 2026-11-07 /goal). Consenting to "this house's own letters may leave
    // from my mailbox" is not consenting to being made the house's ONE line by
    // somebody else. chooseSender refuses that; this is the second wall, for a
    // row that got past it.
    // Otherwise prefer the asking person's own grant, so the letter leaves
    // from the mailbox they expect; otherwise the house's first live one.
    const chosen =
      withSend.find(
        (r) => String(r.id) === houseChoice.connectionId && String(r.user_id) === houseChoice.chosenBy,
      ) ??
      withSend.find((r) => String(r.user_id) === userId) ??
      withSend[0];
    const address = (chosen.account_email as string | null) ?? null;
    const owner = String(chosen.user_id);
    const mine = owner === userId;

    // WHOSE MAILBOX, stated — and stated truthfully when we do not have an
    // address to state. `gmail_send` asks for the send scope and nothing else,
    // so it carries no `openid`/`email` and `fetchAccountEmail` records null
    // for it (integrations-oauth.service.ts:446-462). Naming the PERSON who
    // consented is a fact we hold; printing an address we never read would not
    // be. A blank here would be the cardinal fault of this repo written onto
    // the one line whose whole job is to say where the letter comes from.
    const ownerName = mine ? null : await this.personName(owner);
    const whose = address
      ? `${address}, ${mine ? "your own connected mailbox" : `the mailbox ${ownerName ?? "another member of this house"} connected`}`
      : mine
        ? "the Google mailbox you consented with. Its address was not recorded, because the sending grant asks for permission to send and for nothing else — not even for the address it sends from; Google fills that in itself"
        : `the Google mailbox ${ownerName ?? "another member of this house"} consented with. Its address was not recorded, because the sending grant asks for permission to send and for nothing else`;

    return {
      ...base,
      kind: "house_mailbox",
      address,
      sendable: true,
      ceremony: "undo",
      undoMs: HOUSE_LETTER_UNDO_MS,
      words: `Sends from ${whose}. Send goes out after a ${Math.round(HOUSE_LETTER_UNDO_MS / 60000)}-minute window in which it can still be pulled back.`,
      grant: {
        connectionId: String(chosen.id),
        integrationId: String(chosen.integration_id),
        accountEmail: (chosen.account_email as string | null) ?? null,
        personUserId: String(chosen.user_id),
      },
      conversation: this.conversation({
        sendGranted: true,
        sendAddress: address,
        readConsented,
        readAddresses,
        readSwitchedOn,
        viewerMaySwitch,
        deploymentAddress: base.deployment.address,
      }),
    };
  }

  /**
   * The grant this house chose to send from, or null when it chose none.
   * `failed` carries the reason when the choice could not be read.
   */
  private async houseChoice(
    restaurantId: string,
  ): Promise<{ connectionId: string | null; chosenBy: string | null; failed: string | null }> {
    try {
      const { data, error } = await this.db.client
        .from("house_mail_sender_choice")
        .select("connection_id, chosen_by")
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      if (error) return { connectionId: null, chosenBy: null, failed: error.message };
      const row = data as Record<string, unknown> | null;
      const id = row?.connection_id;
      const by = row?.chosen_by;
      return {
        connectionId: typeof id === "string" ? id : null,
        chosenBy: typeof by === "string" ? by : null,
        failed: null,
      };
    } catch (e) {
      return {
        connectionId: null,
        chosenBy: null,
        failed: e instanceof Error ? e.message : "the read threw",
      };
    }
  }

  /**
   * The grant a QUEUED letter was pinned to, re-read at send time (QA round
   * 26, #973). A letter leaves from the mailbox it was queued under or not at
   * all: this never falls back to the house's current rule, because the
   * writer approved one address and a vendor must not see another.
   *
   * Throws plain words when the grant is gone, no longer sends, or could not
   * be read; the dispatcher records them as the letter's failure, which the
   * manager sees.
   */
  async pinned(
    restaurantId: string,
    connectionId: string,
    queuedAddress: string | null,
  ): Promise<{ address: string | null; grant: NonNullable<HouseSenderIdentity["grant"]> }> {
    const named = queuedAddress ? ` (${queuedAddress})` : "";
    let row: Record<string, unknown> | null = null;
    try {
      const { data, error } = await this.db.client
        .from("integration_oauth_connections")
        .select("id, user_id, integration_id, account_email, scopes")
        .eq("id", connectionId)
        .eq("restaurant_id", restaurantId)
        .eq("provider", "google")
        .is("revoked_at", null)
        .maybeSingle();
      if (error) throw new Error(error.message);
      row = (data as Record<string, unknown> | null) ?? null;
    } catch {
      throw new Error(
        `The mailbox this letter was queued to leave from${named} could not be read, so it was not sent, and not from another mailbox either. Write it again to try once more.`,
      );
    }
    const scopes = Array.isArray(row?.scopes) ? (row!.scopes as string[]) : [];
    if (!row || !scopes.includes(GMAIL_SEND_SCOPE)) {
      throw new Error(
        `The mailbox this letter was queued to leave from${named} can no longer send for this house, so it was not sent, and not from another mailbox either. Write it again to send it from the mailbox the house uses now.`,
      );
    }
    const accountEmail = (row.account_email as string | null) ?? null;
    return {
      address: accountEmail,
      grant: {
        connectionId: String(row.id),
        integrationId: String(row.integration_id),
        accountEmail,
        personUserId: String(row.user_id),
      },
    };
  }

  /** The identity when what it rests on could not be read: never "none". */
  private unreadable(
    base: Pick<HouseSenderIdentity, "deployment" | "subdomain" | "missing">,
    reason: string,
    readSwitchedOn: boolean,
  ): HouseSenderIdentity {
    return {
      ...base,
      kind: "unknown",
      address: null,
      sendable: false,
      ceremony: "none",
      undoMs: null,
      words: `Which mailbox this house sends from could not be read (${reason}), so no letter may be queued. This is a failed read, not an empty answer — the house may well have a mailbox connected.`,
      grant: null,
      missing: [
        "The connections register could not be read; retry before concluding anything about this house.",
      ],
      conversation: this.conversation({
        sendGranted: "unknown",
        sendAddress: null,
        readConsented: "unknown",
        readAddresses: [],
        readSwitchedOn,
        deploymentAddress: base.deployment.address,
      }),
    };
  }

  /**
   * Where the whole conversation lives, in words.
   *
   * FOUR STATES, AND NEVER A BOOLEAN. "This house has its own mailbox" is not a
   * fact a boolean can carry, because it is two facts: letters leaving and
   * replies arriving are separately granted, separately revocable, and a house
   * routinely has one without the other. A single "own mailbox: yes" would have
   * been true of a house whose vendors' replies all land in the mailbox every
   * restaurant on this deployment shares — which is the arrangement the founder
   * made the send grant conditional on ending.
   *
   * READING TAKES BOTH A CONSENT AND A SWITCH. `readConsented` is a person's
   * `gmail_read` grant; `readSwitchedOn` is this restaurant's
   * `enable_house_inbox_read`. A house with the first and not the second is NOT
   * being read, and it is placed with the houses that are not, because
   * `where` states what IS happening rather than what could be. The words then
   * say which of the two is missing, so nobody has to guess which door to open.
   */
  private conversation(params: {
    sendGranted: boolean | "unknown";
    sendAddress: string | null;
    readConsented: boolean | "unknown";
    /** Addresses of the live reading grants, lowercased; empty when none recorded one. */
    readAddresses: string[];
    readSwitchedOn: boolean;
    /** May the person reading this sentence turn the switch on? `null`: not known. */
    viewerMaySwitch?: boolean | null;
    deploymentAddress: string;
  }): HouseConversationState {
    const {
      sendGranted,
      sendAddress,
      readConsented,
      readAddresses,
      readSwitchedOn,
      viewerMaySwitch = null,
      deploymentAddress,
    } = params;
    // Does the deployment take mail at a Mudavym address? Then a letter this
    // house writes carries Reply-To to it (HouseLettersService.replyAddress),
    // and so does an order letter (ProcurementService.sendProviderEmail).
    const door = Boolean((this.config.get<string>("INBOUND_EMAIL_DOMAIN") || "").trim());

    const sending = { granted: sendGranted };
    const receiving = {
      consented: readConsented,
      switchedOn: readSwitchedOn,
      switch: HOUSE_INBOX_FLAG,
    };

    if (sendGranted === "unknown" || readConsented === "unknown") {
      return {
        where: "unknown",
        words:
          "Which mailbox this house's letters use could not be read just now, so nothing is said about it. This is a failed read, not an answer: the house may well have both mailbox connections. Try again before concluding anything.",
        sending,
        receiving,
      };
    }

    const reading = readConsented && readSwitchedOn;
    // The reason reading is off, when a person has in fact agreed to it. Said
    // in the same breath, because "connect the reading grant" is useless advice
    // to a house that already has one.
    // In the house's words (r21, 2026-11-13): the switch is named by its
    // Settings label, never by its flag key, and the Connections page by its
    // name, never by its path. `receiving.switch` still carries the key.
    // Who may turn it on is said to the person reading (r21 walk D3): the
    // switch is owners' and managers' (settings.controller.ts PUT
    // feature-flags, assertManagerOrOwner), so they are told it is theirs,
    // and anybody else is told whom to ask. Unknown keeps the plain rule.
    const whoSwitches =
      viewerMaySwitch === true
        ? "You can turn it on there."
        : viewerMaySwitch === false
          ? "Only an owner or a manager can turn it on; ask one of them."
          : "An owner or a manager can turn it on.";
    const readCaveat = readConsented
      ? ` Somebody here has consented to reading, but the house's "${HOUSE_INBOX_SWITCH_LABEL}" switch in Settings is off, so nothing is being read; the consent is not the switch. ${whoSwitches}`
      : ` Connect "${INTEGRATION_DEFINITIONS.gmail_read.label}" on the Connections page — it asks for one permission and reads only mail from the vendors already in this house's book.`;
    const from = sendAddress ? ` ${sendAddress}` : " this house's own mailbox";
    // Where a vendor's answer to a letter written here goes (r36 mail audit,
    // gaps 1 and 3). Said from what the send does, never from the grants
    // alone: with a Mudavym address the answer comes back there; without
    // one it goes to the mailbox the letter left from.
    const orderLine = ` Order letters leave from ${deploymentAddress}, the address every restaurant on this deployment shares, with this house's name on them, and their answers are filed in the book too.`;
    const doorAnswer =
      " A vendor's answer to a letter written here comes back to this house's Mudavym address and is filed in this house's book, where everyone who works here can read it.";

    if (sendGranted && reading) {
      // Which mailbox is read, by name, and whether it is the one letters
      // leave from. A sending grant records no address, so "the same
      // mailbox" is said only when both addresses are known and equal.
      const sendKey = sendAddress ? sendAddress.trim().toLowerCase() : null;
      const same = sendKey !== null && readAddresses.includes(sendKey);
      const readName = readAddresses.length
        ? readAddresses.join(", ")
        : "the mailbox connected for reading";
      const which = same
        ? ` Mail is read from ${readName}, the same mailbox letters leave from.`
        : sendKey && readAddresses.length
          ? ` Letters leave from ${sendAddress}; mail is read from ${readName}, a different mailbox.`
          : ` Letters leave from${from}; mail is read from ${readName}.${sendKey ? "" : " Whether that is the mailbox letters leave from is not recorded, because the sending connection asks only to send and Google does not tell it its own address."}`;
      const answer = door
        ? doorAnswer
        : same
          ? " A vendor's answer comes back to that same mailbox and is filed in this house's book, where everyone who works here can read it."
          : " A vendor's answer goes back to the mailbox its letter left from, so it shows in Mail only when that mailbox is one being read.";
      return {
        where: "whole_conversation_here",
        words: `${same && !door ? "The whole conversation is on this house's mailbox." : "This house sends and reads its own vendor mail."}${which}${answer}${orderLine}`,
        sending,
        receiving,
      };
    }

    if (sendGranted && !reading) {
      const answer = door
        ? `${doorAnswer} A letter a vendor starts on its own and sends to that mailbox is not read.`
        : " A vendor's answer goes back to that mailbox, and nothing reads it, so the answer will not show in Mail.";
      return {
        where: "letters_leave_only",
        words: `Letters written here leave from${from}, so a vendor sees this house's own address.${answer}${orderLine}${readCaveat}`,
        sending,
        receiving,
      };
    }

    if (!sendGranted && reading) {
      return {
        where: "replies_arrive_only",
        words: `A vendor's reply to this house is read from its own mailbox and filed in the book, so nothing arrives only in one person's inbox — but no letter may leave from it, because nobody here has consented to sending. Order letters leave from ${deploymentAddress}, the address every restaurant on this deployment shares, and a letter written here to a vendor cannot leave until a mailbox is connected for sending. Connect "${GMAIL_SEND_DEFINITION.label}" on the Connections page; it asks for one permission, to send, and cannot read a single message.`,
        sending,
        receiving,
      };
    }

    return {
      where: "shared_mailbox",
      // r12 walk (2026-11-12): this used to open "Neither half is on this
      // house's mailbox. No letter may leave at all". Order letters do leave,
      // from the shared address (85026e4f3), so "at all" was broader than
      // the code; only a letter the house writes to a vendor is held.
      words: `Nothing runs through a mailbox of this house's own yet. Order letters leave from ${deploymentAddress}, the address every restaurant on this deployment shares, and a letter written here to a vendor cannot leave until a mailbox is connected. A vendor's answer to an order ${door ? "comes back to this house's Mudavym address" : `arrives at ${deploymentAddress}`} and is filed in this house's book. Two connections move this onto your own mailbox, and each asks for one thing: "${GMAIL_SEND_DEFINITION.label}" and "${INTEGRATION_DEFINITIONS.gmail_read.label}".${readConsented ? readCaveat : ""}`,
      sending,
      receiving,
    };
  }
}
