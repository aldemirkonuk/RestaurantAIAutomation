import { Global, MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ModelClientService } from "./model-client.service";
import { correlationMiddleware } from "./correlation";

/**
 * ModelClientModule — the one place gateway code may talk to
 * api.anthropic.com (P1 §5.3; the CI guard in P1 §5.4 greps for exactly that).
 *
 * @Global like DatabaseModule and RateLimitModule: seven modules across the
 * gateway consume it, and infrastructure this cross-cutting should not need
 * seven imports lines to exist — the same call DatabaseModule already made.
 *
 * Also registers the correlation middleware for every route, so any model
 * call made inside an HTTP request inherits a request-scoped correlation_id
 * with zero per-site plumbing (see ./correlation.ts for the ALS rationale).
 */
@Global()
@Module({
  providers: [ModelClientService],
  exports: [ModelClientService],
})
export class ModelClientModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(correlationMiddleware).forRoutes("*");
  }
}
