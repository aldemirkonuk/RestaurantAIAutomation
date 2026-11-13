/**
 * The animation features the shell's `m` components use (fades, slides,
 * presence), loaded after the first paint by `LazyMotion` in App.tsx so the
 * entry chunk every page loads does not carry them (r19 bundle walk,
 * 2026-11-13). Shell files import `m`, not `motion`; a page loaded on its own
 * route may still import `motion`, which carries its own features.
 */
export { domAnimation as default } from 'framer-motion'
