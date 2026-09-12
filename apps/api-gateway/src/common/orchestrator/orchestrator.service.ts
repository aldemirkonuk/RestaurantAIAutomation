import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios, { AxiosInstance } from "axios";
import * as amqplib from "amqplib";
import {
  isSafePathSegment,
  isSafeRelativePath,
} from "../http/safe-path";

/**
 * Studio wildcard paths are slash-separated words and UUIDs (`queue`, `invite/redeem`,
 * `contributors/<uuid>/revoke`, `me/roles`). Shares its rules with every other outbound
 * URL interpolation in the gateway — see `common/http/safe-path.ts` for why these are
 * allowlists rather than sanitisers.
 */
export function isSafeStudioSubPath(subPath: string): boolean {
  return isSafeRelativePath(subPath);
}

@Injectable()
export class OrchestratorService implements OnModuleDestroy {
  private readonly logger = new Logger(OrchestratorService.name);
  private readonly httpClient: AxiosInstance;
  private readonly orchestratorConfigured: boolean;
  private rabbitConnection: amqplib.Connection | null = null;
  private rabbitChannel: amqplib.Channel | null = null;

  constructor(private readonly configService: ConfigService) {
    const baseUrl = this.configService.get<string>("AGENT_ORCHESTRATOR_URL");
    this.orchestratorConfigured = !!baseUrl;
    if (!this.orchestratorConfigured) {
      this.logger.warn(
        "AGENT_ORCHESTRATOR_URL is not set — HTTP draft trigger is disabled. " +
          "Set this env var in Railway to enable AI draft generation.",
      );
    }
    this.httpClient = axios.create({
      baseURL: baseUrl || "http://localhost:8000",
      timeout: 15000,
    });
  }

  async callAgent(
    agentName: string,
    action: string,
    payload: any,
  ): Promise<any> {
    const response = await this.httpClient.post("/api/v1/agents/execute", {
      agent: agentName,
      action,
      payload,
    });
    return response.data;
  }

  /**
   * HTTP fallback for triggering AI email draft generation when RabbitMQ is not available.
   * Calls the Python orchestrator's dedicated procurement trigger endpoint.
   * Throws if AGENT_ORCHESTRATOR_URL is not configured so the caller can log clearly.
   */
  async triggerDraftHttp(payload: Record<string, any>): Promise<void> {
    if (!this.orchestratorConfigured) {
      throw new Error(
        "AGENT_ORCHESTRATOR_URL not configured — HTTP draft trigger skipped",
      );
    }
    const adminKey = this.configService.get<string>("ADMIN_API_KEY", "");
    await this.httpClient.post("/api/v1/procurement/trigger-draft", payload, {
      headers: { "X-Admin-Key": adminKey },
    });
  }

