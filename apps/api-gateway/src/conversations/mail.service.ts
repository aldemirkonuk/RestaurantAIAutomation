import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";
import type {
  MailDoor,
  MailMessage,
  MailOrderRef,
  MailPeoplePage,
  MailPersonRef,
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
 * may read the vendor mail list (ADR 0357 answer 3: staff read vendor threads,
 * read-only). What differs by role is enforced HERE: anyone who is not the
 * house's owner or manager — including a token with no role at all — gets the
 * withheld view, in which HOUSE_DRAFT / HOUSE_CANCELLED credit-claim letters do
 * not exist (ADR 0167, ADR 0230; the same rule as ConversationsService).
 *
 * Failure: a failed read is a 503 in words, never an empty 200 — an empty mail
 * list must only ever mean there is no mail (ADR 0020, ADR 0051).
 */

export const MAIL_PAGE_DEFAULT = 50;
export const MAIL_PAGE_MAX = 100;
/** G9: a thread is read 50 letters at a time, however long it is. */
export const MAIL_THREAD_PAGE = 50;

const OWNER_MANAGER_ROLES = new Set(["owner", "manager"]);

/** The least trusted reading of a missing or unknown role, never the most. */
export function withholdsHouseLetters(role: string | null | undefined): boolean {
  return !(typeof role === "string" && OWNER_MANAGER_ROLES.has(role.toLowerCase()));
}

// Copied from conversations.service.ts (not exported there): `status` is
// nullable, so each test keeps the NULL rows a bare `neq` would drop.
const WITHHOLD_HOUSE_DRAFT = "status.is.null,status.neq.HOUSE_DRAFT";
const WITHHOLD_HOUSE_CANCELLED = "status.is.null,status.neq.HOUSE_CANCELLED";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A Postgres timestamptz as PostgREST prints it (microseconds kept). */
const PG_TIME_RE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;
const PERSON_KEY_RE =
  /^vendor:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const SUBJECT_LINE_RE = /^\s*subject:[^\n]*(\r?\n|$)\s*/i;

const BAD_CURSOR =
  "That page link is not one this list made. Open the mail list again from the top.";
const READ_FAILED =
  "The mail could not be read just now. Nothing was changed; try again in a moment.";

/** One page boundary: the time and key of the last row the caller saw. */
export interface MailCursor {
  at: string;
  key: string;
}

export function encodeMailCursor(at: string, key: string): string {
  return Buffer.from(JSON.stringify([at, key]), "utf8").toString("base64url");
}

/** Throws a 400 in words for anything this service did not make. */
export function decodeMailCursor(raw: string): MailCursor {
  let parsed: unknown;
  try {
    if (!/^[A-Za-z0-9_-]{1,2048}$/.test(raw)) throw new Error("charset");
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new BadRequestException(BAD_CURSOR);
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== "string" ||
    typeof parsed[1] !== "string" ||
    !PG_TIME_RE.test(parsed[0]) ||
    Number.isNaN(Date.parse(parsed[0].replace(" ", "T"))) ||
    parsed[1].length === 0 ||
    parsed[1].length > 500
  ) {
    throw new BadRequestException(BAD_CURSOR);
  }
  return { at: parsed[0], key: parsed[1] };
}

/** Default 50, clamped to 1..100. Anything that is not a whole number is a 400. */
export function clampMailLimit(raw: string | number | undefined | null): number {
  if (raw === undefined || raw === null || raw === "") return MAIL_PAGE_DEFAULT;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new BadRequestException("The page size must be a whole number.");
  }
  return Math.min(MAIL_PAGE_MAX, Math.max(1, n));
}

/** The letter without the "Subject: ..." line the bridge writes on top. */
export function stripSubjectLine(text: string | null | undefined): string {
  return (text ?? "").replace(SUBJECT_LINE_RE, "");
}

function subjectFromText(text: string | null | undefined): string | null {
  const m = /^\s*subject:[ \t]*([^\r\n]*)/i.exec((text ?? "").slice(0, 2000));
  const s = m?.[1]?.trim();
  return s ? s : null;
}

/** Which door a stored letter came by, from stored columns alone. */
export function mailDoorOf(row: {
  direction?: string | null;
  channel?: string | null;
  mirrored_by_grant_id?: string | null;
}): MailDoor {
  if ((row.direction ?? "").toLowerCase() !== "inbound") return "from_house";
  if (row.mirrored_by_grant_id) return "house_mailbox";
  if ((row.channel ?? "").toLowerCase() === "whatsapp") return "whatsapp";
  return "mudavym_mail";
}

function direction(v: unknown): "inbound" | "outbound" | null {
  const d = typeof v === "string" ? v.toLowerCase() : "";
  return d === "inbound" || d === "outbound" ? d : null;
}

function personRef(providerId: string, name: unknown): MailPersonRef {
  return {
    key: `vendor:${providerId}`,
    kind: "vendor",
    providerId,
    name: typeof name === "string" ? name : null,
  };
}

