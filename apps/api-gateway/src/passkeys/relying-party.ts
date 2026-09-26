/**
 * Which relying party a passkey ceremony belongs to (ADR 0222, Proposed).
 *
 * A WebAuthn credential is bound to an RP ID -- a registrable domain the page's
 * origin sits on. The browser refuses a ceremony whose RP ID is not the page's
 * own host or a suffix of it, so the RP ID is not a free choice: it follows the
 * origin the person is actually on.
 *
 *   * `mudavym.com` and any `*.mudavym.com` (https only) -> RP ID `mudavym.com`.
 *     One RP ID for the apex and every subdomain, so a passkey enrolled on
 *     `www.` works on the apex and the other way round.
 *   * `http://localhost:<port>` outside production -> RP ID `localhost`, so the
 *     ceremony can be exercised in development. Never in production.
 *   * Anything else -- a `*.vercel.app` preview, an IP address -> no RP ID. A
 *     passkey made on a preview host would be bound to that one throwaway host
 *     and work nowhere else, so the gateway refuses to start the ceremony and
 *     says why, rather than enrolling a credential that is useless tomorrow.
 *
 * `WEBAUTHN_RP_ID` + `WEBAUTHN_ORIGINS` override the rule for a deployment
 * that serves the web from another domain; both must be set, and the origin
 * must still be one of the listed ones.
 */

export interface RelyingParty {
  rpId: string;
  /** The exact origin the ceremony runs on; the response must carry it. */
  origin: string;
}

export const PRODUCTION_RP_ID = "mudavym.com";

const MUDAVYM_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*mudavym\.com$/;
const LOCALHOST_ORIGIN = /^http:\/\/localhost(:\d+)?$/;

export function resolveRelyingParty(
  origin: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
): RelyingParty | null {
  if (!origin || typeof origin !== "string") return null;
  const o = origin.trim().toLowerCase();

  const overrideRp = env.WEBAUTHN_RP_ID?.trim();
  const overrideOrigins = (env.WEBAUTHN_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (overrideRp && overrideOrigins.length > 0 && overrideOrigins.includes(o)) {
    return { rpId: overrideRp, origin: o };
  }

  if (MUDAVYM_ORIGIN.test(o)) return { rpId: PRODUCTION_RP_ID, origin: o };
  if (env.NODE_ENV !== "production" && LOCALHOST_ORIGIN.test(o)) {
    return { rpId: "localhost", origin: o };
  }
  return null;
}

/** The sentence a refused origin gets. One source, so the copy cannot drift. */
export const RP_REFUSAL =
  "Passkeys can be added only on mudavym.com. A passkey made on this address would be tied to it and work nowhere else, so nothing was started.";
