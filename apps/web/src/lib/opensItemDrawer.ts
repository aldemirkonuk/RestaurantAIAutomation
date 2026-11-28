/**
 * Does this location open a good's drawer (`/inventory?open=` or `?highlight=`)?
 * The drawer opens above a first-visit sheet, which then cannot be answered
 * until the drawer closes, so a preference sheet waits (the theme sheet). The
 * data terms sheet is not a preference and never waits: the drawer waits for
 * it instead (InventoryNext).
 */
export function opensItemDrawer(pathname: string, search: string): boolean {
  if (!pathname.startsWith('/inventory')) return false;
  const p = new URLSearchParams(search);
  return Boolean(p.get('open') || p.get('highlight'));
}
