import { BadRequestException } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { ProvidersService } from "../providers/providers.service";
import { ProviderIntelligenceService } from "../providers/provider-intelligence.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { DatabaseService } from "../database/database.service";

/**
 * Gateway reads and writes against the schema the migrations declare
 * (wave 16 sim, F-556 / F-558 / F-559 / F-560). Each was a column, a CHECK
 * value or a width the database refuses, so the call failed with a 500 or
 * silently did nothing. The schema facts are read from the migrations, not
 * restated here, so a later migration that changes them moves these tests.
 */

const SRC = path.resolve(__dirname, "..");

const MIGRATIONS = path.resolve(__dirname, "../../../../supabase/migrations");

function columnsOf(table: string): Set<string> {
  const cols = new Set<string>();
  for (const f of fs
    .readdirSync(MIGRATIONS)
    .filter((x) => x.endsWith(".sql"))) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8");
    const create = new RegExp(
      `CREATE TABLE (?:IF NOT EXISTS )?(?:public\\.)?${table} \\(([\\s\\S]*?)\\n\\);`,
      "i",
    ).exec(sql);
    if (create) {
      for (const line of create[1].split("\n")) {
        const m = /^\s+([a-z_][a-z0-9_]*)\s/.exec(line);
        if (m && m[1].toUpperCase() !== "CONSTRAINT") cols.add(m[1]);
      }
    }
    const alter = new RegExp(
      `alter table (?:only )?(?:public\\.)?${table}\\b([\\s\\S]*?);`,
      "gi",
    );
    for (const a of sql.matchAll(alter)) {
      for (const m of a[1].matchAll(
        /add column (?:if not exists )?([a-z_][a-z0-9_]*)/gi,
      )) {
        cols.add(m[1]);
      }
    }
  }
  return cols;
}

type Call = { table: string; op: string; arg: unknown; val?: unknown };

function recordingSupabase(calls: Call[]) {
  return {
    from(table: string) {
      const api: any = {
        select: () => api,
        order: () => api,
        is: (col: string) => {
          calls.push({ table, op: "is", arg: col });
          return api;
        },
        eq: (col: string, val: unknown) => {
          calls.push({ table, op: "eq", arg: col, val });
          return api;
        },
        or: (filter: string) => {
          calls.push({ table, op: "or", arg: filter });
          return api;
        },
        maybeSingle: async () => ({ data: { id: "p1" }, error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: [], error: null }),
      };
      return api;
    },
  };
}

