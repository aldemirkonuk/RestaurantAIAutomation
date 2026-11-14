# fix/house-says-a-draft-menu-is-not-current (r36 onboarding gap 3, 2026-11-13)

/house and /house/menu (with no first proof in this tab) said "Your menu is
read and kept." from `menu_uploaded` alone. A menu read and kept as a draft
gives no stock and no prices, so the page called an unfinished step done,
and the way to make the menu current showed only in the tab that read it.

Both now read `menu_current` from the same setup read (served since #1413):

- current: "Your menu is the current one." with the way to Menu.
- draft: "Your menu is read, but it is not the current menu yet." with
  "Choose it on Menu" and "Stock and prices come only from the current
  menu."
- an older gateway with no `menu_current`: said as before, never guessed.

The session's call (2026-11-07 /goal): read the fact the setup chain
already serves, through one pure helper (`lib/menuKept.ts`). Rejected: a
second read of `/menu-versions` on /house (one more request, and the logic
already lives in `lib/houseMenuStanding.ts` on the GetStarted stack, so a
copy here would be an add/add twin); adding `menu_current` to the web
`OnboardingProgress` type here (#1413 adds it in the same lines).

Left open:

- VerifyEmail still sends a house with only a draft menu to the desk
  (VerifyEmail.tsx:118 on #1083).
- Until #1413's chain merges, the gateway sends no `menu_current` and the
  pages say what they said before.
- Not seen in a browser.
