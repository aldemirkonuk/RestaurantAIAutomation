import { policyFor } from "../ask-readings/reading-data-classes";
import { MENU_CATEGORY_VOCABULARY } from "./wine-extract-item.interface";
import { EDITABLE_MENU_ITEM_FIELDS, type EditableMenuItemField } from "./dto/review-menu-item.dto";

/**
 * What one menu line read says to the person reading it (ADR 0309 option 1c,
 * amended after the audit of #655 at 220e3747d).
 *
 * The import keeps each line as the reading saw it in
 * `menu_items.raw_extracted_text`. For a CSV that is the WHOLE row
 * (`parsers/csv-parser.service.ts:55`), including every column the reader does
 * not map (cost, supplier, margin, notes: `HEADER_MAP`, `:5-29`), and no header
 * is kept with it, so nothing can tell which cell is a cost. Under ADR 0145's
 * ROLE_POLICY staff see neither `money` nor `suppliers`, so the raw line goes
 * only to a role that sees both. That is this read only: the kept source
 * file and the import reply are other paths, and the register fragment
 * `.planning/tech-debt.d/2026-10-08-fix-a-menu-line-carries-its-raw-line.md`
 * (entries (i) and (iii)) says what still reaches a member or an uploader
 * through them.
 *
 * Every member gets `kitchen_line`, worked out here from the stored row, so a
 * line's kitchen split no longer depends on who reads it or in which tab.
 *
 * The reply's marker is `rawLineWithheld`, not the money-policy synthesis's
 * one root marker `amountsWithheld`: these replies still carry the sale prices
 * (`by_glass_price`, `bottle_price`) to every member until MENU-02 withholds
 * them, so `amountsWithheld: true` would tell a reader that amounts are gone
 * when they are not. Moving these replies to `amountsWithheld` belongs with
 * MENU-02 (the coordinator's money-policy synthesis of 2026-10-07, M2).
 */

/**
 * The kitchen hints. The same list as the web's `KITCHEN`
 * (`apps/web/src/lib/firstProof.ts`); a CLAIMS row keeps the two lists equal.
 * 'dessert' is also a drink section (MENU_CATEGORY_VOCABULARY, ADR 0186):
 * a known drink section wins, so a dessert wine stays a drink; the hints
 * decide only when the section is unknown (QA M18, tech-debt entry (ii) of
 * `.planning/tech-debt.d/2026-10-08-fix-a-menu-line-carries-its-raw-line.md`).
 * 'dessert' is the one section that is also a course, so it alone is weighed:
 * see `isKitchenLine`.
 *
 * The course words after 'salad' came from the browser walk of 2026-11-12: a
 * CSV whose dish section was "Mains" sent "Grilled Octopus" to the wine
 * library. 'mains' and 'sides' are listed plural on purpose: the plural
 * suffix is optional, so 'mains' still matches "Mains" but a cocktail called
 * "Side Car" or a wine called "Main Street" is not taken for a dish. 'grill'
 * is whole-word, so the Grillo grape is not one.
 */
export const KITCHEN_HINTS = ["food", "kitchen", "dish", "starter", "dessert", "entree", "entrée", "pasta", "salad", "mains", "main course", "appetizer", "appetiser", "sides", "soup", "meze", "mezze", "grill", "small plate", "snack", "tapas", "pizza", "burger", "sandwich", "ana yemek", "yemekler", "ara sicak", "corba", "izgara", "kebap", "kebab", "salata", "baslangic", "pide", "lahmacun", "makarna", "kahvalti", "aperatif", "sandvic", "kofte", "manti", "borek", "doner"];

