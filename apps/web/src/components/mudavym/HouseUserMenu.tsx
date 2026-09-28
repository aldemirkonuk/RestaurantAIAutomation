/**
 * Who is signed in, and as what — the house's answer, not a decoration.
 *
 * Like `HouseBell`, this is a thin component rather than an edit to
 * `components/layout/Header.tsx:332-453`: that menu is already gated to the
 * house `Popover`, but the legacy header is never mounted on a rebuilt page
 * (`DashboardLayout.tsx:110` re-exports it and no `pages/<page>/next` renders it),
 * and lifting it out would touch a file this wave is holding open.
 *
 * THE ROLE IS NAMED, AND THE SOURCE IS NAMED WITH IT
 * -------------------------------------------------
 * There are two roles in this app and they are not the same fact:
 *
 *   `activeRole`  — the role at the ACTIVE branch, read from
 *                   `user_restaurant_access` (`AuthContext.tsx:105-106`).
 *                   Null when it is not known.
 *   `user.role`   — the role on the account record the JWT carries
 *                   (`AuthContext.tsx:51`), which for a person with access to
 *                   several houses is the role at their home restaurant.
 *
 * A person who owns one house and manages another is an owner in one place and
 * a manager in the other. Printing one word without saying which register it
 * came from would be a claim the app cannot support, so the menu prints the
 * branch role where it has it and says plainly when it is falling back to the
 * account's. Neither known ⇒ words, never a guessed "Staff".
 */

import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, HelpCircle, LogOut, Settings, User } from 'lucide-react';
import { Popover } from './Sheet';
import { useAuth } from '../../contexts/AuthContext';

const ROLE_WORD: Record<'owner' | 'manager' | 'staff', string> = {
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff',
};

export function HouseUserMenu() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const { user, logout, activeRole, activeRestaurantId, availableRestaurants } = useAuth();

  const house = availableRestaurants.find((b) => b.id === activeRestaurantId) ?? null;
  const initial = (user?.name ?? user?.email ?? '?').trim().charAt(0).toUpperCase() || '?';

  /** One sentence, and it always says where the word came from. */
  const roleLine = activeRole
    ? `${ROLE_WORD[activeRole]}${house ? ` at ${house.name}` : ' at this house'}.`
    : user?.role
      ? `${ROLE_WORD[user.role]} on the account. The role at this house was not read, so this is the account’s own record.`
      : 'Your role was not read. Nothing here is a claim about what you may do.';

  const go = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  return (
    <div className="mdv-hdr__slot">
      <button
        ref={triggerRef}
        type="button"
        className="mdv-hdr__btn mdv-hdr__btn--user"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="mdv-hdr__avatar" aria-hidden>
          {initial}
        </span>
        <span className="mdv-hdr__who">{user?.name ?? user?.email ?? 'This account'}</span>
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden className="mdv-hdr__chev" />
      </button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        label="Account menu"
        width={274}
        eyebrow={user?.email ?? 'Signed in'}
        title={user?.name ?? 'This account'}
        showClose={false}
      >
        <p className="mdv-hdr__role">{roleLine}</p>

        <button type="button" className="mdv-item" onClick={() => go('/profile')}>
          <User size={14} aria-hidden className="mdv-item__icon" />
          <span className="mdv-item__text">Profile</span>
        </button>
        <button type="button" className="mdv-item" onClick={() => go('/settings')}>
          <Settings size={14} aria-hidden className="mdv-item__icon" />
          <span className="mdv-item__text">Settings</span>
        </button>
        <button type="button" className="mdv-item" onClick={() => go('/help')}>
          <HelpCircle size={14} aria-hidden className="mdv-item__icon" />
          <span className="mdv-item__text">Help &amp; Support</span>
        </button>
        <button type="button" className="mdv-item mdv-hdr__ruled" onClick={() => void logout()}>
          <LogOut size={14} aria-hidden className="mdv-item__icon" />
          <span className="mdv-item__text">Log out</span>
        </button>
      </Popover>
    </div>
  );
}

export default HouseUserMenu;
