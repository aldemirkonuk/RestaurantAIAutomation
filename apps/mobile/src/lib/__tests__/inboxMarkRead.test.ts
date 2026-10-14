/**
 * F-1659: the phone's "Mark all read" sent `PATCH /notifications/read/all`
 * for the house, marking lines past the fifty loaded and orders waiting for
 * approval, unseen and unasked. Screens are not rendered by this runner (see
 * jest.config.js), so the screen's guards read the source.
 */
import fs from "fs";
import path from "path";
import { markReadScope, markReadSlices, markReadWords } from "@/lib/inboxMarkRead";

const read = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, "../../..", rel), "utf8");

const line = (id: string, type = "inventory_low_stock", status = "unread") => ({
  id,
  type,
  status,
});

describe("mark read reaches only the lines on screen (F-1659)", () => {
  it("keeps approvals and read lines out", () => {
    const scope = markReadScope([
      line("a"),
      line("s", "order_pending"),
      line("r", "inventory_low_stock", "read"),
      line("b"),
    ]);
    expect(scope).toEqual({ ids: ["a", "b"], approvals: 1 });
  });

  it("says how many it marks and what stays unread", () => {
    const words = markReadWords({ ids: ["a", "b"], approvals: 1 }, 45);
    expect(words.button).toBe("Mark these 2 read");
    expect(words.title).toBe("Mark these 2 lines read?");
    expect(words.message).toBe(
      "Only the lines on this screen. These stay unread: 1 order waits for your approval; 42 further down are not shown.",
    );
    expect(markReadWords({ ids: ["a"], approvals: 0 }, 1).message).toBe(
      "Only the lines on this screen.",
    );
    expect(markReadWords({ ids: ["a"], approvals: 0 }, null).message).toBe(
      "Only the lines on this screen. These stay unread: any further down could not be counted.",
    );
  });

  it("slices a long list into requests of a hundred", () => {
    const ids = Array.from({ length: 230 }, (_, i) => `n${i}`);
    expect(markReadSlices(ids).map((p) => p.length)).toEqual([100, 100, 30]);
  });

  it("the phone no longer sends read/all, and asks before marking", () => {
    const QUERIES = read("src/api/queries.ts");
    const SCREEN = read("app/notifications.tsx");
    expect(QUERIES).not.toContain("/notifications/read/all");
    expect(QUERIES).toContain('api("/notifications/read/bulk"');
    expect(SCREEN).toMatch(/actions\.markAllRead\.mutate\(\s*markScope\.ids/);
    expect(SCREEN).toContain("Alert.alert(markWords.title, markWords.message");
    expect(SCREEN).not.toContain("Mark all read");
  });
});
