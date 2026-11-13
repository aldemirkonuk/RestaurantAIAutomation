/**
 * A refusal reads as the gateway's sentence only on a request that goes
 * through `sayPlainly` (client.ts). A new `axios.create(...)` or a bare
 * `axios.post(...)` in the app would print "Request failed with status code
 * 400" again, silently. This guard fails on any new one: use `apiClient`, or
 * install `sayPlainly` on the new instance and add it to SAYS_PLAINLY.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");

/** Instances that put the sentence on every refusal. */
const SAYS_PLAINLY = new Set([
  "services/api/client.ts",
  "hooks/queries/useConversationQueries.ts",
]);

/**
 * Known request paths that do not go through `sayPlainly`, each with why it
 * is allowed. A file named here may lose its axios use; none may be added.
 */
const KNOWN_OUTSIDE: Record<string, string> = {
  // Sign-in, registration and join read the body themselves; owned by the
  // open auth stack. Follow-up: install sayPlainly on its instance.
  "contexts/AuthContext.tsx": "own instance, reads the body itself",
  "stores/authStore.ts": "own instance, being removed by the auth-store refactor",
  // The refresh call: its failure is handled, never printed.
  "lib/sessionRefresh.ts": "refresh call, not printed",
  // Signed-out pages read the body themselves.
  "pages/ForgotPassword.tsx": "reads the body itself",
  "pages/ResetPassword.tsx": "reads the body itself",
  // The public /v/:slug catalogue: a 404 and any other failure each have
  // their own fixed sentence; nothing from the request is printed.
  "pages/VendorPortal.tsx": "public page, prints only its own sentences",
  // Legacy screens no route or component imports.
  "components/conversations/ConversationApprovalNotification.tsx": "not mounted",
  "components/orders/AuctionPurchaseModal.tsx": "not mounted",
  "components/notifications/VendorDeadlineSettings.tsx": "not mounted",
  "pages/RecurringOrders.tsx": "not mounted",
};

const INSTANCE = /\baxios\s*\.\s*create\s*\(/;
const BARE =
  /\baxios\s*\.\s*(get|post|put|patch|delete|head|options|request)\s*(<[^>]*>)?\s*\(|\baxios\s*\(/;
const NOT_APP = /(\.test\.|\.spec\.|__tests__|__mocks__|\.d\.ts$)/;

function appSources(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .map((p) => p.split(sep).join("/"))
    .filter((p) => /\.(ts|tsx)$/.test(p) && !NOT_APP.test(p));
}

/** Code only: a comment that names `axios.post(` is not a request. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("every request path says a refusal plainly", () => {
  const files = appSources();

  it("finds the app's sources", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain("services/api/client.ts");
  });

  it("no new axios instance or bare axios call outside the known list", () => {
    const outside = files.filter((f) => {
      if (SAYS_PLAINLY.has(f) || f in KNOWN_OUTSIDE) return false;
      const text = code(readFileSync(join(SRC, f), "utf8"));
      return INSTANCE.test(text) || BARE.test(text);
    });
    expect(outside).toEqual([]);
  });

  it("each instance that should say it plainly installs sayPlainly", () => {
    for (const f of SAYS_PLAINLY) {
      const text = code(readFileSync(join(SRC, f), "utf8"));
      expect(text, f).toMatch(/interceptors\.response\.use\(/);
      expect(text, f).toMatch(/\bsayPlainly\(|\bsayingPlainly\(/);
    }
  });

  it("the guard sees a bare call and a new instance (self-check)", () => {
    expect(BARE.test(code("await axios.post(`${API}/x`, body)"))).toBe(true);
    expect(BARE.test(code("axios.get<Thing[]>(url)"))).toBe(true);
    expect(INSTANCE.test(code("const api = axios.create({ baseURL })"))).toBe(true);
    expect(BARE.test(code("// see axios.post( in the old screen"))).toBe(false);
    expect(BARE.test(code("axios.isAxiosError(e)"))).toBe(false);
    expect(relative(SRC, join(SRC, "a", "b.ts")).split(sep).join("/")).toBe("a/b.ts");
  });
});
