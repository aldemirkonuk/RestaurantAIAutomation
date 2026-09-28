/**
 * The TÜİK access token: obtained, held for five minutes, and never written
 * down anywhere.
 *
 * THE FOUNDER, 2026-09-05 (batch 58): he minted a personal API key in TÜİK's
 * Veri Portalı, put it in the repo root `.env` as `TUIK_SDMX_API_KEY`, and said
 * *"act safely and healthy, and check if it works"*.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT "SAFELY" MEANS IN CODE, AND IT IS FOUR THINGS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. **NEITHER THE KEY NOR THE TOKEN IS EVER LOGGED, THROWN OR RETURNED.**
 *    Not in a message, not in an error, not in a debug line. Every failure path
 *    below builds its sentence from the STATUS and nothing else, and the one
 *    place a body could leak into a message is deliberately truncated and
 *    scrubbed. This matters more than it looks: a bearer token in a log is a
 *    credential in a log, and the log outlives the token's five minutes in
 *    every store that keeps one.
 *
 * 2. **AN UNSET ENVIRONMENT REFUSES IN WORDS, NOT IN A STACK TRACE.** A missing
 *    credential and a broken publisher are different facts and must not render
 *    alike — that is this register's whole discipline. `TUIK_SDMX_API_KEY` unset
 *    is a DEPLOYMENT fact ("this environment was never given the key"), and the
 *    sentence says so and names the variable, because the person reading it is
 *    the person who can fix it.
 *
 * 3. **THE 300-SECOND LIFE IS RESPECTED WITH A MARGIN.** TÜİK's token answered
 *    `expires_in: 300` when the parent checked the key. A cache that expired
 *    exactly on that boundary would hand a token to a request that arrives a
 *    second later and spend a 401 to find out. So the token is treated as dead
 *    `SAFETY_MARGIN_MS` before it actually is, and the margin is a named
 *    constant rather than a magic number in an expression.
 *
 * 4. **A REQUEST BUDGET WE IMPOSE ON OURSELVES.** TÜİK states no rate limit —
 *    measured: the manual has none. A source with no stated limit is exactly
 *    where a runaway loop does its damage, so the budget is ours, it is on the
 *    series row, and `spend()` refuses past it rather than trusting a caller.
 *
 * The token endpoint, the client id and the grant are the ones the manual
 * documents and the parent measured working:
 *   POST https://giris.tuik.gov.tr/realms/web/protocol/openid-connect/token
 *   client_id=nsi-ws-consumer, grant_type=password, api_key=<the key>
 */

import { Logger } from "@nestjs/common";

/** The variable the founder put the key in. The NAME travels; the value never does. */
export const TUIK_KEY_ENV = "TUIK_SDMX_API_KEY";

export const TUIK_TOKEN_URL =
  "https://giris.tuik.gov.tr/realms/web/protocol/openid-connect/token";
export const TUIK_CLIENT_ID = "nsi-ws-consumer";

/**
 * Treat the token as dead this long before it expires.
 *
 * 30 seconds against a 300-second life. Long enough that a slow SDMX read
 * started with a "valid" token cannot finish after it died; short enough that
 * the token is still used for nine tenths of its life rather than re-minted on
 * every call, which would spend the budget on the token endpoint.
 */
export const SAFETY_MARGIN_MS = 30_000;

/**
 * How we identify ourselves. Honest, named, and reachable — a publisher who
 * wants to ask us to stop can, which is the whole point of an agent string.
 */
export const TUIK_USER_AGENT =
  "MudavymBot/1.0 (+https://mudavym.com/bot; commodity index register; contact hello@mudavym.com)";

/** What went wrong, and never a stack trace with a credential in it. */
export type TokenRefusal =
  | "key_not_configured"
  | "refused_by_issuer"
  | "unreadable_response"
  | "no_token_in_response"
  | "budget_spent";

export interface TokenOutcome {
  /** Present only on success. NEVER logged, never returned to a client. */
  token: string | null;
  refusal: TokenRefusal | null;
  /** Plain words. Safe to log, by construction: built from a status, never a body. */
  detail: string | null;
}

/** The shape of an HTTP call, injected so no test ever goes outbound. */
export type HttpPost = (
  url: string,
  body: URLSearchParams,
  headers: Record<string, string>,
) => Promise<{ status: number; text: string }>;

/** Make a literal safe to drop into a RegExp. Every metacharacter, no exceptions. */
function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A UUID, the shape most modern API providers actually issue: 8-4-4-4-12 hex.
 *
 * This exists because the length rule below did NOT catch the real key. A UUID
 * is 36 characters, the long-run rule starts at 40, and the audit of c22a20a2
 * (finding 1) measured the gap against the founder's actual TÜİK key: it passed
 * through unredacted. A credential's shape, not only its length, has to be a rule.
 */
