import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = resolve(import.meta.dirname, 'src/shared')

// Зависимости main и preload externalize-ятся по умолчанию (build.externalizeDeps).
export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    build: { rolldownOptions: { input: resolve(import.meta.dirname, 'src/main/index.ts') } }
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    // Sandbox-preload в Electron исполняется как обычный скрипт без поддержки ESM,
    // поэтому preload собирается в CommonJS даже при "type": "module" в package.json.
    build: {
      rolldownOptions: {
        input: resolve(import.meta.dirname, 'src/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    plugins: [react()],
    publicDir: resolve(import.meta.dirname, 'src/renderer/public'),
    resolve: {
      alias: {
        '@shared': shared,
        '@renderer': resolve(import.meta.dirname, 'src/renderer/src')
      }
    },
    // Worker pdf-content — ES-модуль: MuPDF загружается динамическим import и top-level await.
    worker: { format: 'es' },
    build: {
      minify: true,
      rolldownOptions: { input: resolve(import.meta.dirname, 'src/renderer/index.html') }
    }
  }
})
