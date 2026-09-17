/**
 * The house's own inbox reaches the book.
 *
 * THE DECISION THIS ENFORCES (founder, 2026-09-04; ADR 0118, receive half)
 * ----------------------------------------------------------------------
 * The send grant stays send-only, ON CONDITION that the house can also RECEIVE
 * on its own mailbox and have the whole conversation there. Asked how the
 * house's inbox should reach the book, the founder answered: **"A second grant,
 * read-only, house-declared and person-consented."** So there are two grants,
 * each asking for one thing — `gmail_send` (2026-09-04, commit 9efef112) and
 * `gmail_read` (this build) — and a person who agreed to let letters LEAVE from
 * their mailbox has not thereby agreed to let it be READ.
 *
 * WHAT A VENDOR REPLY DOES TODAY, MEASURED ON THIS BRANCH
 * ------------------------------------------------------
 * One mailbox, shared by every restaurant on the deployment. Google Pub/Sub
 * pushes to `POST /communications/webhooks/gmail`
 * (`communications.controller.ts:1222`), which verifies the OIDC token, pulls
 * new messages by `historyId` through `GmailWatchService` — built on the
 * deployment's own `GMAIL_CLIENT_ID` / `GMAIL_REFRESH_TOKEN` — drops anything
 * whose `From` contains the deployment sender, and publishes
 * `email.inbound.received` on the `email.events` exchange (`:1331`). The
 * dedicated inbound-domain webhook publishes the SAME event
 * (`common/orchestrator/inbound-email.controller.ts:90`). Both land on
 * `RabbitMqBridgeService.handleInboundEmail`
 * (`common/orchestrator/rabbitmq-bridge.service.ts:528`, subscribed at `:225`),
 * which resolves the provider by `contact_email`, matches an order by
 * `gmail_thread_id` (falling back to the vendor's most recent non-terminal
 * order), dedupes on `gmail_message_id`, INSERTS the `procurement_conversations`
 * row at `:743`, persists attachments, runs the promotions extractor, notifies
 * the browser, and hands the row to `InboundResponderService.analyzeAndDraftReply`
 * — the understand -> guardrails -> staged-draft path, with the shadow triage
 * classification written onto `conversation_context.classification`
 * (`inbound-responder.service.ts:326`).
 *
 * THE MIRROR IS THAT FUNCTION, NOT A COPY OF IT
 * ---------------------------------------------
 * This reader does not write a `procurement_conversations` row. It publishes
 * `email.inbound.received` onto `email.events`, exactly as the other two
 * producers do, stamped with the `restaurant_id` it already knows from the
 * grant. `handleInboundEmail` is then the same function, running the same
 * dedupe, the same order matching, the same attachment persistence and the same
 * handoff to triage — so a house-mailbox reply IS a shared-mailbox reply, and
 * there is no second write path to drift.
 *
 * A copy would have been easier and is the thing this build most needed to
 * avoid: two inserts that agree today, and a vendor reply that six months from
 * now is triaged on one mailbox and silently is not on the other.
 *
 * WHAT BOUNDS THE READ — TWO BOUNDS, AND BOTH ARE LOAD-BEARING
 * ------------------------------------------------------------
 *  1. **The query.** Every `users/me/messages` request carries
 *     `from:(a@x OR b@y ...)` built from THIS house's vendor book — the same
 *     `HouseLettersService.book()` the composer may write to. An empty book
 *     issues no request at all.
 *  2. **The post-check.** Gmail's `from:` operator matches display names and
 *     partial tokens, not just exact addresses, so the query alone is a filter
 *     and not a guarantee. Every message that comes back has its `From` parsed
 *     and compared to the book set exactly; anything else is DISCARDED before
 *     its body is published, logged or stored, and counted as discarded.
 *     `house-inbox.spec.ts` proves the discard against a message Gmail returned
 *     but the book does not hold.
 *
 * NOTHING FROM BEFORE CONSENT IS EVER READ. The first tick for a grant SEEDS
 * the cursor at `now` and reads nothing. Switching the reader on therefore does
 * not sweep a person's mail history into the house's book — it starts the
 * record from the moment they agreed. That is a privacy property first and a
 * quota property second, and it is why `started_at` is stored beside the cursor.
 *
 * THE CURSOR IS A ROW, NOT A CACHE KEY. `GmailWatchService` keeps the shared
 * mailbox's `historyId` in Redis under a 7-day TTL
 * (`gmail-watch.service.ts:29,179`); a lost key there means a re-sync of one
 * mailbox. A lost cursor here would mean re-reading a person's mail, so it is a
 * durable row per grant (`house_inbox_cursors`, migration 20260905020000).
 *
 * WHY `messages.list` AND NOT `history.list`. `history.list` costs 2 quota
 * units against `messages.list`'s 5 and is exactly incremental, which makes it
 * the obvious choice — and it is wrong here. `history.list` takes no `q`: it
 * returns every change in the mailbox, so deciding which ones concern a vendor
 * would mean fetching metadata for the person's whole mail flow and throwing
 * most of it away. That is precisely the read this grant promises not to make.
 * A bounded `q` at 5 units is cheaper in the only currency that matters.
 *
 * REVOCATION STOPS IT ON THE NEXT TICK. The token comes from
 * `IntegrationsOauthService.getAccessToken`, the one door ADR 0114's house
 * revocation is enforced at (`integrations-oauth.service.ts:926-938`). A manager
 * who stops the house using a grant makes the next tick throw `Forbidden`, which
 * is recorded in words and reads nothing. A person who disconnects sets
 * `revoked_at`, and the enumeration below never sees the row again.
 */

