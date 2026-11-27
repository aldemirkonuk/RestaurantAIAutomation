import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";
import { readHouseZone, type HouseZone } from "../common/house-day";
import type {
  MailMessage,
  MailNoReplyAnswer,
  MailOrderRef,
  MailPeoplePage,
  MailPersonRow,
  MailSummary,
  MailThreadPage,
  MailThreadRow,
  MailThreadsPage,
} from "./mail.types";

/**
 * The server read model behind the /communications Mail tab (founder /goal
 * 2026-11-07). Every read is the caller's house only, and every figure is
 * counted in SQL (migration the_mail_list_is_read_by_person): nothing here
 * aggregates a capped read in JS.
 *
 * Role: the controller carries no @Roles — every signed-in member of the house
 * may read the vendor mail list (draft ADR 0357 answer 3, PR #747: staff read vendor threads,
 * read-only). What differs by role is enforced HERE: anyone who is not the
 * house's owner or manager — including a token with no role at all — gets the
 * withheld view, in which HOUSE_DRAFT / HOUSE_CANCELLED credit-claim letters do
 * not exist (ADR 0167, ADR 0230; the same rule as ConversationsService).
 *
 * Failure: a failed read is a 503 in words, never an empty 200 — an empty mail
 * list must only ever mean there is no mail (ADR 0020, ADR 0051).
 */

import {
  BAD_CURSOR,
  MAIL_THREAD_PAGE,
  PERSON_KEY_RE,
  READ_FAILED,
  UUID_RE,
  WITHHOLD_HOUSE_CANCELLED,
  WITHHOLD_HOUSE_DRAFT,
  clampMailLimit,
  decodeMailCursor,
  encodeMailCursor,
  mailDirectionOf as direction,
  mailDoorOf,
  personRef,
  stripSubjectLine,
  withholdsHouseLetters,
} from "./mail.read-rules";

function emptyThread(key: string): MailThreadPage {
  return {
    key,
    subject: null,
    person: null,
    order: null,
    messages: [],
    before: null,
    waiting: false,
  };
}

/** Said to anyone who is not the house's owner or manager. */
export const NO_REPLY_NOT_YOURS =
  "Only the house's owner or a manager can say a letter needs no reply.";
export const NO_REPLY_NOT_FOUND = "That letter is not in this house's mail.";
export const NO_REPLY_NOT_RECEIVED =
  "Only a letter the house received can be marked as needing no reply.";
