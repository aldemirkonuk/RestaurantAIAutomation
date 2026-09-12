import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, RedisClientType } from "redis";

/** True when the URL's host is upstash.io or a subdomain of it. */
export function isUpstashHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "upstash.io" || host.endsWith(".upstash.io");
  } catch {
    return false;
  }
}

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private client: RedisClientType | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    let redisUrl = this.configService.get<string>("REDIS_URL", "");
    if (!redisUrl) {
      this.logger.warn("⚠️ REDIS_URL not set, caching disabled");
      return;
    }
    // Upstash requires TLS — normalise redis:// → rediss://
    //
    // Match on the parsed hostname, not `.includes("upstash.io")`: the
    // substring form also matches `redis://upstash.io.attacker.example/`,
    // where the host is not Upstash at all. The failure here is benign (a
    // non-Upstash URL would merely be upgraded to TLS) which is why this is
    // correctness rather than an exploit — but a host check that does not
    // check the host is worth a line to do properly.
    if (redisUrl.startsWith("redis://") && isUpstashHost(redisUrl)) {
      redisUrl = "rediss://" + redisUrl.slice("redis://".length);
    }
    try {
      this.client = createClient({
        url: redisUrl,
        socket: {
          connectTimeout: 3000,
          reconnectStrategy: (retries) =>
            retries > 3 ? false : Math.min(retries * 200, 2000),
        },
      });
      this.client.on("error", (error) => {
        this.logger.warn(`Redis error: ${error.message || error}`);
      });
      await this.client.connect();
      this.logger.log("✅ Redis cache connected");
    } catch (error) {
      this.logger.warn(`⚠️ Redis unavailable, caching disabled: ${error}`);
      this.client = null;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.logger.log("✅ Redis cache disconnected");
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.client) return null;
    const value = await this.client.get(key);
    return value ? (JSON.parse(value) as T) : null;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (!this.client) return;
    await this.client.set(key, JSON.stringify(value), { EX: ttlSeconds });
  }

  async del(keys: string | string[]): Promise<void> {
    if (!this.client) return;
    const targetKeys = Array.isArray(keys) ? keys : [keys];
    if (targetKeys.length > 0) {
      await this.client.del(targetKeys);
    }
  }

  async invalidateByPattern(pattern: string): Promise<number> {
    if (!this.client) return 0;
    const keys = await this.client.keys(pattern);
    if (keys.length === 0) return 0;
    await this.client.del(keys);
    return keys.length;
  }

  /**
   * Is Redis actually there? A measured answer for `/health/infra`.
   *
   * `/admin` used to print a "Cache — Running" row that no code had ever
   * checked (`pages/AdminPanel.tsx:258`, hard-coded `healthy: true`). This is
   * the check. Three states, never two: not configured (no `REDIS_URL`, and
   * the service said so at boot), connected (a `PING` came back within the
   * bound, and the round trip is stated), disconnected (a client exists but
   * `PING` failed or timed out — the reason is a fixed phrase, never the
   * driver's message, which can carry the URL).
   */
  async probe(): Promise<RedisProbe> {
    const configured = Boolean(this.configService.get<string>("REDIS_URL", ""));
    if (!this.client) {
      return {
        configured,
        connected: false,
        latencyMs: null,
        detail: configured
          ? "REDIS_URL is set, but no client survived start-up; caching is off"
          : "REDIS_URL is not set; caching is off",
      };
    }
    const started = Date.now();
    let timer: NodeJS.Timeout | null = null;
    try {
      const answer = await Promise.race<string>([
        this.client.ping(),
        new Promise<string>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("timeout")),
            REDIS_PROBE_TIMEOUT_MS,
          );
        }),
      ]);
      const latencyMs = Date.now() - started;
      return {
        configured,
        connected: answer === "PONG",
        latencyMs,
        detail:
          answer === "PONG"
            ? `PING answered PONG in ${latencyMs} ms`
            : "PING answered something other than PONG",
      };
    } catch (error) {
      const timedOut = error instanceof Error && error.message === "timeout";
      return {
        configured,
        connected: false,
        latencyMs: Date.now() - started,
        detail: timedOut
          ? `PING did not answer within ${REDIS_PROBE_TIMEOUT_MS} ms`
          : "PING failed; the client is open but the server did not answer",
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/** How long `PING` may take before Redis is called unreachable. */
export const REDIS_PROBE_TIMEOUT_MS = 2000;

export interface RedisProbe {
  /** `REDIS_URL` is set on this process. */
  configured: boolean;
  /** A `PING` came back `PONG` within {@link REDIS_PROBE_TIMEOUT_MS}. */
  connected: boolean;
  /** The measured round trip, or null when nothing was sent. */
  latencyMs: number | null;
  /** Fixed vocabulary; never the driver's own message. */
  detail: string;
}
