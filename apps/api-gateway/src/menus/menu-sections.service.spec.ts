import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { MenuSectionsService, refusalOf } from "./menu-sections.service";

/**
 * ADR 0340 lane 3b: a menu's sections, edited by a person. The database
 * functions themselves (house scope, the live refusals, the nested move, the
 * layout carried without its confirmation) are proven against Postgres in
 * supabase/tests/20270107500000_a_menu_section_is_edited_and_logged_in_one_step_test.sql.
 * Here: every lookup the gateway makes carries the house, a foreign or
 * mismatched id is a 404 before any write, each refusal reaches the person
 * as the right answer, and a tap that made lines drinks resolves them.
 */

type Row = Record<string, any>;
const HOUSE = "rest-1";
const DRAFT = "draft-1";
const LIVE = "live-1";
const FOREIGN_MENU = "draft-x";

function fixtures() {
  return {
    restaurant_menus: [
      {
        id: DRAFT,
        restaurant_id: HOUSE,
        status: "draft",
        menu_type: "beverage",
      },
      {
        id: LIVE,
        restaurant_id: HOUSE,
        status: "active",
        menu_type: "beverage",
      },
      {
        id: FOREIGN_MENU,
        restaurant_id: "rest-2",
        status: "draft",
        menu_type: "beverage",
      },
    ] as Row[],
    menu_sections: [
      {
        id: "sec-d",
        restaurant_id: HOUSE,
        menu_id: DRAFT,
        parent_id: null,
        position: 0,
        key: "red",
      },
      {
        id: "sec-l",
        restaurant_id: HOUSE,
        menu_id: LIVE,
        parent_id: null,
        position: 0,
        key: "red",
      },
      {
        id: "sec-x",
        restaurant_id: "rest-2",
        menu_id: FOREIGN_MENU,
        parent_id: null,
        position: 0,
        key: "red",
      },
    ] as Row[],
    menu_items: [
      { id: "line-d", restaurant_id: HOUSE, menu_id: DRAFT },
      { id: "line-l", restaurant_id: HOUSE, menu_id: LIVE },
      { id: "line-x", restaurant_id: "rest-2", menu_id: FOREIGN_MENU },
    ] as Row[],
  };
}

/** The refusals the 20270107500000 functions raise, keyed on the same facts. */
const DRAFT_ONLY = new Set([
  "move_menu_section_to_kind",
  "set_menu_section_category",
  "confirm_menu_section",
  "confirm_menu_line",
  "assign_menu_lines",
  "keep_gone_menu_line",
]);

function makeService() {
  const tables = fixtures();
  const queries: Array<{ table: string; filters: Array<[string, unknown]> }> =
    [];
  const rpcCalls: Array<[string, Row]> = [];
  const resolveCalls: Array<unknown[]> = [];

  function from(table: string) {
    const q = { table, filters: [] as Array<[string, unknown]> };
    queries.push(q);
    const rows = () =>
      ((tables as any)[table] as Row[]).filter((r) =>
        q.filters.every(([c, v]) => r[c] === v),
      );
    const api: any = {
      select: () => api,
      eq: (c: string, v: unknown) => {
        q.filters.push([c, v]);
        return api;
      },
      gt: () => api,
      order: () => api,
      limit: () => api,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: any) => resolve({ data: rows(), error: null }),
    };
    return api;
  }

  const ownerOf = (table: string, id: unknown) =>
    ((tables as any)[table] as Row[]).find((r) => r.id === id);
  async function rpc(fn: string, args: Row) {
    rpcCalls.push([fn, args]);
    const house = args.p_restaurant_id;
    const section = args.p_section_id
      ? ownerOf("menu_sections", args.p_section_id)
      : null;
    const line = args.p_line_id ? ownerOf("menu_items", args.p_line_id) : null;
    const menu = args.p_menu_id
      ? ownerOf("restaurant_menus", args.p_menu_id)
      : null;
    const named = [args.p_parent_id, ...(args.p_ids ?? [])].filter(Boolean);
    const lines = (args.p_line_ids ?? []) as string[];
    if (
      (args.p_section_id && section?.restaurant_id !== house) ||
      (args.p_line_id && line?.restaurant_id !== house) ||
      (args.p_menu_id && menu?.restaurant_id !== house) ||
      named.some(
        (id: string) => ownerOf("menu_sections", id)?.restaurant_id !== house,
      ) ||
      lines.some((id) => ownerOf("menu_items", id)?.restaurant_id !== house)
    ) {
      return {
        data: null,
        error: {
          code: "P0002",
          message: `${fn}: no such id in house ${house}`,
        },
      };
    }
    const menuOf = ownerOf(
      "restaurant_menus",
      section?.menu_id ?? line?.menu_id ?? menu?.id,
    );
    if (
      DRAFT_ONLY.has(fn) &&
      fn !== "keep_gone_menu_line" &&
      menuOf?.status !== "draft"
    ) {
      return {
        data: null,
        error: {
          code: "55000",
          message: "That is decided in a review. Nothing was changed.",
        },
      };
    }
    switch (fn) {
      case "move_menu_section_to_kind":
        return {
          data: {
            id: args.p_section_id,
            menu_id: "food-draft",
            line_ids: ["line-d"],
          },
          error: null,
        };
      case "set_menu_section_category":
        return {
          data: { id: args.p_section_id, line_ids: ["line-d"] },
          error: null,
        };
      case "confirm_menu_section":
        return {
          data: {
            id: args.p_section_id,
            applied_line_ids: ["line-d"],
            left_line_ids: [],
          },
          error: null,
        };
      default:
        return { data: { ok: true }, error: null };
    }
  }

  const menusService = {
    resolveOnTap: jest.fn(async (...a: unknown[]) => {
      resolveCalls.push(a);
      return { linked: ["line-d"], unlinked: [], error: null };
    }),
  };
  const service = new MenuSectionsService(
    { supabase: { from, rpc } } as any,
    menusService as any,
  );
  return { service, queries, rpcCalls, resolveCalls, menusService };
}

