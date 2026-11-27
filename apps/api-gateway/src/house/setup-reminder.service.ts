import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { DatabaseService } from "../database/database.service";
import { GmailService } from "../communications/gmail.service";
import {
  digestSendArmed,
  hashUnsubscribeToken,
  isWellFormedUnsubscribeToken,
  newUnsubscribeToken,
} from "../analytics/digest/digest-schedule";
import { buildSetupReminderLetter } from "./setup-reminder.template";

/**
 * One "your house is waiting" letter, 24 h after a house opened and stopped
 * before its menu (DD-r108-57): owner by an active access row, verified
 * address, no menu, no opt-out. Never retried. Off until
 * SETUP_REMINDER_SEND_ENABLED is set, as the digest is.
 */
export const SETUP_REMINDER_SEND_FLAG = "SETUP_REMINDER_SEND_ENABLED";
export const SETUP_REMINDER_UNSUBSCRIBE_PATH =
  "/api/v1/house/setup-reminder/unsubscribe/";
const CRON = "23 * * * *";
const JOB = "setup-reminder";
const HOUR_MS = 3_600_000;
export const SETUP_REMINDER_AFTER_MS = 24 * HOUR_MS;
export const SETUP_REMINDER_UNTIL_MS = 72 * HOUR_MS;
/** Under the 1000-row cap; leftovers wait an hour (48 sweeps per window). */
export const SETUP_REMINDER_BATCH = 200;

export interface SetupReminderTally {
  candidates: number;
  sent: number;
  failed: number;
  skipped: number;
  lostClaim: number;
}

export type SetupReminderLinkState =
  | { kind: "malformed" }
  | { kind: "unknown" }
  | { kind: "active"; houseName: string }
  | { kind: "stopped"; houseName: string };

interface Row {
  id: string;
  user_id: string;
  restaurant_id: string;
}

const TABLE = "user_onboarding_progress";

@Injectable()
export class SetupReminderService {
  private readonly logger = new Logger(SetupReminderService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly gmail: GmailService,
    private readonly configService: ConfigService,
  ) {}

  private setting(name: string): string | null {
    const raw = this.configService.get<string>(name) ?? process.env[name];
    return raw && raw.trim() ? raw.trim() : null;
  }

