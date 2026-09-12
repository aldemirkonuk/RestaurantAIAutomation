/**
 * Path-segment validation for values interpolated into outbound service URLs.
 *
 * Every SSRF in this gateway has had the same shape: a caller-controlled value dropped
 * into a template string that becomes a URL.
 *
 *   `/api/v1/health/agents/${name}`   with name = "..%2f..%2fagents%2fexecute"
 *   → decodeURIComponent by Express → "../../agents/execute"
 *   → resolves to  <orchestrator>/api/v1/agents/execute
 *
 * The escape works because Express decodes route params, so `%2f` becomes a real slash
 * *after* routing has already matched. The `:param` pattern never sees it.
 *
 * These are allowlists, not sanitisers. Stripping `..` invites a rematch on the next
 * encoding anyone thinks of; requiring the value to look like an identifier ends the
 * category. `%` is absent from the class, so every percent-encoded escape fails on the
 * same rule as the literal one.
 */

/** One path segment: identifiers and GUIDs. No slash, no `%`, no `\`, no `:`. */
const SAFE_SEGMENT = /^[A-Za-z0-9._~-]+$/;

/**
 * True when `segment` can only be a single, literal path segment.
 * Rejects `.` and `..` explicitly — both match the character class but traverse.
 */
export function isSafePathSegment(segment: unknown): segment is string {
  if (typeof segment !== "string") return false;
  if (segment.length === 0 || segment.length > 256) return false;
  if (segment === "." || segment === "..") return false;
  return SAFE_SEGMENT.test(segment);
}

/**
 * True when `path` is a slash-joined series of safe segments (`a/b/c`).
 * Rejects leading, trailing and doubled slashes, so it cannot become an absolute or
 * scheme-relative URL.
 */
export function isSafeRelativePath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  if (path.length === 0 || path.length > 512) return false;
  return path.split("/").every(isSafePathSegment);
}
