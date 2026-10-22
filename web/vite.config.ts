import { defineConfig } from 'vite';

// Web (Vite) defaults to port 5280 so it never collides with ReadySet's :3000.
// Override with KO_WEB_PORT. The watcher WebSocket port (default 8787) is read
// by the client from the same env via import.meta.env at build/serve time.
const webPort = Number(process.env.KO_WEB_PORT) || 5280;
const wsPort = Number(process.env.KO_WS_PORT) || 8787;

export default defineConfig({
  root: '.',
  server: { port: webPort, strictPort: true, host: '127.0.0.1' },
  define: {
    __KO_WS_PORT__: JSON.stringify(wsPort),
  },
});
