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
import { OrchestratorService } from "./orchestrator.service";

@Controller("health")
@UseGuards(JwtAuthGuard)
@TenantBypass()
export class HealthProxyController {
  constructor(
    private readonly orchestratorService: OrchestratorService,
    private readonly config: ConfigService,
  ) {}

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
