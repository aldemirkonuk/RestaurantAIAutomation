import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * A house switch clears the last house (PROCURE-04, MENU-01, OPS-03).
 *
 *  1. When the session moves to another house, every read the page holds is
 *     forgotten once the new token is stored and before anything renders
 *     under the new house's name; what is still on screen is read again
 *     under the new token, and the old house's keys are not.
 *  2. Sign-out forgets the reads and the changes made in the session.
 *  3. The key sweep: the six reads the findings named carry the house in
 *     their key, so one house's figures never stand under another's name.
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

// Every axios client the app builds (AuthContext's own and `apiClient`) is
// this one instance, so a read answers for the house the stored token names,
// as the gateway does.
vi.mock("axios", () => ({
  default: { create: () => h.instance, post: h.globalPost },
  create: () => h.instance,
  post: h.globalPost,
}));

const svc = vi.hoisted(() => ({
  listPriceLocks: vi.fn(),
  getPriceAdvice: vi.fn(),
  listMenuVersions: vi.fn(),
  getMenu: vi.fn(),
  houseCurrency: vi.fn(),
}));

vi.mock("../services/api/pricing", async () => {
  const actual = await vi.importActual<
    typeof import("../services/api/pricing")
  >("../services/api/pricing");
  return {
    ...actual,
    listPriceLocks: svc.listPriceLocks,
    getPriceAdvice: svc.getPriceAdvice,
  };
});
vi.mock("../services/api/menus", async () => {
  const actual = await vi.importActual<typeof import("../services/api/menus")>(
    "../services/api/menus",
  );
  return {
    ...actual,
    listMenuVersions: svc.listMenuVersions,
    getMenu: svc.getMenu,
  };
});
vi.mock("../services/api/settings", async () => {
  const actual = await vi.importActual<
    typeof import("../services/api/settings")
  >("../services/api/settings");
  return {
    ...actual,
    settingsApi: { ...actual.settingsApi, houseCurrency: svc.houseCurrency },
  };
});

import {
  AuthContext,
  AuthProvider,
  useAuth,
  type AuthContextType,
} from "./AuthContext";
import { useAuthStore } from "../stores";
import { offlineStorage } from "../lib/offline-storage";
import { tokenHouse } from "../lib/houseMemory";
import MenuNext from "../pages/menu/next/MenuNext";
import PriceLockNote from "../pages/cellar/next/PriceLockNote";
import { UsualCurrencyCoveragePanel } from "../pages/providers/next/UsualCurrencyCoveragePanel";
import { usePromotionsRead } from "../pages/promotions/next/usePromotionsNextData";
import type { PriceLock } from "../services/api/pricing";

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

const never = () => new Promise<never>(() => {});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  useAuthStore.setState({ activeRestaurantId: null });
});

// ---------------------------------------------------------------------------
// 1 + 2: the provider forgets the last house's reads
// ---------------------------------------------------------------------------

/** The house the stored token names: what the gateway would answer for. */
const tokenHouseNow = () => tokenHouse(localStorage.getItem("accessToken"));

type Frame = { house: string | null; shown: string | null };

function Probe({ onReady }: { onReady: (a: AuthContextType) => void }) {
  onReady(useAuth());
  return null;
}

/** A read keyed WITHOUT the house, as the reads the sweep left are. */
function Unkeyed({ frames }: { frames: Frame[] }) {
  const { activeRestaurantId } = useAuth();
  const q = useQuery({
    queryKey: ["house-read"],
    queryFn: async () => (await h.instance.get("/house-read")).data as string,
  });
  frames.push({ house: activeRestaurantId, shown: q.data ?? null });
  return null;
}

/** A read keyed WITH the house; logs the key each time it is read. */
function Keyed({ reads }: { reads: Array<string | null> }) {
  const house = useAuthStore((s) => s.activeRestaurantId);
  useQuery({
    queryKey: ["keyed-read", house],
    queryFn: async () => {
      reads.push(house);
      return (await h.instance.get("/house-read")).data as string;
    },
  });
  return null;
}

function serve() {
  h.instance.get.mockImplementation(async (url: string) => {
    if (url === "/api/v1/auth/me")
      return {
        data: {
          user: {
            userId: U,
            email: "p@house.test",
            restaurantId: tokenHouseNow(),
            role: "owner",
            emailVerified: true,
          },
        },
      };
    if (url === "/house-read") return { data: `${tokenHouseNow()}-data` };
    return {
      data: [
        { id: A, name: "Moda" },
        { id: B, name: "Kadikoy" },
      ],
    };
  });
}

