import { CsvParserService } from "./csv-parser.service";

const parse = (csv: string) => new CsvParserService().parse(csv);

describe("CsvParserService price cells", () => {
  it("reads a decimal-comma price as itself, never as 100 times itself", () => {
    const [item] = parse("Name,Bottle\nTest Decimal,\"62,50\"\n");
    expect(item.bottle_price).toBe(62.5);
  });

  it("reads a European thousands price", () => {
    const [item] = parse('Name,Bottle\nChateau,"2.400,00"\n');
    expect(item.bottle_price).toBe(2400);
  });

  it("reads a dot-decimal price", () => {
    const [item] = parse("Name,Bottle,By_Glass\nRioja,120,18.50\n");
    expect(item).toMatchObject({ bottle_price: 120, by_glass_price: 18.5 });
  });

  it("gives a price with two readings no amount, and keeps the line", () => {
    const [item] = parse('Name,Bottle\nBogazkere,"1.250"\n');
    expect(item.name).toBe("Bogazkere");
    expect(item.bottle_price).toBeUndefined();
  });
});
