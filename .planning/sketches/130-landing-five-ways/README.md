---
sketch: 130
name: landing-five-ways
question: "The founder, 2026-10-02: 'Create me a very intuitive 5 with different animations and motions landing pages for Mudavym.com, think unique creative no boundaries maybe do movie, no limit.' What are five landing directions, each with its own motion technique, on the locked brand?"
winner: null
supersedes: none
tags: [landing, marketing, mudavym.com, motion, scroll, webgl, three-js, kinetic-type, physics, conversation, generative-ui, adr-0042, adr-0043, adr-0047, od-214, sketch-only]
---

# Sketch 130 · The landing page, five ways (seven after round 2)

Open [`index.html`](index.html) in a browser. Each concept is one self-contained HTML file
(Google Fonts the only external stylesheet; B alone loads three.js r128 from cdnjs). All five
use the locked brand (ADR 0042 İznik seal + Warm Charcoal / paper, ADR 0043 Fraunces wordmark,
ADR 0047 A+M interlock mark) and run on a demo house with sample data. Nothing is wired into
`apps/web`; where a landing would live is OD-214 fork 2.

| | Concept | Idea | Motion technique |
|---|---|---|---|
| A | [The Film](a-film.html) | One night of service, 16:00 → 00:40, played as you scroll: delivery, cellar, service, "2 left", close, end credits | Scroll-scrubbed pinned scenes, 2.39:1 letterbox, canvas film grain, burned-in timecode, push-in, dolly zoom, rack focus, whip pans, opt-in WebAudio room tone |
| B | [The Cellar](b-cellar.html) | A candlelit 3D descent: bottles counted by a scan gate, a label read, bottles re-form into value-by-region bars, a draft PO, then the A+M mark from above | three.js InstancedMesh (~4,300 bottles desktop, ~1,900 phone), scroll camera path, instance morphing, 3D→HTML label projection, SVG fallback without WebGL |
| C | [The Ledger](c-type.html) | Paper and ink only: "The house runs itself. You sign." A wine-list line breaks into ledger columns; counts roll; the seal stamps the order | Fraunces variable axes (wght/opsz/SOFT/WONK) per letter driven by pointer and scroll velocity, masked split-text, FLIP tokens, odometers, velocity marquee |
| D | [The Pass](d-pass.html) | Every job is a ticket on the kitchen pass: grab and throw them, watch them fire down the rail, then slide the seal to sign a PO yourself | Hand-written 2D rigid-body physics (Box2D-Lite port) on DOM tickets, drag/toss, spring snaps, stamp press, slide-to-confirm, ticket confetti |
| E | [Ask](e-ask.html) | The page is a conversation: ask the demo house a question and the answer builds its own interface (count card, wine-list read, PO + email, receiving check, tonight's sales) | Raw-WebGL İznik glaze shader reacting to keystrokes, token streaming, FLIP layout morphing (hero input docks to composer), self-asking auto-play |
| B2 | [The House](b2-house-cellar.html) | Round 2. B set inside a whole restaurant: street, door, dining room, bar (a Toast sale pulses to a back-bar bottle, 5 → 4), kitchen pass, stairs, B's four cellar chapters, then a cutaway of the whole house | B's engine plus procedural rooms, raycast hover/tap cards on any bottle, drag-to-look, "Walk the cellar" free roam (arrows/WASD/drag/touch pads), per-room culling, SVG cutaway fallback |
| F | [A Day in the Life](f-day.html) | Round 2. Opens as the /login book (sketch 118 B look); pages turn and the drawing of a demo house comes alive: menu photographed into digital, Toast sales, the delivery truck and pre-checked invoice, "food comes in, wine comes in", the wine camera; a live house-website panel updates on every event | Segmented 3D CSS page curls, sticky-stage scroll timeline, `pathLength` stroke reveals with a `viewBox` camera, teal data links with travelling dots, diffing website panel, day-to-night palette shift |

Screenshots: [`shots/`](shots/) (Chromium under SwiftShader; a few frames show fallback fonts
because Google Fonts loaded intermittently through the build container's proxy).

## Round 2 (2026-10-03)

The founder: *"my favorites are service and cellar, service being the best explanatory and
cellar being the most interactive"*, asking for the cellar *"in a restaurant environment"* (B2)
and one more page, a restaurant owner's everyday life opening from the /login book (F). His F
brief also says the house's **website** updates automatically from POS sales and uploads; that
is drawn as asked, and nothing in `.planning/decisions/` yet records a public house website that
Mudavym keeps up to date, so treat it as intent, not shipped behaviour.

## How each was checked, and what was not

Every page was screenshot at 1440×900 and 390×844 across its scroll range with Playwright:
zero page errors, no horizontal overflow at 390, and a `prefers-reduced-motion` pass (final
states, no pinning). D's drag/toss and slide-to-confirm and E's five chip answers, Confirm and
free-typed fallback were driven by scripts.

Not verified: frame rate on real hardware (WebGL ran on a software renderer), touch feel on a
real phone, and the opt-in sound in A and D by ear.

## Honesty in the copy

Demo producers are invented where a label is close-up ("Cascina Esempio", "Tenuta Esempio");
wine-list rows in E use real wine names as a menu would. No customers, logos, testimonials,
metrics or prices are claimed. The only integration named is Toast.

## Retire-to-write

This README is the sketch's own index entry, the same shape as sketches 119–124; it retires
nothing. The landing decision itself is OD-214.
