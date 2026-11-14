# fix/get-started-sends-a-manager-to-the-menu (r36 onboarding gap 5, 2026-11-13)

Learn & Help's "Read it now" sends every role to /get-started, and so do
the guide links. /get-started sent a manager with a house to the desk (`/`),
which says nothing about the menu: the click went nowhere. The setup banner
already sends a manager to /menu, where a manager reads the menu and makes
it current.

/get-started now sends a manager to /menu (on entry, and after a 409 that
finds the manager's house). Staff still go to the desk; an owner still
resumes at the menu step. A manager is still never shown owner onboarding.

The session's call (2026-11-07 /goal): fix the destination, not each link.
Rejected: a role prop on LearnPanel (the rail door in #1491 renders the
panel too and would keep the dead end), and `useAuth` inside LearnPanel (it
throws outside an AuthProvider, so every panel test would need a mock for a
one-word change). This narrows the BL-1/F8 entry rule ("staff and managers
go to the desk") for managers only.

Left open: not seen in a browser.
