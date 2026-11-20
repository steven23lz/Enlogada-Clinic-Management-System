import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// `npm run dev:tunnel`: the app on a phone through VS Code's forwarded port 5173 (a devtunnels.ms
// address). One port, not two: the page calls `/api` on its own address (.env.tunnel) and Vite
// passes it to the backend on this PC, so the phone never needs the backend's port and the backend
// needs no CORS entry for an address that changes per tunnel. The Origin header is dropped on the
// way through because the browser request is same-origin to the page; to the backend it is a local
// call. Google sign-in refuses an unregistered address: use email and password.
const tunnel = {
  host: true,
  allowedHosts: ['.devtunnels.ms'],
  hmr: { clientPort: 443 },
  proxy: {
    '/api': {
      target: 'http://localhost:5000',
      configure: (proxy) => proxy.on('proxyReq', (req) => req.removeHeader('origin')),
    },
  },
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    ...(mode === 'tunnel' ? tunnel : {}),
  },
}))
