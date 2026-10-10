/**
 * DoorModel — view-model + language for DoorNext (`/receiving/:orderId/door`).
 *
 * Everything here is pure: normalize what the gateway says about the order,
 * read what the extraction says about the paper, and turn a count into the
 * sentence the receiver sees ("14 of 16 — two short"). Nothing in this file
 * touches the network, and nothing invents a number — an unknown is null and
 * renders as an em dash, never a zero, downstream.
 *
 * The one deliberate unit rule: the door counts BOXES (the founder's loved
 * count), the order may be stated in bottles. The two are only compared when
 * the order's own unit is cases; otherwise the model states both facts side
 * by side and refuses to fake a delta. The single most common receiving
 * "discrepancy" is a unit mismatch, not a real one (document-types.ts says
 * the same on the server side), and the door is the worst place to invent one.
 */

import type { Order } from '@/services/api/types';
import type { UploadedDocument } from '@/services/api/receiving';

export const EM = '—';

/* Type stacks — same faces the other Mudavym pages use. Self-hosted:
   `@font-face` in `styles/mudavym.css` (decision 0149 row 9). */
export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

/** A finite number or null. Guards NaN and the API's occasional string. */
export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/* ── The order, as the door needs it ─────────────────────────────────────── */

export interface DoorOrderVM {
  orderNumber: string | null;
  wineName: string | null;
  providerName: string | null;
  /** Order quantity in the order's own unit. */
  quantity: number | null;
  /** 'cases' | 'bottles' | whatever the gateway stored. Lowercased. */
  unitType: string | null;
  /** Bottle-equivalent total when the gateway knows it. */
  expectedBottles: number | null;
  /** Expected BOXES — only when the order's own unit is cases. Never derived. */
  expectedBoxes: number | null;
}

/**
 * The gateway's GET /procurement/orders/:id returns OrderResponseDto
 * (quantity, unitType, bottlesTotal, wineName, orderNumber…). The web `Order`
 * type used to predate `unitType` / `bottlesTotal`, so both rode in through a
 * widening cast; since 2026-09-05 the shared type IS the DTO's key set and the
 * cast is gone. Read defensively still — an absent field is a null, not a guess.
 *
 * `providerName` is REAL as of 2026-09-05: `getOrder` joins `providers` on
 * `provider_id` in the same statement, so the credit-note letter can address a
 * name instead of the words "the vendor". It is still `string | null` here —
 * the wire distinguishes "joined and found no name" (`null`) from "this route
 * does not join" (key absent), and the door can do nothing different about the
 * two, so both fold to `null` and the letter says the vendor is unnamed rather
 * than pretending one was found.
 */
export function normalizeDoorOrder(raw: Order | null | undefined): DoorOrderVM | null {
  if (!raw || typeof raw !== 'object') return null;
  const loose = raw;
  const quantity = num(loose.quantity);
  const unitType =
    typeof loose.unitType === 'string' && loose.unitType.trim() !== ''
      ? loose.unitType.trim().toLowerCase()
      : null;
  const bottlesTotal = num(loose.bottlesTotal);
  const isCases = unitType !== null && unitType.startsWith('case');
  const isBottles = unitType !== null && unitType.startsWith('bottle');
  return {
    orderNumber: loose.orderNumber ?? null,
    wineName: loose.wineName ?? null,
    providerName:
      typeof loose.providerName === 'string' && loose.providerName.trim() !== ''
        ? loose.providerName.trim()
        : null,
    quantity,
    unitType,
    expectedBottles: bottlesTotal ?? (isBottles ? quantity : null),
    expectedBoxes: isCases ? quantity : null,
  };
}

/* ── The match line — the delta in words, never colour alone ─────────────── */

export type MatchTone = 'even' | 'short' | 'over' | 'incomparable';

