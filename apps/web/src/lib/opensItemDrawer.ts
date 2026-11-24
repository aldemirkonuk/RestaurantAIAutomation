/**
 * Does this location open a good's drawer (`/inventory?open=` or `?highlight=`)?
 * The drawer opens above any first-visit sheet, which then cannot be answered
 * until the drawer closes, so those sheets wait (#2078 theme sheet, the data
 * terms sheet).
 */
export function opensItemDrawer(pathname: string, search: string): boolean {
  if (!pathname.startsWith('/inventory')) return false;
  const p = new URLSearchParams(search);
  return Boolean(p.get('open') || p.get('highlight'));
}
