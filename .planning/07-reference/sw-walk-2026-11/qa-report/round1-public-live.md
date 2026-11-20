# Round 1: public (unauthenticated) live walk, https://mudavym.com

Date: 2026-11-07. Tester: artificial first-time owner, built-in browser pane. Read-only: no submit, no password typed, no account created. Widths covered: 375 (mobile emulation) and the pane's desktop width (about 509 px wide at start, so the real wide-desktop layout was NOT checked).

Honest limits (shortcuts taken):
- Only 1 of the /l/* variants was found. /l/day returns 200. The six variants named in project memory were not discoverable: guessed slugs (cbm, wine, bar, owner, manager, week, night, cellar, delivery, invoice, orders, vendors, menu, goal and about 20 more) all return 404, and /l/ has no index. The route is not in the sitemap, robots.txt or llms.txt. Slugs of the other variants are needed to walk them.
- The browser pane was co-driven by the founder during the walk (tabs jumped to /login twice with a typed "aldemirk" in the email box, and a passkey "Waiting for your device..." state appeared once from one of my clicks that landed on /login instead of /register). Some register-page interaction results may be affected. No form was submitted.
- Dark mode was emulated via colorScheme on /register?type=join only. Contrast was judged by eye, not measured. Keyboard focus order was not walked.
- Load times are `loadEventEnd` from the Navigation Timing API on a warm connection, plus curl TTFB.

## Timing and network summary

| URL | HTTP | load (ms) | notes |
|---|---|---|---|
| / | 200 | 680 | curl 0.19 s, 6.9 KB shell |
| /l/day | 200 | 329 | |
| /login | 200 | 581 | |
| /register?type=new | 200 | 528 | |
| /terms, /privacy, /story | 200 | not measured | |
| /pricing | 404 | n/a | no pricing page, by design per FAQ |
| /unknown-path | 404 (HTTP) | n/a | then client-redirects to /login, see F-04 |

Failed requests: none on the pages walked, other than the 404 fetch on the unknown path. Third-party: Google Sign-In script (GSI) on /login and /register.

## Findings

### BLOCKER
None found on the public surface.

### BUG

**F-01 BUG: a stray invite-code "x" button overlaps the last characters on mobile, and the error is not announced.**
URL: /register?type=join at 375 px.
Repro: open the URL at 375 px, type 8 characters (for example ZZZZZZZZ). The clear "x" button sits on top of the 7th character, and the first slot looks empty. The result "Code not found, expired, or already used" appears but has no role="alert" (0 alert nodes in the DOM), so a screen reader hears nothing.
Fix: reserve space for the clear button inside the input padding (or move it outside the slots), and add role="alert" / aria-live="polite" to the validation message.

**F-02 BUG: console error on /l/day: `<rect> attribute width: Expected length, "NaN"` (x2).**
URL: /l/day.
Repro: load the page and read the console. An SVG rect gets a NaN width, probably a bar or progress element computed before layout. Page still renders, but the element may be invisible or collapsed.
Fix: guard the width computation (measure after layout, fall back to 0), and find which scene draws the rect.

**F-03 BUG: bare /register shows the whole marketing landing page, not a register screen.**
URL: /register (no query).
Repro: from /register?type=new click the in-form "Back" button. The URL becomes /register and the full landing page renders (title "Mudavym", hero, all sections). Anyone who lands on /register without ?type= (a typed URL, a pasted link, an old bookmark) gets the home page with no sign-up form, and the address bar says "register".
Fix: bare /register should redirect to /register?type=new, or "Back" should go to "/".

**F-04 BUG/HARM: unknown URLs have no 404 page, they silently land on the sign-in screen.**
URL: any non-existent path, for example /this-page-does-not-exist.
Repro: open it. The server answers 404 with the SPA shell titled "Not found · Mudavym", then the client redirects to /login with no message. A first-time visitor who mistypes a link sees "Welcome back." and assumes they have an account or the site is confused. Also logs a failed-resource 404 in the console.
Fix: render a real not-found page (what happened, link to home and to sign in) for unauthenticated users, and do not redirect.

**F-05 BUG: /l/ variant pages are undiscoverable and /l/ itself is a 404.**
URL: /l/, and every guessed slug except /l/day.
Repro: curl -I /l/ returns 404; the sitemap lists only /, /login, /story, /privacy. If the six variants are meant for ad or outreach links that is fine, but nothing on the site or in llms.txt/robots.txt lists them (and robots.txt "Allow" lines do not include /l/, so crawlers are told it is closed).
Fix: confirm the slugs; add them to robots.txt Allow and sitemap if they should be indexed, or add noindex if not. Give /l/ an index or a redirect to /.

### HARM

**F-06 HARM: the Terms of Service page says "This page is a placeholder ... has not been reviewed by a lawyer".**
URL: /terms (linked from the landing footer, /story footer and /privacy).
Repro: open /terms. A restaurant owner about to give an invoice archive and vendor mail to this product reads that the legal terms are a placeholder and "nothing here should be read as legal advice in either direction". The page also says Mudavym "does not ask anyone to accept this page", and the register form has no consent line or link to Terms or Privacy.
Fix: before real customers, ship reviewed terms and a "By creating an account you agree to the Terms and Privacy" line with links on /register. If shipping the placeholder is a deliberate, founder-approved choice for the first houses, keep it but remove "placeholder / not reviewed by a lawyer" wording from public view or move it behind a plain "draft" label with a date.

**F-07 HARM: privacy page says questions are sent to an AI provider "outside Turkey".**
URL: /privacy, section "Questions you ask Mudavym".
Repro: read that section. The site presents as a San Francisco company with US restaurants ("Built in San Francisco"), yet the data-location sentence is framed around Turkey (also: the FAQ says invoices are read in "English and Turkish"). For a US owner this is confusing; it reads as a leftover from another market. It also leaves the real question (which provider, which country) unanswered.
Fix: name the actual provider and region (or say "a third-party AI provider in the United States"), and drop the Turkey framing unless the house is in Turkey.

**F-08 HARM (consistency of claims): the landing page says "No advertising or tracking scripts" while /privacy says the deployment may enable "optional interaction telemetry and Sentry error monitoring".**
URLs: / section 08 (Your data) versus /privacy "Usage and error reporting". Also the login/register pages load Google's GSI script, which fires FedCM and One Tap prompts.
Fix: make the two statements agree (say error monitoring exists and what it sees), and say the Google sign-in script loads on sign-in pages. "The deployment controls whether ..." is non-committal; state what production actually does.

### SMOOTH

**F-09 SMOOTH: /register?type=new has no way to reach sign-in.**
URL: /register?type=new. The page has no link to "Already have an account? Sign in" (links array is empty); the only escape is "Back", which lands on the landing page (F-03). /login has "Create one now" but the reverse is missing.
Fix: add "Have an account? Sign in" under the form.

**F-10 SMOOTH: the create-account button is disabled with no hint, and bad input gives no inline message.**
URL: /register?type=new at 375 px.
Repro: type "abc" in email, "short" in password, "other" in confirm, then blur. No error text appears under any field; "Create account" stays greyed. The only hint is the static "Min. 8 characters". A mismatch between password and confirm is never named.
Fix: inline messages on blur ("Enter a valid email", "Passwords do not match") and a visible reason for the disabled button.

**F-11 SMOOTH: placeholders look like filled-in values.**
URL: /register?type=new. The placeholders are dark grey "John Smith", "john@myrestaurant.com" and a row of "••••••••" in both password fields (screenshot). At a glance the form looks pre-filled, and the password dots look like a saved password. Placeholder colour is nearly the same weight as typed text.
Fix: lighter placeholder colour and no bullet-character placeholder in password fields.

**F-12 SMOOTH: register fields lack autocomplete attributes.**
URL: /register?type=new. All four inputs have autocomplete="" (name, email, password, confirm). Password managers do not offer "new password" suggestions; mobile keyboards do not offer the saved name/email.
Fix: autocomplete="name", "email", "new-password" (twice).

**F-13 SMOOTH: Google One Tap / FedCM console noise on /login and /register.**
Console: `[GSI_LOGGER]: FedCM get() rejects with NetworkError / AbortError`, `Prompt dismissed. API exponential cool down not triggered.` (errors) and a FedCM migration warning. Repeats on every navigation.
Fix: opt in to FedCM per the migration guide, and stop calling the display-moment status methods; do not auto-prompt One Tap on a page where the owner may be typing an email.

**F-14 SMOOTH: first-time hero flashes blank at 375 px.**
URL: / at 375 px. The first screenshot after navigation shows only the header and dot-grid background; the headline, copy and buttons appear about 1 to 3 seconds later. Entrance animation delays the largest content. On slow phones this can read as a broken page.
Fix: render hero text immediately (animate transforms only, not opacity from 0), and respect prefers-reduced-motion.

**F-15 SMOOTH: dev logging left in production.**
Console on every page: `🔌 Initializing WebSocket connection...`, `[SyncManager] Initialized {isOnline: true}`, `[SyncManager] Processing 0 pending mutations`. These run for signed-out visitors on marketing pages, which do not need a socket or an offline-sync manager (also extra work on the landing page).
Fix: do not start the socket and sync manager until after sign-in, and strip debug logs.

### IMPROVE

**F-16 IMPROVE: Toast status is described three different ways.**
Landing roadmap: Toast "In progress". FAQ: "A Toast connection is partly built". /l/day: "12:40. Lunch. Orders go through the POS, Toast ... Nobody typed a thing", which reads as live today. A restaurant that uses Toast will believe it works now.
Fix: label the /l/day Toast scene "sample" the same way the home page does, or soften to the status in the FAQ.

**F-17 IMPROVE: internal vocabulary in customer-facing copy.**
- FAQ: "A till can send its checks today through a signed feed" (jargon: "signed feed", "till" is also British; US owners say POS or register).
- /terms: "Settings → Questions and training"; /privacy: "Settings → Training use" (two names for the same switch; and "training export", "No training has started").
- /privacy: "Where an older page is enabled, connection controls remain under Settings." (internal migration note), "The deployment controls whether ..." (ops wording).
- /register: "The house comes after you verify.", "Who keeps this book?", "A new set of books" and /login "Kept, page by page." are on-brand but the metaphor ("book") may slow a rushed owner; the register heading does not say it is a sign-up.
Fix: one name for the setting, plain words for the feed, delete the migration sentence.

**F-18 IMPROVE: pages lack an h1 (accessibility).**
URLs: /login, /register (h1 count 0; the heading is an h2 or styled div), /privacy. Screen reader users have no page title landmark. /, /l/day and /story each have one h1. Also /login and /register show no `<main>` landmark in the text extract (source element is `<body>`).
Fix: make "Welcome back." / "Who keeps this book?" the h1 and wrap forms in `<main>`.

**F-19 IMPROVE: small tap targets at 375 px.**
URL: /. Footer links "The story" (61x22), "Privacy" (47x22), "Terms" (39x22), "I have an invite code" (144x20) and the brand link (106x18) are under 32 px tall. The Back button on register is 54x20.
Fix: pad links to 44 px high, or add spacing in the footer.

**F-20 IMPROVE: no dark theme.**
With prefers-color-scheme: dark emulated, /register?type=join and / stay light. Nothing is broken, but a late-night bar owner gets a bright page. Low priority; note only because the brief asked.

**F-21 IMPROVE: /l/day repeats "Sign in" ten times.**
URL: /l/day. The DOM has 10 "Sign in" links in a row (one per scene, hidden or overlapping on the visual), plus the "Skip to Start free" link. Screen reader and tab-key users hit ten identical links.
Fix: render the per-scene sign-in link only once, or make the extras aria-hidden / tabindex -1.

**F-22 IMPROVE: sitemap and robots disagree.**
sitemap-pages.xml lists /, /login, /story, /privacy. robots.txt allows /register and /terms (and /v/), but the sitemap omits them, and llms.txt omits them too. Low impact; makes the crawl surface harder to reason about.

**F-23 IMPROVE: landing FAQ answers are inside collapsed details and are missing from the page text extract.**
URL: /. Only the questions appear in text extracts until opened (summary elements have no aria-expanded, native details). This is fine for humans; just note that search and answer engines may weigh the FAQ lower. Cost and language answers are valuable ("Nothing, for the first houses"; "English and Turkish").

## What worked well

- Landing copy is concrete, every sample number is labelled as invented, and the "asks first" section is clear.
- Invite-code field auto-validates and gives a plain error ("Code not found, expired, or already used").
- No horizontal scroll at 375 px on /, /story, /login or /register (scrollWidth 375).
- Fonts are self-hosted; the landing makes only 5 first-party requests.
- robots.txt, llms.txt and security headers (HSTS, nosniff, frame options, permissions-policy) are in place.
- /story loads clean (no console messages).

## Counts

BLOCKER 0, BUG 5 (F-01 to F-05), HARM 3 (F-06 to F-08), SMOOTH 7 (F-09 to F-15), IMPROVE 8 (F-16 to F-23). F-04 is both a bug and a harm; counted once as BUG.