/**
 * TURKISH COURSES (r28 menu audit G3). The founder's own house writes its
 * sections in Turkish, and every one of "Ana yemekler", "Tatlılar",
 * "Çorbalar", "Mezeler", "Kebaplar" failed the test above, so those dishes
 * went to the wine library and, once the menu was current, became bottles of
 * wine priced at the dish price. The Turkish hints are written FOLDED (no
 * dots, no cedillas: "corba" for "çorba"), because the text they are tested
 * against is folded first (`foldForHints`): "ÇORBALAR".toLowerCase() is
 * "çorbalar" but "TATLILAR".toLowerCase() is "tatlilar", not "tatlılar", so
 * only a folded form matches both ways a menu prints a word. The ending may
 * be a Turkish plural (-ler/-lar) or possessive (-si, -i, -leri/-lari: "Mercimek
 * Çorbası", "İskender Kebabı") as well as an English plural.
 *
 * Left out on purpose: "tatlı" (dessert, but also "sweet", as in "tatlı
 * şarap", a sweet wine) is not a hint; a section named "Tatlı"/"Tatlılar" is
 * weighed exactly like "dessert" (DESSERT_SECTIONS). "Yemek" alone is not a
 * hint ("yemek şarabı", a food wine); "balık" (fish) is not either, because a
 * rakı line says "balık yanına". "Dürüm" folds to "durum", a common word.
 */
export const DESSERT_SECTIONS = ["dessert", "desserts", "tatli", "tatlilar"];

/**
 * Lowercase, with every accent and dot taken off and the dotless ı read as i
 * (the uppercase I lowercases to i, so "TATLILAR" and "Tatlılar" meet).
 */
export function foldForHints(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "").replace(/ı/g, "i");
}

/** The raw line's column. Sent only when the caller's view allows it. */
export const RAW_LINE_COLUMN = "raw_extracted_text";

/**
 * The keys of a line any member of the house is sent. An allowlist: a column
 * added to the select reaches nobody until it is named here.
 */
export const MEMBER_LINE_KEYS = [
  "id",
  "name",
  "producer",
  "category",
  "vintage",
  "region",
  "country",
  "grape_variety",
  "by_glass_price",
  "bottle_price",
  "wine_library_id",
  "inventory_item_id",
  "source",
  "status",
  "price_flag",
  "price_flag_note",
  "created_at",
] as const;

/**
 * Why a line's status is 'flagged', from the closed set of notes the gateway
 * itself writes (menus.service.ts: a manager's correction, a line added by
 * hand during review, a typed line past the free plan's limit). The note's
 * text never leaves the gateway -- only this reason and, for a correction,
 * which field was corrected (one of EDITABLE_MENU_ITEM_FIELDS). Onboarding
 * walk 2026-11-12: the owner chose a line's section on the first proof and
 * /menu then called that line "flagged", with nothing to say why.
 */
export type FlagReason = "corrected" | "added_by_hand" | "past_free_limit" | "unknown";

export function flagReasonOf(
  status: unknown,
  notes: unknown,
): { reason: FlagReason; field: EditableMenuItemField | null } | null {
  if (status !== "flagged") return null;
  const text = typeof notes === "string" ? notes.trim() : "";
  const corrected = /^Manager corrected ([a-z_]+)$/.exec(text);
  if (corrected && (EDITABLE_MENU_ITEM_FIELDS as readonly string[]).includes(corrected[1]))
    return { reason: "corrected", field: corrected[1] as EditableMenuItemField };
  if (text === "Manually added during review") return { reason: "added_by_hand", field: null };
  if (text.startsWith("Free tier:")) return { reason: "past_free_limit", field: null };
  return { reason: "unknown", field: null };
}

/** Who a line read is for. `rawLine` true sends the raw line itself. */
export interface LineView {
  rawLine: boolean;
}

/** A hint as a whole word (plural allowed): "pasta" trips it, "Pastaio" and "dishwasher" do not. */
const HINT_WORDS = new RegExp(`(^|[^\\p{L}\\p{N}])(${KITCHEN_HINTS.join("|")})(s|es|ler|lar|leri|lari|si|i)?(?=$|[^\\p{L}\\p{N}])`, "u");

/**
 * Words that make a line in the 'dessert' section a dessert wine and not a
 * course. The same list as the web's `DESSERT_WINE_CUES`
 * (`apps/web/src/lib/firstProof.ts`); a CLAIMS row keeps the two equal.
 * The last four are Turkish, folded (r28 G3): wine, its "of" form ("şarabı"),
 * glass ("kadeh"), bottle ("şişe").
 */
export const DESSERT_WINE_CUES = [
  "wine", "vin", "vino", "glass", "bottle", "sauternes", "barsac", "tokaji", "tokay", "port", "porto",
  "moscato", "muscat", "moscatel", "eiswein", "icewine", "ice wine", "late harvest", "vin santo",
  "vin doux", "pedro ximenez", "pedro ximénez", "madeira", "sherry", "oloroso", "banyuls", "maury",
  "passito", "recioto", "auslese", "beerenauslese", "trockenbeerenauslese", "noble rot",
  "sarap", "sarabi", "kadeh", "sise",
];

