/**
 * The one door a text leaves this house through (ADR 0121).
 *
 * THE FOUNDER'S QUESTION THIS ANSWERS, VERBATIM (2026-09-05)
 * ---------------------------------------------------------
 *   *"can the house sends on their behalf? whatsapp business api? or sms
 *   sender? what do we need there"*
 *
 * The answer this file makes true: **the house sends in its own name, through
 * its own WhatsApp Business number or its own registered SMS sender, and a
 * person's phone is never the sender.** Every path where a person's own handset
 * would do the sending is closed by the platforms' own terms and is not
 * attempted here (ADR 0121 §c: iOS opens a composer a person presses send in;
 * Play restricts SMS to the default handler; WhatsApp's ToS forbid non-personal
 * use; Signal forbids bulk and automated messaging; Apple Messages for Business
 * and RCS are brand channels behind partner gates).
 *
 * WHAT THIS SERVICE WILL NOT DO
 * -----------------------------
 * It will not send. Not once, anywhere, in this build. `send()` resolves the
 * house's sender, resolves the person's consent, and then returns a REFUSAL
 * naming which of the two was missing — because no house on this deployment has
 * a sender and no provider credential for a per-house sender exists. A method
 * that returned `{ sent: true }` off an unconfigured provider is the exact
 * fabrication ADR 0084 deleted from `mockSendSms`, and the shape this repo
 * calls `absence-reported-as-health`.
 *
 * The refusal is the product. A control that says "this house has no sender"
 * with the reason is worth more than one that appears to work, and it is the
 * only thing that can be true today.
 *
 * THE PLIVO NUMBER IS NOT A FALLBACK
 * ----------------------------------
 * `SmsService` still exists and still holds one `PLIVO_PHONE_NUMBER` for the
 * whole deployment (`communications/sms.service.ts:30-33`). It is deliberately
 * NOT reachable from here. Falling back to it would put every house's text
 * behind one shared identity — the shape ADR 0121 refused, and one Twilio's own
 * US guidelines list among the restricted use cases ("shared phone numbers").
 * On a shared number STOP is global: one person's opt-out silences the platform
 * for every restaurant on it, for five years.
 *
 * FOUR STATES, NOT TWO (ADR 0051 clause 3). "This house has no sender" and "we
 * could not read whether it has one" are different facts, and a reader who
 * cannot tell them apart is being told the second is the first. `unknown` is
 * therefore a first-class outcome everywhere below, never folded into `none`.
 */

import { ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import {
  TEXT_SENDER_DEFINITIONS,
  type SenderPath,
  type TextChannel,
  definitionForChannel,
  requirementFor,
} from "./text-senders.catalogue";

/** The states `house_text_senders.state` may hold. Mirrors the CHECK. */
export type SenderState =
  | "requested"
  | "submitted"
  | "in_review"
  | "connected"
  | "rejected"
  | "revoked";

/** Only this state may send. Stated once so no caller invents a second rule. */
export const SENDABLE_STATE: SenderState = "connected";

export interface HouseSenderRow {
  id: string;
  channel: TextChannel;
  path: SenderPath;
  state: SenderState;
  stateDetail: string | null;
  identity: string | null;
  identityKind: "e164" | "alphanumeric" | null;
  displayName: string | null;
  displayNameState: string | null;
  market: string;
  provider: string | null;
  externalRef: string | null;
  declaredBy: string | null;
  lastProbeAt: string | null;
  lastProbeResult: string | null;
  lastProbeDetail: string | null;
  feeStated: string | null;
  timelineStated: string | null;
  submittedAt: string | null;
  connectedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface SendersReadout {
  /** `null` for a channel this house has no row for at all. */
  whatsapp: HouseSenderRow | null;
  sms: HouseSenderRow | null;
  /** True only when the READ succeeded. False means we do not know. */
  readable: boolean;
  /** The gateway's own sentence when the read failed. */
  reason: string | null;
}

export interface PersonConsent {
  userId: string;
  phone: string;
  channel: "whatsapp" | "sms" | "any";
  consentedAt: string;
}

export type SendRefusal =
  | "no_sender"
  | "sender_not_connected"
  | "no_consent"
  | "channel_unsupported_in_market"
  | "read_failed"
  | "transport_not_built";

export interface SendOutcome {
  /** Always false in this build, and the type keeps it honest. */
  sent: false;
  refusal: SendRefusal;
  /** The sentence a manager reads. Never a code on its own. */
  words: string;
  channel: TextChannel | null;
}

@Injectable()
export class TextSenderService {
  private readonly logger = new Logger(TextSenderService.name);

  constructor(private readonly db: DatabaseService) {}

  private get sb() {
    return this.db.client;
  }

  private static readonly COLUMNS =
    "id, restaurant_id, channel, path, state, state_detail, identity, identity_kind, " +
    "display_name, display_name_state, market, provider, external_ref, declared_by, " +
    "last_probe_at, last_probe_result, last_probe_detail, fee_stated, timeline_stated, " +
    "submitted_at, connected_at, revoked_at, created_at";

  private shape(row: Record<string, any>): HouseSenderRow {
    return {
      id: String(row.id),
      channel: row.channel as TextChannel,
      path: row.path as SenderPath,
      state: row.state as SenderState,
      stateDetail: row.state_detail ?? null,
      identity: row.identity ?? null,
      identityKind: row.identity_kind ?? null,
      displayName: row.display_name ?? null,
      displayNameState: row.display_name_state ?? null,
      market: String(row.market),
      provider: row.provider ?? null,
      externalRef: row.external_ref ?? null,
      declaredBy: row.declared_by ?? null,
      lastProbeAt: row.last_probe_at ?? null,
      lastProbeResult: row.last_probe_result ?? null,
      lastProbeDetail: row.last_probe_detail ?? null,
      feeStated: row.fee_stated ?? null,
      timelineStated: row.timeline_stated ?? null,
      submittedAt: row.submitted_at ?? null,
      connectedAt: row.connected_at ?? null,
      revokedAt: row.revoked_at ?? null,
      createdAt: String(row.created_at),
    };
  }

  /**
   * Both of this house's senders, and whether the read worked.
   *
   * A FAILED READ IS NOT AN EMPTY HOUSE. supabase-js resolves `{ data, error }`
   * and never throws, so a caller that ignores `error` turns a database outage
   * into "this restaurant has no sender" — which is the sentence a surface then
   * prints beside a disabled control, and it would be a lie.
   */
  async readout(restaurantId: string): Promise<SendersReadout> {
    const { data, error } = await this.sb
      .from("house_text_senders")
      .select(TextSenderService.COLUMNS)
      .eq("restaurant_id", restaurantId)
      .neq("state", "revoked")
      .order("created_at", { ascending: false });

    if (error) {
      this.logger.error(`house_text_senders read failed: ${error.message}`);
      return {
        whatsapp: null,
        sms: null,
        readable: false,
        reason: error.message,
      };
    }

    const rows = (data ?? []).map((r) => this.shape(r as Record<string, any>));
    return {
      whatsapp: rows.find((r) => r.channel === "whatsapp") ?? null,
      sms: rows.find((r) => r.channel === "sms") ?? null,
      readable: true,
      reason: null,
    };
  }

  /**
   * The sender this house may actually send on for a channel, or `null`.
   *
   * `null` covers three different situations and the caller is told which, via
   * `readout()`; this method exists for the send path, where the only question
   * is "may anything leave".
   */
  async sendableSender(
    restaurantId: string,
    channel: TextChannel,
  ): Promise<HouseSenderRow | null> {
    const readout = await this.readout(restaurantId);
    if (!readout.readable) return null;
    const row = channel === "whatsapp" ? readout.whatsapp : readout.sms;
    return row && row.state === SENDABLE_STATE ? row : null;
  }

  /**
   * The live consents of these people for this house.
   *
   * `null` means the READ FAILED. It does not mean nobody consented, and a
   * caller that treats it as such would text people who never agreed — or, more
   * likely here, report "nobody consented" about a house where everybody did.
   */
  async consentsFor(
    restaurantId: string,
    userIds: string[],
  ): Promise<Map<string, PersonConsent> | null> {
    if (!userIds.length) return new Map();
    const { data, error } = await this.sb
      .from("person_text_consents")
      .select("user_id, phone, channel, consented_at")
      .eq("restaurant_id", restaurantId)
      .in("user_id", userIds)
      .is("withdrawn_at", null);

    if (error) {
      this.logger.error(`person_text_consents read failed: ${error.message}`);
      return null;
    }

    const out = new Map<string, PersonConsent>();
    for (const row of data ?? []) {
      const r = row as Record<string, any>;
      out.set(String(r.user_id), {
        userId: String(r.user_id),
        phone: String(r.phone),
        channel: r.channel,
        consentedAt: String(r.consented_at),
      });
    }
    return out;
  }

  /**
   * Which channel a message to this person would go out on, given what the
   * house has and what the person agreed to.
   *
   * WHATSAPP FIRST WHERE BOTH EXIST, and the reason is not preference: in
   * Türkiye an SMS cannot receive a reply at all ("Two-way SMS supported: No"),
   * so choosing SMS there would be choosing the channel that cannot hold the
   * conversation the founder asked for. Where the market has no WhatsApp sender
   * and SMS is two-way, SMS is chosen.
   */
  choose(params: {
    consent: PersonConsent | null;
    whatsapp: HouseSenderRow | null;
    sms: HouseSenderRow | null;
  }): { channel: TextChannel | null; why: string } {
    const { consent, whatsapp, sms } = params;
    if (!consent) {
      return {
        channel: null,
        why: "This person has not agreed to be texted by this house, so nothing is sent to them and nothing is queued.",
      };
    }

    const wantsWhatsapp = consent.channel === "whatsapp" || consent.channel === "any";
    const wantsSms = consent.channel === "sms" || consent.channel === "any";

    if (wantsWhatsapp && whatsapp && whatsapp.state === SENDABLE_STATE) {
      return {
        channel: "whatsapp",
        why: `This house's WhatsApp Business number (${whatsapp.identity ?? "unnamed"}) carries it, and the reply comes back into this house's book.`,
      };
    }
    if (wantsSms && sms && sms.state === SENDABLE_STATE) {
      const req = requirementFor("sms", sms.market);
      const oneWay = req && !req.twoWay;
      return {
        channel: "sms",
        why: oneWay
          ? `This house's registered SMS sender in ${req!.marketLabel} carries it. It is one-way there: a reply cannot come back, and nothing on this surface will pretend one can.`
          : "This house's registered SMS sender carries it.",
      };
    }
    return {
      channel: null,
      why: "This house has no connected sender for the channel this person agreed to, so nothing is sent.",
    };
  }

  /**
   * Send. Refuses, every time, and says which of the two halves is missing.
   *
   * THIS IS NOT A STUB WAITING FOR A PROVIDER CALL TO BE PASTED IN. The
   * refusal is load-bearing: three registrations, a Meta business verification
   * and a per-house credential stand between this method and a delivered
   * message, and none of them exists on this deployment. `transport_not_built`
   * is returned even when a house HAS a connected sender, because a connected
   * row is a record of a registration and not a wired provider client — and a
   * method that sent on the strength of a row somebody typed would be trusting
   * a claim instead of a transport.
   */
  async send(params: {
    restaurantId: string;
    recipientUserId: string;
    body: string;
  }): Promise<SendOutcome> {
    const readout = await this.readout(params.restaurantId);
    if (!readout.readable) {
      return {
        sent: false,
        refusal: "read_failed",
        channel: null,
        words: `This house's senders could not be read, so nothing was attempted: ${readout.reason}. That is not the same as this house having no sender.`,
      };
    }

    const consents = await this.consentsFor(params.restaurantId, [
      params.recipientUserId,
    ]);
    if (consents === null) {
      return {
        sent: false,
        refusal: "read_failed",
        channel: null,
        words:
          "This person's consent could not be read, so nothing was attempted. Sending without being able to read a consent is how a withdrawal gets ignored.",
      };
    }

    const chosen = this.choose({
      consent: consents.get(params.recipientUserId) ?? null,
      whatsapp: readout.whatsapp,
      sms: readout.sms,
    });

    if (!chosen.channel) {
      const anySender =
        readout.whatsapp?.state === SENDABLE_STATE ||
        readout.sms?.state === SENDABLE_STATE;
      return {
        sent: false,
        refusal: anySender ? "no_consent" : "no_sender",
        channel: null,
        words: chosen.why,
      };
    }

    return {
      sent: false,
      refusal: "transport_not_built",
      channel: chosen.channel,
      words:
        `${chosen.why} No message left: this build records the sender and the consent and does not yet hold a provider credential for a per-house sender, so nothing was handed to a transport. Nothing has been queued and nothing will arrive later.`,
    };
  }

  // ── The house's side: declaring and requesting ───────────────────────────

  /**
   * A house connects a sender it already owns.
   *
   * NOTHING HERE ACCEPTS A PASSWORD, AND THERE IS NO FIELD FOR ONE. The house's
   * credential arrives as a provider-issued token (Meta's Embedded Signup hands
   * back an exchangeable code; a provider subaccount hands back a scoped API
   * key) and this row stores a POINTER to the encrypted record, never the
   * secret. The row lands in `requested` — never `connected` — because a
   * declared sender is not a reachable one (ADR 0107) and only a live probe may
   * move it.
   */
  async declareOwn(params: {
    restaurantId: string;
    declaredBy: string;
    channel: TextChannel;
    market: string;
    identity: string;
    identityKind: "e164" | "alphanumeric";
    displayName?: string | null;
    provider?: string | null;
    vaultSecretRef?: string | null;
  }): Promise<HouseSenderRow> {
    const definition = definitionForChannel(params.channel);
    const requirement = requirementFor(params.channel, params.market);

    const { data, error } = await this.sb
      .from("house_text_senders")
      .insert({
        restaurant_id: params.restaurantId,
        channel: params.channel,
        path: "bring_your_own" as SenderPath,
        // Explicit, never a default: the migration asserts the column has none.
        state: "requested" as SenderState,
        state_detail:
          "Connected but not yet proven. Nothing sends until a live probe reaches this sender.",
        identity: params.identity,
        identity_kind: params.identityKind,
        display_name: params.displayName ?? null,
        display_name_state: null,
        market: params.market,
        provider: params.provider ?? null,
        external_ref: null,
        vault_secret_ref: params.vaultSecretRef ?? null,
        declared_by: params.declaredBy,
        last_probe_at: null,
        last_probe_result: null,
        last_probe_detail: null,
        legal_name: null,
        tax_id_ref: null,
        registered_address: null,
        website_url: null,
        contact_name: null,
        contact_email: null,
        use_case: null,
        sample_messages: null,
        opt_in_description: null,
        fee_stated: requirement?.fee ?? null,
        timeline_stated: requirement?.timeline ?? null,
        submitted_at: null,
        connected_at: null,
        revoked_at: null,
        revoked_by: null,
        revoked_reason: null,
      })
      .select(TextSenderService.COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error(`declareOwn failed: ${error?.message}`);
      throw new ForbiddenException(
        `The sender was not recorded, so nothing changed: ${error?.message ?? "no row came back"}. ${definition.label} is unchanged for this house.`,
      );
    }
    return this.shape(data as Record<string, any>);
  }

  /**
   * A house asks Mudavym to register a sender for it.
   *
   * THIS RECORDS A REQUEST. IT SUBMITS NOTHING. There is no route in this build
   * that moves a row to `submitted`, and that is deliberate: submitting a
   * registration puts the house's legal identity in front of a registrar, and
   * ADR 0121's rule is that it never happens without the seal. Until the
   * submitting act exists with its seal, the honest state is a recorded
   * request with the fee and the timeline printed beside it.
   *
   * The identity submitted is the HOUSE's in both paths. A regulatory bundle
   * "must represent the actual end-user" and "Twilio audits this"; an ISV
   * registering a Sender ID must supply "your customers' business and
   * representative information, including a government ID". Mudavym operates
   * the submission; it never stands in as the sender.
   */
  async requestRegistration(params: {
    restaurantId: string;
    declaredBy: string;
    channel: TextChannel;
    market: string;
    legalName: string;
    registeredAddress: string;
    taxIdRef: string | null;
    websiteUrl: string | null;
    contactName: string;
    contactEmail: string;
    useCase: string;
    sampleMessages: string[];
    optInDescription: string;
  }): Promise<HouseSenderRow> {
    const requirement = requirementFor(params.channel, params.market);

    const { data, error } = await this.sb
      .from("house_text_senders")
      .insert({
        restaurant_id: params.restaurantId,
        channel: params.channel,
        path: "mudavym_registers" as SenderPath,
        state: "requested" as SenderState,
        state_detail:
          "Recorded. Nothing has been submitted to a registrar: submitting is a sealed act and this build has no route that performs it.",
        identity: null,
        identity_kind: null,
        display_name: null,
        display_name_state: null,
        market: params.market,
        provider: null,
        external_ref: null,
        vault_secret_ref: null,
        declared_by: params.declaredBy,
        last_probe_at: null,
        last_probe_result: null,
        last_probe_detail: null,
        legal_name: params.legalName,
        tax_id_ref: params.taxIdRef,
        registered_address: params.registeredAddress,
        website_url: params.websiteUrl,
        contact_name: params.contactName,
        contact_email: params.contactEmail,
        use_case: params.useCase,
        sample_messages: params.sampleMessages,
        opt_in_description: params.optInDescription,
        // Printed at request time and KEPT, so the house can read later what it
        // was told the wait and the fee would be.
        fee_stated: requirement?.fee ?? null,
        timeline_stated: requirement?.timeline ?? null,
        submitted_at: null,
        connected_at: null,
        revoked_at: null,
        revoked_by: null,
        revoked_reason: null,
      })
      .select(TextSenderService.COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error(`requestRegistration failed: ${error?.message}`);
      throw new ForbiddenException(
        `The registration request was not recorded, so nothing was submitted anywhere: ${error?.message ?? "no row came back"}.`,
      );
    }
    return this.shape(data as Record<string, any>);
  }

  /**
   * A manager stops the house using a sender.
   *
   * A soft revoke: the row stays, carries who stopped it and when, and drops
   * out of `readout()` because it is filtered on `state <> 'revoked'`. Deleting
   * it would erase the fact that this house once had a sender, which is the
   * kind of thing a dispute is about.
   */
  async revoke(params: {
    restaurantId: string;
    senderId: string;
    revokedBy: string;
    reason: string;
  }): Promise<{ revoked: boolean; words: string }> {
    const now = new Date().toISOString();
    const { data, error } = await this.sb
      .from("house_text_senders")
      .update({
        state: "revoked" as SenderState,
        revoked_at: now,
        revoked_by: params.revokedBy,
        revoked_reason: params.reason,
      })
      .eq("id", params.senderId)
      .eq("restaurant_id", params.restaurantId)
      .neq("state", "revoked")
      .select("id")
      .maybeSingle();

    if (error) {
      this.logger.error(`revoke failed: ${error.message}`);
      throw new ForbiddenException(
        `The sender was not revoked, so it may still send: ${error.message}.`,
      );
    }
    if (!data) {
      // Unambiguous on purpose: the filter carries both the tenant and the
      // not-already-revoked condition, so no match is either "not this house's"
      // or "already stopped", and neither is a success.
      return {
        revoked: false,
        words:
          "Nothing was revoked: either this sender does not belong to this restaurant, or it had already been stopped.",
      };
    }
    return {
      revoked: true,
      words:
        "Stopped. Nothing further leaves through this sender; the row stays so the house keeps the record that it once existed.",
    };
  }

  // ── The person's side: consent ───────────────────────────────────────────

  /** This person's live consent in this house, or `null`. */
  async myConsent(
    restaurantId: string,
    userId: string,
  ): Promise<{ consent: PersonConsent | null; readable: boolean; reason: string | null }> {
    const { data, error } = await this.sb
      .from("person_text_consents")
      .select("user_id, phone, channel, consented_at")
      .eq("restaurant_id", restaurantId)
      .eq("user_id", userId)
      .is("withdrawn_at", null)
      .maybeSingle();

    if (error) {
      this.logger.error(`myConsent read failed: ${error.message}`);
      return { consent: null, readable: false, reason: error.message };
    }
    if (!data) return { consent: null, readable: true, reason: null };
    const r = data as Record<string, any>;
    return {
      consent: {
        userId: String(r.user_id),
        phone: String(r.phone),
        channel: r.channel,
        consentedAt: String(r.consented_at),
      },
      readable: true,
      reason: null,
    };
  }

  /**
   * A person agrees to be texted at a number.
   *
   * ONLY THE PERSON THEMSELVES. There is no route by which a manager records
   * somebody else's consent and no column a manager could approve one through —
   * the migration raises if an `approved_at` / `approval_status` / `pending` /
   * `approved_by` column ever appears on this table. A consent a manager can
   * grant is a roster entry wearing the word "consent".
   */
  async consent(params: {
    restaurantId: string;
    userId: string;
    phone: string;
    channel: "whatsapp" | "sms" | "any";
  }): Promise<PersonConsent> {
    // Withdraw first, so re-consenting at a new number leaves the old consent
    // on the record rather than mutating it. 47 CFR 64.1200(d)(3) wants the
    // history, not the latest state.
    await this.withdraw({
      restaurantId: params.restaurantId,
      userId: params.userId,
      via: "person",
    });

    const { data, error } = await this.sb
      .from("person_text_consents")
      .insert({
        user_id: params.userId,
        restaurant_id: params.restaurantId,
        phone: params.phone,
        channel: params.channel,
        withdrawn_at: null,
        withdrawn_via: null,
      })
      .select("user_id, phone, channel, consented_at")
      .single();

    if (error || !data) {
      this.logger.error(`consent failed: ${error?.message}`);
      throw new ForbiddenException(
        `Your consent was not recorded, so this house still may not text you: ${error?.message ?? "no row came back"}.`,
      );
    }
    const r = data as Record<string, any>;
    return {
      userId: String(r.user_id),
      phone: String(r.phone),
      channel: r.channel,
      consentedAt: String(r.consented_at),
    };
  }

  /**
   * A person takes it back — from the page, or by replying STOP.
   *
   * A TIMESTAMP, NEVER A DELETE. 47 CFR 64.1200(d)(3) requires the request to
   * be recorded and (d)(6) requires it honoured for five years, so a row
   * removed to keep the table tidy is a compliance failure that looks like
   * housekeeping.
   */
  async withdraw(params: {
    restaurantId: string;
    userId: string;
    via: "person" | "stop_keyword" | "account_closed";
  }): Promise<{ withdrawn: number }> {
    const { data, error } = await this.sb
      .from("person_text_consents")
      .update({
        withdrawn_at: new Date().toISOString(),
        withdrawn_via: params.via,
      })
      .eq("restaurant_id", params.restaurantId)
      .eq("user_id", params.userId)
      .is("withdrawn_at", null)
      .select("id");

    if (error) {
      this.logger.error(`withdraw failed: ${error.message}`);
      throw new ForbiddenException(
        `The withdrawal was not recorded, so this house may still believe it can text you: ${error.message}.`,
      );
    }
    return { withdrawn: (data ?? []).length };
  }

  /**
   * How many people in this house have a live consent.
   *
   * A COUNT AND NOT A LIST, and manager-gated by the caller. ADR 0114 lets a
   * manager SEE what has been recorded against the house; it does not make a
   * person's phone number the house's to read. The composer needs to know how
   * many of the people it is about to write to could be texted — that is a
   * fact about reach — and it does not need to know whose number is whose.
   *
   * `null` means the READ FAILED. Zero means zero.
   */
  async liveConsentCount(restaurantId: string): Promise<number | null> {
    const { count, error } = await this.sb
      .from("person_text_consents")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .is("withdrawn_at", null);
    if (error) {
      this.logger.error(`liveConsentCount failed: ${error.message}`);
      return null;
    }
    return count ?? 0;
  }

  /** The catalogue, for the surfaces. One list, never a page's own subset. */
  catalogue() {
    return TEXT_SENDER_DEFINITIONS;
  }
}
