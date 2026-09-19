import { BadRequestException, Body, ConflictException, Controller, Get, HttpException, Param, Post, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { IsUUID } from "class-validator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { DatabaseService } from "../../database/database.service";
import { isSafePathSegment } from "../http/safe-path";
import { TenantBypass } from "../tenant/tenant.decorator";
import { OrchestratorService } from "./orchestrator.service";
import { PlatformOperatorGuard } from "./platform-operator.service";

export class AgentOperationDto {
  @IsUUID("4")
  requestId!: string;
}

/** Platform routes have no restaurant parameter. Every entry requires both guards. */
@Controller("health/agent-operations")
@UseGuards(JwtAuthGuard, PlatformOperatorGuard)
@TenantBypass()
export class AgentOperationsController {
  constructor(private readonly database: DatabaseService, private readonly orchestrator: OrchestratorService) {}

  @Get()
  async recent() {
    const { data, error } = await this.database.client.from("platform_agent_operations")
      .select("id,agent_name,action,status,requested_at,completed_at,error_code")
      .order("requested_at", { ascending: false }).limit(25);
    if (error) throw new ServiceUnavailableException("Operation receipts could not be read.");
    return { operations: data ?? [] };
  }

  @Post(":name/:action")
  async operate(@Param("name") name: string, @Param("action") action: string,
    @Body() body: AgentOperationDto, @CurrentUser("userId") userId: string) {
    if (!isSafePathSegment(name) || !["restart", "stop"].includes(action)) {
      throw new BadRequestException("Unknown agent operation.");
    }
    const receipt = { id: body.requestId, actor_id: userId, agent_name: name, action, status: "requested" };
    const { error: recordError } = await this.database.client.from("platform_agent_operations").insert(receipt);
    if (recordError?.code === "23505") throw new ConflictException("This request was already recorded. Refresh the operation receipts before acting again.");
    if (recordError) throw new ServiceUnavailableException("The operation was not sent because its receipt could not be recorded.");
    let status = "unknown";
    try {
      const result = await this.orchestrator.operateAgent(name, action as "restart" | "stop", body.requestId);
      status = result.success === true ? "succeeded" : "failed";
    } catch {
      // A timeout does not prove that the remote action failed. Never replay automatically.
      status = "unknown";
    }
    const { error } = await this.database.client.from("platform_agent_operations").update({
      status, completed_at: new Date().toISOString(), error_code: status === "unknown" ? "remote_outcome_unknown" : status === "failed" ? "agent_operation_failed" : null,
    }).eq("id", body.requestId).eq("actor_id", userId);
    const result = { id: body.requestId, agent: name, action, status, receiptRecorded: !error };
    if (status !== "succeeded") throw new HttpException({ ...result, message: status === "failed" ? "The agent operation failed." : "The remote outcome is unknown." }, status === "failed" ? 502 : 504);
    return result;
  }
}
