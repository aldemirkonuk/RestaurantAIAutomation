// SCRATCH — P3 harness network guard. Never committed. Runs before any app
// module: nothing on this page may reach the gateway or any other host.
const blocked = (u: string) => {
  try {
    const url = new URL(u, location.href)
    return url.origin !== location.origin || /^\/(api|auth|inventory|procurement|settings|cellar)/.test(url.pathname)
  } catch { return true }
}
const w = window as unknown as Record<string, unknown>
w.__hblocked = [] as string[]
const realFetch = window.fetch.bind(window)
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (blocked(u)) { (w.__hblocked as string[]).push('fetch ' + u); return Promise.reject(new TypeError('harness: network blocked')) }
  return realFetch(input, init)
}) as typeof fetch
const open = XMLHttpRequest.prototype.open
XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, u: string | URL, ...rest: unknown[]) {
  if (blocked(String(u))) { (w.__hblocked as string[]).push('xhr ' + method + ' ' + u); throw new Error('harness: network blocked') }
  return (open as (...a: unknown[]) => void).call(this, method, u, ...rest)
} as typeof XMLHttpRequest.prototype.open
const RealWS = window.WebSocket
window.WebSocket = function (u: string | URL, p?: string | string[]) {
  const url = new URL(String(u), location.href)
  if (url.port !== location.port) { (w.__hblocked as string[]).push('ws ' + u); throw new Error('harness: socket blocked') }
  return new RealWS(u, p)
} as unknown as typeof WebSocket
export {}
// An off-screen WebKit window gets no animation frames, so motion would stall
// at its first frame. Frames come from a timer here, and every Web Animation
// jumps to its end state.
window.requestAnimationFrame = ((cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16)) as typeof requestAnimationFrame
window.cancelAnimationFrame = ((id: number) => window.clearTimeout(id)) as typeof cancelAnimationFrame
const realAnimate = Element.prototype.animate
Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
  const an = realAnimate.apply(this, args)
  try { an.finish() } catch { /* an infinite animation cannot finish */ }
  return an
}
