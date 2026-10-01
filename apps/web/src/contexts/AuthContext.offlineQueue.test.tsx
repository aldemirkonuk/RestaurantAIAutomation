import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";

/**
 * OD-203, ruled by the founder 2026-09-29 (ADR 0241). The real offline queue
 * (`offlineStorage`, on its localStorage fallback — jsdom has no IndexedDB),
 * the real SyncManager and the real AuthProvider; only axios is mocked.
 *
 *   (b) every queued change carries the person and house that made it, and no
 *       other person or house can see, send, count or clear it;
 *   (c) signing out warns with the number of unsent changes, and clears them
 *       only when the person confirms; a session that simply ends (a refused
 *       refresh) keeps them for the same person's next sign-in.
 *
 * On the code before ADR 0241 every one of these fails: entries carried no
 * owner, `getPendingMutations` returned everything on the device, and
 * `logout()` neither asked nor touched the queue.
 */

const h = vi.hoisted(() => {
  const instance = {
    defaults: { headers: { common: {} as Record<string, string> } },
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
  return { instance, globalPost: vi.fn() };
});

vi.mock("axios", () => ({
  default: { create: () => h.instance, post: h.globalPost },
  create: () => h.instance,
  post: h.globalPost,
}));

import { AuthProvider, useAuth, type AuthContextType } from "./AuthContext";
import { offlineStorage } from "../lib/offline-storage";
import { syncManager } from "../lib/sync-manager";
import { signOutWarning } from "../lib/queue-owner";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const H1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const H2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;
}

function signInAs(userId: string, house: string) {
  localStorage.setItem("accessToken", jwt({ sub: userId, restaurantId: house }));
  localStorage.setItem("refreshToken", "r");
  localStorage.setItem("activeRestaurantId", house);
}

const queue = (type: string, data: unknown = { id: "x" }) =>
  offlineStorage.addPendingMutation({ type, data, timestamp: new Date() });

const ids = async () => (await offlineStorage.getPendingMutations()).map((m) => m.id);

function Probe({ onReady }: { onReady: (a: AuthContextType) => void }) {
  onReady(useAuth());
  return null;
}

async function mountAs(userId: string, house: string) {
  signInAs(userId, house);
  h.instance.get.mockImplementation(async (url: string) =>
    url === "/api/v1/auth/me"
      ? {
          data: {
            user: { userId, email: "p@house.test", restaurantId: house, role: "staff", emailVerified: true },
          },
        }
      : { data: [{ id: house, name: "Moda" }] },
  );
  h.instance.post.mockResolvedValue({ data: {} });
  let ctx: AuthContextType | null = null;
  render(
    <AuthProvider>
      <Probe onReady={(a) => (ctx = a)} />
    </AuthProvider>,
  );
  await waitFor(() => expect(ctx?.loading).toBe(false));
  return () => ctx as unknown as AuthContextType;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // Offline, so the pre-sign-out send attempt cannot empty the queue itself.
  window.dispatchEvent(new Event("offline"));
});
afterEach(() => vi.restoreAllMocks());

describe("OD-203 (b) — a queued change belongs to the person and house that made it", () => {
  it("stamps the owner at queue time", async () => {
    signInAs(U1, H1);
    await queue("calendar.delete");
    const [m] = await offlineStorage.getPendingMutations();
    expect(m.owner).toEqual({ userId: U1, restaurantId: H1 });
  });

  it("is invisible to another person on the same device, and to the same person in another house", async () => {
    signInAs(U1, H1);
    const mine = await queue("calendar.delete");

    signInAs(U2, H1);
    expect(await ids()).toEqual([]);

    signInAs(U1, H2);
    expect(await ids()).toEqual([]);

    signInAs(U1, H1);
    expect(await ids()).toEqual([mine]);
  });

  it("binds a legacy door receipt to the house it names, and never sends a legacy change that names no one", async () => {
    // Written the way the queue wrote them before ADR 0241: no owner.
    localStorage.setItem(
      "pending_mutations_all",
      JSON.stringify([
        { id: "door-old", type: "receiving.door", data: { restaurantId: H1 }, timestamp: new Date(), retryCount: 0 },
        { id: "cal-old", type: "calendar.delete", data: { id: "e" }, timestamp: new Date(), retryCount: 0 },
      ]),
    );
    signInAs(U2, H2);
    expect(await ids()).toEqual(["cal-old"]);
    signInAs(U2, H1);
    expect(await ids()).toEqual(["door-old", "cal-old"]);
  });
});

