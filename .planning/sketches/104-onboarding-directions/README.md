---
sketch: 104
name: onboarding-directions
question: "What shape should a house's first hour with Mudavym take — and where, exactly, does the one seal land?"
winner: null
tags: [onboarding, register, invite, verify-email, get-started, currency, cellar-registers, vendor-terms, notification-producers, config-assistant, adr-0108, adr-0113, adr-0133, mudavym]
---

# Sketch 104 · The arrival, five ways

## Design question

The founder, 2026-08-29, on `/onboarding`: *"Let's add more uniqueness here. This needs more
improvements… maybe create five more sketches for this."* On `/register`: *"it's the most
important step."* On `/invite/:code`: the arriving person's context should *"come up as if they
signed in."* And on 2026-09-03: *"let AI assistant talk with you and handle all the configs then
approval button"* — which became ADR 0113 and sketch 101.

The parent session's brief for this wave: the arrival must ask the house's **currency**, its
**cellar registers** (infer, then confirm — ADR 0108/0115), its **vendor terms** (every column
NULL until stated — ADR 0116), its **notification producers** (defaults kept, offered), and offer
the **configuration assistant** (ADR 0113; `config.propose_batch` is proposed, not built). Every
direction covers both doors of `/register`, the letter, and the first evidence, at 1440 and one
390 px frame of the step a manager does standing up.

Binding contract for all five: `/Users/aldemirkonuk/Projects/p4-scratch/newpages/SKETCH-CONTRACT.md`
(the house tokens, one chromatic colour, no emoji, absence is never health, the assistant proposes
and the seal applies, the three overlay shapes, motion from the house tokens, honest endpoints,
example data only). Each `.md` beside its `.html` names every route the direction writes through,
by `file:line`, the two roads not taken inside the direction, and the honest gaps.

## The five directions

| Letter | Name | The shape | What comes first | Where the seal lands |
|---|---|---|---|---|
| A | First evidence | a sequence of five screens | one invoice photographed at the door | the first row entering the book |
| B | The interview | talk on the left, rows on the right | the conversation | the batch of rows, item by item |
| C | The house's book | a bound book with a contents page carrying state | the flyleaf, then any folio | fo. 5, the assistant's batch |
| D | The invitation | one door ("Who is expecting you?"), then the record | the invitation code | the founding of a house, held once |
| E | Set the table | one screen, mise en place | nothing — everything at once, grey until confirmed | the foot of the table |

What all five share, because the house rules demand it: a skip is a recorded fact (no writer
exists today — every sketch says so on the screen); nothing inferred is written before the seal;
the wax lands once; "not yet answered" is a stated state; Google sign-up is drawn unavailable
because no route takes it; the assistant's batch is drawn with the sentence that it is not built.

## Review surface

Artifact **The Arrival, Five Ways** — <https://claude.ai/code/artifact/1d40bc3d-6ddd-49c6-b894-e626fc7f72ad>
— the five sketches live (each in its own frame, with its Paper / Charcoal control), the notes
condensed beside them, an elimination table, and a Keep / Rework / Merge / Out control per
direction persisted in the artifact's record under `verdicts/<letter>`. Update that artifact;
never republish a new one. The founder's pick is asked in session (AskUserQuestion) and
recorded here under `winner:` and in ADR 0133's trail when made.

## Forks the sketches surfaced (founder's call, not decided here)

1. The inviter's **name** on the unauthenticated invite preview (`invite-landing.md` §13.4) — D
   draws it and flags it; the finder for `/login`+`/register` builds the sentence name-optional.
2. Whether an invitation **binds to `targetEmail`** (`invite-landing.md` §13.3).
3. Whether the seal at account creation (D; `/register` improvement item 6) reads "Founded" or
   "Founded — the house waits for one letter", and whether `HoldToApprove` is right for a
   first-time user.
4. Google **sign-up** — the finder's smallest honest slice is the invitation first, Google as the
   credential on `POST /auth/join` (an additive DTO field); whether Google's `email_verified`
   claim satisfies ADR 0023 for an owner is open.

## Files

- `direction-a.html` / `direction-a.md` — First evidence
- `direction-b.html` / `direction-b.md` — The interview
- `direction-c.html` / `direction-c.md` — The house's book
- `direction-d.html` / `direction-d.md` — The invitation
- `direction-e.html` / `direction-e.md` — Set the table

Drawn 2026-09-06 by five agents in parallel on branch `feat/mudavym-new-pages` (three of them
resumed on 2026-09-11 after the weekly limit cut their notes short); the repo facts in the notes
were measured on that worktree at `5443a0b8`. Nothing under `apps/` was changed. Example houses
only: Lokanta Meyhane (İstanbul, TRY), The Old Mill (Michigan, USD); Hasan, Defne, Marcus.
