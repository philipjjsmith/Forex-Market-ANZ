/**
 * cTrader connection diagnostic — READ ONLY.
 *
 * Authenticates against cTrader and reports which accounts exist and whether each is live or
 * demo. It places NO orders: it never sends NEW_ORDER_REQ.
 *
 * Run this BEFORE enabling the executor. Demo mode selects `isLive === false`, so if no demo
 * account exists the executor will (correctly) refuse to run rather than fall back to a live
 * account. Knowing that in advance is the difference between a clean setup and an ugly surprise.
 *
 * USAGE: npx tsx scripts/ctrader-diagnose.ts
 */
import 'dotenv/config';
import { ctraderExecutor } from '../server/services/ctrader-executor';

(async () => {
  console.log('cTrader diagnostic — read only, places no orders\n');
  console.log(`  CTRADER_ENABLED    : ${process.env.CTRADER_ENABLED === 'true' ? 'true' : 'not set (executor disabled)'}`);
  console.log(`  CTRADER_MODE       : ${process.env.CTRADER_MODE ?? 'not set -> demo'}`);
  console.log(`  CTRADER_ALLOW_LIVE : ${process.env.CTRADER_ALLOW_LIVE === 'true' ? 'true' : 'not set'}`);
  // configured() consults the PERSISTED token; the env seed is dead after its first use.
  console.log(`  credentials present: ${await ctraderExecutor.configured() ? 'yes' : 'NO'}`    + ` (env seed present: ${(ctraderExecutor as any).isConfiguredFromEnv ? 'yes' : 'no'})`);
  console.log(`  resolved mode      : ${(ctraderExecutor as any).isLiveMode ? 'LIVE (REAL MONEY)' : 'DEMO'}\n`);

  try {
    const r = await ctraderExecutor.listAccounts();
    console.log(`  connected to ${r.host}  (mode=${r.mode})`);
    if (!r.accounts.length) {
      console.log('  NO ACCOUNTS returned for this cTID.');
      console.log('  -> the refresh token may belong to a closed account, or no account is linked.');
    } else {
      console.log(`  ${r.accounts.length} account(s):`);
      for (const a of r.accounts) console.log(`     id=${a.id}  ${a.isLive ? 'LIVE' : 'DEMO'}`);
      const demo = r.accounts.filter(a => !a.isLive).length;
      console.log(`\n  demo accounts: ${demo}  ->  ${demo ? 'demo mode will work' : 'demo mode will REFUSE to run (correct, and safe)'}`);
    }
  } catch (e: any) {
    console.log(`  CONNECTION FAILED: ${String(e?.message).slice(0, 200)}`);
    console.log('\n  Common causes:');
    console.log('   - refresh token was issued for an account that has since been closed');
    console.log('   - token expired or was revoked -> re-run the OAuth flow to get a new one');
    console.log('   - credentials belong to a different cTrader application');
  }
  process.exit(0);
})();
