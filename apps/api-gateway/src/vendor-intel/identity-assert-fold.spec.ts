import { IdentityService } from "./identity.service";
import {
  buildIdentityKey,
  couldBeBeforeFold,
  likePatternBeforeFold,
  readIdentity,
} from "./beverage-identity";
import { normalizeIdentityTextBeforeFold } from "./wine-identity";

/**
 * One bottle, one identity, whatever spelling asserts it (QA round 10c, F1).
 *
 * A bottle asserted with "ı" before the fold is stored under "kavakl dere|...".
 * Before this, asserting the same bottle as "Kavaklidere" or "KAVAKLIDERE"
 * looked up only "kavaklidere|..." and inserted a second row. The register here
 * is an in-memory table that computes `identity_key` the way the generated
 * column does and evaluates `eq`, `like`, `order` and `limit` for real, so the
 * test counts rows rather than counting calls.
 */

interface Row {
  id: string;
  producer_normalised: string;
  name_normalised: string;
  vintage_text: string;
  size_ml: number | null;
  pack: number | null;
  display_label: string;
  standing: string;
  curation_state: string;
  created_at: string;
  identity_key?: string;
}

function keyOf(r: Row): string {
  return [
    r.producer_normalised,
    r.name_normalised,
    r.vintage_text,
    r.size_ml === null ? "size?" : String(r.size_ml),
    r.pack === null ? "pack?" : String(r.pack),
  ].join("|");
}

