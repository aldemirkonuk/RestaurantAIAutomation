/**
 * `FRONTEND_URL` is a comma-separated CORS allow-list on Railway
 * (`https://mudavym.com,https://www.mudavym.com,https://restaurant-ai-automation-web.vercel.app`
 * — see `cors-origins.ts` and `websocket.gateway.ts`, the two places that
 * legitimately want the whole list). Anything building a single user-facing
 * link (an email, an invite URL, a redirect) wants exactly one canonical
 * origin, not the raw env value — interpolating the whole string produces a
 * link no browser can resolve.
 *
 * The old default host, restaurant-ai-automation-web.vercel.app, is being
 * retired (308-redirected to mudavym.com by the SEO/GEO lane) and must never
 * be the fallback for a new link.
 */
export const CANONICAL_APP_ORIGIN = "https://mudavym.com";

interface ConfigLike {
  get<T = string>(key: string): T | undefined;
}

/** The one origin a user-facing link should be built against. */
export function appOrigin(config: ConfigLike): string {
  const raw = config.get<string>("FRONTEND_URL");
  const first = (raw ?? "").split(",")[0]?.trim();
  return first ? first.replace(/\/+$/, "") : CANONICAL_APP_ORIGIN;
}
