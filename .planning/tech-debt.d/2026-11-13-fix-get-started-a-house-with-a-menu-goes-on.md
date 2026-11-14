# fix/get-started-a-house-with-a-menu-goes-on (r32 onboarding, 2026-11-13)

An owner who comes back to /get-started is no longer offered "One last step
· Your menu" when the house's menu is already current: the page reads
GET /menu-versions once and goes on to /house. Every guide link lands on
/get-started (Learn & Help "App usage guide", /help "The app guide", the
"General overview" guide's "Open the getting-started guide"), so this was
every owner who asked for the guide after setup, and a read there made one
more draft beside the current menu. A menu kept as a draft is named, with a
link to choose it on /menu. A failed read leaves the step as it was. A house
opened on the same visit is not read.

Left open:

- **The menu step shows while the read is in flight.** The entry rule is
  synchronous and eight test files assert the menu step at once, so the read
  runs after the step draws. An owner with a current menu sees the step for
  one round trip before /house.
- **The guide links still say "guide".** /help "The app guide" and
  "Open the getting-started guide" still point at /get-started; #570 edits
  the same card. A manager or staff member who follows them lands on the
  desk.
- Not seen in a browser.
