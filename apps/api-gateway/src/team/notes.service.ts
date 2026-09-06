import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ExpoPushService } from "../push/expo-push.service";
import { TextSenderService } from "../communications/text/text-sender.service";
import { TeamService } from "./team.service";
import { CreateTeamNoteDto } from "./dto/team.dto";

/**
 * One receipt: what happened to ONE person on ONE channel.
 *
 * Written for every (recipient, channel) pair the note considered, INCLUDING
 * the ones nothing was attempted on. The absence of a row is therefore always a
 * defect and never a silent success — which is the whole difference between
 * this and the `notified` count ADR 0121 measured returning eleven against zero
 * devices.
 */
type DeliveryState =
  | "delivered"
  | "accepted_by_service"
  | "no_device_registered"
  | "no_consent"
  | "no_sender"
  | "declined"
  | "read_failed"
  | "failed";

interface DeliveryReceipt {
  note_id: string;
  member_id: string;
  channel: "inbox" | "push" | "whatsapp" | "sms";
  state: DeliveryState;
  detail: string;
}

/**
 * A crew note about one week, kept as a record.
 *
 * WHY THIS IS NOT `broadcast`. A broadcast is a send: it reaches people and
 * leaves nothing a manager can read back, which is why `/team`'s week strip
 * could only ever report what THAT PAGE had just done and had to say so in
 * words. A note is a record — it has an author, an audience captured at send
 * time, and a per-person `opened_at` — and it happens to also be delivered.
 * The delivery here is deliberately the two channels the product owns: the
 * in-app inbox and push. No email, ever (see `team.controller.ts`'s broadcast
 * note for the mailbox this house does not have).
 *
 * WHAT `opened_at` MEANS. NULL is UNOPENED, and it is the only thing NULL is
 * allowed to mean here: the column has no default and is nullable by
 * assertion in the migration, so "nobody has read it" and "we did not measure"
 * cannot render identically. It is deliberately NOT `schedule_receipts`, which
 * records opening the SCHEDULE — a different fact about a different object.
 */
@Injectable()
export class NotesService {
  private readonly logger = new Logger(NotesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly team: TeamService,
    private readonly notifications: NotificationsService,
    private readonly push: ExpoPushService,
    /**
     * The crew text (founder, 2026-09-05: *"a crew text exists and build it
     * next"*; ADR 0121 founder question 1, answered).
     *
     * It goes through the HOUSE's sender or it does not go: this service never
     * reaches `SmsService`, whose one `PLIVO_PHONE_NUMBER` is shared by every
     * restaurant on the deployment. A crew member receiving a text from an
     * unknown shared number is the same fault as a crew member replying into
     * the vendor thread, which is why the email leg was removed on 2026-09-04.
     */
    private readonly text: TextSenderService,
  ) {}

  private get sb() {
    return this.db.supabase;
  }

