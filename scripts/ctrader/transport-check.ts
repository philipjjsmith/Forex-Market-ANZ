/**
 * Transport reachability check for the cTrader executor. READ-ONLY, sends no order.
 *
 * Exercises the REAL executor methods (openConnection/send/waitFor) with deliberately invalid
 * credentials, so it needs no secrets and can be run anywhere. cTrader's correct answer to bad
 * credentials is CH_CLIENT_AUTH_FAILURE — receiving it proves the transport reaches the server.
 *
 * This exists because the executor spent its entire life speaking raw framed TCP to port 5036,
 * which answers only WebSocket. Every message was silently discarded and nothing ever errored.
 * A timeout here means that class of bug is back.
 *
 * USAGE: npx tsx scripts/ctrader/transport-check.ts
 */
process.env.CTRADER_CLIENT_ID = 'invalid_probe_id';
process.env.CTRADER_CLIENT_SECRET = 'invalid_probe_secret';
import { ctraderExecutor } from '../../server/services/ctrader-executor';

const X = ctraderExecutor as any;

(async () => {
  let allReached = true;
  for (const host of ['demo.ctraderapi.com', 'live.ctraderapi.com']) {
    const t0 = Date.now();
    try {
      const { socket, emitter } = await X.openConnection(host);
      X.send(socket, 2100, { clientId: 'invalid_probe_id', clientSecret: 'invalid_probe_secret' });
      await X.waitFor(emitter, 2101, 20000);
      console.log(`${host}: UNEXPECTED — fake credentials were accepted (${Date.now() - t0}ms)`);
      socket.close();
      allReached = false;
    } catch (e: any) {
      const reached = /CH_CLIENT_AUTH_FAILURE/.test(e.message);
      if (!reached) allReached = false;
      console.log(`${host}: ${reached ? 'REACHED ✅' : 'UNREACHABLE ❌'} -> ${e.message} (${Date.now() - t0}ms)`);
    }
  }
  console.log(allReached ? '\nTransport OK — cTrader is answering.' : '\nTRANSPORT BROKEN.');
  process.exit(allReached ? 0 : 1);
})();
