import "dotenv/config";
import postgres from "postgres";
import { fileURLToPath } from "url";
import { dirname } from "path";

/**
 * Path A: Backfill Post-Signal Candle Data
 * Fetches 96 hours of 15-min candles AFTER each signal creation
 * Enables accurate backtesting of new stop loss parameters
 */

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================
// CONFIGURATION
// ============================================================
const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_KEY || "";
const TWELVE_DATA_BASE_URL = "https://api.twelvedata.com";
const RATE_LIMIT_DELAY_MS = 8000; // 8 seconds between API calls
const HOURS_AFTER_SIGNAL = 96; // 4 days of post-signal monitoring
const CANDLE_INTERVAL = "15min";
const CANDLES_PER_SIGNAL = Math.ceil(HOURS_AFTER_SIGNAL * (60 / 15)); // 384 candles

interface Signal {
  id: string;
  signal_id: string;
  symbol: string;
  created_at: Date;
  outcome: string;
}

interface TwelveDataCandle {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}

interface TwelveDataResponse {
  status?: string;
  message?: string;
  values?: TwelveDataCandle[];
}

// ============================================================
// MAIN FUNCTION
// ============================================================
async function backfillSignalCandles() {
  console.log("🚀 Path A: Backfilling Post-Signal Candle Data\n");
  console.log("=" .repeat(70));

  // Validate environment
  if (!process.env.DATABASE_URL) {
    console.error("❌ ERROR: DATABASE_URL not found in .env");
    process.exit(1);
  }

  if (!TWELVE_DATA_API_KEY) {
    console.error("❌ ERROR: TWELVE_DATA_KEY not found in .env");
    process.exit(1);
  }

  // Connect to database
  const dbUrl = new URL(process.env.DATABASE_URL);
  const sql = postgres({
    host: dbUrl.hostname,
    port: parseInt(dbUrl.port || "5432"),
    database: dbUrl.pathname.slice(1),
    username: dbUrl.username,
    password: decodeURIComponent(dbUrl.password),
    ssl: "require",
    max: 1,
  });

  try {
    console.log("✅ Connected to database\n");

    // Check if signal_candle_data table exists
    const tableCheck = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'signal_candle_data'
      ) as exists
    `;

    if (!tableCheck[0]?.exists) {
      console.error("❌ ERROR: signal_candle_data table does not exist");
      console.error("   Please run the migration SQL first:");
      console.error("   path_a_signal_candle_data_migration.sql\n");
      await sql.end();
      process.exit(1);
    }

    console.log("✅ signal_candle_data table exists\n");

    // Fetch all completed signals that don't have candle data yet
    console.log("📊 Fetching signals that need candle data...\n");

    const signals = await sql`
      SELECT DISTINCT
        sh.id,
        sh.signal_id,
        sh.symbol,
        sh.created_at,
        sh.outcome
      FROM signal_history sh
      LEFT JOIN signal_candle_data scd ON sh.id = scd.signal_history_id
      WHERE sh.outcome != 'PENDING'
        AND scd.id IS NULL
      ORDER BY sh.created_at DESC
    ` as Signal[];

    console.log(`Found ${signals.length} signals needing candle data\n`);
    console.log(`Estimated API calls: ${signals.length}`);
    console.log(`Estimated time: ${((signals.length * RATE_LIMIT_DELAY_MS) / 1000 / 3600).toFixed(1)} hours`);
    console.log(`Free tier capacity: 800 calls/day\n`);

    if (signals.length === 0) {
      console.log("✅ All signals already have candle data!");
      await sql.end();
      process.exit(0);
    }

    // Group signals by symbol to minimize API calls
    const symbolGroups = new Map<string, Signal[]>();
    for (const signal of signals) {
      if (!symbolGroups.has(signal.symbol)) {
        symbolGroups.set(signal.symbol, []);
      }
      symbolGroups.get(signal.symbol)!.push(signal);
    }

    console.log(`Symbols to process: ${Array.from(symbolGroups.keys()).join(", ")}\n`);
    console.log("=" .repeat(70));
    console.log("\n🔄 Starting backfill process...\n");

    let totalProcessed = 0;
    let totalSuccess = 0;
    let totalFailed = 0;
    let totalSkipped = 0;

    // Process each signal
    for (const signal of signals) {
      totalProcessed++;
      const progress = `[${totalProcessed}/${signals.length}]`;

      console.log(`${progress} Processing signal ${signal.signal_id}...`);
      console.log(`  Symbol: ${signal.symbol}`);
      console.log(`  Created: ${signal.created_at.toISOString()}`);
      console.log(`  Outcome: ${signal.outcome}`);

      try {
        // Fetch candles from Twelve Data
        const startTime = new Date(signal.created_at);
        const endTime = new Date(startTime.getTime() + HOURS_AFTER_SIGNAL * 60 * 60 * 1000);

        console.log(`  Fetching ${CANDLES_PER_SIGNAL} candles (${CANDLE_INTERVAL})...`);

        const candles = await fetchCandlesFromTwelveData(
          signal.symbol,
          startTime,
          endTime
        );

        if (candles.length === 0) {
          console.log(`  ⚠️  No candles returned - skipping`);
          totalSkipped++;
          continue;
        }

        // Store candles in database
        console.log(`  💾 Storing ${candles.length} candles...`);

        for (const candle of candles) {
          await sql`
            INSERT INTO signal_candle_data (
              signal_history_id,
              candle_time,
              open,
              high,
              low,
              close,
              volume
            ) VALUES (
              ${signal.id},
              ${candle.candle_time},
              ${candle.open},
              ${candle.high},
              ${candle.low},
              ${candle.close},
              ${candle.volume}
            )
            ON CONFLICT (signal_history_id, candle_time) DO NOTHING
          `;
        }

        console.log(`  ✅ Success (${candles.length} candles stored)\n`);
        totalSuccess++;

        // Rate limiting - wait 8 seconds between API calls
        if (totalProcessed < signals.length) {
          console.log(`  ⏱️  Rate limiting... waiting ${RATE_LIMIT_DELAY_MS / 1000}s\n`);
          await sleep(RATE_LIMIT_DELAY_MS);
        }

      } catch (error: any) {
        console.error(`  ❌ Failed: ${error.message}\n`);
        totalFailed++;

        // If rate limit hit, wait longer
        if (error.message.includes("limit")) {
          console.log(`  ⏳ Rate limit hit - waiting 60 seconds...\n`);
          await sleep(60000);
        }
      }
    }

    // Summary
    console.log("\n" + "=" .repeat(70));
    console.log("📊 BACKFILL SUMMARY\n");
    console.log(`Total signals processed: ${totalProcessed}`);
    console.log(`✅ Success: ${totalSuccess}`);
    console.log(`❌ Failed: ${totalFailed}`);
    console.log(`⚠️  Skipped: ${totalSkipped}`);
    console.log(`\nCompletion rate: ${((totalSuccess / totalProcessed) * 100).toFixed(1)}%`);
    console.log("\n" + "=" .repeat(70));

    if (totalSuccess > 0) {
      console.log("\n✅ Backfill complete! Backtester can now test new parameters.\n");
    } else {
      console.log("\n⚠️  No data was backfilled. Check errors above.\n");
    }

    await sql.end();
    process.exit(0);

  } catch (error: any) {
    console.error("\n❌ Fatal error:", error.message);
    console.error("\nFull error:");
    console.error(error);
    await sql.end();
    process.exit(1);
  }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

async function fetchCandlesFromTwelveData(
  symbol: string,
  startTime: Date,
  endTime: Date
): Promise<Array<{
  candle_time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}>> {
  const url = `${TWELVE_DATA_BASE_URL}/time_series?symbol=${symbol}&interval=${CANDLE_INTERVAL}&outputsize=${CANDLES_PER_SIGNAL}&apikey=${TWELVE_DATA_API_KEY}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data: TwelveDataResponse = await response.json();

  // Check for API errors
  if (data.status === "error") {
    if (data.message?.includes("API key")) {
      throw new Error("Invalid Twelve Data API key");
    }
    if (data.message?.includes("limit")) {
      throw new Error("API rate limit reached");
    }
    throw new Error(data.message || "API error");
  }

  if (!data.values || !Array.isArray(data.values)) {
    throw new Error("Invalid API response - no values array");
  }

  // Convert and filter candles to only those AFTER signal creation
  const candles = data.values
    .map((item: TwelveDataCandle) => {
      const candleTime = new Date(item.datetime);
      return {
        candle_time: candleTime,
        open: parseFloat(item.open),
        high: parseFloat(item.high),
        low: parseFloat(item.low),
        close: parseFloat(item.close),
        volume: item.volume ? parseInt(item.volume) : 0,
      };
    })
    .filter(candle => {
      // Only include candles AFTER signal creation
      return candle.candle_time >= startTime && candle.candle_time <= endTime;
    })
    .sort((a, b) => a.candle_time.getTime() - b.candle_time.getTime()); // Oldest first

  return candles;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// RUN
// ============================================================
backfillSignalCandles();
