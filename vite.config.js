import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const ooxmlWebcryptoFallback = path.join(rootDir, 'src/lib/ooxmlWebcrypto.js')

/** 包内是相对路径 import，alias 匹配不到；按解析后的绝对路径替换。 */
function ooxmlWebcryptoFallbackPlugin() {
  return {
    name: 'ooxml-webcrypto-fallback',
    enforce: 'pre',
    resolveId(id, importer) {
      if (!importer || !id.includes('webcrypto')) return null
      const resolved = path.resolve(path.dirname(importer), id).replace(/\\/g, '/')
      if (resolved.endsWith('ooxml-encryption/dist/crypto/webcrypto.js')) {
        return ooxmlWebcryptoFallback
      }
      return null
    },
  }
}

export default defineConfig({
  plugins: [ooxmlWebcryptoFallbackPlugin(), react()],
  // Node 内置模块不被打包到浏览器 bundle（快照重建在服务端运行，前端只调 API）
  build: {
    rollupOptions: {
      external: ['crypto', 'module', 'fs', 'path', 'os', 'child_process', 'better-sqlite3'],
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: false,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
    },
  },
  preview: {
    host: '127.0.0.1',
  },
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    server: {
      deps: {
        inline: ['ooxml-encryption'],
      },
    },
  },
})
