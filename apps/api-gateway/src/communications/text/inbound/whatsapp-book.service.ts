/**
 * The phone half of the book, and the 24-hour window.
 *
 * TWO QUESTIONS, ONE SERVICE, AND THEY ARE THE SAME QUESTION
 * ----------------------------------------------------------
 * ADR 0118 D3 says the composer has no free-text recipient: a letter may only
 * go to an address already in this house's book. ADR 0121 carries that to a
 * text over `providers.contact_phone`, `providers.primary_contact.phone` and
 * `provider_contacts.phone`. This service is that book, read in both
 * directions:
 *
 *   `phoneBook(restaurantId)`     — who may the house text, and on what number.
 *   `providerForWaId(…)`          — an arriving number, resolved to a vendor.
 *
 * The second is what makes the inbound webhook tenant-safe without trusting the
 * body: a message is threaded onto a house's conversation only if the number it
 * came from is already in THAT house's book.
 *
 * AND THE WINDOW, WHICH IS THE SAME BOOK READ BY TIME
 * ---------------------------------------------------
 * `windowFor` answers whether a free-form WhatsApp message may be sent at all.
 * Meta: *"When a WhatsApp user messages you or calls you, a 24-hour timer called
 * a customer service window starts… When the window closes, you can only send
 * pre-approved template messages"*
 * (`developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages`,
 * fetched 2026-09-06). This build has no templates, so a closed window is a
 * refusal and not a fallback.
 *
 * THREE VERDICTS, NOT TWO. `open`, `closed`, and `unknown` for a read that
 * failed. Folding `unknown` into `closed` would put our outage into the house's
 * language ("start with a template") for something that is ours; folding it into
 * `open` would hand a message to Meta that Meta refuses, after the surface had
 * already said it went.
 */

import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../../database/database.service";
import {
  phoneReachability,
  type PhoneReach,
} from "../../../providers/phone-reachability";
import { digitsOf } from "./meta-webhook-payload";

/** Meta's own figure, in milliseconds. Named so a test cannot drift from it. */
export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The channel word every WhatsApp row in the conversation book carries. */
export const WHATSAPP_CHANNEL = "whatsapp";

export interface PhoneBookEntry {
  providerId: string;
  providerName: string;
  contactName: string | null;
  /** As the book holds it. Not normalised — the book's value is the record. */
  phone: string;
  /** Digits only, for matching an arriving `wa_id`. */
  digits: string;
  reach: PhoneReach;
  phoneTypeStated: boolean;
  reachSays: string;
  source: "provider" | "primary_contact" | "contact";
}

export interface PhoneBook {
  entries: PhoneBookEntry[];
  /** True only when EVERY read succeeded. */
  readable: boolean;
  /** Why it did not. Null when it did. */
  reason: string | null;
}

export type WindowState = "open" | "closed" | "unknown";

export interface WindowReadout {
  state: WindowState;
  /** When the vendor last wrote, ISO, or null. */
  lastInboundAt: string | null;
  /** The sentence a manager reads. Always populated. */
  says: string;
}

@Injectable()
export class WhatsAppBookService {
  private readonly logger = new Logger(WhatsAppBookService.name);

  constructor(private readonly db: DatabaseService) {}

  private get sb() {
    return this.db.client;
  }

  /**
   * Every number this house may text, with the verdict on each.
   *
   * A FAILED READ IS NOT AN EMPTY BOOK. `readable` is false and `entries` is
   * whatever was actually read, so a caller cannot mistake "this house has no
   * numbers" for "we could not ask". Every other book read in this repo that
   * got this wrong is in [[absence-reported-as-health]].
   */
  async phoneBook(restaurantId: string): Promise<PhoneBook> {
    const entries: PhoneBookEntry[] = [];

    const { data: providers, error } = await this.sb
      .from("providers")
      .select("id, name, contact_phone, primary_contact")
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null);

    if (error) {
      return {
        entries: [],
        readable: false,
        reason: `the vendor book could not be read (${error.message})`,
      };
    }

    const rows = (providers ?? []) as unknown as Record<string, unknown>[];
    const ids = rows.map((r) => String(r.id));
    const nameById = new Map(ids.map((id, i) => [id, String(rows[i].name ?? "")]));

    const push = (
      providerId: string,
      contactName: string | null,
      phone: string | null,
      phoneType: unknown,
      source: PhoneBookEntry["source"],
    ) => {
      if (!phone) return;
      const digits = digitsOf(phone);
      if (!digits) return;
      if (entries.some((e) => e.providerId === providerId && e.digits === digits))
        return;
      const r = phoneReachability(phoneType);
      entries.push({
        providerId,
        providerName: nameById.get(providerId) ?? "",
        contactName,
        phone,
        digits,
        reach: r.reach,
        phoneTypeStated: r.stated,
        reachSays: r.says,
        source,
      });
    };

    for (const r of rows) {
      const providerId = String(r.id);
      // `providers` has no phone_type column of its own, so the number on the
      // vendor row is UNSTATED by construction — not a landline. Passing `null`
      // says that; passing `'main_line'` would invent the same answer the
      // contacts column's default invents, one table over.
      push(
        providerId,
        null,
        (r.contact_phone as string | null) ?? null,
        null,
        "provider",
      );
      const primary = r.primary_contact as Record<string, unknown> | null;
      if (primary && typeof primary.phone === "string") {
        push(
          providerId,
          typeof primary.name === "string" ? primary.name : null,
          primary.phone,
          typeof primary.phone_type === "string" ? primary.phone_type : null,
          "primary_contact",
        );
      }
    }