export interface MatchLine {
  text: string;
  tone: MatchTone;
  /**
   * counted − expected, in WHOLE boxes. Null when boxes cannot be compared, and
   * null when the difference is not a whole number of boxes — see `deltaBottles`.
   */
  deltaBoxes: number | null;
  /** counted − expected, in bottles, exact. Null when there is no pack to count by. */
  deltaBottles: number | null;
  /** The difference as it is said: "two", "5 bottles", "4 boxes + 5 bottles". */
  deltaWords: string | null;
}

/**
 * What earlier trucks on this order already brought — ADR 0192.
 *
 * In BOTTLES, from the gateway (`GET /procurement/receiving/orders/:id/received`):
 * what the door's own events accepted across every truck (ADR 0062 D3, the model
 * the door books by). NEVER rounded to boxes: five boxes and seven bottles used to be
 * `Math.round(67 / 12)` = "6 earlier", on the match line and in the vendor's
 * credit letter.
 *
 * `'unread'` = the read failed. It is NOT zero: a match line that compared the
 * second truck against the whole order because the first could not be read
 * would accuse the vendor of a shortfall nobody measured.
 */
export interface PriorReceipt {
  bottles: number;
  /** Bottles per box, exact; null when the order states no pack. */
  packSize: number | null;
  /**
   * Bottles refused at the door or at verification on earlier trucks (F-813).
   * They never reach the shelf and no truck is bringing them, so they are off
   * what this order still expects — the same rule as the staff lane (F-774).
   * Absent = none.
   */
  refusedBottles?: number;
}
export type PriorReading = PriorReceipt | 'unread' | null;

/**
 * The door's reading of `GET …/received`, refusals included (F-813). Taken off
 * the order exactly as the staff lane takes them off the backorder
 * (useReceivingNextData.ts `stillExpected`): door refusals, plus the desk's
 * (none when never verified). A ledger that cannot be read leaves the door's
 * refusals unknown — and unknown is `'unread'`, never zero, once any truck was
 * counted. With no door count yet AND no check of the order there is nothing
 * that could have been refused. A truck received on the phone leaves no door
 * count but may have had bottles refused at the desk, so a checked order — or a
 * gateway that does not say — is `'unread'` too (F-861).
 */
export function priorFromReceived(r: {
  receivedQtyBottles?: unknown;
  packSize?: number | null;
  doorEventCount?: unknown;
  checked?: unknown;
  received?: {
    readable?: boolean;
    rejectedAtDoorBottles?: number | null;
    rejectedAtDeskBottles?: number | null;
  } | null;
} | null | undefined): PriorReading {
  if (!r || typeof r.receivedQtyBottles !== 'number' || !Number.isFinite(r.receivedQtyBottles))
    return 'unread';
  const base = { bottles: r.receivedQtyBottles, packSize: r.packSize ?? null };
  const fin = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : null;
  if (r.received?.readable !== true)
    return r.doorEventCount === 0 && r.checked === false ? base : 'unread';
  const atDoor = fin(r.received.rejectedAtDoorBottles);
  const atDesk = r.received.rejectedAtDeskBottles == null ? 0 : fin(r.received.rejectedAtDeskBottles);
  if (atDoor === null || atDesk === null) return 'unread';
  return { ...base, refusedBottles: atDoor + atDesk };
}

/** "11 boxes + 7 bottles", "5 boxes", "7 bottles". Never rounded. */
export function boxesAndBottles(bottles: number, packSize: number): string {
  const boxes = Math.floor(bottles / packSize);
  const loose = bottles - boxes * packSize;
  const b = `${boxes} ${boxes === 1 ? 'box' : 'boxes'}`;
  const l = `${loose} ${loose === 1 ? 'bottle' : 'bottles'}`;
  if (boxes === 0) return l;
  return loose === 0 ? b : `${b} + ${l}`;
}

/** The pack the door counts by: the gateway's, else the order's own exact ratio. */
function doorPack(order: DoorOrderVM, prior: PriorReceipt | null): number | null {
  if (prior?.packSize && prior.packSize >= 1) return prior.packSize;
  if (
    order.expectedBoxes !== null &&
    order.expectedBoxes > 0 &&
    order.expectedBottles !== null &&
    Number.isInteger(order.expectedBottles / order.expectedBoxes)
  )
    return order.expectedBottles / order.expectedBoxes;
  return null;
}

