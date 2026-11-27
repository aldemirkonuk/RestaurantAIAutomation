/**
 * The kept source of the current menu, shown with its lines (r107 menu-8, DD-r105-16 PR 2).
 *
 * A person checking the lines against the menu they came from had to open the file in
 * another tab and flip between the two. This holds the kept file on the same page: a photo
 * as a photo, a PDF in a frame, and for a file that cannot be shown (a spreadsheet) it says
 * so in words. Owner or manager only, like the route that signs the link. It leaves with no
 * exit animation, and the room it will fill is held before the link comes back, so the lines
 * below do not jump when it lands.
 *
 * The link is signed and short-lived (`getMenuSourceUrl`); it is asked for only once the pane
 * is opened. A link that could not be had says why and offers to ask again (ADR 0020).
 */
import { useQuery } from '@tanstack/react-query';
import { getMenuSourceUrl } from '../../../services/api/menus';
import { reasonOf } from './MenuVersions';

export const SOURCE_PANE_HEIGHT = 420;

export function MenuSourcePane({
  menuId,
  mime,
  open,
  onToggle,
  canManage,
}: {
  menuId: string;
  mime: string | null;
  open: boolean;
  onToggle: () => void;
  canManage: boolean;
}) {
  const link = useQuery({
    queryKey: ['menu', 'source-link', menuId],
    enabled: open && canManage,
    queryFn: () => getMenuSourceUrl(menuId),
    staleTime: 60_000,
    retry: false,
  });
  if (!canManage) return null;
  const kind = mime === 'application/pdf' ? 'pdf' : mime?.startsWith('image/') ? 'image' : 'other';
  return (
    <div data-testid="menu-source-pane" style={{ marginTop: 12 }}>
      <button
        type="button"
        className="cl-btn cl-focus"
        aria-expanded={open}
        aria-controls="menu-source-view"
        onClick={onToggle}
      >
        {open ? 'Hide the kept menu' : 'Show the kept menu with the lines'}
      </button>
      {open ? (
        <div
          id="menu-source-view"
          role="region"
          aria-label="The kept menu"
          style={{ marginTop: 10, minHeight: SOURCE_PANE_HEIGHT, border: '1px solid var(--paper-2)', borderRadius: 10, overflow: 'hidden' }}
        >
          {link.isError ? (
            <div role="alert" style={{ padding: 14, display: 'grid', gap: 8, justifyItems: 'start' }} data-testid="menu-source-error">
              <p className="cl-said">{reasonOf(link.error)}</p>
              <button type="button" className="cl-btn cl-focus" disabled={link.isFetching} onClick={() => void link.refetch()}>
                {link.isFetching ? 'Asking…' : 'Try again'}
              </button>
            </div>
          ) : link.isLoading || !link.data ? (
            <p className="cl-said" role="status" style={{ padding: 14 }}>
              Getting the kept menu…
            </p>
          ) : kind === 'image' ? (
            <img src={link.data.url} alt="The kept menu, as it was read" style={{ display: 'block', width: '100%', maxHeight: SOURCE_PANE_HEIGHT * 2, objectFit: 'contain' }} />
          ) : kind === 'pdf' ? (
            <iframe title="The kept menu, as it was read" src={link.data.url} style={{ display: 'block', width: '100%', height: SOURCE_PANE_HEIGHT, border: 0 }} />
          ) : (
            <p className="cl-said" style={{ padding: 14 }} data-testid="menu-source-unshown">
              This file is a sheet, and a sheet cannot be shown here. Open it from Menus kept below.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
