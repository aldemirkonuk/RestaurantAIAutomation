import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../auth/decorators/public.decorator";
import { ServiceKeyGuard } from "../../auth/guards/service-key.guard";
import { OrderRequestService } from "./order-request.service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /internal/letters/order-request — the orchestrator's one door to the
 * order-request letter (W25; ADR 0313, 4a-i).
 *
 * A SERVICE route, not a person's. `@Public()` silences the JWT check so that
 * `ServiceKeyGuard` (X-Admin-Key / ADMIN_API_KEY, ADR 0099; fails closed on an
 * unset key) is what decides. Same shape as `ux-optimizer.controller.ts:66-79`
 * and `identity-curation.controller.ts`. This controller carries NO class
 * guard on purpose: a class-level JwtAuthGuard would refuse the service, and a
 * method without ServiceKeyGuard here would be open to the internet.
 * `check_route_exposure.py` reports this route as "public" and cannot tell the
 * two apart, so the CLAIMS row W25-ORDER-REQUEST-ROUTE-SERVICE-KEY is its guard.
 *
 * NO TENANCY FROM THE REQUEST. The house is the order row's `restaurant_id`;
 * a `restaurant_id` in the body is only a cross-check (a mismatch is a 404).
 *
 * The body is read by hand, not through a DTO class: the global
 * ValidationPipe runs with `forbidNonWhitelisted`, and these four keys are the
 * whole contract.
 */
@ApiTags("letters")
@Controller("internal/letters")
export class OrderRequestController {
  constructor(private readonly orderRequests: OrderRequestService) {}

  @Post("order-request")
  @Public()
  @UseGuards(ServiceKeyGuard)
  @HttpCode(200)
  @ApiHeader({ name: "X-Admin-Key", required: true })
  @ApiOperation({
    summary:
      "Render an order's request letter, and with stage:true stage it as ORDER_REQUEST — service key only",
  })
  async orderRequest(@Body() body: Record<string, unknown>) {
    const b = body ?? {};
    const allowed = new Set(["order_id", "restaurant_id", "courtesy_sentence", "stage"]);
    const extra = Object.keys(b).filter((k) => !allowed.has(k));
    if (extra.length > 0) {
      throw new BadRequestException(`Unknown field(s): ${extra.join(", ")}.`);
    }
    if (typeof b.order_id !== "string" || !UUID_RE.test(b.order_id)) {
      throw new BadRequestException("order_id must be a uuid.");
    }
    if (b.restaurant_id != null && (typeof b.restaurant_id !== "string" || !UUID_RE.test(b.restaurant_id))) {
      throw new BadRequestException("restaurant_id, when sent, must be a uuid.");
    }
    if (b.courtesy_sentence != null && typeof b.courtesy_sentence !== "string") {
      throw new BadRequestException("courtesy_sentence, when sent, must be text.");
    }
    if (b.stage != null && typeof b.stage !== "boolean") {
      throw new BadRequestException("stage, when sent, must be true or false.");
    }
    return {
      success: true,
      ...(await this.orderRequests.render({
        orderId: b.order_id,
        restaurantId: (b.restaurant_id as string | undefined) ?? null,
        courtesySentence: (b.courtesy_sentence as string | undefined) ?? null,
        stage: b.stage === true,
      })),
    };
  }
}