describe("OD-203 (c) — signing out warns, then clears; a session that ends keeps", () => {
  it("names the count, and staying signed in changes nothing", async () => {
    signInAs(U1, H1);
    await queue("calendar.delete");
    await queue("provider.update", { id: "p" });
    const auth = await mountAs(U1, H1);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    let out: boolean | undefined;
    await act(async () => {
      out = await auth().logout();
    });

    expect(confirm).toHaveBeenCalledWith(signOutWarning(2));
    expect(out).toBe(false);
    expect(localStorage.getItem("accessToken")).not.toBeNull();
    expect((await ids()).length).toBe(2);
  });

  it("on confirm, signs out and removes this person's changes in every house — and no one else's", async () => {
    signInAs(U2, H1);
    const theirs = await queue("calendar.delete");
    signInAs(U1, H2);
    await queue("calendar.delete");
    signInAs(U1, H1);
    await queue("calendar.delete");

    const auth = await mountAs(U1, H1);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let out: boolean | undefined;
    await act(async () => {
      out = await auth().logout();
    });

    expect(out).toBe(true);
    expect(localStorage.getItem("accessToken")).toBeNull();
    const left = await offlineStorage.getAllPendingMutationsOnDevice();
    expect(left.map((m) => m.id)).toEqual([theirs]);
  });

  it("counts and removes legacy changes that name no one, but keeps a legacy door receipt for its house", async () => {
    localStorage.setItem(
      "pending_mutations_all",
      JSON.stringify([
        { id: "door-old", type: "receiving.door", data: { restaurantId: H2 }, timestamp: new Date(), retryCount: 0 },
        { id: "cal-old", type: "calendar.delete", data: { id: "e" }, timestamp: new Date(), retryCount: 0 },
      ]),
    );
    const auth = await mountAs(U1, H1);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    await act(async () => {
      await auth().logout();
    });

    expect(confirm).toHaveBeenCalledWith(signOutWarning(1));
    const left = await offlineStorage.getAllPendingMutationsOnDevice();
    expect(left.map((m) => m.id)).toEqual(["door-old"]);
  });

  it("does not ask when nothing is waiting", async () => {
    const auth = await mountAs(U1, H1);
    const confirm = vi.spyOn(window, "confirm");
    await act(async () => {
      await auth().logout();
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(localStorage.getItem("accessToken")).toBeNull();
  });

  it("a session that ends on its own (refused refresh) keeps the changes for the same person's return", async () => {
    signInAs(U1, H1);
    const mine = await queue("calendar.delete");
    const auth = await mountAs(U1, H1);
    localStorage.removeItem("refreshToken");
    const confirm = vi.spyOn(window, "confirm");

    await act(async () => {
      await auth().refreshToken();
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(localStorage.getItem("accessToken")).toBeNull();
    signInAs(U1, H1);
    expect(await ids()).toEqual([mine]);
  });

  it("the not-sent strip's Discard removes only this session's parked changes", async () => {
    signInAs(U1, H1);
    const parked = await queue("calendar.delete");
    await offlineStorage.updatePendingMutation(parked, {
      parked: { reason: "refused", status: 422, at: new Date().toISOString() },
    });
    const waiting = await queue("calendar.delete");
    signInAs(U2, H1);
    const other = await queue("calendar.delete");
    await offlineStorage.updatePendingMutation(other, {
      parked: { reason: "refused", status: 422, at: new Date().toISOString() },
    });

    signInAs(U1, H1);
    expect(await syncManager.discardNotSent()).toBe(1);
    const left = (await offlineStorage.getAllPendingMutationsOnDevice()).map((m) => m.id);
    expect(left.sort()).toEqual([waiting, other].sort());
  });
});

describe("founder storage ruling 2026-09-29 — sign-out clears the read cache, and never hangs on it", () => {
  it("clears the read cache on a confirmed sign-out", async () => {
    signInAs(U1, H1);
    const clear = vi.spyOn(offlineStorage, "clearEntityCache").mockResolvedValue(undefined);
    const auth = await mountAs(U1, H1);
    let out: boolean | undefined;
    await act(async () => {
      out = await auth().logout();
    });
    expect(out).toBe(true);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("finishes signing out even when the cache clear never settles", async () => {
    signInAs(U1, H1);
    vi.spyOn(offlineStorage, "clearEntityCache").mockReturnValue(new Promise<void>(() => {}));
    const auth = await mountAs(U1, H1);
    let done = false;
    await act(async () => {
      void auth()
        .logout()
        .then(() => {
          done = true;
        });
    });
    await waitFor(() => expect(done).toBe(true), { timeout: 5000 });
    expect(localStorage.getItem("accessToken")).toBeNull();
    await waitFor(() => expect(auth().user).toBeNull());
  }, 10000);
});
