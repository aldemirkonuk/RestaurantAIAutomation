import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import type { gmail_v1 } from "googleapis";
import { GmailWatchService } from "./gmail-watch.service";
import { GmailService } from "./gmail.service";
import {
  extractEmailContent,
  fromHeader,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_B64_LEN,
} from "./gmail-mime";
import { receivingHouse } from "./shared-mailbox-house";
import { ingressAuthenticationResults } from "./sender-authentication";
import { parseSender } from "./inbound-headers";
import { DatabaseService } from "../database/database.service";
import { MailIntakeService } from "../common/orchestrator/mail-intake.service";

/** What one read of the shared mailbox did. */
export interface SharedMailboxRead {
  status:
    | "processed"
    | "initialized"
    | "resynced"
    | "stopped"
    | "not_configured"
    | "busy";
  /** Messages fetched from Gmail. */
  messages: number;
  /** Letters recorded in `mail_intake` (own outbound mail is not one). */
  recorded: number;
  /** Set when the read stopped partway; the cursor stands before it. */
  error?: string;
}

/** A resync never reaches further back than this (Gmail keeps ~7 days of history). */
const MAX_RESYNC_MINUTES = 7 * 24 * 60;

/**
 * Follow-up reads one call may run for pushes that arrived while it was
 * reading. Each round needs a new push during the previous one; the cap only
 * stops a push storm from holding one caller forever (the next push reads).
 */
const MAX_FOLLOW_UP_READS = 5;

/**
 * The shared mailbox door (gap G2, 2026-11-11). One reader for the Gmail
 * push, the poll tick and the operator's resync, so the three cannot drift.
 *
 * A letter is safe once `MailIntakeService.record` has written it; the
 * historyId cursor moves only past letters that were. A read that stops
 * partway leaves the cursor at the last history record whose every letter is
 * recorded, so the next push or tick reads the rest again (a repeat is one
 * intake row, never a second letter).
 *
 * The session's call on the three doors that wake it:
 *  - push: as before, authenticated by `GmailPushAuthService`;
 *  - poll: every five minutes, reads only when no read has happened for ten
 *    (a lost Pub/Sub subscription used to mean silence until someone noticed);
 *  - resync: a 404 from `history.list` (Gmail dropped the cursor) reads the
 *    INBOX by date from the last FINISHED read (a failed read does not move
 *    `last_read_at`, migration 20270705100000), capped at seven days, instead
 *    of re-arming the watch and skipping the gap; a platform operator can ask
 *    for the same by minutes. Rejected: a full mailbox walk (unbounded quota),
 *    and leaving the gap to the operator (nobody is told one exists). A
 *    window too large to list (`inboxIdsSince` truncated) stops the resync
 *    visibly with the cursor in place; it never reads part of the window and
 *    then jumps to the present.
 *
 * A push that arrives while a read is running is not dropped: `read` answers
 * it `busy` and the running read goes round once more, so the letter that
 * push announced is read now, not at the next push or a poll ten minutes on.
 * Rejected: answering the push 503 so Pub/Sub redelivers (its retry backoff
 * slows the whole subscription, and the poll and resync callers would still
 * drop the read).
 */
@Injectable()
export class SharedMailboxReaderService {
  private readonly logger = new Logger(SharedMailboxReaderService.name);
  /** One read at a time per instance; a second instance is safe by the cursor RPC. */
  private reading = false;
  /** A read was asked for while one was running; the running one reads again. */
  private readOwed = false;

  constructor(
    private readonly watch: GmailWatchService,
    private readonly intake: MailIntakeService,
    private readonly gmail: GmailService,
    private readonly config: ConfigService,
    private readonly database: DatabaseService,
  ) {}

  /**
   * Read everything added since the cursor. A call made while a read is
   * running answers `busy` and owes a read: the running call reads again
   * before it returns, so nothing the second caller announced waits.
   */
  async read(pushedHistoryId?: string | null): Promise<SharedMailboxRead> {
    if (!this.watch.isReady()) {
      return { status: "not_configured", messages: 0, recorded: 0 };
    }
    if (this.reading) {
      this.readOwed = true;
      return { status: "busy", messages: 0, recorded: 0 };
    }
    this.reading = true;
    try {
      let messages = 0;
      let recorded = 0;
      let run: SharedMailboxRead;
      let round = 0;
      let pushed = pushedHistoryId;
      do {
        this.readOwed = false;
        run = await this.readOnce(pushed);
        messages += run.messages;
        recorded += run.recorded;
        pushed = null; // a follow-up reads from the cursor
        round++;
      } while (
        this.readOwed &&
        round <= MAX_FOLLOW_UP_READS &&
        (run.status === "processed" || run.status === "resynced")
      );
      return { ...run, messages, recorded };
    } finally {
      this.reading = false;
    }
  }

