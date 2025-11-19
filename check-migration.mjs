import postgres from 'postgres';
import { config } from 'dotenv';

config();

const sql = postgres(process.env.DATABASE_URL);

console.log('🔍 DEEP DIVE: Data Quality Migration Verification');
console.log('='.repeat(60));
console.log('');

try {
  // 1. Check if data_quality column exists
  console.log('1️⃣ Checking if data_quality column exists...');
  const columnCheck = await sql`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_name = 'signal_history' AND column_name = 'data_quality'
  `;

  if (columnCheck.length > 0) {
    console.log('✅ data_quality column EXISTS');
    console.log(`   Type: ${columnCheck[0].data_type}`);
    console.log(`   Default: ${columnCheck[0].column_default}`);
  } else {
    console.log('❌ data_quality column DOES NOT EXIST');
  }
  console.log('');

  // 2. Check data distribution
  console.log('2️⃣ Checking data_quality distribution...');
  const distribution = await sql`
    SELECT
      data_quality,
      COUNT(*) as count,
      MIN(created_at) as earliest,
      MAX(created_at) as latest
    FROM signal_history
    GROUP BY data_quality
    ORDER BY data_quality
  `;

  console.log(`   Total groups: ${distribution.length}`);
  distribution.forEach(row => {
    const earliest = row.earliest ? row.earliest.toISOString().split('T')[0] : 'N/A';
    const latest = row.latest ? row.latest.toISOString().split('T')[0] : 'N/A';
    console.log(`   ${row.data_quality}: ${row.count} signals (${earliest} to ${latest})`);
  });
  console.log('');

  // 3. Check total counts
  console.log('3️⃣ Checking total signal counts...');
  const totals = await sql`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE data_quality = 'production') as production,
      COUNT(*) FILTER (WHERE data_quality = 'legacy') as legacy,
      COUNT(*) FILTER (WHERE data_quality = 'archived') as archived,
      COUNT(*) FILTER (WHERE data_quality IS NULL) as null_quality
    FROM signal_history
  `;

  const t = totals[0];
  console.log(`   Total signals: ${t.total}`);
  console.log(`   Production: ${t.production} (${((t.production/t.total)*100).toFixed(1)}%)`);
  console.log(`   Legacy: ${t.legacy} (${((t.legacy/t.total)*100).toFixed(1)}%)`);
  console.log(`   Archived: ${t.archived}`);
  console.log(`   NULL: ${t.null_quality} ${t.null_quality > 0 ? '⚠️ UNEXPECTED!' : '✅'}`);
  console.log('');

  // 4. Check date-based accuracy (pre-Nov 19 should be legacy)
  console.log('4️⃣ Checking date-based marking accuracy...');
  const dateCheck = await sql`
    SELECT
      COUNT(*) FILTER (WHERE created_at < '2025-11-19 00:00:00 UTC' AND data_quality = 'legacy') as correct_legacy,
      COUNT(*) FILTER (WHERE created_at < '2025-11-19 00:00:00 UTC' AND data_quality != 'legacy') as wrong_legacy,
      COUNT(*) FILTER (WHERE created_at >= '2025-11-19 00:00:00 UTC' AND data_quality = 'production') as correct_production,
      COUNT(*) FILTER (WHERE created_at >= '2025-11-19 00:00:00 UTC' AND data_quality != 'production') as wrong_production
    FROM signal_history
  `;

  const d = dateCheck[0];
  console.log(`   Pre-Nov 19 correctly marked as legacy: ${d.correct_legacy} ✅`);
  console.log(`   Pre-Nov 19 INCORRECTLY marked: ${d.wrong_legacy} ${d.wrong_legacy > 0 ? '❌' : '✅'}`);
  console.log(`   Post-Nov 19 correctly marked as production: ${d.correct_production} ✅`);
  console.log(`   Post-Nov 19 INCORRECTLY marked: ${d.wrong_production} ${d.wrong_production > 0 ? '❌' : '✅'}`);
  console.log('');

  // 5. Check indexes
  console.log('5️⃣ Checking indexes...');
  const indexes = await sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'signal_history'
      AND indexname IN ('idx_signal_history_data_quality', 'idx_signal_history_quality_tier_outcome')
  `;

  console.log(`   Indexes found: ${indexes.length}/2`);
  indexes.forEach(idx => {
    console.log(`   ✅ ${idx.indexname}`);
  });
  if (indexes.length < 2) {
    console.log('   ⚠️ Missing indexes!');
  }
  console.log('');

  // 6. Check constraint
  console.log('6️⃣ Checking CHECK constraint...');
  const constraints = await sql`
    SELECT conname, pg_get_constraintdef(oid) as definition
    FROM pg_constraint
    WHERE conname = 'valid_data_quality' AND conrelid = 'signal_history'::regclass
  `;

  if (constraints.length > 0) {
    console.log(`   ✅ Constraint exists: ${constraints[0].conname}`);
    console.log(`   Definition: ${constraints[0].definition}`);
  } else {
    console.log('   ❌ Constraint NOT found');
  }
  console.log('');

  // 7. Check views
  console.log('7️⃣ Checking views...');
  const views = await sql`
    SELECT viewname
    FROM pg_views
    WHERE viewname IN ('signal_history_production', 'fxify_production_signals')
  `;

  console.log(`   Views found: ${views.length}/2`);
  views.forEach(v => {
    console.log(`   ✅ ${v.viewname}`);
  });
  if (views.length < 2) {
    console.log('   ⚠️ Missing views!');
  }
  console.log('');

  // 8. Test production filter query (simulate backend API)
  console.log('8️⃣ Testing production filter query (simulating backend API)...');
  const prodQuery = await sql`
    SELECT
      COUNT(*) as total_signals,
      COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
      COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses
    FROM signal_history
    WHERE outcome != 'PENDING'
      AND data_quality = 'production'
  `;

  const prod = prodQuery[0];
  console.log(`   Production signals: ${prod.total_signals}`);
  console.log(`   Wins: ${prod.wins}`);
  console.log(`   Losses: ${prod.losses}`);
  console.log(`   Expected: 0 total (v3.1.0 just deployed) ${prod.total_signals === '0' ? '✅' : '⚠️'}`);
  console.log('');

  // 9. Test legacy filter query
  console.log('9️⃣ Testing legacy filter query...');
  const legacyQuery = await sql`
    SELECT
      COUNT(*) as total_signals,
      COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
      COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses
    FROM signal_history
    WHERE outcome != 'PENDING'
      AND data_quality = 'legacy'
  `;

  const legacy = legacyQuery[0];
  console.log(`   Legacy signals: ${legacy.total_signals}`);
  console.log(`   Wins: ${legacy.wins}`);
  console.log(`   Losses: ${legacy.losses}`);
  console.log(`   Expected: ~1200+ total ${parseInt(legacy.total_signals) > 1000 ? '✅' : '⚠️'}`);
  console.log('');

  // 10. Test 'all' filter query (no filter)
  console.log('🔟 Testing "all" filter query (no data_quality filter)...');
  const allQuery = await sql`
    SELECT
      COUNT(*) as total_signals,
      COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
      COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses
    FROM signal_history
    WHERE outcome != 'PENDING'
  `;

  const all = allQuery[0];
  console.log(`   All signals: ${all.total_signals}`);
  console.log(`   Wins: ${all.wins}`);
  console.log(`   Losses: ${all.losses}`);
  console.log(`   Should equal legacy (${legacy.total_signals}) ${all.total_signals === legacy.total_signals ? '✅' : '⚠️'}`);
  console.log('');

  console.log('='.repeat(60));
  console.log('✅ VERIFICATION COMPLETE');
  console.log('='.repeat(60));

} catch (error) {
  console.error('\n❌ ERROR:', error.message);
  console.error('Stack:', error.stack);
} finally {
  await sql.end();
}
