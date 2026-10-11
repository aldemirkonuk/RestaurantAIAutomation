import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ManualObservationDto } from "./manual-observation.dto";

/**
 * F-1343: the source URL on a recorded price is rendered as a link the owner
 * clicks, so it must be http(s) and must open the vendor's site, not a page
 * inside the app.
 */
async function sourceUrl(value: unknown) {
  const dto = plainToInstance(ManualObservationDto, { sourceUrl: value });
  const errors = (await validate(dto)).filter(
    (e) => e.property === "sourceUrl",
  );
  return { stored: dto.sourceUrl, refused: errors.length > 0 };
}

describe("ManualObservationDto sourceUrl (F-1343)", () => {
  it("keeps an http(s) link as typed", async () => {
    expect(await sourceUrl("https://www.kavaklidere.com/fiyat")).toEqual({
      stored: "https://www.kavaklidere.com/fiyat",
      refused: false,
    });
    expect((await sourceUrl("http://shop.example/list")).refused).toBe(false);
  });

  it("adds https:// to a link pasted without one", async () => {
    expect(await sourceUrl("www.kavaklidere.com/fiyat")).toEqual({
      stored: "https://www.kavaklidere.com/fiyat",
      refused: false,
    });
  });

  it.each([
    "javascript:1/alert(document.cookie)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "ftp://files.example.com/prices",
  ])("refuses %s", async (value) => {
    expect((await sourceUrl(value)).refused).toBe(true);
  });

  it("still allows no link at all", async () => {
    expect((await sourceUrl(undefined)).refused).toBe(false);
  });
});