  /** One pass from the cursor; `read` owns the lock and the follow-ups. */
  private async readOnce(
    pushedHistoryId?: string | null,
  ): Promise<SharedMailboxRead> {
    const { cursor, lastReadAt } = await this.watch.readCursor();
    if (!cursor) {
      // Never read before: start from now. Nothing older is reached for.
      const seed = pushedHistoryId || (await this.watch.currentHistoryId());
      await this.watch.advanceCursor(seed, false);
      return { status: "initialized", messages: 0, recorded: 0 };
    }
    const since = await this.watch.historySince(cursor);
    if (since.expired) {
      return await this.resyncFrom(
        lastReadAt ? Date.parse(lastReadAt) : NaN,
      );
    }
    let messages = 0;
    let recorded = 0;
    let reached: string | null = null;
    for (const entry of since.entries) {
      try {
        for (const id of entry.messageIds) {
          const msg = await this.watch.fetchMessage(id);
          if (!msg) continue; // gone from the mailbox
          messages++;
          if (await this.recordOne(msg)) recorded++;
        }
      } catch (err: any) {
        const why = err?.message ?? String(err);
        this.logger.error(
          `shared mailbox: read stopped at history ${entry.historyId} (${why}); the cursor stays before it`,
        );
        await this.saveCursor(reached, recorded > 0, why);
        return { status: "stopped", messages, recorded, error: why };
      }
      reached = entry.historyId;
    }
    await this.saveCursor(since.latest ?? reached, recorded > 0, null);
    return { status: "processed", messages, recorded };
  }

  /**
   * Read the INBOX by date, for an operator who knows a stretch was missed.
   * Every letter found is recorded (a repeat is one row); the cursor then
   * moves to the mailbox's present.
   */
  async resync(minutesBack: number): Promise<SharedMailboxRead> {
    if (!this.watch.isReady()) {
      return { status: "not_configured", messages: 0, recorded: 0 };
    }
    const minutes = Math.min(
      Math.max(1, Math.floor(Number(minutesBack) || 60)),
      MAX_RESYNC_MINUTES,
    );
    return this.resyncFrom(Date.now() - minutes * 60_000);
  }

  /** The poll: read when nothing has read the mailbox for ten minutes. */
  @Cron("*/5 * * * *", { name: "shared-mailbox-poll" })
  async poll(): Promise<SharedMailboxRead | null> {
    if (!this.watch.isReady()) return null;
    try {
      const { lastReadAt } = await this.watch.readCursor();
      const quietFor = lastReadAt ? Date.now() - Date.parse(lastReadAt) : Infinity;
      if (quietFor < 10 * 60_000) return null;
      const run = await this.read();
      if (run.recorded > 0) {
        this.logger.warn(
          `shared mailbox poll: ${run.recorded} letter${run.recorded === 1 ? "" : "s"} found that no push announced`,
        );
      }
      return run;
    } catch (err: any) {
      this.logger.error(`shared mailbox poll failed: ${err?.message ?? err}`);
      return null;
    }
  }

  /**
   * The event every door publishes for one Gmail message, or null for the
   * house's own outbound mail. Own mail is the parsed sender address, never
   * a substring of the From (a display name naming our address used to make
   * a stranger's letter vanish as "our own").
   */
  async toInboundEvent(
    msg: gmail_v1.Schema$Message,
  ): Promise<Record<string, unknown> | null> {
    const headers = msg.payload?.headers || [];
    const header = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name)?.value || "";
    const from = fromHeader(headers);
    const own = this.ownAddress();
    const sender = parseSender(from)?.address?.toLowerCase();
    if (own && sender && sender === own) return null;

