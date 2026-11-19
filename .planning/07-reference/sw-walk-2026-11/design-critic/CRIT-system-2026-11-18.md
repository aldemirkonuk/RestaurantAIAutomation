# Design critic — SYSTEM leg (code-level, no browser) — 2026-11-18

Persona: Mudavym marketing-UI critic ("clean girl", elegant, SOTA motion). Adversary on purpose. Priorities: P0 looks broken / P1 cheapens / P2 delight.
Evidence is grep/read of apps/web at main (counts are over apps/web/src, measured today, not copied).

## Verdict in one breath
The *ideas* are expensive (paper/charcoal grounds, İznik seal, a sampled-spring motion vocabulary, Fraunces). The *execution layer* is two products wearing one coat: a thoughtful `.mudavym` token world and a 2019 Tailwind/shadcn world underneath, glued together with `on ? a : b` class forks. It reads "careful", not "expensive". Quiet-luxury is consistency; right now consistency is the thing missing.

## NEEDS

### N1 (P0) Two design systems in one file — the `on ? mdv : legacy` fork
- Seen: Login.tsx/Register.tsx carry ~199 `on ?` ternaries swapping whole class strings (`rounded-xl border-gray-200 bg-white shadow-sm` vs `rounded-[3px] bg-paper-0 border-paper-2`). Same screen, two radii languages (12px vs 3px), two greys, plus `!text-red-800` important-hacks to beat globals.css's bare `h1-h4/p` colour rules.
- Why it fails: the front door is where "expensive" is decided; a fork means every polish pass is done twice and one branch always rots. Specificity wars (`!`) are visible as off-tone red/amber banners (`bg-red-50 border-red-100`, `amber-800`) that belong to neither palette.
- Needs: delete the legacy branch on the public auth/landing surfaces; one `AuthCard` primitive. Error/pause banners use `--alarm-tint` / `--warn-tint` (already defined) — zero Tailwind red/amber on any `.mudavym` surface.
- Daring alt: auth as a single full-bleed paper sheet, wordmark set in Fraunces 300 opsz 144 at 56px, the form is just a hairline-ruled ledger line (no input boxes — bottom border 1px `--ink-4`, focus draws the seal colour left-to-right over 240ms `settle`).

### N2 (P0) Colour is three palettes, hex-literal, sRGB-only
- Seen: Tailwind defines `wine`, `brand` (identical to wine, 11 hex stops duplicated), `info`/`blue` duplicates, `red`/`danger` duplicates, `slate`/`gray` duplicates, `yellow`/`warning` duplicates; plus `.mudavym` vars (`--seal #1a5e6b`, `--paper-0 #fffdf8`…) with a *different* paper (`#FAF7F1` fallback in tailwind vs `#fffdf8` in the CSS — two "paper-0"s). `surface.secondary #FAF7F5` is a third off-white. Only 6 files use oklch/color-mix.
- Why it fails: five near-identical warm whites = muddy section edges (you see a 1-2% L step that is not on purpose). Hex stops are not perceptually even, so `wine-300→400→500` jumps unevenly; dark-mode seal (`#5FB0BC`) is hand-lifted.
- Needs: one OKLCH ramp for seal (L 0.96/0.92/0.86/0.78/0.70/0.58/0.47/0.40/0.33/0.26/0.20, C ≤0.09, h≈210) generated once, exposed as `--seal-50..950`; paper as 3 steps L 0.985/0.962/0.93, h≈85, C 0.008. Delete `brand`, `blue`, `yellow`, `danger`, `gray` aliases. Derive tints with `color-mix(in oklab, var(--seal) 10%, transparent)` so dark mode needs no second hand-tuned rgba.
- Daring alt: a second, *rare* accent — a warm apricot-clay (oklch .78 .08 55) used ONLY for the one live/attention dot per screen. Teal + clay on paper is the whole "clean girl" palette; today yellow/amber banners do that job loudly.

