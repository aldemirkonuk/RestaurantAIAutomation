/**
 * F-956b / F-951b — the order and receive screens read the phone's queue.
 *
 * Screens are React Native components this runner does not render (see
 * jest.config.js), so the guard reads their source, as settingsScreen.test.ts
 * does. The queue rule itself is tested in state/__tests__/outbox.test.ts.
 */
import fs from "fs";
import path from "path";

const read = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, "../../../app", rel), "utf8");

describe("order screen — a delivery mark waiting on this phone (F-956)", () => {
  const SCREEN = read("(tabs)/supply/[id].tsx");

  it("reads the waiting mark for this order's deliver path", () => {
    expect(SCREEN).toMatch(/waitingFor\(s\.entries, user, deliverPath\)/);
  });

  it("shuts the button and says the mark is queued while it waits", () => {
    expect(SCREEN).toContain("disabled={deliverWaiting}");
    expect(SCREEN).toContain("{DELIVERED_WAITING_WORDS}");
    expect(SCREEN).toMatch(/if \(!order \|\| deliverWaiting\) return;/);
  });
});

describe("receive screen — a second count for one order (F-951)", () => {
  const SCREEN = read("(tabs)/cellar/receive/[orderId].tsx");

  it("refuses to queue a second receipt while one waits", () => {
    expect(SCREEN).toMatch(
      /if \(waitingFor\(useOutbox\.getState\(\)\.entries, user, receiptPath\)\) \{\s*Alert\.alert\(RECEIPT_WAITING_WORDS\);\s*return;/,
    );
  });

  it("shuts the button and says why", () => {
    expect(SCREEN).toMatch(/sealed \|\|\s*alreadyCounted \|\|/);
    expect(SCREEN).toContain("{RECEIPT_WAITING_WORDS}");
  });
});
