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
import { Controller, Get, Param, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { TenantBypass } from "../tenant/tenant.decorator";
import { OrchestratorService } from "./orchestrator.service";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { PlatformOperatorGuard, PlatformOperatorService } from "./platform-operator.service";

/** Shared runtime health is visible; payloads, last errors and house records are not. */
export function publicAgentHealth(value: unknown) {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const statuses = ["active", "idle", "starting", "stopping", "stopped", "error", "initializing", "paused"];
  return {
    agent_name: typeof row.agent_name === "string" ? row.agent_name : "Unnamed agent",
    version: typeof row.version === "string" ? row.version : null,
    status: typeof row.status === "string" && statuses.includes(row.status) ? row.status : "unknown",
    healthy: typeof row.healthy === "boolean" ? row.healthy : null,
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
  async getAllAgentsHealth() {
    try {
      const result = await this.orchestratorService.getAgentHealthAll();
      if (!Array.isArray(result?.agents)) throw new Error("Invalid health response");
      return { agents: result.agents.map(publicAgentHealth), count: result.agents.length, observedAt: new Date().toISOString(), scope: "platform" };
    } catch {
      throw new ServiceUnavailableException("Agent health could not be read.");
    }
  }

  @Get("agents/:name")
  async getAgentHealth(@Param("name") name: string) {
    try {
      return publicAgentHealth(await this.orchestratorService.getAgentHealthByName(name));
    } catch {
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
          status: supabaseUrl ? "Configured · not probed" : "Not configured",
          healthy: null,
          configured: Boolean(supabaseUrl),
        },
        {
          id: "gemini",
          name: "AI Engine",
          desc: "Gemini Pro",
          status: geminiKey ? "Configured · not probed" : "Key missing",
          healthy: null,
          configured: Boolean(geminiKey),
        },
        {
          id: "claude",
          name: "Studio Vision",
          desc: "Claude API (Haiku / Sonnet — /studio extract)",
          status: claudeKey ? "Configured · not probed" : "Key missing",
          healthy: null,
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
