# `.planning/brand/` — brand/design corpus

Founder-produced Claude Design canvases and build-prompt artifacts for the
Mudavym brand rollout. Added here (a subdirectory, per CLAUDE.md §4 — never a
new top-level `.planning/*` file) on 2026-09-11/12; see
[0136](../decisions/0136-session-2026-09-11-p1-readout-and-brand-sync-push.md)
for the session record and why each file exists.

| File | What it is |
|---|---|
| `BUILDPROMPT.md` | Overlay-packet build prompts derived from sketch 102's census — dispatched separately as packets 0–2. |
| `Mudavym Overlay Sketches.dc.html` | The founder's reviewed 10-sketch canvas — source material for ADR 0134's still-open motion/overlay forks. |
| `Mudavym Motion Canvas.dc.html` | The founder's motion-token canvas (85 demos, 2026-08-29); curation context in [0044](../decisions/0044-mudavym-implementation-kickoff.md) §4 and sketch [087](../sketches/087-mudavym-motion-canvas/notes.md). |
| `Mudavym Mark.dc.html`, `Mark1.dc.html` | Wordmark/logo search canvases feeding [0043](../decisions/0043-wordmark-interim-logo-search.md); withdrawn candidates recorded in [0046](../decisions/0046-withdrawn-marks-and-mark-colour-risk.md). |
| `PITCHING IDEAS.md` | Founder scratch notes, unstructured — pending triage into a real doc or explicit discard (not yet done; flagged in [0136](../decisions/0136-session-2026-09-11-p1-readout-and-brand-sync-push.md)). |

**Note on the four `.dc.html` canvases:** each carries a `<script src="./support.js">`
tag (Claude Design canvas scaffolding). That file does not exist in this repo, and
nothing under `.planning/` is served by any build — so the canvases are inert
*by absence*, not because they contain no script reference. If `.planning/`
ever becomes reachable from a build path, or a `support.js` is added anywhere
these canvases could resolve it from, re-verify this before treating them as
static/inert.
