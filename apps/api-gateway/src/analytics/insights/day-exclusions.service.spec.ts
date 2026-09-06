import { DayExclusionsService } from "./day-exclusions.service";

/**
 * The exclusion store, and the one thing it must never do: report an
 * unreadable list as an empty one.
 *
 * `load()` is called on every insight run and cannot throw — a broken
 * exclusion table must not take the whole analytics surface down. The trap is
 * that "cannot throw" usually becomes "returns []", at which point every
 * baseline is silently computed over days the manager already ruled out and
 * the page presents the result as clean. So the failure is carried out of the
 * method as a value, and every caller is obliged to pass it on.
 */
function makeService(behaviour: {
  rows?: any[];
  error?: string;
  throws?: boolean;
  capture?: { table?: string; op?: string; payload?: any; filters: any[] };
}) {
  const client = {
    from: (table: string) => {
      if (behaviour.capture) behaviour.capture.table = table;
      const builder: any = {};
      const record = (op: string) => (...args: any[]) => {
        if (behaviour.capture) behaviour.capture.filters.push([op, ...args]);
        return builder;
      };
      for (const m of ["select", "eq", "order", "delete"])
        builder[m] = record(m);
      builder.upsert = (payload: any, ...rest: any[]) => {
        if (behaviour.capture) {
          behaviour.capture.op = "upsert";
          behaviour.capture.payload = payload;
          behaviour.capture.filters.push(["upsert", ...rest]);
        }
        return builder;
      };
      builder.single = () =>
        Promise.resolve(
          behaviour.error
            ? { data: null, error: { message: behaviour.error } }
            : { data: (behaviour.rows ?? [])[0] ?? null, error: null },
        );
      builder.then = (resolve: any, reject: any) => {
        if (behaviour.throws) return Promise.reject(new Error("socket")).then(resolve, reject);
        return Promise.resolve(
          behaviour.error
            ? { data: null, error: { message: behaviour.error } }
            : { data: behaviour.rows ?? [], error: null },
        ).then(resolve, reject);
      };
      return builder;
    },
  };
  return new DayExclusionsService({ getClient: () => client } as any);
}

describe("DayExclusionsService", () => {
  describe("load", () => {
    it("returns the excluded dates, readable", async () => {
      const svc = makeService({
        rows: [
          { business_date: "2026-09-02" },
          { business_date: "2026-08-15T00:00:00.000Z" },
        ],
      });
      const out = await svc.load("r1");
      expect(Array.from(out.dates).sort()).toEqual([
        "2026-08-15",
        "2026-09-02",
      ]);
      expect(out.readable).toBe(true);
    });

    it("an empty list is readable and empty — a real answer", async () => {
      const out = await makeService({ rows: [] }).load("r1");
      expect(out.dates.size).toBe(0);
      expect(out.readable).toBe(true);
      expect(out.problem).toBeNull();
    });

    it("a failed read is NOT an empty list", async () => {
      const out = await makeService({
        error: 'relation "analytics_day_exclusions" does not exist',
      }).load("r1");
      expect(out.dates.size).toBe(0);
      expect(out.readable).toBe(false);
      expect(out.problem).toContain("analytics_day_exclusions");
    });

    it("a thrown read is NOT an empty list either", async () => {
      const out = await makeService({ throws: true }).load("r1");
      expect(out.readable).toBe(false);
    });

    it("ignores a date it cannot parse rather than storing a wrong key", async () => {
      const out = await makeService({
        rows: [{ business_date: "not-a-date" }, { business_date: "2026-09-02" }],
      }).load("r1");
      expect(Array.from(out.dates)).toEqual(["2026-09-02"]);
    });
  });

  describe("exclude", () => {
    it("writes the day, keyed so a second exclusion is not a duplicate", async () => {
      const capture: {
        table?: string;
        op?: string;
        payload?: any;
        filters: any[];
      } = { filters: [] };
      const svc = makeService({
        rows: [{ business_date: "2026-09-02", reason: "closed", created_at: "x" }],
        capture,
      });
      const row = await svc.exclude("r1", "2026-09-02", "closed");
      expect(row.businessDate).toBe("2026-09-02");
      expect(capture.table).toBe("analytics_day_exclusions");
      expect(capture.payload).toMatchObject({
        restaurant_id: "r1",
        business_date: "2026-09-02",
        reason: "closed",
      });
      expect(capture.filters).toContainEqual([
        "upsert",
        { onConflict: "restaurant_id,business_date" },
      ]);
    });

    it("refuses anything that is not a business date", async () => {
      const svc = makeService({});
      await expect(svc.exclude("r1", "yesterday")).rejects.toThrow(
        /YYYY-MM-DD/,
      );
      await expect(svc.exclude("r1", "")).rejects.toThrow(/YYYY-MM-DD/);
    });

    /**
     * A write that did not land must not return as if it had. The caller
     * renders "this day is out of the analysis" off the back of this promise.
     */
    it("throws when the write fails instead of reporting success", async () => {
      await expect(
        makeService({ error: "permission denied" }).exclude(
          "r1",
          "2026-09-02",
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe("include", () => {
    it("deletes the day for that restaurant only", async () => {
      const capture: { table?: string; filters: any[] } = { filters: [] };
      await makeService({ rows: [], capture }).include("r1", "2026-09-02");
      expect(capture.filters).toContainEqual(["eq", "restaurant_id", "r1"]);
      expect(capture.filters).toContainEqual([
        "eq",
        "business_date",
        "2026-09-02",
      ]);
    });

    it("refuses a malformed date", async () => {
      await expect(
        makeService({}).include("r1", "2026-9-2"),
      ).rejects.toThrow(/YYYY-MM-DD/);
    });

    it("throws when the delete fails", async () => {
      await expect(
        makeService({ error: "nope" }).include("r1", "2026-09-02"),
      ).rejects.toThrow(/nope/);
    });
  });
});
