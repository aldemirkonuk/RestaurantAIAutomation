import {
  DocumentIntakeService,
  SPREADSHEET_NOT_READ,
} from "./document-intake.service";

/**
 * F-1403: a CSV or XLSX vendor price list reached the vision model as
 * image/jpeg (the upload door sends a name and no type), failed every time,
 * and was filed as "the extraction model could not be reached". It is now
 * said as what it is, before any model call, and the file is still kept.
 */
function door() {
  const extractor = {
    available: jest.fn(() => true),
    extract: jest.fn(async () => {
      throw new Error("Anthropic 400: Could not process image");
    }),
  };
  const svc = new DocumentIntakeService(
    {} as any,
    extractor as any,
    {} as any,
    {} as any,
  ) as any;
  jest
    .spyOn(svc, "houseCurrency")
    .mockResolvedValue({ code: "TRY", failure: null });
  jest.spyOn(svc, "matchedOrderCurrency").mockResolvedValue({
    code: null,
    matched: false,
    label: null,
    failure: null,
  });
  return { svc, extractor };
}

describe("a spreadsheet price list at the document door (F-1403)", () => {
  it.each([
    ["fiyat-listesi.xlsx", null, Buffer.from("PK\u0003\u0004 workbook")],
    ["portal-export.csv", null, Buffer.from("sku;name;price\n1;Yakut;850\n")],
    ["prices", "text/csv", Buffer.from("sku,name,price\n")],
  ])(
    "%s is refused in plain words and never sent to the model",
    async (filename, mimeType, bytes) => {
      const { svc, extractor } = door();
      const parsed = await svc.route(
        { restaurantId: "r1", source: "upload", filename, mimeType },
        bytes,
      );
      expect(extractor.extract).not.toHaveBeenCalled();
      expect(parsed.warnings).toEqual([SPREADSHEET_NOT_READ]);
      expect(SPREADSHEET_NOT_READ).toMatch(/PDF/);
      expect(SPREADSHEET_NOT_READ).toMatch(/EDI 832/);
      expect(SPREADSHEET_NOT_READ).not.toMatch(/could not be reached/);
    },
  );

  it("a photographed invoice still goes to the model", async () => {
    const { svc, extractor } = door();
    await svc.route(
      {
        restaurantId: "r1",
        source: "upload",
        filename: "fatura.jpg",
        mimeType: null,
      },
      Buffer.from([0xff, 0xd8, 0xff]),
    );
    expect(extractor.extract).toHaveBeenCalledTimes(1);
  });
});
