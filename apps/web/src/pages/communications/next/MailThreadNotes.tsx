/**
 * The house's notes on a thread (r110 mail-gap g5; Front's internal comments,
 * Help Scout's notes). A note sits in time order between the letters, on the
 * paper-2 ground, and says it was not sent. It is never part of a letter: the
 * composer, its preview and the seal read only `messages` (answerFor), and a
 * note lives in `notes`.
 *
 * Motion (MOTIONS.md, ADR 0112): a new note takes mail-fade-in, opacity 0 to 1
 * over 180 ms on cubic-bezier(0.16, 1, 0.3, 1). Deleting is instant, with no
 * exit animation. Under reduced motion nothing animates.
 */
import { useState } from 'react';
import { type InfiniteData, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../services/api/client';
import { MONO, fmtWhen } from './cm-format';
import { prefersReducedMotion } from './mail-motion';
import { mailKeys, useHouse } from './useMailData';
import type { MailThreadNote, MailThreadPage } from './mail-format';

export const NOTE_MAX = 1000;

/** "Note from Ayşe · not sent": who wrote it, and that it never left the house. */
export function noteLabel(n: MailThreadNote): string {
  const name = n.writtenBy.name?.trim();
  return `Note from ${name || 'someone in the house'} · not sent`;
}

/**
 * Rows and notes in time order: a note goes before the first row whose time
 * is later than the note's, and after every row as old or older. A folded
 * stack is timed by its first letter, so a note never hides inside a fold.
 */
export function withNotes<T>(
  rows: T[],
  timeOf: (r: T) => string,
  notes: MailThreadNote[],
): Array<{ kind: 'row'; r: T } | { kind: 'note'; n: MailThreadNote }> {
  const ms = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : 0;
  };
  const sorted = notes.slice().sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  const out: Array<{ kind: 'row'; r: T } | { kind: 'note'; n: MailThreadNote }> = [];
  let i = 0;
  for (const r of rows) {
    const at = ms(timeOf(r));
    while (i < sorted.length && ms(sorted[i]!.createdAt) < at) out.push({ kind: 'note', n: sorted[i++]! });
    out.push({ kind: 'row', r });
  }
  while (i < sorted.length) out.push({ kind: 'note', n: sorted[i++]! });
  return out;
}

/** What a failed note write says, in the gateway's words when it gave some. */
export function noteFailWords(err: unknown, deleting: boolean): string {
  const res = (err as { response?: { status?: unknown; data?: { message?: unknown } } } | null)?.response;
  if (typeof res?.status !== 'number') return 'No answer. Check the connection; nothing was changed.';
  if (typeof res.data?.message === 'string' && res.status < 500) return res.data.message;
  return deleting
    ? 'The note could not be deleted just now, so it is still there. Try again.'
    : 'The note could not be saved just now, so nothing changed. Try again.';
}

type Pages = InfiniteData<MailThreadPage, string | null>;

/** POST a note; it shows at once on the newest page, then the thread is read again. */
export function useAddNote(threadKey: string, withKey: string | null) {
  const house = useHouse();
  const qc = useQueryClient();
  return useMutation<MailThreadNote, unknown, { person: string; body: string }>({
    mutationFn: async ({ person, body }) =>
      (
        await apiClient.post<MailThreadNote>(`/mail/threads/${encodeURIComponent(threadKey)}/notes`, { body }, {
          params: { with: person },
        })
      ).data,
    onSuccess: (note) => {
      qc.setQueryData<Pages>(mailKeys.thread(house, threadKey, withKey ?? ''), (cur) => {
        const first = cur?.pages[0];
        if (!cur || !first || (first.notes ?? []).some((n) => n.id === note.id)) return cur;
        return { ...cur, pages: [{ ...first, notes: [...(first.notes ?? []), note] }, ...cur.pages.slice(1)] };
      });
      void qc.invalidateQueries({ queryKey: ['mail-thread', house] });
    },
  });
}

/** DELETE the caller's own note: it leaves the screen at once, with no exit motion. */
export function useDeleteNote(threadKey: string) {
  const house = useHouse();
  const qc = useQueryClient();
  return useMutation<unknown, unknown, string>({
    mutationFn: async (id) =>
      (await apiClient.delete(`/mail/threads/${encodeURIComponent(threadKey)}/notes/${encodeURIComponent(id)}`)).data,
    onMutate: (id) => {
      qc.setQueriesData<Pages>({ queryKey: ['mail-thread', house] }, (cur) =>
        cur ? { ...cur, pages: cur.pages.map((p) => ({ ...p, notes: (p.notes ?? []).filter((n) => n.id !== id) })) } : cur,
      );
    },
    // A failed delete reads the thread again, which puts the note back.
    onSettled: () => qc.invalidateQueries({ queryKey: ['mail-thread', house] }),
  });
}

export function NoteItem({
  note,
  entering,
  onDelete,
}: {
  note: MailThreadNote;
  /** Arrived after the thread was first drawn: it fades in, unless motion is reduced. */
  entering: boolean;
  onDelete?: () => void;
}) {
  return (
    <li
      data-testid="mail-note"
      data-note-id={note.id}
      className={entering && !prefersReducedMotion() ? 'mail-note-in' : undefined}
      style={{
        listStyle: 'none',
        background: 'var(--paper-2, #EAE4D8)',
        borderRadius: 8,
        padding: '8px 12px',
        display: 'grid',
        gap: 4,
      }}
    >
      <div className="flex flex-wrap items-baseline gap-2" style={{ fontSize: 12 }}>
        <span data-testid="mail-note-label" style={{ fontWeight: 600, color: 'var(--ink-2, #4F473C)' }}>
          {noteLabel(note)}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-4, #665D50)' }}>{fmtWhen(note.createdAt)}</span>
        {onDelete && (
          <button
            type="button"
            data-testid="mail-note-delete"
            onClick={onDelete}
            aria-label="Delete this note"
            style={{ minHeight: 44, margin: '-14px 0 -14px auto', background: 'none', border: 0, padding: '0 6px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--seal-deep, #14515C)' }}
          >
            Delete
          </button>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-1, #211C16)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {note.body}
      </p>
    </li>
  );
}

/** The owner's or manager's note box, under the thread. Its words are never a letter's. */
export function NoteWriter({ onKeep, pending }: { onKeep: (body: string) => Promise<unknown>; pending: boolean }) {
  const [body, setBody] = useState('');
  const words = body.trim();
  return (
    <form
      data-testid="mail-note-writer"
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!words || words.length > NOTE_MAX || pending) return;
        void onKeep(words).then(() => setBody(''), () => undefined);
      }}
    >
      <label htmlFor="mail-note-body" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2, #4F473C)' }}>
        A note for the house · not sent
      </label>
      <textarea
        id="mail-note-body"
        data-testid="mail-note-body"
        value={body}
        maxLength={NOTE_MAX}
        rows={2}
        onChange={(e) => setBody(e.target.value)}
        style={{ fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--rule, rgba(33,28,22,.14))', background: 'var(--paper-2, #EAE4D8)', resize: 'vertical' }}
      />
      <button
        type="submit"
        data-testid="mail-note-keep"
        disabled={!words || pending}
        className="max-sm:min-h-[44px]"
        style={{ justifySelf: 'start', fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--rule, rgba(33,28,22,.14))', background: 'transparent', color: 'var(--seal-deep, #14515C)', cursor: 'pointer' }}
      >
        {pending ? 'Keeping…' : 'Keep note'}
      </button>
    </form>
  );
}
