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
//
// [1.173.0] No live-update socket. Choosing a photo on a phone puts the browser in the background;
// the socket drops through the tunnel, and on coming back Vite's client reloads the page to
// reconnect ("server connection lost"), so the photo just chosen, and the form around it, were gone.
// A change made on the PC shows on the phone after a refresh by hand.
const tunnel = {
  host: true,
  allowedHosts: ['.devtunnels.ms'],
  ws: false,
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
