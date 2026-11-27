/**
 * The kept source of the current menu, shown with its lines (r107 menu-8, DD-r105-16 PR 2).
 *
 * A person checking the lines against the menu they came from had to open the file in
 * another tab and flip between the two. This holds the kept file on the same page: a photo
 * as a photo, a PDF in a frame, and for a file that cannot be shown (a spreadsheet) it says
 * so in words. Owner or manager only, like the route that signs the link. It leaves with no
 * exit animation, and the room it will fill has one fixed height from the click (a photo is
 * fitted inside it, never sized by it), so the lines below do not jump when it lands.
 *
 * The link is signed and short-lived (`getMenuSourceUrl`); it is asked for only once the pane
 * is opened, and a link in hand is kept: coming back to the window does not ask for a new one
 * (a new token changes the address, and a PDF being read would reload at page 1). It is asked
 * for again only when the file fails to load, once, or when the pane is opened after the link
 * has run out. A link that could not be had says why and offers to ask again (ADR 0020).
 */
import { useEffect, useRef } from 'react';
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
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const { refetch, dataUpdatedAt } = link;
  const expiresIn = link.data?.expiresInSeconds ?? null;
  // Opened again after the link ran out: ask once more. (Only on the open, so a link in use is never swapped.)
  const askedAgain = useRef(false);
  useEffect(() => {
    askedAgain.current = false;
    if (open && canManage && expiresIn !== null && Date.now() - dataUpdatedAt >= expiresIn * 1000) void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a change of open decides this
  }, [open]);
  // The file would not load (a link that ran out under a pane left open): ask once more, never in a loop.
  const fileFailed = () => {
    if (askedAgain.current) return;
    askedAgain.current = true;
    void refetch();
  };
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
          style={{ marginTop: 10, height: SOURCE_PANE_HEIGHT, position: 'relative', border: '1px solid var(--paper-2)', borderRadius: 10, overflow: 'auto' }}
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
            <>
              <img
                src={link.data.url}
                alt="The kept menu, as it was read"
                onError={fileFailed}
                style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }}
              />
              <FullSize url={link.data.url} />
            </>
          ) : kind === 'pdf' ? (
            <>
              <iframe title="The kept menu, as it was read" src={link.data.url} onError={fileFailed} style={{ display: 'block', width: '100%', height: '100%', border: 0 }} />
              <FullSize url={link.data.url} />
            </>
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

/** The file on its own page, for a read that needs more room than the pane holds. */
function FullSize({ url }: { url: string }) {
  return (
    <a
      className="cl-btn cl-focus"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{ position: 'absolute', top: 8, right: 8, background: 'var(--paper)' }}
    >
      Open full size
    </a>
  );
}