const UUID_SHAPED =
  /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;

/**
 * Scrub anything token- or key-shaped out of a string before it can be logged.
 *
 * Defence in depth: nothing below deliberately puts a token in a message, and
 * this is what makes that true even if somebody later passes a body through by
 * mistake. Three rules, most specific first, because a specific rule leaves a
 * more useful marker behind than a general one:
 *
 * 1. **The exact configured value of `TUIK_SDMX_API_KEY`**, wherever and however
 *    often it appears. This is the only rule that cannot be fooled by a shape we
 *    failed to anticipate — it redacts the actual secret this process holds,
 *    whatever it looks like. If the key is short enough to also be ordinary prose
 *    then ordinary prose gets redacted too; that is the safe direction to be
 *    wrong in, and a scrubber that errs the other way is not a scrubber.
 * 2. **A JWT** — three base64url segments separated by dots. That is the token.
 * 3. **A UUID, then any long unbroken key-ish run.** Shape first, length second.
 * 4. **Then, whatever survived, with its whitespace taken out.** If the
 *    configured key or a credential SHAPE is still there once every space and
 *    line break is removed, the entire message is replaced with
 *    `WHOLE_MESSAGE_WITHHELD` — never a partial. A run broken by a newline
 *    passed all three rules above byte for byte (audit of 78861031, finding 1),
 *    and half a key in a log is still half a key in a log.
 *
 * `env` is a parameter rather than a closure over `process.env` so a test can
 * prove rule 1 with a synthetic key and never touch the real environment.
 */
export const WHOLE_MESSAGE_WITHHELD =
  "A credential was present in this message and the whole message was withheld rather than partly redacted.";

/** Every whitespace character removed, so a run broken across a line rejoins. */
function withoutWhitespace(text: string): string {
  return text.replace(/\s+/g, "");
}

/**
 * A credential shape, looked for in text whose whitespace has been removed.
 *
 * Only the SHAPED rules belong here — a UUID and a JWT. The `{40,}` length rule
 * from the ordinary pass deliberately does NOT run against collapsed text:
 * removing the spaces from any ordinary English sentence longer than forty
 * characters produces a forty-character run, and a scrubber that replaced every
 * such sentence with the withheld notice would withhold every error message in
 * the service. That is a known and stated gap: a 40-character key with no
 * hyphens, split by a newline, is not caught by this rule.
 */
function collapsedCarriesAShapedSecret(collapsed: string): boolean {
  return (
    new RegExp(UUID_SHAPED.source).test(collapsed) ||
    /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/.test(collapsed)
  );
}

export function scrubSecrets(text: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[TUIK_KEY_ENV];
  const key = typeof configured === "string" ? configured.trim() : "";
  const withKeyGone =
    key === "" ? text : text.replace(new RegExp(escapeForRegExp(key), "g"), "[key redacted]");
  const ordinary = withKeyGone
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, "[token redacted]")
    .replace(UUID_SHAPED, "[key redacted]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]");

  /*
   * WHAT SURVIVED THE ORDINARY PASS, WITH ITS WHITESPACE TAKEN OUT.
   *
   * The audit of 78861031 (finding 1) measured this: none of the three rules
   * above tolerates an interruption, so `aaaaaaaa-bbbb-cccc\n-dddd-…` came out
   * byte for byte identical to what went in. A secret is still a secret when a
   * line wrap lands in the middle of it.
   *
   * The check runs on `ordinary` — what the rules above already handled is
   * gone, so the ordinary case (a whole UUID in a URL) keeps its precise
   * in-place marker and the surrounding message. Only a secret that SURVIVED
   * reaches here, and then the whole message goes: a partial redaction of a
   * broken run would leave both halves in the log, which is the leak.
   */
  const collapsed = withoutWhitespace(ordinary);
  const collapsedKey = withoutWhitespace(key);
  const keySurvives = collapsedKey !== "" && collapsed.includes(collapsedKey);
  if (keySurvives || collapsedCarriesAShapedSecret(collapsed)) {
    return WHOLE_MESSAGE_WITHHELD;
  }
  return ordinary;
}

/**
 * One process's token, and the clock it dies on.
 *
 * Deliberately NOT a Nest provider and deliberately not shared across series: it
 * holds a credential, and the smaller the number of things that can reach it,
 * the smaller the number of things that can leak it.
 */
