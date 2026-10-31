import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // Same-origin /api in dev, like Caddy in production.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