/**
 * The running total against the order, exact. Shared by the match line and the
 * credit letter so the two can never state two different shortfalls.
 */
export function runningAgainstOrder(
  counted: number,
  order: DoorOrderVM,
  prior: PriorReceipt | null,
): {
  expected: number;
  /** "14" when whole boxes, "11 boxes + 7 bottles" when not. */
  running: string;
  /** "8" when whole boxes, "5 boxes + 7 bottles" when not; null with no earlier truck. */
  earlier: string | null;
  /** "1 bottle" refused on earlier trucks and no longer expected; null when none. */
  refused: string | null;
  deltaBoxes: number | null;
  deltaBottles: number | null;
  deltaWords: string;
} | null {
  if (order.expectedBoxes === null) return null;
  const expected = order.expectedBoxes;
  const priorBottles = prior && prior.bottles > 0 ? prior.bottles : 0;
  const refusedBottles = prior?.refusedBottles && prior.refusedBottles > 0 ? prior.refusedBottles : 0;
  if (priorBottles === 0 && refusedBottles === 0) {
    const delta = counted - expected;
    return {
      expected,
      running: String(counted),
      earlier: null,
      refused: null,
      deltaBoxes: delta,
      deltaBottles: null,
      deltaWords: inWords(delta),
    };
  }
  const pack = doorPack(order, prior);
  if (pack === null) return null;
  const runningBottles = counted * pack + priorBottles;
  // A refused bottle is off what is still owed (F-813), so it is not short.
  const deltaBottles = runningBottles + refusedBottles - expected * pack;
  const whole = priorBottles % pack === 0;
  const deltaWhole = deltaBottles % pack === 0;
  return {
    expected,
    running: whole ? String(runningBottles / pack) : boxesAndBottles(runningBottles, pack),
    earlier:
      priorBottles === 0
        ? null
        : whole
          ? String(priorBottles / pack)
          : boxesAndBottles(priorBottles, pack),
    refused:
      refusedBottles === 0
        ? null
        : `${refusedBottles} ${refusedBottles === 1 ? 'bottle' : 'bottles'}`,
    deltaBoxes: deltaWhole ? deltaBottles / pack : null,
    deltaBottles,
    deltaWords: deltaWhole
      ? inWords(deltaBottles / pack)
      : boxesAndBottles(Math.abs(deltaBottles), pack),
  };
}

const SMALL_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];

/** "two", "seven", then digits — the delta is said, not just coloured. */
export function inWords(n: number): string {
  const abs = Math.abs(Math.round(n));
  return abs < SMALL_WORDS.length ? SMALL_WORDS[abs] : String(abs);
}

/**
 * The live line under the count. Spec point 1: the delta as the count is
 * entered — "14 of 16, two short" — while the driver is still there.
 *
 * `prior` is what earlier trucks on this order already brought (ADR 0192), in
 * bottles. Split deliveries are normal in wine, and without it the second
 * truck's six boxes were compared against the WHOLE purchase order and called
 * ten short while the driver stood there — an accusation the paperwork does not
 * support. `null` when nothing has arrived yet, which is the ordinary case.
 * `'unread'` when the read failed: the line says so rather than comparing
 * against the whole order as though nothing had come.
 */