async function mountInA() {
  localStorage.setItem("accessToken", jwt({ sub: U, restaurantId: A }));
  serve();
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const frames: Frame[] = [];
  const keyedReads: Array<string | null> = [];
  let ctx: AuthContextType | null = null;
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Probe onReady={(a) => (ctx = a)} />
        <Unkeyed frames={frames} />
        <Keyed reads={keyedReads} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  const auth = () => ctx as unknown as AuthContextType;
  await waitFor(() => expect(auth().activeRestaurantId).toBe(A));
  await waitFor(() =>
    expect(frames.at(-1)).toEqual({ house: A, shown: `${A}-data` }),
  );
  await waitFor(() => expect(qc.getQueryData(["keyed-read", A])).toBe(`${A}-data`));
  return { qc, frames, keyedReads, auth };
}

describe("a house switch forgets the last house's reads", () => {
  it("nothing of house A is drawn under house B; what is on screen is read again under B's token; A's keys are not read again", async () => {
    const { qc, frames, keyedReads, auth } = await mountInA();
    // A read nobody is watching any more, left from earlier in house A.
    qc.setQueryData(["left-behind"], `${A}-only`);

    h.instance.post.mockResolvedValue({
      data: {
        accessToken: jwt({ sub: U, restaurantId: B }),
        refreshToken: "r",
        restaurantId: B,
      },
    });
    const before = frames.length;
    const keyedBefore = keyedReads.length;
    // `/auth/me` is held open, as a real round trip is, so React paints the
    // frames between the new house's name and the end of the switch. A forget
    // placed after that read would let one of them draw A's data under B.
    let releaseMe: () => void = () => {};
    const meAnswered = new Promise<void>((resolve) => (releaseMe = resolve));
    const served = h.instance.get.getMockImplementation()!;
    h.instance.get.mockImplementation(async (url: string) => {
      if (url === "/api/v1/auth/me") await meAnswered;
      return served(url);
    });
    let switching: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      switching = auth().setActiveRestaurantId(B);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(auth().activeRestaurantId).toBe(B);
    let ok: boolean | undefined;
    await act(async () => {
      releaseMe();
      ok = await switching;
    });

    expect(ok).toBe(true);
    await waitFor(() =>
      expect(frames.at(-1)).toEqual({ house: B, shown: `${B}-data` }),
    );
    // No frame after the switch drew A's data under B's name.
    const after = frames.slice(before);
    expect(after.filter((f) => f.house === B && f.shown === `${A}-data`)).toEqual([]);
    expect(qc.getQueryCache().find({ queryKey: ["left-behind"] })).toBeUndefined();
    // The house-keyed read moved to B, and A's key was not read again.
    await waitFor(() => expect(qc.getQueryData(["keyed-read", B])).toBe(`${B}-data`));
    expect(keyedReads.slice(keyedBefore)).toEqual([B]);
    expect(qc.getQueryData(["keyed-read", A])).toBeUndefined();
  });

  it("the device read cache is emptied on the switch, before the new session is stored", async () => {
    const { auth } = await mountInA();
    const clearedIn: Array<string | null> = [];
    const clear = vi
      .spyOn(offlineStorage, "clearEntityCache")
      .mockImplementation(async () => {
        clearedIn.push(tokenHouseNow());
      });
    h.instance.post.mockResolvedValue({
      data: { accessToken: jwt({ sub: U, restaurantId: B }), refreshToken: "r" },
    });
    await act(async () => {
      await auth().setActiveRestaurantId(B);
    });
    expect(clear).toHaveBeenCalledTimes(1);
    expect(clearedIn).toEqual([A]);
    clear.mockRestore();
  });

  it("creating a new house from inside another forgets the old house's reads too", async () => {
    const { qc, frames, auth } = await mountInA();
    qc.setQueryData(["left-behind"], `${A}-only`);
    const clearedIn: Array<string | null> = [];
    const clear = vi
      .spyOn(offlineStorage, "clearEntityCache")
      .mockImplementation(async () => {
        clearedIn.push(tokenHouseNow());
      });
    h.instance.post.mockResolvedValue({
      data: {
        restaurantId: B,
        accessToken: jwt({ sub: U, restaurantId: B }),
        refreshToken: "r",
      },
    });
    const before = frames.length;
    await act(async () => {
      await auth().createFirstHouse({ restaurantName: "Kadikoy" } as never);
    });
    await waitFor(() =>
      expect(frames.at(-1)).toEqual({ house: B, shown: `${B}-data` }),
    );
    const after = frames.slice(before);
    expect(after.filter((f) => f.house === B && f.shown === `${A}-data`)).toEqual([]);
    expect(qc.getQueryCache().find({ queryKey: ["left-behind"] })).toBeUndefined();
    // The device read cache too, before the new house's session is stored.
    expect(clear).toHaveBeenCalledTimes(1);
    expect(clearedIn).toEqual([A]);
    clear.mockRestore();
  });

  // Only a switch the server refuses is claimed here: its POST fails before
  // the device read cache is emptied. A switch overtaken by a later one after
  // its POST answered has already emptied that cache before it returns false.
  it("a switch the server refuses forgets nothing", async () => {
    const { qc, frames, auth } = await mountInA();
    const clear = vi.spyOn(offlineStorage, "clearEntityCache");
    h.instance.post.mockRejectedValue({ response: { status: 403 } });
    await act(async () => {
      await auth().setActiveRestaurantId(B);
    });
    expect(auth().activeRestaurantId).toBe(A);
    expect(qc.getQueryData(["house-read"])).toBe(`${A}-data`);
    expect(frames.at(-1)).toEqual({ house: A, shown: `${A}-data` });
    // The device read cache is left as it was too.
    expect(clear).not.toHaveBeenCalled();
    clear.mockRestore();
  });

  it("sign-out forgets every read and every change of the session", async () => {
    const { qc, auth } = await mountInA();
    qc.setQueryData(["left-behind"], `${A}-only`);
    qc.getMutationCache().build(qc, { mutationKey: ["a-change"] });
    h.instance.post.mockResolvedValue({ data: {} });

    await act(async () => {
      await auth().logout();
    });

    expect(auth().user).toBeNull();
    expect(qc.getQueryData(["house-read"])).toBeUndefined();
    expect(qc.getQueryData(["keyed-read", A])).toBeUndefined();
    expect(qc.getQueryCache().find({ queryKey: ["left-behind"] })).toBeUndefined();
    expect(qc.getMutationCache().getAll()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3: the key sweep
// ---------------------------------------------------------------------------

const LOCK: PriceLock = {
  lockId: "lock-a",
  inventoryId: "inv-a",
  kind: "bottle",
  lockedPrice: 50,
  lockedAt: "2026-09-09T09:00:00Z",
  ageDays: 12,
  note: null,
  movedFromLockId: null,
  lockedBy: { userId: "u5", name: "Aylin" },
  wine: { name: "Barolo", vintage: 2019, masterWineId: "mw-a", active: true, housePrice: 50 },
  dormant: false,
  menuPrice: 55,
  markers: [],
  advice: null,
  adviceUnknownReason: null,
};

function keysOf(qc: QueryClient) {
  return qc.getQueryCache().getAll().map((q) => q.queryKey);
}

function wrap(qc: QueryClient, house: string | null) {
  const value = {
    activeRestaurantId: house,
    loading: false,
    activeRole: "owner",
    user: null,
  } as unknown as AuthContextType;
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    </QueryClientProvider>
  );
}

describe("the key sweep: the named house reads carry the house", () => {
  beforeEach(() => {
    svc.getMenu.mockImplementation(never);
    svc.listMenuVersions.mockImplementation(never);
    svc.houseCurrency.mockImplementation(never);
    svc.getPriceAdvice.mockImplementation(never);
    svc.listPriceLocks.mockResolvedValue({
      restaurantId: A,
      generatedAt: "2026-10-07T12:00:00Z",
      readable: true,
      reason: null,
      scope: "this house",
      currentMenus: [],
      locks: [LOCK],
      counts: { open: 1, onCurrentMenu: 1, notOnCurrentMenu: 0, toReview: 0 },
      namesReadable: true,
      namesReason: null,
      markersReadable: true,
      markersReason: null,
    });
    h.instance.get.mockImplementation(never);
    useAuthStore.setState({ activeRestaurantId: A });
  });

  it("Menu: the currency, the locked prices, the price advice and the kept versions (MENU-01)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = wrap(qc, A);
    render(
      <Wrapper>
        <MenuNext />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(keysOf(qc)).toEqual(
        expect.arrayContaining([
          ["settings", "currency", A],
          ["pricing", "locks", A],
          ["menu", "versions", A],
          ["pricing", "advice", A],
        ]),
      ),
    );
    const bare = keysOf(qc).filter((k) =>
      [
        '["settings","currency"]',
        '["pricing","locks"]',
        '["pricing","advice"]',
        '["menu","versions"]',
      ].includes(JSON.stringify(k)),
    );
    expect(bare).toEqual([]);
  });

  it("Cellar: a bottle's lock note reads the same house-keyed locks (MENU-01)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<PriceLockNote inventoryId="inv-a" />, { wrapper: wrap(qc, A) });
    await waitFor(() => expect(keysOf(qc)).toContainEqual(["pricing", "locks", A]));
  });

  it("Vendors: the usual-currency coverage (PROCURE-04)", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <UsualCurrencyCoveragePanel knownIds={new Set()} onOpenVendor={() => {}} />,
      { wrapper: wrap(qc, A) },
    );
    expect(keysOf(qc)).toContainEqual(["vendor-usual-currency-coverage", A]);
  });

  it("Promotions: the offers read, and a switch moves it to the new house's key (PROCURE-04)", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = renderHook(() => usePromotionsRead(false), {
      wrapper: wrap(qc, A),
    });
    expect(keysOf(qc)).toContainEqual(["promotions-next", "read", A, false]);
    act(() => useAuthStore.setState({ activeRestaurantId: B }));
    rerender();
    expect(keysOf(qc)).toContainEqual(["promotions-next", "read", B, false]);
  });
});
