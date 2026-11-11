import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";

/**
 * Onboarding OB-6: `registerAccount` keeps what became of the verification
 * mail for /verify-email, where Register.tsx sends the new account next.
 * The gateway answers `verificationMail`; it is kept under
 * `mudavym:verification-mail`, and an answer without one clears the key so an
 * earlier sign-up's note is never shown for this one.
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
import { readSignUpMail } from "../lib/verificationMail";

const U = "11111111-1111-4111-8111-111111111111";
const KEY = "mudavym:verification-mail";

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

const ACCOUNT = {
  email: "new@house.test",
  password: "a password of my own",
  name: "Mira Kaya",
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe("registerAccount hands the mail outcome to /verify-email (OB-6)", () => {
  it.each(["not_sent", "unconfirmed", "sent"])(
    "keeps '%s' under mudavym:verification-mail",
    async (outcome) => {
      gatewayAnswers(outcome);
      const auth = await mount();
      await act(async () => {
        await auth().registerAccount(ACCOUNT as never);
      });
      expect(sessionStorage.getItem(KEY)).toBe(JSON.stringify({ outcome, email: "new@house.test" }));
    },
  );

  it("clears an earlier note when the gateway says nothing", async () => {
    sessionStorage.setItem(KEY, "not_sent");
    gatewayAnswers(undefined);
    const auth = await mount();
    await act(async () => {
      await auth().registerAccount(ACCOUNT as never);
    });
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("forgets the note at sign-out, so the next account on this tab sees none", async () => {
    gatewayAnswers("not_sent");
    const auth = await mount();
    await act(async () => {
      await auth().registerAccount(ACCOUNT as never);
    });
    expect(sessionStorage.getItem(KEY)).toBe(JSON.stringify({ outcome: "not_sent", email: "new@house.test" }));
    await act(async () => {
      await auth().logout();
    });
    expect(sessionStorage.getItem(KEY)).toBeNull();
    // Another person signs in on the same tab: /verify-email seeds its one
    // mail state from readSignUpMail(), and there is nothing to read.
    await act(async () => {
      await auth().login("other@house.test", "their own password");
    });
    expect(readSignUpMail("other@house.test")).toBeNull();
  });
});
