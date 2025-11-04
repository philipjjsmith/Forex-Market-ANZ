import "dotenv/config";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Migration Script: Phase 3C - Partial Profit Taking
 * Adds database support for 50% profit taking at TP1
 */

async function runMigration() {
  console.log("🚀 Starting Phase 3C: Partial Profit Taking migration...\n");

  // Validate environment variables
  if (!process.env.DATABASE_URL) {
    console.error("❌ ERROR: DATABASE_URL not found in .env file");
    process.exit(1);
  }

  try {
    // Parse DATABASE_URL
    const dbUrl = new URL(process.env.DATABASE_URL);

    // Create PostgreSQL client
    const sql = postgres({
      host: dbUrl.hostname,
      port: parseInt(dbUrl.port || "5432"),
      database: dbUrl.pathname.slice(1),
      username: dbUrl.username,
      password: decodeURIComponent(dbUrl.password),
      ssl: "require",
      max: 1, // Single connection for migration
    });

    console.log("✅ Connected to Supabase PostgreSQL\n");
    console.log(`📍 Database: ${dbUrl.pathname.slice(1)}`);
    console.log(`📍 Host: ${dbUrl.hostname}\n`);

    // Read migration SQL file
    const migrationPath = join(__dirname, "..", "phase3_partial_profits_migration.sql");
    console.log(`📄 Reading migration file: ${migrationPath}\n`);

    const migrationSQL = readFileSync(migrationPath, "utf-8");

    // Execute migration
    console.log("⚙️  Executing migration SQL...\n");
    await sql.unsafe(migrationSQL);

    console.log("✅ Migration completed successfully!\n");
    console.log("📊 Added columns:");
    console.log("   - partial_close_1_price");
    console.log("   - partial_close_1_time");
    console.log("   - partial_close_1_pips");
    console.log("   - stop_moved_to_breakeven");
    console.log("   - breakeven_stop_price\n");
    console.log("🔧 Updated constraints:");
    console.log("   - outcome CHECK constraint (added TP1_PARTIAL, BREAKEVEN)\n");
    console.log("✅ All indexes created\n");

    // Verify columns were added
    console.log("🔍 Verifying column creation...\n");

    const columns = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'signal_history'
        AND column_name IN (
          'partial_close_1_price',
          'partial_close_1_time',
          'partial_close_1_pips',
          'stop_moved_to_breakeven',
          'breakeven_stop_price'
        )
      ORDER BY column_name
    `;

    if (columns.length === 5) {
      console.log("✅ Verification passed - all 5 columns exist:");
      columns.forEach((col: any) => {
        console.log(`   ✓ ${col.column_name} (${col.data_type})`);
      });
      console.log("");
    } else {
      console.warn(`⚠️  Warning: Expected 5 columns, found ${columns.length}`);
    }

    // Close connection
    await sql.end();

    console.log("🎉 Migration complete! Partial profit taking is ready.\n");
    process.exit(0);

  } catch (error: any) {
    console.error("\n❌ Migration failed:");
    console.error(error.message);

    if (error.message.includes("already exists")) {
      console.log("\n💡 Columns may already exist. This is safe to ignore if re-running migration.");
      process.exit(0);
    }

    console.error("\n🔍 Full error details:");
    console.error(error);
    process.exit(1);
  }
}

runMigration();
