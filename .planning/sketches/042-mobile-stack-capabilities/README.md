---
sketch: "042"
name: mobile-stack-capabilities
question: "Which mobile stack hits SOTA design and animation — reusability ignored?"
winner: H RN Skia + Reanimated (cross-platform motion); D SwiftUI (iOS ceiling); F KMP + Platform UI (both platforms native)
tags: [mobile, design, animation, motion, sota, expo, react-native, flutter, swiftui, kmp, skia, reanimated, stack-decision]
---

# Sketch 042: Mobile Stack · Design & Motion

## Design Question
Reusability, monorepo sharing, and dev speed are **out of scope**. Only animation ceiling, platform polish, gesture quality, visual depth, and spatial FX matter. Which stack delivers award-tier mobile craft for WineOps?

## How to View
```
open .planning/sketches/042-mobile-stack-capabilities/index.html
```

## Scoring Dimensions (0–100)
| Dimension | What it measures |
|-----------|-----------------|
| Animation | Spring physics, hero transitions, interruptible motion |
| Platform feel | Apple HIG / Material You native chrome |
| Gestures | Drag, swipe, pinch — responsiveness and polish |
| Visual depth | Glass, blur, layering, typography craft |
| Micro-motion | Press states, haptics, ripple, stagger |
| Spatial FX | AR, liquid fills, particles, 3D |

## Variants & Design Rankings

### Tier S — SOTA
| Stack | Animation | Platform | Best for |
|-------|-----------|----------|----------|
| **H: RN Skia + Reanimated** ★ | 99 | 78 | Living cellar map, liquid fills, custom motion language |
| **D: SwiftUI** | 92 | **100** | iOS-only staff, Live Activities, glass + springs |
| **C: Flutter** | 95 | 82 | Cross-platform 120fps Impeller, hero transitions |
| **F: KMP + Platform UI** | 90 | 98 | SwiftUI + Compose — native feel both platforms |

### Tier A — Strong
| Stack | Notes |
|-------|-------|
| **E: Expo + Native** | ARKit scan + Reanimated; spatial FX 95, everyday UI 85 |
| **B: Bare RN** | Metal shaders, ARKit — spatial only, UI same as Expo |
| **A: Expo + Router** | Reanimated 4 springs, expo-blur — solid, not ceiling |

### Tier F — Disqualified for SOTA
| Stack | Why |
|-------|-----|
| **G: Capacitor** | CSS transitions, scroll jank, WebView feel |
| **I: PWA** | Safari throttles, no haptics, flat motion |

## Recommendation (design-only)
- **Cross-platform + custom motion:** RN Skia + Reanimated (H) — liquid cellar bins, particle gauge, 120fps gestures
- **iOS-only max polish:** SwiftUI (D) — Dynamic Island, matchedGeometry, interruptible springs
- **Both platforms, native chrome:** KMP + SwiftUI/Compose (F)
- **Never for design goals:** Capacitor (G), PWA (I)

## What to Look For
- Does **H**'s particle canvas + liquid gauge feel like the living cellar sketch (041)?
- Does **D**'s glass card press state feel indistinguishable from a native Apple app?
- Does **C**'s ripple + scroll bar demo feel smoother than **A**'s spring ball?
- Are **G** and **I** obviously in a different (worse) league?
