import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";
import { readHouseZone, type HouseZone } from "../common/house-day";
import type {
  MailAttachment,
  MailAttachmentLink,
  MailMessage,
  MailNoReplyAnswer,
  MailOrderRef,
  MailPeoplePage,
  MailPersonKind,
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
  mailKindFilterOf,
  mailKindOf,
  mailSearchOf,
  otherPersonOf,
  fromDisplayName,
  otherPersonRef,
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
    attachmentsRead: true,
  };
}

/** The private bucket the bridge stores a letter's files in (persistAttachments). */
const ATTACHMENT_BUCKET = "vendor-attachments";
/** A link to a file works this long: enough to open it, too short to pass around. */
export const ATTACHMENT_LINK_SECONDS = 300;
export const ATTACHMENT_NOT_FOUND = "That file is not in this house's mail.";
export const ATTACHMENT_LINK_FAILED =
  "The file could not be opened just now. Nothing was changed; try again in a moment.";

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
    opts: {
      waitingOnly?: boolean;
      after?: string;
      limit?: string | number;
      /** r28 mail gap 16: a name, subject, order number or a letter's words. */
      query?: unknown;
      /** r103 mail-1: only this kind of person (vendor, team, guest). */
      kind?: unknown;
    },
  ): Promise<MailPeoplePage> {
    const limit = clampMailLimit(opts.limit);
    const after = opts.after ? decodeMailCursor(opts.after) : null;
    const query = mailSearchOf(opts.query);
    const kind = mailKindFilterOf(opts.kind);
    const { data, error } = await this.db.rpc("list_mail_people", {
      p_restaurant_id: houseId,
      p_withhold_house_letters: withholdsHouseLetters(callerRole),
      p_waiting_only: opts.waitingOnly === true,
      p_after_at: after?.at ?? null,
      p_after_key: after?.key ?? null,
      // One extra row says whether another page exists.
      p_limit: limit + 1,
      // Named only when there is a search, so a list with none is the same
      // call as before the search existed.
      ...(query ? { p_query: query } : {}),
      // Asked for in SQL, so a page holds that kind and the next page is
      // the next of that kind, never "none" for a kind on a later page.
      ...(kind ? { p_kind: kind } : {}),
    });
    if (error) this.failed("people", error);
    let rows = (data ?? []) as any[];
    // A search also finds a team member or a guest by the name the row shows
    // (r105 mail-4). SQL matches an address or a letter's words; the names are
    // read here, so a name that matches is found by its address in one more
    // read each. Only a caller who may read team and guest people ever asks.
    if (
      query &&
      opts.waitingOnly !== true &&
      kind !== "vendor" &&
      !withholdsHouseLetters(callerRole)
    ) {
      const named = await this.peopleNamed(houseId, query, kind);
      const found = await Promise.all(
        named.map(async (n) => {
          const res = await this.db.rpc("list_mail_people", {
            p_restaurant_id: houseId,
            p_withhold_house_letters: false,
            p_waiting_only: false,
            p_after_at: after?.at ?? null,
            p_after_key: after?.key ?? null,
            p_limit: 1,
            p_query: n.address,
            p_kind: n.kind,
          });
          if (res.error) this.failed("people", res.error);
          const want = `${n.kind}:${n.address}`;
          return ((res.data ?? []) as any[]).filter(
            (r) => String(r.key).toLowerCase() === want,
          );
        }),
      );
      const seen = new Set(rows.map((r) => String(r.key).toLowerCase()));
      for (const r of found.flat()) {
        if (seen.has(String(r.key).toLowerCase())) continue;
        seen.add(String(r.key).toLowerCase());
        rows.push(r);
      }
      // The list's own order: newest first, the key breaking a tie.
      rows = rows
        .sort(
          (a, b) =>
            Date.parse(b.last_at) - Date.parse(a.last_at) ||
            (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
        )
        .slice(0, limit + 1);
    }
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    // Staff read vendors only, so no roster or guest header is read for them.
    const names = await this.namesOf(
      houseId,
      withholdsHouseLetters(callerRole)
        ? []
        : page
            .filter((r) => r.kind === "team" || r.kind === "guest")
            .map((r) => ({
              kind: r.kind as "team" | "guest",
              address: String(r.key).slice(String(r.kind).length + 1),
            })),
    );
    return {
      people: page.map(
        (r): MailPersonRow => ({
          key: r.key,
          kind: mailKindOf(r.kind),
          providerId: r.provider_id ?? null,
          name: names.get(String(r.key).toLowerCase()) ?? r.name ?? null,
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
      storedKinds: await this.storedKinds(
        houseId,
        withholdsHouseLetters(callerRole),
      ),
    };
  }

  /**
   * Names for team and guest people (r104 mail-gap g3), display only; the key
   * stays kind:address. A team address is named from the house's staff roster
   * (name and role), a guest from the newest From display name it wrote with.
   * An address with no name is shown by the address. A failed read is a 503.
   */
  private async namesOf(
    houseId: string,
    others: Array<{ kind: "team" | "guest"; address: string }>,
  ): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const team = [
      ...new Set(
        others
          .filter((o) => o.kind === "team")
          .map((o) => o.address.toLowerCase()),
      ),
    ];
    const guests = [
      ...new Set(
        others
          .filter((o) => o.kind === "guest")
          .map((o) => o.address.toLowerCase()),
      ),
    ];
    if (team.length) {
      for (const [email, display] of await this.rosterDisplay(houseId)) {
        if (team.includes(email)) names.set(`team:${email}`, display);
      }
    }
    if (guests.length) {
      const res = await this.db
        .from("procurement_conversations")
        .select("from_address, from_header:email_headers->>from")
        .eq("restaurant_id", houseId)
        .eq("kind", "guest")
        .in("from_address", guests)
        .order("created_at", { ascending: false })
        .limit(Math.min(guests.length * 5, 250));
      if (res.error) this.failed("names", res.error);
      for (const r of (res.data ?? []) as any[]) {
        const address =
          typeof r.from_address === "string"
            ? r.from_address.toLowerCase()
            : "";
        const key = `guest:${address}`;
        if (!address || names.has(key)) continue;
        const name = fromDisplayName(r.from_header, address);
        if (name) names.set(key, name);
      }
    }
    return names;
  }

  /**
   * This house's staff by lower-cased email, as the row shows them ("Name
   * (role)"): the access rows' role first, then the account's. Read for this
   * house only; a failed read is a 503.
   */
  private async rosterDisplay(houseId: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const access = await this.db
      .from("user_restaurant_access")
      .select("user_id, role")
      .eq("restaurant_id", houseId)
      .eq("is_active", true);
    if (access.error) this.failed("staff", access.error);
    const accessRole = new Map<string, string>();
    for (const a of (access.data ?? []) as any[]) {
      if (a.user_id && a.role) accessRole.set(a.user_id, String(a.role));
    }
    const ids = [...accessRole.keys()];
    // The legacy roster (users.restaurant_id) and the people this house's
    // access rows name: both are this house's, neither reads another's.
    const [legacy, granted] = await Promise.all([
      this.db
        .from("users")
        .select("user_id, email, name, role")
        .eq("restaurant_id", houseId),
      ids.length
        ? this.db
            .from("users")
            .select("user_id, email, name, role")
            .in("user_id", ids)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (legacy.error) this.failed("staff", legacy.error);
    if (granted.error) this.failed("staff", granted.error);
    const staff = {
      data: [
        ...((legacy.data ?? []) as any[]),
        ...((granted.data ?? []) as any[]),
      ],
    };
    for (const u of (staff.data ?? []) as any[]) {
      const email =
        typeof u.email === "string" ? u.email.trim().toLowerCase() : "";
      const name = typeof u.name === "string" ? u.name.trim() : "";
      if (!email || !name) continue;
      const role = (accessRole.get(u.user_id) ?? u.role ?? "")
        .toString()
        .trim()
        .toLowerCase();
      out.set(email, role ? `${name} (${role})` : name);
    }
    return out;
  }

  /**
   * The team members and guests a search names (r105 mail-4): the roster's
   * "Name (role)" and a guest's From display name, matched case- and
   * accent-blind. At most five, so one search is a bounded number of reads.
   * Never called for a caller who may not read these people.
   */
  private async peopleNamed(
    houseId: string,
    query: string,
    kind: MailPersonKind | null,
  ): Promise<Array<{ kind: "team" | "guest"; address: string }>> {
    const fold = (v: string) =>
      v
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/ı/g, "i")
        .toLowerCase();
    const want = fold(query);
    const out: Array<{ kind: "team" | "guest"; address: string }> = [];
    if (kind === null || kind === "team") {
      for (const [email, display] of await this.rosterDisplay(houseId)) {
        if (fold(display).includes(want)) out.push({ kind: "team", address: email });
      }
    }
    if (kind === null || kind === "guest") {
      const like = query.replace(/[\\%_]/g, (c) => `\\${c}`);
      const res = await this.db
        .from("procurement_conversations")
        .select("from_address, from_header:email_headers->>from")
        .eq("restaurant_id", houseId)
        .eq("kind", "guest")
        .ilike("email_headers->>from", `%${like}%`)
        .order("created_at", { ascending: false })
        .limit(50);
      if (res.error) this.failed("names", res.error);
      for (const r of (res.data ?? []) as any[]) {
        const address =
          typeof r.from_address === "string" ? r.from_address.toLowerCase() : "";
        const name = address ? fromDisplayName(r.from_header, address) : null;
        if (name && fold(name).includes(want) && !out.some((o) => o.kind === "guest" && o.address === address)) {
          out.push({ kind: "guest", address });
        }
      }
    }
    return out.slice(0, 5);
  }

  /** Vendors always; team and guest only when stored and the caller may read them. */
  private async storedKinds(
    houseId: string,
    withhold: boolean,
  ): Promise<MailPersonKind[]> {
    const kinds: MailPersonKind[] = ["vendor"];
    if (withhold) return kinds;
    const others = ["team", "guest"] as const;
    const reads = await Promise.all(
      others.map((kind) =>
        this.db
          .from("procurement_conversations")
          .select("id")
          .eq("restaurant_id", houseId)
          .eq("kind", kind)
          .limit(1),
      ),
    );
    reads.forEach((res, i) => {
      if (res.error) this.failed("kinds", res.error);
      if (((res.data ?? []) as unknown[]).length) kinds.push(others[i]);
    });
    return kinds;
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
    const other = otherPersonOf(opts.with);
    const withhold = withholdsHouseLetters(callerRole);
    // F11: a bad key, another house's vendor, or a team or guest person to a
    // caller who may not read them is an empty answer, never theirs.
    if (
      (other && withhold) ||
      (!other && (!providerId || !UUID_RE.test(providerId)))
    ) {
      return { person: null, threads: [], next: null };
    }

    let personQuery = this.db
      .from("procurement_conversations")
      .select("provider_id, providers (id, name)")
      .eq("restaurant_id", houseId)
      .eq(
        other ? "from_address" : "provider_id",
        other?.address ?? providerId!,
      );
    if (other) personQuery = personQuery.eq("kind", other.kind);
    if (withhold) {
      personQuery = personQuery
        .or(WITHHOLD_HOUSE_DRAFT)
        .or(WITHHOLD_HOUSE_CANCELLED);
    }
    const [personRes, threadsRes] = await Promise.all([
      personQuery.limit(1),
      this.db.rpc(other ? "list_mail_threads_other" : "list_mail_threads", {
        p_restaurant_id: houseId,
        ...(other
          ? { p_kind: other.kind, p_address: other.address }
          : { p_provider_id: providerId }),
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
      person: other
        ? otherPersonRef(
            other,
            (await this.namesOf(houseId, [other])).get(
              `${other.kind}:${other.address}`,
            ),
          )
        : personRef(providerId!, provider?.name),
      threads: page.map(
        (t): MailThreadRow => ({
          key: t.thread_key,
          subject: t.subject ?? null,
          messageCount: Number(t.message_count ?? 0),
          // A database without letter_count (older than gap 14) falls back to
          // the old count rather than claiming a thread has no letters.
          letterCount: Number(t.letter_count ?? t.message_count ?? 0),
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
    let other = otherPersonOf(withRaw);
    const providerId = withRaw
      ? PERSON_KEY_RE.exec(withRaw)?.[1]?.toLowerCase()
      : undefined;
    if (withRaw && !providerId && !other) return emptyThread(key);
    // A team or guest person's letters are for the owner and managers alone.
    const withhold = withholdsHouseLetters(callerRole);
    if (other && withhold) return emptyThread(key);

    // One read: the page, newest first by each letter's own time (received
    // for inbound, sent for outbound), keyset-paged on (at, id). The function
    // returns explicit columns: never email_headers, Gmail ids or message_id.
    const readLetters = (who: typeof other) =>
      this.db.rpc(
        who ? "mail_thread_letters_other" : "mail_thread_letters",
        {
          p_restaurant_id: houseId,
          p_thread_key: key,
          ...(who
            ? { p_kind: who.kind, p_address: who.address }
            : { p_provider_id: providerId ?? null }),
          p_withhold_house_letters: withhold,
          p_before_at: before?.at ?? null,
          p_before_id: before?.key ?? null,
          p_limit: MAIL_THREAD_PAGE + 1,
        },
      );
    let { data, error } = await readLetters(other);
    if (error) this.failed("thread", error);
    // A KEY ALONE OPENS EVERY KIND THE CALLER MAY READ. A deep link, a
    // notification or a search hit carries the thread key and no person, and a
    // team or guest letter has no vendor to fall back to: with no vendor
    // letters under the key, the thread is the house's first team or guest
    // letter under it, the same "first letter's person" the vendor read uses.
    // Tenant-scoped, and never asked for a caller who may not read them
    // (withheld stays withheld, above).
    if (!withRaw && !withhold && !((data ?? []) as unknown[]).length) {
      const { data: first, error: firstError } = await this.db
        .from("procurement_conversations")
        .select("kind, from_address")
        .eq("restaurant_id", houseId)
        .eq("thread_key", key)
        .in("kind", ["team", "guest"])
        .not("from_address", "is", null)
        .order("created_at", { ascending: true })
        .limit(1);
      if (firstError) this.failed("thread person", firstError);
      const hit = ((first ?? []) as any[])[0];
      const found = otherPersonOf(
        hit && typeof hit.from_address === "string"
          ? `${hit.kind}:${hit.from_address}`
          : null,
      );
      if (found) {
        other = found;
        ({ data, error } = await readLetters(other));
        if (error) this.failed("thread", error);
      }
    }
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

    const otherName = other
      ? (await this.namesOf(houseId, [other])).get(
          `${other.kind}:${other.address}`,
        )
      : null;
    const kept = rows.slice(0, MAIL_THREAD_PAGE);
    const oldest = kept[kept.length - 1];
    const files = await this.readAttachments(kept.map((m) => m.id));
    const who = await this.readWho(
      houseId,
      kept.map((m) => m.id),
    );
    return {
      key,
      subject:
        typeof head.thread_subject === "string" && head.thread_subject.trim()
          ? head.thread_subject.trim()
          : null,
      person: other
        ? otherPersonRef(other, otherName)
        : head.provider_id
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
            kind: who.get(m.id)?.kind ?? "vendor",
            fromAddress: who.get(m.id)?.from ?? null,
            toAddresses: who.get(m.id)?.to ?? [],
            automatic: m.automatic === true,
            noReplyMarkedAt:
              typeof m.no_reply_marked_at === "string"
                ? m.no_reply_marked_at
                : null,
            attachments: files?.get(m.id) ?? [],
          }),
        ),
      before:
        rows.length > MAIL_THREAD_PAGE && oldest
          ? encodeMailCursor(oldest.at, oldest.id)
          : null,
      // Every row carries the same thread-wide answer; the newest is read.
      waiting: head.thread_waiting === true,
      attachmentsRead: files !== null,
    };
  }

  /** Each letter's kind, sender and recipients. A failed read fails the page, never "no sender". */
  private async readWho(houseId: string, letterIds: string[]) {
    const out = new Map<
      string,
      { kind: MailPersonKind; from: string | null; to: string[] }
    >();
    if (!letterIds.length) return out;
    const { data, error } = await this.db
      .from("procurement_conversations")
      .select("id, kind, from_address, to_addresses")
      .eq("restaurant_id", houseId)
      .in("id", letterIds);
    if (error) this.failed("letter addresses", error);
    for (const r of (data ?? []) as any[]) {
      out.set(r.id, {
        kind: mailKindOf(r.kind),
        from: typeof r.from_address === "string" ? r.from_address : null,
        to: Array.isArray(r.to_addresses) ? r.to_addresses : [],
      });
    }
    return out;
  }

  /**
   * The files each letter of a page carried (r28 mail gap 13), by letter id.
   * Read by the letters' own ids, which mail_thread_letters has already
   * proven are this house's and readable by this caller; a file belongs to
   * its letter (ON DELETE CASCADE). Null when the read failed: the page then
   * says the files could not be read, and still shows the letters.
   */
  private async readAttachments(
    letterIds: string[],
  ): Promise<Map<string, MailAttachment[]> | null> {
    const out = new Map<string, MailAttachment[]>();
    if (!letterIds.length) return out;
    let data: unknown;
    try {
      const res = await this.db
        .from("conversation_attachments")
        .select(
          "id, conversation_id, filename, mime_type, size_bytes, bytes_deleted_at, created_at",
        )
        .in("conversation_id", letterIds)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (res.error) throw new Error(res.error.message);
      data = res.data;
    } catch (e) {
      this.logger.error(
        `mail attachments read failed: ${(e as Error)?.message ?? "unknown"}`,
      );
      return null;
    }
    for (const r of (data ?? []) as any[]) {
      const list = out.get(r.conversation_id) ?? [];
      list.push({
        id: r.id,
        filename:
          typeof r.filename === "string" && r.filename.trim()
            ? r.filename
            : "A file with no name",
        mimeType: typeof r.mime_type === "string" ? r.mime_type : null,
        sizeBytes:
          r.size_bytes === null || r.size_bytes === undefined
            ? null
            : Number(r.size_bytes),
        removedAt:
          typeof r.bytes_deleted_at === "string" ? r.bytes_deleted_at : null,
      });
      out.set(r.conversation_id, list);
    }
    return out;
  }

  /**
   * A short-lived address for one file a letter carried (r28 mail gap 13).
   * The file must belong to a letter of the caller's house that the caller
   * may read: staff never reach a withheld letter's file, and another house's
   * file is "not in this house's mail", the same answer as a file that does
   * not exist. A file removed under the retention rule is 410, in words.
   */
  async attachmentLink(
    houseId: string,
    callerRole: string | null | undefined,
    attachmentId: unknown,
  ): Promise<MailAttachmentLink> {
    const id =
      typeof attachmentId === "string" ? attachmentId.trim().toLowerCase() : "";
    if (!UUID_RE.test(id)) throw new NotFoundException(ATTACHMENT_NOT_FOUND);

    const fileRes = await this.db
      .from("conversation_attachments")
      .select(
        "id, conversation_id, filename, mime_type, storage_path, bytes_deleted_at",
      )
      .eq("id", id)
      .limit(1);
    if (fileRes.error) this.failed("attachment", fileRes.error);
    const file = ((fileRes.data ?? []) as any[])[0];
    if (!file) throw new NotFoundException(ATTACHMENT_NOT_FOUND);

    let letterQuery = this.db
      .from("procurement_conversations")
      .select("id")
      .eq("id", file.conversation_id)
      .eq("restaurant_id", houseId);
    if (withholdsHouseLetters(callerRole)) {
      letterQuery = letterQuery
        .or(WITHHOLD_HOUSE_DRAFT)
        .or(WITHHOLD_HOUSE_CANCELLED);
    }
    const letterRes = await letterQuery.limit(1);
    if (letterRes.error) this.failed("attachment letter", letterRes.error);
    if (!((letterRes.data ?? []) as any[])[0]) {
      throw new NotFoundException(ATTACHMENT_NOT_FOUND);
    }

    if (typeof file.bytes_deleted_at === "string") {
      throw new GoneException(
        "This file was removed under the house's mail retention rule. Its name is kept with the letter.",
      );
    }
    if (typeof file.storage_path !== "string" || !file.storage_path) {
      throw new NotFoundException(ATTACHMENT_NOT_FOUND);
    }
    let url: string | null = null;
    try {
      const { data, error } = await this.db.storage
        .from(ATTACHMENT_BUCKET)
        .createSignedUrl(file.storage_path, ATTACHMENT_LINK_SECONDS);
      if (error) throw error;
      url = typeof data?.signedUrl === "string" ? data.signedUrl : null;
    } catch (e) {
      this.logger.error(
        `mail attachment link failed: ${(e as Error)?.message ?? "unknown"}`,
      );
    }
    if (!url) throw new ServiceUnavailableException(ATTACHMENT_LINK_FAILED);
    return {
      id: file.id,
      filename:
        typeof file.filename === "string" && file.filename.trim()
          ? file.filename
          : "A file with no name",
      mimeType: typeof file.mime_type === "string" ? file.mime_type : null,
      url,
      expiresInSeconds: ATTACHMENT_LINK_SECONDS,
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
