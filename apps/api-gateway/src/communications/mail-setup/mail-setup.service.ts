/**
 * The house's mail setup (founder /goal 2026-11-07: "which email do we
 * select, how do we prepare that, the portal that leads to there").
 *
 * Three answers on one page, and the three acts that change them:
 *
 *   1. WHICH ADDRESS LETTERS LEAVE FROM — the house's connected sending
 *      grants, which one the house chose, and which one a letter would really
 *      use right now (HouseSenderService.resolve is the one rule; this file
 *      never re-derives it).
 *   2. HOW MAIL ARRIVES — the house's Mudavym address, read without making one
 *      (a read never provisions: QA M-12), and an act that makes it.
 *   3. DID A LETTER ARRIVE — the newest "send a test letter" check, with when
 *      and from whom it arrived.
 *
 * WHO MAY CHANGE IT (the session's call under the 2026-11-07 /goal): an owner
 * or a manager of the house, read from the role the signed token names.
 * Everyone in the house may read it, as everyone may read the house's mail.
 * The check is in code, not a `@Roles` decorator, so these routes stay out of
 * route-access.expected.json, which open PRs own — the same shape as
 * mail.controller.ts.
 *
 * Every read here is scoped by the house from the token, and every failed read
 * SAYS it failed (ADR 0020): `failed` carries plain words, never an empty
 * list standing in for "could not read".
 */

import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { InboundAddressService } from "../../common/orchestrator/inbound-address.service";
import { GMAIL_SEND_SCOPE, HouseSenderService } from "../letters/house-sender.service";
import { testSubject } from "./test-letter";

const OWNER_MANAGER = new Set(["owner", "manager"]);

/** The least trusted reading of a missing or unknown role, never the most. */
export function mayChangeHouseMail(role: string | null | undefined): boolean {
  return typeof role === "string" && OWNER_MANAGER.has(role.toLowerCase());
}

export interface MailSenderChoice {
  connectionId: string;
  /** Null when the grant never recorded its address (send-only consent). */
  address: string | null;
  personName: string | null;
  /** The asker's own grant. */
  mine: boolean;
  /** The house chose this one. */
  chosen: boolean;
  /** A letter queued now would leave from this one. */
  sending: boolean;
}

export interface MailTestLetter {
  code: string;
  subject: string;
  address: string;
  mailto: string;
  startedAt: string;
  arrivedAt: string | null;
  arrivedFrom: string | null;
}

export interface MailSetupView {
  canChange: boolean;
  senders: {
    failed: string | null;
    choices: MailSenderChoice[];
    chosenConnectionId: string | null;
  };
  arrival: {
    /** Mudavym can receive mail for houses at all (a domain is set up). */
    domainReady: boolean;
    address: string | null;
    failed: string | null;
  };
  testLetter: {
    failed: string | null;
    latest: MailTestLetter | null;
  };
}

/** The words in the body of the test letter. Plain, and says what it is for. */
const TEST_BODY =
  "This is a test letter to check that mail reaches Mudavym. You can send it as it is.";