### N3 (P1) Type scale is a Tailwind default plus ~900 pixel-hack sizes
- Seen: `text-[11px]` ×417, `text-[10px]` ×313, `text-[9px]` ×69, `text-[12px]` ×67, `text-[13px]` ×49, `text-[8px]` ×6. Only 1 use of `font-brand` (Fraunces) vs 139 `font-mono` and 23 `font-display`. Base sans is Plus Jakarta + DM Sans (two sans families loaded for one voice). Tailwind lineHeights fixed (`xs 1rem`, `sm 1.25rem`) so hacked sizes fall back to inherited leading.
- Why it fails: 8-11px text is sub-legible on a phone and is the cheapest tell in the product; ~800 micro-labels mean hierarchy is expressed by shrinking, not by weight/colour/space. Mono 139× gives a "terminal" register that fights the airy brief. Serif almost absent = the brand face is not branding anything.
- Needs: floor 12px everywhere (P0 for 8-9px); a 7-step modular scale 1.2 (12/14/16/19/23/28/34 + display 44/56/72) with `clamp()` fluid display; labels = 12px / 500 / +0.04em / small-caps via `font-variant-caps: all-small-caps`, not 10px uppercase. Drop one sans (keep Jakarta or go Inter Tight/Geist) — two near-twins add ~80KB and zero voice. Fraunces for every H1/H2 and every number-as-hero, with `font-variation-settings: "opsz" 144, "SOFT" 50`. Tabular-nums on every figure.
- Daring alt: kinetic type — H1 resolves word-by-word, each word `translateY(0.4em)→0` + blur 6→0px, 60ms stagger, 520ms `settle`; only on first paint, gated by reduced-motion.

### N4 (P1) Radius has no personality — 1,280 `rounded-lg`, 892 `rounded-xl`, plus 3/9/10/13px strays
- Seen: Tailwind radius overridden to a 6/8/10/12/16/20/24 ladder; CSS has `border-radius` 8px×53, 10px×36, 12px×16, 6px×15, 999px×18; arbitrary `[10px]`×17, `[13px]`×4, `[9px]`×4, `[3px]`×3.
- Why it fails: 12px "Stripe card" corners next to 3px "paper" corners = two eras. Concentric-radius rule violated: nested chip in a card must be `outer − padding`.
- Needs: pick ONE corner doctrine. For paper/clean-girl: cards 20px, controls 12px, chips full, sheets 28px top, and nothing in between; inner radius = outer − gap (use `calc(var(--r) - var(--gap))`). Kill `[9px]/[13px]`. Optionally `corner-shape: squircle` (progressive) on cards/sheet — iOS-continuous corners are the single cheapest "expensive" signal.

### N5 (P1) Elevation is greyscale-black and 98 uses of shadow-2xl
- Seen: all shadows `rgb(0 0 0 / .x)`; `shadow-2xl` ×98, `shadow-lg` ×117, `shadow-sm` ×161. `ring` shadow uses blue-500 (`59 130 246`) — not the brand teal.
- Why it fails: black shadows on warm paper go grey/dirty; 2xl on 98 surfaces means everything floats, so nothing does. Focus ring in off-brand blue leaks on every input.
- Needs: shadows tinted with the ink hue: `0 1px 0 oklch(.2 .02 80 / .04), 0 8px 24px -12px oklch(.25 .03 80 / .14)`; 4 levels only (rest hairline, raised, overlay, modal), plus a 1px inner top highlight `inset 0 1px 0 oklch(1 0 0 / .6)` for "glass-paper". Ring = `--seal-ring` 3px, offset 2px. In dark: replace shadows with a 1px `oklch(1 0 0 / .06)` border + subtle top-lit gradient (shadows are invisible on charcoal; light is the depth).

### N6 (P1) Motion: great tokens, almost nobody uses them
- Seen: lib/mudavym/motion.ts has a real vocabulary (`settle` 320ms house curve, `ink` 160, `tuck` spring 380/32 sampled to `linear()`, `turn` 420, `stamp` spring 500/26 ~11% overshoot, `tally` 840, `pour`). That is rare and good. But in the wild: Tailwind `transition-colors` ×792, `transition-all` ×312, `duration-200` ×20 / `-150` ×14 / `-300` ×12, `ease-out` ×8, `ease-smooth` ×4, and the same house curve hand-pasted as `cubic-bezier(0.16,1,0.3,1)` ~115× in three spellings (with/without spaces/zero). Framer: `type:'spring'` ×18 with ad-hoc stiffness 300/320/340, damping 26/28/30/15 — numbers that match no token. Tailwind keyframes (`fade-in 0.2s ease-out`, `scale-in .95`, `slide-in-up 10px`) are the stock tailwindcss-animate look.
- Why it fails: `transition-all` ×312 animates layout props, triggers repaints, and makes hover feel like every property is on its own timer. Stock `ease-out` is a CSS-2012 curve: it decelerates late and feels mushy next to `settle`. Different surfaces will feel like different apps.
- Needs: expose tokens as CSS custom props on `.mudavym` and in Tailwind (`duration-ink/settle/turn`, `ease-house`, `ease-tuck` = sampled linear()). `--ease-house: cubic-bezier(.16,1,.3,1)`; `--ease-spring-tuck: linear(...)` emitted once from `springLinear`. Replace every `transition-all` with explicit `transition-[color,background-color,border-color,box-shadow,transform,opacity]`. Framer springs → 3 presets {tuck 380/32, stamp 500/26, soft 170/26}. Hover: 160ms `ink`; press: scale .98 in 90ms, release by `tuck`.
- Daring alt: a global "breath" — ambient 14s `oklch` radial wash drifting behind the paper (translate3d only, 2 layers, opacity .5, reduced-motion = static). Cost ~0 GPU; makes the page feel alive without a single moving object.

