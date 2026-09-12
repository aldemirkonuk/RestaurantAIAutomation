/**
 * Studio Proxy Controller (ADR 0021)
 *
 * The three studio pages call `/api/v1/studio/*` with a relative URL. Nothing served that
 * prefix: `apps/web/vite.config.ts:25-28` proxies `/api` to this gateway in dev and
 * `apps/web/vercel.json:6-9` rewrites it to this gateway in prod, but the gateway had no
 * studio module — so every studio call 404'd in both environments while the endpoints sat
 * implemented in the orchestrator. This closes that gap by forwarding the prefix.
 *
 * Auth flow:
 *   1. JwtAuthGuard validates the gateway-issued JWT (any logged-in user).
 *   2. TenantBypass skips the restaurant check — studio is not tenant-scoped; its audience
 *      is developer / certified_contributor / review_admin, not restaurant users.
 *   3. The caller's own Bearer token is forwarded, and the orchestrator re-verifies it and
 *      does the per-endpoint role check. Authorization is decided there, not here.
 *
 * This controller deliberately holds no role logic of its own: duplicating the role gates
 * here would mean two places to keep in sync, and the orchestrator's checks are the ones
 * that actually guard the data.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { TenantBypass } from "../tenant/tenant.decorator";
import { OrchestratorService } from "./orchestrator.service";

@Controller("studio")
@UseGuards(JwtAuthGuard)
@TenantBypass()
export class StudioProxyController {
  constructor(private readonly orchestratorService: OrchestratorService) {}

  // Verbs are listed explicitly rather than with @All: @All binds every method Express
  // knows, which would publish TRACE, PURGE, SEARCH and two dozen others on this prefix
  // for no reason. These five are what the studio API actually uses.

  @Get("*")
  get(
    @Req() req: Request,
    @Param() params: Record<string, string>,
    @Query() query: Record<string, any>,
    @Headers("authorization") authorization: string,
  ) {
    return this.forward(req, params, query, undefined, authorization);
  }

  @Post("*")
  post(
    @Req() req: Request,
    @Param() params: Record<string, string>,
    @Query() query: Record<string, any>,
    @Body() body: unknown,
    @Headers("authorization") authorization: string,
  ) {
    return this.forward(req, params, query, body, authorization);
  }

  @Patch("*")
  patch(
    @Req() req: Request,
    @Param() params: Record<string, string>,
    @Query() query: Record<string, any>,
    @Body() body: unknown,
    @Headers("authorization") authorization: string,
  ) {
    return this.forward(req, params, query, body, authorization);
  }

  @Put("*")
  put(
    @Req() req: Request,
    @Param() params: Record<string, string>,
    @Query() query: Record<string, any>,
    @Body() body: unknown,
    @Headers("authorization") authorization: string,
  ) {
    return this.forward(req, params, query, body, authorization);
  }

  @Delete("*")
  remove(
    @Req() req: Request,
    @Param() params: Record<string, string>,
    @Query() query: Record<string, any>,
    @Headers("authorization") authorization: string,
  ) {
    return this.forward(req, params, query, undefined, authorization);
  }

  private async forward(
    req: Request,
    params: Record<string, string>,
    query: Record<string, any>,
    body: unknown,
    authorization: string,
  ) {
    // Express 4 exposes the `*` wildcard as params["0"].
    const subPath = params["0"] ?? "";
    const { status, data } = await this.orchestratorService.proxyStudio(
      req.method,
      subPath,
      authorization,
      body,
      query,
    );
    if (status >= 400) {
      throw new HttpException(
        data ?? { message: "Studio request failed" },
        status,
      );
    }
    return data;
  }
}
