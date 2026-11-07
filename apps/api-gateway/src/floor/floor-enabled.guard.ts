import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { isFloorCheckerEnabled } from "./floor-flag";

/**
 * Every floor route is dark until the house's `floor_checker` switch is on
 * (ADR 0345 E7). A switched-off house gets 404, the same answer as a route
 * that does not exist, so the floor is not discoverable before its rollout.
 *
 * It runs after `JwtAuthGuard` and `RolesGuard` (listed after them in each
 * controller's `@UseGuards`), so the house is the verified token's and a
 * wrong role is still a 403 whatever the switch says.
 */
@Injectable()
export class FloorEnabledGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const restaurantId =
      typeof req?.user?.restaurantId === "string" ? req.user.restaurantId : "";
    if (!restaurantId) throw new NotFoundException();
    if (!(await isFloorCheckerEnabled(this.db.supabase, restaurantId))) {
      throw new NotFoundException();
    }
    return true;
  }
}
