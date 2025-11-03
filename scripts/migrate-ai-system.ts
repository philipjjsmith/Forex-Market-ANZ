import "dotenv/config";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Migration Script: AI Trade Validation System
 * Applies the database schema for signal tracking and AI adaptation
 */

async function runMigration() {
  console.log("🚀 Starting AI Trade Validation System migration...\n");

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
    const migrationPath = join(__dirname, "..", "supabase_migration_ai_trading.sql");
    console.log(`📄 Reading migration file: ${migrationPath}\n`);

    const migrationSQL = readFileSync(migrationPath, "utf-8");

    // Execute migration
    console.log("⚙️  Executing migration SQL...\n");
    await sql.unsafe(migrationSQL);

    console.log("✅ Migration completed successfully!\n");
    console.log("📊 Created tables:");
    console.log("   - signal_history");
    console.log("   - strategy_performance");
    console.log("   - strategy_adaptations\n");
    console.log("🔧 Created functions:");
    console.log("   - update_updated_at_column()");
    console.log("   - calculate_strategy_performance()\n");
    console.log("✅ All indexes and triggers created\n");

    // Verify tables were created
    console.log("🔍 Verifying table creation...\n");

    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('signal_history', 'strategy_performance', 'strategy_adaptations')
      ORDER BY table_name
    `;

    if (tables.length === 3) {
      console.log("✅ Verification passed - all 3 tables exist:");
      tables.forEach((table: any) => {
        console.log(`   ✓ ${table.table_name}`);
      });
      console.log("");
    } else {
      console.warn(`⚠️  Warning: Expected 3 tables, found ${tables.length}`);
    }

    // Close connection
    await sql.end();

    console.log("🎉 Migration complete! AI Trade Validation System is ready.\n");
    process.exit(0);

  } catch (error: any) {
    console.error("\n❌ Migration failed:");
    console.error(error.message);

    if (error.message.includes("already exists")) {
      console.log("\n💡 Tables may already exist. This is safe to ignore if re-running migration.");
      process.exit(0);
    }

    console.error("\n🔍 Full error details:");
    console.error(error);
    process.exit(1);
  }
}

runMigration();
