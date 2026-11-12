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

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { InboundAddressService } from "../../common/orchestrator/inbound-address.service";
import { GMAIL_SEND_SCOPE, HouseSenderService } from "../letters/house-sender.service";
import { newTestCode, testSubject } from "./test-letter";

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
    /**
     * The newest arrival of ANY of this house's checks (QA round 26, #974): a
     * check started earlier can land after a newer one was started, and that
     * still proves mail reaches the house. Null when none has arrived.
     */
    lastArrival: { code: string; arrivedAt: string; arrivedFrom: string | null } | null;
  };
}

const NO_CHANGE_WORDS =
  "Only an owner or a manager of this house can change how its mail is set up.";

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

  /**
   * Point the house's letters at one of its own sending grants, or (null)
   * clear the choice and go back to the plain rule.
   */
  async chooseSender(
    restaurantId: string,
    userId: string,
    role: string | null | undefined,
    connectionId: string | null,
  ): Promise<MailSetupView> {
    if (!mayChangeHouseMail(role)) throw new ForbiddenException(NO_CHANGE_WORDS);

    if (connectionId === null) {
      const { error } = await this.db.client
        .from("house_mail_sender_choice")
        .delete()
        .eq("restaurant_id", restaurantId);
      if (error) {
        this.logger.error(`Clearing the sender choice failed for ${restaurantId}: ${error.message}`);
        throw new ServiceUnavailableException(
          "The choice could not be cleared. Nothing was changed; try again.",
        );
      }
      return this.read(restaurantId, userId, role);
    }

    // Only a live Google grant of THIS house that may send. The table's own
    // trigger refuses another house's grant too; this is the plain-words door.
    const { data, error } = await this.db.client
      .from("integration_oauth_connections")
      .select("id, user_id, scopes")
      .eq("id", connectionId)
      .eq("restaurant_id", restaurantId)
      .eq("provider", "google")
      .is("revoked_at", null)
      .maybeSingle();
    if (error) {
      this.logger.error(`Reading grant ${connectionId} failed for ${restaurantId}: ${error.message}`);
      throw new ServiceUnavailableException(
        "The mailbox could not be checked. Nothing was changed; try again.",
      );
    }
    const scopes = Array.isArray((data as any)?.scopes) ? ((data as any).scopes as string[]) : [];
    if (!data || !scopes.includes(GMAIL_SEND_SCOPE)) {
      throw new BadRequestException(
        "That mailbox is not one this house can send from any more. Nothing was changed.",
      );
    }
    // ONLY YOUR OWN MAILBOX (QA round 26, #973; the session's call under the
    // 2026-11-07 /goal). A person's send consent lets the house's letters
    // leave from their mailbox when THEY write, or when nobody else has one;
    // it does not let a colleague make that mailbox the line every letter of
    // the house leaves from. Clearing a choice stays open to any owner or
    // manager: it hands the house back to the plain rule and uses nobody's
    // mailbox without their say. HouseSenderService.resolve checks the same
    // thing again, so a row that got past this door is not obeyed.
    if (String((data as any).user_id) !== userId) {
      throw new ForbiddenException(
        "Only the person who connected that mailbox can choose it for the house's letters. Ask them to choose it here, or connect your own mailbox in Connections. Nothing was changed.",
      );
    }

    const { error: writeError } = await this.db.client
      .from("house_mail_sender_choice")
      .upsert(
        {
          restaurant_id: restaurantId,
          connection_id: connectionId,
          chosen_by: userId,
          chosen_at: new Date().toISOString(),
        },
        { onConflict: "restaurant_id" },
      );
    if (writeError) {
      this.logger.error(`Saving the sender choice failed for ${restaurantId}: ${writeError.message}`);
      throw new ServiceUnavailableException(
        "The choice could not be saved. Nothing was changed; try again.",
      );
    }
    return this.read(restaurantId, userId, role);
  }

  /** Make the house's Mudavym address, if it has none yet. */
  async makeAddress(
    restaurantId: string,
    userId: string,
    role: string | null | undefined,
  ): Promise<MailSetupView> {
    if (!mayChangeHouseMail(role)) throw new ForbiddenException(NO_CHANGE_WORDS);
    await this.provisionedAddress(restaurantId);
    return this.read(restaurantId, userId, role);
  }

  /**
   * Start a test letter: a fresh code and the `mailto:` that carries it. No
   * mail leaves Mudavym here — the owner sends it, from any mailbox, the way
   * a vendor would (see test-letter.ts).
   */
  async startTestLetter(
    restaurantId: string,
    userId: string,
    role: string | null | undefined,
  ): Promise<MailSetupView> {
    if (!mayChangeHouseMail(role)) throw new ForbiddenException(NO_CHANGE_WORDS);
    const address = await this.provisionedAddress(restaurantId);

    // A code is unique only inside one house; a clash is one in 10^12 and is
    // simply drawn again.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await this.db.client.from("mail_setup_checks").insert({
        restaurant_id: restaurantId,
        code: newTestCode(),
        address,
        started_by: userId,
      });
      if (!error) return this.read(restaurantId, userId, role);
      if ((error as any).code !== "23505") {
        this.logger.error(`Starting a test letter failed for ${restaurantId}: ${error.message}`);
        break;
      }
    }
    throw new ServiceUnavailableException(
      "The test letter could not be started. Nothing was changed; try again.",
    );
  }

  private async provisionedAddress(restaurantId: string): Promise<string> {
    if (!this.inboundAddress.domain()) {
      throw new ConflictException(
        "Mudavym cannot receive mail for houses yet, so there is no address to make. Your own connected mailbox still works.",
      );
    }
    const address = await this.inboundAddress.addressFor(restaurantId);
    if (!address) {
      throw new ServiceUnavailableException(
        "The house's Mudavym address could not be made. Nothing was changed; try again.",
      );
    }
    return address;
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
          .select("connection_id, chosen_by")
          .eq("restaurant_id", restaurantId)
          .maybeSingle(),
        this.sender.resolve(restaurantId, userId),
      ]);
      if (grants.error) {
        this.logger.error(`Mail setup senders could not be read for ${restaurantId}: ${grants.error.message}`);
        return failed("Which mailboxes this house can send from could not be read.");
      }
      // An unread choice is not "no choice": say so (QA round 26, #975 M11).
      if (choice.error) {
        this.logger.error(`Mail setup sender choice could not be read for ${restaurantId}: ${choice.error.message}`);
        return failed("The house's chosen mailbox could not be read.");
      }
      const rows = ((grants.data ?? []) as Record<string, unknown>[]).filter(
        (r) => Array.isArray(r.scopes) && (r.scopes as string[]).includes(GMAIL_SEND_SCOPE),
      );
      const chosenId =
        typeof (choice.data as any)?.connection_id === "string"
          ? ((choice.data as any).connection_id as string)
          : null;
      // A choice counts only when its owner made it (the resolver's rule).
      const chosenBy =
        typeof (choice.data as any)?.chosen_by === "string" ? ((choice.data as any).chosen_by as string) : null;
      const sendingId = identity.grant?.connectionId ?? null;
      const names = await this.namesOf(rows.map((r) => String(r.user_id)));
      const choices: MailSenderChoice[] = rows.map((r) => ({
        connectionId: String(r.id),
        address: typeof r.account_email === "string" && r.account_email ? r.account_email : null,
        personName: names.get(String(r.user_id)) ?? null,
        mine: String(r.user_id) === userId,
        chosen: String(r.id) === chosenId && String(r.user_id) === chosenBy,
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
    const failed = { failed: "Whether the test letter arrived could not be read.", latest: null, lastArrival: null };
    try {
      const [newest, arrived] = await Promise.all([
        this.db.client
          .from("mail_setup_checks")
          .select("code, address, started_at, arrived_at, arrived_from")
          .eq("restaurant_id", restaurantId)
          .order("started_at", { ascending: false })
          .limit(1),
        this.db.client
          .from("mail_setup_checks")
          .select("code, arrived_at, arrived_from")
          .eq("restaurant_id", restaurantId)
          .not("arrived_at", "is", null)
          .order("arrived_at", { ascending: false })
          .limit(1),
      ]);
      if (newest.error || arrived.error) {
        this.logger.error(
          `Test letter could not be read for ${restaurantId}: ${(newest.error ?? arrived.error)!.message}`,
        );
        return failed;
      }
      const a = ((arrived.data ?? []) as Record<string, any>[])[0];
      const lastArrival = a?.arrived_at
        ? { code: String(a.code), arrivedAt: String(a.arrived_at), arrivedFrom: a.arrived_from ? String(a.arrived_from) : null }
        : null;
      const r = ((newest.data ?? []) as Record<string, any>[])[0];
      if (!r) return { failed: null, latest: null, lastArrival };
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
        lastArrival,
      };
    } catch (e: any) {
      this.logger.error(`Test letter could not be read for ${restaurantId}: ${e?.message}`);
      return failed;
    }
  }

}