### N7 (P1) No view transitions, no scroll-linked choreography, no shared-element anywhere
- Seen: 0 hits for `startViewTransition`, `view-transition`, `animation-timeline`, `scroll-timeline`. `layoutId` used once in the entire app; `AnimatePresence` ×401 (the entire framer budget is mount/unmount fades). `whileHover` ×16, `whileTap` ×4, `useScroll`/`useTransform`/`whileInView` ×0. Route changes are hard swaps.
- Why it fails: the strongest signal of SOTA in 2026 is continuity: a row becomes its detail sheet, a number flies to the dashboard card, the seal morphs between auth states. Hard cuts between routes cost the product its entire "it understands my restaurant" feel.
- Needs: (1) `document.startViewTransition` wrapper on react-router navigations with `view-transition-name` on page header, seal, and list-row→sheet title; cross-fade 220ms `settle`, shared elements 360ms `turn`. (2) `animation-timeline: view()` reveals on marketing sections (translateY 24→0, opacity 0→1, `animation-range: entry 0% cover 30%`), no JS. (3) Sheet open from the clicked row's rect (FLIP via `layoutId` or VT), not from "28px right". (4) Number tweening on every KPI (`tally`, tabular-nums).
- Daring alt: the seal as persistent shared element — login: seal centred and large; on success it shrinks and travels to the header mark (VT, 520ms `turn`), the page fades in beneath. 1 element, whole product feels designed.

### N8 (P1) Overlay exits are banned by doctrine — challenged
- Seen: MOTIONS.md: "No exit animation… No scrim fade… detour that takes 300ms to end is noticed twice." Only the dirty "tear" leaves with motion. Sheet enter = 28px slide from the right on a sampled spring; scrim pops with the surface.
- Why it fails (my dissent): the rule is right about *duration*, wrong about *zero*. A 120ms ease-in exit (opacity + 8px) is perceived as instant but removes the visual "cut". Instant disappear + instant scrim reads as a glitch on 120Hz ProMotion; a hard scrim edge is the single most visible un-polish on mobile.
- Needs: scrim fade 140ms linear in / 100ms out; Sheet exit 140ms `cubic-bezier(.4,0,1,1)` (ease-in), translate 12px; overall perceived <150ms so the founder's detour rule still holds. Add `backdrop-filter: blur(6px) saturate(1.1)` on scrim (already 77× `backdrop-blur-sm` elsewhere, so the app owns this look but the primary overlay lacks it).
- Phone sheet: add real drag-to-dismiss with velocity (project >0.5px/ms or >40% = dismiss, rubber-band 0.35 beyond bounds). The doc admits drag is secondary to a tap cycle for WCAG 2.5.7 — keep the tap, ADD the physical drag; native iOS sheets feel this way.

### N9 (P1) Skeletons are 2018 grey pulses; they never become content
- Seen: `ui/loading-skeleton.tsx`: `animate-pulse bg-gray-200 dark:bg-gray-700` + a `via-white/20` shimmer on top of the pulse (double animation). Tailwind `shimmer` keyframe animates `background-position` (paint, not compositor). Mudavym has its own `mdv-skel-pulse` and `HousePageSkeleton` (no pulse found in components/mudavym). Hard-coded gray, not paper-2.
- Why it fails: Gray-on-warm-paper = dead-looking; pulse + shimmer compete; no reduced-motion on the shimmer; no morph into real content so every load ends in a layout pop.
- Needs: skeleton = `--paper-2` blocks, one sheen only (translateX gradient, `transform` not background-position, 1.6s linear, `oklch(1 0 0 / .5)` stop at 50%), reduced-motion = static. Reserve exact heights (CLS 0). Content arrives by stagger: each block `opacity 0→1`, `blur 4→0`, 40ms stagger, 240ms `settle`; skeleton and content share the same box so it reads as "the paper developed".

