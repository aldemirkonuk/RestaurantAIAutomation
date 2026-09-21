import {
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { hashCallArgs } from "../common/seal/seal-token";
import { VendorSendAuthorityService } from "./vendor-send-authority.service";

/**
 * Staff may ASK a manager to confirm a deal or to send a composer letter —
 * the founder's answer (3) of 2026-09-21 on the ADR 0175 amendment: *"with
 * the same request flow as drafted replies (request state, exact text/terms
 * saved, manager releases with one hold)"*.
 *
 * WHAT THIS SERVICE OWNS, AND WHAT IT DOES NOT
 * -------------------------------------------
 * It owns the REQUEST: who may ask (a member whose own hold would ask, never
 * a person who may send), the row (`vendor_send_requests`, 20260921114900)
 * with the exact terms or letter and their hash, the claim a release takes on
 * it, and the notices. It does not own the RELEASE: that is the ordinary
 * sealed door — `confirm-deal` for a deal, the composer's `queue` for a letter
 * — which calls `claim` with the request id, so a request can be released
 * once and only by a person who may send.
 *
 * NOTICES ARE THE WEB BELL, AND A PUSH CARRIES NO NAMES
 * ----------------------------------------------------
 * Founder answer (5): *send-request pushes, when push exists, carry no names
 * ("A letter is waiting for your approval")*. Every notice written here is
 * priority `low`, which the notification funnel never pushes; the lock-screen
 * sentence a future push must use is `SEND_REQUEST_PUSH_TEXT`, carried in the
 * notice's metadata so the push path has it without reading the bell's words.
 * The notices are written straight to `notifications` (the row shape
 * `NotificationsService.persistForRestaurant` writes) because this module sits
 * below the notifications module's import cycle; they reach the bell on its
 * next read, without the live socket nudge.
 */

/** The only words a send-request push may carry to a locked screen (founder answer 5, 2026-09-21). */
export const SEND_REQUEST_PUSH_TEXT = "A letter is waiting for your approval";

export type VendorSendRequestKind = "confirm_deal" | "house_letter";

const REQUEST_COLUMNS =
  "id, restaurant_id, kind, order_id, provider_id, requested_by, requested_at, payload, payload_sha256, state, released_by, released_at, released_as_written, closed_reason, conversation_id";

export interface VendorSendRequestRow {
  id: string;
  restaurant_id: string;
  kind: VendorSendRequestKind;
  order_id: string | null;
  provider_id: string | null;
  requested_by: string | null;
  requested_at: string;
  payload: Record<string, unknown>;
  payload_sha256: string;
  state: "waiting" | "released" | "closed";
  released_by: string | null;
  released_at: string | null;
  released_as_written: boolean | null;
  closed_reason: string | null;
  conversation_id: string | null;
}

export interface VendorSendRequestView {
  id: string;
  kind: VendorSendRequestKind;
  orderId: string | null;
  providerId: string | null;
  requestedBy: { userId: string | null; name: string | null };
  requestedAt: string;
  /** Exactly what was asked for: the terms of a deal, or the whole letter. */
  payload: Record<string, unknown>;
  state: "waiting" | "released" | "closed";
  releasedBy: { userId: string | null; name: string | null } | null;
  releasedAt: string | null;
  releasedAsWritten: boolean | null;
  conversationId: string | null;
}

/** The canonical hash of what was asked for — the same digest the seal takes over its args. */
export function requestHash(sealArgs: Record<string, unknown>): string {
  return hashCallArgs(sealArgs);
}

@Injectable()
export class VendorSendRequestsService {
  private readonly logger = new Logger(VendorSendRequestsService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly authority: VendorSendAuthorityService,
  ) {}

  private get db() {
    return this.databaseService.supabase;
  }

  /**
   * A member whose hold would ASK saves exactly what they asked for. A person
   * who may send is refused (409: they send it themselves); a person with no
   * role in the house is refused (403). The standing is the same one the send
   * would read, with the act's money for a deal.
   */
  async ask(input: {
    userId: string;
    restaurantId: string;
    kind: VendorSendRequestKind;
    orderId: string | null;
    providerId: string | null;
    payload: Record<string, unknown>;
    sealArgs: Record<string, unknown>;
    amount?: { value: number | null; currency: string | null } | null;
    act: string;
  }): Promise<VendorSendRequestRow> {
    if (!input.userId?.trim()) throw new ForbiddenException("A named person is required to ask. Nothing was asked.");
    const standing = await this.authority.standing(input.userId, input.restaurantId, { amount: input.amount ?? null });
    if (standing.mode === "send") {
      throw new ConflictException(`You may ${input.act} yourself with one hold, so nothing was asked on your behalf.`);
    }
    if (!standing.role) throw new ForbiddenException("You hold no role in this house, so nothing was asked.");

    const { data, error } = await this.db
      .from("vendor_send_requests")
      .insert({
        restaurant_id: input.restaurantId,
        kind: input.kind,
        order_id: input.orderId,
        provider_id: input.providerId,
        requested_by: input.userId,
        requested_at: new Date().toISOString(),
        payload: input.payload,
        payload_sha256: requestHash(input.sealArgs),
        state: "waiting",
      })
      .select(REQUEST_COLUMNS)
      .single();
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictException(
          "A request to confirm this deal is already waiting for a manager. Nothing new was asked; the waiting one stands.",
        );
      }
      throw new InternalServerErrorException(`Your request was not saved (${error.message}), so nothing was asked.`);
    }
    return data as unknown as VendorSendRequestRow;
  }

  /** Waiting requests of one kind in this house, newest first; a failed read is an error. */
  async waiting(
    restaurantId: string,
    kind: VendorSendRequestKind,
    opts: { orderId?: string; requestedBy?: string } = {},
  ): Promise<VendorSendRequestView[]> {
    let q = this.db
      .from("vendor_send_requests")
      .select(REQUEST_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .eq("kind", kind)
      .eq("state", "waiting");
    if (opts.orderId) q = q.eq("order_id", opts.orderId);
    if (opts.requestedBy) q = q.eq("requested_by", opts.requestedBy);
    const { data, error } = await q.order("requested_at", { ascending: false });
    if (error) {
      throw new InternalServerErrorException(`The waiting requests could not be read (${error.message}).`);
    }
    return this.present((data ?? []) as unknown as VendorSendRequestRow[]);
  }

  /** One request of this house (404 for another house's, ADR 0147). */
  async one(restaurantId: string, requestId: string, kind: VendorSendRequestKind): Promise<VendorSendRequestRow> {
    const { data, error } = await this.db
      .from("vendor_send_requests")
      .select(REQUEST_COLUMNS)
      .eq("id", requestId)
      .eq("restaurant_id", restaurantId)
      .eq("kind", kind)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(`The request could not be read (${error.message}).`);
    if (!data) throw new NotFoundException("No such request in this house.");
    return data as unknown as VendorSendRequestRow;
  }

  /**
   * A release takes the request, once. Conditional on `waiting`, so two
   * managers releasing together cannot both send it: the loser gets a 409 and
   * sends nothing. `asWritten` says whether the release is over exactly the
   * words or terms that were asked for.
   */
  async claim(input: {
    restaurantId: string;
    requestId: string;
    kind: VendorSendRequestKind;
    releasedBy: string;
    releaseSealArgs: Record<string, unknown>;
  }): Promise<{ row: VendorSendRequestRow; asWritten: boolean }> {
    const current = await this.one(input.restaurantId, input.requestId, input.kind);
    if (current.state !== "waiting") {
      throw new ConflictException(
        current.state === "released"
          ? "That request was already released by someone else. Nothing more was sent."
          : "That request was closed. Nothing was sent.",
      );
    }
    const asWritten = requestHash(input.releaseSealArgs) === current.payload_sha256;
    const { data, error } = await this.db
      .from("vendor_send_requests")
      .update({
        state: "released",
        released_by: input.releasedBy,
        released_at: new Date().toISOString(),
        released_as_written: asWritten,
      })
      .eq("id", input.requestId)
      .eq("restaurant_id", input.restaurantId)
      .eq("state", "waiting")
      .select(REQUEST_COLUMNS);
    if (error) throw new InternalServerErrorException(`The request could not be taken (${error.message}). Nothing was sent.`);
    const rows = (data ?? []) as unknown as VendorSendRequestRow[];
    if (rows.length === 0) {
      throw new ConflictException("That request was released by someone else a moment ago. Nothing more was sent.");
    }
    return { row: rows[0], asWritten };
  }

  /** Give a claimed request back when the release did not go through. Best-effort, and said when it fails. */
  async unclaim(restaurantId: string, requestId: string, releasedBy: string): Promise<void> {
    const { error } = await this.db
      .from("vendor_send_requests")
      .update({ state: "waiting", released_by: null, released_at: null, released_as_written: null })
      .eq("id", requestId)
      .eq("restaurant_id", restaurantId)
      .eq("state", "released")
      .eq("released_by", releasedBy);
    if (error) {
      this.logger.error(`A request (${requestId}) whose release failed could not be given back: ${error.message}`);
    }
  }

  /** Record what a released letter request became. */
  async linkConversation(restaurantId: string, requestId: string, conversationId: string): Promise<void> {
    const { error } = await this.db
      .from("vendor_send_requests")
      .update({ conversation_id: conversationId })
      .eq("id", requestId)
      .eq("restaurant_id", restaurantId);
    if (error) this.logger.warn(`The queued letter could not be linked to request ${requestId}: ${error.message}`);
  }

  /**
   * A deal confirmed by a person who may send, WITHOUT naming the request,
   * still answers it: the waiting request for that order is closed as released
   * by them, as written only when the terms matched.
   */
  async answerWaitingDeal(input: {
    restaurantId: string;
    orderId: string;
    releasedBy: string;
    releaseSealArgs: Record<string, unknown>;
  }): Promise<{ row: VendorSendRequestRow; asWritten: boolean } | null> {
    const waiting = await this.waiting(input.restaurantId, "confirm_deal", { orderId: input.orderId }).catch((e) => {
      this.logger.warn(`The waiting deal request for ${input.orderId} could not be read: ${e?.message}`);
      return [] as VendorSendRequestView[];
    });
    const first = waiting[0];
    if (!first) return null;
    try {
      return await this.claim({
        restaurantId: input.restaurantId,
        requestId: first.id,
        kind: "confirm_deal",
        releasedBy: input.releasedBy,
        releaseSealArgs: input.releaseSealArgs,
      });
    } catch (e: any) {
      this.logger.warn(`The waiting deal request ${first.id} could not be closed: ${e?.message}`);
      return null;
    }
  }

  /**
   * Close the waiting deal request on this order, saying why. A dismissed deal
   * will not be confirmed on the asked-for terms, and a request left waiting
   * would mislead the next reader (a manager would open it on stale terms) and
   * refuse the next ask on the same order (at most one waiting deal request per
   * order, 20260921114900). The drafted-reply twin is a discarded draft, which
   * takes its request with it. Returns how many were closed; a failed write
   * throws. [Last call, 2026-09-21: nothing closed a request before this.]
   */
  async closeWaitingDeal(restaurantId: string, orderId: string, reason: string): Promise<number> {
    const { data, error } = await this.db
      .from("vendor_send_requests")
      .update({ state: "closed", closed_reason: reason })
      .eq("restaurant_id", restaurantId)
      .eq("kind", "confirm_deal")
      .eq("order_id", orderId)
      .eq("state", "waiting")
      .select("id");
    if (error) {
      throw new InternalServerErrorException(
        `The request waiting on this deal could not be closed (${error.message}), so the deal was not dismissed.`,
      );
    }
    return Array.isArray(data) ? data.length : 0;
  }

  async present(rows: VendorSendRequestRow[]): Promise<VendorSendRequestView[]> {
    if (rows.length === 0) return [];
    const names = await this.authority.namesOf(rows.flatMap((r) => [r.requested_by, r.released_by]));
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      orderId: r.order_id,
      providerId: r.provider_id,
      requestedBy: { userId: r.requested_by, name: r.requested_by ? (names.get(r.requested_by) ?? null) : null },
      requestedAt: r.requested_at,
      payload: r.payload ?? {},
      state: r.state,
      releasedBy: r.released_by
        ? { userId: r.released_by, name: names.get(r.released_by) ?? null }
        : null,
      releasedAt: r.released_at,
      releasedAsWritten: r.released_as_written,
      conversationId: r.conversation_id,
    }));
  }

  /**
   * Tell the owners and managers a request is waiting (the web bell). Returns
   * how many were told; 0 with a logged reason when nobody could be.
   */
  async tellManagers(input: {
    restaurantId: string;
    requesterId: string;
    kind: VendorSendRequestKind;
    vendorName: string | null;
    requestId: string;
    orderId: string | null;
  }): Promise<number> {
    try {
      const { owners, managers } = await this.authority.ownersAndManagers(input.restaurantId);
      const audience = [...new Set([...owners, ...managers])].filter((id) => id !== input.requesterId);
      if (audience.length === 0) return 0;
      const who = (await this.authority.namesOf([input.requesterId])).get(input.requesterId) ?? "A member of the team";
      const vendor = input.vendorName ?? "a vendor";
      const words =
        input.kind === "confirm_deal"
          ? {
              title: `${who} asks you to confirm a deal`,
              message: `${who} asks an owner or a manager to confirm the deal with ${vendor} on the terms they set. It waits for one hold; nothing has been confirmed or sent.`,
              actionUrl: "/orders",
              actionLabel: "Read the terms",
            }
          : {
              title: `${who} asks you to send a letter`,
              message: `${who} wrote a letter to ${vendor} and asks an owner or a manager to send it. It waits for one hold; nothing has been sent.`,
              actionUrl: "/communications",
              actionLabel: "Read it and send",
            };
      return await this.bell(input.restaurantId, audience, {
        type: input.kind === "confirm_deal" ? "vendor_deal_requested" : "vendor_letter_requested",
        ...words,
        metadata: {
          requestId: input.requestId,
          orderId: input.orderId,
          requestedBy: input.requesterId,
          lockScreenText: SEND_REQUEST_PUSH_TEXT,
        },
      });
    } catch (e: any) {
      this.logger.warn(`A send request could not be told to the managers: ${e?.message}`);
      return 0;
    }
  }

  /** Tell the person who asked who released it, and whether it went as they wrote it. */
  async tellRequester(input: {
    restaurantId: string;
    row: VendorSendRequestRow;
    releasedBy: string;
    asWritten: boolean;
    vendorName: string | null;
  }): Promise<void> {
    const requester = input.row.requested_by;
    if (!requester || requester === input.releasedBy) return;
    try {
      const sender = (await this.authority.namesOf([input.releasedBy])).get(input.releasedBy) ?? "A manager";
      const vendor = input.vendorName ?? "the vendor";
      const how = input.asWritten ? "as you set it" : "with their own changes";
      await this.bell(input.restaurantId, [requester], {
        type: input.row.kind === "confirm_deal" ? "vendor_deal_released" : "vendor_letter_released",
        title: input.row.kind === "confirm_deal" ? `${sender} confirmed your deal` : `${sender} sent your letter`,
        message:
          input.row.kind === "confirm_deal"
            ? `${sender} confirmed the deal with ${vendor}, ${how}.`
            : `${sender} released your letter to ${vendor}, ${how}. It leaves after the usual undo window.`,
        actionUrl: input.row.kind === "confirm_deal" ? "/orders" : "/communications",
        actionLabel: "See it",
        metadata: { requestId: input.row.id, releasedBy: input.releasedBy, asWritten: input.asWritten },
      });
    } catch (e: any) {
      this.logger.warn(`The requester could not be told their request was released: ${e?.message}`);
    }
  }

  private async bell(
    restaurantId: string,
    userIds: string[],
    notice: {
      type: string;
      title: string;
      message: string;
      actionUrl: string;
      actionLabel: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<number> {
    const now = new Date().toISOString();
    const rows = userIds.map((userId) => ({
      user_id: userId,
      recipient_id: userId,
      notification_type: notice.type,
      channels: ["in_app"],
      restaurant_id: restaurantId,
      type: notice.type,
      title: notice.title.slice(0, 255),
      message: notice.message,
      // Bell only (founder answer 5): priority low is never pushed.
      priority: "low",
      status: "unread",
      action_url: notice.actionUrl,
      action_label: notice.actionLabel,
      metadata: notice.metadata,
      created_at: now,
    }));
    const { error } = await this.db.from("notifications").insert(rows);
    if (error) {
      this.logger.warn(`A send-request notice could not be written: ${error.message}`);
      return 0;
    }
    return rows.length;
  }
}
