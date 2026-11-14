# fix/learn-and-help-keeps-the-next-steps (r32 onboarding, 2026-11-13)

The steps to the house's costs (#1413: goods on the list, the house's Gmail,
the first invoice checked) used to show only while "Get started" was open.
Setup ends when the menu is current and there is a vendor and an invite.
An owner can do all of that in the first sitting, and "Don't show again" ends
it too. After that the panel became Learn & Help, and the three steps that
lead to costs went with it.

Learn & Help now shows them under "To see your costs" while one is not done.
This is for an owner or a manager only: the Sidebar passes `showNextSteps`
from `runsSetup`, so staff never see them. "App usage guide" now opens
/help (the "How this works" guides). It used to open `/get-started?tab=use`:
the first-house form for an owner, and the desk for anyone else. No page
reads `tab`.

Left open:

- /help's own "The app guide" card and the "General overview" guide still
  point at /get-started (#570 edits that card). #1451 sends an owner with a
  current menu on to /house from there.
- Not seen in a browser.
