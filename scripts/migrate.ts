import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
import { join } from 'path';
import 'dotenv/config';

async function migrate() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }

  const sql = neon(process.env.DATABASE_URL);

  // Read the migration SQL file
  const migrationSQL = readFileSync(
    join(process.cwd(), 'migrations', '0000_blue_overlord.sql'),
    'utf-8'
  );

  console.log('Running migration...');

  try {
    // Execute the migration
    await sql(migrationSQL);
    console.log('✅ Migration completed successfully!');
  } catch (error: any) {
    if (error.message.includes('already exists')) {
      console.log('⚠️  Tables already exist, skipping migration');
    } else {
      console.error('❌ Migration failed:', error.message);
      throw error;
    }
  }
}

migrate().catch(console.error);
