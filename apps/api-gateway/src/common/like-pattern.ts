/**
 * Escape LIKE/ILIKE metacharacters in user input.
 *
 * The search RPC builds `'%' || p_q || '%'`, so an unescaped `%` or `_` typed by
 * a user is a wildcard rather than a literal: searching for `100%` would
 * otherwise match every vendor. Backslash is Postgres's default LIKE escape
 * character, so escaping it first keeps a literal backslash literal.
 *
 * Lives here rather than in distributor-discovery because sign-in matches
 * invite addresses with it too, and importing a distributor module put
 * auth.service in check_verified_at_is_not_a_boolean's vendor scope.
 */
export function escapeLikeWildcards(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
