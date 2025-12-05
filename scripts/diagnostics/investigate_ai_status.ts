import "dotenv/config";
import postgres from "postgres";

async function investigateAIStatus() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL not found");
    process.exit(1);
  }

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
    console.log("🔍 INVESTIGATING AI SYSTEM STATUS\n");
    console.log("=" .repeat(60));

    // 1. Check per-symbol distribution
    console.log("\n📊 STEP 1: Per-Symbol Signal Distribution");
    console.log("-".repeat(60));

    const symbolStats = await sql`
      SELECT
        symbol,
        COUNT(*) as total_signals,
        COUNT(*) FILTER (WHERE outcome != 'PENDING') as completed,
        COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
        COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
          NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
          2
        ) as win_rate,
        COUNT(*) FILTER (WHERE confidence >= 80) as high_tier,
        COUNT(*) FILTER (WHERE confidence >= 70 AND confidence < 80) as medium_tier
      FROM signal_history
      GROUP BY symbol
      ORDER BY total_signals DESC
    `;

    console.log("\nSymbol Performance:");
    symbolStats.forEach((s: any) => {
      const hasEnoughData = parseInt(s.completed) >= 30;
      const status = hasEnoughData ? "✅ AI ACTIVE" : "⏳ COLLECTING";
      console.log(`\n  ${s.symbol}:`);
      console.log(`    Total: ${s.total_signals} | Completed: ${s.completed} | ${status}`);
      console.log(`    Win Rate: ${s.win_rate || 0}% (${s.wins}W / ${s.losses}L)`);
      console.log(`    HIGH tier: ${s.high_tier} | MEDIUM tier: ${s.medium_tier}`);
    });

    const symbolsWithEnoughData = symbolStats.filter((s: any) => parseInt(s.completed) >= 30);
    console.log(`\n📈 Symbols with 30+ completed signals: ${symbolsWithEnoughData.length}/${symbolStats.length}`);

    // 2. Check if strategy_adaptations table exists and has data
    console.log("\n\n📋 STEP 2: Strategy Adaptations Table");
    console.log("-".repeat(60));

    const tableCheck = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'strategy_adaptations'
      ) as exists
    `;

    const tableExists = tableCheck[0]?.exists;
    console.log(`\nTable exists: ${tableExists ? "✅ YES" : "❌ NO"}`);

    if (tableExists) {
      const recommendations = await sql`
        SELECT
          id,
          symbol,
          recommendation_title,
          expected_win_rate_improvement,
          based_on_signals,
          status,
          created_at
        FROM strategy_adaptations
        ORDER BY created_at DESC
        LIMIT 10
      `;

      console.log(`\nTotal recommendations: ${recommendations.length}`);

      if (recommendations.length > 0) {
        console.log("\nRecent recommendations:");
        recommendations.forEach((r: any, idx: number) => {
          console.log(`\n  ${idx + 1}. ${r.recommendation_title}`);
          console.log(`     Symbol: ${r.symbol} | Improvement: +${r.expected_win_rate_improvement}%`);
          console.log(`     Based on: ${r.based_on_signals} signals | Status: ${r.status}`);
          console.log(`     Created: ${new Date(r.created_at).toLocaleString()}`);
        });
      } else {
        console.log("\n⚠️  No recommendations found in database");
      }

      // Check status distribution
      const statusCounts = await sql`
        SELECT status, COUNT(*) as count
        FROM strategy_adaptations
        GROUP BY status
      `;

      if (statusCounts.length > 0) {
        console.log("\nRecommendation status breakdown:");
        statusCounts.forEach((s: any) => {
          console.log(`  ${s.status}: ${s.count}`);
        });
      }
    }

    // 3. Check overall statistics
    console.log("\n\n📈 STEP 3: Overall System Statistics");
    console.log("-".repeat(60));

    const overallStats = await sql`
      SELECT
        COUNT(*) as total_signals,
        COUNT(*) FILTER (WHERE outcome != 'PENDING') as completed_signals,
        COUNT(*) FILTER (WHERE outcome = 'PENDING') as pending_signals,
        COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
        COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
          NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
          2
        ) as win_rate
      FROM signal_history
    `;

    const stats = overallStats[0];
    console.log(`\nTotal signals: ${stats.total_signals}`);
    console.log(`Completed: ${stats.completed_signals} | Pending: ${stats.pending_signals}`);
    console.log(`Win Rate: ${stats.win_rate || 0}% (${stats.wins}W / ${stats.losses}L)`);
    console.log(`Progress to 385 target: ${((parseInt(stats.completed_signals) / 385) * 100).toFixed(1)}%`);

    // 4. Final diagnosis
    console.log("\n\n🎯 STEP 4: DIAGNOSIS");
    console.log("=".repeat(60));

    if (symbolsWithEnoughData.length === 0) {
      console.log("\n❌ ISSUE: No symbols have 30+ completed signals");
      console.log("   AI analyzer requires 30+ signals per symbol to activate");
      console.log("   Current status: Still collecting data");
      console.log(`   ETA to first symbol reaching 30: Check individual symbol progress above`);
    } else {
      console.log(`\n✅ ${symbolsWithEnoughData.length} symbol(s) have enough data for AI analysis`);
    }

    if (!tableExists) {
      console.log("\n❌ CRITICAL: strategy_adaptations table does not exist");
      console.log("   Run: npm run db:migrate-ai-system");
    } else if (recommendations.length === 0 && symbolsWithEnoughData.length > 0) {
      console.log("\n⚠️  Backtester has run but found NO improvements >5%");
      console.log("   This means current parameters (20/50 EMA, 2.0x ATR) are already optimal");
      console.log("   OR win rates are too similar across all tested parameter combinations");
    } else if (recommendations.length > 0) {
      console.log(`\n✅ ${recommendations.length} recommendation(s) generated and ready for review`);
      console.log("   Go to: Admin Dashboard → AI Insights → Recommendations");
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ Investigation complete\n");

    await sql.end();
    process.exit(0);

  } catch (error: any) {
    console.error("\n❌ Error:", error.message);
    console.error("\nFull error:");
    console.error(error);
    await sql.end();
    process.exit(1);
  }
}

investigateAIStatus();
