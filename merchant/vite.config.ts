import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Neon Auth's base URL, read from the backend's .env so it is configured in one place. */
function neonAuthUrl(): string | undefined {
  try {
    const env = readFileSync(new URL('../backend/.env', import.meta.url), 'utf8');
    return /^NEON_AUTH_BASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
  } catch {
    return undefined;
  }
}

// In development the portal proxies /v1 to the API and /auth to Neon Auth, so the session
// cookie is first-party (no third-party cookie or CORS setup needed).
export default defineConfig(({ mode }) => {
  const auth = neonAuthUrl();
  return {
    plugins: [react()],
    server: {
      port: 5175,
      strictPort: true,
      proxy:
        mode === 'demo'
          ? undefined
          : {
              '/v1': process.env.VITE_API_URL ?? 'http://localhost:4000',
              ...(auth
                ? {
                    '/auth': {
                      target: auth,
                      changeOrigin: true,
                      rewrite: (p: string) => p.replace(/^\/auth/, ''),
                      cookieDomainRewrite: 'localhost',
                    },
                  }
                : {}),
            },
    },
  };
});
