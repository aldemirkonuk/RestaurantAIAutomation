import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpException,
  Logger,
  Param,
  Post,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { isAxiosError } from "axios";
import { IsUUID } from "class-validator";
import type { Response } from "express";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { DatabaseService } from "../../database/database.service";
import { isSafePathSegment } from "../http/safe-path";
import { TenantBypass } from "../tenant/tenant.decorator";
import {
  OrchestratorNotConfiguredError,
  OrchestratorService,
} from "./orchestrator.service";
import { PlatformOperatorGuard } from "./platform-operator.service";

export class AgentOperationDto {
  @IsUUID("4")
  requestId!: string;
}

export type ReceiptStatus =
  | "requested"
  | "running"
  | "succeeded"
  | "failed"
  | "unknown";

/** A receipt in one of these states has no settled outcome yet. */
const PENDING: ReceiptStatus[] = ["requested", "running", "unknown"];

/** The orchestrator keeps its records in memory; older receipts are not asked about. */
const RECONCILE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface OperationVerdict {
  status: Exclude<ReceiptStatus, "requested">;
  errorCode: string | null;
  httpStatus: number;
  message: string;
}

const unknownOutcome = (message: string): OperationVerdict => ({
  status: "unknown",
  errorCode: "remote_outcome_unknown",
  httpStatus: 504,
  message,
});

const refused = (
  errorCode: string,
  httpStatus: number,
  message: string,
): OperationVerdict => ({ status: "failed", errorCode, httpStatus, message });

/**
 * What an ANSWER from the orchestrator established. Its route today is synchronous —
 * it runs the operation and answers 200 with the result once that finishes, however
 * long that takes (services/agent-orchestrator/api/health_routes.py `operate_agent`).
 * The `202`/`state: "running"` branch below is not reachable against that route; it
 * is kept for a future asynchronous drain (answer early, settle later) that nothing
 * on the Python side implements yet — do not read its presence here as a claim that
 * one exists today.
 */
export function verdictFromAnswer(
  answer: { httpStatus: number; data: unknown },
  requestId: string,
): OperationVerdict {
  const data =
    answer.data && typeof answer.data === "object"
      ? (answer.data as Record<string, unknown>)
      : {};
  if (data.request_id !== requestId) {
    return unknownOutcome(
      "The orchestrator's answer did not name this request, so the outcome is not known.",
    );
  }
  if (answer.httpStatus === 202 && data.state === "running") {
    return {
      status: "running",
      errorCode: null,
      httpStatus: 202,
      message:
        "The agent is still draining its work. This receipt settles when the orchestrator reports the result.",
    };
  }
  if (data.success === true) {
    return { status: "succeeded", errorCode: null, httpStatus: 200, message: "" };
  }
  if (data.success === false) {
    return refused("agent_operation_failed", 502, "The agent operation failed.");
  }
  return unknownOutcome(
    "The orchestrator's answer did not say whether the operation succeeded.",
  );
}

/**
 * What a FAILED dispatch established. Any HTTP status from the orchestrator means its
 * route answered, and every non-2xx answer that route gives is issued before it runs
 * anything (400 bad action, 401 key, 404 not running, 409 already in progress, 503 not
 * running). Those are definite refusals, recorded as `failed` with a code that says
 * which. Only the absence of an answer, or a server error that may have come after the
 * work began, is `unknown`. Replaying is never automatic either way.
 */
