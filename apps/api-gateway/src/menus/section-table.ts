import {
  MENU_KIND_GUESSES,
  isMenuCategory,
  kindVerdict,
  type MenuKindGuess,
  type UnsureReason,
} from "./menu-line-view";
import type {
  MenuCategory,
  WineExtractItem,
} from "./wine-extract-item.interface";

/**
 * ADR 0340 rule 13: one upload makes one draft per kind found, and that split
 * (with the section-table prompt it reads, rule 14) ships behind this
 * deployment flag, OFF unless it says exactly `true`. Off, an upload is read
 * and kept as before: one Drinks draft, sections from its lines' categories.
 * It is turned on by the founder's keystroke only after the readers (lane 4),
 * the review (lane 6), onboarding (lane 6b) and the evaluation (lane 8).
 */
export const MENUS_SPLIT_BY_KIND = "MENUS_SPLIT_BY_KIND";

export function menusSplitByKind(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[MENUS_SPLIT_BY_KIND] === "true";
}

/** Sections nest at most three levels (§F2); a deeper heading files under the third. */
export const SECTION_DEPTH_MAX = 3;

/** The stored kinds a read can split into, in the order their drafts are made. */
export type DraftKind = "beverage" | "food" | "desserts";
export const DRAFT_KINDS: readonly DraftKind[] = [
  "beverage",
  "food",
  "desserts",
];

/** A draft's name, with no data in it (rule 17). */
export const DRAFT_NAMES: Record<DraftKind, string> = {
  beverage: "Drinks list",
  food: "Food menu",
  desserts: "Desserts menu",
};

const draftKindOf = (k: MenuKindGuess): DraftKind =>
  k === "food" ? "food" : k === "desserts" ? "desserts" : "beverage";

const known = (k: unknown): k is Exclude<MenuKindGuess, "unknown"> =>
  typeof k === "string" &&
  k !== "unknown" &&
  (MENU_KIND_GUESSES as readonly string[]).includes(k);

/**
 * A heading folded for a key: Turkish İ/I/ı as i, lower-cased, and only
 * letters and numbers in any script (`\p{L}\p{N}`), so "Kırmızı" and
 * "KIRMIZI " are one heading and a name in Greek is not folded to nothing.
 */
