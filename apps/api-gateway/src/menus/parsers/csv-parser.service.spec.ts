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

describe("CsvParserService quoting (RFC 4180)", () => {
  it("keeps a doubled quote in a name as one quote", () => {
    const [item] = parse('Name,Bottle\n"Chateau ""Le Pin""",120\n');
    expect(item.name).toBe('Chateau "Le Pin"');
    expect(item.bottle_price).toBe(120);
  });

  it("keeps a delimiter and a line break inside a quoted cell", () => {
    const items = parse(
      'Name,Producer,Bottle\r\n"Pomerol, 1er","Ets.\r\nBordeaux",65\r\nSancerre,Vacheron,40\r\n',
    );
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe("Pomerol, 1er");
    expect(items[0].producer).toBe("Ets.\r\nBordeaux");
    expect(items[1]).toMatchObject({ name: "Sancerre", bottle_price: 40 });
  });

  it("reads a semicolon file (Excel in a decimal-comma locale)", () => {
    const [item] = parse("Name;Bottle\nKalecik;62,50\n");
    expect(item).toMatchObject({ name: "Kalecik", bottle_price: 62.5 });
  });
});
