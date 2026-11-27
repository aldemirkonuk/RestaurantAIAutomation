/**
 * One line under a page when it looks blurred, flat or small (r110 g2), and on
 * a phone a Retake. The row's room is reserved so the line arriving shifts
 * nothing; the line enters with a short rise and has no exit (ADR 0112).
 */

import { useRef } from 'react';
import { qualityKind, type PageQuality } from '../../lib/pageQuality';

const SAYS = {
  blurred: 'looks blurred. Retake it, or Read anyway.',
  flat: 'has little contrast. Retake it, or Read anyway.',
  small: 'is small; text may not read. Retake it, or Read anyway.',
} as const;

export function PageQualityHint({
  quality,
  label,
  retakable,
  onRetake,
  disabled = false,
  wide = false,
}: {
  quality: PageQuality | null;
  /** 'Page 2', or 'This photo' for a single one. */
  label: string;
  /** A phone capture: the Retake button is offered. */
  retakable: boolean;
  onRetake: (file: File) => void;
  disabled?: boolean;
  /** Under the single held photo, where one line is enough room. */
  wide?: boolean;
}) {
  const kind = qualityKind(quality);
  const pick = useRef<HTMLInputElement>(null);
  return (
    <div className={wide ? 'mdv-qhint mdv-qhint--wide' : 'mdv-qhint'} data-retake={retakable || undefined}>
      {kind ? (
        <>
          <p className="mdv-qhint__line" data-testid="page-quality-hint">
            {label} {SAYS[kind]}
          </p>
          {retakable ? (
            <>
              <button type="button" className="mdv-qhint__btn" disabled={disabled} onClick={() => pick.current?.click()}>
                Retake
              </button>
              <input
                ref={pick}
                type="file"
                accept="image/*"
                capture="environment"
                className="mdv-drop__input"
                tabIndex={-1}
                aria-label={`${label}: retake`}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) onRetake(f);
                }}
              />
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
