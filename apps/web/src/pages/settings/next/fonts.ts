/**
 * Fraunces — the house serif, loaded by this page for itself.
 *
 * Copied from `pages/dashboard/next/fonts.ts` rather than imported across
 * pages (each Mudavym page stands alone). `index.html` is a shared file this
 * page may not touch and it does not carry Fraunces; the link is injected once,
 * idempotently, and Georgia carries the text until (or if ever) it lands. The
 * element id is deliberately the SAME as the dashboard's, so two rebuilt pages
 * in one session add one stylesheet, not two.
 */

const LINK_ID = 'mudavym-fraunces';

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';

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