export function foldForKey(v: unknown): string {
  return String(v ?? "")
    .replace(/[İIı]/g, "i")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The heading path a line files under: its printed path, trimmed, blanks
 * dropped, at most three levels. A line read with no heading files under its
 * own category, as the back-fill does (rule 12); with neither it is Unsorted.
 */
export function sectionPathOf(item: WineExtractItem): string[] {
  const printed = (item.section?.path ?? [])
    .filter((h): h is string => typeof h === "string")
    .map((h) => h.trim())
    .filter(Boolean);
  if (printed.length > 0) return printed.slice(0, SECTION_DEPTH_MAX);
  const cat = typeof item.category === "string" ? item.category.trim() : "";
  return cat ? [cat] : [];
}

/**
 * The chunk-seam key (rule 14): producer, name, vintage and, on a read with
 * sections, the section path. Prices stay out, so a line printed twice across
 * a page break is one line; the same wine under two sections is two.
 */
export function seamKeyOf(item: WineExtractItem): string {
  const base = [item.producer, item.name, item.vintage].map(foldForKey);
  if (!item.section) return base.join("|");
  const path = sectionPathOf(item).map(foldForKey).filter(Boolean).join("/");
  return [...base, path].join("|");
}

/** Every heading of a read, once each, for the §F12 second opinion. */
export function headingsOf(items: readonly WineExtractItem[]): string[] {
  return [...new Set(items.flatMap((i) => sectionPathOf(i)))];
}

/** One section of a draft as the read made it, for `materialise_read_sections`. */
export interface ReadSection {
  path: string[];
  /** The leaf heading as printed. */
  titleAsRead: string;
  /** Where the section was placed, or "unknown" when nothing decided it. */
  suggestedKind: DraftKind | "unknown";
  suggestedCategory: MenuCategory | null;
  /** What placed it: "rules", "read", "second_opinion" or "none". */
  suggestedBy: "rules" | "read" | "second_opinion" | "none";
  /** Why the section is Unsure; empty when it is not. */
  unsure: UnsureReason[];
  /** Indexes into the slice's `items` of the lines under it. */
  lines: number[];
}

export interface KindSlice {
  kind: DraftKind;
  items: WineExtractItem[];
  sections: ReadSection[];
}

/** The model's opinion of a path: the nearest heading it decided, from the leaf up. */
function opinionOf(
  path: string[],
  opinion: ReadonlyMap<string, MenuKindGuess> | null,
): MenuKindGuess | null {
  if (!opinion) return null;
  for (let i = path.length - 1; i >= 0; i--) {
    const k = opinion.get(path[i].slice(0, 120));
    if (known(k)) return k;
  }
  return null;
}

/**
 * A line made to fit its decided kind (rule 7, F20): a dish keeps one price
 * in `price` and no category; a drink keeps its glass and bottle prices and
 * no dish price. A line that cannot fit (a "dish" with both a glass and a
 * bottle price, a "drink" with only a dish price) is Unsure.
 */
function shaped(
  item: WineExtractItem,
  kind: "drink" | "dish" | null,
  reasons: UnsureReason[],
): WineExtractItem {
  const out: WineExtractItem = { ...item };
  const hasGlass = typeof out.by_glass_price === "number";
  const hasBottle = typeof out.bottle_price === "number";
  let lineKind = kind;
  if (lineKind === "dish" && hasGlass && hasBottle) {
    lineKind = null;
    reasons.push("shape_contradicts_heading");
  }
  if (lineKind === "drink" && !hasGlass && !hasBottle && out.price != null) {
    lineKind = null;
    reasons.push("shape_contradicts_heading");
  }
  if (lineKind === "dish") {
    const one = out.price ?? out.bottle_price ?? out.by_glass_price;
    delete out.by_glass_price;
    delete out.bottle_price;
    delete out.category;
    if (one === undefined) delete out.price;
    else out.price = one;
  } else if (lineKind === "drink") {
    delete out.price;
  } else if (out.price != null) {
    // An Unsure line holds its one price where a flat read keeps it; the
    // owner's Dish tap moves it to `price` (confirm_menu_line).
    if (!hasGlass && !hasBottle) out.bottle_price = out.price;
    delete out.price;
  }
  out.line_kind = lineKind;
  out.kind_flag =
    lineKind === null
      ? [...new Set(reasons)].join(", ") || "rules_unknown"
      : null;
  return out;
}

/**
 * The split by kind (rules 13 and 15). Each section is placed by the rules
 * (`kindVerdict` on its heading path); when they cannot tell, by the read's
 * kind, then the §F12 second opinion, else on the Drinks draft. A section is
 * Unsure when the rules cannot tell or a model disagrees. A line takes a
 * stored kind only when the rules decided it and nothing disagreed (its own
 * read, its section, its shape); otherwise it is Unsure (`line_kind` null)
 * and never reaches the resolver. Lines stay with their section.
 */
export function splitByKind(
  items: readonly WineExtractItem[],
  opinion: ReadonlyMap<string, MenuKindGuess> | null,
): KindSlice[] {
  interface Group {
    path: string[];
    items: WineExtractItem[];
  }
  const groups = new Map<string, Group>();
  for (const item of items) {
    const path = sectionPathOf(item);
    const key = path.map(foldForKey).join("/");
    const g = groups.get(key) ?? { path, items: [] };
    g.items.push(item);
    groups.set(key, g);
  }

  const slices = new Map<DraftKind, KindSlice>();
  for (const [key, g] of groups) {
    const head = g.items.find((i) => i.section)?.section;
    const readKind = known(head?.kind_suggested) ? head!.kind_suggested! : null;
    const second = opinionOf(g.path, opinion);
    const section = kindVerdict({ heading: g.path, modelKind: readKind });
    const sectionReasons = [...section.reasons];
    // The §F12 second opinion is a second model: it can disagree with the
    // rules or, when they cannot tell, with the read's own kind.
    const decided = known(section.kind) ? section.kind : readKind;
    if (second && decided && second !== decided)
      sectionReasons.push("model_disagrees");
    const placed: MenuKindGuess = known(section.kind)
      ? section.kind
      : (readKind ?? second ?? "unknown");
    const suggestedBy: ReadSection["suggestedBy"] = known(section.kind)
      ? "rules"
      : readKind
        ? "read"
        : second
          ? "second_opinion"
          : "none";

    // Unsorted lines (no heading, no category) are placed one by one.
    const lineGroups: Array<[DraftKind, WineExtractItem[]]> = key
      ? [
          [
            draftKindOf(
              placed !== "unknown"
                ? placed
                : g.items.every((i) => i.line_kind_suggested === "dish")
                  ? "food"
                  : "drinks",
            ),
            g.items,
          ],
        ]
      : g.items.map((i) => [
          i.line_kind_suggested === "dish" ? "food" : "beverage",
          [i],
        ]);

    for (const [kind, lines] of lineGroups) {
      const slice = slices.get(kind) ?? { kind, items: [], sections: [] };
      slices.set(kind, slice);
      const indexes: number[] = [];
      for (const item of lines) {
        const lineModel: MenuKindGuess | null =
          item.line_kind_suggested === "drink"
            ? "drinks"
            : item.line_kind_suggested === "dish"
              ? placed === "food" || placed === "desserts"
                ? placed
                : "food"
              : null;
        const v = kindVerdict({
          heading: g.path,
          line: {
            by_glass_price: item.by_glass_price,
            bottle_price: item.bottle_price,
            price: item.price,
            category: item.category,
          },
          modelKind: lineModel,
          sectionKind: known(section.kind) ? section.kind : null,
        });
        const reasons = [...sectionReasons, ...v.reasons];
        const kindOfLine =
          reasons.length === 0
            ? v.kind === "drinks"
              ? "drink"
              : known(v.kind)
                ? "dish"
                : null
            : null;
        indexes.push(slice.items.length);
        slice.items.push(shaped(item, kindOfLine, reasons));
      }
      if (key)
        slice.sections.push({
          path: g.path,
          titleAsRead: g.path[g.path.length - 1],
          suggestedKind: placed === "unknown" ? "unknown" : draftKindOf(placed),
          suggestedCategory: isMenuCategory(head?.drink_category)
            ? head!.drink_category!
            : null,
          suggestedBy,
          unsure: [...new Set(sectionReasons)],
          lines: indexes,
        });
    }
  }
  return DRAFT_KINDS.flatMap((k) => (slices.has(k) ? [slices.get(k)!] : []));
}
