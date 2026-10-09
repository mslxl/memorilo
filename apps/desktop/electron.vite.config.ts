import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import stylex from '@stylexjs/unplugin/vite'
import { tanstackRouter as TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import wasm from 'vite-plugin-wasm'

const desktopRoot = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(desktopRoot, '../..')
const stylexOptions: NonNullable<Parameters<typeof stylex>[0]> & { externalPackages: string[] } = {
  cssInjectionTarget: fileName => fileName.includes('renderer-stylex'),
  externalPackages: ['@memorilo/config', '@memorilo/editor', '@memorilo/ui'],
  unstable_moduleResolution: { type: 'commonJS' },
  useCSSLayers: true,
}

export default defineConfig({
  main: {
    root: resolve(desktopRoot, 'main'),
    build: {
      emptyOutDir: true,
      outDir: resolve(desktopRoot, 'out/main'),
      externalizeDeps: {
        exclude: [
          '@memorilo/config',
          '@memorilo/desktop-config',
          '@memorilo/editor-storage',
          '@memorilo/shelf',
          'effect',
          'fast-xml-parser',
        ],
        include: [
          '@huggingface/transformers',
          '@myriaddreamin/typst-ts-node-compiler',
          '@open-spaced-repetition/binding',
          'better-sqlite3',
          'loro-crdt',
          'sqlite-vec',
          // Keep ws in Node's runtime so its optional native accelerators can
          // fall back cleanly instead of Vite's missing-peer stub throwing.
          'ws',
        ],
      },
      rollupOptions: {
        input: resolve(desktopRoot, 'main/src/index.ts'),
        output: {
          entryFileNames: 'index.js',
        },
      },
    },
  },
  preload: {
    root: resolve(desktopRoot, 'preload'),
    build: {
      emptyOutDir: true,
      outDir: resolve(desktopRoot, 'out/preload'),
      externalizeDeps: false,
      rollupOptions: {
        input: resolve(desktopRoot, 'preload/src/index.ts'),
        output: {
          entryFileNames: 'index.cjs',
          format: 'cjs',
          intro: '(function () {',
          outro: '})();',
        },
      },
    },
  },
  renderer: {
    root: resolve(desktopRoot, 'renderer'),
    define: {
      __MEMORILO_REPO_ROOT__: JSON.stringify(repositoryRoot),
    },
    optimizeDeps: {
      include: ['@memorilo/editor > prosekit/extensions/readonly'],
    },
    plugins: [
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
    },
    build: {
      emptyOutDir: true,
      outDir: resolve(desktopRoot, 'out/renderer'),
      rollupOptions: {
        input: {
          index: resolve(desktopRoot, 'renderer/index.html'),
          settings: resolve(desktopRoot, 'renderer/settings.html'),
        },
      },
    },
  },
})
