import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

export interface ExpoPushPayload {
  title: string;
  body: string;
  data?: Record<string, any>;
  /** Expo priority; criticals ride "high" so Android delivers while dozing. */
  priority?: "default" | "high";
  badge?: number;
  channelId?: string;
  /**
   * The house this push is about (F-1183, a rehit of F-523). When set, the
   * title names the house and `data.restaurantId` is stamped last, so a tap on
   * a phone signed in to two houses switches to this one before it opens
   * `/team`. Never sent to Expo itself.
   */
  house?: string;
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK_SIZE = 100;

/**
 * What a push attempt actually did. Five outcomes, none of which is "sent".
 *
 * `accepted_by_service` is the strongest claim this service is entitled to
 * make: Expo took the ticket. Whether a handset displayed anything is not
 * observable from here, and calling it "delivered" would put a fabricated fact
 * in front of a manager.
 */
export type PushOutcomeKind =
  | "no_recipients"
  | "no_device_registered"
  | "read_failed"
  | "accepted_by_service"
  /**
   * F-1696: Expo answered and took none of it — a ticket error other than a
   * gone device (`MessageTooBig` for a payload over 4096 bytes, a rate
   * limit), or the request itself refused. It used to be reported as
   * `accepted_by_service`.
   */
  | "refused_by_service";

export interface PushOutcome {
  outcome: PushOutcomeKind;
  /** Registered devices the payload was handed to. 0 for every other outcome. */
  tokens: number;
  /** The sentence a surface prints. Never a bare code. */
  detail: string;
}

/**
 * Sends push notifications to the mobile app via Expo's push service.
 * Tokens live in mobile_devices; Expo handles the APNs/FCM fan-out so no
 * platform credentials are needed here. Fails soft everywhere: a push that
 * cannot be delivered must never break the calling flow.
 */
@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async registerDevice(params: {
    userId: string;
    restaurantId?: string | null;
    expoPushToken: string;
    platform?: string;
    appVersion?: string;
  }): Promise<void> {
    const { error } = await this.databaseService.supabase
      .from("mobile_devices")
      .upsert(
        {
          user_id: params.userId,
          restaurant_id: params.restaurantId ?? null,
          expo_push_token: params.expoPushToken,
          platform: params.platform ?? "unknown",
          app_version: params.appVersion ?? null,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "expo_push_token" },
      );
    if (error) {
      this.logger.warn(`registerDevice failed: ${error.message}`);
      throw new Error(error.message);
    }
  }

  /**
   * Only the caller's own device row: the token alone named any person's
   * device (`.planning/07-reference/GATEWAY-EDIT-BY-ID-SCOPE-2026-09-29.md`).
   * `registerDevice` still hands a token's row to whoever registers it (a
   * shared device moving to its next person), so this narrows the DELETE; it
   * does not by itself stop a token holder who registers first.
   */
  async unregisterDevice(userId: string, expoPushToken: string): Promise<void> {
    const { error } = await this.databaseService.supabase
      .from("mobile_devices")
      .delete()
      .eq("expo_push_token", expoPushToken)
      .eq("user_id", userId);
    if (error) {
      this.logger.warn(`unregisterDevice failed: ${error.message}`);
    }
  }

  /**
   * Push to every registered device of the given users, and SAY WHAT HAPPENED.
   *
   * THIS RETURNED `void` UNTIL 2026-09-05, AND THAT WAS THE DEFECT.
   * The old body was `if (error || !data?.length) return;` — one branch for two
   * opposite facts, and no way for a caller to tell either of them from
   * success. `POST …/broadcast` then reported `notified: pushIds.length`
   * counted off the ROSTER (`team/team.controller.ts:521,527`), so a broadcast
   * to the eleven-person crew reported **notified: 11** while `mobile_devices`
   * held **0 rows** and delivered **0**. Measured against production
   * `exzueerziesmczwlhomd` on 2026-09-04 and written up in ADR 0121; it is the
   * `absence-reported-as-health` shape in the one place a manager trusts a
   * number.
   *
   * FOUR OUTCOMES, KEPT APART. `no_recipients` (nobody was asked for),
   * `no_device_registered` (asked for, nothing to send to), `read_failed` (we
   * do not know, which is a fact about us and not about the crew), and
   * `accepted_by_service` — which is NOT "delivered". Expo taking a ticket
   * means Expo has it; whether a handset showed it is something this service
   * cannot see, and a caller that printed "delivered" off this would be making
   * the same overclaim one layer down.
   *
   * Still fails soft: the return value is the report, and no branch throws.
   */
  async sendToUsers(
    userIds: string[],
    payload: ExpoPushPayload,
  ): Promise<PushOutcome> {
    if (!userIds.length)
      return { outcome: "no_recipients", tokens: 0, detail: "Nobody was addressed." };
    try {
      const { data, error } = await this.databaseService.supabase
        .from("mobile_devices")
        .select("expo_push_token")
        .in("user_id", userIds);

      if (error) {
        this.logger.warn(`sendToUsers device read failed: ${error.message}`);
        return {
          outcome: "read_failed",
          tokens: 0,
          detail: `The device list could not be read (${error.message}), so we do not know whether anybody could have been reached. Nothing was sent.`,
        };
      }
      if (!data?.length) {
        return {
          outcome: "no_device_registered",
          tokens: 0,
          detail:
            "Nobody addressed has the mobile app installed and signed in, so there was nowhere to send a push. Nothing was sent.",
        };
      }

      const sent = await this.sendToTokens(
        data.map((row: any) => row.expo_push_token),
        payload.house ? await this.forHouse(payload.house, payload) : payload,
      );
      // F-1696: a ticket Expo refused is not a push it accepted.
      const why = sent.reasons.length ? ` (${sent.reasons.join(", ")})` : "";
      if (sent.refused > 0 && sent.accepted === 0) {
        return {
          outcome: "refused_by_service",
          tokens: 0,
          detail: `Expo refused the push for all ${sent.refused} registered device(s)${why}, so no phone was reached.`,
        };
      }
      return {
        outcome: "accepted_by_service",
        tokens: sent.accepted,
        detail:
          `Handed to Expo for ${sent.accepted} registered device(s). Expo accepting it is not proof a handset showed it.` +
          (sent.refused > 0
            ? ` Expo refused it for ${sent.refused} more${why}.`
            : ""),
      };
    } catch (e: any) {
      this.logger.warn(`sendToUsers failed: ${e?.message}`);
      return {
        outcome: "read_failed",
        tokens: 0,
        detail: `The push attempt threw (${e?.message}), so what reached anybody is unknown.`,
      };
    }
  }

