/**
 * Single source of truth for the JWT signing secret.
 *
 * Previously three call sites each defaulted to the literal
 * "your-secret-key-change-in-production" and continued. That string is published in
 * this repository, so any environment missing JWT_SECRET signed tokens anyone could
 * forge — and two of the three sites did not even warn.
 *
 * Outside development this now refuses to start rather than running forgeable.
 */
export const INSECURE_DEFAULT_JWT_SECRET = "your-secret-key-change-in-production";

export function resolveJwtSecret(
  configured: string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string {
  const isDev = nodeEnv !== "production";
  if (configured && configured !== INSECURE_DEFAULT_JWT_SECRET) return configured;

  if (!isDev) {
    throw new Error(
      "JWT_SECRET is unset or still the published default. Refusing to start: " +
        "tokens signed with it are forgeable by anyone with repository access.",
    );
  }
  return INSECURE_DEFAULT_JWT_SECRET;
}
