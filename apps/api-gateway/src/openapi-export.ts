/**
 * The OpenAPI export is a command, not a boot side effect (ADR 0123, OD-89).
 *
 * Until 2026-09-05 `main.ts` wrote `./openapi.json` on every non-production
 * boot, so merely running the gateway locally dirtied a tracked file and swept
 * unrelated spec churn into whatever branch happened to be checked out. The
 * write now happens only when `EXPORT_OPENAPI` is set to `1` or `true`, which
 * is what `pnpm --filter @wineops/api-gateway openapi:export` sets.
 *
 * The decision to write and the writing itself are separated so both halves are
 * testable without booting Nest: `shouldExportOpenApi` is pure, and
 * `maybeExportOpenApi` takes its writer.
 */

export type OpenApiWriter = (path: string, contents: string) => void;

export const OPENAPI_EXPORT_PATH = "./openapi.json";

/**
 * True only for an explicit opt-in. Unset, empty, "0", "false" or any other
 * value means "do not touch the file": absence is never read as consent.
 */
export function shouldExportOpenApi(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = (env.EXPORT_OPENAPI ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/**
 * Writes the spec when — and only when — the flag is set. Returns whether it
 * wrote, so a caller reports what happened instead of announcing a write it
 * never made (ADR 0020).
 */
export function maybeExportOpenApi(
  document: unknown,
  options: {
    env?: NodeJS.ProcessEnv;
    write: OpenApiWriter;
    log?: (message: string) => void;
    path?: string;
  },
): boolean {
  if (!shouldExportOpenApi(options.env ?? process.env)) {
    return false;
  }
  const path = options.path ?? OPENAPI_EXPORT_PATH;
  options.write(path, JSON.stringify(document, null, 2));
  options.log?.(`OpenAPI spec exported to ${path}`);
  return true;
}
