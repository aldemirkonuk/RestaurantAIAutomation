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

/* Type stacks — same faces the other Mudavym pages use. Fraunces is injected
   by ensureDoorFraunces below (same link id as dashboard/next, so whichever
   page runs first wins and the other is a no-op). */
export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

const FRAUNCES_LINK_ID = 'mudavym-fraunces';

export function ensureDoorFraunces(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(FRAUNCES_LINK_ID)) return;
  const link = document.createElement('link');
  link.id = FRAUNCES_LINK_ID;
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..680;1,9..144,300..680&display=swap';
  document.head.appendChild(link);
}

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
 * `providerName` went with the cast: the DTO carries `providerId` and no vendor
 * name, so that field was `undefined` on every order this door has ever opened.
 * The door names the vendor from nothing else, so it now says so.
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
    providerName: null,
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
  /** counted − expected, in boxes. Null when boxes cannot be compared. */
  deltaBoxes: number | null;
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
 * `alreadyReceivedBoxes` is what earlier trucks on this order already brought.
 * Split deliveries are normal in wine, and without it the second truck's six
 * boxes were compared against the WHOLE purchase order and called ten short
 * while the driver stood there — an accusation the paperwork does not support.
 * Zero when nothing has arrived yet, which is the ordinary case and the shape
 * every existing caller had.
 */
export function matchLine(
  counted: number,
  order: DoorOrderVM | null,
  alreadyReceivedBoxes = 0,
): MatchLine | null {
  if (!order) return null;
  if (order.expectedBoxes !== null) {
    const expected = order.expectedBoxes;
    const prior = Math.max(0, Math.round(alreadyReceivedBoxes));
    const running = counted + prior;
    const delta = running - expected;
    // Only name the earlier truck when there was one — the ordinary delivery's
    // line must not grow a clause about a second truck that does not exist.
    const total = prior > 0 ? `${running} of ${expected} with the earlier ${prior}` : `${counted} of ${expected}`;
    if (delta === 0) {
      return { text: `${total} — all there.`, tone: 'even', deltaBoxes: 0 };
    }
    if (delta < 0) {
      return {
        text: `${total} — ${inWords(delta)} short.`,
        tone: 'short',
        deltaBoxes: delta,
      };
    }
    return {
      text: `${total} — ${inWords(delta)} more than ordered.`,
      tone: 'over',
      deltaBoxes: delta,
    };
  }
  if (order.expectedBottles !== null) {
    // Bottles and boxes do not compare at a door. State both facts, fake no delta.
    return {
      text: `The order says ${order.expectedBottles} bottles — box and bottle counts are matched at a desk.`,
      tone: 'incomparable',
      deltaBoxes: null,
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
}

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
    if (qty !== null && uom !== null) {
      if (uom === 'case' || uom === 'pack') {
        boxes += qty;
        boxesKnown = true;
      } else if (uom === 'bottle' && pack !== null && pack > 1) {
        boxes += qty / pack;
        boxesKnown = true;
      }
      // Kegs, liters, split cases: not boxes. Contribute nothing.
    }
  }
  return {
    boxes: boxesKnown && boxes > 0 ? Math.round(boxes) : null,
    bottles: bottlesKnown && bottles > 0 ? Math.round(bottles) : null,
    docType: typeof doc.docType === 'string' ? doc.docType : null,
    docNumber: doc.docNumber ?? null,
    lineCount: lines.length,
    warnings: Array.isArray(doc.warnings) ? doc.warnings.length : 0,
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
   * Boxes earlier trucks on this order already brought. A credit letter that
   * ignores them claims a shortfall the vendor's own paperwork disproves, which
   * is the fastest way to lose a claim that was otherwise good.
   */
  alreadyReceivedBoxes?: number;
}

/**
 * Spec point 4: the credit request already drafted when the short/refusal is
 * saved. Drafted here in --calm — plain sentences, no heat — and explicitly
 * UNSENT: the receiver never writes an email, a manager approves this later.
 */
export function creditDraft(input: CreditDraftInput): string | null {
  const { outcome, reason, counted, order, hasPhoto, driverName, initials } = input;
  if (outcome === 'accepted') return null;
  const vendor = order?.providerName ?? 'the vendor';
  const orderRef = order?.orderNumber ? `order ${order.orderNumber}` : 'this order';
  const wine = order?.wineName ? ` (${order.wineName})` : '';
  const expected = order?.expectedBoxes;

  const prior = Math.max(0, Math.round(input.alreadyReceivedBoxes ?? 0));
  const running = counted + prior;
  const arrived =
    prior > 0 ? `arrived ${counted} boxes, ${running} of` : `arrived ${counted} of`;

  const what =
    outcome === 'short'
      ? expected !== null && expected !== undefined
        ? `${arrived} ${expected} boxes — ${inWords(running - expected)} short at the door`
        : `arrived ${counted} boxes — short of what was ordered`
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

export function doorFacts(input: DoorNotesInput): DoorFacts {
  return {
    outcome: input.outcome,
    refusalReason: input.outcome === 'refused' ? input.reason : null,
    signedByInitials: input.initials.trim() ? input.initials.trim().toUpperCase().slice(0, 8) : null,
    driverName: input.driverName.trim() ? clamp(input.driverName, 120) : null,
    // Only when the order's own unit is cases. `expectedBoxes` is already null
    // otherwise — normalizeDoorOrder never derives it — and a null here is the
    // door declining to state an expectation it cannot compare against.
    expectedQtyInCountedUom: input.order?.expectedBoxes ?? null,
    // A refusal takes nothing in; otherwise only the visibly broken. Both in
    // BOXES, the unit the door counts in, which is what the field name says.
    rejectedQtyInCountedUom: input.outcome === 'refused' ? input.counted : input.broken,
  };
}
