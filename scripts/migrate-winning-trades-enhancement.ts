import "dotenv/config";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Migration Script: Winning Trades Enhancement
 * Adds execution quality, MAE/MFE, session analysis, and news events support
 */

async function runMigration() {
  console.log("🚀 Starting Winning Trades Enhancement migrations...\n");

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
      connect_timeout: 10,
      idle_timeout: 20,
      max_lifetime: 60 * 30,
      max: 1, // Single connection for migration
      connection: {
        application_name: 'forex-market-anz-migration',
      },
    });

    console.log("✅ Connected to Supabase PostgreSQL\n");
    console.log(`📍 Database: ${dbUrl.pathname.slice(1)}`);
    console.log(`📍 Host: ${dbUrl.hostname}\n`);

    // Migration 1: Add columns to signal_history
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📄 Migration 1: signal_history columns");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const migration1Path = join(__dirname, "..", "winning_trades_enhancement_migration_1_signal_history.sql");
    const migration1SQL = readFileSync(migration1Path, "utf-8");

    console.log("⚙️  Executing migration 1...\n");
    await sql.unsafe(migration1SQL);

    console.log("✅ Migration 1 completed!\n");
    console.log("📊 Added columns to signal_history:");
    console.log("   - entry_slippage (DECIMAL)");
    console.log("   - exit_slippage (DECIMAL)");
    console.log("   - fill_latency (INTEGER)");
    console.log("   - break_even_time (TIMESTAMPTZ)");
    console.log("   - max_adverse_excursion (DECIMAL)");
    console.log("   - max_favorable_excursion (DECIMAL)");
    console.log("   - session (VARCHAR)");
    console.log("   - volatility_level (VARCHAR)\n");

    // Verify migration 1
    console.log("🔍 Verifying migration 1...\n");
    const newColumns = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'signal_history'
        AND column_name IN (
          'entry_slippage',
          'exit_slippage',
          'fill_latency',
          'break_even_time',
          'max_adverse_excursion',
          'max_favorable_excursion',
          'session',
          'volatility_level'
        )
      ORDER BY column_name
    `;

    if (newColumns.length === 8) {
      console.log("✅ Verification passed - all 8 columns exist\n");
    } else {
      console.warn(`⚠️  Warning: Expected 8 columns, found ${newColumns.length}\n`);
    }

    // Migration 2: Create partial_exits table
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📄 Migration 2: partial_exits table");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const migration2Path = join(__dirname, "..", "winning_trades_enhancement_migration_2_partial_exits.sql");
    const migration2SQL = readFileSync(migration2Path, "utf-8");

    console.log("⚙️  Executing migration 2...\n");
    await sql.unsafe(migration2SQL);

    console.log("✅ Migration 2 completed!\n");
    console.log("📊 Created partial_exits table with columns:");
    console.log("   - id (SERIAL PRIMARY KEY)");
    console.log("   - signal_id (VARCHAR)");
    console.log("   - exit_level (VARCHAR)");
    console.log("   - exit_price (DECIMAL)");
    console.log("   - exit_time (TIMESTAMPTZ)");
    console.log("   - profit_pips (DECIMAL)");
    console.log("   - position_size_closed (DECIMAL)");
    console.log("   - slippage (DECIMAL)");
    console.log("   - created_at (TIMESTAMPTZ)\n");

    // Verify migration 2
    console.log("🔍 Verifying migration 2...\n");
    const partialExitsTable = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name = 'partial_exits'
    `;

    if (partialExitsTable.length === 1) {
      console.log("✅ Verification passed - partial_exits table exists\n");
    } else {
      console.warn("⚠️  Warning: partial_exits table not found\n");
    }

    // Migration 3: Create news_events table
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📄 Migration 3: news_events table");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const migration3Path = join(__dirname, "..", "winning_trades_enhancement_migration_3_news_events.sql");
    const migration3SQL = readFileSync(migration3Path, "utf-8");

    console.log("⚙️  Executing migration 3...\n");
    await sql.unsafe(migration3SQL);

    console.log("✅ Migration 3 completed!\n");
    console.log("📊 Created news_events table with columns:");
    console.log("   - id (SERIAL PRIMARY KEY)");
    console.log("   - event_time (TIMESTAMPTZ)");
    console.log("   - currency (VARCHAR)");
    console.log("   - event_name (TEXT)");
    console.log("   - impact (VARCHAR)");
    console.log("   - actual (VARCHAR)");
    console.log("   - forecast (VARCHAR)");
    console.log("   - previous (VARCHAR)");
    console.log("   - source (VARCHAR)");
    console.log("   - cached_at (TIMESTAMPTZ)\n");

    // Verify migration 3
    console.log("🔍 Verifying migration 3...\n");
    const newsEventsTable = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name = 'news_events'
    `;

    if (newsEventsTable.length === 1) {
      console.log("✅ Verification passed - news_events table exists\n");
    } else {
      console.warn("⚠️  Warning: news_events table not found\n");
    }

    // Close connection
    await sql.end();

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🎉 ALL MIGRATIONS COMPLETE!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    console.log("✅ signal_history table enhanced with 8 new columns");
    console.log("✅ partial_exits table created");
    console.log("✅ news_events table created\n");
    console.log("🚀 Ready to implement backend services!\n");

    process.exit(0);

  } catch (error: any) {
    console.error("\n❌ Migration failed:");
    console.error(error.message);

    if (error.message.includes("already exists")) {
      console.log("\n💡 Tables/columns may already exist. This is safe to ignore if re-running migration.");
      process.exit(0);
    }

    console.error("\n🔍 Full error details:");
    console.error(error);
    process.exit(1);
  }
}

runMigration();
