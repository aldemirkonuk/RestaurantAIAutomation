/**
 * formatDate/formatShortDate (template-config.ts) render email dates. This locks in the
 * fix for the studio-invite.controller.ts bug class: a string input is a wire timestamp
 * and must render the same calendar day regardless of server TZ, while a `Date` object
 * input is local-time calendar arithmetic (e.g. scheduled-tasks.service.ts's "upcoming
 * Wednesday") and must keep rendering in the process's own local time.
 */
import { formatDate, formatShortDate } from "./template-config";

describe("formatDate / formatShortDate", () => {
  describe("string input (wire timestamp) — pinned to UTC", () => {
    it("formatShortDate renders a UTC-midnight timestamp as the same day it names, not the prior day", () => {
      expect(formatShortDate("2026-09-02T00:00:00Z")).toBe("Sep 2, 2026");
    });

    it("formatDate renders a UTC-midnight timestamp as the same day it names, not the prior day", () => {
      expect(formatDate("2026-09-02T00:00:00Z")).toBe(
        "Wednesday, September 2, 2026",
      );
    });

    it("formatShortDate is stable for a late-UTC-day timestamp too", () => {
      expect(formatShortDate("2026-09-02T23:00:00Z")).toBe("Sep 2, 2026");
    });
  });

  describe("Date object input (local calendar arithmetic) — not forced to UTC", () => {
    it("formatShortDate renders a Date object in the process's local time, matching toLocaleDateString's own default", () => {
      const d = new Date("2026-09-02T00:00:00Z");
      expect(formatShortDate(d)).toBe(
        d.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      );
    });

    it("formatDate renders a Date object in the process's local time, matching toLocaleDateString's own default", () => {
      const d = new Date("2026-09-02T00:00:00Z");
      expect(formatDate(d)).toBe(
        d.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
      );
    });
  });
});