### N10 (P1) Layout shift and viewport units
- Seen: `h-screen` ×5, `min-h-screen` ×83, `100vh` ×31, `100dvh` ×3. Framer animates `height:'auto'` and `width: 72/260` (sidebar) in several places. Fonts are `font-display: swap` (FOUT: Fraunces → Georgia swap changes metrics).
- Why it fails: `100vh` on iOS Safari makes bottom-anchored CTAs hide under the toolbar (P0 on phones); animating `width`/`height` is layout-thrash (jank at 60, visible at 120Hz); swap-only fonts cause title reflow on every cold load of the page that sells the product.
- Needs: `100svh` for anything that must fit, `100dvh` for full-bleed, never `100vh` (sweep 31+83 sites). Sidebar collapse = animate `grid-template-columns` (now interpolable) or `transform` on an inner rail with `contain: layout`. Accordions: `interpolate-size: allow-keywords` + CSS `height:auto` transition (Chrome 129+, fall back to grid-rows 0fr→1fr). Fonts: `size-adjust`/`ascent-override` fallback faces for Fraunces and Jakarta so swap is metric-identical; `font-display: optional` on Fraunces for the hero only.

### N11 (P2) Glass, light and depth are used as spice, not as a system
- Seen: `backdrop-blur-sm` ×77, `-md` ×13 mostly on scrims. Zero grain/noise, zero gradients on paper, zero specular edges. Paper is flat `#fffdf8`.
- Needs / daring: "paper with tooth" — a 2% SVG fractal-noise layer (data-URI, `mix-blend-multiply`, 128px tile) on the hero ground only; header gets `backdrop-filter: blur(14px) saturate(1.4)` with a 1px bottom `oklch(0 0 0 / .05)` hairline that fades in at scroll Y>8 (scroll-timeline, no JS). Cards: 1px inner top highlight + 0 0.5px outer hairline = stationery, not widgets. Seal gets a slow 24s conic-gradient sheen across its mark on idle (`rp-sheen`/`pn-sheen`/`dn-sheen` already exist as three separate copies — unify to one `@keyframes mdv-sheen`).

### N12 (P2) Dead/duplicated keyframes and stock Tailwind motion in a bespoke product
- Seen: `popIn` ×2, `fadeIn` ×2, `shimmer` defined both in CSS and Tailwind config, three `*-sheen`, `so-settle / rc-settle / cm-settle / mdv-pub-settle` = four copies of "settle", `widget-jiggle`, `distributor-pulse`. tailwindcss-animate is also in plugins (so `animate-in fade-in zoom-in-95` coexist).
- Needs: single `motion.css` with ~8 keyframes named by token (`mdv-settle-up`, `mdv-ink-in`, `mdv-sheen`, `mdv-tuck-in`, `mdv-stamp`), everything else deleted. Kill `bounce-in` curve (`cubic-bezier(.68,-.55,.265,1.55)` — that is a 2014 jQuery-UI wobble; no place in this brand except `stamp`).

### N13 (P2) Landing/marketing surface is not in the SPA code I could audit
- Seen: no `/l/*` route in apps/web/src/App.tsx; `/login` and `/register` only. public/ has no `l/` folder; vercel.json references /login. The `/l/*` landing pages named in the brief are not present in this checkout of the Vite SPA (they may be a separate app/prerender). I did not guess; this leg judged the system and the auth front doors only. Browser leg should cover /l/*.
- Needs from whoever owns it: confirm where `/l/*` lives; it must consume the SAME tokens (N2/N3/N6). A marketing page built on the `.mudavym` token set can do scroll-driven storytelling the product shell never will — that is where the daring lives.

### N14 (P2) Reduced-motion is respected (credit) but binary
- Seen: 65 files mention prefers-reduced-motion, 22 use motion-reduce/useReducedMotion; Sheet renders `data-motion="none"` — correct and tested. 
- Needs: three tiers instead of two: `reduce` = no translate/scale/blur, keep 120ms opacity cross-fades (state change still *visible*); `no-preference` = full. "No animation at all" loses the confirmation signal that a click landed; opacity-only is vestibular-safe and what Apple does.

## Credits (what to keep, loudly)
- Sampled-spring → `linear()` tokens in motion.ts: genuinely SOTA, compositor-friendly, one source of truth. Protect it; make it the ONLY way in.
- `stamp` overshoot reserved for commitment (HoldToApprove): this is the product's signature gesture; use it in marketing as the hero beat.
- Paper/charcoal as *choice* with tokens that move as one set; contrast numbers documented in-file. Rare diligence.
- `text-wrap: balance` on headings; self-hosted fonts.

## Top 5 by leverage
1. Kill the `on ?` fork on public surfaces (N1) and the duplicate palettes (N2), OKLCH ramp.
2. Floor type at 12px, raise Fraunces to every H1/number (N3).
3. Tokens → CSS vars/Tailwind; ban `transition-all` and ad-hoc springs (N6).
4. View Transitions + scroll-driven reveals + shared-element sheets (N7).
5. Tinted elevation + one corner doctrine + squircle (N4, N5).
