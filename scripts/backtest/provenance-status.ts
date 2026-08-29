/**
 * Provenance accumulation status.
 *
 * Answers two questions:
 *   1. Is the forward-verification sample growing, and is it varied enough to mean anything?
 *   2. Is PRODUCTION writing provenance, or only the local probe?
 *
 * How (2) is determined: `generateSignals()` runs only inside kill zones (07:00-09:59 and
 * 12:00-14:59 UTC) and the scheduled probe stands down in exactly those hours
 * (--avoid-kill-zones). So a row timestamped inside a kill zone came from production.
 *
 * That is inference from timing, not a tagged field — a probe run launched by hand without the
 * flag would land in the same bucket. Treat kill-zone rows as production only if nobody ran the
 * probe manually during those hours.
 *
 * USAGE: npx tsx scripts/backtest/provenance-status.ts
 */
import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1 });

(async () => {
  const [tot]: any = await sql`
    SELECT count(*)::int AS n,
           count(*) FILTER (WHERE produced)::int AS fired,
           min(analyzed_at) AS first_at, max(analyzed_at) AS last_at,
           count(DISTINCT symbol)::int AS symbols,
           count(DISTINCT date_trunc('day', analyzed_at))::int AS days
    FROM signal_provenance`;

  console.log(`signal_provenance: ${tot.n} row(s), ${tot.fired} fired, ${tot.symbols} symbol(s), ${tot.days} distinct day(s)`);
  if (!tot.n) { await sql.end({ timeout: 5 }); return; }
  console.log(`window: ${new Date(tot.first_at).toISOString().slice(0, 16)} -> ${new Date(tot.last_at).toISOString().slice(0, 16)}`);

  // Kill-zone rows are production's; the scheduled probe stands down in those hours.
  const [src]: any = await sql`
    SELECT
      count(*) FILTER (WHERE EXTRACT(hour FROM analyzed_at AT TIME ZONE 'UTC') BETWEEN 7 AND 9
                          OR EXTRACT(hour FROM analyzed_at AT TIME ZONE 'UTC') BETWEEN 12 AND 14)::int AS killzone,
      count(*) FILTER (WHERE NOT (EXTRACT(hour FROM analyzed_at AT TIME ZONE 'UTC') BETWEEN 7 AND 9
                               OR EXTRACT(hour FROM analyzed_at AT TIME ZONE 'UTC') BETWEEN 12 AND 14))::int AS outside
    FROM signal_provenance`;
  console.log(`\nby source (inferred from timing):`);
  console.log(`  in kill zone  (production): ${src.killzone}`);
  console.log(`  outside       (probe)     : ${src.outside}`);
  if (src.killzone === 0) {
    console.log(`  -> production has not written provenance yet. Expected once UptimeRobot hits a kill zone`);
    console.log(`     (07:00-09:59 / 12:00-14:59 UTC) AND Render is running the deploy that includes it.`);
  }

  const cache: any[] = await sql`
    SELECT cache_meta->'oneHour'->>'source' AS source, count(*)::int AS n,
           round(avg((cache_meta->'oneHour'->>'ageMinutes')::numeric), 1) AS avg_age_min,
           max((cache_meta->'oneHour'->>'ageMinutes')::int) AS max_age_min
    FROM signal_provenance WHERE cache_meta->'oneHour' IS NOT NULL
    GROUP BY 1 ORDER BY 2 DESC`;
  if (cache.length) {
    console.log(`\n1H cache source (the staleness that made history unreproducible):`);
    for (const c of cache) console.log(`  ${String(c.source).padEnd(12)} n=${String(c.n).padStart(4)}  avg age ${c.avg_age_min}min  max ${c.max_age_min}min`);
  }

  const rej: any[] = await sql`
    SELECT split_part(rejection_reason, ' ', 1) AS reason, count(*)::int AS n
    FROM signal_provenance WHERE NOT produced GROUP BY 1 ORDER BY 2 DESC LIMIT 8`;
  if (rej.length) {
    console.log(`\nwhy bars did not fire (the arm signal_history never recorded):`);
    for (const r of rej) console.log(`  ${String(r.reason).padEnd(28)} ${r.n}`);
  }

  await sql.end({ timeout: 5 });
})();