export function matchLine(
  counted: number,
  order: DoorOrderVM | null,
  prior: PriorReading = null,
): MatchLine | null {
  if (!order) return null;
  if (order.expectedBoxes !== null) {
    if (prior === 'unread') {
      return {
        text:
          `${counted} of ${order.expectedBoxes} in this truck — what earlier trucks brought ` +
          `could not be read, so no shortfall is claimed here. The desk matches it.`,
        tone: 'incomparable',
        deltaBoxes: null,
        deltaBottles: null,
        deltaWords: null,
      };
    }
    const r = runningAgainstOrder(counted, order, prior);
    if (r === null) {
      return {
        text:
          `${counted} of ${order.expectedBoxes} in this truck, with ${prior?.bottles ?? 0} bottles ` +
          `from earlier trucks — this order states no bottles per box, so they are matched at a desk.`,
        tone: 'incomparable',
        deltaBoxes: null,
        deltaBottles: null,
        deltaWords: null,
      };
    }
    // Only name the earlier truck when there was one — the ordinary delivery's
    // line must not grow a clause about a second truck that does not exist.
    const total =
      (r.earlier
        ? `${r.running} of ${r.expected} with the earlier ${r.earlier}`
        : `${r.running} of ${r.expected}`) +
      (r.refused ? `, ${r.refused} refused earlier` : '');
    const delta = r.deltaBottles ?? r.deltaBoxes ?? 0;
    const base = { deltaBoxes: r.deltaBoxes, deltaBottles: r.deltaBottles };
    if (delta === 0) {
      return { text: `${total} — all there.`, tone: 'even', ...base, deltaWords: null };
    }
    if (delta < 0) {
      return {
        text: `${total} — ${r.deltaWords} short.`,
        tone: 'short',
        ...base,
        deltaWords: r.deltaWords,
      };
    }
    return {
      text: `${total} — ${r.deltaWords} more than ordered.`,
      tone: 'over',
      ...base,
      deltaWords: r.deltaWords,
    };
  }
  if (order.expectedBottles !== null) {
    // Bottles and boxes do not compare at a door. State both facts, fake no delta.
    return {
      text: `The order says ${order.expectedBottles} bottles — box and bottle counts are matched at a desk.`,
      tone: 'incomparable',
      deltaBoxes: null,
      deltaBottles: null,
      deltaWords: null,
    };
  }
  return null;
}

/* ── What the photograph read ────────────────────────────────────────────── */

export interface PaperReading {
  /** Boxes the paper accounts for, when its lines allow the arithmetic. */
  boxes: number | null;
  /** Bottle-equivalent total across lines, when stated. */
  bottles: number | null;
  docType: string | null;
  docNumber: string | null;
  lineCount: number;
  warnings: number;
  /**
   * The reading may stand in the count box (F-744): a delivery paper, every
   * line read as boxes, and no doubts. Even then the receiver confirms it.
   */
  prefill: boolean;
  /** Why it may not, in the receiver's words. Null when it may, or read nothing. */
  doubt: string | null;
}

/** The papers that say what came off the truck. A credit note or our own order copy does not. */
const DELIVERY_PAPERS = new Set(['invoice', 'packing_slip', 'delivery_note', 'delivery_receipt']);

/**
 * Spec point 2: the photograph does work. The upload response carries the
 * parse (ParsedDocument) so the count can be pre-filled without a second round
 * trip. Lines arrive as `unknown[]` on the web type — read them defensively;
 * a line we cannot read contributes nothing rather than a guess.
 */
