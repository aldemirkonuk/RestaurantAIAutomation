/**
 * Which address this house's own letters leave from — and, far more often, why
 * none of them may leave at all yet.
 *
 * THE DECISION THIS ENFORCES (founder, 2026-09-03 / 2026-09-04; ADR 0118)
 * ----------------------------------------------------------------------
 * A house sends from its OWN connected mailbox, or from a Mudavym subdomain
 * address we provision for it. Never from the mailbox every restaurant on this
 * deployment shares — `gmail.service.ts:78-80`, `GMAIL_SENDER_EMAIL` falling
 * back to `notifications@wineops.ai`. That fallback is exactly what the house
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
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../../database/database.service";
import { INTEGRATION_DEFINITIONS } from "../../integrations/integrations-oauth.constants";

/**
 * The integration that asks for sending. Read from the catalogue rather than
 * named as a string here: the resolver's refusal sentence tells a manager which
 * row to click, and a hand-typed label drifts from the row the moment one of
 * them is renamed.
 */
export const GMAIL_SEND_DEFINITION = INTEGRATION_DEFINITIONS.gmail_send;

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
}

@Injectable()
export class HouseSenderService {
  private readonly logger = new Logger(HouseSenderService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  private deploymentMailbox(): string {
    return (
      this.config.get<string>("GMAIL_SENDER_EMAIL") ??
      "notifications@wineops.ai"
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
   */
  async resolve(
    restaurantId: string,
    userId: string,
  ): Promise<HouseSenderIdentity> {
    const base = this.base();

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
      };
    }

    // The house's own connected mailbox. A grant qualifies when it is live,
    // Google's, attached to THIS house, and carries the send scope.
    const { data, error } = await this.db.client
      .from("integration_oauth_connections")
      .select(
        "id, user_id, integration_id, provider, account_email, scopes, restaurant_id, revoked_at",
      )
      .eq("restaurant_id", restaurantId)
      .eq("provider", "google")
      .is("revoked_at", null);

    if (error) {
      // Not "none". We do not know.
      this.logger.error(
        `House sender could not be resolved for ${restaurantId}: ${error.message}`,
      );
      return {
        ...base,
        kind: "unknown",
        address: null,
        sendable: false,
        ceremony: "none",
        undoMs: null,
        words: `Which mailbox this house sends from could not be read (${error.message}), so no letter may be queued. This is a failed read, not an empty answer — the house may well have a mailbox connected.`,
        grant: null,
        missing: [
          "The connections register could not be read; retry before concluding anything about this house.",
        ],
      };
    }

    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    const withSend = rows.filter((r) =>
      (Array.isArray(r.scopes) ? (r.scopes as string[]) : []).includes(
        GMAIL_SEND_SCOPE,
      ),
    );

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
      };
    }

    // Prefer the asking person's own grant, so the letter leaves from the
    // mailbox they expect; otherwise the house's first live sending grant.
    const chosen =
      withSend.find((r) => String(r.user_id) === userId) ?? withSend[0];
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
    };
  }
}
