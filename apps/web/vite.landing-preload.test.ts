// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { landingPreloadFiles, landingPreloadPlugin, landingPreloadScript, LANDING_FONT } from './src/lib/landing-preload'
import viteConfig from './vite.config'

const chunk = (fileName: string, o: Record<string, unknown> = {}) => ({ type: 'chunk', fileName, imports: [], ...o })
const bundle: any = {
  'assets/index-A.js': chunk('assets/index-A.js', { isEntry: true, imports: ['assets/vendor-V.js', 'assets/shared-S.js'] }),
  'assets/vendor-V.js': chunk('assets/vendor-V.js'),
  'assets/shared-S.js': chunk('assets/shared-S.js'),
  'assets/Landing-L.js': chunk('assets/Landing-L.js', {
    facadeModuleId: '/repo/apps/web/src/pages/landing/Landing.tsx',
    imports: ['assets/index-A.js', 'assets/vendor-V.js', 'assets/shared-S.js', 'assets/coins-C.js'],
    viteMetadata: { importedCss: new Set(['assets/landing-X.css']) },
  }),
  'assets/coins-C.js': chunk('assets/coins-C.js', { imports: ['assets/index-A.js'] }),
  'assets/Other-O.js': chunk('assets/Other-O.js', { facadeModuleId: '/repo/apps/web/src/pages/Other.tsx' }),
  'assets/landing-X.css': { type: 'asset', fileName: 'assets/landing-X.css' },
}

function run(script: string, pathname: string, token: string | null) {
  const added: Array<Record<string, string>> = []
  const el = () => {
    const o: Record<string, string> = {}
    return o
  }
  const document = { createElement: el, head: { appendChild: (l: Record<string, string>) => added.push(l) } }
  new Function('location', 'document', 'localStorage', script)(
    { pathname },
    document,
    { getItem: () => token },
  )
  return added
}

describe('the Landing preload written into the built shell', () => {
  it('names the Landing chunk and the chunks only it needs, plus its css and font', () => {
    const f = landingPreloadFiles(bundle)!
    expect(f.scripts.sort()).toEqual(['assets/Landing-L.js', 'assets/coins-C.js'])
    expect(f.styles).toEqual(['assets/landing-X.css'])
    expect(f.fonts).toEqual([LANDING_FONT])
  })

  it('writes nothing when the build has no Landing chunk', () => {
    expect(landingPreloadFiles({ 'a.js': chunk('a.js', { isEntry: true }) } as any)).toBeNull()
  })

  it('is part of the real build config', () => {
    expect((viteConfig.plugins as Array<{ name?: string }>).some((p) => p?.name === 'mudavym-landing-preload')).toBe(true)
  })

  it('injects one inline script into the head, only when a bundle is present', () => {
    const plugin: any = landingPreloadPlugin()
    const tags = plugin.transformIndexHtml.handler('', { bundle })
    expect(tags).toHaveLength(1)
    expect(tags[0]).toMatchObject({ tag: 'script', injectTo: 'head' })
    expect(plugin.transformIndexHtml.handler('', {})).toEqual([])
  })

  describe('the pathname check', () => {
    const script = landingPreloadScript(landingPreloadFiles(bundle)!)
    it.each(['/', '/register', '/register/'])('a stranger on %s preloads the chunk, css and font', (path) => {
      const added = run(script, path, null)
      expect(added.map((l) => `${l.rel} ${l.href}`)).toEqual([
        'modulepreload /assets/Landing-L.js',
        'modulepreload /assets/coins-C.js',
        'preload /assets/landing-X.css',
        `preload ${LANDING_FONT}`,
      ])
      expect(added.find((l) => l.rel === 'preload' && l.as === 'font')).toMatchObject({ type: 'font/woff2', crossOrigin: '' })
    })
    it.each(['/inventory', '/login', '/l/day', '/registered', '/house/menu'])('%s preloads nothing', (path) => {
      expect(run(script, path, null)).toEqual([])
    })
    it('a person holding an access token preloads nothing, even on /', () => {
      expect(run(script, '/', 'a.b.c')).toEqual([])
    })
  })
})
