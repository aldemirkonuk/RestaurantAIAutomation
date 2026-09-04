/**
 * The docket — the page's top-level filing, by THE ACT YOUR HANDS PERFORM.
 *
 * The founder, fourth pass (2026-09-03): *"the need is that we need to
 * everything in a categorized classified section in order for people to
 * understand what to do as action"*. Sketch 094b answered it and was chosen:
 * the book is filed by what a person physically does, not by the register the
 * change lands in and not by when the rule fired.
 *
 * ── Why this is a THIRD axis and not the register renamed ──────────────────
 * The page already had two classifications and neither is this one:
 *
 *   the register (`rec-format.ts` `stakeOf`)   what acting on it would CHANGE
 *   the hand     (`rec-format.ts` `handOf`)    the SURFACE the work lands on
 *   the act      (here)                        what the person DOES
 *
 * They disagree, and the disagreement is the reason the docket exists. The
 * Wednesday shortfall changes MONEY (the register) and is sent to the Reports
 * page (the hand) — but the thing a manager does with it is stand in front of
 * the floor before service. Filing by either of the older axes puts it in a
 * section of things that are not the same job. Nine sittings collapse to five.
 *
 * ── Nothing here is a measurement ──────────────────────────────────────────
 * Every row below is a CLASSIFICATION of a rule that already fired, read off
 * that rule's own `recommendation` sentence in
 * `apps/api-gateway/src/analytics/recommendations.service.ts:150-372`. Each
 * carries the sentence fragment it was read from, so the filing is checkable
 * rather than asserted, and a rule this file does not know lands in `unfiled`
 * ON PURPOSE — a new rule must appear as unfiled rather than be absorbed into
 * a heading it was never sorted into.
 *
 * ── The money a section is worth ───────────────────────────────────────────
 * It is not here, and it is not anywhere. The engine states each entry's money
 * INSIDE its sentence (`$14,820` in "Purchasing spend is up 38% …"), formatted
 * for reading; there is no `moneyAtStake` field on a recommendation. Summing a
 * column of sentences would mean parsing figures whose meanings differ per rule
 * — spend is not exposure, capital locked is not margin foregone — so every
 * section shows an em dash and says why. §9 of the page note files the gateway
 * field that would fix it.
 */

import { EM } from './rec-format';

export type ActId = 'order' | 'price' | 'stock' | 'vendor' | 'floor' | 'unfiled';

/** The docket's sections, top to bottom. Tonight's work first, slowest last. */
export const ACT_ORDER: ActId[] = ['order', 'price', 'stock', 'vendor', 'floor', 'unfiled'];

/** The headings, verbatim from sketch 094b. */
export const ACT_LABEL: Record<ActId, string> = {
  order: 'Order it',
  price: 'Price it',
  stock: 'Move stock',
  vendor: 'Call a vendor',
  floor: 'Brief the floor',
  unfiled: 'Not yet filed',
};

/** What doing the whole section looks like — one sitting, described. */
export const ACT_SAY: Record<ActId, string> = {
  order:
    'These end in a purchase order. Doing them is one sitting at the Orders desk: draft what is short, then walk the open book against days-of-cover before the next run goes out.',
  price:
    'These change what something sells for — a list price, an offer, a pairing on the insert. All of them are a menu decision and all of them want the same half hour.',
  stock:
    'These are about bottles standing still. The act is the same in each: put a wine in front of a guest who was not going to be offered it.',
  vendor:
    'These need a supplier on the phone, not a screen. It is the slowest act on this page and the one most often postponed, which is why it gets its own heading rather than a chip.',
  floor:
    'These are things people are told before service. A third of what this engine produces is a sentence for a pre-shift, and it was previously scattered across every other section.',
  unfiled:
    'A rule whose prescription is not one of the five acts. Shown here rather than absorbed into a heading it was never sorted into.',
};

interface ActFiling {
  act: ActId;
  /** Why it is filed here, read off the rule's own prescription. */
  why: string;
}

/**
 * Rule → act.
 *
 * The quoted fragment in each `why` is the rule's own `recommendation` string
 * in `recommendations.service.ts`; that sentence, not the category, is what a
 * person's hands would follow.
 */
