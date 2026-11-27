import { UnprocessableEntityException } from "@nestjs/common";
import { MenusService } from "./menus.service";

/**
 * r110 menu-r110-5 (walk r109): a sheet with no name column was refused
 * "Check that each row names a wine", to a kitchen whose sheet heads its names
 * Dish. The refusal names the column it looks for, dish or drink, and keeps
 * nothing.
 */
describe("POST /menus/import (csv) with no line -- the refusal's words", () => {
  it("says which column it looks for, a dish or a drink, not a wine only", async () => {
    const from = jest.fn(() => {
      throw new Error("nothing is written");
    });
    const svc = new MenusService({ supabase: { from } } as any, { read: () => ({ items: [], issues: [] }) } as any, undefined as any, undefined as any);
    const p = svc.importMenu({ method: "csv", data: { csvContent: "Section,Dish,Price\r\n" }, restaurantId: "rest-1" } as any, "u-1");
    await expect(p).rejects.toBeInstanceOf(UnprocessableEntityException);
    const said = await p.catch((e: UnprocessableEntityException) => (e.getResponse() as { message: string }).message);
    expect(said).toBe("No line could be read from this file, so no menu was kept. Check that one column names each dish or drink (Name, Dish, Wine, Ad, Yemek).");
    expect(from).not.toHaveBeenCalled();
  });
});