  @Cron(CRON, { name: JOB })
  async sweep(): Promise<void> {
    if (!digestSendArmed(this.setting(SETUP_REMINDER_SEND_FLAG))) {
      this.logger.log(
        `${JOB} skipped — ${SETUP_REMINDER_SEND_FLAG} is not set.`,
      );
      return;
    }
    try {
      await this.runOnce(new Date());
    } catch (err) {
      this.logger.error(
        `SETUP_REMINDER_SWEEP_FAILED — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** One sweep with a fixed clock. Public so a spec can drive it. */
  async runOnce(now: Date): Promise<SetupReminderTally> {
    const tally: SetupReminderTally = {
      candidates: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      lostClaim: 0,
    };
    const apiOrigin = this.setting("API_PUBLIC_URL")?.replace(/\/+$/, "");
    const appOrigin = this.setting("FRONTEND_URL")?.split(",")[0].trim().replace(/\/+$/, "");
    if (!apiOrigin || !appOrigin) {
      this.logger.warn(
        "SETUP_REMINDER_NO_ORIGIN — API_PUBLIC_URL or FRONTEND_URL unset; nothing claimed or sent.",
      );
      return tally;
    }

    const client = this.databaseService.getClient();
    const { data: due, error } = await client
      .from(TABLE)
      .select("id, user_id, restaurant_id")
      .eq("menu_uploaded", false)
      .eq("setup_reminder_opt_out", false)
      .is("setup_reminder_sent_at", null)
      .lte("created_at", new Date(now.getTime() - SETUP_REMINDER_AFTER_MS).toISOString())
      .gt("created_at", new Date(now.getTime() - SETUP_REMINDER_UNTIL_MS).toISOString())
      .order("created_at", { ascending: true })
      .limit(SETUP_REMINDER_BATCH);
    if (error) throw new Error(`${TABLE} could not be read: ${error.message}`);
    const rows = (due ?? []) as Row[];
    tally.candidates = rows.length;
    if (rows.length === 0) return tally;

    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const houseIds = [...new Set(rows.map((r) => r.restaurant_id))];
    const [people, access, houses] = await Promise.all([
      client.from("users").select("user_id, email, name, email_verified").in("user_id", userIds),
      client
        .from("user_restaurant_access")
        .select("user_id, restaurant_id, role, is_active, valid_until")
        .in("user_id", userIds),
      client.from("restaurants").select("id, name").in("id", houseIds),
    ]);
    const failed = [people, access, houses].find((r) => r.error);
    if (failed?.error) throw new Error(`a recipient read failed: ${failed.error.message}`);
    const person = new Map(
      ((people.data ?? []) as Array<Record<string, any>>).map((p) => [p.user_id, p]),
    );
    const owns = new Set(
      ((access.data ?? []) as Array<Record<string, any>>)
        .filter(
          (a) =>
            a.role === "owner" &&
            a.is_active === true &&
            (!a.valid_until || Date.parse(a.valid_until) > now.getTime()),
        )
        .map((a) => `${a.user_id}:${a.restaurant_id}`),
    );
    const houseName = new Map(
      ((houses.data ?? []) as Array<Record<string, any>>).map((h) => [h.id, String(h.name ?? "")]),
    );

    for (const row of rows) {
      const p = person.get(row.user_id);
      const email = typeof p?.email === "string" ? p.email.trim() : "";
      if (!owns.has(`${row.user_id}:${row.restaurant_id}`) || p?.email_verified !== true || !email) {
        tally.skipped++;
        continue;
      }

      // One statement claims and stamps: only one instance gets the row back.
      const token = newUnsubscribeToken();
      const claim = await client
        .from(TABLE)
        .update({
          setup_reminder_sent_at: now.toISOString(),
          setup_reminder_token_hash: hashUnsubscribeToken(token),
        })
        .eq("id", row.id)
        .is("setup_reminder_sent_at", null)
        .eq("menu_uploaded", false)
        .eq("setup_reminder_opt_out", false)
        .select("id");
      if (claim.error) {
        this.logger.error(
          `SETUP_REMINDER_CLAIM_FAILED row=${row.id} — ${claim.error.message}; not sent.`,
        );
        tally.failed++;
        continue;
      }
      if (!claim.data || claim.data.length === 0) {
        tally.lostClaim++;
        continue;
      }

      const unsubscribeUrl = `${apiOrigin}${SETUP_REMINDER_UNSUBSCRIBE_PATH}${token}`;
      let outcome: { success: boolean; error?: string };
      try {
        const letter = buildSetupReminderLetter({
          houseName: houseName.get(row.restaurant_id) ?? "",
          ownerName: typeof p?.name === "string" ? p.name : null,
          getStartedUrl: `${appOrigin}/get-started`,
          unsubscribeUrl,
        });
        outcome = await this.gmail.sendEmail({
          to: [email],
          subject: letter.subject,
          html: letter.html,
          text: letter.text,
          fromName: "Mudavym",
          listUnsubscribe: { url: unsubscribeUrl, oneClick: true },
        });
      } catch (err) {
        outcome = { success: false, error: err instanceof Error ? err.message : String(err) };
      }
      if (outcome.success) tally.sent++;
      else {
        tally.failed++;
        this.logger.error(
          `SETUP_REMINDER_SEND_FAILED row=${row.id} — ${(outcome.error ?? "").trim() || "no reason"}. Not retried.`,
        );
      }
    }
    this.logger.log(`SETUP_REMINDER_SWEEP ${JSON.stringify(tally)}`);
    return tally;
  }

  /** GET: changes nothing (scanners follow links). */
  async readLink(token: string): Promise<SetupReminderLinkState> {
    const row = await this.rowFor(token);
    if (row === "malformed") return { kind: "malformed" };
    if (!row) return { kind: "unknown" };
    return {
      kind: row.setup_reminder_opt_out ? "stopped" : "active",
      houseName: await this.nameOf(row.restaurant_id),
    };
  }

  /** POST: this row's opt-out, nothing else. */
  async stopByLink(token: string): Promise<SetupReminderLinkState> {
    const row = await this.rowFor(token);
    if (row === "malformed") return { kind: "malformed" };
    if (!row) return { kind: "unknown" };
    const { error } = await this.databaseService
      .getClient()
      .from(TABLE)
      .update({ setup_reminder_opt_out: true })
      .eq("id", row.id);
    if (error) throw new Error(`${TABLE} opt-out could not be written: ${error.message}`);
    return { kind: "stopped", houseName: await this.nameOf(row.restaurant_id) };
  }

  private async rowFor(token: string): Promise<any> {
    if (!isWellFormedUnsubscribeToken(token)) return "malformed";
    const { data, error } = await this.databaseService
      .getClient()
      .from(TABLE)
      .select("id, restaurant_id, setup_reminder_opt_out")
      .eq("setup_reminder_token_hash", hashUnsubscribeToken(token))
      .limit(1);
    if (error) throw new Error(`${TABLE} could not be read: ${error.message}`);
    return ((data ?? [])[0] as any) ?? null;
  }

  private async nameOf(restaurantId: string): Promise<string> {
    const { data } = await this.databaseService
      .getClient()
      .from("restaurants")
      .select("name")
      .eq("id", restaurantId)
      .limit(1);
    const name = (data ?? [])[0]?.name;
    return typeof name === "string" && name.trim() ? name.trim() : "your house";
  }
}
