import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, from, of, switchMap, tap } from "rxjs";
import { DatabaseService } from "../../database/database.service";

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/**
 * Replay-safe mutations for the mobile outbox.
 *
 * The mobile app queues actions offline and replays them on reconnect; a flaky
 * network can also cause client retries of an already-applied request. Any
 * request carrying an Idempotency-Key header is deduped here: the first
 * execution stores its JSON response, every replay of the same key returns
 * that stored response without re-running the handler. Approving an order
 * twice therefore sends exactly one vendor email.
 *
 * Keys are scoped per user so clients cannot collide with (or read) each
 * other's responses. Only 2xx responses are stored; errors pass through so
 * the client may retry with the same key. Fails open if the dedupe table is
 * unreachable — a lost dedupe is better than a blocked approval.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly databaseService: DatabaseService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const header = request.headers?.["idempotency-key"];

    if (
      !header ||
      typeof header !== "string" ||
      header.length > 200 ||
      !MUTATING_METHODS.has(request.method)
    ) {
      return next.handle();
    }

    const userId = request.user?.userId ?? "anon";
    const key = `${userId}:${header}`;

    return from(this.lookup(key)).pipe(
      switchMap((stored) => {
        if (stored) {
          const response = context.switchToHttp().getResponse();
          if (typeof response?.status === "function") {
            response.status(stored.status_code);
          }
          response?.setHeader?.("x-idempotent-replay", "true");
          return of(stored.response);
        }
        return next.handle().pipe(
          tap((body) => {
            const response = context.switchToHttp().getResponse();
            const statusCode = response?.statusCode ?? 200;
            if (statusCode >= 200 && statusCode < 300) {
              void this.store(key, request, statusCode, body);
            }
          }),
        );
      }),
    );
  }

  private async lookup(
    key: string,
  ): Promise<{ status_code: number; response: any } | null> {
    try {
      const { data, error } = await this.databaseService.supabase
        .from("api_idempotency_keys")
        .select("status_code, response")
        .eq("key", key)
        .maybeSingle();
      if (error) {
        this.logger.warn(`idempotency lookup failed: ${error.message}`);
        return null;
      }
      return data ?? null;
    } catch (e: any) {
      this.logger.warn(`idempotency lookup threw: ${e?.message}`);
      return null;
    }
  }

  private async store(
    key: string,
    request: any,
    statusCode: number,
    body: any,
  ): Promise<void> {
    try {
      // Insert (not upsert): under a race the first writer wins and the loser
      // has already executed anyway — both executions returned the same real
      // outcome to the same client.
      await this.databaseService.supabase.from("api_idempotency_keys").insert({
        key,
        user_id: request.user?.userId ?? null,
        method: request.method,
        path: request.url ?? "",
        status_code: statusCode,
        response: body ?? null,
      });
    } catch (e: any) {
      this.logger.warn(`idempotency store threw: ${e?.message}`);
    }
  }
}