import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { OrchestratorService } from "../../common/orchestrator/orchestrator.service";
import { IntegrationsOauthService } from "../../integrations/integrations-oauth.service";
import { HouseLettersService } from "../letters/house-letters.service";
import {
  GMAIL_READ_INTEGRATION_ID,
  GMAIL_READ_SCOPE,
  HOUSE_INBOX_FLAG,
  isHouseInboxReadEnabled,
} from "./house-inbox-flag";
import {
  addressInFromHeader,
  extractEmailContent,
  headerValue,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_B64_LEN,
  type GmailPayloadPart,
} from "../gmail-mime";

/**
 * The scope, the integration id and the switch live in `house-inbox-flag.ts`,
 * which `HouseSenderService` also imports; re-exported here so the reader's
 * public surface is one import for its callers and its spec.
 */
export {
  GMAIL_READ_SCOPE,
  GMAIL_READ_INTEGRATION_ID,
  HOUSE_INBOX_FLAG,
} from "./house-inbox-flag";

/**
 * Once every five minutes, and the number is measured rather than picked.
 *
 * GMAIL'S PUBLISHED QUOTA (developers.google.com/workspace/gmail/api/reference/quota,
 * fetched 2026-09-04): **80,000,000 quota units per day per project** and
 * **6,000 quota units per minute per user per project**. Unit costs:
 * `messages.list` 5, `messages.get` 20, `messages.attachments.get` 20,
 * `history.list` 2, `messages.send` 100.
 *
 * ONE TICK for one grant costs `5 x (number of address chunks)` for the listing,
 * plus `20` for each message admitted, plus `20` for each attachment fetched.
 *
 *  - **Idle** (a house with up to 25 vendors and no new mail): 5 units.
 *    At 288 ticks a day that is **1,440 units per grant per day** — 0.0018% of
 *    the project's daily 80,000,000.
 *  - **Busy** (50 vendor replies in a day, 10 carrying an attachment):
 *    1,440 + 50x20 + 10x20 = **2,640 units per grant per day**.
 *  - **A large book** (500 vendors = 20 chunks): 20x5 = 100 units per tick,
 *    28,800 per day. Still nothing against 80,000,000, and 100 units in a
 *    minute is 1.7% of the 6,000-per-user-per-minute ceiling.
 *  - **The per-minute ceiling** is the one that actually binds, and it binds per
 *    user. The worst tick this code can produce is `MAX_MESSAGES_PER_TICK` (250)
 *    messages each with three attachments: 250x20 + 750x20 = 20,000 units, which
 *    EXCEEDS 6,000/minute. That tick cannot occur in normal operation — the
 *    cursor seeds at `now`, so there is no historical backlog to drain — but it
 *    is why `MAX_MESSAGES_PER_TICK` exists at all and why 429s are recorded in
 *    words instead of retried in a loop.
 *
 * WHY NOT ONE MINUTE. Five times the listing cost for a reply nobody acts on any
 * sooner: an inbound reply is analysed and a draft is STAGED for a human, and
 * even the autonomous path holds it for a two-minute window
 * (`AUTO_SEND_UNDO_MS`). Four extra minutes of latency buys nothing a person
 * would notice, and one minute would put an idle grant at 7,200 units a day for
 * the same zero messages.
 *
 * WHY NOT FIFTEEN. A vendor who replies and telephones ten minutes later would
 * find the house had not seen the mail, and the whole point of the grant is that
 * the house sees it rather than one person's inbox.
 */
