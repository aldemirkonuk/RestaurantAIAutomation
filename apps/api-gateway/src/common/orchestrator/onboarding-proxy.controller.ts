/**
 * Onboarding Extract Proxy (ADR 0021).
 *
 * `CommandBar` posts every PDF/photo ingestion to `/api/v1/onboarding/extract`. Once
 * studio calls moved back onto relative paths (see `pages/studio/studioApi.ts`), that
 * request follows the same `/api` proxy/rewrite as everything else and lands on this
 * gateway — which served `onboarding/progress`, `threshold` and `vendor-email`, but had
 * no `extract` route. Without this controller the founder's chosen routing would have
 * traded a working ingestion path for a 404, which is why it ships alongside.
 *
 * Deliberately a separate controller from the existing `OnboardingController`
 * (`menus/menus.controller.ts:68`): that one lives in the menus module and is about
 * onboarding *progress*, while this is a transport concern belonging next to the other
 * orchestrator proxies. No path collision — the verbs and sub-paths are disjoint.
 *
 * Auth: JwtAuthGuard here, then the orchestrator re-checks with `require_admin_or_studio`
 * (`api/auth.py:46`), which accepts a studio-role bearer token. The caller's own token is
 * forwarded rather than `X-Admin-Key`, so the orchestrator still attributes spend to the
 * real user — `api/auth.py:56-57` notes that spend accounting keys on that subject, and
 * substituting the admin key would bill every extraction to "admin-key".
 */
import {
  Body,
  Controller,
  Headers,
  HttpException,
  Post,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { TenantBypass } from "../tenant/tenant.decorator";
import { OrchestratorService } from "./orchestrator.service";

@Controller("onboarding")
@UseGuards(JwtAuthGuard)
@TenantBypass()
export class OnboardingProxyController {
  constructor(private readonly orchestratorService: OrchestratorService) {}

  @Post("extract")
  async extract(
    @Body() body: unknown,
    @Headers("authorization") authorization: string,
  ) {
    const { status, data } =
      await this.orchestratorService.proxyOnboardingExtract(
        authorization,
        body,
      );
    if (status >= 400) {
      throw new HttpException(
        data ?? { message: "Extraction failed" },
        status,
      );
    }
    return data;
  }
}
