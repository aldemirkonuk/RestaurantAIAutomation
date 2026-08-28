# Motion-part contract (063 canvas)

Your file is concatenated into ONE page with four sibling files. Break the contract
and you break the whole canvas.

## File
`.../063-mudavym-motion-canvas/parts/<CAT>.html` — a FRAGMENT, not a document.
No <html>, <head>, <body>, no <title>, no font links (the host page loads
Fraunces, Instrument Sans, JetBrains Mono already).

## Structure
One `<style>` block, then one `<script>` block. Nothing else at top level.

## CSS rules — these make the skin toggle work
- EVERY selector must start with your category prefix: `.mx-<CAT>` (e.g. `.mx-ent .row`).
  A bare `.row {}` will collide with four other files and corrupt them.
- NEVER hard-code a colour. Use only these variables, which the host defines and
  swaps when the viewer flips branded <-> neutral:
  `--m-bg --m-surface --m-sunk --m-line --m-line2 --m-ink --m-mut
   --m-accent --m-accent-ink --m-ok --m-warn --m-no`
  (Branded = warm charcoal ground #15130F + Iznik seal; neutral = greys. You will
  never see the values; if you write a hex, your demo breaks in one of the skins.)
- Fonts: `var(--m-serif)`, `var(--m-sans)`, `var(--m-mono)` only.
- Respect `@media (prefers-reduced-motion: reduce)` — collapse to end state.

## JS — register every motion
```js
window.MUDAVYM_MOTIONS.push({
  id:      'ent-01',                    // '<cat>-NN', unique
  name:    'Staggered arrival',         // short label
  family:  'Entrances & reveals',       // your family name, identical on every item
  purpose: 'One sentence: what it is for and when it fires.',
  spec:    'spring 380/32' | 'cubic-bezier(.16,1,.3,1) 320ms',   // human-readable
  html:    '<div class="mx-ent-01">...</div>',   // markup string, self-contained
  play:    (root) => { /* root is the element your html rendered into */ }
});
```
- `play(root)` must be **idempotent**: reset to the start state, force reflow
  (`void root.offsetWidth`), then animate. It will be called many times.
- Demos must animate on their own with no user gesture — but where the motion IS a
  gesture (hold-to-confirm, drag), also wire the real interaction inside `play`'s
  markup so the founder can try it.
- Keep each demo inside roughly a 280x150 card. The host lays them out in a grid.
- Vanilla JS only. No imports, no CDNs, no build step.

## Quality bar
Real numbers, not vibes: springs are simulated (sample into a CSS `linear()` easing)
or hand-tuned with stated stiffness/damping. Every motion needs a REASON tied to
restaurant operations — an owner approving money, a porter at the door with a phone
at 12%, a manager reading a discrepancy queue at 1am.
