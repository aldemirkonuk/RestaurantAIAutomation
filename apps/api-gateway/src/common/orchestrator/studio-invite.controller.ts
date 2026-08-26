/**
 * Studio Invite Controller (ADR 0021).
 *
 * Intercepts POST /api/v1/studio/invite so the gateway *delivers* the invite instead of
 * handing the link back to the admin to forward manually.
 *
 * Why here and not in the orchestrator: the orchestrator mints the token (and enforces
 * review_admin on that endpoint), but email lives in the gateway — GmailService, its
 * templates, and the Gmail/SMTP credentials are all Node-side. Giving the Python service a
 * second mailer to duplicate would mean two sets of credentials and two template systems.
 * So the gateway mints *through* the orchestrator, then sends.
 *
 * ROUTE ORDER MATTERS: StudioProxyController declares `@Post("*")` on the same `studio`
 * prefix. Express matches in registration order, so this controller must be listed BEFORE
 * StudioProxyController in OrchestratorModule's `controllers` array or the wildcard
 * swallows this route and the email is never sent. There is a test for exactly that.
 *
 * The token is deliberately NOT returned on success — it goes to the database and the
 * invitee's inbox, nowhere else. It reappears only if delivery fails, as a recovery path
 * for the admin, since by then the row exists and would otherwise be stranded.
 */
import {
  Body,
  Controller,
  Headers,
  HttpException,
  Logger,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { TenantBypass } from "../tenant/tenant.decorator";
import { OrchestratorService } from "./orchestrator.service";
import { GmailService } from "../../communications/gmail.service";

const ROLE_LABELS: Record<string, string> = {
  developer: "Developer",
  review_admin: "Review Admin",
  certified_contributor: "Certified Contributor",
};

interface CreateStudioInviteBody {
  role: string;
  target_email: string;
}

@Controller("studio")
@UseGuards(JwtAuthGuard)
@TenantBypass()
export class StudioInviteController {
  private readonly logger = new Logger(StudioInviteController.name);

  constructor(
    private readonly orchestratorService: OrchestratorService,
    private readonly gmailService: GmailService,
    private readonly config: ConfigService,
  ) {}

  @Post("invite")
  async createAndSend(
    @Body() body: CreateStudioInviteBody,
    @Headers("authorization") authorization: string,
  ) {
    // Mint through the orchestrator, which owns the review_admin check and the table.
    // Authorization is not re-implemented here; a non-admin gets the orchestrator's 403.
    const { status, data } = await this.orchestratorService.proxyStudio(
      "POST",
      "invite",
      authorization,
      body,
      {},
    );
    if (status >= 400) {
      throw new HttpException(
        data ?? { message: "Could not create the invite" },
        status,
      );
    }

    const token = data?.token;
    if (!token) {
      this.logger.error(
        "Orchestrator returned a success with no token — cannot send invite",
      );
      throw new HttpException(
        { message: "The invite was not created correctly. Nothing was sent." },
        502,
      );
    }

    const base =
      this.config.get<string>("FRONTEND_URL")?.split(",")[0]?.trim() ||
      "https://restaurant-ai-automation-web.vercel.app";
    const inviteUrl = `${base}/studio/invite/${token}`;
    const roleLabel = ROLE_LABELS[data.role] ?? data.role;
    const expiresOn = data.expires_at
      ? new Date(data.expires_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "in 7 days";

    const result = await this.gmailService.sendStudioInviteEmail({
      to: body.target_email,
      roleLabel,
      inviteUrl,
      expiresOn,
    });

    if (!result.success) {
      // The row exists and is bound to this address. Surfacing the link is the only way
      // the admin can still deliver it; the alternative is a silently orphaned invite.
      this.logger.error(
        `Studio invite minted but delivery failed to ${body.target_email}: ${result.error}`,
      );
      return {
        sent: false,
        email: body.target_email,
        role: data.role,
        expires_at: data.expires_at,
        delivery_error: result.error ?? "Unknown email error",
        invite_url: inviteUrl,
      };
    }

    this.logger.log(
      `Studio invite sent to ${body.target_email} for role ${data.role}`,
    );
    return {
      sent: true,
      email: body.target_email,
      role: data.role,
      expires_at: data.expires_at,
    };
  }
}
