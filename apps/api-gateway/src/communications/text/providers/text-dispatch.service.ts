/**
 * The one place in this product where a text message leaves the building.
 *
 * WHY IT IS ITS OWN FILE
 * ----------------------
 * `text-transport.spec.ts`'s "the adapters cannot send" block reads
 * `meta-cloud.adapter.ts`, `twilio.adapter.ts` and `text-transport.registry.ts`
 * off disk with comments stripped and fails if any HTTP primitive appears in
 * them. That assertion is NOT relaxed by this file and is not deleted — it is
 * the reason `dispatch` lives here instead of on the adapters. The adapters
 * stay pure (`buildRequest`, `parseResponse`), the registry stays a credential
 * check, and the network call is one function in one file that a census can
 * name. `whatsapp-send.spec.ts` carries the completing assertion: this is the
 * ONLY file under `communications/text/` that holds an HTTP primitive.
 *
 * WHY IT TAKES A REQUEST AND NOT A MESSAGE
 * ----------------------------------------
 * `dispatch` cannot choose a URL, cannot choose a body, and cannot decide
 * whether a window is open. It is handed a `TransportRequest` that an adapter
 * already built under the provider's own rules, and it performs it. That is
 * what makes "a message the provider would refuse is refused in the house's
 * language" enforceable: every refusal that can be known before the call has
 * already happened by the time this runs.
 *
 * THE THREE OUTCOMES, AND WHY THE THIRD IS NOT AN ERROR
 * -----------------------------------------------------
 *   `answered`      the provider replied; the adapter parses it.
 *   `unreachable`   the call did not complete — DNS, timeout, socket. Whether
 *                   the provider received it is UNKNOWN, and this is reported
 *                   as unknown rather than as a failure. A timed-out POST can
 *                   have been accepted; reporting it as "not sent" would tell a
 *                   manager to send again, which is how a vendor gets the same
 *                   message twice.
 *   `unreadable`    the provider answered with something that is not JSON.
 *
 * `fetch` is injectable so a spec can drive all three without a network. The
 * default is the runtime's own global — Node 18+ — and there is no HTTP client
 * dependency to add.
 */

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { TransportRequest } from "./text-transport";

export type DispatchKind = "answered" | "unreachable" | "unreadable";

export interface DispatchResult {
  kind: DispatchKind;
  /** HTTP status, when there was a response. */
  status: number | null;
  /** Parsed JSON body, when there was one. */
  body: unknown;
  /** The sentence for a person. Always populated. */
  detail: string;
}

/** The shape of `globalThis.fetch`, narrowed to what this file uses. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{ status: number; text(): Promise<string> }>;

/**
 * How long to wait. Deliberately short: a manager is watching a composer, and
 * a request that hangs for a minute is a request they will retry by hand.
 */
export const DISPATCH_TIMEOUT_MS = 15_000;

/**
 * The injection token for a stand-in `fetch`.
 *
 * `@Optional()` and nothing binds it in `TextSendersModule`, so production
 * resolves to `null` and falls through to the runtime's own global. A spec
 * constructs the service directly with a stub. The token exists because a bare
 * constructor parameter with a default is unresolvable to Nest — it would read
 * `design:paramtypes` as `Object` and fail the injector at boot, which
 * `check_gateway_boots.sh` is the thing that catches.
 */
export const TEXT_FETCH = "TEXT_FETCH";

/** Form-encode a body for Twilio's 2010 API. JSON for everyone else. */
export function serialiseBody(request: TransportRequest): string {
  if (request.encoding === "form") {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(request.body)) {
      if (v === undefined || v === null) continue;
      params.append(k, String(v));
    }
    return params.toString();
  }
  return JSON.stringify(request.body);
}

@Injectable()
export class TextDispatchService {
  private readonly logger = new Logger(TextDispatchService.name);

  /**
   * `fetch` is a constructor-injected field rather than a parameter on
   * `perform`, so a caller cannot pass its own and route a house's message
   * somewhere else.
   */
  constructor(
    @Optional() @Inject(TEXT_FETCH) private readonly fetchImpl: FetchLike | null = null,
  ) {}

  private get doFetch(): FetchLike | null {
    if (this.fetchImpl) return this.fetchImpl;
    const g = globalThis as { fetch?: unknown };
    return typeof g.fetch === "function" ? (g.fetch as FetchLike) : null;
  }

  async perform(request: TransportRequest): Promise<DispatchResult> {
    const fetchImpl = this.doFetch;
    if (!fetchImpl) {
      // Not a crash. A runtime with no `fetch` is a deployment fact, and the
      // honest answer is that nothing was attempted.
      return {
        kind: "unreachable",
        status: null,
        body: null,
        detail:
          "This runtime provides no HTTP client, so the message was not attempted. Nothing was sent and nothing was queued.",
      };
    }

    const headers = {
      ...request.headers,
      ...(request.encoding === "form"
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);

    let status: number;
    let text: string;
    try {
      const response = await fetchImpl(request.url, {
        method: request.method,
        headers,
        body: serialiseBody(request),
        signal: controller.signal,
      });
      status = response.status;
      text = await response.text();
    } catch (err) {
      // NEVER LOG THE REQUEST. `headers.Authorization` holds a house's
      // decrypted provider token for the length of this call.
      this.logger.error(
        `text dispatch did not complete: ${(err as Error).message}`,
      );
      return {
        kind: "unreachable",
        status: null,
        body: null,
        detail: `The provider could not be reached (${(err as Error).message}), so whether this message was accepted is UNKNOWN. It is recorded as unknown rather than as sent or as failed — check the conversation before writing again.`,
      };
    } finally {
      clearTimeout(timer);
    }

    if (text.trim().length === 0) {
      return {
        kind: "unreadable",
        status,
        body: null,
        detail: `The provider answered HTTP ${status} with an empty body, so whether it accepted the message is unknown.`,
      };
    }

    try {
      return {
        kind: "answered",
        status,
        body: JSON.parse(text),
        detail: `The provider answered HTTP ${status}.`,
      };
    } catch {
      return {
        kind: "unreadable",
        status,
        body: null,
        detail: `The provider answered HTTP ${status} with a body that is not JSON, so whether it accepted the message is unknown.`,
      };
    }
  }
}
