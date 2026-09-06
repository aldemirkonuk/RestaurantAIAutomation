import { ValidationPipe } from "@nestjs/common";
import { GetCalendarEventsQueryDto } from "./calendar.dto";

/**
 * Regression guard for the `?limit=` 400.
 *
 * The pipe here is configured exactly as the global one in main.ts:51-57
 * (`whitelist`, `forbidNonWhitelisted`, `transform`, and deliberately NO
 * `enableImplicitConversion`). Without `@Type(() => Number)` on the numeric
 * query fields, every one of the "accepts" cases below 400s.
 */
describe("GetCalendarEventsQueryDto (query-string coercion)", () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const meta = {
    type: "query" as const,
    metatype: GetCalendarEventsQueryDto,
    data: "",
  };

  it("accepts ?limit=50 and coerces it to the number 50", async () => {
    const out = await pipe.transform({ limit: "50" }, meta);
    expect(out.limit).toBe(50);
    expect(typeof out.limit).toBe("number");
  });

  it("accepts ?page=2 and coerces it to the number 2", async () => {
    const out = await pipe.transform({ page: "2" }, meta);
    expect(out.page).toBe(2);
  });

  it("still rejects ?limit=abc", async () => {
    await expect(pipe.transform({ limit: "abc" }, meta)).rejects.toThrow();
  });

  it("still rejects ?limit=501 (over @Max(500))", async () => {
    await expect(pipe.transform({ limit: "501" }, meta)).rejects.toThrow();
  });

  it("still rejects ?limit=0 (under @Min(1))", async () => {
    await expect(pipe.transform({ limit: "0" }, meta)).rejects.toThrow();
  });

  it("still rejects a fractional ?limit=1.5", async () => {
    await expect(pipe.transform({ limit: "1.5" }, meta)).rejects.toThrow();
  });

  it("coerces includeRecurring=false to boolean false, not truthy", async () => {
    const out = await pipe.transform({ includeRecurring: "false" }, meta);
    expect(out.includeRecurring).toBe(false);
  });

  it("coerces includeRecurring=true to boolean true", async () => {
    const out = await pipe.transform({ includeRecurring: "true" }, meta);
    expect(out.includeRecurring).toBe(true);
  });

  it("still rejects includeRecurring=maybe", async () => {
    await expect(
      pipe.transform({ includeRecurring: "maybe" }, meta),
    ).rejects.toThrow();
  });

  it("passes the date range through untouched", async () => {
    const out = await pipe.transform(
      { startDate: "2026-09-01", endDate: "2026-09-30", limit: "500" },
      meta,
    );
    expect(out.startDate).toBe("2026-09-01");
    expect(out.endDate).toBe("2026-09-30");
    expect(out.limit).toBe(500);
  });
});
