import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs outside Vite, so it doesn't pick up `.env` the way the app
// does. Load it natively (Node 20.12+/24) so `db:*` scripts get DATABASE_URL
// without manual env vars — no extra dependency.
if (existsSync('.env')) process.loadEnvFile('.env');

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	dialect: 'sqlite',
	dbCredentials: { url: process.env.DATABASE_URL },
	verbose: true,
	strict: true
});
