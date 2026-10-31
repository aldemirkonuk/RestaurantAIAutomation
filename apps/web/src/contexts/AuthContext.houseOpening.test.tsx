import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Opening a house, as AuthContext hands it to the page (F-006).
 *
 *  - A refused POST reaches the page whole, status and all, and no raw text
 *    is stored to be shown.
 *  - A house that opened is still an opened house when the `/auth/me` read
 *    after it fails; the page is told the details did not load.
 *  - /register's catch says the house in words chosen by status alone.
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
import { getErrorStatus } from "../services/api/client";
import {
  HOUSE_OPEN_DETAILS_LATER,
  houseNotOpened,
} from "../lib/houseOpeningWords";

const U = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;
}

const HOUSE = {
  restaurantName: "Meyhane",
  address: "1 House Street",
  city: "Istanbul",
  country: "Türkiye",
};

const refused = Object.assign(new Error("Request failed with status code 400"), {
  isAxiosError: true,
  request: {},
  response: {
    status: 400,
    data: { message: "value too long for type character varying(100)" },
  },
});

/** A signed-in person with no house yet, as /get-started meets them. */
function signedInWithNoHouse(meAfterOpening: "loads" | "fails") {
  localStorage.setItem("accessToken", jwt({ sub: U, restaurantId: null }));
  let opened = false;
  h.instance.get.mockImplementation(async (url: string) => {
    if (url !== "/api/v1/auth/me") return { data: [] };
    if (opened && meAfterOpening === "fails")
      throw Object.assign(new Error("Request failed with status code 500"), {
        isAxiosError: true,
        response: { status: 500, data: {} },
      });
    return {
      data: {
        user: {
          userId: U,
          email: "p@house.test",
          restaurantId: opened ? A : null,
          role: opened ? "owner" : null,
          emailVerified: true,
        },
      },
    };
  });
  h.instance.post.mockImplementation(async () => {
    opened = true;
    return {
      data: {
        restaurantId: A,
        accessToken: jwt({ sub: U, restaurantId: A, role: "owner" }),
        refreshToken: "r",
      },
    };
  });
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

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe("createFirstHouse (F-006, scope item 5)", () => {
  it("hands a refused POST to the page whole and stores no raw text", async () => {
    signedInWithNoHouse("loads");
    h.instance.post.mockRejectedValue(refused);
    const auth = await mount();
    h.instance.get.mockClear();

    let thrown: unknown;
    await act(async () => {
      thrown = await rejection(auth().createFirstHouse(HOUSE));
    });

    expect(thrown).toBe(refused);
    expect(auth().error).toBeNull();
    expect(h.instance.get).not.toHaveBeenCalledWith("/api/v1/auth/me");
  });

  it("is an opened house when only /auth/me fails afterwards", async () => {
    signedInWithNoHouse("fails");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const auth = await mount();

    let opened: unknown;
    await act(async () => {
      opened = await auth().createFirstHouse(HOUSE);
    });

    expect(opened).toEqual({ restaurantId: A, detailsLoaded: false });
    expect(localStorage.getItem("activeRestaurantId")).toBe(A);
    expect(auth().activeRestaurantId).toBe(A);
    expect(auth().user?.restaurantId).toBe(A);
    // The role in the new house comes from its token (round-1 F5).
    expect(auth().user?.role).toBe("owner");
    expect(warn).toHaveBeenCalledWith(
      "house opened; /auth/me did not load",
      expect.anything(),
    );
    warn.mockRestore();
  });

  it("says the details loaded when both answer", async () => {
    signedInWithNoHouse("loads");
    const auth = await mount();

    let opened: unknown;
    await act(async () => {
      opened = await auth().createFirstHouse(HOUSE);
    });

    expect(opened).toEqual({ restaurantId: A, detailsLoaded: true });
    expect(auth().user?.restaurantId).toBe(A);
  });
});

describe("registerRestaurant (F-006, scope item 6)", () => {
  it("hands a refusal to Register's house form with its status", async () => {
    h.instance.post.mockRejectedValue(refused);
    const auth = await mount();

    let thrown: unknown;
    await act(async () => {
      thrown = await rejection(
        auth().registerRestaurant({
          name: "Selin Kaya",
          email: "selin@example.com",
          password: "long-enough",
          ...HOUSE,
        }),
      );
    });

    expect(thrown).toBe(refused);
    expect(getErrorStatus(thrown)).toBe(400);
    expect(auth().error).toBeNull();
  });

  it("says each register outcome by status", () => {
    const status = (n: number) => ({ response: { status: n, data: {} } });
    expect(houseNotOpened(status(400), "register")).toBe(
      "We could not register the house with these details. If this email already has an account, sign in instead; otherwise check the details and try again.",
    );
    const unconfirmed =
      "We could not confirm the registration went through. If a verification email arrives, it did: sign in instead of registering again. If none arrives within a few minutes, register again.";
    expect(houseNotOpened(status(500), "register")).toBe(unconfirmed);
    expect(
      houseNotOpened({ isAxiosError: true, request: {} }, "register"),
    ).toBe(unconfirmed);
    expect(houseNotOpened(status(429), "register")).toBe(
      "Too many tries in a short time. Wait a minute, then try again.",
    );
    expect(houseNotOpened(new Error("x"), "register")).toBe(
      "Registration failed",
    );
    // /register's 409 is a place that is already a house: refused and said
    // (the founder, 2026-10-08, F-006 OPEN-1: "Refuse, say it exists").
    expect(houseNotOpened(status(409), "register")).toBe(
      "A house is already open at this place, so this one was not registered. If it is yours, sign in instead.",
    );
  });

  it("Register.tsx's house-form catch calls houseNotOpened, never the error's text (source read)", () => {
    // A source read, not a render: the form cannot be rendered today
    // (Register.tsx starts it at step 1 and nothing moves it on), so this
    // checks what its catch calls, not what a person sees.
    const src = readFileSync(
      resolve(process.cwd(), "src/pages/Register.tsx"),
      "utf8",
    );
    const start = src.indexOf("const handleCreateSubmit = async () => {");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("\n  }\n", start));
    expect(body).toContain("setError(houseNotOpened(err, 'register'))");
    expect(body).not.toContain("err.message");
    expect(body).not.toContain("err instanceof Error ?");
  });
});

