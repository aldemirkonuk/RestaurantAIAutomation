# Sketch 043 · Motion Signature Moments

**Design question:** What four mobile motions make WineOps inventory/receiving feel premium and unmistakable — and how should RN Skia + Reanimated implement them?

**Production stack:** React Native Skia + Reanimated (see sketch 042). This HTML sketch simulates timing, easing, and gesture thresholds for handoff to native.

## Four motions

| Tab | Moment | Where it lives | Interaction |
|-----|--------|----------------|-------------|
| **Feed zero** | Empty activity feed | Inventory / ops feed | Auto-play on mount; replay button |
| **Wax seal approve** | Manager sign-off on receiving | Receiving workspace | Tap button or seal zone |
| **Liquid receiving fill** | Zone fills as lines are stocked in | Receiving / cellar zones | Tap "Stock in next line" |
| **Skia pour PTR** | Pull-to-refresh on feed | Activity feed | Drag down inside phone |

## Motion specs (summary)

### Feed zero
- Ghost bottle rises with spring (opacity + translateY)
- Concentric cellar rings pulse slowly (2.4s loop)
- Copy staggers in at 400ms / 650ms
- Haptic: light impact once on appear

### Wax seal approve
- Gold radial splash on press
- Seal stamp: scale 2.2 → 0.88 → 1.06 → 1.0 (spring overshoot)
- Button transitions to green "Approved"
- Skia: radial gradient wax + optional noise for irregular edge

### Liquid receiving fill
- Each confirmed line raises zone liquid height (900ms ease-out)
- Surface wave shimmer at liquid top
- Count morphs with timing animation
- Near 85%: shift gradient to amber (not in sketch, spec for prod)

### Skia pour pull-to-refresh
- Thresholds: 0–40px hint, 40–120px pour grows, 120px+ triggers refresh
- Canvas bezier pour stream + glass fill tied to pull distance
- Release: 800ms refresh + spring snap-back
- `runOnJS` for data fetch on release

## View
```
open .planning/sketches/043-motion-signature-moments/index.html
```
