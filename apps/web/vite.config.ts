import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { crawlSurface } from './src/lib/seo/vite-plugin'
import { buildProvenancePlugin } from './src/lib/build-provenance'

// https://vitejs.dev/config/
// Using @vitejs/plugin-react (Babel) instead of react-swc due to SWC binary issues
export default defineConfig({
  // buildProvenancePlugin writes the <meta name="mudavym:commit"> tag every
  // served page carries (ADR 0219); crawlSurface writes robots.txt, sitemaps,
  // llms.txt and each public route's served head from the built shell (ADR
  // 0158), reading dist/index.html AFTER Vite has already written it with the
  // commit tag in place (see build-provenance.ts's own note on hook order).
  plugins: [react(), buildProvenancePlugin(), crawlSurface()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@wineops/ui': path.resolve(__dirname, '../../packages/ui/src'),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    port: 3000,
    host: '127.0.0.1',
    watch: {
      ignored: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // Was `true`: production served a 6.86 MB source map with sourcesContent,
    // from which the whole deployed src/ (including security reasoning in
    // comments) could be rebuilt (2026-09-17 finding). No @sentry/vite-plugin
    // is installed, so nothing consumes a map to upload it — 'hidden' would
    // still write and ship the file. `false` stops generating it.
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          ui: ['@tremor/react', 'framer-motion', 'lucide-react'],
        },
      },
    },
  },
})