describe("provider filters name only real columns (F-558)", () => {
  it("search matches the contact's name through columns providers has", async () => {
    const calls: Call[] = [];
    const service = new ProvidersService(
      { supabase: recordingSupabase(calls) } as any,
      {} as any,
      {} as any,
    );
    await service.searchProviders({ q: "maria", restaurantId: "r1" });

    const providerCols = columnsOf("providers");
    expect(providerCols.has("contact_first_name")).toBe(true);
    const or = calls.find((c) => c.op === "or");
    const named = String(or?.arg)
      .split(",")
      .map((clause) => clause.split(".")[0]);
    expect(named).toContain("contact_first_name");
    for (const col of named) expect(providerCols).toContain(col);
  });

  it("an offers filter reads is_active, never a status column the table lacks", async () => {
    const calls: Call[] = [];
    const service = new ProviderIntelligenceService({
      supabase: recordingSupabase(calls),
    } as any);
    await service.getPromotions("p1", "r1", "active");

    const promoCols = columnsOf("provider_promotions");
    const filters = calls.filter(
      (c) => c.table === "provider_promotions" && c.op === "eq",
    );
    for (const f of filters) expect(promoCols).toContain(f.arg);
    expect(filters).toContainEqual(
      expect.objectContaining({ arg: "is_active", val: true }),
    );
  });

  it("refuses an offers filter it cannot answer", async () => {
    const service = new ProviderIntelligenceService({
      supabase: recordingSupabase([]),
    } as any);
    await expect(
      service.getPromotions("p1", "r1", "expired"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("known_personnel has no column, so the service does not name it (F-559)", () => {
  it("is absent from the schema and from providers.service.ts", () => {
    expect(columnsOf("providers").has("known_personnel")).toBe(false);
    const src = fs.readFileSync(
      path.join(SRC, "providers/providers.service.ts"),
      "utf8",
    );
    // The removal note may mention it in a comment; code may not.
    const code = src
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/known_personnel|knownPersonnel/);
  });

  it("is not promised by ProviderResponseDto either, since nothing fills it", () => {
    const dto = fs.readFileSync(
      path.join(SRC, "providers/dto/providers.dto.ts"),
      "utf8",
    );
    expect(dto).not.toMatch(/knownPersonnel/);
  });
});

/** The values a `CHECK (col = ANY (ARRAY['a', ...]))` constraint allows. */
function checkValues(constraint: string): string[] {
  for (const f of fs
    .readdirSync(MIGRATIONS)
    .filter((x) => x.endsWith(".sql"))) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8");
    const m = new RegExp(`CONSTRAINT ${constraint} CHECK \\((.*)$`, "m").exec(
      sql,
    );
    if (m) return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  }
  return [];
}

describe("legacy org-membership repair writes a role the CHECK allows (F-556)", () => {
  it("writes a CHECK role, never owner, and never overwrites a row", async () => {
    const allowed = checkValues("organization_members_role_check");
    expect(allowed).toEqual(expect.arrayContaining(["owner", "staff"]));

    const upserts: { row: Record<string, unknown>; opts: unknown }[] = [];
    const from = (table: string) => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        maybeSingle: () =>
          Promise.resolve(
            table === "users"
              ? { data: { restaurant_id: "r1" }, error: null }
              : { data: { organization_id: "org-1" }, error: null },
          ),
        upsert: (row: Record<string, unknown>, opts: unknown) => {
          upserts.push({ row, opts });
          return Promise.resolve({ data: null, error: null });
        },
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: [], error: null }),
      };
      return b;
    };
    const service = new OrganizationsService({
      supabase: { from },
    } as unknown as DatabaseService);
    const orgIds = await (
      service as unknown as {
        getUserOrgIdsWithFallback(u: string): Promise<string[]>;
      }
    ).getUserOrgIdsWithFallback("u1");

    expect(orgIds).toEqual(["org-1"]);
    expect(upserts).toHaveLength(1);
    expect(allowed).toContain(upserts[0].row.role);
    expect(upserts[0].row.role).not.toBe("owner");
    expect(upserts[0].opts).toMatchObject({ ignoreDuplicates: true });
  });
});

describe("every notification title fits notifications.title (F-560)", () => {
  const width = Number(
    /CREATE TABLE public\.notifications \([\s\S]*?\n\s+title character varying\((\d+)\)/.exec(
      fs.readFileSync(
        path.join(MIGRATIONS, "20260805000000_baseline_from_production.sql"),
        "utf8",
      ),
    )?.[1],
  );

  // Titles here are fixed sentences, far under the width.
  const LITERAL_TITLES = new Set(["passkeys/passkeys.service.ts"]);

  function insertSites(): { file: string; line: number; title: string }[] {
    const out: { file: string; line: number; title: string }[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".ts") && !e.name.endsWith(".spec.ts")) {
          const src = fs.readFileSync(p, "utf8");
          const rel = path.relative(SRC, p);
          const insert =
            /from\(\s*"notifications"\s*\)\s*\.(?:insert|upsert)\(/g;
          for (const m of src.matchAll(insert)) {
            // The row is built in the insert or just above it (a rows map):
            // take the `title:` line nearest the insert call.
            let title: RegExpMatchArray | null = null;
            let best = Infinity;
            for (const t of src.matchAll(/^\s+title: (.+),$/gm)) {
              const d = Math.abs(t.index! - m.index!);
              if (d < best && d < 1500) {
                best = d;
                title = t;
              }
            }
            out.push({
              file: rel,
              line: src.slice(0, m.index).split("\n").length,
              title: title?.[1] ?? "",
            });
          }
        }
      }
    };
    walk(SRC);
    return out;
  }

  it("reads the width from the migrations", () => {
    expect(width).toBe(255);
  });

  it("clips every built title to the column width", () => {
    const sites = insertSites();
    expect(sites.length).toBeGreaterThanOrEqual(8);
    const bad = sites.filter((s) => {
      if (LITERAL_TITLES.has(s.file)) return false;
      const clip = /\.slice\(0, (\d+)\)$/.exec(s.title);
      return !clip || Number(clip[1]) > width;
    });
    expect(bad).toEqual([]);
  });
});
