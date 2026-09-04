/**
 * Fraunces — the house serif, injected by the page that needs it.
 *
 * A copy of `pages/dashboard/next/fonts.ts`, deliberately: the p4 brief forbids
 * importing across page directories, and the id is IDENTICAL so all the copies
 * inject at most one `<link>` between them. Georgia carries the text until (or
 * if ever) the webfont lands, so nothing here can break the page.
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
