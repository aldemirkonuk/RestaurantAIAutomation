/**
 * A house switch and what else is open (sim F-244, F-192), against the REAL
 * AuthProvider.
 *
 *  - F-244: every tab shares one session in localStorage, so a switch in one
 *    tab moved every other tab's reads and writes to the new house with no
 *    word. The other tab now stops and says where the person went.
 *  - F-192: after a switch, the last house's role went on answering until
 *    /auth/me/role replied, so /team and Settings drew the old desk.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, screen } from "@testing-library/react";

const mockApi = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  defaults: { headers: { common: {} as Record<string, string> } },
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
}));

vi.mock("axios", () => ({
  default: {
    create: vi.fn(() => mockApi),
    post: vi.fn(),
    isAxiosError: vi.fn(() => false),
  },
}));
vi.mock("../lib/error-tracking", () => ({
  errorTracking: { setUser: vi.fn() },
}));

import { AuthProvider, useAuth } from "./AuthContext";
import { queueOwnerForNewEntry } from "../lib/queue-owner";

const HOUSE_A = "11111111-1111-4111-8111-111111111111";
const HOUSE_B = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;
}
const TOKEN_A = jwt({ sub: USER, restaurantId: HOUSE_A });
const TOKEN_B = jwt({ sub: USER, restaurantId: HOUSE_B });

const BRANCHES = [
  { id: HOUSE_A, name: "Larkspur & Vine", city: null, chain_id: null, chain_name: null },
  { id: HOUSE_B, name: "Harbor House", city: null, chain_id: null, chain_name: null },
];
// The person owns A and waits tables at B.
const ROLE_IN: Record<string, string> = { [HOUSE_A]: "owner", [HOUSE_B]: "staff" };

let roleReply: (house: string) => Promise<{ data: { role: string } }>;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("accessToken", TOKEN_A);
  localStorage.setItem("refreshToken", "refresh-a");
  mockApi.post.mockReset();
  mockApi.get.mockReset();
  roleReply = async (house) => ({ data: { role: ROLE_IN[house] } });
  mockApi.get.mockImplementation(
    async (url: string, config?: { params?: { restaurantId?: string } }) => {
      if (url === "/api/v1/auth/me") {
        const house =
          localStorage.getItem("accessToken") === TOKEN_B ? HOUSE_B : HOUSE_A;
        return {
          data: {
            user: { id: USER, userId: USER, email: "a@example.com", role: ROLE_IN[house] },
          },
        };
      }
      if (url === "/api/v1/auth/me/role")
        return roleReply(config?.params?.restaurantId ?? "");
      if (url === "/api/v1/organizations/branches") return { data: BRANCHES };
      return { data: [] };
    },
  );
});

afterEach(() => {
  localStorage.clear();
});

async function signedInAtA() {
  const view = renderHook(() => useAuth(), { wrapper: AuthProvider });
  await waitFor(() => expect(view.result.current.activeRestaurantId).toBe(HOUSE_A));
  await waitFor(() => expect(view.result.current.activeRole).toBe("owner"));
  return view;
}

function anotherTabMovedTo(house: string | null) {
  act(() => {
    window.dispatchEvent(
      new StorageEvent("storage", { key: "activeRestaurantId", newValue: house }),
    );
  });
}

describe("a switch in another tab (F-244)", () => {
  it("stops this tab and says where the person went, without moving it", async () => {
    const { result } = await signedInAtA();
    expect(screen.queryByRole("alertdialog")).toBeNull();

    anotherTabMovedTo(HOUSE_B);

    const notice = await screen.findByRole("alertdialog");
    expect(notice.textContent).toContain("You moved to Harbor House in another tab.");
    expect(notice.textContent).toContain("This tab still shows Larkspur & Vine.");
    expect(screen.getByRole("button", { name: "Open Harbor House here" })).toBeTruthy();
    // Nothing moved under the person: the tab still names the house it shows.
    expect(result.current.activeRestaurantId).toBe(HOUSE_A);
  });

  it("a change queued in this tab after the other tab moved still belongs to this tab's house", async () => {
    await signedInAtA();
    localStorage.setItem("accessToken", TOKEN_B);
    localStorage.setItem("activeRestaurantId", HOUSE_B);
    anotherTabMovedTo(HOUSE_B);
    await screen.findByRole("alertdialog");

    expect(queueOwnerForNewEntry()).toEqual({ userId: USER, restaurantId: HOUSE_A });
  });

  it("goes quiet again when the other tab comes back to this tab's house", async () => {
    await signedInAtA();
    anotherTabMovedTo(HOUSE_B);
    await screen.findByRole("alertdialog");
    anotherTabMovedTo(HOUSE_A);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("says nothing about other keys, a sign-out elsewhere, or before anyone signed in", async () => {
    await signedInAtA();
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "accessToken", newValue: TOKEN_B }));
    });
    anotherTabMovedTo(null);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("the role after a switch (F-192)", () => {
  it("the last house's role stops answering the moment the page moves, until the new house's role is read", async () => {
    const { result } = await signedInAtA();

    // B's person and role reads hang, as on a slow network.
    let answerB!: () => void;
    let answerMe!: () => void;
    const meHeld = new Promise<void>((resolve) => (answerMe = resolve));
    roleReply = (house) =>
      house === HOUSE_B
        ? new Promise((resolve) => {
            answerB = () => resolve({ data: { role: "staff" } });
          })
        : Promise.resolve({ data: { role: ROLE_IN[house] } });
    const served = mockApi.get.getMockImplementation()!;
    mockApi.get.mockImplementation(async (url: string, config?: unknown) => {
      if (url === "/api/v1/auth/me") await meHeld;
      return served(url, config);
    });

    mockApi.post.mockResolvedValueOnce({
      data: { accessToken: TOKEN_B, refreshToken: "refresh-b" },
    });
    let switching: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      switching = result.current.setActiveRestaurantId(HOUSE_B);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(result.current.activeRestaurantId).toBe(HOUSE_B);
    // Not A's owner desk while B's role is still on its way: neither the
    // house role nor the person's role from A's `/auth/me`.
    expect(result.current.activeRole).toBeNull();
    expect(result.current.user?.role ?? null).toBeNull();

    let moved: boolean | undefined;
    await act(async () => {
      answerMe();
      moved = await switching;
    });
    expect(moved).toBe(true);
    expect(result.current.user?.role).toBe("staff");

    await act(async () => {
      answerB();
    });
    await waitFor(() => expect(result.current.activeRole).toBe("staff"));
  });
});
