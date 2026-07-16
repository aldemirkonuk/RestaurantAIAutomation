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

  async unregisterDevice(expoPushToken: string): Promise<void> {
    const { error } = await this.databaseService.supabase
      .from("mobile_devices")
      .delete()
      .eq("expo_push_token", expoPushToken);
    if (error) {
      this.logger.warn(`unregisterDevice failed: ${error.message}`);
    }
  }

  /** Push to every registered device of the given users. */
  async sendToUsers(
    userIds: string[],
    payload: ExpoPushPayload,
  ): Promise<void> {
    if (!userIds.length) return;
    try {
      const { data, error } = await this.databaseService.supabase
        .from("mobile_devices")
        .select("expo_push_token")
        .in("user_id", userIds);
      if (error || !data?.length) return;

      await this.sendToTokens(
        data.map((row: any) => row.expo_push_token),
        payload,
      );
    } catch (e: any) {
      this.logger.warn(`sendToUsers failed: ${e?.message}`);
    }
  }

  private async sendToTokens(
    tokens: string[],
    payload: ExpoPushPayload,
  ): Promise<void> {
    const valid = tokens.filter((t) => t?.startsWith("ExponentPushToken"));
    if (!valid.length) return;

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
          continue;
        }
        const json = (await res.json()) as { data?: ExpoPushTicket[] };
        const tickets = json.data ?? [];
        // Prune tokens Expo says are gone (uninstalled app, revoked perms).
        const dead: string[] = [];
        tickets.forEach((ticket, idx) => {
          if (
            ticket.status === "error" &&
            ticket.details?.error === "DeviceNotRegistered"
          ) {
            dead.push(chunk[idx]);
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
      }
    }
  }
}