  async publishEvent(
    exchange: string,
    routingKey: string,
    event: any,
  ): Promise<void> {
    const channel = await this.getChannel();
    await channel.assertExchange(exchange, "topic", { durable: true });
    channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(event)), {
      persistent: true,
      contentType: "application/json",
    });
  }

  async getAgentHealth(): Promise<any> {
    const response = await this.httpClient.get("/api/v1/health");
    return response.data;
  }

  private getAdminHeaders(): Record<string, string> {
    const key = this.configService.get<string>("ADMIN_API_KEY", "");
    return { "X-Admin-Key": key };
  }

  /**
   * Forward a studio request to the orchestrator, preserving the caller's own Bearer token.
   *
   * Studio endpoints authorize per-user against `app_metadata.roles`, which generateTokens()
   * already embeds for this exact consumer (auth.service.ts:393-395). So this passes the
   * token through rather than substituting the admin key: swapping in a service credential
   * would erase the identity the orchestrator authorizes on and make every caller an admin.
   *
   * Returns { status, data } instead of throwing, so the controller can relay the
   * orchestrator's own status codes — redeem_invite's 403/404/409/410 each mean something
   * specific to the user and must not collapse into a 500.
   */
  /**
   * Forward POST /onboarding/extract to the orchestrator (ADR 0021).
   *
   * Separate from proxyStudio because the shared client's defaults are wrong for it in
   * two ways, both of which would surface as a confusing failure rather than a clear one:
   *
   *  - **Timeout.** The shared client allows 15s. Extraction runs a wine list through
   *    Claude Vision or a Gemini crawl and routinely takes minutes, so it would abort
   *    mid-flight and read as a flaky orchestrator. 5 minutes here, which is longer than
   *    any observed extraction and still bounded.
   *  - **Body size.** A native PDF arrives base64-encoded; main.ts accepts up to
   *    MAX_REQUEST_BODY_SIZE (15mb default). axios must be told to match, or it rejects
   *    the larger uploads itself before they ever leave the gateway.
   */
  async proxyOnboardingExtract(
    authorization: string | undefined,
    body: unknown,
  ): Promise<{ status: number; data: any }> {
    if (!this.orchestratorConfigured) {
      this.logger.error(
        "AGENT_ORCHESTRATOR_URL is not set — onboarding extraction cannot be served",
      );
      return {
        status: 503,
        data: { message: "Extraction service is not configured" },
      };
    }
    const response = await this.httpClient.request({
      method: "POST",
      url: "/api/v1/onboarding/extract",
      data: body,
      headers: authorization ? { Authorization: authorization } : {},
      timeout: 300_000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: () => true,
    });
    return { status: response.status, data: response.data };
  }

  async proxyStudio(
    method: string,
    subPath: string,
    authorization: string | undefined,
    body: unknown,
    query: Record<string, any>,
  ): Promise<{ status: number; data: any }> {
    if (!this.orchestratorConfigured) {
      this.logger.error(
        "AGENT_ORCHESTRATOR_URL not configured — studio requests cannot be served",
      );
      return {
        status: 503,
        data: { message: "Studio service is not configured" },
      };
    }
    // The wildcard segment is caller-controlled and is interpolated into the outbound URL,
    // so it must be constrained to something that can only be a studio path. Without this,
    // `a/../../../agents/execute` resolves to `<orchestrator>/api/agents/execute` — outside
    // the /studio/ prefix, carrying the caller's own bearer token. The guard on this route
    // admits ANY logged-in user (JwtAuthGuard + TenantBypass, no role check, because the
    // role check belongs to the orchestrator), so unconstrained it is a generic
    // authenticated reverse proxy into the orchestrator for every restaurant account.
    if (!isSafeStudioSubPath(subPath)) {
      this.logger.warn(
        `Rejected studio proxy path: ${JSON.stringify(subPath).slice(0, 200)}`,
      );
      return { status: 400, data: { message: "Invalid studio path" } };
    }
    const response = await this.httpClient.request({
      method: method as any,
      url: `/api/v1/studio/${subPath}`,
      data: body,
      params: query,
      headers: authorization ? { Authorization: authorization } : {},
      validateStatus: () => true,
    });
    return { status: response.status, data: response.data };
  }

  async getAgentHealthAll(): Promise<any> {
    const response = await this.httpClient.get("/api/v1/health/agents", {
      headers: this.getAdminHeaders(),
    });
    return response.data;
  }

  /**
   * CodeQL js/request-forgery, open since 2026-07-08.
   *
   * `name` arrives from `@Get("agents/:name")`. Express decodes route params, so `%2f`
   * becomes a real slash *after* routing matched — `..%2f..%2fagents%2fexecute` decodes to
   * `../../agents/execute` and the URL resolves to `<orchestrator>/api/v1/agents/execute`.
   *
   * This one is worse than the studio proxy's equivalent was: `getAdminHeaders()` attaches
   * X-Admin-Key, so an escaped request carries the server-to-server admin credential rather
   * than the caller's own token.
   */
  async getAgentHealthByName(name: string): Promise<any> {
    if (!isSafePathSegment(name)) {
      this.logger.warn(
        `Rejected agent health lookup for unsafe name: ${JSON.stringify(name).slice(0, 200)}`,
      );
      throw new BadRequestException("Invalid agent name");
    }
    const response = await this.httpClient.get(
      `/api/v1/health/agents/${name}`,
      {
        headers: this.getAdminHeaders(),
      },
    );
    return response.data;
  }

  async getSystemMetrics(): Promise<any> {
    const response = await this.httpClient.get("/api/v1/metrics", {
      headers: this.getAdminHeaders(),
    });
    return response.data;
  }

  async onModuleDestroy() {
    if (this.rabbitChannel) {
      await this.rabbitChannel.close();
    }
    if (this.rabbitConnection) {
      await this.rabbitConnection.close();
    }
  }

  private async getChannel(): Promise<amqplib.Channel> {
    if (this.rabbitChannel) {
      return this.rabbitChannel;
    }

    const rabbitUrl = this.configService.get<string>(
      "RABBITMQ_URL",
      "amqp://localhost:5672",
    );
    this.rabbitConnection = await amqplib.connect(rabbitUrl);
    this.rabbitChannel = await this.rabbitConnection.createChannel();
    this.logger.log("✅ RabbitMQ channel ready for orchestrator bridge");
    return this.rabbitChannel;
  }
}
