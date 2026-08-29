/**
 * TEST SCRIPT - New Supabase Direct Connection
 * Testing connection with new format from Supabase dashboard
 * Using: postgresql://postgres:password@db.bgfucdqnncvanznvcste.supabase.co:5432/postgres
 */

import postgres from 'postgres';

// NEW connection string (direct database, not pooler)
const client = postgres('postgresql://postgres:11Carlyrosa%21@db.bgfucdqnncvanznvcste.supabase.co:5432/postgres', {
  ssl: 'require',
  connect_timeout: 10,
});

const DEPLOYMENT_DATE = '2026-01-03 01:44:10'; // 3.0x ATR deployment

async function testConnection() {
  console.log('🔌 TESTING NEW SUPABASE CONNECTION');
  console.log('='.repeat(100));
  console.log('Connection: Direct Database (port 5432)');
  console.log('Host: db.bgfucdqnncvanznvcste.supabase.co');
  console.log('='.repeat(100));
  console.log('');

  try {
    // Test 1: Simple connection test
    console.log('📊 TEST 1: Basic Connection Test');
    console.log('-'.repeat(100));
    const test = await client`SELECT NOW() as current_time, version() as pg_version`;
    console.log('✅ CONNECTION SUCCESSFUL!');
    console.log(`   Database Time: ${test[0].current_time}`);
    console.log(`   PostgreSQL Version: ${test[0].pg_version.split(' ')[0]} ${test[0].pg_version.split(' ')[1]}`);
    console.log('');

    // Test 2: Check signal_history table exists
    console.log('📊 TEST 2: Verify signal_history Table Exists');
    console.log('-'.repeat(100));
    const tableCheck = await client`
      SELECT COUNT(*) as total_records
      FROM signal_history
    `;
    console.log(`✅ TABLE EXISTS: ${tableCheck[0].total_records} total records in database`);
    console.log('');

    // Test 3: Count signals since deployment
    console.log('📊 TEST 3: Count Signals Since 3.0x ATR Deployment');
    console.log('-'.repeat(100));
    const afterDeployment = await client`
      SELECT COUNT(*) as count
      FROM signal_history
      WHERE created_at >= ${DEPLOYMENT_DATE}::timestamp
    `;
    console.log(`✅ Found ${afterDeployment[0].count} signal(s) since Jan 3, 2026`);
    console.log('');

    // Test 4: Quick performance check
    console.log('📊 TEST 4: Quick Performance Snapshot');
    console.log('-'.repeat(100));
    const quickStats = await client`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE outcome = 'PENDING') as pending,
        COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
        COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses
      FROM signal_history
      WHERE created_at >= ${DEPLOYMENT_DATE}::timestamp
        AND trade_live = true
    `;
    console.log(`   Total Signals: ${quickStats[0].total}`);
    console.log(`   Wins: ${quickStats[0].wins}`);
    console.log(`   Losses: ${quickStats[0].losses}`);
    console.log(`   Pending: ${quickStats[0].pending}`);
    console.log('');

    console.log('='.repeat(100));
    console.log('✅ ALL CONNECTION TESTS PASSED!');
    console.log('='.repeat(100));
    console.log('');
    console.log('🎯 READY TO RUN FULL PROFITABILITY ANALYSIS');

  } catch (error) {
    console.error('');
    console.error('❌ CONNECTION FAILED:');
    console.error(error);
    console.error('');
    if (error instanceof Error) {
      console.error('Error details:');
      console.error(`  Message: ${error.message}`);
      console.error(`  Stack: ${error.stack}`);
    }
  } finally {
    await client.end();
    process.exit(0);
  }
}

testConnection();
