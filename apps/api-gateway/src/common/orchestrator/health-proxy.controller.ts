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
import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { isAxiosError } from "axios";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { TenantBypass } from "../tenant/tenant.decorator";
import { OrchestratorService } from "./orchestrator.service";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import {
  OwnerOrPlatformOperatorGuard,
  PlatformOperatorGuard,
  PlatformOperatorService,
} from "./platform-operator.service";

/** Every value of AgentStatus (services/agent-orchestrator/core/base_agent.py). */
export const AGENT_STATUSES = [
  "initializing",
  "starting",
  "active",
  "idle",
  "paused",
  "degraded",
  "error",
  "stopping",
  "stopped",
] as const;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Shared runtime health: the agent's identity, state and its static capability flags.
 * The payload's free text (`last_error`) and anything shaped by a house's traffic stays
 * behind the gateway, because every house reads the same platform agents.
 */
export function publicAgentHealth(value: unknown) {
  const row = record(value);
  return {
    agent_name: typeof row.agent_name === "string" ? row.agent_name : "Unnamed agent",
    version: typeof row.version === "string" ? row.version : null,
    status:
      typeof row.status === "string" &&
      (AGENT_STATUSES as readonly string[]).includes(row.status)
        ? row.status
        : "unknown",
    healthy: typeof row.healthy === "boolean" ? row.healthy : null,
    capabilities: Array.isArray(row.capabilities)
      ? row.capabilities.filter(
          (capability): capability is string =>
            typeof capability === "string" && /^[a-z_]{1,64}$/.test(capability),
        )
      : [],
  };
}

/**
 * The per-agent reading: counters, timings and configuration numbers only. Rejected on
 * purpose: `metrics.health.last_error` (free text, can quote a house's order or vendor),
 * `metrics.activity.last_activity` (when some house last used the agent) and
 * `subscriptions` (not needed by any reader). Every number that is absent or malformed
 * reads as null, never as 0.
 */
export function publicAgentDetail(value: unknown) {
  const row = record(value);
  const metrics = record(row.metrics);
  const messages = record(metrics.messages);
  const timing = record(metrics.timing);
  const health = record(metrics.health);
  const activity = record(metrics.activity);
  const config = record(row.config);
  const breaker = record(row.circuit_breaker);
  return {
    ...publicAgentHealth(value),
    metrics: {
      messages: {
        received: count(messages.received),
        processed: count(messages.processed),
        failed: count(messages.failed),
        skipped: count(messages.skipped),
        success_rate:
          typeof messages.success_rate === "string" &&
          /^\d{1,3}(\.\d{1,2})?%$/.test(messages.success_rate)
            ? messages.success_rate
            : null,
      },
      timing: {
        avg_ms: count(timing.avg_ms),
        min_ms: count(timing.min_ms),
        max_ms: count(timing.max_ms),
        p95_ms: count(timing.p95_ms),
      },
      health: {
        errors: count(health.errors),
        circuit_breaker_trips: count(health.circuit_breaker_trips),
      },
      activity: {
        uptime_seconds: count(activity.uptime_seconds),
        pause_count: count(activity.pause_count),
        restart_count: count(activity.restart_count),
      },
    },
    config: {
      max_concurrent_tasks: count(config.max_concurrent_tasks),
      max_retries: count(config.max_retries),
      circuit_breaker_enabled:
        typeof config.circuit_breaker_enabled === "boolean"
          ? config.circuit_breaker_enabled
          : null,
    },
    queue_size: count(row.queue_size),
    active_tasks: count(row.active_tasks),
    circuit_breaker:
      typeof breaker.state === "string" && /^[a-z_]{1,32}$/.test(breaker.state)
        ? {
            state: breaker.state,
            available: typeof breaker.available === "boolean" ? breaker.available : null,
          }
        : null,
  };
}

@Controller("health")
@UseGuards(JwtAuthGuard)
@TenantBypass()
export class HealthProxyController {
  constructor(
    private readonly orchestratorService: OrchestratorService,
    private readonly config: ConfigService,
    private readonly operators: PlatformOperatorService,
  ) {}

  @Get("agents")
  @UseGuards(OwnerOrPlatformOperatorGuard)
  async getAllAgentsHealth() {
    try {
      const result = await this.orchestratorService.getAgentHealthAll();
      if (!Array.isArray(result?.agents)) throw new Error("Invalid health response");
      return { agents: result.agents.map(publicAgentHealth), count: result.agents.length, observedAt: new Date().toISOString(), scope: "platform" };
    } catch {
      throw new ServiceUnavailableException("Agent health could not be read.");
    }
  }

  /**
   * A bad name and an unknown agent are answers, not outages: 400 and 404 pass through as
   * themselves (without the orchestrator's detail, which lists every running agent).
   */
  @Get("agents/:name")
  @UseGuards(OwnerOrPlatformOperatorGuard)
  async getAgentHealth(@Param("name") name: string) {
    try {
      return publicAgentDetail(await this.orchestratorService.getAgentHealthByName(name));
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw new BadRequestException("Invalid agent name.");
      }
      if (isAxiosError(error) && error.response?.status === 404) {
        throw new NotFoundException("No agent by that name is running.");
      }
      throw new ServiceUnavailableException("Agent health could not be read.");
    }
  }

  @Get("access")
  async access(@CurrentUser("userId") userId: string) {
    return { platformOperator: await this.operators.isOperator(userId) };
  }

  /**
   * LLM / infra provider readiness for Admin + Studio surfaces.
   * Never returns secret values — only configured / missing.
   */
  @Get("providers")
  @UseGuards(OwnerOrPlatformOperatorGuard)
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

    // `healthy` stays the legacy boolean (Boolean(<configured>)) — it has
    // always meant "a key is present", never "probed and answering" — because
    // legacy AdminPanel.tsx:638,649 paints its dot and badge directly off this
    // field and reads it as a boolean. Sending `null` here (as an earlier pass
    // on this lane did) reads as falsy in that page's ternaries, painting a
    // correctly configured provider amber before anyone has decided legacy
    // may degrade. `status` carries the more honest "not probed" language
    // instead; legacy only displays that string, it never branches on it.
    return {
      providers: [
        {
          id: "supabase",
          name: "Database",
          desc: "Supabase PostgreSQL",
          status: supabaseUrl ? "Configured · not probed" : "Not configured",
          healthy: Boolean(supabaseUrl),
          configured: Boolean(supabaseUrl),
        },
        {
          id: "gemini",
          name: "AI Engine",
          desc: "Gemini Pro",
          status: geminiKey ? "Configured · not probed" : "Key missing",
          healthy: Boolean(geminiKey),
          configured: Boolean(geminiKey),
        },
        {
          id: "claude",
          name: "Studio Vision",
          desc: "Claude API (Haiku / Sonnet — /studio extract)",
          status: claudeKey ? "Configured · not probed" : "Key missing",
          healthy: Boolean(claudeKey),
          configured: Boolean(claudeKey),
          purpose: "studio",
        },
      ],
    };
  }
}

@Controller("metrics")
@UseGuards(JwtAuthGuard, PlatformOperatorGuard)
@TenantBypass()
export class MetricsProxyController {
  constructor(private readonly orchestratorService: OrchestratorService) {}

  @Get()
  getMetrics() {
    return this.orchestratorService.getSystemMetrics();
  }
}
