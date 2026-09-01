/**
 * The CORS allow-list, extracted from `main.ts` so it can be tested.
 *
 * It was inline in the `NestFactory.create` options, which meant nothing could
 * assert against it. On 2026-09-01 `mudavym.com` became the production domain
 * and matched no entry: the browser received a preflight carrying no
 * `access-control-allow-origin`, every API call failed, and the login screen
 * reported an unreachable server — while the web build and the gateway were
 * both healthy. A list that decides whether the product works at all is worth
 * a test, so it lives here and `cors-origins.spec.ts` pins it.
 */

/** The customer-facing production hostname. Allow-listed in code on purpose. */
export const PRODUCTION_ORIGINS = [
  "https://mudavym.com",
  "https://www.mudavym.com",
] as const;

export function buildCorsOrigins(env: NodeJS.ProcessEnv = process.env) {
  return [
    // Additional origins may be added by env var, but the production domain
    // above never depends on it.
    ...(env.FRONTEND_URL ? env.FRONTEND_URL.split(",") : []),
    ...PRODUCTION_ORIGINS,
    /^https:\/\/([a-z0-9-]+\.)*mudavym\.com$/, // dev./preview subdomains
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
    /^https:\/\/.*\.vercel\.app$/, // all Vercel preview + production URLs
    /^http:\/\/192\.168\.\d+\.\d+:\d+$/,
    /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,
    // Vite falls through to the next free port (3001, 3002, …) whenever 3000
    // is already taken by another local process, which happens often enough in
    // a dev environment running several projects at once. Without this, that
    // ordinary port bump presents as a broken CORS preflight with no
    // indication the actual cause was "the wrong origin isn't allow-listed".
    // Scoped to non-production only, same as the dev auth bypass.
    ...(env.NODE_ENV !== "production"
      ? [/^http:\/\/(localhost|127\.0\.0\.1):\d+$/]
      : []),
  ];
}

/** Mirrors how the cors middleware matches a request Origin against the list. */
export function isOriginAllowed(
  origin: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return buildCorsOrigins(env).some((entry) =>
    typeof entry === "string" ? entry === origin : entry.test(origin),
  );
}