export function readPaper(doc: UploadedDocument['document']): PaperReading | null {
  if (!doc) return null;
  const lines = Array.isArray(doc.lines) ? doc.lines : [];
  let boxes = 0;
  let boxesKnown = false;
  let bottles = 0;
  let bottlesKnown = false;
  let unread = 0;
  for (const raw of lines) {
    const l = raw as { qty?: unknown; uom?: unknown; packSize?: unknown; qtyBottles?: unknown };
    const qty = num(l?.qty);
    const uom = typeof l?.uom === 'string' ? l.uom : null;
    const pack = num(l?.packSize);
    const qtyBottles = num(l?.qtyBottles);
    if (qtyBottles !== null) {
      bottles += qtyBottles;
      bottlesKnown = true;
    }
    if (qty !== null && uom !== null && (uom === 'case' || uom === 'pack')) {
      boxes += qty;
      boxesKnown = true;
    } else if (qty !== null && uom === 'bottle' && pack !== null && pack > 1) {
      boxes += qty / pack;
      boxesKnown = true;
    } else {
      // Kegs, liters, split cases, a bottle with no pack: not boxes. They add
      // nothing — and the sum is then not the paper's total.
      unread += 1;
    }
  }
  const docType = typeof doc.docType === 'string' ? doc.docType : null;
  // The money-holder gets the warnings; the door's cut gets only their count.
  const warnings = Array.isArray(doc.warnings)
    ? doc.warnings.length
    : typeof doc.warningCount === 'number'
      ? doc.warningCount
      : 0;
  const boxesRead = boxesKnown && boxes > 0 ? Math.round(boxes) : null;
  const doubt =
    boxesRead === null
      ? null
      : !docType || !DELIVERY_PAPERS.has(docType)
        ? 'this is not a delivery paper'
        : unread > 0
          ? `${unread === 1 ? 'one line is' : `${unread} lines are`} not in boxes`
          : warnings > 0
            ? 'the reading is unsure'
            : null;
  return {
    boxes: boxesRead,
    bottles: bottlesKnown && bottles > 0 ? Math.round(bottles) : null,
    docType,
    docNumber: doc.docNumber ?? null,
    lineCount: lines.length,
    warnings,
    prefill: boxesRead !== null && doubt === null,
    doubt,
  };
}

/* ── Three outcomes, and the credit already drafted ──────────────────────── */

export type DoorOutcome = 'accepted' | 'short' | 'refused';

export const OUTCOME_LABEL: Record<DoorOutcome, string> = {
  accepted: 'Accepted',
  short: 'Short-shipped',
  refused: 'Refused',
};

export type RefusalReason = 'wrong_wine' | 'broken_case' | 'temperature' | 'other';

export const REFUSAL_REASONS: Array<{ id: RefusalReason; label: string }> = [
  { id: 'wrong_wine', label: 'Wrong wine' },
  { id: 'broken_case', label: 'Broken case' },
  { id: 'temperature', label: 'Temperature' },
  { id: 'other', label: 'Something else' },
];

export function refusalLabel(reason: RefusalReason | null): string | null {
  return REFUSAL_REASONS.find((r) => r.id === reason)?.label ?? null;
}

/**
 * Accepted is the default; a short count SUGGESTS short-shipped; refused is
 * always a human's word — no arithmetic can tell a short ship from a case
 * turned away, and a wrong suggestion here becomes a wrong vendor claim.
 */
export function suggestOutcome(match: MatchLine | null): DoorOutcome {
  return match?.tone === 'short' ? 'short' : 'accepted';
}

export interface CreditDraftInput {
  outcome: DoorOutcome;
  reason: RefusalReason | null;
  counted: number;
  order: DoorOrderVM | null;
  hasPhoto: boolean;
  driverName: string;
  initials: string;
  /**
   * What earlier trucks on this order already brought, in bottles (ADR 0192).
   * A credit letter that ignores them claims a shortfall the vendor's own
   * paperwork disproves, which is the fastest way to lose a claim that was
   * otherwise good. `'unread'` = the read failed, and the letter claims no
   * shortfall figure rather than one computed without them.
   */
  alreadyReceived?: PriorReading;
}

/**
 * The words the letter is addressed with when the order cannot name a vendor.
 *
 * Exported so the test asserts the sentence rather than a paraphrase of it, and
 * so nothing here can drift into a bare "the vendor" that reads as though a
 * name had been looked up and found. THIS LETTER LEAVES THE BUILDING: a manager
 * approves and sends it to a distributor, so an unaddressed one has to say it is
 * unaddressed.
 */
export const VENDOR_NOT_NAMED = 'the vendor (not named on this order)';

/**
 * Spec point 4: the credit request already drafted when the short/refusal is
 * saved. Drafted here in --calm — plain sentences, no heat — and explicitly
 * UNSENT: the receiver never writes an email, a manager approves this later.
 *
 * The vendor is named from the wire's `providerName` (2026-09-05). Before that
 * key existed this line read "To the vendor" on every order the door had ever
 * opened — a letter about money, addressed to nobody.
 */
