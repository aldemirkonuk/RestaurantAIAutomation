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
import { TeamService } from "./team.service";
import { CreateTeamNoteDto } from "./dto/team.dto";

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

    const channels = ["inbox", "push"];
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
    let delivered = { inbox: false, push: 0 };
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
      this.logger.warn(`note ${note.id} not delivered to the inbox: ${e?.message}`);
    }
    if (userIds.length) {
      try {
        await this.push.sendToUsers(userIds, {
          title: "A note from your manager",
          body: dto.body,
          priority: "high",
          data: { type: "team_note", actionUrl: "/team" },
        });
        delivered = { ...delivered, push: userIds.length };
      } catch (e: any) {
        this.logger.warn(`note ${note.id} not pushed: ${e?.message}`);
      }
    }

    return {
      id: note.id,
      addressed: targets.length,
      // Reported, not assumed: the note is on the record either way, and the
      // strip must be able to say "written, but not delivered".
      delivered,
      channels,
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

    // `opened_at IS NULL` in the WHERE clause is what makes "the first open"
    // the recorded one; a second open must not move the timestamp forward and
    // quietly turn a day-old read into a fresh one.
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
    // No row can mean two things and they are not the same: already open, or
    // never addressed to this person. Only the first is a success.
    return { recorded: Boolean(data), alreadyOpen: !data };
  }
}