/** A cue as a whole word, a vintage year, or a pour size ("75cl", "100 ml"). */
const DESSERT_WINE_WORDS = new RegExp(
  `(^|[^\\p{L}\\p{N}])((${DESSERT_WINE_CUES.join("|")})s?|(19|20)\\d{2}|\\d+\\s?(cl|ml))(?=$|[^\\p{L}\\p{N}])`,
  "u",
);

/** The fields of a stored line that only a drink carries. */
const DRINK_FIELDS = ["vintage", "region", "grape_variety", "producer"] as const;

const filled = (v: unknown) => (typeof v === "string" ? v.trim() !== "" : v !== null && v !== undefined);

/**
 * The same test as the web's `isKitchenLine`. A line in a known drink section
 * (MENU_CATEGORY_VOCABULARY) is never a kitchen line, whatever its raw line
 * says ("Chianti, great with pasta"); otherwise a hint, as a whole word, in the
 * section or in the raw line makes it one.
 *
 * 'dessert' is both a drink section and a course: the reader is told to take
 * the category from the section heading, so "Tiramisu" under "Desserts" can
 * come back as 'dessert'. A 'dessert' line is a drink only on evidence: a
 * field only a drink carries (vintage, region, grape, producer), or in its
 * name or raw line a dessert-wine word, a vintage year or a pour size. With
 * neither it is a course, so it is set aside with the kitchen lines.
 */
export function isKitchenLine(category: unknown, raw: unknown, line?: Record<string, unknown>): boolean {
  const section = typeof category === "string" ? category.toLowerCase().trim() : "";
  const text = typeof raw === "string" ? raw : "";
  if (DESSERT_SECTIONS.includes(foldForHints(section))) {
    if (line && DRINK_FIELDS.some((k) => filled(line[k]))) return false;
    const name = line && typeof line.name === "string" ? line.name : "";
    return !DESSERT_WINE_WORDS.test(foldForHints(`${name} ${text}`));
  }
  // "wine" too, as the web's VOCABULARY holds it.
  if (section === "wine" || (MENU_CATEGORY_VOCABULARY as readonly string[]).includes(section)) return false;
  const hay = foldForHints(`${section} ${text}`);
  return HINT_WORDS.test(hay);
}

/**
 * Whether this token's role may read a line's raw line: its ROLE_POLICY row
 * must see both `money` and `suppliers`, because an unmapped CSV cell can be
 * either. An unknown or missing role reads the staff row (false); `admin`
 * reads the owner row (true).
 */
export function seesRawLine(role: string | null | undefined): boolean {
  const sees = policyFor(role).sees;
  return sees.includes("money") && sees.includes("suppliers");
}

/**
 * One stored line as this viewer is sent it: the allowlisted keys the row
 * has, `kitchen_line` for everyone, and the raw line only when `view.rawLine`.
 * When a stored raw line (a non-empty string) is held back, the line says
 * `raw_line_withheld: true`; a line with no stored raw line says nothing,
 * because there is nothing to withhold. A withheld raw line is a missing key,
 * never a null: null already means "no raw line kept".
 */
export function lineForViewer(row: Record<string, unknown>, view: LineView): Record<string, unknown> {
  const raw = row[RAW_LINE_COLUMN];
  const out: Record<string, unknown> = {};
  for (const key of MEMBER_LINE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(row, key)) out[key] = row[key];
  }
  out.kitchen_line = isKitchenLine(row.category, raw, row);
  // Only when the select read the status: a reader that did not ask for it
  // is not told a reason for a status it never sent.
  if (Object.prototype.hasOwnProperty.call(row, "status")) {
    const flag = flagReasonOf(row.status, row.review_notes);
    out.flag_reason = flag?.reason ?? null;
    out.flag_field = flag?.field ?? null;
  }
  if (view.rawLine) {
    out[RAW_LINE_COLUMN] = raw ?? null;
  } else if (typeof raw === "string" && raw.length > 0) {
    out.raw_line_withheld = true;
  }
  return out;
}
