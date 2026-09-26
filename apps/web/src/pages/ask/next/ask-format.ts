/**
 * ask-format — the pure half of `/ask` (ADR 0145; sketch 114 direction A, the
 * Reading Room, with B's trail, as recorded in ADR 0145's 2026-09-25
 * amendment).
 *
 * Everything the page says about a folio is decided here, from the saved
 * folio alone, so a test can hold every reply kind without a browser. Three
 * rules carry through (ADR 0051):
 *
 *   - an unknown figure is the em dash, never 0; a measured 0 prints `0`;
 *   - a count withheld from the asking role is said to be withheld, never
 *     printed as 0 or left blank (ADR 0145 round 6, "Hide by data type");
 *   - a refusal carries the SERVER's own line. The page never writes its own
 *     reason for a role refusal, because the rule lives in code on the
 *     gateway ("Rules in code, label rows"), not here.
 *
 * Copied type stack and Fraunces loader, per the page-directory rule that
 * Mudavym pages do not import from one another (hp-format.ts header).
 */

import axios from 'axios';
import type { AskCell, AskCount, AskFinding, AskFolio, AskReading, AskReply, AskTrace } from '@/services/api/ask';

const LINK_ID = 'mudavym-fraunces';

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const SANS = '"DM Sans", "Plus Jakarta Sans", system-ui, sans-serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

export const EM = '—';

export function ensureFraunces(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(LINK_ID)) return;
  const link = document.createElement('link');
  link.id = LINK_ID;
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..680;1,9..144,300..680&display=swap';
  document.head.appendChild(link);
}

/* ───────────────────────────────────────────── the shelf ──── */

export interface ShelfGroup {
  key: 'stock' | 'orders' | 'house';
  title: string;
  readings: AskReading[];
}

/**
 * Sketch 114 A's three register groups. The grouping is by the reading id's
 * register prefix, so a reading the gateway adds lands in a group without a
 * client change; the catalogue itself is already filtered to the asking role
 * by the gateway (`bound-ask.controller.ts` `catalogue`).
 */
export function groupShelf(readings: readonly AskReading[]): ShelfGroup[] {
  const groups: ShelfGroup[] = [
    { key: 'stock', title: 'Stock', readings: [] },
    { key: 'orders', title: 'Orders & receipts', readings: [] },
    { key: 'house', title: 'Sales, calendar, vendors, targets', readings: [] },
  ];
  for (const r of readings) {
    const register = r.id.split('.')[0];
    if (register === 'inventory') groups[0].readings.push(r);
    else if (register === 'orders' || register === 'receipts' || register === 'documents') groups[1].readings.push(r);
    else groups[2].readings.push(r);
  }
  return groups.filter((g) => g.readings.length > 0);
}