export function mailtoFor(address: string, subject: string): string {
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(TEST_BODY)}`;
}

@Injectable()
export class MailSetupService {
  private readonly logger = new Logger(MailSetupService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly inboundAddress: InboundAddressService,
    private readonly sender: HouseSenderService,
  ) {}

  async read(
    restaurantId: string,
    userId: string,
    role: string | null | undefined,
  ): Promise<MailSetupView> {
    const [senders, arrival, testLetter] = await Promise.all([
      this.readSenders(restaurantId, userId),
      this.readArrival(restaurantId),
      this.readTestLetter(restaurantId),
    ]);
    return { canChange: mayChangeHouseMail(role), senders, arrival, testLetter };
  }

  private async readSenders(
    restaurantId: string,
    userId: string,
  ): Promise<MailSetupView["senders"]> {
    const failed = (words: string) => ({ failed: words, choices: [], chosenConnectionId: null });
    try {
      const [grants, choice, identity] = await Promise.all([
        this.db.client
          .from("integration_oauth_connections")
          .select("id, user_id, account_email, scopes, connected_at")
          .eq("restaurant_id", restaurantId)
          .eq("provider", "google")
          .is("revoked_at", null)
          .order("connected_at", { ascending: true }),
        this.db.client
          .from("house_mail_sender_choice")
          .select("connection_id")
          .eq("restaurant_id", restaurantId)
          .maybeSingle(),
        this.sender.resolve(restaurantId, userId),
      ]);
      if (grants.error || choice.error) {
        this.logger.error(
          `Mail setup senders could not be read for ${restaurantId}: ${(grants.error ?? choice.error)!.message}`,
        );
        return failed("Which mailboxes this house can send from could not be read.");
      }
      const rows = ((grants.data ?? []) as Record<string, unknown>[]).filter(
        (r) => Array.isArray(r.scopes) && (r.scopes as string[]).includes(GMAIL_SEND_SCOPE),
      );
      const chosenId =
        typeof (choice.data as any)?.connection_id === "string"
          ? ((choice.data as any).connection_id as string)
          : null;
      const sendingId = identity.grant?.connectionId ?? null;
      const names = await this.namesOf(rows.map((r) => String(r.user_id)));
      const choices: MailSenderChoice[] = rows.map((r) => ({
        connectionId: String(r.id),
        address: typeof r.account_email === "string" && r.account_email ? r.account_email : null,
        personName: names.get(String(r.user_id)) ?? null,
        mine: String(r.user_id) === userId,
        chosen: String(r.id) === chosenId,
        sending: String(r.id) === sendingId,
      }));
      // A choice that points at a grant which no longer sends is not a choice.
      const live = choices.some((c) => c.chosen) ? chosenId : null;
      return { failed: null, choices, chosenConnectionId: live };
    } catch (e: any) {
      this.logger.error(`Mail setup senders could not be read for ${restaurantId}: ${e?.message}`);
      return failed("Which mailboxes this house can send from could not be read.");
    }
  }

  /** Names for the people whose grants are listed. A failed read names nobody, it does not fail the list. */
  private async namesOf(userIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (userIds.length === 0) return out;
    try {
      const { data, error } = await this.db.client
        .from("users")
        .select("user_id, name")
        .in("user_id", Array.from(new Set(userIds)));
      if (error) return out;
      for (const r of (data ?? []) as Record<string, unknown>[]) {
        if (typeof r.name === "string" && r.name.trim()) out.set(String(r.user_id), r.name.trim());
      }
    } catch {
      /* names are a courtesy; the address is the answer */
    }
    return out;
  }

  private async readArrival(restaurantId: string): Promise<MailSetupView["arrival"]> {
    const domainReady = Boolean(this.inboundAddress.domain());
    if (!domainReady) return { domainReady, address: null, failed: null };
    try {
      // A plain read: never provisions (QA M-12).
      const { data, error } = await this.db.client
        .from("restaurant_inbound_addresses")
        .select("address")
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1);
      if (error) {
        this.logger.error(`Mudavym address could not be read for ${restaurantId}: ${error.message}`);
        return { domainReady, address: null, failed: "The house's Mudavym address could not be read." };
      }
      const addr = ((data ?? []) as Record<string, unknown>[])[0]?.address;
      return { domainReady, address: typeof addr === "string" ? addr : null, failed: null };
    } catch (e: any) {
      this.logger.error(`Mudavym address could not be read for ${restaurantId}: ${e?.message}`);
      return { domainReady, address: null, failed: "The house's Mudavym address could not be read." };
    }
  }

  private async readTestLetter(restaurantId: string): Promise<MailSetupView["testLetter"]> {
    const failed = { failed: "Whether the test letter arrived could not be read.", latest: null };
    try {
      const { data, error } = await this.db.client
        .from("mail_setup_checks")
        .select("code, address, started_at, arrived_at, arrived_from")
        .eq("restaurant_id", restaurantId)
        .order("started_at", { ascending: false })
        .limit(1);
      if (error) {
        this.logger.error(`Test letter could not be read for ${restaurantId}: ${error.message}`);
        return failed;
      }
      const r = ((data ?? []) as Record<string, any>[])[0];
      if (!r) return { failed: null, latest: null };
      const subject = testSubject(String(r.code));
      return {
        failed: null,
        latest: {
          code: String(r.code),
          subject,
          address: String(r.address),
          mailto: mailtoFor(String(r.address), subject),
          startedAt: String(r.started_at),
          arrivedAt: r.arrived_at ? String(r.arrived_at) : null,
          arrivedFrom: r.arrived_from ? String(r.arrived_from) : null,
        },
      };
    } catch (e: any) {
      this.logger.error(`Test letter could not be read for ${restaurantId}: ${e?.message}`);
      return failed;
    }
  }
}