export function creditDraft(input: CreditDraftInput): string | null {
  const { outcome, reason, counted, order, hasPhoto, driverName, initials } = input;
  if (outcome === 'accepted') return null;
  const vendor = order?.providerName ?? VENDOR_NOT_NAMED;
  const orderRef = order?.orderNumber ? `order ${order.orderNumber}` : 'this order';
  const wine = order?.wineName ? ` (${order.wineName})` : '';
  const expected = order?.expectedBoxes;
  const prior = input.alreadyReceived ?? null;

  // The same arithmetic as the match line, so the letter and the screen can
  // never state two different shortfalls. Exact: bottles, never a rounded box.
  const r =
    order && prior !== 'unread' ? runningAgainstOrder(counted, order, prior) : null;
  const short = (() => {
    if (expected === null || expected === undefined)
      return `arrived ${counted} boxes — short of what was ordered`;
    if (prior === 'unread')
      return (
        `arrived ${counted} boxes against an order of ${expected}; what earlier trucks ` +
        `brought could not be read at the door, so the shortfall is left to the invoice match`
      );
    if (!r) return `arrived ${counted} boxes — short of what was ordered`;
    const refused = r.refused ? `, ${r.refused} refused earlier` : '';
    return r.earlier
      ? `arrived ${counted} boxes, ${r.running} of ${r.expected} boxes${refused} — ${r.deltaWords} short at the door`
      : r.refused
        ? `arrived ${counted} of ${r.expected} boxes${refused} — ${r.deltaWords} short at the door`
        : `arrived ${counted} of ${r.expected} boxes — ${r.deltaWords} short at the door`;
  })();

  const what =
    outcome === 'short'
      ? short
      : `was refused at the door${reason ? ` — ${refusalLabel(reason)?.toLowerCase()}` : ''}`;

  const evidence = hasPhoto
    ? ' The delivery paperwork was photographed at the door and is attached.'
    : '';
  const driver = driverName.trim() ? ` The driver present was ${driverName.trim()}.` : '';
  const signed = initials.trim() ? ` Received and signed by ${initials.trim().toUpperCase()}.` : '';

  return (
    `To ${vendor}: ${orderRef}${wine} ${what}.` +
    `${evidence}${driver}${signed}` +
    ` Please credit the difference against the invoice.`
  );
}

/* ── The notes field — free prose, and nothing else ──────────────────────── */

export interface DoorNotesInput extends CreditDraftInput {
  broken: number;
  match: MatchLine | null;
}

/**
 * The gateway's `notes` column is `@MaxLength(500)`, and `doorOutbox.ts` treats
 * a 4xx as PERMANENT — so one character too many is not a retry, it is a
 * receiver who cannot save the delivery at all while a driver waits.
 *
 * MEASURED, before this changed: the fixed skeleton of a short-shipped note was
 * 344 characters (every name empty, one-character driver and initials), leaving
 * ~156 for a provider name, a wine name, an order number and a driver name. A
 * real distributor and a real Bordeaux —
 * "Southern Glazer's Wine & Spirits of New York, LLC" and
 * "Château Pichon Longueville Comtesse de Lalande, Pauillac 2ème Cru Classé
 * 2016" — measured 546. Blocked, permanently, with no way through.
 *
 * Two things fix it, and only the second one is a guarantee:
 *
 *  1. outcome, reason, counted, expected, broken, signedBy and driver are now
 *     COLUMNS on procurement_receipt_events, so the structured half of the blob
 *     is gone from here entirely;
 *  2. every remaining interpolated name is clamped to a budget, and the whole
 *     string is clamped after composition. The bound is structural — it does
 *     not depend on anyone re-doing the arithmetic when a sentence changes.
 *
 * MEASURED after: skeleton 259, worst case with every budget saturated 449, and
 * the same distributor-plus-Bordeaux pair that produced 546 now produces 431.
 */