export function verdictFromError(error: unknown): OperationVerdict {
  if (error instanceof OrchestratorNotConfiguredError) {
    return refused(
      "orchestrator_unconfigured",
      503,
      "No orchestrator is configured for this gateway. Nothing was sent.",
    );
  }
  if (error instanceof BadRequestException) {
    return refused("invalid_operation", 400, "Unknown agent operation. Nothing was sent.");
  }
  if (!isAxiosError(error)) {
    return unknownOutcome("The outcome could not be established.");
  }
  const status = error.response?.status;
  if (status === undefined) {
    // The connection was never made, so no request reached the orchestrator.
    if (["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(error.code ?? "")) {
      return refused(
        "orchestrator_unreachable",
        503,
        "The orchestrator could not be reached. Nothing was sent.",
      );
    }
    return unknownOutcome(
      "No answer arrived in time. The operation may still complete; this receipt settles when the orchestrator reports it.",
    );
  }
  if (status === 409) {
    return refused(
      "operation_in_progress",
      409,
      "Another operation on this agent is still running. Nothing was sent; read its receipt before acting again.",
    );
  }
  if (status === 404) {
    return refused(
      "agent_not_running",
      404,
      "The orchestrator is not running an agent by that name. Nothing was sent.",
    );
  }
  if (status === 503) {
    return refused(
      "orchestrator_not_running",
      503,
      "The orchestrator is not running. Nothing was sent.",
    );
  }
  if (status === 401 || status === 403) {
    return refused(
      "orchestrator_rejected_credentials",
      502,
      "The orchestrator refused the gateway's credentials. Nothing was sent.",
    );
  }
  if (status >= 400 && status < 500) {
    return refused(
      "orchestrator_rejected_request",
      502,
      "The orchestrator refused the request. Nothing was sent.",
    );
  }
  return unknownOutcome(
    "The orchestrator answered with a server error, so whether the agent acted is not known.",
  );
}

interface Receipt {
  id: string;
  agent_name: string;
  action: string;
  status: ReceiptStatus;
  requested_at: string;
  completed_at: string | null;
  error_code: string | null;
}

/**
 * How a pending receipt was checked against the orchestrator on this read.
 *   settled    — the orchestrator's record was written onto the receipt now
 *   running    — the orchestrator is still working on it (a "running" record is
 *                written the moment its dispatch begins — health_routes.py's
 *                `operate_agent` — so this covers the whole time it runs, not only
 *                a future async path)
 *   absent     — the orchestrator has no record: never received, it restarted since
 *                (its record lives only in memory), or the record aged out of its
 *                own window. No longer covers "still in progress" as a common case —
 *                see "running" above.
 *   unreadable — the orchestrator could not be asked, or its record was malformed
 *   unchanged  — its record was read but the receipt could not be saved
 *   expired    — older than the orchestrator keeps records; not asked
 *   null       — the receipt was already settled; nothing to ask
 */
export type RemoteCheck =
  | "settled"
  | "running"
  | "absent"
  | "unreadable"
  | "unchanged"
  | "expired"
  | null;

/** Platform routes have no restaurant parameter. Every entry requires both guards. */
@Controller("health/agent-operations")
@UseGuards(JwtAuthGuard, PlatformOperatorGuard)
@TenantBypass()
export class AgentOperationsController {
  private readonly logger = new Logger(AgentOperationsController.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly orchestrator: OrchestratorService,
  ) {}

  /**
   * The latest 25 receipts. A receipt with no settled outcome is read-repaired from the
   * orchestrator's own record of that request id, so a timeout or a lost final update
   * does not leave "unknown" standing once the orchestrator knows the answer. The write
   * is conditional on the receipt still being pending, so a repeat is harmless.
   */
  @Get()
  async recent() {
    const { data, error } = await this.database.client
      .from("platform_agent_operations")
      .select("id,agent_name,action,status,requested_at,completed_at,error_code")
      .order("requested_at", { ascending: false })
      .limit(25);
    if (error) {
      throw new ServiceUnavailableException("Operation receipts could not be read.");
    }
    const rows = (data ?? []) as Receipt[];
    return { operations: await Promise.all(rows.map((row) => this.reconcile(row))) };
  }

  @Post(":name/:action")
  async operate(
    @Param("name") name: string,
    @Param("action") action: string,
    @Body() body: AgentOperationDto,
    @CurrentUser("userId") userId: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (!isSafePathSegment(name) || !["restart", "stop"].includes(action)) {
      throw new BadRequestException("Unknown agent operation.");
    }
    const receipt = {
      id: body.requestId,
      actor_id: userId,
      agent_name: name,
      action,
      status: "requested",
    };
    const { error: recordError } = await this.database.client
      .from("platform_agent_operations")
      .insert(receipt);
    if (recordError?.code === "23505") {
      throw new ConflictException(
        "This request was already recorded. Refresh the operation receipts before acting again.",
      );
    }
    if (recordError) {
      throw new ServiceUnavailableException(
        "The operation was not sent because its receipt could not be recorded.",
      );
    }

    let verdict: OperationVerdict;
    try {
      verdict = verdictFromAnswer(
        await this.orchestrator.operateAgent(
          name,
          action as "restart" | "stop",
          body.requestId,
        ),
        body.requestId,
      );
    } catch (error) {
      verdict = verdictFromError(error);
      // The class and code only: a remote message can carry another house's data.
      const code = isAxiosError(error)
        ? `${error.code ?? "no-code"} ${error.response?.status ?? "no-response"}`
        : error instanceof Error
          ? error.name
          : typeof error;
      this.logger.warn(
        `Agent operation ${action} on ${name} (${body.requestId}): ${verdict.status}/${verdict.errorCode} (${code})`,
      );
    }

    const { error } = await this.database.client
      .from("platform_agent_operations")
      .update({
        status: verdict.status,
        completed_at: verdict.status === "running" ? null : new Date().toISOString(),
        error_code: verdict.errorCode,
      })
      .eq("id", body.requestId)
      .eq("actor_id", userId);
    const result = {
      id: body.requestId,
      agent: name,
      action,
      status: verdict.status,
      errorCode: verdict.errorCode,
      receiptRecorded: !error,
    };
    if (verdict.status === "succeeded") return result;
    if (verdict.status === "running") {
      res?.status(202);
      return { ...result, message: verdict.message };
    }
    throw new HttpException({ ...result, message: verdict.message }, verdict.httpStatus);
  }

  private async reconcile(row: Receipt): Promise<Receipt & { remote: RemoteCheck }> {
    if (!PENDING.includes(row.status)) return { ...row, remote: null };
    const requestedAt = Date.parse(row.requested_at);
    if (!Number.isFinite(requestedAt) || Date.now() - requestedAt > RECONCILE_WINDOW_MS) {
      return { ...row, remote: "expired" };
    }
    let record: Record<string, unknown>;
    try {
      const answer = await this.orchestrator.getAgentOperation(row.id);
      record =
        answer && typeof answer === "object" ? (answer as Record<string, unknown>) : {};
    } catch (error) {
      const absent = isAxiosError(error) && error.response?.status === 404;
      return { ...row, remote: absent ? "absent" : "unreadable" };
    }
    if (
      record.request_id !== row.id ||
      record.agent !== row.agent_name ||
      record.action !== row.action ||
      !["running", "succeeded", "failed"].includes(record.state as string)
    ) {
      return { ...row, remote: "unreadable" };
    }
    const state = record.state as "running" | "succeeded" | "failed";
    if (state === "running" && row.status === "running") {
      return { ...row, remote: "running" };
    }
    const finishedAt =
      typeof record.finished_at === "string" && Number.isFinite(Date.parse(record.finished_at))
        ? record.finished_at
        : null;
    const repaired = {
      status: state,
      completed_at: state === "running" ? null : (finishedAt ?? new Date().toISOString()),
      error_code: state === "failed" ? "agent_operation_failed" : null,
    };
    const { error } = await this.database.client
      .from("platform_agent_operations")
      .update(repaired)
      .eq("id", row.id)
      .in("status", PENDING);
    if (error) return { ...row, remote: "unchanged" };
    return { ...row, ...repaired, remote: state === "running" ? "running" : "settled" };
  }
}
