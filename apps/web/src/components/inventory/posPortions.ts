/**
 * What one POS sale of a good can be, offered from what the house stated about
 * the good and never from a stand-in (r24 pos-portions).
 *
 * The answer chosen here is saved on the mapping and is what moves stock, so
 * each offer is one the depletion can carry out right:
 *
 *  - A WHOLE CONTAINER (a bottle, a can, a piece) is sent as sale_unit
 *    "bottle" with NO volume. The gateway books that as one unit off the shelf
 *    (pos-hub.service.ts resolveSaleVolume, step 2) without reading a size, so
 *    it is right whether or not the size is known, and stays right when a size
 *    is set or corrected later. It is offered only when one stock unit is one
 *    container: a good kept by the bottle or by the piece. "bottle" is the one
 *    whole-unit label the gateway derives; the button says the house's word.
 *  - A POUR (a glass, a shot) is a draw out of an open bottle
 *    (record_glass_pour), which needs what the bottle holds and what one pour
 *    is. Both must be stated: the item's own bottle size (the RPC reads that
 *    column, else 750), and a confirmed pour (the item's own, or for a wine the
 *    house's). Otherwise the button says "size not known" and cannot be chosen.
 *
 * Which shapes a good can be sold in follows its kind: a soft drink is a whole
 * bottle or can, never a glass; a wine is a bottle or a glass; a spirit is a
 * bottle or a shot; a beer is a bottle or can, or a glass off a keg.
 */

/** The facts the gateway reads off the item (inventory/portion-facts.ts). */
export interface PortionFacts {
  kind: string | null;
  uom: string | null;
  bottleMl: number | null;
  pourMl: number | null;
}

export interface PortionOffer {
  /** What the button says. */
  text: string;
  /** pos_item_mappings.sale_unit. */
  saleUnit: "bottle" | "glass" | "shot";
  /** pos_item_mappings.sale_volume_ml: null for a whole container. */
  saleVolumeMl: number | null;
  shape: "whole" | "pour";
  /** null when it can be chosen; otherwise why it cannot. */
  blocked: string | null;
}

export interface Portions {
  offers: PortionOffer[];
  /** Said beside the row when some sale shape cannot be offered at all. */
  note: string | null;
}

const POUR_WORD: Record<string, "glass" | "shot"> = {
  wine: "glass",
  sake: "glass",
  cider: "glass",
  beer: "glass",
  spirit: "shot",
  whiskey: "shot",
  liqueur: "shot",
};

/** Drinks that come as a bottle or a can. */
const BOTTLE_OR_CAN = new Set(["beer", "cider", "soft_drink", "non_alcoholic"]);

const KEPT_IN: Record<string, string> = {
  case: "by the case",
  pack: "by the pack",
  ml: "by volume",
  l: "by volume",
  g: "by weight",
  mg: "by weight",
  kg: "by weight",
  glass: "by the glass",
  shot: "by the shot",
};

function positive(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The offers for one good. `housePourMl` is the house's CONFIRMED pour, or
 * null when it is not confirmed or could not be read; only a wine uses it.
 */
export function portionsFor(
  facts: PortionFacts | null | undefined,
  housePourMl: number | null,
): Portions {
  if (!facts || !facts.uom) {
    return {
      offers: [],
      note: "What this item is kept in could not be read, so no sale size is offered.",
    };
  }
  const kind = facts.kind ?? "other";
  const uom = facts.uom;
  const bottleMl = positive(facts.bottleMl);
  const offers: PortionOffer[] = [];

  if (uom === "bottle") {
    const word = BOTTLE_OR_CAN.has(kind) ? "Bottle or can" : "Bottle";
    offers.push({
      text: bottleMl !== null ? `${word} ${bottleMl}ml` : `${word} · size not known`,
      saleUnit: "bottle",
      saleVolumeMl: null,
      shape: "whole",
      blocked: null,
    });
  } else if (uom === "each") {
    offers.push({ text: "One piece", saleUnit: "bottle", saleVolumeMl: null, shape: "whole", blocked: null });
  }

  const pourWord = POUR_WORD[kind];
  // A beer by the bottle is a whole bottle; a glass of beer comes off a keg.
  const pours = pourWord && (uom === "keg" || (uom === "bottle" && kind !== "beer"));
  if (pours) {
    const Word = pourWord === "glass" ? "Glass" : "Shot";
    const container = uom === "keg" ? "keg" : "bottle";
    const pourMl = positive(facts.pourMl) ?? (kind === "wine" ? positive(housePourMl) : null);
    let blocked: string | null = null;
    if (bottleMl === null) {
      blocked = `This item does not say what one ${container} holds. A ${pourWord} is poured out of one, so set its size on the item first; until then a ${pourWord} sale queues and moves no stock.`;
    } else if (pourMl === null) {
      blocked =
        kind === "wine"
          ? "Neither this wine's pour nor the house's pour is confirmed. Confirm the pour first; until then a glass sale queues and moves no stock."
          : `This item's ${pourWord} size is not confirmed. Confirm its pour on the item first; until then a ${pourWord} sale queues and moves no stock.`;
    } else if (pourMl > bottleMl) {
      blocked = `The confirmed pour (${pourMl}ml) is more than one ${container} holds (${bottleMl}ml).`;
    }
    offers.push({
      text: bottleMl !== null && pourMl !== null ? `${Word} ${pourMl}ml` : `${Word}: size not known`,
      saleUnit: pourWord,
      saleVolumeMl: blocked === null ? pourMl : null,
      shape: "pour",
      blocked,
    });
  }

  let note: string | null = null;
  if (offers.length === 0) {
    note = KEPT_IN[uom]
      ? `This item is kept ${KEPT_IN[uom]}, so one sale is not one unit of its stock. Keep it by the bottle or by the piece to count its sales.`
      : "No sale size fits how this item is kept.";
  }
  return { offers, note };
}