describe("the sentences (F-006)", () => {
  it("name no rule, no storage and no other house", () => {
    const causes = [
      { response: { status: 400 } },
      { response: { status: 409 } },
      { response: { status: 429 } },
      { response: { status: 500 } },
      { isAxiosError: true, request: {} },
      new Error("x"),
    ];
    const sentences = new Set([
      HOUSE_OPEN_DETAILS_LATER,
      ...causes.flatMap((cause) => [
        houseNotOpened(cause, "arrival"),
        houseNotOpened(cause, "register"),
      ]),
    ]);
    // W1, W3, W4, W5, the 429 sentence, R1, R2, R3 (the held place) and
    // the two kept fallbacks.
    expect(sentences.size).toBe(10);
    const forbidden = [
      "idx",
      "constraint",
      "unique",
      "duplicate",
      "database",
      "index",
      "column",
      "row",
      "varchar",
      "byte",
      "another house",
      "already has a house",
      "already held",
      "taken",
    ];
    // The 409 sentence is the one exception to "already has a house": it is
    // said on the signed-in /get-started only, of the person's own account,
    // and names no place.
    const ownAccount = houseNotOpened({ response: { status: 409 } }, "arrival");
    // /register's 409 names a house at the place, by the founder's ruling;
    // it still names no rule, index or storage.
    const heldPlace = houseNotOpened({ response: { status: 409 } }, "register");
    expect(heldPlace).toMatch(/^A house is already open at this place/);
    expect(ownAccount).toBe(
      "This account already has a house, so no second one was opened.",
    );
    for (const sentence of sentences)
      for (const word of forbidden)
        if (
          !(sentence === ownAccount && word === "already has a house") &&
          sentence !== heldPlace
        )
          expect(sentence.toLowerCase()).not.toContain(word);
    for (const word of forbidden.slice(0, 10))
      expect(heldPlace.toLowerCase()).not.toContain(word);
  });
});
