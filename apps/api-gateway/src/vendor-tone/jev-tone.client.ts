/**
 * The Jev adapter for vendor-mail tone (ADR 0207, round 3).
 *
 * WHAT EXISTED: the only Jev client in this repository is the coding-agent
 * prompt gate (`scripts/jev/prompt_gate.py`, ADR 0182) — Python, a hook, never
 * run by the gateway. It does score free text: its request is `{ state,
 * model, questions }` to `POST https://api.typesafe.ai/v1/systemone`, with
 * Choice, Score and Noul questions. So the gateway gets its own small client of
 * the same wire shape, behind the `ToneScorer` interface, with the prompt
 * gate's hard-won rules carried over:
 *
 *   - NO REDIRECTS. `fetch` is called with `redirect: "error"`: a 30x answer
 *     would otherwise forward the bearer to whatever host it names (PR #408's
 *     security audit reproduced exactly that against urllib).
 *   - A DEADLINE, not a socket timeout: the whole call is aborted after
 *     `TIMEOUT_MS`.
 *   - THE REPLY IS HOSTILE INPUT. `readJevAnswers` range-checks every number,
 *     allow-lists the quote against our own candidate keys and keeps a model
 *     name only in Jev's own shape. A reply that fails any of it is a failed
 *     reading — the message is `not assessed`, never half-scored.
 *   - The endpoint override is a LOOPBACK-ONLY test seam, as the gate's is.
 *
 * NO KEY, NO CALL. The key is read from the environment (`JEV_API_KEY`, or
 * `TYPESAFE_API_KEY`) — never from a file. Without one `available()` is false
 * and the sweep sends nothing; the vendor sheet says Jev is not set up on this
 * server and reads the inbound model's label instead. Whether the gateway's
 * deployments hold the key was NOT checked (no `.env` was read).
 *
 * The request body is built by `tone-egress.ts` from masked text only; this
 * file never sees an unmasked message.
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { QuoteCandidate, ToneScore, readJevAnswers } from "./tone-scale";
import type { EgressPayload } from "./tone-egress";

export const TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const TIMEOUT_MS = 8000;
const KEY_VARS = ["JEV_API_KEY", "TYPESAFE_API_KEY"] as const;
export const ENDPOINT_OVERRIDE_VAR = "JEV_TONE_ENDPOINT_OVERRIDE";

export type ToneScoreOutcome =
  | { ok: true; score: ToneScore }
  | { ok: false; reason: string };

/** Anything that can read one masked message's tone. */
export interface ToneScorer {
  readonly name: string;
  available(): boolean;
  score(payload: EgressPayload): Promise<ToneScoreOutcome>;
}

export const TONE_SCORER = Symbol("TONE_SCORER");

/** The override only when it names this machine; anything else is ignored. */
export function loopbackOnly(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return ["127.0.0.1", "localhost", "::1"].includes(host) ? raw : null;
  } catch {
    return null;
  }
}

@Injectable()
export class JevToneScorer implements ToneScorer {
  readonly name = "jev";
  private readonly logger = new Logger(JevToneScorer.name);

  constructor(private readonly config: ConfigService) {}

  private key(): string | null {
    for (const v of KEY_VARS) {
      const k = this.config.get<string>(v);
      if (typeof k === "string" && k.trim()) return k.trim();
    }
    return null;
  }

  available(): boolean {
    return this.key() !== null;
  }

  async score(payload: EgressPayload): Promise<ToneScoreOutcome> {
    const key = this.key();
    if (!key)
      return { ok: false, reason: "Jev is not set up on this server (no key)" };
    const endpoint =
      loopbackOnly(this.config.get<string>(ENDPOINT_OVERRIDE_VAR)) ??
      TYPESAFE_ENDPOINT;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload.body),
      });
      if (!res.ok)
        return { ok: false, reason: `Jev answered HTTP ${res.status}` };
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        return { ok: false, reason: "Jev answered with no JSON" };
      }
      return readJevAnswers(json, payload.candidates as QuoteCandidate[]);
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name ?? "Error";
      // The message is logged by class only: a failure text could carry the
      // endpoint's own words, and nothing of the request is ever logged.
      this.logger.warn(`Jev tone call failed (${name})`);
      return {
        ok: false,
        reason:
          name === "AbortError"
            ? `Jev did not answer within ${TIMEOUT_MS / 1000} s`
            : `Jev could not be reached (${name})`,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
