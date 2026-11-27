/**
 * A stranger's first paint on `/` and `/register` (p6 perf-p6-3).
 *
 * The Landing page is a lazy chunk (App.tsx), so the browser learns of it only
 * when the entry has executed: Landing, its icon chunks, landing.css and the
 * DM Sans file were each requested after that (measured at 914 / 918 / 1418 ms
 * on a cold /register at 375 px, 4x CPU, Fast-4G). This writes the chunk list
 * into the shell so those requests start with the entry's own.
 *
 * It is scoped by a tiny inline pathname check, not written as plain tags:
 * every other route (the signed-in app) would otherwise pay for bytes it never
 * draws. A person holding an access token is not a stranger, so `/` does not
 * preload for them either (RootDoor sends them into the app).
 */
import type { HtmlTagDescriptor, Plugin } from 'vite'

/** The one font Landing draws above the fold (self-hosted, public/fonts). */
export const LANDING_FONT = '/fonts/dm-sans-latin-normal.woff2'

interface BundleChunk {
  type: 'chunk'
  fileName: string
  isEntry?: boolean
  facadeModuleId?: string | null
  imports: string[]
  viteMetadata?: { importedCss?: Set<string> }
}
type Bundle = Record<string, { type: string; fileName: string } & Partial<BundleChunk>>

export interface LandingPreload {
  scripts: string[]
  styles: string[]
  fonts: string[]
}

/** The Landing chunk, its static imports the entry does not already load, and its css. */
export function landingPreloadFiles(bundle: Bundle): LandingPreload | null {
  const chunks = Object.values(bundle).filter((c): c is BundleChunk => c.type === 'chunk')
  const landing = chunks.find((c) => /[\\/]pages[\\/]landing[\\/]Landing\.tsx$/.test(c.facadeModuleId ?? ''))
  if (!landing) return null
  const byName = new Map(chunks.map((c) => [c.fileName, c]))
  const closure = (roots: string[]) => {
    const seen = new Set<string>()
    const stack = [...roots]
    while (stack.length) {
      const f = stack.pop()!
      if (seen.has(f)) continue
      seen.add(f)
      for (const i of byName.get(f)?.imports ?? []) stack.push(i)
    }
    return seen
  }
  const alreadyLoaded = closure(chunks.filter((c) => c.isEntry).map((c) => c.fileName))
  const scripts = [...closure([landing.fileName])].filter((f) => !alreadyLoaded.has(f))
  const styles = [...scripts].flatMap((f) => [...(byName.get(f)?.viteMetadata?.importedCss ?? [])])
  return { scripts, styles, fonts: [LANDING_FONT] }
}

/** Runs before first paint, appends the link tags only for a stranger on / or /register. */
export function landingPreloadScript(p: LandingPreload): string {
  const links: Array<[string, string, string?]> = [
    ...p.scripts.map((f): [string, string] => ['modulepreload', `/${f}`]),
    ...p.styles.map((f): [string, string, string] => ['preload', `/${f}`, 'style']),
    ...p.fonts.map((f): [string, string, string] => ['preload', f, 'font']),
  ]
  return (
    `(function(){try{var p=location.pathname.replace(/\\/+$/,'')||'/';` +
    `if((p!=='/'&&p!=='/register')||localStorage.getItem('accessToken'))return;` +
    `var L=${JSON.stringify(links)};` +
    `for(var i=0;i<L.length;i++){var l=document.createElement('link');l.rel=L[i][0];l.href=L[i][1];` +
    `if(L[i][2]){l.as=L[i][2];if(L[i][2]==='font')l.type='font/woff2'}l.crossOrigin='';document.head.appendChild(l)}}catch(e){}})();`
  )
}

export function landingPreloadPlugin(): Plugin {
  return {
    name: 'mudavym-landing-preload',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx): HtmlTagDescriptor[] {
        const files = ctx.bundle ? landingPreloadFiles(ctx.bundle as unknown as Bundle) : null
        if (!files) return []
        return [{ tag: 'script', children: landingPreloadScript(files), injectTo: 'head' }]
      },
    },
  }
}
