/**
 * The mail setup page's shared look (founder /goal 2026-11-07): the page's
 * inline token styles, LINK and pill buttons, as the rest of comms/next.
 */

import type { CSSProperties, ReactNode } from 'react';
import type { MailStatus } from './mail-format';

export const TONE: Record<MailStatus['tone'], string> = {
  ink: 'var(--ink-2, #4F473C)',
  seal: 'var(--seal-deep, #14515C)',
  warn: 'var(--warn, #96601A)',
  alarm: 'var(--alarm, #A33A2B)',
};
export const TEXT: CSSProperties = { margin: 0, fontSize: 12.5, color: 'var(--ink-2, #4F473C)', maxWidth: '68ch' };
export const QUIET: CSSProperties = { margin: 0, fontSize: 11.5, color: 'var(--ink-4, #665D50)' };
export const ALERT: CSSProperties = { margin: 0, fontSize: 12, color: 'var(--alarm-deep, #8C3322)' };
export const LINK: CSSProperties = {
  background: 'none',
  border: 0,
  padding: 0,
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--seal-deep, #14515C)',
  justifySelf: 'start',
};
export const ACT: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  padding: '5px 12px',
  borderRadius: 6,
  border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
  background: 'transparent',
  color: 'var(--seal-deep, #14515C)',
  cursor: 'pointer',
  justifySelf: 'start',
};
export const NOT_YOURS = 'Only an owner or a manager of this house can change this.';

export function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-2" style={{ paddingTop: 12, borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>{title}</h3>
      {children}
    </section>
  );
}