// Every service method, given a menu, a section and a line.
const CALLS: Record<
  string,
  (
    s: MenuSectionsService,
    menu: string,
    sec: string,
    line: string,
  ) => Promise<unknown>
> = {
  list: (s, m) => s.list(HOUSE, m),
  create: (s, m, sec) => s.create(HOUSE, m, "u-1", "Reds", sec, null),
  rename: (s, m, sec) => s.rename(HOUSE, m, sec, "u-1", "Reds"),
  reparent: (s, m, sec) => s.reparent(HOUSE, m, sec, "u-1", null),
  reorder: (s, m, sec) => s.reorder(HOUSE, m, "u-1", null, [sec]),
  remove: (s, m, sec) => s.remove(HOUSE, m, sec, "u-1"),
  moveToKind: (s, m, sec) => s.moveToKind(HOUSE, m, sec, "u-1", "food"),
  setCategory: (s, m, sec) => s.setCategory(HOUSE, m, sec, "u-1", "red"),
  confirmSection: (s, m, sec) =>
    s.confirmSection(HOUSE, m, sec, "u-1", "drink", null),
  confirmLine: (s, m, _sec, line) =>
    s.confirmLine(HOUSE, m, line, "u-1", "drink", null),
  assignLines: (s, m, sec, line) => s.assignLines(HOUSE, m, "u-1", sec, [line]),
  keepGoneLine: (s, m, _sec, line) => s.keepGoneLine(HOUSE, m, line, "u-1"),
};

