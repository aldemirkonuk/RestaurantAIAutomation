import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react-swc'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['**/*.{test,spec}.{ts,tsx}'],
    // e2e/** holds Playwright specs (run via `test:e2e`); they use Playwright
    // globals and must not be picked up by the vitest unit runner.
    exclude: [
      'node_modules',
      'dist',
      '.storybook',
      'storybook-static',
      'e2e/**',
      '**/e2e/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: [
        'src/components/**/*.{ts,tsx}',
        'src/contexts/**/*.{ts,tsx}',
        'src/hooks/**/*.{ts,tsx}',
        'src/lib/**/*.{ts,tsx}',
        'src/pages/**/*.{ts,tsx}',
      ],
      exclude: [
        '**/*.stories.{ts,tsx}',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        '**/types/**',
        '**/data/**',
        '**/__tests__/**',
        '**/index.{ts,tsx}',
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@wineops/ui': path.resolve(__dirname, '../../packages/ui/src'),
    },
  },
})