  /**
   * The week's notes, newest first, each with the people it was addressed to
   * and whether they have opened it.
   *
   * A staff caller sees only the notes ADDRESSED TO THEM. The table carries a
   * manager's free text about a week, and every member being able to read every
   * note is the same shape as the time-off leak ADR 0088 closed.
   */
  async list(
    userId: string,
    restaurantId: string,
    weekStart: string,
  ): Promise<any> {
    const { role } = await this.team.assertAccess(userId, restaurantId);

    const { data: notes, error } = await this.sb
      .from("team_notes")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("week_start", weekStart)
      .order("created_at", { ascending: false });
    if (error) {
      this.logger.error(`list notes failed: ${error.message}`);
      // A failed read is never an empty week. `readable: false` renders as
      // words on the strip; returning [] would have said "nothing was said".
      return { weekStart, notes: [], readable: false, reason: error.message };
    }

    const ids = (notes ?? []).map((n: any) => n.id);
    let recipients: any[] = [];
    if (ids.length) {
      const { data: rows, error: rErr } = await this.sb
        .from("team_note_recipients")
        .select("*")
        .in("note_id", ids);
      if (rErr) {
        this.logger.error(`list note recipients failed: ${rErr.message}`);
        return { weekStart, notes: [], readable: false, reason: rErr.message };
      }
      recipients = rows ?? [];
    }

    /**
     * The receipts (ADR 0121 P0). Read as its own query rather than joined so a
     * failure here is legible: `receiptsReadable: false` says the delivery
     * record could not be read, which is a different sentence from a note that
     * has no receipts because it predates them.
     */
    let deliveries: any[] = [];
    let receiptsReadable = true;
    let receiptsReason: string | null = null;
    if (ids.length) {
      const { data: dRows, error: dErr } = await this.sb
        .from("team_note_deliveries")
        .select("note_id, member_id, channel, state, detail")
        .in("note_id", ids);
      if (dErr) {
        this.logger.error(`list note deliveries failed: ${dErr.message}`);
        receiptsReadable = false;
        receiptsReason = dErr.message;
      } else {
        deliveries = dRows ?? [];
      }
    }

    // Names come from the roster, which resolves a linked account's name — the
    // stored `display_name` is the gateway's own placeholder on any row
    // backfilled before 2026-09-04 and is not a name.
    const roster = await this.team.listMembers(userId, restaurantId).catch(() => null);
    const nameOf = new Map<string, string>();
    for (const m of roster ?? []) {
      nameOf.set(m.id, m.linkedUser?.name?.trim() || m.display_name);
    }

    const mine = role === "staff" ? await this.team.ownMemberId(userId, restaurantId) : null;

    const shaped = (notes ?? [])
      .map((n: any) => {
        const to = recipients.filter((r) => r.note_id === n.id);
        return {
          id: n.id,
          weekStart: n.week_start,
          scheduleId: n.schedule_id,
          body: n.body,
          channels: n.channels ?? [],
          createdAt: n.created_at,
          authorUserId: n.author_user_id,
          recipients: to.map((r) => ({
            memberId: r.member_id,
            // `null` when the roster could not be read — not "unknown person".
            name: nameOf.get(r.member_id) ?? null,
            openedAt: r.opened_at ?? null,
          })),
          openedCount: to.filter((r) => r.opened_at).length,
          addressedCount: to.length,
          // What actually happened, per person per channel. `null` when the
          // receipt read failed — never [], which would say "nothing was
          // attempted".
          deliveries: receiptsReadable
            ? deliveries
                .filter((d) => d.note_id === n.id)
                .map((d) => ({
                  memberId: d.member_id,
                  name: nameOf.get(d.member_id) ?? null,
                  channel: d.channel,
                  state: d.state,
                  detail: d.detail,
                }))
            : null,
        };
      })
      .filter((n) => (mine ? n.recipients.some((r: any) => r.memberId === mine) : true));

    return {
      weekStart,
      notes: shaped,
      readable: true,
      reason: null,
      // The roster read is what turns a member id into a name; when it fails
      // the names are null and the caller must say so rather than print ids.
      namesReadable: roster !== null,
      // Whether the DELIVERY record could be read. A page that cannot tell
      // "no receipts" from "we could not read the receipts" would print the
      // second as the first, which is the fault this whole table closes.
      receiptsReadable,
      receiptsReason,
    };
  }

