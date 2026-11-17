/**
 * How long a read of /menu (a plan, the kept menus) counts as current when the
 * person comes back to the tab (r41 R5). The app's default is 5 s with a re-read
 * on every focus, so checking a plan against its file in another tab planned it
 * again on return. Anything the person does here (a choice, a lock, a refresh)
 * invalidates the read and does not wait for this.
 */
export const MENU_READ_FRESH_MS = 60_000;
