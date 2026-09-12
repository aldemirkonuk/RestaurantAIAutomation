/**
 * Health Proxy Controllers (INFRA-04)
 *
 * Proxies frontend health requests to the Python orchestrator.
 * Auth flow:
 *   1. JwtAuthGuard: validates Supabase JWT (any logged-in user)
 *   2. TenantBypass: skips restaurantId check (health routes don't need it)
 *   3. OrchestratorService: adds X-Admin-Key before forwarding to orchestrator
 *
 * ADMIN_API_KEY never reaches frontend JS — it stays in api-gateway server env only.
 */
import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { TenantBypass } from "../tenant/tenant.decorator";
import { CacheService } from "../cache/cache.service";
import { OrchestratorService } from "./orchestrator.service";
import { RabbitMqBridgeService } from "./rabbitmq-bridge.service";

/**
 * One row of `GET /health/infra` — a dependency the gateway holds a live
 * connection to, and what that connection said when asked just now.
 *
 * Every row here is MEASURED. The `providers` route below is not — it reads
 * whether a key is set — and the two are kept on separate routes so a page
 * cannot draw a key's presence in the same column as a round trip.
 */
export interface InfraRow {
  id: "orchestrator" | "rabbitmq" | "redis";
  /** What a person calls it. */
  name: string;
  /** The env var this row's existence turns on. */
  configured: boolean;
  state:
    | "reachable"
    | "unreachable"
    | "connected"
    | "disconnected"
    | "not-configured";
  /** Measured round trip in ms, or null when the check sends nothing. */
  latencyMs: number | null;
  /** Fixed vocabulary from the probe; never a URL or a driver message. */
  detail: string;
  /** What was done to find out, in words the page prints as provenance. */
  probe: string;
}

export interface InfraHealthPayload {
  checkedAt: string;
  rows: InfraRow[];
}

@Controller("health")
@UseGuards(JwtAuthGuard)
@TenantBypass()
export class HealthProxyController {
  constructor(
    private readonly orchestratorService: OrchestratorService,
    private readonly config: ConfigService,
    private readonly bridge: RabbitMqBridgeService,
    private readonly cache: CacheService,
  ) {}

  /**
   * The machinery the gateway itself is wired to, measured (ADR 0133 admin
   * rebuild, 2026-09-11).
   *
   * `/admin` printed "Message Queue — Active" and "Cache — Running" as two
   * hard-coded rows beside three real ones (`pages/AdminPanel.tsx:257-258`)
   * for as long as the page existed; neither was ever checked. Both have live
   * connections in this process — `RabbitMqBridgeService` consumes agent
   * events, `CacheService` holds the Redis client — so the honest fix is to
   * ask them. The orchestrator joins because the page's whole agents register
   * hangs off it and "unreachable" and "no agents" must never share a row.
   *
   * Absence is never health: an unconfigured dependency says so in its own
   * state, and a probe that fails says how, in a fixed phrase. Nothing here
   * can answer "connected" without a connection having answered first.
   */
  @Get("infra")
  async getInfraHealth(): Promise<InfraHealthPayload> {
    const checkedAt = new Date().toISOString();
    const [orchestrator, redis] = await Promise.all([
      this.orchestratorService.probe().catch(() => ({
        configured: true,
        reachable: false,
        latencyMs: null,
        detail: "the probe itself threw before an answer arrived",
      })),
      this.cache.probe().catch(() => ({
        configured: true,
        connected: false,
        latencyMs: null,
        detail: "the probe itself threw before an answer arrived",
      })),
    ]);
    const rabbit = this.bridge.getHealth();
    const rabbitConfigured = Boolean(
      this.config.get<string>("RABBITMQ_URL") || process.env.RABBITMQ_URL,
    );

    return {
      checkedAt,
      rows: [
        {
          id: "orchestrator",
          name: "Agent orchestrator",
          configured: orchestrator.configured,
          state: !orchestrator.configured
            ? "not-configured"
            : orchestrator.reachable
              ? "reachable"
              : "unreachable",
          latencyMs: orchestrator.latencyMs,
          detail: orchestrator.detail,
          probe: "GET /health on the orchestrator process, unauthenticated, 4 s bound",
        },
        {
          id: "rabbitmq",
          name: "Message queue",
          configured: rabbitConfigured,
          state: !rabbitConfigured
            ? "not-configured"
            : rabbit.connected
              ? "connected"
              : "disconnected",
          latencyMs: null,
          detail: !rabbitConfigured
            ? "RABBITMQ_URL is not set; the bridge would dial localhost"
            : rabbit.connected
              ? `the consumer bridge holds an open channel with ${rabbit.subscriptions} subscriptions`
              : "the consumer bridge has no open channel; it retries every 5 s",
          probe: "the state of the gateway's own consumer channel (RabbitMqBridgeService), read at this moment",
        },
        {
          id: "redis",
          name: "Cache",
          configured: redis.configured,
          state: !redis.configured
            ? "not-configured"
            : redis.connected
              ? "connected"
              : "disconnected",
          latencyMs: redis.latencyMs,
          detail: redis.detail,
          probe: "PING on the gateway's own Redis client, 2 s bound",
        },
      ],
    };
  }

  @Get("agents")
  getAllAgentsHealth() {
    return this.orchestratorService.getAgentHealthAll();
  }

  @Get("agents/:name")
  getAgentHealth(@Param("name") name: string) {
    return this.orchestratorService.getAgentHealthByName(name);
  }

  /**
   * LLM / infra provider readiness for Admin + Studio surfaces.
   * Never returns secret values — only configured / missing.
   */
  @Get("providers")
  getProviderHealth() {
    const claudeKey =
      this.config.get<string>("ANTHROPIC_API_KEY") ||
      this.config.get<string>("CLAUDE_API_KEY") ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.CLAUDE_API_KEY;
    const geminiKey =
      this.config.get<string>("GOOGLE_API_KEY") ||
      this.config.get<string>("GEMINI_API_KEY") ||
      process.env.GOOGLE_API_KEY ||
      process.env.GEMINI_API_KEY;
    const supabaseUrl =
      this.config.get<string>("SUPABASE_URL") || process.env.SUPABASE_URL;

    return {
      providers: [
        {
          id: "supabase",
          name: "Database",
          desc: "Supabase PostgreSQL",
          status: supabaseUrl ? "Connected" : "Not configured",
          healthy: Boolean(supabaseUrl),
        },
        {
          id: "gemini",
          name: "AI Engine",
          desc: "Gemini Pro",
          status: geminiKey ? "Ready" : "Key missing",
          healthy: Boolean(geminiKey),
        },
        {
          id: "claude",
          name: "Studio Vision",
          desc: "Claude API (Haiku / Sonnet — /studio extract)",
          status: claudeKey ? "Ready" : "Key missing",
          healthy: Boolean(claudeKey),
          purpose: "studio",
        },
      ],
    };
  }
}

@Controller("metrics")
@UseGuards(JwtAuthGuard)
@TenantBypass()
export class MetricsProxyController {
  constructor(private readonly orchestratorService: OrchestratorService) {}

  @Get()
  getMetrics() {
    return this.orchestratorService.getSystemMetrics();
  }
}
