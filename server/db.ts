import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { URL } from 'url';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

// Parse the DATABASE_URL
const dbUrl = new URL(process.env.DATABASE_URL);

// Create postgres connection with explicit configuration to avoid IPv6
const client = postgres({
  host: dbUrl.hostname,
  port: parseInt(dbUrl.port || '5432'),
  database: dbUrl.pathname.slice(1), // Remove leading slash
  username: dbUrl.username,
  password: decodeURIComponent(dbUrl.password),
  ssl: 'require',
  connect_timeout: 10,
  idle_timeout: 20,
  max_lifetime: 60 * 30,
  // Explicitly set connection options
  connection: {
    application_name: 'forex-market-anz',
  },
});

export const db = drizzle(client);
