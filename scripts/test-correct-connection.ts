/**
 * TEST SCRIPT - Correct Connection String from Supabase
 * Testing: postgresql://postgres.bgfucdqnncvanznvcste:11Carlyrosa%21@aws-1-us-east-1.pooler.supabase.com:5432/postgres
 * KEY CHANGE: aws-0 → aws-1, port 6543 → 5432
 */

import postgres from 'postgres';

// CORRECT connection string from Supabase dashboard
const client = postgres('postgresql://postgres.bgfucdqnncvanznvcste:11Carlyrosa%21@aws-1-us-east-1.pooler.supabase.com:5432/postgres', {
  ssl: 'require',
  connect_timeout: 10,
});

const DEPLOYMENT_DATE = '2026-01-03 01:44:10'; // 3.0x ATR deployment

async function testCorrectConnection() {
  console.log('🔌 TESTING CORRECT SUPABASE CONNECTION');
  console.log('='.repeat(100));
  console.log('Host: aws-1-us-east-1.pooler.supabase.com (UPDATED from aws-0)');
  console.log('Port: 5432 (UPDATED from 6543)');
  console.log('='.repeat(100));
  console.log('');

  try {
    // Test 1: Basic connection
    console.log('📊 TEST 1: Basic Connection Test');
    console.log('-'.repeat(100));
    const test = await client`SELECT NOW() as current_time, version() as pg_version`;
    console.log('✅ CONNECTION SUCCESSFUL!');
    console.log(`   Database Time: ${test[0].current_time}`);
    console.log(`   PostgreSQL: ${test[0].pg_version.split(' ')[0]} ${test[0].pg_version.split(' ')[1]}`);
    console.log('');

    // Test 2: Verify table exists
    console.log('📊 TEST 2: Verify signal_history Table');
    console.log('-'.repeat(100));
    const tableCheck = await client`
      SELECT COUNT(*) as total_records
      FROM signal_history
    `;
    console.log(`✅ TABLE EXISTS: ${tableCheck[0].total_records} total records`);
    console.log('');

    // Test 3: Count signals since deployment
    console.log('📊 TEST 3: Signals Since 3.0x ATR Deployment (Jan 3, 2026)');
    console.log('-'.repeat(100));
    const afterDeployment = await client`
      SELECT COUNT(*) as count
      FROM signal_history
      WHERE created_at >= ${DEPLOYMENT_DATE}::timestamp
    `;
    console.log(`✅ Found ${afterDeployment[0].count} signal(s) generated since deployment`);
    console.log('');

    // Test 4: Quick performance snapshot
    console.log('📊 TEST 4: Quick Performance Check');
    console.log('-'.repeat(100));
    const quickStats = await client`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE trade_live = true) as live_trades,
        COUNT(*) FILTER (WHERE outcome = 'PENDING') as pending,
        COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
        COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses
      FROM signal_history
      WHERE created_at >= ${DEPLOYMENT_DATE}::timestamp
        AND trade_live = true
    `;

    const wins = parseInt(quickStats[0].wins);
    const losses = parseInt(quickStats[0].losses);
    const completed = wins + losses;
    const winRate = completed > 0 ? ((wins / completed) * 100).toFixed(1) : '0';

    console.log(`   Total Signals: ${quickStats[0].total}`);
    console.log(`   Live Trades: ${quickStats[0].live_trades}`);
    console.log(`   Completed: ${completed} (${wins} wins, ${losses} losses)`);
    console.log(`   Win Rate: ${winRate}%`);
    console.log(`   Pending: ${quickStats[0].pending}`);
    console.log('');

    console.log('='.repeat(100));
    console.log('✅ ALL TESTS PASSED! CONNECTION IS WORKING!');
    console.log('='.repeat(100));
    console.log('');
    console.log('🎯 READY TO RUN FULL PROFITABILITY ANALYSIS');

  } catch (error) {
    console.error('');
    console.error('❌ CONNECTION FAILED:');
    console.error(error);
    if (error instanceof Error) {
      console.error('');
      console.error(`Error: ${error.message}`);
    }
  } finally {
    await client.end();
    process.exit(0);
  }
}

testCorrectConnection();
