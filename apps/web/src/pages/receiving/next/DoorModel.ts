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
 * (quantity, unitType, bottlesTotal, wineName, orderNumber…); the web `Order`
 * type predates unitType/bottlesTotal, so those ride in untyped. Read them
 * defensively — a missing field is a null, not a guess.
 */
export function normalizeDoorOrder(raw: Order | null | undefined): DoorOrderVM | null {
  if (!raw || typeof raw !== 'object') return null;
  const loose = raw as Order & { unitType?: unknown; bottlesTotal?: unknown };
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
    providerName: loose.providerName ?? null,
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
 */
export function matchLine(counted: number, order: DoorOrderVM | null): MatchLine | null {
  if (!order) return null;
  if (order.expectedBoxes !== null) {
    const expected = order.expectedBoxes;
    const delta = counted - expected;
    if (delta === 0) {
      return { text: `${counted} of ${expected} — all there.`, tone: 'even', deltaBoxes: 0 };
    }
    if (delta < 0) {
      return {
        text: `${counted} of ${expected} — ${inWords(delta)} short.`,
        tone: 'short',
        deltaBoxes: delta,
      };
    }
    return {
      text: `${counted} of ${expected} — ${inWords(delta)} more than ordered.`,
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

  const what =
    outcome === 'short'
      ? expected !== null && expected !== undefined
        ? `arrived ${counted} of ${expected} boxes — ${inWords(counted - expected)} short at the door`
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

/* ── The notes field — everything the schema has no column for ───────────── */

export interface DoorNotesInput extends CreditDraftInput {
  broken: number;
  match: MatchLine | null;
}

/**
 * The door endpoint stores `notes` verbatim on the receipt event. Outcome,
 * reason, signature and the drafted credit ride there — structured enough to
 * grep, readable enough for the desk that verifies the receipt.
 */
export function composeDoorNotes(input: DoorNotesInput): string {
  const parts: string[] = [`[door] outcome=${input.outcome}`];
  if (input.reason && input.outcome === 'refused') parts.push(`reason=${input.reason}`);
  parts.push(`counted=${input.counted} boxes`);
  const expected = input.order?.expectedBoxes;
  if (expected !== null && expected !== undefined) parts.push(`expected=${expected} boxes`);
  if (input.broken > 0) parts.push(`broken=${input.broken}`);
  if (input.initials.trim()) parts.push(`signedBy=${input.initials.trim().toUpperCase()}`);
  if (input.driverName.trim()) parts.push(`driver=${input.driverName.trim()}`);
  const head = parts.join('; ');
  const draft = creditDraft(input);
  return draft ? `${head}\ncredit-draft (unsent): ${draft}` : head;
}