export const NO_REPLY_FAILED =
  "The mark could not be saved just now, so nothing changed. Try again.";

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
  ) {}

  private get db() {
    return this.databaseService.supabase;
  }

  private failed(
    what: string,
    error: { message?: string } | null | undefined,
  ): never {
    this.logger.error(
      `mail ${what} read failed: ${error?.message ?? "unknown"}`,
    );
    throw new ServiceUnavailableException(READ_FAILED);
  }

  async listPeople(
    houseId: string,
    callerRole: string | null | undefined,
    opts: { waitingOnly?: boolean; after?: string; limit?: string | number },
  ): Promise<MailPeoplePage> {
    const limit = clampMailLimit(opts.limit);
    const after = opts.after ? decodeMailCursor(opts.after) : null;
    const { data, error } = await this.db.rpc("list_mail_people", {
      p_restaurant_id: houseId,
      p_withhold_house_letters: withholdsHouseLetters(callerRole),
      p_waiting_only: opts.waitingOnly === true,
      p_after_at: after?.at ?? null,
      p_after_key: after?.key ?? null,
      // One extra row says whether another page exists.
      p_limit: limit + 1,
    });
    if (error) this.failed("people", error);
    const rows = (data ?? []) as any[];
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      people: page.map(
        (r): MailPersonRow => ({
          key: r.key,
          kind: "vendor",
          providerId: r.provider_id,
          name: r.name ?? null,
          lastAt: r.last_at,
          lastLine: r.last_line ?? null,
          lastDirection: direction(r.last_direction),
          waiting: r.waiting === true,
          waitingSince: r.waiting_since ?? null,
          openThreads: Number(r.open_threads ?? 0),
          channels: Array.isArray(r.channels) ? r.channels : [],
          newestOpenOrderId: r.newest_open_order_id ?? null,
          newestOpenOrderNumber: r.newest_open_order_number ?? null,
          unsentStatus:
            typeof r.unsent_status === "string" ? r.unsent_status : null,
        }),
      ),
      next:
        rows.length > limit && last
          ? encodeMailCursor(last.last_at, last.key)
          : null,
      storedKinds: ["vendor"],
    };
  }

  async listThreads(
    houseId: string,
    callerRole: string | null | undefined,
    opts: { with?: string; after?: string; limit?: string | number },
  ): Promise<MailThreadsPage> {
    const limit = clampMailLimit(opts.limit);
    const after = opts.after ? decodeMailCursor(opts.after) : null;
    const providerId = PERSON_KEY_RE.exec(
      (opts.with ?? "").trim(),
    )?.[1]?.toLowerCase();
    // F11: a person this house has no mail with — a bad key, another kind not
    // stored yet, or another house's vendor — is an empty answer, never theirs.
    if (!providerId || !UUID_RE.test(providerId)) {
      return { person: null, threads: [], next: null };
    }
    const withhold = withholdsHouseLetters(callerRole);

    let personQuery = this.db
      .from("procurement_conversations")
      .select("provider_id, providers (id, name)")
      .eq("restaurant_id", houseId)
      .eq("provider_id", providerId);
    if (withhold) {
      personQuery = personQuery
        .or(WITHHOLD_HOUSE_DRAFT)
        .or(WITHHOLD_HOUSE_CANCELLED);
    }
    const [personRes, threadsRes] = await Promise.all([
      personQuery.limit(1),
      this.db.rpc("list_mail_threads", {
        p_restaurant_id: houseId,
        p_provider_id: providerId,
        p_withhold_house_letters: withhold,
        p_after_at: after?.at ?? null,
        p_after_key: after?.key ?? null,
        p_limit: limit + 1,
      }),
    ]);
    if (personRes.error) this.failed("person", personRes.error);
    if (threadsRes.error) this.failed("threads", threadsRes.error);

    const first = ((personRes.data ?? []) as any[])[0];
    if (!first) return { person: null, threads: [], next: null };
    const provider = Array.isArray(first.providers)
      ? first.providers[0]
      : first.providers;

    const rows = (threadsRes.data ?? []) as any[];
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      person: personRef(providerId, provider?.name),
      threads: page.map(
        (t): MailThreadRow => ({
          key: t.thread_key,
          subject: t.subject ?? null,
          messageCount: Number(t.message_count ?? 0),
          lastAt: t.last_at,
          lastDirection: direction(t.last_direction),
          waiting: t.waiting === true,
          orderId: t.order_id ?? null,
          orderNumber: t.order_number ?? null,
        }),
      ),
      next:
        rows.length > limit && last
          ? encodeMailCursor(last.last_at, last.thread_key)
          : null,
    };
  }

  async getThread(
    houseId: string,
    callerRole: string | null | undefined,
    opts: { key?: unknown; with?: unknown; before?: unknown },
  ): Promise<MailThreadPage> {
    // A repeated query parameter (`?with=a&with=b`) arrives as an array; it
    // names no one thread or person, so it is read as a bad request in words.
    const key = typeof opts.key === "string" ? opts.key.trim() : "";
    if (!key || key.length > 500) {
      throw new BadRequestException("Name the thread to open.");
    }
    if (opts.before !== undefined && typeof opts.before !== "string") {
      throw new BadRequestException(BAD_CURSOR);
    }
    const before = opts.before ? decodeMailCursor(opts.before) : null;
    if (before && !UUID_RE.test(before.key)) {
      throw new BadRequestException(BAD_CURSOR);
    }
    // A thread is the pair (provider_id, thread_key) — one Gmail thread sent
    // to two vendors (a `gm:` key) or one group mail (a `mid:` key) is two
    // threads. `with` names the person; without it, mail_thread_letters gives
    // the page to the vendor of the thread's first letter, so an old link with
    // the key alone still opens one person's letters and never two (QA round
    // 18, #895 T1.0). A `with` that names no stored person is an empty page,
    // the same as /mail/threads (F11).
    if (opts.with !== undefined && typeof opts.with !== "string") {
      return emptyThread(key);
    }
    const withRaw = (opts.with ?? "").trim();
    const providerId = withRaw
      ? PERSON_KEY_RE.exec(withRaw)?.[1]?.toLowerCase()
      : undefined;
    if (withRaw && !providerId) return emptyThread(key);

    // One read: the page, newest first by each letter's own time (received
    // for inbound, sent for outbound), keyset-paged on (at, id). The function
    // returns explicit columns: never email_headers, Gmail ids or message_id.
    const { data, error } = await this.db.rpc("mail_thread_letters", {
      p_restaurant_id: houseId,
      p_thread_key: key,
      p_provider_id: providerId ?? null,
      p_withhold_house_letters: withholdsHouseLetters(callerRole),
      p_before_at: before?.at ?? null,
      p_before_id: before?.key ?? null,
      p_limit: MAIL_THREAD_PAGE + 1,
    });
    if (error) this.failed("thread", error);
    const rows = (data ?? []) as any[];
    const head = rows[0];
    if (!head) {
      // Another house's key, or one that names nothing: empty, never theirs (F11).
      return emptyThread(key);
    }
    const order: MailOrderRef | null = head.order_id
      ? {
          id: head.order_id,
          number: head.order_number ?? null,
          status: head.order_status ?? null,
        }
      : null;

    const kept = rows.slice(0, MAIL_THREAD_PAGE);
    const oldest = kept[kept.length - 1];
    return {
      key,
      subject:
        typeof head.thread_subject === "string" && head.thread_subject.trim()
          ? head.thread_subject.trim()
          : null,
      person: head.provider_id
        ? personRef(head.provider_id, head.provider_name)
        : null,
      order,
      messages: kept
        .slice()
        .reverse()
        .map(
          (m): MailMessage => ({
            id: m.id,
            direction: direction(m.direction) ?? "outbound",
            channel: m.channel,
            text: stripSubjectLine(m.message_text),
            aiGenerated: m.ai_generated === true,
            status: m.status ?? null,
            sentAt: m.sent_at ?? null,
            receivedAt: m.received_at ?? null,
            createdAt: m.created_at,
            rawDeletedAt: m.raw_deleted_at ?? null,
            door: mailDoorOf(m),
            automatic: m.automatic === true,
            noReplyMarkedAt:
              typeof m.no_reply_marked_at === "string"
                ? m.no_reply_marked_at
                : null,
          }),
        ),
      before:
        rows.length > MAIL_THREAD_PAGE && oldest
          ? encodeMailCursor(oldest.at, oldest.id)
          : null,
      // Every row carries the same thread-wide answer; the newest is read.
      waiting: head.thread_waiting === true,
    };
  }

  /**
   * "This letter needs no reply" (r28 mail gap 4), or taking that back. Only
   * the house's owner or manager may: the same line as the reply acts. The SQL
   * decides what may be marked (a letter of THIS house that it received) and
   * the house is the token's, never the request's. A mark settles the letter
   * and every earlier one of its thread; a later letter waits again.
   */
  async setNoReply(
    houseId: string,
    callerRole: string | null | undefined,
    userId: string | null | undefined,
    letterId: unknown,
    marked: boolean,
  ): Promise<MailNoReplyAnswer> {
    if (withholdsHouseLetters(callerRole)) {
      throw new ForbiddenException(NO_REPLY_NOT_YOURS);
    }
    const id = typeof letterId === "string" ? letterId.trim().toLowerCase() : "";
    if (!UUID_RE.test(id)) {
      throw new BadRequestException(NO_REPLY_NOT_FOUND);
    }
    const { data, error } = marked
      ? await this.db.rpc("mail_letter_mark_no_reply", {
          p_restaurant_id: houseId,
          p_conversation_id: id,
          p_marked_by:
            typeof userId === "string" && UUID_RE.test(userId) ? userId : null,
        })
      : await this.db.rpc("mail_letter_unmark_no_reply", {
          p_restaurant_id: houseId,
          p_conversation_id: id,
        });
    if (error) {
      this.logger.error(`mail no-reply mark failed: ${error.message}`);
      throw new ServiceUnavailableException(NO_REPLY_FAILED);
    }
    const outcome = Array.isArray(data) ? data[0] : data;
    switch (outcome) {
      case "marked":
        return { id, marked: true };
      case "unmarked":
      case "not_marked":
        return { id, marked: false };
      case "not_found":
        throw new NotFoundException(NO_REPLY_NOT_FOUND);
      case "not_received":
        throw new ConflictException(NO_REPLY_NOT_RECEIVED);
      default:
        // An answer this code does not know is not a success.
        this.logger.error(`mail no-reply mark: unknown outcome ${String(outcome)}`);
        throw new ServiceUnavailableException(NO_REPLY_FAILED);
    }
  }

  async summary(
    houseId: string,
    callerRole: string | null | undefined,
  ): Promise<MailSummary> {
    const domain = (
      this.configService.get<string>("INBOUND_EMAIL_DOMAIN") || ""
    ).trim();
    // The house's day is read by the one rule every house-day reader uses
    // (common/house-day.ts): its own zone, else its country's only zone, else
    // none — never UTC (D7). A failed read of the house row is a failed
    // summary, never "no zone": that would make a database fault read as a
    // settings gap.
    let zone: HouseZone;
    try {
      zone = await readHouseZone(this.db, houseId);
    } catch (e) {
      this.failed("zone", { message: (e as Error)?.message });
    }
    const [sumRes, addrRes] = await Promise.all([
      this.db.rpc("mail_inbox_summary", {
        p_restaurant_id: houseId,
        p_withhold_house_letters: withholdsHouseLetters(callerRole),
        p_zone: zone.zone,
      }),
      // A plain read of the address that exists. It must never provision one:
      // InboundAddressService.addressFor inserts on read (QA M-12), so it is
      // deliberately not used here.
      domain
        ? this.db
            .from("restaurant_inbound_addresses")
            .select("address")
            .eq("restaurant_id", houseId)
            .eq("is_active", true)
            .order("created_at", { ascending: true })
            .limit(1)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);
    if (sumRes.error) this.failed("summary", sumRes.error);
    if (addrRes.error) this.failed("address", addrRes.error);
    const s = (
      Array.isArray(sumRes.data) ? sumRes.data[0] : sumRes.data
    ) as any;
    if (!s) this.failed("summary", { message: "no summary row" });
    const addr = ((addrRes.data ?? []) as any[])[0];
    return {
      waitingPeople: Number(s.waiting_people ?? 0),
      oldestWaitAt: s.oldest_wait_at ?? null,
      // Null only when the house has no zone: the SQL withholds the count
      // then, and so does this (a 0 would read as a quiet day).
      inToday: zone.zone === null || s.in_today == null ? null : Number(s.in_today),
      outToday: zone.zone === null || s.out_today == null ? null : Number(s.out_today),
      zone: { zone: zone.zone, source: zone.source },
      inLast30: Number(s.in_30d ?? 0),
      heldAtDoor: null,
      doors: {
        houseMailbox: { lastStoredAt: s.house_mailbox_last_at ?? null },
        whatsapp: { lastStoredAt: s.whatsapp_last_at ?? null },
        mudavymMail: { lastStoredAt: s.mudavym_mail_last_at ?? null },
      },
      address: {
        configured: Boolean(domain),
        address: typeof addr?.address === "string" ? addr.address : null,
      },
    };
  }
}
