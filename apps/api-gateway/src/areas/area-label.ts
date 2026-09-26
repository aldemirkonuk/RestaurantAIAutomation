/**
 * The AREA LABEL an alert, a recommendation or a notification can carry
 * (ADR 0218).
 *
 * The founder, 2026-09-21: *"no areas for now, but they have labels,
 * classifcation responsible for each so different alerts different
 * notifications for different areas. but if you say their are first is better
 * I'd agree"*. So the label is the unit: a thing carries at most one of the
 * six kinds below, or none. **None means house-wide**, and a house-wide thing
 * reaches everyone exactly as it did before this file existed.
 *
 * WHY A CLOSED SET OF KINDS, AND NOT FREE TEXT
 * --------------------------------------------
 * A rule catalogue (another lane owns it) has to name an area in code that
 * ships to every house. If the vocabulary were each house's own words, a rule
 * could only point at a string one house typed. So the KIND is fixed and typed
 * here, and a house changes only what the kind is CALLED ("Garde manger" for
 * `kitchen`) and whether it is switched on (`house_areas`). A renamed area keeps
 * its kind, so a label written against `kitchen` still finds it.
 *
 * The six are the founder's list as the lane brief carries it. `dish` from the
 * research taxonomy is folded into `kitchen` (a three-person house has no dish
 * pit of its own); see the ADR's rejected alternatives.
 */

export const AREA_KINDS = [
  "kitchen",
  "bar",
  "floor",
  "cellar",
  "receiving",
  "management",
] as const;

export type AreaKind = (typeof AREA_KINDS)[number];

/**
 * What a labelled thing carries. `null` is house-wide: nobody's area, so
 * everybody's — never "unknown", never "unrouted".
 */
export type AreaLabel = AreaKind | null;

/** The name a kind goes by until a house renames it. */
export const AREA_DEFAULT_NAMES: Readonly<Record<AreaKind, string>> = {
  kitchen: "Kitchen",
  bar: "Bar",
  floor: "Floor",
  cellar: "Cellar",
  receiving: "Receiving",
  management: "Management",
};

/** The longest name a house may give an area (`house_areas.name`). */
export const AREA_NAME_MAX = 40;

export function isAreaKind(value: unknown): value is AreaKind {
  return (
    typeof value === "string" && (AREA_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Read a label off untyped data (a notification's metadata, a request body).
 *
 * Anything that is not one of the six kinds reads as house-wide. That is the
 * direction that cannot lose an alert: a mistyped label widens the audience to
 * the whole house, it never narrows it to nobody.
 */
export function readAreaLabel(value: unknown): AreaLabel {
  return isAreaKind(value) ? value : null;
}
