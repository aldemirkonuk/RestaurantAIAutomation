/**
 * "Scan a menu" on /inventory and /cellar opens THE menu reader (founder,
 * 2026-11-07, MU-2: "Repoint to menu reader"; ADR 0358 F3 supersedes ADR
 * 0314's "the real scanner").
 *
 * The old scanner posted to an orchestrator route nobody mounts
 * (`/api/v1/scan/menu`) and turned the 404 into "No wines were detected" (QA
 * M2). This dialog is the same reader the Menu page uses (`ReadMenuForm`,
 * `POST /menus/import`): the read is kept as a draft version on the Menu page,
 * an owner or manager may make it current through its plan, and nothing is
 * written to stock. Bottles are counted where they are counted; a menu says
 * what the house sells and at what price, not what is on the shelf.
 */
import { useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { ReadMenuForm } from '../../pages/menu/next/MenuVersions';
import type { MenuImportResult } from '../../services/api/menus';
import '../../pages/cellar/next/cellar-next.css';

export interface MenuReaderDialogProps {
  isOpen: boolean
  onClose: () => void
  /** Told the finished read, so a host can offer its own next step. */
  onReadDone?: (r: MenuImportResult) => void
  /** Told when a new read begins, so a host drops the step it offered for the last one. */
  onReadStart?: () => void
  /** Shown under the reader, e.g. a host's next step for the finished read. */
  footer?: ReactNode
}

export function MenuReaderDialog({ isOpen, onClose, onReadDone, onReadStart, footer }: MenuReaderDialogProps) {
  const queryClient = useQueryClient();
  const { activeRole, user } = useAuth();
  // Choosing the current menu is an owner's or a manager's (ADR 0193); the
  // gateway refuses anyone else regardless of what this dialog offers.
  const role = (activeRole ?? user?.role ?? null) as string | null;
  const canManage = role === 'owner' || role === 'manager';

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
      data-testid="menu-reader-backdrop"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="menu-reader-h"
        className="mudavym"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--paper-0)',
          color: 'var(--ink-1)',
          borderRadius: 14,
          width: '100%',
          maxWidth: 760,
          marginTop: 40,
          padding: '18px 18px 20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h2 id="menu-reader-h" className="cl-serif" style={{ margin: 0, fontSize: 19, fontWeight: 600, flex: 1 }}>
            Read a menu
          </h2>
          <button type="button" className="cl-btn cl-focus" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="cl-note">
          A photo (or several photos of one menu), a PDF or a CSV. The read is kept as a draft on the{' '}
          <Link to="/menu" onClick={onClose}>
            Menu page
          </Link>
          ; it changes no price until it is made the current menu, and it never adds bottles to stock.
        </p>
        <ReadMenuForm
          canManage={canManage}
          onRead={() => void queryClient.invalidateQueries({ queryKey: ['menu'] })}
          onReadStart={onReadStart}
          onReadDone={onReadDone}
          // Making a menu current moves house prices: every page showing a
          // price (stock, cellar, menu) reads again.
          onChosen={() => void queryClient.invalidateQueries()}
        />
        {footer}
      </div>
    </div>
  );
}

export default MenuReaderDialog;
