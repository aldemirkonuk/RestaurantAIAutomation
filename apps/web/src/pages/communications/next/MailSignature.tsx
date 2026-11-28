/**
 * A signature per sending address (r110 mail-gap g3), an owner's or a
 * manager's. The composer puts it in the body as "\n\n-- \n<signature>",
 * sealed with it; it is never added at send time.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../services/api/client';
import { useHouse } from './useMailData';
import { ACT, ALERT, QUIET } from './MailSetupParts';

export const SIGNATURE_MAX = 600;
const URL = '/communications/letters/signature';

export interface SignatureRead {
  address: string;
  body: string | null;
  updatedAt: string | null;
}

export const signatureKey = (house: string, address: string) =>
  ['house-letter-signature', house, address.toLowerCase()] as const;

export async function readSignature(address: string): Promise<SignatureRead> {
  return (await apiClient.get<SignatureRead>(URL, { params: { address } })).data;
}

export function signatureBlock(signature: string | null | undefined): string {
  return signature && signature.trim() ? `\n\n-- \n${signature}` : '';
}

/** Swap the sheet's block for `next`. null: the sheet owns no block, touch nothing. '': add `next` at the end. */
export function swapSignature(body: string, block: string | null, next: string): { body: string; block: string } | null {
  if (block === null) return null;
  if (block === '') return { body: next ? body.replace(/\s+$/, '') + next : body, block: next };
  if (!body.endsWith(block)) return null;
  return { body: body.slice(0, body.length - block.length) + next, block: next };
}

/** The words above an untouched block: what the person wrote. */
export function wordsAbove(body: string, block: string | null): string {
  return block && body.endsWith(block) ? body.slice(0, body.length - block.length) : body;
}

/** Change the words above an untouched block, keeping the block where it is. */
export function aboveSignature(body: string, block: string | null, change: (words: string) => string): string {
  return block && body.endsWith(block) ? change(body.slice(0, body.length - block.length)) + block : change(body);
}

function failWords(err: unknown, address: string): string {
  const status = (err as { response?: { status?: unknown } } | null)?.response?.status;
  if (typeof status !== 'number') return 'No answer. Check the connection, then try again. Nothing was saved.';
  if (status === 404) return `This house does not send from ${address} any more. Nothing was saved.`;
  if (status === 403) return 'Only an owner or a manager of this house can change the signature. Nothing was saved.';
  if (status === 400) return `A signature is at most ${SIGNATURE_MAX} characters. Nothing was saved.`;
  return 'The signature could not be saved; try again.';
}

/** MailSetup's "Signature for <address>". Save shows what the server stored, read back. */
export function SignatureEditor({ address }: { address: string }) {
  const house = useHouse();
  const qc = useQueryClient();
  const key = signatureKey(house, address);
  const q = useQuery<SignatureRead>({ queryKey: key, queryFn: () => readSignature(address), enabled: Boolean(house), retry: false });
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation<SignatureRead, unknown, string>({
    mutationFn: async (body) => (await apiClient.put<SignatureRead>(URL, { address, body })).data,
    onSuccess: (stored) => {
      qc.setQueryData(key, stored);
      setDraft(null);
      setSaved(true);
    },
  });
  const stored = q.data?.body ?? '';
  const value = draft ?? stored;
  const id = `sig-${address}`;
  return (
    <form
      className="grid gap-1.5"
      data-testid="setup-signature"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        save.mutate(value);
      }}
    >
      <label htmlFor={id} style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1, #211C16)', overflowWrap: 'anywhere' }}>
        Signature for {address}
      </label>
      {q.isError ? (
        <p role="alert" data-testid="setup-signature-unread" style={ALERT}>
          The signature could not be read. That does not mean there is none.
        </p>
      ) : null}
      <textarea
        id={id}
        rows={4}
        maxLength={SIGNATURE_MAX}
        value={value}
        disabled={!q.isSuccess || save.isPending}
        onChange={(e) => {
          setSaved(false);
          setDraft(e.target.value);
        }}
        style={{
          width: '100%',
          maxWidth: '68ch',
          fontSize: 13,
          lineHeight: 1.5,
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid var(--paper-2, #EAE4D8)',
          background: 'var(--paper-0, #FAF7F1)',
          color: 'var(--ink-1, #211C16)',
          resize: 'vertical',
        }}
      />
      <p style={QUIET}>
        {value.length}/{SIGNATURE_MAX}. A new letter from this address starts with it below the words; it can be changed
        in the letter before it is sent.
      </p>
      <span className="flex flex-wrap items-center gap-3">
        <button type="submit" style={ACT} disabled={!q.isSuccess || save.isPending || value === stored}>
          {save.isPending ? 'Saving…' : 'Save the signature'}
        </button>
        <span role="status" aria-live="polite" data-testid="setup-signature-saved" className={saved ? 'mail-fade-in' : undefined} style={QUIET}>
          {saved ? (stored ? 'Saved.' : 'Saved: no signature.') : ''}
        </span>
      </span>
      {save.isError && (
        <p role="alert" data-testid="setup-signature-failed" style={ALERT}>
          {failWords(save.error, address)}
        </p>
      )}
    </form>
  );
}