    if (ids.length > 0) {
      const { data: contacts, error: contactError } = await this.sb
        .from("provider_contacts")
        .select("provider_id, name, phone, phone_type")
        .in("provider_id", ids);
      if (contactError) {
        return {
          entries,
          readable: false,
          reason: `the vendor book's contact list could not be read (${contactError.message})`,
        };
      }
      for (const c of (contacts ?? []) as unknown as Record<string, unknown>[]) {
        push(
          String(c.provider_id),
          (c.name as string | null) ?? null,
          (c.phone as string | null) ?? null,
          c.phone_type,
          "contact",
        );
      }
    }

    return { entries, readable: true, reason: null };
  }

  /**
   * Which vendor in THIS house's book owns an arriving number.
   *
   * Returns `undefined` for "not in the book" and `null` for "we could not
   * read the book" — the caller must not thread on either, and must not report
   * them as the same thing.
   */
  async providerForWaId(
    restaurantId: string,
    waId: string,
  ): Promise<PhoneBookEntry | null | undefined> {
    const book = await this.phoneBook(restaurantId);
    if (!book.readable) return null;
    const digits = digitsOf(waId);
    if (!digits) return undefined;

    // Exact digits first. Then a suffix match, because a book may hold a
    // national-format number ("0532 …") for a vendor whose wa_id is the full
    // international one ("90532 …"). The suffix must be at least nine digits:
    // shorter than that and two different vendors can collide, and threading a
    // vendor's reply onto the wrong vendor's conversation is worse than not
    // threading it at all.
    const exact = book.entries.find((e) => e.digits === digits);
    if (exact) return exact;

    const MIN_SUFFIX = 9;
    const candidates = book.entries.filter((e) => {
      const short = e.digits.length <= digits.length ? e.digits : digits;
      const long = e.digits.length <= digits.length ? digits : e.digits;
      return short.length >= MIN_SUFFIX && long.endsWith(short);
    });
    // Ambiguity is refused, not resolved by picking the first. Two vendors
    // matching one number is a fact about the book, and guessing hides it.
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      this.logger.warn(
        `providerForWaId: ${candidates.length} vendors in restaurant ${restaurantId} match one arriving number; not threading`,
      );
    }
    return undefined;
  }

  /**
   * Is the 24-hour customer service window open with this vendor?
   *
   * Read off the house's OWN book — the last inbound WhatsApp row on
   * `procurement_conversations` — rather than from Meta. That is deliberate and
   * it is ADR 0121's mirror rule: Meta holds the transport, the house's book
   * holds the record, and a window computed from the record is one the house
   * can audit. It also means the window is only as good as the mirror, which is
   * exactly why the mirror is written before anything is rendered.
   */
  async windowFor(
    restaurantId: string,
    providerId: string,
    nowMs = Date.now(),
  ): Promise<WindowReadout> {
    const { data, error } = await this.sb
      .from("procurement_conversations")
      .select("received_at, created_at")
      .eq("restaurant_id", restaurantId)
      .eq("provider_id", providerId)
      .eq("channel", WHATSAPP_CHANNEL)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      // NOT `closed`. Our read failing is ours, and a manager told to "start
      // with a template" for our outage has been handed the wrong problem.
      this.logger.error(`windowFor read failed: ${error.message}`);
      return {
        state: "unknown",
        lastInboundAt: null,
        says: `Whether this conversation's 24-hour window is open could not be read (${error.message}), so nothing was attempted. That is not the same as the window being closed.`,
      };
    }

    const row = (data ?? [])[0] as Record<string, unknown> | undefined;
    const stamp =
      (row?.received_at as string | null) ??
      (row?.created_at as string | null) ??
      null;
    if (!stamp) {
      return {
        state: "closed",
        lastInboundAt: null,
        says: "This vendor has never written to this house on WhatsApp, so there is no 24-hour window to reply inside. Nothing was sent and nothing was queued: a house-initiated WhatsApp message needs an approved template, which this build does not have.",
      };
    }

    const at = Date.parse(stamp);
    if (Number.isNaN(at)) {
      return {
        state: "unknown",
        lastInboundAt: stamp,
        says: `This vendor's last WhatsApp reply carries a timestamp this build cannot read ("${stamp}"), so whether the 24-hour window is open is unknown and nothing was attempted.`,
      };
    }

    const elapsed = nowMs - at;
    if (elapsed < CUSTOMER_SERVICE_WINDOW_MS) {
      const hoursLeft = Math.floor(
        (CUSTOMER_SERVICE_WINDOW_MS - elapsed) / (60 * 60 * 1000),
      );
      return {
        state: "open",
        lastInboundAt: stamp,
        says: `This vendor wrote within the last 24 hours, so a free-form WhatsApp reply may be sent. About ${hoursLeft} hour${hoursLeft === 1 ? "" : "s"} of the window remain.`,
      };
    }

    return {
      state: "closed",
      lastInboundAt: stamp,
      says: `This vendor last wrote more than 24 hours ago, so WhatsApp's customer service window is closed and a free-form message cannot be sent. Nothing was sent and nothing was queued — it will not go out when they next reply. Reaching them first needs an approved template, which this build does not have.`,
    };
  }
}