  /**
   * Name the house in the title and stamp its id last in `data`, the way
   * `persistForRestaurant` does for the funnel push (F-523): no caller's data
   * can name another house. A failed name read still stamps the id — the tap
   * lands in the right house, the title just goes without the name.
   */
  private async forHouse(
    restaurantId: string,
    payload: ExpoPushPayload,
  ): Promise<ExpoPushPayload> {
    const { house: _house, ...rest } = payload;
    let name: string | null = null;
    try {
      const { data, error } = await this.databaseService.supabase
        .from("restaurants")
        .select("name")
        .eq("id", restaurantId)
        .maybeSingle();
      if (error)
        this.logger.warn(`push house name read failed: ${error.message}`);
      name = (data as { name?: string | null } | null)?.name?.trim() || null;
    } catch (e: any) {
      this.logger.warn(`push house name read threw: ${e?.message}`);
    }
    return {
      ...rest,
      title: name ? `${name}: ${rest.title}` : rest.title,
      data: { ...(rest.data ?? {}), restaurantId },
    };
  }

  /**
   * How many registered devices each of these users has.
   *
   * `null` means the READ FAILED, and it is a separate answer from "this person
   * has no device". A per-person receipt that cannot tell those apart is the
   * same defect as the batch one, one row down: it would file
   * `no_device_registered` against eleven people because one query timed out.
   *
   * A user with no devices is simply absent from the map, which the caller
   * reads as zero — and the caller must only do that when the map is not null.
   */
  async devicesByUser(
    userIds: string[],
  ): Promise<Map<string, number> | null> {
    if (!userIds.length) return new Map();
    const { data, error } = await this.databaseService.supabase
      .from("mobile_devices")
      .select("user_id")
      .in("user_id", userIds);
    if (error) {
      this.logger.warn(`devicesByUser failed: ${error.message}`);
      return null;
    }
    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      const id = String((row as any).user_id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Counts what Expo took and what it refused (F-1696). A gone device is
   * pruned and counted as refused; any other ticket error, an HTTP refusal or
   * a thrown send is logged with its reason and counted as refused too, so
   * `sendToUsers` never reports `accepted_by_service` for a push Expo turned
   * away.
   */
  private async sendToTokens(
    tokens: string[],
    payload: ExpoPushPayload,
  ): Promise<{ accepted: number; refused: number; reasons: string[] }> {
    const sent = { accepted: 0, refused: 0, reasons: [] as string[] };
    const because = (reason: string) => {
      if (!sent.reasons.includes(reason)) sent.reasons.push(reason);
    };
    const valid = tokens.filter((t) => t?.startsWith("ExponentPushToken"));
    sent.refused += tokens.length - valid.length;
    if (tokens.length > valid.length) because("not an Expo push token");
    if (!valid.length) return sent;

    for (let i = 0; i < valid.length; i += CHUNK_SIZE) {
      const chunk = valid.slice(i, i + CHUNK_SIZE);
      const messages = chunk.map((to) => ({
        to,
        title: payload.title,
        body: payload.body,
        data: payload.data ?? {},
        priority: payload.priority ?? "default",
        sound: "default",
        badge: payload.badge,
        channelId: payload.channelId ?? "default",
      }));

      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(messages),
        });
        if (!res.ok) {
          this.logger.warn(`Expo push HTTP ${res.status}`);
          sent.refused += chunk.length;
          because(`HTTP ${res.status}`);
          continue;
        }
        const json = (await res.json()) as { data?: ExpoPushTicket[] };
        const tickets = json.data ?? [];
        // Prune tokens Expo says are gone (uninstalled app, revoked perms).
        const dead: string[] = [];
        chunk.forEach((token, idx) => {
          const ticket = tickets[idx];
          if (ticket?.status === "ok") {
            sent.accepted += 1;
            return;
          }
          sent.refused += 1;
          const reason =
            ticket?.details?.error ?? ticket?.message ?? "no ticket returned";
          because(reason);
          if (ticket?.details?.error === "DeviceNotRegistered") {
            dead.push(token);
          } else {
            this.logger.warn(`Expo refused a push ticket: ${reason}`);
          }
        });
        if (dead.length) {
          await this.databaseService.supabase
            .from("mobile_devices")
            .delete()
            .in("expo_push_token", dead);
          this.logger.log(`Pruned ${dead.length} dead push token(s)`);
        }
      } catch (e: any) {
        this.logger.warn(`Expo push send failed: ${e?.message}`);
        sent.refused += chunk.length;
        because(String(e?.message ?? "the send threw"));
      }
    }
    return sent;
  }
}
