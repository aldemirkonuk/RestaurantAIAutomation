import { CsvParserService } from "./parsers/csv-parser.service";
import { SHEET_COLUMNS, blankMenuSheet, menuSheet, sheetCell } from "./menu-sheet";

const line = (o: Record<string, unknown>) => ({
  name: "x",
  producer: null,
  vintage: null,
  region: null,
  grape_variety: null,
  category: null,
  by_glass_price: null,
  bottle_price: null,
  ...o,
});

describe("menu sheet (menu r104 g3)", () => {
  const parser = new CsvParserService();

  it("reads back as the same lines, a comma in a name and a fractional price included", () => {
    const items = [
      line({ name: "Kayra Öküzgözü, Reserve", producer: "Kayra", vintage: "2019", region: "Elazığ", grape_variety: "Öküzgözü", category: "Red", by_glass_price: 62.5, bottle_price: 240 }),
      line({ name: "Rakı 35cl", category: "Spirits", bottle_price: 1250.75 }),
      line({ name: "Turkish coffee", category: "Hot drinks", by_glass_price: 62 }),
    ];
    const back = parser.parse(menuSheet(items));
    expect(back.map((b) => ({ ...b, raw_text: undefined }))).toEqual(
      items.map((i) => {
        const o: Record<string, unknown> = { raw_text: undefined };
        for (const [k, v] of Object.entries(i)) if (v !== null) o[k] = v;
        return o;
      }),
    );
  });

  it("writes only the column words the reader accepts", () => {
    const head = menuSheet([]).split("\r\n")[0].split(",");
    expect(head).toEqual([...SHEET_COLUMNS]);
    const probe = parser.parse(`${head.join(",")}\r\nA,B,2020,C,D,E,1,2\r\n`)[0];
    expect(Object.keys(probe).sort()).toEqual(["bottle_price", "by_glass_price", "category", "grape_variety", "name", "producer", "raw_text", "region", "vintage"]);
  });

  it("writes a name that starts with = + - or @ as plain text, never a formula", () => {
    for (const c of ["=1+1", "+cmd", "-2", "@SUM(A1)"]) {
      expect(sheetCell(c).startsWith(`'${c[0]}`)).toBe(true);
      expect(menuSheet([line({ name: c })]).split("\r\n")[1].startsWith("'")).toBe(true);
    }
    expect(sheetCell("Rosé")).toBe("Rosé");
  });

  it("keeps a line break out of a cell, so a row stays one row", () => {
    expect(menuSheet([line({ name: "a\nb" })]).split("\r\n")).toHaveLength(3);
  });

  // r104 fix: the reader lost "" and kept the formula apostrophe, so an untouched export read back as other names.
  it("reads the export back with no edit as the same names: quotes, a leading - or + or =", () => {
    const names = ['Cuvée "Prestige"', "-Brut Nature", "=Special", "@home"];
    const items = [...names.map((n) => line({ name: n })), line({ name: "Cava", producer: "+Cava" })];
    const back = parser.parse(menuSheet(items));
    expect(back.map((b) => b.name)).toEqual([...names, "Cava"]);
    expect(back[4].producer).toBe("+Cava");
  });

  // r104 fix: digits and dots only meant "62,50" read as 6250 and "1.250,75" as 1.25075.
  it("reads a decimal comma and a dot thousands mark as the money they are, and refuses an ambiguous comma", () => {
    const rows = ['A,"62,50"', 'B,"1.250,75"', 'C,"1,250.75"', 'D,"1.250.000"', 'E,"1,250,000"', 'F,"$62.50"', 'G,"1,250"'];
    const warnings: any[] = [];
    const back = parser.parse(`name,bottle_price\r\n${rows.join("\r\n")}\r\n`, warnings);
    expect(back.map((b) => [b.name, b.bottle_price])).toEqual([
      ["A", 62.5], ["B", 1250.75], ["C", 1250.75], ["D", 1250000], ["E", 1250000], ["F", 62.5],
    ]);
    // G ("1,250") is 1250 or 1.25: the line is refused, once said, never guessed.
    expect(warnings).toEqual([{ kind: "ambiguous_price", pages: null }]);
  });

  it("the blank sheet reads as one example line", () => {
    const items = parser.parse(blankMenuSheet());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "House red", by_glass_price: 12, bottle_price: 48 });
  });
});

import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { MenusController } from "./menus.controller";
import { OrganizationsService } from "../organizations/organizations.service";

describe("GET /menus/:restaurantId/export.csv and sample.csv", () => {
  const orgs = (role: string | null) => {
    const o = new OrganizationsService({} as never);
    jest.spyOn(o, "resolveRestaurantRole").mockResolvedValue(role);
    return o;
  };
  const USER = { userId: "u-1" };
  const make = (role: string | null, menu: Record<string, unknown>) => {
    const getMenu = jest.fn(async () => menu);
    return { c: new MenusController({ getMenu } as any, orgs(role)), getMenu };
  };
  const menu = { menuId: "m1", items: [line({ name: "=HYPERLINK(1)", bottle_price: 50 }), line({ name: "Raki", by_glass_price: 12.5 })] };

  it.each(["owner", "manager"])("a %s gets the current menu as a sheet that reads back the same", async (role) => {
    const { c } = make(role, menu);
    const csv = await c.exportSheet("rest-1", USER);
    const back = new CsvParserService().parse(csv);
    expect(back.map((b) => b.name)).toEqual(["=HYPERLINK(1)", "Raki"]);
    expect(back.map((b) => [b.by_glass_price, b.bottle_price])).toEqual([[undefined, 50], [12.5, undefined]]);
  });

  it.each(["staff", null])("%s is refused (403) before the menu is read", async (role) => {
    const { c, getMenu } = make(role as string | null, menu);
    await expect(c.exportSheet("rest-1", USER)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.sampleSheet("rest-1", USER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(getMenu).not.toHaveBeenCalled();
  });

  it("says so (404) when no menu is current, never an empty sheet", async () => {
    const { c } = make("owner", { menuId: null, items: [] });
    await expect(c.exportSheet("rest-1", USER)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("gives an owner the blank sample", async () => {
    const { c } = make("owner", menu);
    expect(await c.sampleSheet("rest-1", USER)).toBe(blankMenuSheet());
  });
});