function likeToRegExp(pattern: string): RegExp {
  const body = pattern
    .split("")
    .map((c) =>
      c === "%" ? ".*" : c === "_" ? "." : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
  return new RegExp(`^${body}$`, "s");
}

function makeRegister(seed: Row[] = [], opts: { likeFails?: boolean } = {}) {
  const rows: Row[] = seed.map((r) => ({ ...r }));
  let clock = 0;
  const from = (table: string) => {
    if (table !== "beverage_identities") throw new Error(`unexpected ${table}`);
    const preds: Array<(r: Row) => boolean> = [];
    let usedLike = false;
    let limit = Infinity;
    let orderAsc: string | null = null;
    const run = () => {
      let out = rows
        .map((r) => ({ ...r, identity_key: keyOf(r) }))
        .filter((r) => preds.every((p) => p(r)));
      if (orderAsc) {
        const col = orderAsc as keyof Row;
        out = out.sort((x, y) => String(x[col]).localeCompare(String(y[col])));
      }
      return out.slice(0, limit);
    };
    const b: any = {
      select: () => b,
      eq: (col: string, val: any) => {
        preds.push((r: any) => r[col] === val);
        return b;
      },
      like: (col: string, pattern: string) => {
        usedLike = true;
        const re = likeToRegExp(pattern);
        preds.push((r: any) => re.test(String(r[col])));
        return b;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        if (opts?.ascending === false) throw new Error("only ascending here");
        orderAsc = col;
        return b;
      },
      limit: (n: number) => {
        limit = n;
        return b;
      },
      maybeSingle: async () => {
        const out = run();
        if (out.length > 1) return { data: null, error: { message: "many rows" } };
        return { data: out[0] ?? null, error: null };
      },
      then: (resolve: any, reject: any) =>
        Promise.resolve(
          opts.likeFails && usedLike
            ? { data: null, error: { message: "statement timeout" } }
            : { data: run(), error: null },
        ).then(resolve, reject),
      insert: (payload: any) => {
        const row: Row = {
          id: `ident-${rows.length + 1}`,
          standing: payload.asserted_for_restaurant_id ? "provisional" : "source",
          created_at: `2026-11-08T00:00:${String(clock++).padStart(2, "0")}Z`,
          ...payload,
        };
        if (rows.some((r) => keyOf(r) === keyOf(row))) {
          return {
            select: () => ({
              single: async () => ({
                data: null,
                error: { message: "duplicate key uq_beverage_identities_key" },
              }),
            }),
          };
        }
        rows.push(row);
        return {
          select: () => ({ single: async () => ({ data: row, error: null }) }),
        };
      },
    };
    return b;
  };
  const svc = new IdentityService({ supabase: { from } } as any);
  return { svc, rows };
}

/** The row the code before the fold wrote for this subject. */
function assertedBeforeFold(
  subject: { producer: string; name: string; sizeMl: number; pack: number },
  displayLabel: string,
  id = "ident-old",
): Row {
  const r = readIdentity(subject, normalizeIdentityTextBeforeFold);
  if (!r.ok) throw new Error("unreadable");
  return {
    id,
    producer_normalised: r.producerNormalised,
    name_normalised: r.nameNormalised,
    vintage_text: r.vintageText,
    size_ml: r.sizeMl,
    pack: r.pack,
    display_label: displayLabel,
    standing: "provisional",
    curation_state: "queued",
    created_at: "2026-10-01T00:00:00Z",
  };
}

const assertAs = (svc: IdentityService, producer: string, name: string) =>
  svc.assertIdentity({
    subject: { producer, name, sizeMl: 750, pack: 1 },
    userId: "user-1",
    restaurantId: "house-1",
  });

describe("a bottle first asserted with ı, then in ASCII and in capitals", () => {
  it("stays one bottle when the ı assertion was stored before the fold", async () => {
    const old = assertedBeforeFold(
      { producer: "Kavaklıdere", name: "Yakut", sizeMl: 750, pack: 1 },
      "Kavaklıdere Yakut (750ml)",
    );
    expect(keyOf(old)).toBe("kavakl dere|yakut|unstated|750|1");
    const { svc, rows } = makeRegister([old]);

    const ascii = await assertAs(svc, "Kavaklidere", "Yakut");
    const caps = await assertAs(svc, "KAVAKLIDERE", "YAKUT");
    const again = await assertAs(svc, "Kavaklıdere", "Yakut");

    expect(rows).toHaveLength(1);
    for (const out of [ascii, caps, again]) {
      expect(out.created).toBe(false);
      expect(out.id).toBe("ident-old");
      expect(out.identityKey).toBe("kavakl dere|yakut|unstated|750|1");
    }
  });

  it("stays one bottle when ı is in both producer and name", async () => {
    const old = assertedBeforeFold(
      { producer: "Kavaklıdere", name: "Kalecik Karası", sizeMl: 750, pack: 1 },
      "Kavaklıdere Kalecik Karası (750ml)",
    );
    expect(keyOf(old)).toBe("kavakl dere|kalecik karas|unstated|750|1");
    const { svc, rows } = makeRegister([old]);

    await assertAs(svc, "Kavaklidere", "Kalecik Karasi");
    await assertAs(svc, "KAVAKLIDERE", "KALECIK KARASI");

    expect(rows).toHaveLength(1);
  });

  it("stays one bottle when the ı started a word and was trimmed away", async () => {
    // "ışık" keyed "s k" before the fold: the leading ı trimmed, not a space.
    const old = assertedBeforeFold(
      { producer: "Kavaklıdere", name: "ışık", sizeMl: 750, pack: 1 },
      "Kavaklıdere ışık (750ml)",
    );
    expect(old.name_normalised).toBe("s k");
    const { svc, rows } = makeRegister([old]);

    await assertAs(svc, "KAVAKLIDERE", "ISIK");

    expect(rows).toHaveLength(1);
  });

  it("stays one bottle when the ı assertion is made after the fold", async () => {
    const { svc, rows } = makeRegister();

    const first = await assertAs(svc, "Kavaklıdere", "Yakut");
    await assertAs(svc, "Kavaklidere", "Yakut");
    await assertAs(svc, "KAVAKLIDERE", "YAKUT");

    expect(first.created).toBe(true);
    expect(rows).toHaveLength(1);
    expect(keyOf(rows[0])).toBe("kavaklidere|yakut|unstated|750|1");
  });
});

describe("what the pre-fold lookup must not take", () => {
  it("does not take 'Domaine Al' for 'Domaine Ali'", async () => {
    // "domaine al" IS a pre-fold image of "domaine ali" (trailing i trimmed);
    // the display label, which kept what was typed, tells them apart.
    const old = assertedBeforeFold(
      { producer: "Domaine Al", name: "Kırmızı", sizeMl: 750, pack: 1 },
      "Domaine Al Kırmızı (750ml)",
    );
    const { svc, rows } = makeRegister([old]);

    const out = await assertAs(svc, "Domaine Ali", "Kirmizi");

    expect(out.created).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it("does not take a producer with a real space where the new one has an i", async () => {
    const old: Row = {
      ...assertedBeforeFold(
        { producer: "Kavakl Dere", name: "Yakut", sizeMl: 750, pack: 1 },
        "Kavakl Dere Yakut (750ml)",
      ),
    };
    expect(keyOf(old)).toBe("kavakl dere|yakut|unstated|750|1");
    const { svc, rows } = makeRegister([old]);

    const out = await assertAs(svc, "Kavaklidere", "Yakut");

    expect(out.created).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it("does not take a different size of the same wine", async () => {
    const old = assertedBeforeFold(
      { producer: "Kavaklıdere", name: "Yakut", sizeMl: 375, pack: 1 },
      "Kavaklıdere Yakut (375ml)",
    );
    const { svc, rows } = makeRegister([old]);

    await assertAs(svc, "KAVAKLIDERE", "YAKUT");

    expect(rows).toHaveLength(2);
  });
});

describe("when the pre-fold lookup cannot be read", () => {
  it("refuses and writes nothing, rather than insert a second bottle", async () => {
    const old = assertedBeforeFold(
      { producer: "Kavaklıdere", name: "Yakut", sizeMl: 750, pack: 1 },
      "Kavaklıdere Yakut (750ml)",
    );
    const { svc, rows } = makeRegister([old], { likeFails: true });

    await expect(assertAs(svc, "KAVAKLIDERE", "YAKUT")).rejects.toThrow(
      /could not be read \(statement timeout\)\. Nothing was written/,
    );
    expect(rows).toHaveLength(1);
  });
});

describe("couldBeBeforeFold / likePatternBeforeFold", () => {
  it.each([
    ["kavaklidere", "kavakl dere", true],
    ["kavaklidere", "kavaklidere", true],
    ["isik", "s k", true],
    ["isik", "is k", true],
    ["kalecik karasi", "kalecik karas", true],
    ["ii", "", true],
    ["kavaklidere", "kavak dere", false],
    ["kavaklidere", "kavakl  dere", false],
    ["yakut", "yakut ", false],
  ])("%s -> %s is %s", (folded, stored, want) => {
    expect(couldBeBeforeFold(folded, stored)).toBe(want);
  });

  it("matches every pre-fold spelling it is a prefilter for", () => {
    const pattern = likePatternBeforeFold("kalecik karasi")!;
    expect(pattern).toBe("kalec%k%karas%");
    const re = likeToRegExp(pattern);
    for (const raw of ["Kalecik Karası", "Kalecık Karası", "Kalecik Karasi"]) {
      const r = readIdentity(
        { producer: "x", name: raw },
        normalizeIdentityTextBeforeFold,
      );
      expect(r.ok && re.test(r.nameNormalised)).toBe(true);
    }
    expect(likePatternBeforeFold("yakut")).toBeNull();
    expect(likePatternBeforeFold("i i")).toBeNull();
  });

  it("agrees with the key the pre-fold reader builds", () => {
    const subject = { producer: "KAVAKLIDERE", name: "Yakut", sizeMl: 750, pack: 1 };
    const now = readIdentity(subject);
    const before = readIdentity(
      { ...subject, producer: "Kavaklıdere" },
      normalizeIdentityTextBeforeFold,
    );
    expect(now.ok && before.ok).toBe(true);
    if (now.ok && before.ok) {
      expect(buildIdentityKey(now)).toBe("kavaklidere|yakut|unstated|750|1");
      expect(couldBeBeforeFold(now.producerNormalised, before.producerNormalised)).toBe(true);
    }
  });
});
