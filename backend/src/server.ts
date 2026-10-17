import { env } from './config/env';
import { createApp } from './app';
import { prisma } from './lib/prisma';

const server = createApp().listen(env.PORT, () => {
  console.log(`SurePesa API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
