import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";

/**
 * r104 (DD-r102-4 step 2): after the code or link verifies, `signInWithSession`
 * resolves only once `/auth/me` has put the now-verified person in context, so
 * the page that follows (/get-started) reads `emailVerified: true` with no
 * page load. The old tree waited 1.5 s and reloaded.
 */

const h = vi.hoisted(() => {
  const instance = {
    defaults: { headers: { common: {} as Record<string, string> } },
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    get: vi.fn(),
    post: vi.fn(),
  };
  const isAxiosError = (e: unknown) =>
    Boolean((e as { isAxiosError?: boolean } | null)?.isAxiosError);
  return { instance, globalPost: vi.fn(), isAxiosError };
});

vi.mock("axios", () => ({
  default: {
    create: () => h.instance,
    post: h.globalPost,
    isAxiosError: h.isAxiosError,
  },
  create: () => h.instance,
  post: h.globalPost,
  isAxiosError: h.isAxiosError,
}));

import { AuthProvider, useAuth, type AuthContextType } from "./AuthContext";

const U = "11111111-1111-4111-8111-111111111111";

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

function gatewayAnswers(verificationMail?: string) {
  h.instance.post.mockResolvedValue({
    data: {
      accessToken: jwt({ sub: U, restaurantId: null }),
      refreshToken: "r",
      ...(verificationMail ? { verificationMail } : {}),
    },
  });
  h.instance.get.mockImplementation(async (url: string) =>
    url === "/api/v1/auth/me"
      ? {
          data: {
            user: {
              userId: U,
              email: "new@house.test",
              restaurantId: null,
              role: null,
              emailVerified: false,
            },
          },
        }
      : { data: [] },
  );
}


describe("signInWithSession settles the verified person in place (r104)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it("the person read after it resolves is verified, with no reload", async () => {
    h.instance.get.mockImplementation(async (url: string) =>
      url === "/api/v1/auth/me"
        ? {
            data: {
              user: {
                userId: U,
                email: "new@house.test",
                restaurantId: null,
                role: null,
                emailVerified: true,
              },
            },
          }
        : { data: [] },
    );
    const auth = await mount();
    expect(auth().user?.emailVerified).not.toBe(true);
    await act(async () => {
      await auth().signInWithSession({
        accessToken: jwt({ sub: U, restaurantId: null }),
        refreshToken: "r",
      });
    });
    expect(auth().user?.emailVerified).toBe(true);
    expect(localStorage.getItem("refreshToken")).toBe("r");
  });
});
