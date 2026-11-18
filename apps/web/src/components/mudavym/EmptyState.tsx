/**
 * The house's one empty state (r58, N-09): a 96 px line illustration, ONE
 * primary action, the honest sentence at 13 px beneath, and the long truth
 * behind "Why is this empty". It replaces the paragraph-in-a-white-card each
 * register used to write for itself.
 *
 * The component never decides what is true. The caller passes the sentence —
 * "nothing waits" for a read that answered empty, the failure for a read that
 * did not (ADR 0020) — and an unread register must not be drawn as this
 * component's friendly face of "nothing yet".
 */

import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { EmptyArt, type EmptyArtName } from './emptyArt';
import './empty-state.css';

export interface EmptyStateAction {
  label: string;
  /** A button action. */
  onClick?: () => void;
  /** Or a link to a room. */
  to?: string;
}

export interface EmptyStateProps {
  art?: EmptyArtName | ReactNode;
  /** The honest sentence, 13 px. */
  sentence: ReactNode;
  action?: EmptyStateAction;
  /** The long truth, behind "Why is this empty". */
  why?: ReactNode;
  /** Tighter, left-set, for a pane rather than a page. */
  compact?: boolean;
  className?: string;
}

export function EmptyState({ art, sentence, action, why, compact, className }: EmptyStateProps) {
  const [open, setOpen] = useState(false);
  const whyId = useId();
  return (
    <div className={`mdv-empty mudavym${className ? ` ${className}` : ''}`} data-compact={compact ? 'true' : undefined}>
      {art ? (
        <div className="mdv-empty__figure">
          {typeof art === 'string' ? <EmptyArt name={art as EmptyArtName} /> : art}
        </div>
      ) : null}
      <p className="mdv-empty__sentence">{sentence}</p>
      {action ? (
        action.to ? (
          <Link className="mdv-btn mdv-btn--seal mdv-empty__action" to={action.to}>
            {action.label}
          </Link>
        ) : (
          <button type="button" className="mdv-btn mdv-btn--seal mdv-empty__action" onClick={action.onClick}>
            {action.label}
          </button>
        )
      ) : null}
      {why ? (
        <div className="mdv-empty__whywrap">
          <button
            type="button"
            className="mdv-link mdv-empty__whybtn"
            aria-expanded={open}
            aria-controls={whyId}
            onClick={() => setOpen((o) => !o)}
          >
            Why is this empty
          </button>
          <div id={whyId} className="mdv-empty__why" data-open={open ? 'true' : 'false'}>
            <div className="mdv-empty__whyinner">{why}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default EmptyState;