describe("MenuSectionsService — the house's own sections only (ADR 0147, ADR 0340 lane 3b)", () => {
  it("the table above covers every method the service offers the controller", () => {
    const proto = MenuSectionsService.prototype as any;
    const own = Object.getOwnPropertyNames(proto).filter(
      (n) =>
        n !== "constructor" &&
        typeof Object.getOwnPropertyDescriptor(proto, n)?.value ===
          "function" &&
        ![
          "rpc",
          "assertMenu",
          "assertSection",
          "assertLine",
          "resolve",
        ].includes(n),
    );
    expect(own.sort()).toEqual(Object.keys(CALLS).sort());
  });

  it.each(Object.keys(CALLS))(
    "%s: another house's menu, section and line are a 404, and nothing is written",
    async (name) => {
      const { service, rpcCalls } = makeService();
      await expect(
        CALLS[name](service, FOREIGN_MENU, "sec-x", "line-x"),
      ).rejects.toBeInstanceOf(NotFoundException);
      // Whatever reached the database named the session's house, not the row's.
      expect(rpcCalls.every(([, a]) => a.p_restaurant_id === HOUSE)).toBe(true);
    },
  );

  it.each(Object.keys(CALLS).filter((n) => n !== "list"))(
    "%s: another house's section or line under the house's own menu is a 404",
    async (name) => {
      const { service } = makeService();
      await expect(
        CALLS[name](service, DRAFT, "sec-x", "line-x"),
      ).rejects.toBeInstanceOf(NotFoundException);
    },
  );

  it.each([
    "rename",
    "reparent",
    "remove",
    "moveToKind",
    "setCategory",
    "confirmSection",
    "confirmLine",
  ])(
    "%s: the house's own section or line on ANOTHER of its menus is a 404 before any write: the URL's menu is checked, not assumed",
    async (name) => {
      const { service, rpcCalls } = makeService();
      await expect(
        CALLS[name](service, DRAFT, "sec-l", "line-l"),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(rpcCalls).toEqual([]);
    },
  );

  it.each(Object.keys(CALLS))(
    "%s: every table read carries the house",
    async (name) => {
      const { service, queries } = makeService();
      await CALLS[name](service, DRAFT, "sec-d", "line-d").catch(
        () => undefined,
      );
      for (const q of queries) {
        expect(q.filters).toContainEqual(["restaurant_id", HOUSE]);
      }
    },
  );
});

describe("MenuSectionsService — a live menu is presentation only (ADR 0340 rule 9)", () => {
  it("a category edit on the live menu answers 409 and resolves nothing", async () => {
    const { service, menusService } = makeService();
    await expect(
      service.setCategory(HOUSE, LIVE, "sec-l", "u-1", "white"),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(menusService.resolveOnTap).not.toHaveBeenCalled();
  });

  it("a move to another kind from the live menu is refused (409)", async () => {
    const { service } = makeService();
    await expect(
      service.moveToKind(HOUSE, LIVE, "sec-l", "u-1", "food"),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("a rename on the live menu goes through", async () => {
    const { service, rpcCalls } = makeService();
    await service.rename(HOUSE, LIVE, "sec-l", "u-1", "House reds");
    expect(rpcCalls).toEqual([
      [
        "rename_menu_section",
        {
          p_restaurant_id: HOUSE,
          p_section_id: "sec-l",
          p_title: "House reds",
          p_actor: "u-1",
        },
      ],
    ]);
  });
});

describe("MenuSectionsService — resolve-on-tap (ADR 0340 rule 9)", () => {
  it("a section confirmed as drinks resolves the lines it applied to", async () => {
    const { service, resolveCalls } = makeService();
    const r: any = await service.confirmSection(
      HOUSE,
      DRAFT,
      "sec-d",
      "u-1",
      "drink",
      "red",
    );
    expect(resolveCalls).toEqual([[HOUSE, DRAFT, ["line-d"], "u-1"]]);
    expect(r.resolved).toEqual({
      linked: ["line-d"],
      unlinked: [],
      error: null,
    });
  });

  it("a section confirmed as dishes resolves nothing", async () => {
    const { service, resolveCalls } = makeService();
    const r: any = await service.confirmSection(
      HOUSE,
      DRAFT,
      "sec-d",
      "u-1",
      "dish",
      null,
    );
    expect(resolveCalls).toEqual([]);
    expect(r.resolved).toBeNull();
  });

  it("a line confirmed as a drink is resolved; a category set resolves the section's lines", async () => {
    const { service, resolveCalls } = makeService();
    await service.confirmLine(HOUSE, DRAFT, "line-d", "u-1", "drink", null);
    await service.setCategory(HOUSE, DRAFT, "sec-d", "u-1", "red");
    expect(resolveCalls).toEqual([
      [HOUSE, DRAFT, ["line-d"], "u-1"],
      [HOUSE, DRAFT, ["line-d"], "u-1"],
    ]);
  });

  it("a section moved to the Drinks draft resolves its lines THERE; a move to Food resolves nothing", async () => {
    const { service, resolveCalls } = makeService();
    await service.moveToKind(HOUSE, DRAFT, "sec-d", "u-1", "food");
    expect(resolveCalls).toEqual([]);
    await service.moveToKind(HOUSE, DRAFT, "sec-d", "u-1", "beverage");
    expect(resolveCalls).toEqual([[HOUSE, "food-draft", ["line-d"], "u-1"]]);
  });
});

describe("refusalOf — a database refusal reaches the person as the right answer", () => {
  it.each([
    ["P0002", NotFoundException],
    ["22023", BadRequestException],
    ["23514", BadRequestException],
    ["55000", ConflictException],
    ["23505", ConflictException],
    ["40001", ConflictException],
    ["XX000", InternalServerErrorException],
  ])("%s", (code, kind) => {
    expect(refusalOf({ code, message: "x" })).toBeInstanceOf(kind);
  });

  it("a 404 never echoes the id or the house it was looked up in", () => {
    const e = refusalOf({
      code: "P0002",
      message: "rename_menu_section: no section abc in house rest-2",
    });
    expect(String(e.message)).not.toMatch(/abc|rest-2/);
  });

  it("the function's own name is dropped from a refusal the person reads", () => {
    const e = refusalOf({
      code: "22023",
      message: "assign_menu_lines: no line was named; nothing was changed",
    });
    expect(e.message).toBe("no line was named; nothing was changed");
  });
});
