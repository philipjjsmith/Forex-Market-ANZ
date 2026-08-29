/**
 * TEST SCRIPT - Try Pooler with Simplified Username
 * Testing if pooler works with just "postgres" instead of "postgres.projectid"
 */

import postgres from 'postgres';

// Try pooler with simple username
const client = postgres('postgresql://postgres:11Carlyrosa%21@aws-0-us-east-1.pooler.supabase.com:6543/postgres', {
  ssl: 'require',
  connect_timeout: 10,
});

async function testPoolerSimple() {
  console.log('🔌 TESTING POOLER WITH SIMPLE USERNAME');
  console.log('='.repeat(100));
  console.log('Connection: Pooler (port 6543)');
  console.log('Host: aws-0-us-east-1.pooler.supabase.com');
  console.log('Username: postgres (simplified)');
  console.log('='.repeat(100));
  console.log('');

  try {
    console.log('📊 Attempting connection...');
    const test = await client`SELECT NOW() as current_time`;
    console.log('✅ CONNECTION SUCCESSFUL!');
    console.log(`   Database Time: ${test[0].current_time}`);
    console.log('');
  } catch (error) {
    console.error('❌ CONNECTION FAILED:');
    console.error(error);
    if (error instanceof Error) {
      console.error(`\nError: ${error.message}`);
    }
  } finally {
    await client.end();
    process.exit(0);
  }
}

testPoolerSimple();