  /** Write the note, address it, and deliver it to the inbox and the phone. */
  async create(
    userId: string,
    restaurantId: string,
    dto: CreateTeamNoteDto,
  ): Promise<any> {
    await this.team.assertAccess(userId, restaurantId, "manager");

    const roster = await this.team.listMembers(userId, restaurantId);
    const targets = roster.filter((m: any) => dto.memberIds.includes(m.id));
    if (targets.length === 0) {
      throw new ForbiddenException(
        "None of the named members are on this restaurant's roster, so the note would reach nobody and was not written.",
      );
    }

    /**
     * THE CREW TEXT IS A CHANNEL ONLY WHEN THIS HOUSE HAS A SENDER.
     *
     * Resolved BEFORE the note is written, so `team_notes.channels` records
     * what was actually considered rather than what somebody hoped for. A house
     * with no connected sender lists `inbox` and `push` exactly as before, and
     * the receipts below still carry a `no_sender` row per person — the note
     * says what it could not do, instead of leaving the text out of the record
     * and letting its absence read as "nobody wanted one".
     */
    const senders = await this.text.readout(restaurantId);
    const textChannels: Array<"whatsapp" | "sms"> = [];
    if (senders.readable) {
      if (senders.whatsapp?.state === "connected") textChannels.push("whatsapp");
      if (senders.sms?.state === "connected") textChannels.push("sms");
    }
    const channels = ["inbox", "push", ...textChannels];
    const { data: note, error } = await this.sb
      .from("team_notes")
      .insert({
        restaurant_id: restaurantId,
        week_start: dto.weekStart,
        schedule_id: dto.scheduleId ?? null,
        body: dto.body,
        author_user_id: userId,
        channels,
      })
      .select()
      .single();
    if (error || !note) {
      this.logger.error(`create note failed: ${error?.message}`);
      throw new InternalServerErrorException(
        "The note was not written, so nothing was sent.",
      );
    }

    // Recipients BEFORE delivery: a note that reached people but recorded
    // nobody is worse than one that recorded people and failed to reach them,
    // because only the second is visible afterwards.
    const { error: rErr } = await this.sb.from("team_note_recipients").insert(
      targets.map((m: any) => ({ note_id: note.id, member_id: m.id })),
    );
    if (rErr) {
      this.logger.error(`create note recipients failed: ${rErr.message}`);
      throw new InternalServerErrorException(
        "The note was written but its recipients were not recorded, so who it was for is unknown. It was not sent.",
      );
    }

    const userIds = targets.map((m: any) => m.user_id).filter(Boolean);
    const receipts: DeliveryReceipt[] = [];
    const push = (
      member: any,
      channel: DeliveryReceipt["channel"],
      state: DeliveryState,
      detail: string,
    ) => {
      receipts.push({ note_id: note.id, member_id: member.id, channel, state, detail });
    };

    let delivered = { inbox: false, push: 0 };

    // ── inbox ────────────────────────────────────────────────────────────
    let inboxError: string | null = null;
    try {
      await this.notifications.persistForRestaurant(
        restaurantId,
        {
          type: "system",
          title: `A note about the week of ${dto.weekStart}`,
          message: dto.body,
          priority: "high",
          actionUrl: "/team",
          actionLabel: "Open Team",
        },
        { onlyUserIds: userIds },
      );
      delivered = { ...delivered, inbox: true };
    } catch (e: any) {
      inboxError = e?.message ?? "the inbox write threw without a message";
      this.logger.warn(`note ${note.id} not delivered to the inbox: ${inboxError}`);
    }
    for (const m of targets) {
      if (inboxError) {
        push(m, "inbox", "failed", `The in-app inbox write failed: ${inboxError}.`);
      } else if (!m.user_id) {
        // A roster entry with no linked account has no inbox to land in. This
        // is the case that used to vanish: `onlyUserIds` simply skipped them.
        push(
          m,
          "inbox",
          "no_device_registered",
          "This roster entry is not linked to an account, so there is no in-app inbox for it to land in.",
        );
      } else {
        push(m, "inbox", "delivered", "Written to this person's in-app inbox.");
      }
    }

    // ── push ─────────────────────────────────────────────────────────────
    // Per person, not per batch. `devicesByUser` returning null is a READ
    // FAILURE and every receipt says so; it is not eleven people without a
    // phone.
    const devices = await this.push.devicesByUser(userIds);
    let pushDetail = "";
    if (userIds.length && devices !== null && [...devices.values()].some((n) => n > 0)) {
      const outcome = await this.push.sendToUsers(userIds, {
        title: "A note from your manager",
        body: dto.body,
        priority: "high",
        data: { type: "team_note", actionUrl: "/team" },
      });
      pushDetail = outcome.detail;
      delivered = { ...delivered, push: outcome.tokens };
    }
    for (const m of targets) {
      if (devices === null) {
        push(
          m,
          "push",
          "read_failed",
          "The device list could not be read, so whether this person could have been reached is unknown. Nothing was sent.",
        );
      } else if (!m.user_id || (devices.get(m.user_id) ?? 0) === 0) {
        push(
          m,
          "push",
          "no_device_registered",
          "No mobile device is registered for this person, so there was nowhere to send a push.",
        );
      } else {
        push(
          m,
          "push",
          "accepted_by_service",
          pushDetail ||
            "Handed to the push service. That is not proof a handset showed it.",
        );
      }
    }

    // ── the crew text ────────────────────────────────────────────────────
    // Every person gets a receipt on every channel this house has a sender
    // for, plus a `no_sender` receipt when it has none — because "we did not
    // text you" and "we could not text anybody" are different facts and the
    // manager is owed the second one.
    const consents = await this.text.consentsFor(restaurantId, userIds);
    /**
     * When the house has NO connected sender, both channels are reported as
     * `no_sender` rather than one of them picked arbitrarily. Recording only
     * "sms: no_sender" would leave a reader unable to tell whether WhatsApp had
     * been considered at all, and picking a channel to stand in for both is a
     * guess written into a record.
     */
    const channelsToReport: Array<"whatsapp" | "sms"> =
      textChannels.length > 0 ? textChannels : ["whatsapp", "sms"];
    for (const m of targets) {
      for (const channel of channelsToReport) {
        if (!senders.readable) {
          push(
            m,
            channel,
            "read_failed",
            `This house's senders could not be read (${senders.reason}), so nothing was attempted. That is not the same as this house having no sender.`,
          );
          continue;
        }
        if (textChannels.length === 0) {
          push(
            m,
            channel,
            "no_sender",
            "This house has no connected text sender, so no text was sent to anybody. Connect one on /connections.",
          );
          continue;
        }
        if (consents === null) {
          push(
            m,
            channel,
            "read_failed",
            "This person's consent could not be read, so nothing was attempted. Texting without being able to read a consent is how a withdrawal gets ignored.",
          );
          continue;
        }
        if (!m.user_id || !consents.get(m.user_id)) {
          push(
            m,
            channel,
            "no_consent",
            "This person has not agreed to be texted by this house at a number. They can agree on /profile; nobody else can agree for them.",
          );
          continue;
        }
        const outcome = await this.text.send({
          restaurantId,
          recipientUserId: m.user_id,
          body: dto.body,
        });
        push(m, channel, outcome.sent ? "delivered" : "failed", outcome.words);
      }
    }

    /**
     * THE RECEIPTS ARE WRITTEN EVEN WHEN NOTHING WAS DELIVERED. A failure here
     * is reported and does not throw: the note itself is already on the record
     * and rolling it back would lose a manager's message to save a receipt.
     * What it must never do is fail silently, which is why the returned object
     * carries `receiptsWritten` rather than assuming.
     */
    let receiptsWritten = false;
    let receiptsError: string | null = null;
    if (receipts.length) {
      const { error: dErr } = await this.sb
        .from("team_note_deliveries")
        .insert(receipts);
      if (dErr) {
        receiptsError = dErr.message;
        this.logger.error(`note ${note.id} receipts not written: ${dErr.message}`);
      } else {
        receiptsWritten = true;
      }
    }

    /**
     * The tally, computed from the RECEIPTS rather than from the roster.
     *
     * This is the fix ADR 0121 P0 asked for, stated as arithmetic: a count of
     * people is not a count of deliveries, and every number below is derived
     * from a row that says what happened to one person on one channel.
     */
    const tally = (state: DeliveryState) =>
      receipts.filter((r) => r.state === state).length;

    return {
      id: note.id,
      addressed: targets.length,
      // Reported, not assumed: the note is on the record either way, and the
      // strip must be able to say "written, but not delivered".
      delivered,
      channels,
      receipts: {
        written: receiptsWritten,
        error: receiptsError,
        total: receipts.length,
        byState: {
          delivered: tally("delivered"),
          acceptedByService: tally("accepted_by_service"),
          noDeviceRegistered: tally("no_device_registered"),
          noConsent: tally("no_consent"),
          noSender: tally("no_sender"),
          readFailed: tally("read_failed"),
          failed: tally("failed"),
        },
        note:
          "One row per person per channel, written whether or not anything was delivered. `acceptedByService` is not a delivery, and `readFailed` is a fact about this system rather than about the crew.",
      },
    };
  }

