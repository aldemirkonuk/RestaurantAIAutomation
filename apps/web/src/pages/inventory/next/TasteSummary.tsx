/**
 * The drawer's first-screen taste line: the sentence "How it tastes" leads
 * with, said in words with its provenance marks, and one tap opens the full
 * card. It reads the same query as the card (same key), so the two never
 * disagree and the good is read once.
 *
 * Rules: nothing when no profile exists (and nothing while it is being read,
 * or when taste notes are not switched on: the card says so); a failed read
 * says so in words and shows nothing as known (ADR 0020). No number from the
 * 0..10 scale, no confidence figure (ADR 0104).
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTaste, tasteKeys, type ProvKind, type TasteRead } from '../../../services/api/taste';
import { Glyph } from './TasteCard';
import { PROV_MARK, leadLine } from './taste-words';

/** The sheet's slide is 300 ms: an empty answer gives its room back only after it, so the two never overlap (r97 M6). */
export const HOLD_GRACE_MS = 340;
/** The room is given back over this long (grid/height ease, not a jump). */
export const HOLD_COLLAPSE_MS = 200;

const reducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const TASTE_LINE_FAILED = 'How it tastes could not be read just now.';

export interface TasteSummaryProps {
  id: string;
  restaurantId: string | null;
  /** The evidence is open, so the button's state is truthful. */
  open: boolean;
  /** Opens the full taste card. */
  onOpen: () => void;
  /**
   * 'foot' (default) is the line under the acts. 'head' is the phone's copy under the
   * header line, above the cards: CSS shows exactly one of the two, the other is
   * display:none (out of the tab order and the reading order). Both read the same query.
   * While the read is pending either copy holds its one-line slot (44 px head, 23 px foot) so
   * what is under it does not move; an answer with nothing to say gives the room back over
   * 200 ms, started no earlier than 340 ms after the line mounted (after the sheet's slide).
   * Under reduced motion the room goes at that time with no tween.
   */
  placement?: 'head' | 'foot';
}

export default function TasteSummary({ id, restaurantId, open, onOpen, placement = 'foot' }: TasteSummaryProps) {
  const head = placement === 'head';
  const tid = head ? 'taste-line-head' : 'taste-line';
  const [phase, setPhase] = useState<'grace' | 'collapsing' | 'gone'>('grace');
  useEffect(() => {
    const t = setTimeout(() => setPhase(reducedMotion() ? 'gone' : 'collapsing'), HOLD_GRACE_MS);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (phase !== 'collapsing') return;
    const t = setTimeout(() => setPhase('gone'), HOLD_COLLAPSE_MS);
    return () => clearTimeout(t);
  }, [phase]);
  const q = useQuery<TasteRead>({
    queryKey: tasteKeys.subject(restaurantId ?? '', 'good', id),
    queryFn: () => getTaste('good', id, restaurantId ?? undefined),
    enabled: restaurantId !== null && id !== '',
    staleTime: 30_000,
    retry: false,
  });
  let sentence: string | null = null;
  let kinds: ProvKind[] = [];
  let failed = false;
  if (q.isError || q.data?.state === 'failed') failed = true;
  else if (q.data?.state === 'ready') {
    const line = leadLine(q.data.data);
    if (line) ({ sentence, kinds } = line);
  }
  if (!failed && sentence === null) {
    if (q.isLoading || phase !== 'gone') {
      return (
        <p
          className={`tc-line tc-line--${placement} tc-line--hold`}
          aria-hidden="true"
          data-testid={`${tid}-hold`}
          data-collapsing={!q.isLoading && phase === 'collapsing' ? 'true' : undefined}
        />
      );
    }
    return null;
  }
  const said = failed ? TASTE_LINE_FAILED : (sentence as string);
  return (
    <p className={`tc-line tc-line--${placement}`} data-testid={tid} data-state={failed ? 'failed' : 'ready'}>
      <span className="tc-line-k">How it tastes</span>
      <button
        type="button"
        className="iv-linkish iv-focus tc-line-btn"
        aria-expanded={open}
        aria-controls={open ? 'ivd-evidence' : undefined}
        data-testid={`${tid}-open`}
        onClick={onOpen}
      >
        <span>{said}</span>
        {kinds.length ? (
          <span className="tc-marks" role="img" aria-label={`Where it came from: ${kinds.map((k) => PROV_MARK[k].words).join(', ')}`} data-testid={`${tid}-marks`} data-marks={kinds.map((k) => PROV_MARK[k].shape).join(' ')}>
            {[...new Set(kinds.map((k) => PROV_MARK[k].shape))].map((s) => (
              <span key={s} className="tc-mark" data-shape={s}>
                <Glyph shape={s} />
              </span>
            ))}
          </span>
        ) : null}
      </button>
    </p>
  );
}
