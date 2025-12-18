import "dotenv/config";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { db } from "../server/db.js";
import { sql } from "drizzle-orm";

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Migration Script: Winning Trades Enhancement
 * Applies migrations using the existing db connection from server/db.ts
 */

async function runMigrations() {
  console.log("🚀 Starting Winning Trades Enhancement migrations...\n");

  try {
    // Migration 1: Add columns to signal_history
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📄 Migration 1: signal_history columns");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const migration1Path = join(__dirname, "..", "winning_trades_enhancement_migration_1_signal_history.sql");
    const migration1SQL = readFileSync(migration1Path, "utf-8");

    console.log("⚙️  Executing migration 1...\n");
    await db.execute(sql.raw(migration1SQL));

    console.log("✅ Migration 1 completed!\n");
    console.log("📊 Added columns to signal_history:");
    console.log("   - entry_slippage, exit_slippage, fill_latency");
    console.log("   - max_adverse_excursion, max_favorable_excursion");
    console.log("   - session, volatility_level\n");

    // Migration 2: Create partial_exits table
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📄 Migration 2: partial_exits table");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const migration2Path = join(__dirname, "..", "winning_trades_enhancement_migration_2_partial_exits.sql");
    const migration2SQL = readFileSync(migration2Path, "utf-8");

    console.log("⚙️  Executing migration 2...\n");
    await db.execute(sql.raw(migration2SQL));

    console.log("✅ Migration 2 completed!\n");
    console.log("📊 Created partial_exits table\n");

    // Migration 3: Create news_events table
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📄 Migration 3: news_events table");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const migration3Path = join(__dirname, "..", "winning_trades_enhancement_migration_3_news_events.sql");
    const migration3SQL = readFileSync(migration3Path, "utf-8");

    console.log("⚙️  Executing migration 3...\n");
    await db.execute(sql.raw(migration3SQL));

    console.log("✅ Migration 3 completed!\n");
    console.log("📊 Created news_events table\n");

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🎉 ALL MIGRATIONS COMPLETE!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    console.log("✅ signal_history table enhanced");
    console.log("✅ partial_exits table created");
    console.log("✅ news_events table created\n");

    process.exit(0);

  } catch (error: any) {
    console.error("\n❌ Migration failed:");
    console.error(error.message);

    if (error.message?.includes("already exists")) {
      console.log("\n💡 Tables/columns may already exist. Safe to ignore if re-running.");
      process.exit(0);
    }

    console.error("\n🔍 Full error:");
    console.error(error);
    process.exit(1);
  }
}

runMigrations();
