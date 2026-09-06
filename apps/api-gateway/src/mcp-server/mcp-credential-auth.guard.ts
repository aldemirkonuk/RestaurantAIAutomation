import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { McpCredentialsService } from "./mcp-credentials.service";
import { McpRequest } from "./mcp-server.types";

/**
 * The one door into the MCP server, and the only thing that decides a tenant
 * for it.
 *
 * WHY NOT `JwtAuthGuard`
 * ----------------------
 * A gateway JWT is a PERSON's browser session. An assistant holding one would
 * act with that person's full authority, could not be revoked without ending
 * that person's session, and would silently outlive their role change. §7b of
 * the capability note says the token comes from `auth.service.ts:521-536`; that
 * was written before ADR 0114 made the attachment the HOUSE's rather than a
 * person's, and a per-house revocable key is the shape that survived. ADR 0132
 * records the fork and why the JWT lost it.
 *
 * WHY THE GLOBAL GUARDS DO NOT COVER THIS ROUTE
 * ---------------------------------------------
 * `TenantGuard` returns true when `request.user` is unset
 * (`common/tenant/tenant.guard.ts:47-52`), and an MCP request never sets it —
 * so it fails open here by construction, exactly as §7.1 warned. `RateLimitGuard`
 * would key this route on the client's IP, pooling every assistant behind one
 * NAT into one bucket. Both gaps are closed inside this module: the tenant comes
 * from the credential row and nowhere else, and the rate limit is per credential.
 *
 * The class is named `…AuthGuard` deliberately: `check_route_exposure.py`
 * recognises a guard as an authentication declaration only when its name
 * carries `Jwt` or `Auth`, and a route whose exposure is declared by a guard the
 * ratchet cannot see is a route that has not declared anything.
 */
@Injectable()
export class McpCredentialAuthGuard implements CanActivate {
  constructor(private readonly credentials: McpCredentialsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<McpRequest>();
    const header = request.headers?.authorization;
    const raw = Array.isArray(header) ? header[0] : header;
    const presented =
      typeof raw === "string" && raw.toLowerCase().startsWith("bearer ")
        ? raw.slice(7)
        : null;

    const outcome = await this.credentials.verify(presented);
    if (!outcome.ok) {
      // The reason is the client's to see. An assistant told only "401" retries;
      // an assistant told "that key was revoked on <date>" tells its user.
      throw new UnauthorizedException(outcome.reason);
    }

    request.mcpCredential = outcome.credential;
    return true;
  }
}