  /** The caller has opened this note. Their own row only, and only once. */
  async markOpened(
    userId: string,
    restaurantId: string,
    noteId: string,
  ): Promise<any> {
    await this.team.assertAccess(userId, restaurantId);
    const memberId = await this.team.ownMemberId(userId, restaurantId);
    if (!memberId) {
      throw new NotFoundException(
        "Your account is not linked to a roster row here, so there is nothing to mark as read.",
      );
    }

    // ASK FIRST, because the UPDATE below cannot tell two different answers
    // apart. `.is("opened_at", null)` matching nothing means EITHER "already
    // open" OR "this note was never addressed to you", and the first is a
    // no-op while the second is a person reading a note meant for somebody
    // else. Reporting them with one shape was the whole shape this file's own
    // comment warned about, and it did it anyway.
    const { data: row, error: readError } = await this.sb
      .from("team_note_recipients")
      .select("id, opened_at")
      .eq("note_id", noteId)
      .eq("member_id", memberId)
      .maybeSingle();
    if (readError) {
      this.logger.error(`markOpened lookup failed: ${readError.message}`);
      throw new InternalServerErrorException(
        "The read was not recorded, so your manager will still see this as unopened.",
      );
    }
    if (!row) {
      throw new NotFoundException(
        "This note was not addressed to you, so there is nothing of yours to mark as read.",
      );
    }
    if (row.opened_at) return { recorded: false, alreadyOpen: true };

    // `opened_at IS NULL` stays in the WHERE clause even after the check
    // above: two tabs can arrive between the read and the write, and the first
    // open is the one that counts. A second must not move the timestamp
    // forward and quietly turn a day-old read into a fresh one.
    const { data, error } = await this.sb
      .from("team_note_recipients")
      .update({ opened_at: new Date().toISOString() })
      .eq("note_id", noteId)
      .eq("member_id", memberId)
      .is("opened_at", null)
      .select()
      .maybeSingle();
    if (error) {
      this.logger.error(`markOpened failed: ${error.message}`);
      throw new InternalServerErrorException(
        "The read was not recorded, so your manager will still see this as unopened.",
      );
    }
    // Now unambiguous: the row exists, so no match means the race above was
    // lost and somebody else's write already recorded the open.
    return { recorded: Boolean(data), alreadyOpen: !data };
  }
}
