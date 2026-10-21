import type { Plugin } from 'vite'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import stylex from '@stylexjs/unplugin/vite'
import { tanstackRouter as TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'

const desktopRoot = dirname(fileURLToPath(import.meta.url))
const rendererRoot = resolve(desktopRoot, 'renderer')
const repositoryRoot = resolve(desktopRoot, '../..')
const localesRoot = resolve(repositoryRoot, 'locales')

function localeHmr(): Plugin {
  const isLocaleJson = (path: string): boolean => {
    const localePath = relative(localesRoot, path)
    return !isAbsolute(localePath)
      && !localePath.startsWith('..')
      && localePath.endsWith('.json')
  }

  return {
    configureServer(server) {
      server.watcher.add(localesRoot)
    },
    handleHotUpdate({ file, server }) {
      if (!isLocaleJson(file))
        return
      server.ws.send({ event: 'memorilo:locale-update', type: 'custom' })
      // Locale JSON is loaded into i18next by the custom event below. Returning
      // no modules prevents Vite's parallel JSON update from reaching the HTML
      // entry and intermittently turning the hot update into a full reload.
      return []
    },
    name: 'memorilo-locale-hmr',
  }
}

const stylexOptions: NonNullable<Parameters<typeof stylex>[0]> & { externalPackages: string[] } = {
  cssInjectionTarget: fileName => fileName.includes('renderer-stylex'),
  externalPackages: ['@memorilo/config', '@memorilo/editor', '@memorilo/ui'],
  unstable_moduleResolution: { type: 'commonJS' },
  useCSSLayers: true,
}

// Standalone renderer dev server used by the i18n hot-reload e2e test. It mirrors the
// renderer plugins from `electron.vite.config.ts` and broadens `server.fs.allow` so the
// repository-root `locales/` directory is served (and watched for HMR).
export default defineConfig({
  root: rendererRoot,
  define: {
    // Used only by the renderer HMR handler to re-read locale files in development.
    __MEMORILO_REPO_ROOT__: JSON.stringify(repositoryRoot),
  },
  optimizeDeps: {
    // TanStack's route splitting and the linked editor package hide dependencies
    // from Vite's default HTML crawl. Scan their production sources up front so
    // cold dependency optimization cannot reload the page during an HMR assertion.
    entries: [
      'index.html',
      'settings.html',
      'src/**/*.{ts,tsx}',
      '!src/**/*.test.{ts,tsx}',
      '!src/**/*.node.test.{ts,tsx}',
      '!src/test/**',
      '../../../packages/editor/src/**/*.{ts,tsx}',
      '!../../../packages/editor/src/**/*.test.{ts,tsx}',
      '!../../../packages/editor/src/**/*.node.test.{ts,tsx}',
      '!../../../packages/editor/src/test/**',
    ],
  },
  plugins: [
    localeHmr(),
    wasm(),
    TanStackRouterVite({
      target: 'react',
      autoCodeSplitting: true,
    }),
    stylex(stylexOptions),
    react(),
  ],
  server: {
    fs: {
      allow: [repositoryRoot],
    },
    host: '127.0.0.1',
    port: 5199,
    strictPort: true,
    // This server watches locale bundles outside its renderer root. Native Windows
    // file events are unreliable for that boundary, while polling keeps the HMR
    // contract deterministic for the standalone development server.
    watch: {
      interval: 100,
      usePolling: true,
    },
  },
  build: {
    outDir: resolve(desktopRoot, 'out/renderer-dev'),
  },
  publicDir: false,
})