export class TuikTokenHolder {
  private readonly logger = new Logger(TuikTokenHolder.name);
  private token: string | null = null;
  private deadAt = 0;
  private spentToday = 0;
  private spendDay = "";

  constructor(
    private readonly post: HttpPost,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Whether this environment was given the key at all. Never its value. */
  configured(env: NodeJS.ProcessEnv = process.env): boolean {
    return typeof env[TUIK_KEY_ENV] === "string" && env[TUIK_KEY_ENV]!.trim() !== "";
  }

  /**
   * Take one request off the day's budget, or refuse.
   *
   * The day is UTC and it is recorded, so a process that runs past midnight
   * starts a new day rather than carrying yesterday's spend forever.
   */
  spend(budgetPerDay: number): boolean {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (day !== this.spendDay) {
      this.spendDay = day;
      this.spentToday = 0;
    }
    if (this.spentToday >= budgetPerDay) return false;
    this.spentToday += 1;
    return true;
  }

  /** How much of today's budget this process has used. Safe to report. */
  spentSoFar(): { day: string; spent: number } {
    return { day: this.spendDay, spent: this.spentToday };
  }

  /** For tests and for a redeploy: forget the token without waiting for it to die. */
  forget(): void {
    this.token = null;
    this.deadAt = 0;
  }

  /**
   * A live token, minting one if the held one is dead or nearly so.
   *
   * The key is read here and passed straight into the form body. It is never
   * assigned to a field, never interpolated into a message, and never returned.
   */
  async get(env: NodeJS.ProcessEnv = process.env): Promise<TokenOutcome> {
    if (this.token && this.now() < this.deadAt) {
      return { token: this.token, refusal: null, detail: null };
    }

    const key = (env[TUIK_KEY_ENV] ?? "").trim();
    if (!key) {
      // A DEPLOYMENT fact, said as one. The person reading this is the person
      // who can fix it, so the sentence names the variable and nothing else.
      return {
        token: null,
        refusal: "key_not_configured",
        detail: `This environment has no ${TUIK_KEY_ENV}, so no token was requested and nothing was read. That is a deployment that was never given the credential, not a publisher that refused us — set ${TUIK_KEY_ENV} where this runs and the series reads on the next sweep.`,
      };
    }

    const body = new URLSearchParams();
    body.set("client_id", TUIK_CLIENT_ID);
    body.set("grant_type", "password");
    body.set("api_key", key);

    let res: { status: number; text: string };
    try {
      res = await this.post(TUIK_TOKEN_URL, body, {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": TUIK_USER_AGENT,
      });
    } catch (err) {
      // Scrubbed even here: a fetch error can carry the request in its message
      // on some runtimes, and the request carries the key.
      return {
        token: null,
        refusal: "unreadable_response",
        detail: `The token endpoint could not be reached: ${scrubSecrets((err as Error).message, env)}. Nothing was read.`,
      };
    }

    if (res.status !== 200) {
      // THE STATUS, AND NOTHING FROM THE BODY. A rejected credential's response
      // is the one place an echoed key would most plausibly appear.
      return {
        token: null,
        refusal: "refused_by_issuer",
        detail: `The token endpoint answered HTTP ${res.status}. The credential in ${TUIK_KEY_ENV} was not accepted, or the issuer is unavailable; nothing was read and no detail from the response is repeated here.`,
      };
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(res.text) as Record<string, unknown>;
    } catch {
      return {
        token: null,
        refusal: "unreadable_response",
        detail:
          "The token endpoint answered 200 with a body that is not JSON. Nothing was read, and the body is not repeated here because it is where a credential would be.",
      };
    }

    const token = typeof payload.access_token === "string" ? payload.access_token : "";
    if (!token) {
      return {
        token: null,
        refusal: "no_token_in_response",
        detail:
          "The token endpoint answered 200 and carried no access_token. Nothing was read.",
      };
    }

    // `expires_in` is SECONDS and the parent measured 300. A missing or absurd
    // value falls back to that rather than to forever: a token cached forever is
    // a 401 on every call after five minutes, discovered the expensive way.
    const expiresIn =
      typeof payload.expires_in === "number" && payload.expires_in > 0
        ? payload.expires_in
        : 300;
    this.token = token;
    this.deadAt = this.now() + expiresIn * 1000 - SAFETY_MARGIN_MS;
    // Note what is NOT in this line: the token, its length, and its first
    // characters. "A token was obtained" is the whole of what is safe to say.
    this.logger.log(
      `TUIK token obtained; treated as live for ${Math.max(0, Math.round((this.deadAt - this.now()) / 1000))}s`,
    );
    return { token, refusal: null, detail: null };
  }
}
