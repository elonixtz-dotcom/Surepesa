import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the console proxies /admin to the API, so no CORS setup is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/admin': process.env.VITE_API_URL ?? 'http://localhost:4000' },
  },
});
