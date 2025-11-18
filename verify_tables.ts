import "dotenv/config";
import postgres from "postgres";

async function verifyTables() {
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
    console.log("🔍 Checking database tables...\n");

    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('signal_history', 'strategy_performance', 'strategy_adaptations')
      ORDER BY table_name
    `;

    console.log(`Found ${tables.length}/3 required tables:`);
    tables.forEach((table: any) => {
      console.log(`  ✅ ${table.table_name}`);
    });

    const missing = ['signal_history', 'strategy_performance', 'strategy_adaptations']
      .filter(name => !tables.find((t: any) => t.table_name === name));

    if (missing.length > 0) {
      console.log(`\n❌ Missing tables:`);
      missing.forEach(name => console.log(`  ✗ ${name}`));
    } else {
      console.log(`\n✅ All required tables exist!`);
    }

    // Check for any recommendations
    if (tables.find((t: any) => t.table_name === 'strategy_adaptations')) {
      const recs = await sql`
        SELECT COUNT(*) as count, status
        FROM strategy_adaptations
        GROUP BY status
      `;

      console.log(`\n📊 Strategy Adaptations:`);
      if (recs.length === 0) {
        console.log(`  No recommendations generated yet`);
      } else {
        recs.forEach((r: any) => {
          console.log(`  ${r.status}: ${r.count}`);
        });
      }
    }

    await sql.end();
    process.exit(0);

  } catch (error: any) {
    console.error("\n❌ Error:", error.message);
    await sql.end();
    process.exit(1);
  }
}

verifyTables();
