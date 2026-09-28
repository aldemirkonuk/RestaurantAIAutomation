import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

/**
 * Switching house with gated pages mounted (ADR 0164 R6, over
 * `useMudavymDesign.ts`'s reactive restaurant identity).
 *
 * Sessions follow membership: `setActiveRestaurantId` now re-mints the session
 * through `POST /auth/switch-restaurant` and moves `activeRestaurantId` only
 * when the new token names that house. Every mounted design gate reads that
 * id from the context, so a granted switch must re-resolve each gate against
 * the NEW house's flag row (never carry the old house's verdict), and a
 * refused switch must leave every gate on the old house's verdict.
 *
 * The real AuthProvider and the real hook; only axios is mocked. The two pages
 * are picked from those NOT in LIVE_PAGES, so each one really spends a flag
 * request per house.
 *
 * [2026-09-27, ADR 0149 row 54: receiving, promotions and vendor_prices joined
 * LIVE_PAGES, so exactly one page still fetches a flag (`arrival`). The test
 * now mounts that one gate and flips it both ways — next on house A, legacy on
 * house B, next again back on A — which still proves a switch re-resolves the
 * gate against the new house and never carries the old verdict. What the
 * two-gate shape also showed (two gates moving in opposite directions at
 * once) has no second flag-gated page left to show it with.]
 */

const h = vi.hoisted(() => {
  const instance = {
    defaults: { headers: { common: {} as Record<string, string> } },
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    get: vi.fn(),
    post: vi.fn(),
  };
  return { instance, globalPost: vi.fn() };
});

vi.mock("axios", () => ({
  default: { create: () => h.instance, post: h.globalPost },
  create: () => h.instance,
  post: h.globalPost,
}));

import { AuthProvider, useAuth, type AuthContextType } from "./AuthContext";
import {
  LIVE_PAGES,
  MUDAVYM_PAGES,
  clearMudavymDesignCache,
  flagKeyFor,
  useMudavymDesign,
  type MudavymPage,
} from "../lib/mudavym/useMudavymDesign";

const U = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const HELD_BACK = MUDAVYM_PAGES.filter((p) => !LIVE_PAGES.has(p));
const [P1] = HELD_BACK as readonly MudavymPage[];

/** House A turns P1 on; house B leaves it off. */
const FLAGS: Record<string, Record<string, boolean>> = {
  [A]: { [flagKeyFor(P1)]: true },
  [B]: { [flagKeyFor(P1)]: false },
};

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;
}

function Gate({ page }: { page: MudavymPage }) {
  const on = useMudavymDesign(page);
  return <span data-testid={`gate-${page}`}>{on ? "next" : "legacy"}</span>;
}

function Probe({ onReady }: { onReady: (a: AuthContextType) => void }) {
  onReady(useAuth());
  return null;
}

let meHouse = A;
let switchGrants = true;
const flagChecks: { restaurant_id: string; feature_name: string }[] = [];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  clearMudavymDesignCache();
  flagChecks.length = 0;
  meHouse = A;
  switchGrants = true;
  localStorage.setItem("accessToken", jwt({ sub: U, restaurantId: A }));
  localStorage.setItem("activeRestaurantId", A);

  h.instance.get.mockImplementation(async (url: string) =>
    url === "/api/v1/auth/me"
      ? {
          data: {
            user: {
              userId: U,
              email: "p@house.test",
              restaurantId: meHouse,
              role: "owner",
              emailVerified: true,
            },
          },
        }
      : {
          data: [
            { id: A, name: "Moda" },
            { id: B, name: "Kadikoy" },
          ],
        },
  );

  h.instance.post.mockImplementation(async (url: string, body: any) => {
    if (url === "/settings/feature-flags/check") {
      flagChecks.push(body);
      const on = FLAGS[body.restaurant_id]?.[body.feature_name] ?? false;
      return { data: { enabled: on, active: on } };
    }
    if (url === "/api/v1/auth/switch-restaurant") {
      if (!switchGrants) throw { response: { status: 403 } };
      meHouse = body.restaurantId;
      return {
        data: {
          accessToken: jwt({ sub: U, restaurantId: body.restaurantId }),
          refreshToken: "r",
          restaurantId: body.restaurantId,
        },
      };
    }
    throw new Error(`unexpected POST ${url}`);
  });
});

async function mountWithGates() {
  let ctx: AuthContextType | null = null;
  render(
    <AuthProvider>
      <Probe onReady={(a) => (ctx = a)} />
      <Gate page={P1} />
    </AuthProvider>,
  );
  await waitFor(() => expect(ctx?.loading).toBe(false));
  await waitFor(() => expect(ctx?.activeRestaurantId).toBe(A));
  return () => ctx as unknown as AuthContextType;
}

const verdict = (page: MudavymPage) =>
  screen.getByTestId(`gate-${page}`).textContent;

describe("switching house re-resolves every mounted design gate (ADR 0164)", () => {
  it("picks a page that really fetches a flag", () => {
    expect(HELD_BACK.length).toBeGreaterThanOrEqual(1);
    expect(LIVE_PAGES.has(P1)).toBe(false);
  });

  it("a granted switch re-reads each gate for the new house and drops the old verdict", async () => {
    const auth = await mountWithGates();
    await waitFor(() => expect(verdict(P1)).toBe("next"));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await auth().setActiveRestaurantId(B);
    });
    expect(ok).toBe(true);

    await waitFor(() => expect(verdict(P1)).toBe("legacy"));
    // The gate asked about house B by name, once.
    const inB = flagChecks.filter((c) => c.restaurant_id === B);
    expect(inB.map((c) => c.feature_name)).toEqual([flagKeyFor(P1)]);

    // And back: house A's verdicts return (served from the per-house cache).
    await act(async () => {
      ok = await auth().setActiveRestaurantId(A);
    });
    expect(ok).toBe(true);
    await waitFor(() => expect(verdict(P1)).toBe("next"));
  });

  it("a refused switch leaves every gate on the current house's verdict", async () => {
    const auth = await mountWithGates();
    await waitFor(() => expect(verdict(P1)).toBe("next"));

    switchGrants = false;
    let ok: boolean | undefined;
    await act(async () => {
      ok = await auth().setActiveRestaurantId(B);
    });

    expect(ok).toBe(false);
    expect(auth().activeRestaurantId).toBe(A);
    expect(verdict(P1)).toBe("next");
    expect(flagChecks.some((c) => c.restaurant_id === B)).toBe(false);
  });
});