    const { text, attachmentRefs } = extractEmailContent(msg.payload as any);
    let body = text;
    if (!body && msg.payload?.body?.data) {
      body = Buffer.from(msg.payload.body.data, "base64url").toString("utf-8");
    }
    const attachments = attachmentRefs.length
      ? await this.collectAttachments(msg.id!, attachmentRefs)
      : [];
    if (attachments.length) {
      body =
        `${body}\n\n[Attachments: ${attachments.map((a) => a.filename).join(", ")}]`.trim();
    }
    // The house this letter was written to (QA round 25): the shared mailbox
    // belongs to no house, so the event carries the one `receivingHouse`
    // finds, or null, and a consumer that gets null attributes nothing.
    const house = await receivingHouse(this.database.supabase, {
      from,
      gmailThreadId: msg.threadId,
    });
    return {
      restaurant_id: house.restaurantId,
      house_resolution: house.how,
      gmail_message_id: msg.id,
      gmail_thread_id: msg.threadId,
      from,
      subject: header("subject"),
      body,
      attachments,
      message_id_header: header("message-id"),
      in_reply_to: header("in-reply-to"),
      references: header("references"),
      received_at: new Date().toISOString(),
      headers: Object.fromEntries(
        headers
          .filter((h) => h.name && h.value)
          .map((h) => [h.name!.toLowerCase(), h.value]),
      ),
      // Gmail's own verdict, from the ordered list: the map above keeps the
      // sender's last line (`sender-authentication.ts`).
      ingress_authentication_results: ingressAuthenticationResults(headers),
    };
  }

  /** Record one message; true when it is a letter (not our own mail). */
  private async recordOne(msg: gmail_v1.Schema$Message): Promise<boolean> {
    const event = await this.toInboundEvent(msg);
    if (!event) return false;
    await this.intake.recordAndPublish({
      door: "shared_mailbox",
      providerKey: String(msg.id),
      restaurantId: (event.restaurant_id as string | null) ?? null,
      event,
    });
    return true;
  }

  private async resyncFrom(fromMs: number): Promise<SharedMailboxRead> {
    const floor = Date.now() - MAX_RESYNC_MINUTES * 60_000;
    // Five minutes of overlap: Gmail's `after:` is second-granular and a
    // letter on the boundary must not fall between two reads.
    const after = Math.max(
      Number.isFinite(fromMs) ? fromMs - 5 * 60_000 : floor,
      floor,
    );
    let messages = 0;
    let recorded = 0;
    try {
      const present = await this.watch.currentHistoryId();
      const { ids, truncated } = await this.watch.inboxIdsSince(after / 1000);
      if (truncated) {
        // More letters in the window than one resync lists. Reading part of
        // it and moving to the present would skip the rest in silence; the
        // cursor and the resync floor stay, and the error is the door's.
        throw new Error(
          `the resync window holds more than ${ids.length} letters; nothing was read and the cursor did not move`,
        );
      }
      for (const id of ids) {
        const msg = await this.watch.fetchMessage(id);
        if (!msg) continue;
        messages++;
        if (await this.recordOne(msg)) recorded++;
      }
      await this.saveCursor(present, recorded > 0, null);
      return { status: "resynced", messages, recorded };
    } catch (err: any) {
      const why = err?.message ?? String(err);
      this.logger.error(`shared mailbox resync stopped (${why}); the cursor did not move`);
      await this.saveCursor(null, recorded > 0, why).catch(() => undefined);
      return { status: "stopped", messages, recorded, error: why };
    }
  }

  private async saveCursor(
    historyId: string | null,
    stored: boolean,
    error: string | null,
  ): Promise<void> {
    await this.watch.advanceCursor(historyId, stored, error);
  }

  private ownAddress(): string {
    return (
      this.gmail.getSenderEmail() ||
      this.config.get<string>("GMAIL_SENDER_EMAIL") ||
      ""
    )
      .trim()
      .toLowerCase();
  }

  /**
   * Image/PDF attachment bytes, base64, for the vision model. The caps are
   * shared with the house-inbox reader (`gmail-mime.ts`) so the same vendor
   * receipt is admitted or dropped identically whichever mailbox it reached.
   */
  private async collectAttachments(
    messageId: string,
    refs: Array<{ filename: string; mimeType: string; attachmentId: string }>,
  ): Promise<Array<{ filename: string; mime_type: string; data: string }>> {
    const out: Array<{ filename: string; mime_type: string; data: string }> = [];
    for (const ref of refs.slice(0, MAX_ATTACHMENTS_PER_MESSAGE)) {
      const b64url = await this.watch.getAttachment(messageId, ref.attachmentId);
      if (!b64url) continue;
      if (b64url.length > MAX_ATTACHMENT_B64_LEN) {
        this.logger.warn(
          `Skipping oversized attachment ${ref.filename} (${b64url.length} b64 chars)`,
        );
        continue;
      }
      // Gmail returns base64url; the Anthropic API expects standard base64.
      out.push({
        filename: ref.filename,
        mime_type: ref.mimeType,
        data: b64url.replace(/-/g, "+").replace(/_/g, "/"),
      });
    }
    return out;
  }
}