const RULE_ACT: Record<string, ActFiling> = {
  stockout_imminent: {
    act: 'order',
    why: 'The rule says “Place the order today — reorder point is N bottles”. The act is a purchase order.',
  },
  spend_acceleration: {
    act: 'order',
    why: 'The rule says “Audit open orders against days-of-cover before the next PO run”. The act is done in the open order book.',
  },
  revenue_concentration: {
    act: 'order',
    why: 'The rule says “Protect the top sellers’ stock first (raise their service level to 98%)” — the act is buying deeper cover on the wines the room actually drinks. Its second half, spreading demand with pairing prompts, is a floor act; the first is what it leads with.',
  },
  plowhorse_repricing: {
    act: 'price',
    why: 'The rule says “Raise those prices 5–8% or renegotiate cost on the next PO”. The act is a price change.',
  },
  pairing_promotion: {
    act: 'price',
    why: 'The rule says “Print that pairing on the menu insert”. A menu insert is a pricing decision, though this rule’s hand is Promotions — a judgement, stated, rather than a rule.',
  },
  weekday_gap: {
    act: 'price',
    why: 'The rule says “test a <weakest day>-only offer (corkage-free, flight special)”. The lever it prescribes is a day-specific offer; its other half — moving training, deliveries and counts into the trough — is a calendar act this docket has no heading for.',
  },
  dead_stock_capital: {
    act: 'stock',
    why: 'The rule says “Build a weekend flight or staff-pick feature from the top three idle wines”. The act is moving bottles that are standing still.',
  },
  puzzle_activation: {
    act: 'stock',
    why: 'The rule says “Put one puzzle wine by-the-glass this week”. The act is putting a bottle in front of a guest.',
  },
  vendor_concentration: {
    act: 'vendor',
    why: 'The rule says “Request quotes from one alternative vendor … and move 10–20% of volume”. Nothing on a screen closes it; a supplier has to be called.',
  },
  sales_below_weekday_baseline: {
    act: 'floor',
    why: 'The rule says “brief the floor on top-margin picks … pair your strongest server with the weakest section”. The act happens at a pre-shift, though this rule’s hand is Reports — the hand keys on the rule’s category (sales), not on what a person does.',
  },
  weekly_demand_slide: {
    act: 'floor',
    why: 'The rule says “Schedule a staff tasting … and add a pairing prompt to the specials script”. Both halves are things people are told.',
  },
  staff_spread: {
    act: 'floor',
    why: 'The rule says “Have the top seller run a 15-minute pre-shift on their pitch”. The act is a pre-shift.',
  },
};

/** The prefix the goal-behind family uses — one rule per goal already set. */
const GOAL_RULE_PREFIX = 'goal_behind';

const GOAL_BEHIND_FILING: ActFiling = {
  act: 'unfiled',
  why: `This entry asks you to “pick the single biggest lever from the insight feed” — a choice, not an act. It is left unfiled rather than pushed under a heading, because none of the five is what your hands would do next ${EM} the lever it points at will have its own entry, under its own act.`,
};

const UNKNOWN_FILING = (ruleKey: string): ActFiling => ({
  act: 'unfiled',
  why: `This page has no act filed for the rule ${ruleKey}. A rule it does not recognise is shown here rather than sorted into a heading by guesswork.`,
});

export function actOf(ruleKey: string): ActFiling {
  if (ruleKey.startsWith(GOAL_RULE_PREFIX)) return GOAL_BEHIND_FILING;
  return RULE_ACT[ruleKey] ?? UNKNOWN_FILING(ruleKey);
}

/**
 * What a section is worth — and why the answer is an em dash.
 *
 * Stated per section rather than once at the top, because a heading that shows
 * a count and nothing else reads as "worth nothing" at a glance. The words are
 * short on the heading and the full reason is one paragraph above the docket.
 */
export const MONEY_WITHHELD = `${EM} at stake · not carried`;

export const MONEY_WITHHELD_WHY =
  'No section can total what it is worth. The engine states each entry’s money inside its sentence, not as a field, and the figures are not the same quantity from rule to rule — spend accelerating is not exposure, and capital locked in idle stock is not margin foregone. Adding them would invent a number, so every heading shows an em dash instead of a zero.';

/**
 * The heading the page cannot fill, drawn rather than left out.
 *
 * Sketch 094b: the founder's own fifth heading. No rule threshold can be tuned
 * from anywhere in the product — they are constants inside
 * `recommendations.service.ts` — and the only feedback the engine takes from a
 * manager is a dismissal, which silences a finding rather than moving a
 * threshold. Rendered dark, with the reason, because the absence is the
 * interesting part: the refusals this page already stores are exactly the
 * evidence a tuning surface would run on.
 */
export const CHANGE_A_RULE = {
  label: 'Change a rule',
  why: 'Nothing behind this yet. No rule can be tuned from anywhere in the product: the thresholds are constants in the gateway’s recommendations service, and the only feedback the engine takes from a manager is a dismissal — which silences a finding rather than moving a threshold. The reasons stored with your dismissals are the evidence a tuning surface would run on.',
  control: 'Retune the rule',
};