/** What a reading needs before it can be read: a subject, a period, both, or nothing. */
export function readingNeeds(r: Pick<AskReading, 'subject' | 'window'>): { subject: boolean; window: boolean } {
  return { subject: r.subject !== 'none', window: r.window };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A client-side check that says what is missing in words; the gateway re-checks everything. */
export function composerProblem(
  r: Pick<AskReading, 'subject' | 'window'>,
  input: { subjectText: string; from: string; to: string },
): string | null {
  const needs = readingNeeds(r);
  if (needs.subject && !input.subjectText.trim()) {
    return r.subject === 'order' ? 'Name the order first — its number is enough.' : 'Name the item first.';
  }
  if (needs.window) {
    if (!ISO_DAY.test(input.from) || !ISO_DAY.test(input.to)) return 'Give the period as two dates.';
    if (input.from > input.to) return 'The period ends before it starts.';
  }
  return null;
}

/* ───────────────────────────────────────────── a figure ──── */

export function fmtValue(cell: Pick<AskCell, 'value' | 'unit'>): string {
  const v = cell.value;
  if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return EM;
  const body = typeof v === 'boolean' ? (v ? 'yes' : 'no') : typeof v === 'number' ? v.toLocaleString() : String(v);
  return cell.unit ? `${body} ${cell.unit}` : body;
}

/** The provenance mark under a figure (sketch 114, "cells carry two axes"). Null = stated, no mark. */
export function provenanceMark(p: AskCell['provenance']): string | null {
  switch (p) {
    case 'defaulted':
      return 'assumed — a default nobody in the house set';
    case 'derived':
      return 'computed from rows';
    case 'not_recorded':
      return 'not recorded';
    default:
      return null;
  }
}

/** The focus cells of a reading reply, resolved inside its Finding; an id that does not resolve is dropped, never invented. */
export function focusCells(finding: AskFinding, focus: ReadonlyArray<{ cellId: string }>): AskCell[] {
  const byId = new Map<string, AskCell>();
  for (const row of finding.rows ?? []) for (const cell of row.cells ?? []) byId.set(cell.id, cell);
  const out: AskCell[] = [];
  for (const f of focus) {
    const cell = byId.get(f.cellId);
    if (cell) out.push(cell);
  }
  return out;
}

/* ───────────────────────────────────────────── what was read ──── */

export const WITHHELD = 'withheld_for_your_role';

export function fmtCount(n: AskCount): string {
  if (n === WITHHELD) return 'count withheld for your role';
  if (typeof n !== 'number' || !Number.isFinite(n)) return EM;
  return n.toLocaleString();
}

export function traceLine(t: AskTrace): string {
  if (t.outcome === 'withheld') return `${t.relation} · read · count withheld for your role`;
  if (t.outcome === 'failed') return `${t.relation} · did not answer${t.failureCode ? ` · ${t.failureCode}` : ''}`;
  return `${t.relation} · ${fmtCount(t.rowsScanned)} scanned · ${fmtCount(t.matchedRows)} matched`;
}

/* ───────────────────────────────────────────── a folio, in words ──── */

const REASON_LINE: Record<string, string> = {
  empty_register: 'Nothing is recorded in this register yet.',
  missing_subject: 'This reading needs a subject. Name the item or the order.',
  ambiguous_subject: 'More than one record matches. Pick the one you meant.',
  subject_not_found: 'No record in the house matches that name.',
  missing_window: 'This reading needs a period: a start date and an end date.',
  invalid_window: 'The period could not be read. Give it as two dates.',
  missing_unit: 'The item has no recorded unit, so no quantity is claimed.',
  missing_verified_link: 'No verified receipt line is linked to this item.',
  missing_currency_provenance: "The receipt's currency is not recorded, so no price is claimed.",
  missing_pack: 'The pack size is not recorded, so no bottle count is claimed.',
  query_failed: 'A source did not answer.',
  invalid_source_result: 'A source answered in a shape Mudavym could not read.',
  scope_mismatch: 'A row came back from outside this house and was refused.',
  source_changed: 'The source changed while it was being read.',
  source_limit: 'The register is larger than one reading can scan.',
  unrecorded_figure: 'A figure this reading needs is not recorded.',
  unknown_reading_version: 'That version of the reading no longer exists.',
  unsupported_recurrence: 'A repeating calendar entry uses a pattern Mudavym cannot expand yet.',
  unimplemented_question: 'Mudavym has not built an answer to this kind of question yet.',
  no_matching_question: 'No reading of the house answers this, and it is not a general-knowledge question.',
  undeclared_field: 'The reading tried to show a field it does not declare, and was stopped.',
};

const MODEL_FAILURE_LINE: Record<string, string> = {
  model_unavailable: 'The model did not answer, so nothing was written. Nothing here is a fact about the house.',
  spend_ceiling:
    "The house's AI allowance for today is used up. Nothing was sent and nothing was charged. It resets at midnight UTC.",
  invalid_model_reply: "The model answered, but the answer failed Mudavym's checks, so it is not shown.",
  role_share_used: "Your role's share of today's AI allowance is used up. Nothing was sent.",
  allowance_unreadable:
    "Today's AI allowance could not be checked, so nothing was sent. A check that fails is never read as nothing spent.",
};

const KIND_TITLE: Record<AskReply['kind'], string> = {
  reading: 'Read from the house’s books',
  model_knowledge: 'Not from the house’s books',
  could_not_answer: 'No answer was written',
  not_permitted: 'Not for your role',
  clarify: 'Which one did you mean?',
  not_built: 'Not built yet',
  no_reading_matched: 'No reading answers this',
  requirements_unsatisfied: 'The books lack what this reading needs',
  not_in_your_books: 'None in the house’s books',
  could_not_read: 'Could not read',
};

/** The short chip a folio carries in the book. */
export const KIND_CHIP: Record<AskReply['kind'] | 'pending', string> = {
  reading: 'answered',
  model_knowledge: 'not from the books',
  could_not_answer: 'no answer',
  not_permitted: 'not for your role',
  clarify: 'needs a pick',
  not_built: 'not built',
  no_reading_matched: 'no reading',
  requirements_unsatisfied: 'needs records',
  not_in_your_books: 'none in the books',
  could_not_read: 'could not read',
  pending: 'still answering',
};

export type FolioTone = 'answer' | 'knowledge' | 'refused' | 'stopped' | 'pending' | 'clarify';

export interface FolioView {
  tone: FolioTone;
  title: string;
  /** One sentence, the server's own where it sent one. Null when the figures ARE the answer. */
  line: string | null;
  figures: AskCell[];
  finding: AskFinding | null;
  knowledge: string | null;
  choices: Array<{ id: string; label: string }>;
}

export function folioView(folio: Pick<AskFolio, 'status' | 'answer'>): FolioView {
  const empty = { figures: [], finding: null, knowledge: null, choices: [] };
  const answer = folio.answer;
  if (folio.status === 'pending' || !answer) {
    return {
      ...empty,
      tone: 'pending',
      title: 'Still being answered',
      line: 'The question is saved. Check again in a moment to see the answer.',
    };
  }
  switch (answer.kind) {
    case 'reading':
      return {
        ...empty,
        tone: 'answer',
        title: KIND_TITLE.reading,
        line: null,
        figures: focusCells(answer.finding, answer.focus ?? []),
        finding: answer.finding,
      };
    case 'model_knowledge':
      return { ...empty, tone: 'knowledge', title: answer.sourceLabel || KIND_TITLE.model_knowledge, line: null, knowledge: answer.text };
    case 'not_permitted':
      return { ...empty, tone: 'refused', title: KIND_TITLE.not_permitted, line: answer.line };
    case 'could_not_answer':
      return {
        ...empty,
        tone: 'stopped',
        title: KIND_TITLE.could_not_answer,
        line: MODEL_FAILURE_LINE[answer.reason] ?? `No answer was written (${answer.reason}).`,
        finding: answer.finding ?? null,
      };
    default: {
      const line = answer.line ?? REASON_LINE[answer.reason] ?? null;
      const choices = answer.kind === 'clarify' ? answer.finding?.choices ?? [] : [];
      return {
        ...empty,
        tone: answer.kind === 'clarify' ? 'clarify' : 'stopped',
        title: KIND_TITLE[answer.kind] ?? answer.kind,
        line,
        finding: answer.finding ?? null,
        choices,
      };
    }
  }
}

export function folioChip(folio: Pick<AskFolio, 'status' | 'reply_kind'>): string {
  if (folio.status === 'pending' || !folio.reply_kind) return KIND_CHIP.pending;
  return KIND_CHIP[folio.reply_kind] ?? folio.reply_kind;
}

/* ───────────────────────────────────────────── the book ──── */

/** The gateway's window on the book: `reading-folio.store.ts` `list` reads `.limit(50)`. */
export const BOOK_WINDOW = 50;

export interface BookDay {
  key: string;
  heading: string;
  folios: AskFolio[];
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function groupBook(folios: readonly AskFolio[], now: Date = new Date()): BookDay[] {
  const today = dayKey(now);
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const yesterday = dayKey(y);
  const days: BookDay[] = [];
  for (const f of folios) {
    const t = new Date(f.created_at);
    const key = Number.isNaN(t.getTime()) ? 'undated' : dayKey(t);
    let day = days.find((d) => d.key === key);
    if (!day) {
      const heading =
        key === 'undated'
          ? 'Date not recorded'
          : key === today
            ? 'Today'
            : key === yesterday
              ? 'Yesterday'
              : t.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
      day = { key, heading, folios: [] };
      days.push(day);
    }
    day.folios.push(f);
  }
  return days;
}

export function fmtClock(iso: string | null | undefined): string {
  if (!iso) return 'time not recorded';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return 'time not recorded';
  return t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/* ───────────────────────────────────────────── a request that failed ──── */

export type AskFailureKind = 'not_open' | 'too_fast' | 'timeout' | 'unreached' | 'refused' | 'rejected' | 'unavailable' | 'failed';

export interface AskFailure {
  kind: AskFailureKind;
  message: string;
  /** Re-sending the SAME request id is safe: the gateway returns the saved folio and never pays twice. */
  checkAgain: boolean;
}

/** The gateway's launch gate says exactly this (`bound-ask.service.ts`, `ASK_LAUNCHED`). */
export const NOT_LAUNCHED_MESSAGE = 'Ask has not launched yet.';

function serverMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const m = (data as { message?: unknown }).message;
  if (typeof m === 'string' && m.trim()) return m;
  if (Array.isArray(m) && m.length && typeof m[0] === 'string') return m.join(' ');
  if (m && typeof m === 'object' && typeof (m as { message?: unknown }).message === 'string') return (m as { message: string }).message;
  return null;
}

export function askFailure(error: unknown): AskFailure {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? null;
    const said = serverMessage(error.response?.data);
    if (status === null) {
      if (error.code === 'ECONNABORTED' || /timeout/i.test(error.message)) {
        return {
          kind: 'timeout',
          message: 'No answer within 60 seconds. The question is saved; check again to see where it stands.',
          checkAgain: true,
        };
      }
      return {
        kind: 'unreached',
        message: 'The request did not come back. If it reached Mudavym the question is saved; checking again never asks it twice.',
        checkAgain: true,
      };
    }
    if (status === 503 && said === NOT_LAUNCHED_MESSAGE) {
      return {
        kind: 'not_open',
        message: 'Ask has not opened yet. Nothing was asked and nothing was spent.',
        checkAgain: false,
      };
    }
    if (status === 429) {
      return {
        kind: 'too_fast',
        message: `${said ?? 'Too many questions at once.'} Each person may ask 10 a minute; the house, 200 an hour.`,
        checkAgain: false,
      };
    }
    if (status === 401 || status === 403) {
      return { kind: 'refused', message: `Refused: ${said ?? 'this account may not ask here.'}`, checkAgain: false };
    }
    if (status === 400 || status === 404 || status === 409) {
      return { kind: 'rejected', message: said ?? 'The question was not accepted.', checkAgain: false };
    }
    if (status === 503) {
      return { kind: 'unavailable', message: said ?? 'Ask could not answer right now.', checkAgain: true };
    }
    return { kind: 'failed', message: said ?? `The request failed (${status}).`, checkAgain: false };
  }
  return { kind: 'failed', message: error instanceof Error ? error.message : 'The request failed.', checkAgain: false };
}

/** A read of the shelf or the book that failed, in words; never drawn as an empty shelf or an empty book. */
export function readFailure(error: unknown): string {
  const f = askFailure(error);
  return f.message;
}

/* ───────────────────────────────────────────── a question's id ──── */

/** A v4 UUID (the gateway's `@IsUUID()` requestId), from the platform's CSPRNG. */
export function newRequestId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (!c || typeof c.getRandomValues !== 'function') throw new Error('This browser cannot make a question id.');
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
