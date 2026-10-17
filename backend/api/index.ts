import { createApp } from '../src/app';

/**
 * Vercel entry point: the whole Express app as one serverless function. vercel.json rewrites
 * every path here, and Express routes on the original URL.
 *
 * The long-running pieces of src/server.ts (the rail-sync interval) do not run on Vercel; the
 * Cron job in vercel.json calls /api/cron/rail-sync instead.
 */
export default createApp();
