/**
 * Apply a hand-written SQL migration from db/manual/.
 *
 * These files deliberately live OUTSIDE `migrations/`, which is drizzle-kit's `out`
 * directory (see drizzle.config.ts). Dropping unregistered .sql into that folder risks
 * drizzle-kit misreading it, and its _journal.json has only one entry — so nothing in this
 * repo would ever have applied the file. `db:push` bypasses migration files entirely.
 *
 * Usage:  npm run db:migrate-outcome-validation
 *         tsx scripts/apply-sql.ts db/manual/<file>.sql
 */
import 'dotenv/config';
import fs from 'fs';
import postgres from 'postgres';

const file = process.argv[2];
if (!file) {
  console.error('Usage: tsx scripts/apply-sql.ts <path-to.sql>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Refusing to guess.');
  process.exit(1);
}

const sqlText = fs.readFileSync(file, 'utf8');
const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1 });

(async () => {
  console.log(`Applying ${file} ...`);
  try {
    // The file manages its own BEGIN/COMMIT.
    await sql.unsafe(sqlText);
    console.log('✅ Applied successfully.');
  } catch (e: any) {
    console.error('❌ FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
})();