/** The explicit columns a thread page reads. Never email_headers, gmail ids or message_id. */
const MESSAGE_COLUMNS =
  "id, direction, channel, message_text, ai_generated, status, sent_at, received_at, created_at, raw_deleted_at, mirrored_by_grant_id";

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

  private failed(what: string, error: { message?: string } | null | undefined): never {
    this.logger.error(`mail ${what} read failed: ${error?.message ?? "unknown"}`);
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
        }),
      ),
      next: rows.length > limit && last ? encodeMailCursor(last.last_at, last.key) : null,
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
    const providerId = PERSON_KEY_RE.exec((opts.with ?? "").trim())?.[1]?.toLowerCase();
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
      personQuery = personQuery.or(WITHHOLD_HOUSE_DRAFT).or(WITHHOLD_HOUSE_CANCELLED);
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
    const provider = Array.isArray(first.providers) ? first.providers[0] : first.providers;

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
      next: rows.length > limit && last ? encodeMailCursor(last.last_at, last.thread_key) : null,
    };
  }

  async getThread(
    houseId: string,
    callerRole: string | null | undefined,
    opts: { key?: string; before?: string },
  ): Promise<MailThreadPage> {
    const key = (opts.key ?? "").trim();
    if (!key || key.length > 500) {
      throw new BadRequestException("Name the thread to open.");
    }
    const before = opts.before ? decodeMailCursor(opts.before) : null;
    if (before && !UUID_RE.test(before.key)) {
      throw new BadRequestException(BAD_CURSOR);
    }
    const withhold = withholdsHouseLetters(callerRole);
    // Every read is this house's rows of this thread, with the same withholding.
    const scoped = (columns: string) => {
      const q = this.db
        .from("procurement_conversations")
        .select(columns)
        .eq("restaurant_id", houseId)
        .eq("thread_key", key);
      return withhold ? q.or(WITHHOLD_HOUSE_DRAFT).or(WITHHOLD_HOUSE_CANCELLED) : q;
    };

    let pageQuery = scoped(MESSAGE_COLUMNS);
    if (before) {
      pageQuery = pageQuery.or(
        `created_at.lt."${before.at}",and(created_at.eq."${before.at}",id.lt.${before.key})`,
      );
    }
    const [headRes, orderRes, pageRes] = await Promise.all([
      scoped(
        "provider_id, message_text, subject:email_headers->>subject, subject_cap:email_headers->>Subject, providers (id, name)",
      )
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(1),
      scoped("order_id, order_number_snapshot, procurement_orders (id, order_number, status)")
        .not("order_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1),
      pageQuery
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(MAIL_THREAD_PAGE + 1),
    ]);
    if (headRes.error) this.failed("thread head", headRes.error);
    if (orderRes.error) this.failed("thread order", orderRes.error);
    if (pageRes.error) this.failed("thread", pageRes.error);

    const head = ((headRes.data ?? []) as any[])[0];
    if (!head) {
      // Another house's key, or one that names nothing: empty, never theirs (F11).
      return { key, subject: null, person: null, order: null, messages: [], before: null };
    }
    const provider = Array.isArray(head.providers) ? head.providers[0] : head.providers;
    const subject =
      (typeof head.subject === "string" && head.subject.trim()) ||
      (typeof head.subject_cap === "string" && head.subject_cap.trim()) ||
      subjectFromText(head.message_text);

    const orderRow = ((orderRes.data ?? []) as any[])[0];
    const po = orderRow
      ? Array.isArray(orderRow.procurement_orders)
        ? orderRow.procurement_orders[0]
        : orderRow.procurement_orders
      : null;
    const order: MailOrderRef | null = orderRow
      ? {
          id: orderRow.order_id,
          number: po?.order_number ?? orderRow.order_number_snapshot ?? null,
          status: po?.status ?? null,
        }
      : null;

    const rows = (pageRes.data ?? []) as any[];
    const kept = rows.slice(0, MAIL_THREAD_PAGE);
    const oldest = kept[kept.length - 1];
    return {
      key,
      subject: subject || null,
      person: head.provider_id ? personRef(head.provider_id, provider?.name) : null,
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
          }),
        ),
      before:
        rows.length > MAIL_THREAD_PAGE && oldest
          ? encodeMailCursor(oldest.created_at, oldest.id)
          : null,
    };
  }

  async summary(houseId: string, callerRole: string | null | undefined): Promise<MailSummary> {
    const domain = (this.configService.get<string>("INBOUND_EMAIL_DOMAIN") || "").trim();
    const [sumRes, addrRes] = await Promise.all([
      this.db.rpc("mail_inbox_summary", {
        p_restaurant_id: houseId,
        p_withhold_house_letters: withholdsHouseLetters(callerRole),
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
    const s = (Array.isArray(sumRes.data) ? sumRes.data[0] : sumRes.data) as any;
    if (!s) this.failed("summary", { message: "no summary row" });
    const addr = ((addrRes.data ?? []) as any[])[0];
    return {
      waitingPeople: Number(s.waiting_people ?? 0),
      oldestWaitAt: s.oldest_wait_at ?? null,
      inToday: Number(s.in_today ?? 0),
      outToday: Number(s.out_today ?? 0),
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