export const HOUSE_INBOX_CRON = "*/5 * * * *";
export const HOUSE_INBOX_INTERVAL_MINUTES = 5;

/**
 * Addresses per `from:(...)` clause. Gmail's `q` travels in the query string;
 * 25 addresses is roughly 600 characters, which keeps every request well inside
 * the practical URL length whatever a vendor's address looks like. More chunks
 * cost 5 units each and nothing else, so the bound is on length, not on money.
 */
export const BOOK_CHUNK_SIZE = 25;

/** Pages of 100 ids per chunk per tick, and messages fetched per grant per tick. */
export const MAX_PAGES_PER_CHUNK = 3;
export const MAX_MESSAGES_PER_TICK = 250;

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

export interface GrantReadOutcome {
  connectionId: string;
  restaurantId: string | null;
  /** What happened, in words. Never a bare boolean, never a silent skip. */
  outcome:
    | "seeded"
    | "read"
    | "flag_off"
    | "no_house"
    | "empty_book"
    | "house_revoked"
    | "error";
  says: string;
  bookAddresses: number;
  listed: number;
  admitted: number;
  discarded: number;
  mirrored: number;
  cursorAdvancedTo: number | null;
}

export interface InboxReadRun {
  at: string;
  grants: number;
  mirrored: number;
  discarded: number;
  outcomes: GrantReadOutcome[];
  /** A run that could not enumerate grants at all. Not the same as zero grants. */
  error: string | null;
}

interface GmailListed {
  id: string;
  threadId?: string;
}

@Injectable()
export class HouseInboxService {
  private readonly logger = new Logger(HouseInboxService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly orchestrator: OrchestratorService,
    private readonly oauth: IntegrationsOauthService,
    private readonly letters: HouseLettersService,
  ) {}

  // ==========================================================================
  // The switch
  // ==========================================================================

  /**
   * Read `enable_house_inbox_read`; default OFF unless explicitly enabled.
   * The one implementation, shared with the sender line (`house-inbox-flag.ts`).
   */
  async isEnabled(restaurantId: string): Promise<boolean> {
    return isHouseInboxReadEnabled(this.db.client, restaurantId);
  }

  // ==========================================================================
  // The tick
  // ==========================================================================

  /**
   * One pass over every live `gmail_read` grant on this deployment.
   *
   * Enumerated from the GRANTS rather than from the tenant list, because a grant
   * is the only thing that proves a person consented. A restaurant with the flag
   * on and no grant is read exactly as much as one with neither: not at all.
   */
  async readDue(nowMs = Date.now()): Promise<InboxReadRun> {
    const at = new Date(nowMs).toISOString();
    const { data, error } = await this.db.client
      .from("integration_oauth_connections")
      .select("id, user_id, restaurant_id, integration_id, scopes, revoked_at")
      .eq("integration_id", GMAIL_READ_INTEGRATION_ID)
      .is("revoked_at", null);

    if (error) {
      // Not "no grants". We could not find out.
      this.logger.error(
        `House inbox: the grant list could not be read — ${error.message}`,
      );
      return {
        at,
        grants: 0,
        mirrored: 0,
        discarded: 0,
        outcomes: [],
        error: `The list of reading grants could not be read (${error.message}), so no house was read this run. This is a failed read, not an absence of grants.`,
      };
    }

    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    const outcomes: GrantReadOutcome[] = [];

    for (const row of rows) {
      // The stored scope decides, not the id. A row recorded under this
      // integration that does not carry the scope is not a reading grant, and
      // treating the id as the answer is the flag-instead-of-scope mistake ADR
      // 0118 D1 refuses on the sending side.
      const scopes = Array.isArray(row.scopes) ? (row.scopes as string[]) : [];
      if (!scopes.includes(GMAIL_READ_SCOPE)) {
        outcomes.push(
          this.blank(row, "error", {
            says: `This grant is recorded as ${GMAIL_READ_INTEGRATION_ID} but its stored scopes do not include ${GMAIL_READ_SCOPE}, so nothing was read against it. A grant counts by what the person consented to, never by what the row is called.`,
          }),
        );
        continue;
      }
      outcomes.push(await this.readOneGrant(row, nowMs));
    }

    return {
      at,
      grants: rows.length,
      mirrored: outcomes.reduce((n, o) => n + o.mirrored, 0),
      discarded: outcomes.reduce((n, o) => n + o.discarded, 0),
      outcomes,
      error: null,
    };
  }

