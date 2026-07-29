import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const target = process.env.VITE_DEV_SERVER ?? 'http://localhost:4000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target, changeOrigin: true },
      '/socket': { target, ws: true, changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
