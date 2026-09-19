import { CanActivate, ExecutionContext, ForbiddenException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";

/** Never use a house role or the JWT's cached Studio roles as platform authority. */
@Injectable()
export class PlatformOperatorService {
  constructor(private readonly database: DatabaseService) {}

  async isOperator(userId: string | undefined): Promise<boolean> {
    if (!userId) return false;
    const [grant, role] = await Promise.all([
      this.database.client.from("platform_operator_grants").select("enabled")
        .eq("user_id", userId).eq("enabled", true).maybeSingle(),
      this.database.client.from("user_roles").select("id")
        .eq("user_id", userId).eq("role", "developer").is("revoked_at", null).limit(1),
    ]);
    if (grant.error || role.error) {
      throw new ServiceUnavailableException("Platform permission could not be verified.");
    }
    return grant.data?.enabled === true && Array.isArray(role.data) && role.data.length > 0;
  }
}

@Injectable()
export class PlatformOperatorGuard implements CanActivate {
  constructor(private readonly operators: PlatformOperatorService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest().user;
    if (!(await this.operators.isOperator(user?.userId))) {
      throw new ForbiddenException("This action requires a platform operator.");
    }
    return true;
  }
}