  private blank(
    row: Record<string, unknown>,
    outcome: GrantReadOutcome["outcome"],
    over: Partial<GrantReadOutcome> & { says: string },
  ): GrantReadOutcome {
    return {
      connectionId: String(row.id),
      restaurantId: row.restaurant_id ? String(row.restaurant_id) : null,
      outcome,
      bookAddresses: 0,
      listed: 0,
      admitted: 0,
      discarded: 0,
      mirrored: 0,
      cursorAdvancedTo: null,
      ...over,
    };
  }

  private async readOneGrant(
    row: Record<string, unknown>,
    nowMs: number,
  ): Promise<GrantReadOutcome> {
    const connectionId = String(row.id);
    const userId = String(row.user_id);
    const restaurantId = row.restaurant_id ? String(row.restaurant_id) : null;

    // A grant with no recorded house has no book to bound against and no tenant
    // to write into. It is NOT dropped silently: G21's rule is that a null
    // restaurant means "never recorded", not "no house", and the surface has to
    // be able to say so.
    if (!restaurantId) {
      return this.blank(row, "no_house", {
        says: "This reading grant carries no restaurant, so there is no vendor book to bound it by and no house to file a reply in. It was not read. Reconnect it from inside a restaurant to record one.",
      });
    }

    if (!(await this.isEnabled(restaurantId))) {
      return this.blank(row, "flag_off", {
        says: `A person in this house has consented to reading, but ${HOUSE_INBOX_FLAG} is not on for this restaurant, so nothing was read. Consent and the switch are two different facts and both are required.`,
      });
    }

    // The book, first — and a failed book read is an error, never an empty
    // book. `book()` throws rather than returning [] for exactly this reason:
    // an unreadable book and an empty one look identical downstream, and the
    // second one would silently read NOTHING while reporting a clean run.
    let addresses: string[];
    try {
      const entries = await this.letters.book(restaurantId);
      addresses = Array.from(
        new Set(entries.map((e) => e.email.trim().toLowerCase())),
      ).filter((a) => a.includes("@"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.blank(row, "error", {
        says: `The vendor book could not be read for this house (${message}), so no query was bounded and nothing was read. The reader refuses rather than falling back to an unbounded request.`,
      });
    }

    if (addresses.length === 0) {
      return this.blank(row, "empty_book", {
        says: "This house's vendor book holds no address, so there was nothing to filter a request by and no request was made. An unbounded read is not the fallback for an empty book.",
      });
    }

    // The cursor. Absent means this grant has never been read: seed it at NOW
    // and read nothing. Turning the reader on does not sweep the mailbox.
    const cursor = await this.loadCursor(connectionId);
    if (cursor === null) {
      const seeded = await this.seedCursor(connectionId, restaurantId, nowMs);
      return this.blank(row, seeded ? "seeded" : "error", {
        bookAddresses: addresses.length,
        cursorAdvancedTo: seeded ? nowMs : null,
        says: seeded
          ? `First run for this grant. The cursor starts at ${new Date(nowMs).toISOString()} and nothing older was read: switching the reader on never reaches backwards into a person's mail. Vendor replies that arrive from now on will be filed in this house's book.`
          : "First run for this grant, and the cursor could not be written. Nothing was read, because a reader with no durable cursor would re-read the same mail on every tick.",
      });
    }

    // The token. This is where ADR 0114's house revocation stops the read.
    let token: string;
    try {
      token = await this.oauth.getAccessToken(
        userId,
        restaurantId,
        GMAIL_READ_INTEGRATION_ID,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const revoked = /stopped using|not connected|reconnected/i.test(message);
      await this.recordError(connectionId, message, nowMs);
      return this.blank(row, revoked ? "house_revoked" : "error", {
        bookAddresses: addresses.length,
        says: revoked
          ? `Nothing was read on this grant: ${message}`
          : `The reading grant's token could not be obtained (${message}), so nothing was read and the cursor was left where it was.`,
      });
    }

    let listed = 0;
    let admitted = 0;
    let discarded = 0;
    let mirrored = 0;
    let highWater = cursor;

    try {
      const ids = await this.listSince(token, addresses, cursor);
      listed = ids.length;

      // Fetch, filter, THEN sort oldest-first before anything is published.
      //
      // Gmail lists newest-first and this run merges several chunk queries, so
      // the arrival order is neither. If a publish failed halfway through an
      // unsorted run the high-water mark could sit above messages that never
      // reached the book, and the next tick's `after:` would skip them — a hole
      // in the record that nothing reports. Sorting first makes the survivors a
      // contiguous prefix: everything below the cursor really did get there.
      const admissible: Array<{
        id: string;
        threadId: string | null;
        internalDate: number;
        headers: Array<{ name?: string | null; value?: string | null }>;
        payload: GmailPayloadPart;
      }> = [];

      for (const listedMessage of ids) {
        const message = await this.getMessage(token, listedMessage.id);
        if (!message) continue;

        const headers = (message.payload?.headers ?? []) as Array<{
          name?: string | null;
          value?: string | null;
        }>;
        const sender = addressInFromHeader(headerValue(headers, "from"));

        // BOUND 2. Gmail's `from:` matches display names and partial tokens, so
        // a message from outside the book can come back from a query that only
        // named book addresses. It is dropped here, before its body is read out
        // of the payload, published, logged or counted as anything but a
        // discard, and its internalDate never touches the cursor — a discarded
        // message leaves no trace at all.
        if (!sender || !addresses.includes(sender)) {
          discarded += 1;
          continue;
        }

        const internalDate = Number(message.internalDate ?? 0);
        if (!Number.isFinite(internalDate) || internalDate <= cursor) {
          // Gmail's `after:` is second-granular; the cursor is stored in
          // milliseconds, so the boundary second can come back twice. Skipping
          // it here is cheaper than relying on the downstream dedupe, and it
          // keeps `admitted` honest.
          continue;
        }

        admitted += 1;
        admissible.push({
          id: listedMessage.id,
          threadId: message.threadId ?? listedMessage.threadId ?? null,
          internalDate,
          headers,
          payload: (message.payload ?? {}) as GmailPayloadPart,
        });
      }

      admissible.sort((a, b) => a.internalDate - b.internalDate);

      for (const message of admissible) {
        const { headers, internalDate } = message;
        const from = headerValue(headers, "from");
        const { text, attachmentRefs } = extractEmailContent(message.payload);
        let body = text;
        if (!body && message.payload.body?.data) {
          body = Buffer.from(message.payload.body.data, "base64url").toString(
            "utf-8",
          );
        }
        const attachments = attachmentRefs.length
          ? await this.fetchAttachments(token, message.id, attachmentRefs)
          : [];

        // THE MIRROR. Not an insert — the same event the shared mailbox
        // publishes, so `RabbitMqBridgeService.handleInboundEmail` does the
        // writing, the dedupe, the order match and the handoff to triage.
        await this.orchestrator.publishEvent(
          "email.events",
          "email.inbound.received",
          {
            restaurant_id: restaurantId,
            from,
            subject: headerValue(headers, "subject"),
            body,
            attachments,
            message_id_header: headerValue(headers, "message-id"),
            gmail_message_id: message.id,
            gmail_thread_id: message.threadId,
            in_reply_to: headerValue(headers, "in-reply-to"),
            references: headerValue(headers, "references"),
            received_at: new Date(internalDate).toISOString(),
            headers: Object.fromEntries(
              headers
                .filter((h) => h.name && h.value)
                .map((h) => [h.name!.toLowerCase(), h.value]),
            ),
            source: "house-inbox",
            // WHICH GRANT MIRRORED IT (ADR 0118, retention, 2026-09-05).
            // `source: "house-inbox"` says a personal mailbox was the origin
            // and nothing more, and the bridge never read it. Without the
            // connection id, a revocation could not find the rows it must
            // delete except by deleting every reply in the house — including
            // shared-mailbox replies that no personal grant covers. The bridge
            // writes this onto `procurement_conversations.mirrored_by_grant_id`.
            mirrored_by_grant_id: connectionId,
          },
        );

        // Advanced only AFTER the publish resolved. A publish that throws (no
        // RabbitMQ channel — `orchestrator.service.ts:78-88` does not swallow
        // it) leaves the cursor where it was, so the message is read again next
        // tick rather than lost with the run reporting success.
        mirrored += 1;
        if (internalDate > highWater) highWater = internalDate;
      }

      await this.saveCursor(connectionId, restaurantId, highWater, nowMs, {
        listed,
        admitted,
        discarded,
      });

      return {
        connectionId,
        restaurantId,
        outcome: "read",
        bookAddresses: addresses.length,
        listed,
        admitted,
        discarded,
        mirrored,
        cursorAdvancedTo: highWater,
        says: `Read ${listed} message${listed === 1 ? "" : "s"} matching ${addresses.length} book address${addresses.length === 1 ? "" : "es"}; ${admitted} were from an address in the book and were filed in this house's conversation book, ${discarded} came back from Gmail's own sender matching without being in the book and were discarded unread.`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The cursor is saved at the high-water mark actually mirrored, so the
      // messages that DID reach the book are not read again and the ones that
      // did not are.
      await this.saveCursor(connectionId, restaurantId, highWater, nowMs, {
        listed,
        admitted,
        discarded,
        error: message,
      });
      this.logger.error(`House inbox read failed for ${connectionId}: ${message}`);
      return {
        connectionId,
        restaurantId,
        outcome: "error",
        bookAddresses: addresses.length,
        listed,
        admitted,
        discarded,
        mirrored,
        cursorAdvancedTo: highWater,
        says: `The read stopped partway (${message}). ${mirrored} message${mirrored === 1 ? "" : "s"} reached the book before it did, and the cursor stands at that point, so the rest are read again on the next run rather than lost.`,
      };
    }
  }

  // ==========================================================================
  // Gmail
  // ==========================================================================

  /**
   * The bounded query. `from:(...)` is the first bound; `after:` is the cursor.
   *
   * `includeSpamTrash` is left at its default of false, so spam and trash are
   * out. `in:inbox` is deliberately NOT added: a person who archives a vendor
   * reply before the tick would otherwise drop it out of the house's record
   * silently, which is the fault this whole build exists to close.
   */
  buildQuery(addresses: string[], sinceMs: number): string[] {
    const afterSeconds = Math.floor(sinceMs / 1000);
    const queries: string[] = [];
    for (let i = 0; i < addresses.length; i += BOOK_CHUNK_SIZE) {
      const chunk = addresses.slice(i, i + BOOK_CHUNK_SIZE);
      queries.push(`from:(${chunk.join(" OR ")}) after:${afterSeconds}`);
    }
    return queries;
  }

  private async listSince(
    token: string,
    addresses: string[],
    sinceMs: number,
  ): Promise<GmailListed[]> {
    const seen = new Map<string, GmailListed>();
    for (const q of this.buildQuery(addresses, sinceMs)) {
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_PAGES_PER_CHUNK; page += 1) {
        const url = new URL(`${GMAIL_API}/users/me/messages`);
        url.searchParams.set("q", q);
        url.searchParams.set("maxResults", "100");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const body = await this.gmailGet<{
          messages?: GmailListed[];
          nextPageToken?: string;
        }>(token, url.toString());
        for (const m of body.messages ?? []) {
          if (m?.id && !seen.has(m.id)) seen.set(m.id, m);
        }
        if (seen.size >= MAX_MESSAGES_PER_TICK) return [...seen.values()];
        if (!body.nextPageToken) break;
        pageToken = body.nextPageToken;
      }
    }
    // Ids only. Chronology is settled by `internalDate` after the fetch, in
    // `readOneGrant`, because Gmail lists newest-first per query and this merges
    // several queries.
    return [...seen.values()];
  }

  private async getMessage(
    token: string,
    id: string,
  ): Promise<{
    id?: string;
    threadId?: string;
    internalDate?: string;
    payload?: GmailPayloadPart & {
      headers?: Array<{ name?: string | null; value?: string | null }>;
    };
  } | null> {
    const url = `${GMAIL_API}/users/me/messages/${encodeURIComponent(id)}?format=full`;
    return this.gmailGet(token, url);
  }

  /**
   * Attachment bytes, through the HOUSE's grant and under the SAME caps the
   * shared-mailbox path uses (`gmail-mime.ts`). A different ceiling here would
   * mean the same vendor receipt reaching the AI on one mailbox and not on the
   * other, with nothing to say why.
   */
  private async fetchAttachments(
    token: string,
    messageId: string,
    refs: Array<{ filename: string; mimeType: string; attachmentId: string }>,
  ): Promise<Array<{ filename: string; mime_type: string; data: string }>> {
    const out: Array<{ filename: string; mime_type: string; data: string }> = [];
    for (const ref of refs.slice(0, MAX_ATTACHMENTS_PER_MESSAGE)) {
      try {
        const url = `${GMAIL_API}/users/me/messages/${encodeURIComponent(
          messageId,
        )}/attachments/${encodeURIComponent(ref.attachmentId)}`;
        const body = await this.gmailGet<{ data?: string }>(token, url);
        const b64url = body?.data;
        if (!b64url) continue;
        if (b64url.length > MAX_ATTACHMENT_B64_LEN) {
          this.logger.warn(
            `House inbox: skipping oversized attachment ${ref.filename} (${b64url.length} b64 chars)`,
          );
          continue;
        }
        out.push({
          filename: ref.filename,
          mime_type: ref.mimeType,
          // Gmail returns base64url; the Anthropic API expects standard base64.
          data: b64url.replace(/-/g, "+").replace(/_/g, "/"),
        });
      } catch (err) {
        // One unreadable attachment must not cost the letter its body.
        this.logger.warn(
          `House inbox: attachment ${ref.filename} on ${messageId} could not be fetched — ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return out;
  }

  /** Injected in the spec so the request shape is provable without a network. */
  fetchImpl: typeof fetch = fetch;

  private async gmailGet<T>(token: string, url: string): Promise<T> {
    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (response.status === 403) {
        throw new Error(
          `Google refused the read (403). The connected account's grant does not include ${GMAIL_READ_SCOPE}; that consent has to be asked for by name, not added behind the account holder's back. ${detail.slice(0, 300)}`,
        );
      }
      if (response.status === 429) {
        throw new Error(
          `Google rate-limited the read (429). Gmail allows 6,000 quota units per minute per user; this run stopped rather than retrying in a loop. ${detail.slice(0, 200)}`,
        );
      }
      throw new Error(
        `Google refused the read (${response.status}). ${detail.slice(0, 300)}`,
      );
    }
    return (await response.json()) as T;
  }

  // ==========================================================================
  // The cursor
  // ==========================================================================

  /** The stored cursor in ms, or null when this grant has never been read. */
  private async loadCursor(connectionId: string): Promise<number | null> {
    const { data, error } = await this.db.client
      .from("house_inbox_cursors")
      .select("last_internal_date")
      .eq("connection_id", connectionId)
      .maybeSingle();
    if (error || !data) return null;
    const value = (data as Record<string, unknown>).last_internal_date;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private async seedCursor(
    connectionId: string,
    restaurantId: string,
    nowMs: number,
  ): Promise<boolean> {
    const { error } = await this.db.client.from("house_inbox_cursors").insert({
      connection_id: connectionId,
      restaurant_id: restaurantId,
      last_internal_date: nowMs,
      started_at: new Date(nowMs).toISOString(),
      last_read_at: new Date(nowMs).toISOString(),
    });
    if (error) {
      this.logger.error(
        `House inbox: cursor could not be seeded for ${connectionId} — ${error.message}`,
      );
      return false;
    }
    return true;
  }

  private async saveCursor(
    connectionId: string,
    restaurantId: string,
    cursorMs: number,
    nowMs: number,
    counts: {
      listed: number;
      admitted: number;
      discarded: number;
      error?: string;
    },
  ): Promise<void> {
    const { error } = await this.db.client
      .from("house_inbox_cursors")
      .update({
        restaurant_id: restaurantId,
        last_internal_date: cursorMs,
        last_read_at: new Date(nowMs).toISOString(),
        last_error: counts.error ?? null,
        last_listed: counts.listed,
        last_admitted: counts.admitted,
        last_discarded: counts.discarded,
      })
      .eq("connection_id", connectionId);
    if (error) {
      this.logger.error(
        `House inbox: cursor could not be saved for ${connectionId} — ${error.message}`,
      );
    }
  }

  private async recordError(
    connectionId: string,
    message: string,
    nowMs: number,
  ): Promise<void> {
    await this.db.client
      .from("house_inbox_cursors")
      .update({
        last_error: message,
        last_read_at: new Date(nowMs).toISOString(),
      })
      .eq("connection_id", connectionId);
  }

  // ==========================================================================
  // What the surface asks
  // ==========================================================================

  /**
   * Whether THIS house is having its replies read, and what the cursor says.
   *
   * Used by the sender route so the composer's sender line can state where the
   * conversation actually lives. Returns `unknown` on a failed read rather than
   * `false`: "this house is not read" and "we could not find out" are different
   * sentences, and printing the second as the first is ADR 0051 clause 3.
   */
  async statusFor(restaurantId: string): Promise<{
    granted: boolean | "unknown";
    enabled: boolean;
    grantOwnerUserId: string | null;
    startedAt: string | null;
    lastReadAt: string | null;
    lastError: string | null;
  }> {
    const enabled = await this.isEnabled(restaurantId);
    const { data, error } = await this.db.client
      .from("integration_oauth_connections")
      .select("id, user_id, scopes")
      .eq("restaurant_id", restaurantId)
      .eq("integration_id", GMAIL_READ_INTEGRATION_ID)
      .is("revoked_at", null);

    if (error) {
      return {
        granted: "unknown",
        enabled,
        grantOwnerUserId: null,
        startedAt: null,
        lastReadAt: null,
        lastError: `The reading grants could not be read (${error.message}).`,
      };
    }

    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    const withRead = rows.find((r) =>
      (Array.isArray(r.scopes) ? (r.scopes as string[]) : []).includes(
        GMAIL_READ_SCOPE,
      ),
    );
    if (!withRead) {
      return {
        granted: false,
        enabled,
        grantOwnerUserId: null,
        startedAt: null,
        lastReadAt: null,
        lastError: null,
      };
    }

    const { data: cursor, error: cursorError } = await this.db.client
      .from("house_inbox_cursors")
      .select("started_at, last_read_at, last_error")
      .eq("connection_id", String(withRead.id))
      .maybeSingle();

    // supabase-js RESOLVES with { data, error }; a discarded error here would
    // make "this grant has never been read" and "the cursor table could not be
    // read" the same three nulls. `granted` stays true — the grant WAS read —
    // and the failure is stated on the line the surface prints.
    if (cursorError) {
      this.logger.error(
        `House inbox: the cursor could not be read for ${withRead.id} — ${cursorError.message}`,
      );
      return {
        granted: true,
        enabled,
        grantOwnerUserId: String(withRead.user_id),
        startedAt: null,
        lastReadAt: null,
        lastError: `Where this grant has been read to could not be read (${cursorError.message}), so "never read" below is unknown rather than an answer.`,
      };
    }

    const c = (cursor ?? {}) as Record<string, unknown>;

    return {
      granted: true,
      enabled,
      grantOwnerUserId: String(withRead.user_id),
      startedAt: (c.started_at as string | null) ?? null,
      lastReadAt: (c.last_read_at as string | null) ?? null,
      lastError: (c.last_error as string | null) ?? null,
    };
  }
}
