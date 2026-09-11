import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
  },
})
