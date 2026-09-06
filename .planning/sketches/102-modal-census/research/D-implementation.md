# D — reference implementations the primitive can learn from (parent's own pass, 2026-09-05)

Evidence gathered by WebSearch; each row names what the library does, not what Mudavym should do.

| Library | Behaviour | Evidence | Would serve |
|---|---|---|---|
| Vaul (React drawer, Radix Dialog underneath) | **Snap points** — an array of 0–100 percentages; the drawer rests at each (peek / half / full), i.e. a bottom sheet with detents | https://www.npmjs.com/package/vaul/v/1.0.0 · https://allshadcn.com/tools/vaul/ | the door on a phone: a delivery sheet that peeks the next step, opens half for the count, full for the photo |
| Vaul | **Nested drawers** — `Drawer.Root` inside another; the library owns focus + scroll for the stack | same | a vendor opened from an order opened from a notification — stacked sheets with one focus owner (ADR 0112's OverlayRoot already counts scroll locks) |
| Vaul | **Scaled background** — the page behind shrinks slightly when the sheet opens (`[vaul-drawer-wrapper]`) | same | a mobile-only cue that the page is still there; conflicts with "byte-identical legacy" unless gated like the shell store |
| cmdk (command menu) | **Pages stack** — nested commands are a plain array of page names; Esc or Backspace pops a page; `useCommandState` surfaces deep sub-items only while searching; `Command.Loading` for async lists | https://dip-cmdk.mintlify.app/guides/nested-items · https://github.com/dip/cmdk | the palette: "Approve …" → a page listing the waiting orders → the panel; "Open the vendor …" → a page of vendors |
| Sonner (toast) | **Undo action** on a toast (label + onClick) — a grace period after a delete/archive instead of a confirm before it; **promise toasts** move loading → success/error by themselves; live-region announcements | https://sonner.emilkowal.ski/toast · https://github.com/emilkowalski/sonner | routine writes (dismiss an entry, archive a thread, remove a shift): undo after, no panel before — the ration says wax only for real commitment |

What this means for the house primitive: the three behaviours that are *structural* (snap points, a nested stack with one focus owner, a pages stack in the palette) belong in `Sheet.tsx`/`CommandPalette.tsx`; the undo toast is a fourth *non-modal* surface the policy does not name yet — it is not a shape (no focus, no scrim), so it does not collapse the three-shape rule, but it needs a line in ADR 0112 (see the synthesis).

## Hospitality unicorns (ordering-side), same pass

| Product | Behaviour | Evidence | Would serve |
|---|---|---|---|
| Choco (wholesale ordering; $1.2B valuation per CB Insights) | A **voice agent** (built with OpenAI) that takes a supplier order as a live conversation — checks stock, suggests alternatives — replacing voicemail ordering | https://choco.com/us/restaurants · https://www.cbinsights.com/research/choco-competitors-rekki-pepper/ | the config assistant's voice surface (ADR 0113 Q1: voice AND typing) and, on the ordering side, "say the order" into the new-order sheet |
| Rekki (ordering marketplace) | **Compare prices across suppliers** while browsing ingredients; connect to new suppliers from the same search | https://likely-parts-831360.framer.app/app · https://www.cbinsights.com/company/rekki | the new-vendor sheet's catalogue search and the price register (ADR 0117) shown beside a line in the new-order sheet |
| Choco | A separate **sales-rep app** for distributors (the other side of the same order) | https://www.prnewswire.com/news-releases/choco-introduces-new-sales-rep-app-for-food-distributors-302282130.html | the vendor portal `/v/:slug` — the responses sheet's counterpart on the vendor's side |

Not found in this pass (do not claim): order guides / one-tap reorder / supplier chat specifics for Choco and Rekki — the search returned none.
