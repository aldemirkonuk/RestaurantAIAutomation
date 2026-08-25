import { randomUUID } from "crypto";
import { AsyncLocalStorage } from "async_hooks";

/**
 * Request-scoped correlation for the gateway (P1 step 3).
 *
 * WHY AsyncLocalStorage AND NOT AN INTERCEPTOR
 * --------------------------------------------
 * The id must survive into fire-and-forget continuations — the gateway's
 * standing convention for side writes is `void this.somePromise()` (~30
 * occurrences), and the NF emitter itself is fire-and-forget. An interceptor
 * can stamp the request object, but the request object is not in scope inside
 * a service three layers down, so every signature between the controller and
 * the model call would need a threading parameter — exactly the copy-paste
 * plumbing that produced the 4-way timeout disagreement this branch fixes.
 * ALS propagates through the whole async chain (including un-awaited
 * promises created inside the context) with zero signature changes, and the
 * one non-HTTP entry point (the RabbitMQ inbound-email consumer) passes its
 * Python-minted correlation_id explicitly instead, which is the only join to
 * `decision_log` that is truthful rather than fabricated.
 *
 * The middleware (not an interceptor) starts the context because middleware
 * wraps the ENTIRE downstream chain — guards included — inside `als.run()`,
 * whereas an interceptor's `next.handle()` observable is subscribed outside
 * the `run()` callback and loses the store on some Nest versions.
 */
const als = new AsyncLocalStorage<{ correlationId: string }>();

/** Current request's correlation id, or null outside any correlation scope. */
export function getCorrelationId(): string | null {
  return als.getStore()?.correlationId ?? null;
}

/** Run `fn` inside an explicit correlation scope (non-HTTP entry points). */
export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return als.run({ correlationId }, fn);
}

/**
 * Establish a FRESH correlation scope for a unit of work that has no upstream
 * id — a `@Cron` sweep, a bootstrap task, a queue consumer whose message did
 * not carry one.
 *
 * Why this exists: the middleware below only covers HTTP. Outside a request
 * `getCorrelationId()` returns null, so every NF row the work emits lands with
 * `correlation_id` NULL and drops out of the cross-runtime join P1 exists to
 * enable — silently, because a null column is not an error. Verified against
 * the live table on 2026-08-24: a model call made outside any request wrote
 * neural_footprint_event row 7adb9aea with correlation_id NULL.
 *
 * Scope it per UNIT OF WORK (one document, one message), NOT per sweep, so the
 * id means on this path exactly what it means on the HTTP path: one id groups
 * the rows of one thing that happened. Wrapping a whole sweep would file
 * unrelated documents under a single id and make the join lie.
 *
 * Do NOT use this where an id already exists — inside a request (the
 * middleware has already opened a scope) or on the RabbitMQ path (which passes
 * Python's own correlation_id explicitly). Minting a new one there REPLACES
 * the real id and breaks the join it is meant to preserve.
 */
export function runWithNewCorrelationId<T>(fn: () => T): T {
  return runWithCorrelationId(randomUUID(), fn);
}

/**
 * Express-style functional middleware registered by ModelClientModule for all
 * routes. Honors a caller-supplied `x-correlation-id` (so a web client or an
 * upstream service can pre-correlate), otherwise mints one — matching the
 * Python side's `message.get("correlation_id") or uuid4()`
 * (services/agent-orchestrator/core/base_agent.py:549-550). Echoed on the
 * response header so a failing request can be joined to its NF rows from a
 * browser network tab alone.
 */
export function correlationMiddleware(req: any, res: any, next: () => void) {
  const fromHeader = req?.headers?.["x-correlation-id"];
  const correlationId =
    typeof fromHeader === "string" && fromHeader.trim()
      ? fromHeader.trim().slice(0, 128)
      : randomUUID();
  if (res?.setHeader) res.setHeader("x-correlation-id", correlationId);
  runWithCorrelationId(correlationId, next);
}
