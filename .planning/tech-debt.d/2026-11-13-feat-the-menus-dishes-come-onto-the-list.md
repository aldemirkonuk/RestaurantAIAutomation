# feat/the-menus-dishes-come-onto-the-list (r35 onboarding, 2026-11-13)

r28 onboarding gap 1, slice 3, gateway half. A food house read its menu at
/get-started and then had to type every dish again on /dishes. Two routes now
carry the current menu's dishes onto the dish list:

- `GET /recipes/:rid/dishes/from-menu` (owner/manager): the kitchen lines of
  the current menus whose folded name is not a live dish, one per name, with
  the menu's section and price. No current menu offers nothing.
- `POST /recipes/:rid/dishes/from-menu` `{ names }` (owner/manager): makes
  the named ones that are still offered, each through `createDish`. A name no
  longer offered is `notOffered`; a 23505 is `already`; the first other
  failure stops the run and the rest are `notAdded`.

The rule is in `apps/api-gateway/src/recipes/menu-dishes.ts`. Which sections
count as kitchen is `isKitchenLine`'s call (menu-line-view.ts). On this chain
it is the short substring list, so a CSV section "Mains" is offered only once
the menu chain's widened list (#1390) lands.

Left open:

- Writes are one insert per dish, not one transaction. A run that stops
  leaves the made dishes made, and says so. Two runs at once are kept from
  doubling a dish by the `dishes_house_name_key` index (`already`).
- The dedupe is `foldName` (accents too), the index is lower-case and
  spaces only. "Şiş" and "Sis" on one menu become one dish; a typed "Şiş"
  hides a menu "Sis". Neither makes a duplicate.
- /house/menu still says "A dish is not carried to stock or prices yet." It
  should point at /dishes once the /dishes route (#1229 chain) and the /house
  chain are both on main.
- Not seen in a browser.
