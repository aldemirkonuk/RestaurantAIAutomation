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
 * Measured on this branch, 2026-09-04: `INTEGRATION_DEFINITIONS` declares two
 * integrations, `google_drive` and `excel`
 * (integrations-oauth.constants.ts:36-98), and NEITHER requests
 * `https://www.googleapis.com/auth/gmail.send`. `google_drive` explicitly lists
 * "Your Gmail messages" under `notRequested` (:64). So on today's tree this
 * resolver returns `kind: "none"` for every house, and the composer's Send is
 * disabled carrying that sentence. Widening the Drive grant's scopes to make
 * the button light up would be changing what people consented to without asking
 * them; the missing piece is named in `missing` and filed in the page note
 * instead.
 *
 * FOUR STATES, NOT TWO (ADR 0051 clause 3). `none` and `unknown` are different
 * facts — "this house has no sending identity" and "we could not read whether
 * it has one" — and a reader who cannot tell them apart is being told the
 * second is the first.
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../../database/database.service";

/** The Gmail scope that permits sending as the granting account. */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/**
 * The undo window on a plain-button send, in milliseconds.
 *
 * Not a new number: it is the window the autonomous vendor-reply path already
 * stages a guardrail-clear reply for
 * (`common/orchestrator/inbound-responder.service.ts:36`,
 * `AUTO_SEND_UNDO_MS = 2 * 60 * 1000`). The founder's decision was "the AI
 * reply path's shape" for a house's own mailbox, so the shape includes its
 * duration. Re-declared rather than imported so this module does not reach into
 * the orchestrator's internals for a constant; the spec asserts the two agree.
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
        `No connected Google account for this house has granted ${GMAIL_SEND_SCOPE}. There is no integration that asks for it: INTEGRATION_DEFINITIONS declares google_drive and excel only, and google_drive lists "Your Gmail messages" as not requested (integrations-oauth.constants.ts:64).`,
      ];
      if (rows.length > 0) {
        missing.push(
          `${rows.length} Google ${rows.length === 1 ? "grant is" : "grants are"} connected to this house, but ${rows.length === 1 ? "it was" : "they were"} granted for files, not for sending. Sending as this account needs its own consent, asked for by name.`,
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
            ? "No house sender. This house has connected a Google account, but it granted file access, not sending — a letter cannot leave in its name until sending is asked for and agreed to separately. Connect a sending mailbox on /connections."
            : "No house sender. This house has not connected a mailbox of its own, and a Mudavym address is a paid-tier option that is not provisioned yet. Connect a mailbox on /connections; nothing is sent until one exists.",
        grant: null,
        missing,
      };
    }

    // Prefer the asking person's own grant, so the letter leaves from the
    // mailbox they expect; otherwise the house's first live sending grant.
    const chosen =
      withSend.find((r) => String(r.user_id) === userId) ?? withSend[0];

    return {
      ...base,
      kind: "house_mailbox",
      address: (chosen.account_email as string | null) ?? null,
      sendable: true,
      ceremony: "undo",
      undoMs: HOUSE_LETTER_UNDO_MS,
      words: `Sends as ${(chosen.account_email as string | null) ?? "the connected Google account (its address was not recorded)"}, this house's own connected mailbox. Send goes out after a ${Math.round(HOUSE_LETTER_UNDO_MS / 60000)}-minute window in which it can still be pulled back.`,
      grant: {
        connectionId: String(chosen.id),
        integrationId: String(chosen.integration_id),
        accountEmail: (chosen.account_email as string | null) ?? null,
        personUserId: String(chosen.user_id),
      },
    };
  }
}
