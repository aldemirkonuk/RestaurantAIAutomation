import * as fs from "fs";
import * as path from "path";

/**
 * Readers for the two live sources of truth about the Toast → orchestrator seam.
 *
 * These were written inline in `toast-dead-surface.spec.ts` (PR #230). They are
 * lifted here so there is exactly ONE implementation: #230's ratchet and the
 * derived-status tests in `toast-upstream.spec.ts` both need to know what the
 * orchestrator actually registers, and two copies of that parser is precisely
 * the rot this seam already suffered from.
 *
 * SOURCE-TREE ONLY. Nothing in the running gateway may import this: the
 * deployed image (`apps/api-gateway/Dockerfile`) contains no Python, so these
 * functions would throw there. The runtime derivation asks the orchestrator
 * itself instead — see `toast-upstream.ts`. This module exists so that the
 * build-time guard and the runtime derivation can be proven to agree.
 */

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ORCHESTRATOR_API_DIR = path.join(
  REPO_ROOT,
  "services/agent-orchestrator/api",
);
const TOAST_SERVICE_SRC = path.join(__dirname, "toast.service.ts");

/**
 * Every `/api/v1/...` prefix the orchestrator actually serves, read from the
 * live `APIRouter(prefix=...)` declarations rather than from a list copied into
 * a comment — a copied list is exactly what rots.
 */
export function registeredOrchestratorPrefixes(): string[] {
  // Per the repo's guard rule: a guard that cannot check must fail loudly, not
  // pass by default. A missing orchestrator tree means this test is blind.
  if (!fs.existsSync(ORCHESTRATOR_API_DIR)) {
    throw new Error(
      `Cannot verify orchestrator routes: ${ORCHESTRATOR_API_DIR} does not exist. ` +
        `This guard fails rather than silently passing.`,
    );
  }

  const prefixes: string[] = [];
  for (const file of fs.readdirSync(ORCHESTRATOR_API_DIR)) {
    if (!file.endsWith(".py")) continue;
    const src = fs.readFileSync(path.join(ORCHESTRATOR_API_DIR, file), "utf8");
    for (const m of src.matchAll(
      /APIRouter\(\s*prefix\s*=\s*["']([^"']+)["']/g,
    )) {
      prefixes.push(m[1]);
    }
  }

  // Sanity: if the parse returns nothing the regex has rotted, and a green
  // result below would be meaningless.
  if (prefixes.length === 0) {
    throw new Error(
      "Parsed zero APIRouter prefixes from the orchestrator — the guard's " +
        "regex no longer matches the source it checks.",
    );
  }
  return prefixes;
}

/**
 * True when the orchestrator registers a `/api/v1/toast` router — i.e. when the
 * sibling service side of this seam has actually landed. Every "this route was
 * never built" claim in the gateway is ultimately a claim about this function.
 */
export function orchestratorServesToast(): boolean {
  return registeredOrchestratorPrefixes().some((p) =>
    p.startsWith("/api/v1/toast"),
  );
}

/**
 * Strip comments before matching. `toast.service.ts` documents the deleted
 * webhook forward in a long block comment that quotes `/api/v1/toast/webhooks/
 * {type}` and `/api/v1/pos/webhook/toast` — a guard that counts those is
 * measuring prose, not code, and would fire on a doc edit while missing a real
 * new call added in a line that happens to sit inside a comment run.
 *
 * Only block comments and whole-line `//` comments are removed; a naive `//`
 * strip would also eat the `//` inside any `https://` string literal.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

/** Every orchestrator path `toast.service.ts` calls, template vars normalised. */
export function toastServiceOrchestratorCalls(): string[] {
  const src = stripComments(fs.readFileSync(TOAST_SERVICE_SRC, "utf8"));
  const found = new Set<string>();
  for (const m of src.matchAll(/["'`](\/api\/v1\/[^"'`\s]*)["'`]/g)) {
    found.add(m[1].replace(/\$\{[^}]+\}/g, ":param"));
  }
  return [...found].sort();
}
