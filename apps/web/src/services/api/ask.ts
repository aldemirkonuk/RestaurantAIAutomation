/**
 * Ask — the web client for the bound `/ask` routes (ADR 0145), served by
 * `apps/api-gateway/src/ask-ai/bound-ask.controller.ts`.
 *
 * Four calls. None of them sends a restaurant or a role: the gateway reads
 * both from the token (`req.user.restaurantId`, `req.user.role`), so a client
 * field could only be ignored or, worse, trusted. The role gate is the
 * server's — a question a role may not have answered comes back as a saved
 * `not_permitted` folio carrying its own one-line reason, never as a 503.
 *
 * The types mirror the gateway's on the wire and nothing more:
 * `ask-readings/reading.types.ts` (Finding, BoundCell, SourceTrace),
 * `ask-readings/bound-reply.ts` (BoundReply) and
 * `ask-readings/reading-folio.store.ts` (ReadingFolio). A field the page does
 * not read is left off rather than guessed.
 */

import { apiClient } from './client';

/** ADR 0145 fork 1, answered 2026-09-12: a 60 s client budget, on `/ask` only. */
export const ASK_CLIENT_BUDGET_MS = 60_000;

export interface AskReading {
  id: string;
  version: number;
  title: string;
  question: string;
  subject: 'item' | 'order' | 'none';
  window: boolean;
  meaning: string;
}

export interface AskReadingArgs {
  subjectId?: string;
  subjectText?: string;
  from?: string;
  to?: string;
}

export type AskProvenance = 'stated' | 'defaulted' | 'derived' | 'not_recorded';

export interface AskCell {
  id: string;
  key: string;
  label: string;
  value: string | number | boolean | null;
  unit: string | null;
  provenance: AskProvenance;
}

export interface AskFindingRow {
  key: string;
  cells: AskCell[];
}

/** `withheld_for_your_role` stands where a count the asking role may not see would be. */
export type AskCount = number | null | 'withheld_for_your_role';

export interface AskTrace {
  relation: string;
  outcome: 'rows' | 'empty' | 'failed' | 'withheld';
  rowsScanned: AskCount;
  matchedRows: AskCount;
  asOf: string;
  failureCode?: string;
}

export interface AskFinding {
  readingId: string;
  readingVersion: number;
  outcome: string;
  reason: string | null;
  asOf: string;
  trace: AskTrace[];
  rows: AskFindingRow[];
  choices?: Array<{ id: string; label: string }>;
}

export type AskReply =
  | { kind: 'reading'; finding: AskFinding; focus: Array<{ cellId: string }> }
  | { kind: 'model_knowledge'; sourceLabel: string; text: string }
  | { kind: 'could_not_answer'; reason: string; finding?: AskFinding }
  | { kind: 'not_permitted'; reason: string; line: string; readingId?: string }
  | {
      kind:
        | 'clarify'
        | 'not_built'
        | 'no_reading_matched'
        | 'requirements_unsatisfied'
        | 'not_in_your_books'
        | 'could_not_read';
      reason: string;
      finding?: AskFinding;
      line?: string;
    };

export interface AskFolio {
  id: string;
  origin: 'page' | 'panel' | 'standing';
  utterance: string;
  status: 'pending' | 'complete' | 'failed';
  reading_id: string | null;
  reading_version: number | null;
  reading_args: AskReadingArgs;
  reply_kind: AskReply['kind'] | null;
  answer: AskReply | null;
  failure_reason: string | null;
  previous_folio_id: string | null;
  created_at: string;
  completed_at: string | null;
  reading_chosen_by: 'page' | 'model' | null;
  pick_model: string | null;
  compose_model: string | null;
}

export interface AskSubmit {
  /** One id per question: re-sending it returns the saved folio instead of paying twice. */
  requestId: string;
  utterance: string;
  readingId?: string;
  readingVersion?: number;
  args?: AskReadingArgs;
  previousFolioId?: string;
}

export const askApi = {
  async catalogue(): Promise<AskReading[]> {
    const { data } = await apiClient.get<{ readings: AskReading[] }>('/ask/catalogue');
    if (!data || !Array.isArray(data.readings)) throw new Error('The catalogue answered in a shape this page cannot read.');
    return data.readings;
  },

  /** The newest 50 of this person's asks in this house (`reading-folio.store.ts` `list`, `.limit(50)`). */
  async folios(): Promise<AskFolio[]> {
    const { data } = await apiClient.get<AskFolio[]>('/ask/folios');
    if (!Array.isArray(data)) throw new Error('The book answered in a shape this page cannot read.');
    return data;
  },

  async folio(id: string): Promise<AskFolio> {
    const { data } = await apiClient.get<AskFolio>(`/ask/folios/${encodeURIComponent(id)}`);
    return data;
  },

  /**
   * `origin` is where the ask was typed: the `/ask` page, or the Ask panel
   * (the gateway's `BoundAskDto` has accepted `'panel'` since the bound ask
   * was built; the panel is the first caller to send it).
   */
  async submit(input: AskSubmit, origin: 'page' | 'panel' = 'page'): Promise<AskFolio> {
    const { data } = await apiClient.post<AskFolio>(
      '/ask/folios',
      { ...input, origin },
      { timeout: ASK_CLIENT_BUDGET_MS },
    );
    return data;
  },
};

export default askApi;
