import { InternalServerErrorException } from "@nestjs/common";
import { MenusService } from "./menus.service";

/**
 * g2 menu gap: a failed discard, price correction or current-menu read on
 * /menu showed "Internal server error", because the service threw a bare
 * Error and Nest hides a bare Error's words. Each now throws a typed 500 that
 * carries a plain sentence (and the cause after it), and says nothing was
 * changed where that is true.
 */

type Rule = { table: string; op: "read" | "write"; message: string };

/** A client whose reads and writes fail where a rule says so, and answer a row otherwise. */
function service(rules: Rule[], row: Record<string, unknown> | null = { id: "mi-1", restaurant_id: "rest-1", status: "approved" }) {
  const writes: string[] = [];
  const from = (table: string) => {
    let isWrite = false;
    const fail = () => rules.find((r) => r.table === table && r.op === (isWrite ? "write" : "read"));
    const answer = () => {
      const f = fail();
      if (f) return { data: null, error: { message: f.message } };
      if (isWrite) writes.push(table);
      return { data: isWrite ? [] : table === "restaurant_menus" ? [{ id: "menu-1", name: "Wine list", status: "active" }] : [], error: null };
    };
    const api: any = {
      select: () => api,
      eq: () => api,
      neq: () => api,
      gt: () => api,
      is: () => api,
      in: () => api,
      order: () => api,
      limit: () => api,
      update: () => ((isWrite = true), api),
      maybeSingle: async () => {
        const a: any = answer();
        return a.error ? a : { data: table === "restaurant_menus" ? { id: "menu-1", name: "Wine list", status: "active" } : row, error: null };
      },
      then: (resolve: any) => resolve(answer()),
    };
    return api;
  };
  const svc = new MenusService({ supabase: { from } } as any, undefined as any, undefined as any, undefined as any);
  return { svc, writes };
}

async function said(p: Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(InternalServerErrorException);
    const x = e as InternalServerErrorException;
    return { status: x.getStatus(), message: String(x.message) };
  }
  throw new Error("expected a typed 500");
}

describe("a failed menu read or write says it in words (g2 menu gap)", () => {
  it("a discard that could not look the line up says so and that nothing was changed", async () => {
    const { svc, writes } = service([{ table: "menu_items", op: "read", message: "statement timeout" }]);
    const out = await said(svc.discardMenuItem("rest-1", "mi-1"));
    expect(out.status).toBe(500);
    expect(out.message).toMatch(/^The menu line could not be looked up just now, so it was not discarded\. Nothing was changed\./);
    expect(out.message).toMatch(/statement timeout/);
    expect(writes).toEqual([]);
  });

  it("a discard whose write failed says the line is still on the menu", async () => {
    const { svc } = service([{ table: "menu_items", op: "write", message: "connection reset" }]);
    const out = await said(svc.discardMenuItem("rest-1", "mi-1"));
    expect(out.message).toMatch(/^The menu line could not be discarded just now\. It is still on the menu and nothing was changed\./);
    expect(out.message).toMatch(/connection reset/);
  });

  it("a price correction that could not look the line up says nothing was saved", async () => {
    const { svc } = service([{ table: "menu_items", op: "read", message: "statement timeout" }]);
    const out = await said(svc.reviewMenuItem("mi-1", "user-1", "rest-1", { fieldName: "bottle_price", newValue: "70" } as any));
    expect(out.message).toMatch(/^The menu line could not be looked up just now, so the correction was not saved\. Nothing was changed\./);
  });

  it("a price correction whose write failed says it was not saved", async () => {
    const { svc } = service([{ table: "menu_items", op: "write", message: "connection reset" }]);
    const out = await said(svc.reviewMenuItem("mi-1", "user-1", "rest-1", { fieldName: "bottle_price", newValue: "70" } as any));
    expect(out.message).toMatch(/^The correction could not be saved just now\. Nothing was changed\./);
  });

  it("the current menu's read says the menu could not be read, for the menu and for its lines", async () => {
    const a = await said(service([{ table: "restaurant_menus", op: "read", message: "statement timeout" }]).svc.getMenu("rest-1"));
    expect(a.message).toMatch(/^The current menu could not be read just now\./);
    const b = await said(service([{ table: "menu_items", op: "read", message: "statement timeout" }]).svc.getMenu("rest-1"));
    expect(b.message).toMatch(/^The current menu's lines could not be read just now\./);
    const c = await said(service([{ table: "restaurant_menus", op: "read", message: "statement timeout" }]).svc.readCurrentMenus("rest-1"));
    expect(c.message).toMatch(/^The current menu could not be read just now\./);
  });
});
