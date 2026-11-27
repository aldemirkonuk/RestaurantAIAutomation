import { useEffect, useRef, type RefObject } from 'react';

/**
 * "Read again" for a failed Mail read (r107 mail-gap g1). A failed read used to
 * print its sentence and stop; recovery was a reload. The button asks the same
 * query again. While it asks it reads "Reading…" and says it is busy with
 * aria-disabled (not `disabled`, which would drop keyboard focus mid-read); no
 * spinner and no motion.
 */
export function RetryRead({
  testId,
  busy,
  onRetry,
  onClick,
}: {
  testId: string;
  busy: boolean;
  onRetry: () => void;
  /** Called on a press, so the owner can send focus to the list once it draws. */
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-disabled={busy || undefined}
      onClick={() => {
        if (busy) return;
        onClick?.();
        onRetry();
      }}
      style={{
        background: 'none',
        border: 0,
        padding: 0,
        cursor: busy ? 'default' : 'pointer',
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--seal-deep, #14515C)',
      }}
    >
      {busy ? 'Reading…' : 'Read again'}
    </button>
  );
}

/**
 * The failed state of a read, kept through "Read again". react-query turns a
 * data-less errored query back to "pending" while it asks again, which would
 * swap the sentence (and the button) for "Reading…" at once; held, the sentence
 * and its "Reading…" button stay until the answer lands, so the page does not
 * jump. Focus stays on the button until it unmounts, then moves to `target`,
 * only after a press: a read that recovers by itself takes nothing.
 *
 * The failure belongs to the read that failed. `key` names it (the query's own
 * identity: the search, the filter, the thread); a read under a different key,
 * which starts with no data and no error while it is in flight, is not that
 * failure, and the page must not go on saying the old one about it.
 */
export function useReadAgain(
  q: { data: unknown; isError: boolean; isFetching: boolean; error: unknown },
  target: RefObject<HTMLElement | null>,
  key = '',
) {
  const held = useRef<{ key: string; error: unknown } | null>(null);
  if (q.data) held.current = null;
  else if (q.isError) held.current = { key, error: q.error };
  else if (held.current && held.current.key !== key) held.current = null;
  const pressed = useRef(false);
  const ready = Boolean(q.data);
  useEffect(() => {
    if (ready && pressed.current) {
      pressed.current = false;
      target.current?.focus();
    }
  }, [ready, target]);
  return {
    failed: !q.data && held.current !== null,
    error: held.current?.error ?? q.error,
    busy: q.isFetching,
    onPress: () => {
      pressed.current = true;
    },
  };
}