export const NOTES_MAX = 500;
/** Room under the cap for the clamp's own ellipsis and any future sentence. */
const NOTES_BUDGET = 480;

const VENDOR_MAX = 60;
const WINE_MAX = 60;
const ORDER_REF_MAX = 32;
const DRIVER_MAX = 40;

/** Trim to `max`, ending on a word where one is near, and say it was trimmed. */
export function clamp(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The credit request, drafted at the door — the one thing here that is prose and
 * has no column. Everything structured travels as a field now.
 */
export function composeDoorNotes(input: DoorNotesInput): string {
  const draft = creditDraft({
    ...input,
    order: input.order && {
      ...input.order,
      providerName: input.order.providerName && clamp(input.order.providerName, VENDOR_MAX),
      wineName: input.order.wineName && clamp(input.order.wineName, WINE_MAX),
      orderNumber: input.order.orderNumber && clamp(input.order.orderNumber, ORDER_REF_MAX),
    },
    driverName: clamp(input.driverName, DRIVER_MAX),
  });
  if (!draft) return '';
  return clamp(`credit-draft (unsent): ${draft}`, NOTES_BUDGET);
}

/* ── The structured facts — columns now, not prose ───────────────────────── */

/**
 * What the door knows, in the shape the gateway stores it.
 *
 * `expectedQtyInCountedUom` and `rejectedQtyInCountedUom` carry their unit in
 * their names, because the door counts BOXES and the server converts to bottles:
 * a quantity that crossed this boundary without saying what it was is precisely
 * how a refused delivery came to book stock.
 */
export interface DoorFacts {
  outcome: DoorOutcome;
  refusalReason: RefusalReason | null;
  signedByInitials: string | null;
  driverName: string | null;
  expectedQtyInCountedUom: number | null;
  rejectedQtyInCountedUom: number;
}

/**
 * What THIS truck is expected to bring, in boxes: the order less what earlier
 * trucks brought (F-468) and less what was refused on them (F-813). Sending the whole order announced the truck that
 * completes a split delivery as "arrived short" by the earlier trucks' bottles,
 * while this screen said it was complete. Exact, never rounded — a remainder
 * that is not whole boxes travels as the fraction it is. Null when the earlier
 * trucks could not be read, or cannot be put in boxes: no expectation is better
 * than one that accuses the vendor of a shortfall nobody measured.
 */
export function stillExpectedBoxes(order: DoorOrderVM, prior: PriorReading): number | null {
  if (order.expectedBoxes === null) return null;
  if (prior === 'unread') return null;
  const refused = prior?.refusedBottles && prior.refusedBottles > 0 ? prior.refusedBottles : 0;
  if (!prior || (prior.bottles <= 0 && refused === 0)) return order.expectedBoxes;
  const pack = doorPack(order, prior);
  if (pack === null) return null;
  return Math.max(0, order.expectedBoxes * pack - Math.max(0, prior.bottles) - refused) / pack;
}

export function doorFacts(input: DoorNotesInput): DoorFacts {
  return {
    outcome: input.outcome,
    refusalReason: input.outcome === 'refused' ? input.reason : null,
    signedByInitials: input.initials.trim() ? input.initials.trim().toUpperCase().slice(0, 8) : null,
    driverName: input.driverName.trim() ? clamp(input.driverName, 120) : null,
    // Only when the order's own unit is cases. `expectedBoxes` is already null
    // otherwise — normalizeDoorOrder never derives it — and a null here is the
    // door declining to state an expectation it cannot compare against.
    expectedQtyInCountedUom: input.order
      ? stillExpectedBoxes(input.order, input.alreadyReceived ?? null)
      : null,
    // A refusal takes nothing in; otherwise only the visibly broken. Both in
    // BOXES, the unit the door counts in, which is what the field name says.
    rejectedQtyInCountedUom: input.outcome === 'refused' ? input.counted : input.broken,
  };
}
