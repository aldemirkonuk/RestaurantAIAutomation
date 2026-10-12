/**
 * F-1407 – F-1410: a day at the door with no signal.
 *
 * The queue rules are tested in state/__tests__/outbox.test.ts. Screens are
 * React Native components this runner does not render (see jest.config.js),
 * so their guards read the source, as receiveQueueScreens.test.ts does.
 */
jest.mock("@/api/client", () => ({
  api: jest.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
      public body?: unknown,
    ) {
      super(message);
    }
  },
}));
jest.mock("@/state/session", () => ({ useSession: () => undefined }));
import fs from "fs";
import path from "path";
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/api/client";
import { NEVER_LOADED_WORDS, noAnswer, orderFromLists } from "@/api/queries";

const read = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, "../../..", rel), "utf8");

describe("Count it with no signal (F-1409)", () => {
  it("finds the order in the lists saved on the phone", () => {
    const qc = new QueryClient();
    qc.setQueryData(["orders", "pending"], [{ id: "o1", orderNumber: "PO-1" }]);
    qc.setQueryData(["orders", "history"], [{ id: "o2", orderNumber: "PO-2" }]);
    expect(orderFromLists(qc, "o1")?.orderNumber).toBe("PO-1");
    expect(orderFromLists(qc, "o2")?.orderNumber).toBe("PO-2");
    expect(orderFromLists(qc, "o3")).toBeUndefined();
  });

  it("seeds the order from them, stale, so it is fetched again at once", () => {
    const Q = read("src/api/queries.ts");
    expect(Q).toMatch(
      /initialData: \(\) => orderFromLists\(qc, id\),\s*initialDataUpdatedAt: 0,/,
    );
  });

  it("tells no signal apart from a refusal", () => {
    expect(noAnswer(new TypeError("Network request failed"))).toBe(true);
    expect(
      noAnswer(new ApiError(503, "Could not reach", { reason: "refresh_not_reached" })),
    ).toBe(true);
    expect(noAnswer(new ApiError(404, "Order not found"))).toBe(false);
  });

  it("says a delivery never opened here waits for signal", () => {
    const SCREEN = read("app/(tabs)/cellar/receive/[orderId].tsx");
    expect(SCREEN).toContain(
      "message={noAnswer(error) ? NEVER_LOADED_WORDS : undefined}",
    );
    expect(NEVER_LOADED_WORDS).toMatch(/never opened on this phone/);
  });
});

describe("a waiting count is withdrawn or replaced (F-1407)", () => {
  it("the receive screen offers to withdraw the saved count and count again", () => {
    const SCREEN = read("app/(tabs)/cellar/receive/[orderId].tsx");
    expect(SCREEN).toMatch(
      /alreadyCounted && waitingReceipt\.status !== "inflight" \?/,
    );
    expect(SCREEN).toMatch(/\.withdraw\(waitingReceipt\.id\)/);
  });

  it("the waiting strip lists entries with Withdraw", () => {
    const STRIP = read("src/components/today/WaitingStrip.tsx");
    expect(STRIP).toContain("waitingHere(entries, user)");
    expect(STRIP).toMatch(/useOutbox\.getState\(\)\.withdraw\(e\.id\)/);
  });
});

describe("waiting and parked rows name their delivery and open it (F-1408)", () => {
  it("every door action stores its order", () => {
    for (const rel of [
      "app/(tabs)/cellar/receive/[orderId].tsx",
      "app/(tabs)/supply/[id].tsx",
      "src/components/today/DecisionCard.tsx",
    ]) {
      expect(read(rel)).toMatch(/about: \{\s*orderId/);
    }
  });

  it("Today's parked rows and the waiting list show the name and open the order", () => {
    const TODAY = read("app/(tabs)/index.tsx");
    expect(TODAY).toContain("`${entryName(f)} didn't go through`");
    expect(TODAY).toMatch(/const orderId = entryOrderId\(f\);/);
    const STRIP = read("src/components/today/WaitingStrip.tsx");
    expect(STRIP).toContain("{entryName(e)}");
    expect(STRIP).toMatch(/pathname: "\/supply\/\[id\]", params: \{ id: orderId \}/);
  });
});

describe("inbox actions say when they did not go through (F-1410)", () => {
  const SCREEN = read("app/notifications.tsx");
  it.each(["remove", "markAllRead", "markRead", "markUnread", "archive"])(
    "%s shows its failure",
    (action) => {
      expect(SCREEN).toMatch(
        new RegExp(`actions\\.${action}\\.mutate\\(\\s*[^;]*?sayFailed\\(`),
      );
    },
  );
  it("as an alert in plain words", () => {
    expect(SCREEN).toContain(
      'onError: () => Alert.alert("Not done", inboxFailureWords(what))',
    );
  });
});
