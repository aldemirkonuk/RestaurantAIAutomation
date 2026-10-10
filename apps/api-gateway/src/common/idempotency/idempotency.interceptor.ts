import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import {
  Observable,
  finalize,
  from,
  of,
  switchMap,
  tap,
  throwError,
} from "rxjs";
import { DatabaseService } from "../../database/database.service";

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/**
 * The status a claimed key carries while its first request is still running
 * (HTTP 102 Processing). Never a stored answer: only 2xx answers are stored.
 */
const PENDING_STATUS = 102;

/**
 * How long a claim holds before it counts as abandoned (a gateway that died
 * mid-request never releases it). Longer than the slowest write a client
 * waits for: the menu read is given 300 s.
 */
const CLAIM_TTL_MS = 10 * 60_000;

/** What a re-send hears while its first attempt is still running. */
export const STILL_RUNNING_MESSAGE =
  "This is still being saved from your last try. Wait a moment, then try again; it will not be added twice.";

type StoredAnswer = { status_code: number; response: any };
type Claim =
  | { kind: "claimed" }
  | { kind: "replay"; stored: StoredAnswer }
  | { kind: "running" }
  | { kind: "open" };

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
 * In-flight claim (F-566): the first request inserts a pending row for its key
 * BEFORE the handler runs (the key is the table's primary key, so only one
 * insert lands). A duplicate that arrives while the first is still running
 * gets 409 with STILL_RUNNING_MESSAGE instead of running the handler a second
 * time. A 2xx answer completes the row; an error, a non-2xx answer or no
 * answer releases it so the client may retry with the same key. A claim older
 * than CLAIM_TTL_MS is taken over.
 *
 * Keys are scoped per user so clients cannot collide with (or read) each
 * other's responses. Fails open if the dedupe table is unreachable — a lost
 * dedupe is better than a blocked approval.
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

    return from(this.claim(key, request)).pipe(
      switchMap((claim) => {
        if (claim.kind === "replay") {
          const response = context.switchToHttp().getResponse();
          if (typeof response?.status === "function") {
            response.status(claim.stored.status_code);
          }
          response?.setHeader?.("x-idempotent-replay", "true");
          return of(claim.stored.response);
        }
        if (claim.kind === "running") {
          return throwError(() => new ConflictException(STILL_RUNNING_MESSAGE));
        }
        const claimed = claim.kind === "claimed";
        let completed = false;
        return next.handle().pipe(
          tap((body) => {
            const response = context.switchToHttp().getResponse();
            const statusCode = response?.statusCode ?? 200;
            if (statusCode >= 200 && statusCode < 300) {
              completed = true;
              void (claimed
                ? this.complete(key, statusCode, body)
                : this.store(key, request, statusCode, body));
            }
          }),
          finalize(() => {
            if (claimed && !completed) void this.release(key);
          }),
        );
      }),
    );
  }

  /**
   * Take the key before the handler runs. A key already taken answers with its
   * stored result, or "running" while its first request is still going; an
   * abandoned claim is taken over once. Any database failure fails open.
   */
  private async claim(
    key: string,
    request: any,
    retried = false,
  ): Promise<Claim> {
    try {
      const { error } = await this.databaseService.supabase
        .from("api_idempotency_keys")
        .insert({
          key,
          user_id: request.user?.userId ?? null,
          method: request.method,
          path: request.url ?? "",
          status_code: PENDING_STATUS,
          response: null,
        });
      if (!error) return { kind: "claimed" };
      if (error.code !== "23505") {
        this.logger.warn(`idempotency claim failed: ${error.message}`);
        return { kind: "open" };
      }
    } catch (e: any) {
      this.logger.warn(`idempotency claim threw: ${e?.message}`);
      return { kind: "open" };
    }

    const existing = await this.lookup(key);
    if (existing && existing.status_code !== PENDING_STATUS) {
      return { kind: "replay", stored: existing };
    }
    if (retried) return { kind: "running" };
    if (!existing) {
      // Released between our insert and our read: the first run failed.
      return this.claim(key, request, true);
    }
    const age = Date.now() - new Date(existing.created_at).getTime();
    if (age > CLAIM_TTL_MS) {
      await this.release(
        key,
        new Date(Date.now() - CLAIM_TTL_MS).toISOString(),
      );
      return this.claim(key, request, true);
    }
    return { kind: "running" };
  }

  private async lookup(
    key: string,
  ): Promise<(StoredAnswer & { created_at: string }) | null> {
    try {
      const { data, error } = await this.databaseService.supabase
        .from("api_idempotency_keys")
        .select("status_code, response, created_at")
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

  /** Turn this request's pending claim into its stored answer. */
  private async complete(
    key: string,
    statusCode: number,
    body: any,
  ): Promise<void> {
    try {
      const { error } = await this.databaseService.supabase
        .from("api_idempotency_keys")
        .update({ status_code: statusCode, response: body ?? null })
        .eq("key", key)
        .eq("status_code", PENDING_STATUS);
      if (error)
        this.logger.warn(`idempotency complete failed: ${error.message}`);
    } catch (e: any) {
      this.logger.warn(`idempotency complete threw: ${e?.message}`);
    }
  }

  /**
   * Drop a pending claim so the same key may run again. With `olderThan`,
   * only a claim made before that instant (an abandoned one) is dropped.
   */
  private async release(key: string, olderThan?: string): Promise<void> {
    try {
      let query = this.databaseService.supabase
        .from("api_idempotency_keys")
        .delete()
        .eq("key", key)
        .eq("status_code", PENDING_STATUS);
      if (olderThan) query = query.lt("created_at", olderThan);
      const { error } = await query;
      if (error)
        this.logger.warn(`idempotency release failed: ${error.message}`);
    } catch (e: any) {
      this.logger.warn(`idempotency release threw: ${e?.message}`);
    }
  }

  private async store(
    key: string,
    request: any,
    statusCode: number,
    body: any,
  ): Promise<void> {
    try {
      // Only when no claim could be made (the table did not answer then).
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
