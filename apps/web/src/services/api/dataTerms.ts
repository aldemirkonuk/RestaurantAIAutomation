/**
 * The house's data-and-privacy terms — what turns Jev on (ADR 0207 rounds 4
 * and 5). Three routes, all already built and gated on the gateway
 * (`settings.controller.ts`, `HouseDataTermsService`): reading is open to any
 * member of the house; sealing and accepting are owner only.
 */

import { apiClient } from './client';

export type DataTermStatementKind = 'fact' | 'term';

export interface DataTermStatement {
  key: string;
  kind: DataTermStatementKind;
  text: string;
  evidence: string[];
}

export interface DataTermsSubprocessor {
  name: string;
  host: string;
  what: string;
  when: string;
  masked: boolean;
}

export interface DataTermsAcceptance {
  version: number;
  acceptedAt: string;
  acceptedBy: { userId: string | null; name: string | null };
}

export interface DataTermsReadout {
  readable: boolean;
  reason: string | null;
  version: number;
  digest: string;
  statements: DataTermStatement[];
  subprocessors: DataTermsSubprocessor[];
  changedSince: Record<string, string[]>;
  acceptance: DataTermsAcceptance | null;
  /** The HOUSE: true only when some owner has accepted THIS `version`. */
  current: boolean;
  /**
   * The READER: whether the person reading has accepted THIS `version`
   * themselves (ADR 0207 question 19, "Every owner, next sign-in"). Absent
   * from a gateway older than this field; `null` when the read names no one.
   */
  yours?: { current: boolean } | null;
  jev: { enabled: boolean; effective: boolean; pausedBecause: string | null };
}

export interface DataTermsAcceptanceReceipt {
  accepted: true;
  version: number;
  switchTurnedOn: boolean;
  /**
   * `turned_on`: the house's first acceptance, which turns Jev on.
   * `left_as_it_was`: the house had accepted before; the switch is unchanged.
   * `failed`: recorded, but the switch could not be turned on.
   */
  switch?: 'turned_on' | 'left_as_it_was' | 'failed';
  audited: boolean;
  auditReason: string | null;
}

function spokenMessage(error: unknown): string | null {
  const m = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return typeof m === 'string' && m.trim() ? m : null;
}

function promote(error: unknown): never {
  const spoken = spokenMessage(error);
  if (spoken && error instanceof Error) error.message = spoken;
  throw error;
}

export async function getDataTerms(): Promise<DataTermsReadout> {
  const { data } = await apiClient.get<DataTermsReadout>('/settings/data-terms');
  return data;
}

/**
 * Owner only. Minted at the moment the hold BEGINS (ADR 0107 addendum) — the
 * same "redeemed, never asserted" shape every other sealed act in this
 * codebase uses. Returns null rather than throwing when the gateway refuses
 * to mint (not an owner, no restaurant on the session): the hold then says
 * the seal could not be issued and nothing is sent, same as `HoldToApprove`'s
 * own contract for a failed `onChallenge`.
 */
export async function issueDataTermsSealChallenge(): Promise<string | null> {
  try {
    const { data } = await apiClient.post<{ challenge: string; expiresAt: string }>(
      '/settings/data-terms/seal-challenge',
    );
    return data?.challenge ?? null;
  } catch (error) {
    promote(error);
  }
}

export async function acceptDataTerms(
  version: number,
  digest: string,
  challenge: string | null,
): Promise<DataTermsAcceptanceReceipt> {
  try {
    const { data } = await apiClient.post<DataTermsAcceptanceReceipt>(
      '/settings/data-terms/acceptances',
      { version, digest },
      { headers: challenge ? { 'x-seal-challenge': challenge } : undefined },
    );
    return data;
  } catch (error) {
    promote(error);
  }
}

export const dataTermsApi = {
  getDataTerms,
  issueDataTermsSealChallenge,
  acceptDataTerms,
};

export default dataTermsApi;
