import 'dotenv/config';
/**
 * TEST SCRIPT - Test OLD Connection String (aws-0:6543)
 * Testing if the old connection string that's in .env actually works
 */

import postgres from 'postgres';

// OLD connection string from current .env file
const oldClient = postgres(process.env.DATABASE_URL, {
  ssl: 'require',
  connect_timeout: 10,
});

async function testOldConnection() {
  console.log('🔌 TESTING OLD CONNECTION STRING (aws-0:6543)');
  console.log('='.repeat(100));
  console.log('This is what Render might be using...');
  console.log('Connection: aws-0-us-east-1.pooler.supabase.com:6543');
  console.log('='.repeat(100));
  console.log('');

  try {
    console.log('📊 Attempting connection...');
    const test = await oldClient`SELECT NOW() as current_time, COUNT(*) as total FROM signal_history`;
    console.log('✅ CONNECTION SUCCESSFUL!');
    console.log(`   Database Time: ${test[0].current_time}`);
    console.log(`   Total Records: ${test[0].total}`);
    console.log('');
    console.log('⚠️  OLD CONNECTION STILL WORKS!');
    console.log('   This means the database connection is NOT the problem.');
    console.log('');
  } catch (error) {
    console.error('');
    console.error('❌ CONNECTION FAILED WITH OLD STRING:');
    console.error(error);
    if (error instanceof Error) {
      console.error('');
      console.error(`Error: ${error.message}`);
      console.error('');
      console.error('🎯 THIS CONFIRMS: Render needs DATABASE_URL updated!');
    }
  } finally {
    await oldClient.end();
    process.exit(0);
  }
}

testOldConnection();
