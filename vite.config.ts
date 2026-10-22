import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), {
    name: 'kit-release-content-policy',
    apply: 'build',
    transformIndexHtml() {
      // Imported card markup must not execute handlers in Kit's native bridge
      // context. Keep SQL.js WebAssembly available without enabling JS eval.
      return [{
        tag: 'meta',
        attrs: {
          'http-equiv': 'Content-Security-Policy',
          content: "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'",
        },
        injectTo: 'head-prepend',
      }]
    },
  }],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    // Match the iOS 16.4 WebView floor; retain the other Vite 7 syntax targets.
    target: ['chrome107', 'edge107', 'firefox104', 'safari16.4'],
    chunkSizeWarningLimit: 600,
  },
})
