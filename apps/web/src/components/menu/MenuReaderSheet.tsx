/**
 * "Scan a menu" on /inventory and /cellar, repointed to the menu reader
 * (ADR 0358 F3, the founder's pick 2026-11-07: "Repoint to menu reader").
 *
 * The old scanner posted to an orchestrator route nobody serves
 * (`/api/v1/scan/menu`, unmounted under ADR 0179) and answered every photo
 * with "No wines were detected"; its add half wrote straight into inventory.
 * This sheet draws the same reader /menu draws (`MenuReadForm`): a photo, a
 * PDF or a spreadsheet goes to POST /menus/import and is kept as a draft
 * version on /menu. Nothing reaches inventory or a price until an owner or a
 * manager makes that menu current, here or on /menu, through the same plan.
 */
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Sheet } from '@/components/mudavym';
import { useAuth } from '../../contexts/AuthContext';
import { MenuReadForm } from '../../pages/menu/next/MenuVersions';
import { queryKeys } from '../../lib/query-keys';

export function MenuReaderSheet({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { activeRole, user } = useAuth();
  const role = (activeRole ?? user?.role ?? null) as string | null;
  const canManage = role === 'owner' || role === 'manager';

  return (
    <Sheet
      open
      onClose={onClose}
      label="Read a menu: a photo, a PDF or a spreadsheet, kept as a draft on the menu page"
      eyebrow="Read a menu"
      title="A photo, a PDF or a spreadsheet"
      footer={
        <span>
          Reading a menu changes no price and no stock. It is kept on the menu page, where an owner or a manager makes
          it current.
        </span>
      }
    >
      <div className="mudavym" data-testid="menu-reader-sheet">
        <MenuReadForm
          canManage={canManage}
          onRead={() => {
            void queryClient.invalidateQueries({ queryKey: ['menu'] });
            // A menu made current here carries its wines to the stock list.
            void queryClient.invalidateQueries({ queryKey: queryKeys.wines.all });
            void queryClient.invalidateQueries({ queryKey: ['inventory'] });
          }}
          after={() => (
            <p className="cl-said" style={{ marginTop: 10 }}>
              <Link to="/menu" className="cl-btn cl-focus" data-testid="menu-reader-open-menu">
                Open it on the menu page
              </Link>
            </p>
          )}
        />
      </div>
    </Sheet>
  );
}

export default MenuReaderSheet;
