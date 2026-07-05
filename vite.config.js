import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // 5280 (not 5273) — docs-editor's dev server also uses 5273 and squats [::1]:5273,
    // which made localhost:5273 hit the wrong app. strictPort fails loudly on a future clash.
    port: 5280, host: true, strictPort: true,
    proxy: { '/api': 'http://localhost:8788' },
  },
})
