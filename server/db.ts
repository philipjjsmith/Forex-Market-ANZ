import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import dns from 'dns';

// Force IPv4 resolution (Render may have IPv6 connectivity issues)
dns.setDefaultResultOrder('ipv4first');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

// Create postgres connection with proper Supabase configuration
const connectionString = process.env.DATABASE_URL;
const client = postgres(connectionString, {
  ssl: 'require',
  connect_timeout: 10,
  idle_timeout: 20,
  max_lifetime: 60 * 30,
  // Force IPv4
  family: 4,
});

export const db = drizzle(client);
