import { cellMoneyMark, differentMoney, excelFormatMark, headerMoneyMark, isMoneyMark, oneMoneyOf } from "./price-mark";

describe("price-mark: the money a menu file names (r40, r36 N1)", () => {
  it("reads a cell's leading or trailing mark as written, and nothing that is not a money", () => {
    expect(cellMoneyMark("€12")).toBe("€");
    expect(cellMoneyMark("12 €")).toBe("€");
    expect(cellMoneyMark("45,50 TL")).toBe("TL");
    expect(cellMoneyMark("1.250 YTL")).toBe("YTL");
    expect(cellMoneyMark("₺ 1.250,00")).toBe("₺");
    expect(cellMoneyMark("12 EUR")).toBe("EUR");
    expect(cellMoneyMark("usd 9")).toBe("usd");
    expect(cellMoneyMark("US$ 9")).toBe("US$");
    expect(cellMoneyMark("$9")).toBe("$");
    // Not a money: a unit, a word, a bare number, an empty cell.
    expect(cellMoneyMark("33cl")).toBeNull();
    expect(cellMoneyMark("12 adet")).toBeNull();
    expect(cellMoneyMark("12 ABC")).toBeNull();
    expect(cellMoneyMark("450")).toBeNull();
    expect(cellMoneyMark("")).toBeNull();
    expect(cellMoneyMark(undefined)).toBeNull();
  });

  it("reads a header's money in brackets or by mark, and passes over a bracket that names none", () => {
    expect(headerMoneyMark("Şişe Fiyatı (TL)")).toBe("TL");
    expect(headerMoneyMark("Bottle [EUR]")).toBe("EUR");
    expect(headerMoneyMark("Fiyat (kadeh) (₺)")).toBe("₺");
    expect(headerMoneyMark("Price €")).toBe("€");
    expect(headerMoneyMark("Fiyat (kadeh)")).toBeNull();
    expect(headerMoneyMark("Bottle price")).toBeNull();
    expect(headerMoneyMark(undefined)).toBeNull();
  });

  it("reads an Excel number format's money, never a locale tag or a date", () => {
    expect(excelFormatMark("[$€-x-euro2] #,##0.00")).toBe("€");
    expect(excelFormatMark("[$TRY] #,##0.00")).toBe("TRY");
    expect(excelFormatMark('"₺"#,##0.00')).toBe("₺");
    expect(excelFormatMark('#,##0.00 "TL"')).toBe("TL");
    expect(excelFormatMark("$#,##0.00")).toBe("$");
    expect(excelFormatMark("[$-41F]#,##0.00")).toBeNull();
    expect(excelFormatMark('#,##0.00 "adet"')).toBeNull();
    expect(excelFormatMark("dd/mm/yyyy")).toBeNull();
    expect(excelFormatMark("General")).toBeNull();
    expect(excelFormatMark(undefined)).toBeNull();
  });

  it("splits two marks only when each names one money and they differ", () => {
    expect(oneMoneyOf("TL")).toBe("TRY");
    expect(oneMoneyOf("₺")).toBe("TRY");
    expect(oneMoneyOf("eur")).toBe("EUR");
    expect(oneMoneyOf("$")).toBeNull();
    expect(differentMoney("€", "TL")).toBe(true);
    expect(differentMoney("TL", "₺")).toBe(false);
    expect(differentMoney("$", "USD")).toBe(false);
    expect(differentMoney("€", null)).toBe(false);
    expect(isMoneyMark("£")).toBe(true);
    expect(isMoneyMark("ZZZ")).toBe(false);
  });
});
