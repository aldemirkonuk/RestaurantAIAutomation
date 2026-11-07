import { BadRequestException } from "@nestjs/common";
import { ScanParserService } from "./scan-parser.service";

/**
 * QA round 3 on PR #778: the menu scan still fell back to `image/jpeg` for
 * bytes it did not know, so a HEIC menu photo went to the model labelled JPEG.
 * It now uses the document intake's sniff (`common/photo-format.ts`).
 */
const ftyp = (brand: string) =>
  Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from("ftyp" + brand, "latin1"),
    Buffer.from([0, 0, 0, 0]),
    Buffer.alloc(32, 0xab),
  ]).toString("base64");

const HEIC = ftyp("heic");
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(32, 0x11),
]).toString("base64");

function service(key: string | undefined = "fixture-key"): any {
  const s: any = new ScanParserService(
    { get: () => key } as any,
    {} as any,
    {} as any,
  );
  s.parseOne = jest.fn().mockResolvedValue({ items: [], truncated: false });
  return s;
}

async function refusal(p: Promise<unknown>): Promise<BadRequestException> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BadRequestException);
  return err as BadRequestException;
}

describe("ScanParserService.parse — a menu photo the reader cannot open", () => {
  it("refuses a HEIC menu photo with the intake's reason and never calls the model", async () => {
    const s = service();
    const err = await refusal(s.parse(HEIC, "house"));
    expect(err.message).toBe(
      "This photo is in HEIC format, which the reader cannot open, so nothing was imported. Send it again as a JPEG, or take the photo again.",
    );
    expect(s.parseOne).not.toHaveBeenCalled();
  });

  it("refuses HEIC on the arrival path and with no model key too", async () => {
    const s = service(undefined);
    expect((await refusal(s.parse(HEIC, "house", true))).message).toMatch(
      /HEIC format/,
    );
    expect(s.parseOne).not.toHaveBeenCalled();
  });

  it("refuses unknown bytes instead of sending them as JPEG", async () => {
    const s = service();
    const unknown = Buffer.from([1, 2, 3, 4, 5, 6]).toString("base64");
    expect((await refusal(s.parse(unknown, "house"))).message).toMatch(
      /not a PDF, JPEG, PNG, WebP or GIF.*nothing was imported/,
    );
    expect(s.parseOne).not.toHaveBeenCalled();
  });

  it("sees HEIC behind a data: URL prefix", async () => {
    const s = service();
    expect(
      (await refusal(s.parse(`data:image/jpeg;base64,${HEIC}`, "house")))
        .message,
    ).toMatch(/HEIC format/);
    expect(s.parseOne).not.toHaveBeenCalled();
  });

  it("still reads a JPEG, sent as bare base64 with its own type", async () => {
    const s = service();
    await s.parse(`data:image/jpeg;base64,${JPEG}`, "house");
    expect(s.parseOne).toHaveBeenCalledWith(
      JPEG,
      "image/jpeg",
      false,
      "house",
      false,
    );
  });
});
