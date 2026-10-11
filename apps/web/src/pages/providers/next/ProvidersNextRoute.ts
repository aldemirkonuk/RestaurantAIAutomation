// /vendors' route element (F-1354) as a module default, so App.tsx loads it
// with a plain `lazy(() => import(...))`. The tour-anchor scan
// (guidance/tours/anchors.scan.ts) follows only that form to the page it
// draws; a `.then((m) => ({ default: m.ProvidersNextRoute }))` hid every
// /vendors anchor from it (F-1105).
export { ProvidersNextRoute as default } from './ProvidersNext';
