import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

/**
 * The role in the active house comes from `/auth/me` when the active house is
 * the token's house; `/auth/me/role` is asked only for another house (p2 s6).
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

const U = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;
}

function Probe({ onReady }: { onReady: (a: AuthContextType) => void }) {
  onReady(useAuth());
  return null;
}

async function mount() {
  let ctx: AuthContextType | null = null;
  render(
    <AuthProvider>
      <Probe onReady={(a) => (ctx = a)} />
    </AuthProvider>,
  );
  await waitFor(() => expect(ctx?.loading).toBe(false));
  return () => ctx as unknown as AuthContextType;
}

const roleCalls = () =>
  h.instance.get.mock.calls.filter((c) => c[0] === "/api/v1/auth/me/role");

function house(tokenHouse: string, meHouse: string) {
  localStorage.setItem(
    "accessToken",
    jwt({ sub: U, restaurantId: tokenHouse }),
  );
  h.instance.get.mockImplementation(async (url: string) => {
    if (url === "/api/v1/auth/me")
      return {
        data: {
          user: { id: U, email: "a@b.c", restaurantId: meHouse, role: "manager" },
        },
      };
    if (url === "/api/v1/auth/me/role") return { data: { role: "staff" } };
    return { data: [] };
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe("active role (p2 s6)", () => {
  it("takes the role from /auth/me and reads no /auth/me/role when the active house is the token's house", async () => {
    house(A, A);
    const ctx = await mount();
    await waitFor(() => expect(ctx().activeRole).toBe("manager"));
    expect(roleCalls()).toHaveLength(0);
  });

  it("still asks /auth/me/role when /auth/me names another house than the active one", async () => {
    house(A, B);
    const ctx = await mount();
    await waitFor(() => expect(ctx().activeRole).toBe("staff"));
    expect(roleCalls()).toHaveLength(1);
  });
});
