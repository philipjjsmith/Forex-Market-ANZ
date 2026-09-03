import fs from 'fs';
const f = 'scripts/check-pipeline.ts';
let s = fs.readFileSync(f, 'utf8');
const anchor = `  console.log(\`\n=== ANALYSES BY OUTCOME (last \${DAYS} days, production only) ===\`);`;
const add = `  // A SETUP THAT PASSED EVERY TREND GATE AND WAS THEN VETOED IS THE MOST VALUABLE ROW HERE.
  //
  // These are not "no trade today" — the engine found an aligned entry, scored it, and a single
  // hard bound rejected it. On 2026-09-03 this happened to USD/JPY 21 consecutive times with
  // RSI 7.9-15.2 against a floor of 22, and it was invisible: the RSI return path pushed nothing
  // to the trace, so every one of them was written down as 'UNKNOWN'.
  console.log(\`\n=== SETUPS VETOED AFTER SCORING (RSI hard bound) ===\`);
  const vetoed = await db\`
    SELECT analyzed_at, symbol, rejection_reason
    FROM signal_provenance
    WHERE source = 'production'
      AND rejection_reason LIKE 'RSI_BLOCKED%'
      AND analyzed_at > NOW() - (\${DAYS} || ' days')::interval
    ORDER BY analyzed_at DESC\`;
  if (!vetoed.length) console.log('  none');
  for (const r of vetoed as any[]) console.log(\`  \${t(r.analyzed_at)} \${String(r.symbol).padEnd(8)} \${r.rejection_reason}\`);
  if (vetoed.length) {
    const bySymbol = new Map<string, number>();
    for (const r of vetoed as any[]) bySymbol.set(r.symbol, (bySymbol.get(r.symbol) ?? 0) + 1);
    for (const [sym, n] of bySymbol)
      if (n >= 3) console.log(\`  ⚠️  \${sym}: the SAME gate rejected a scored setup \${n} times in this window\`);
  }

`;
if (s.split(anchor).length - 1 !== 1) { console.error('ABORT: anchor not unique'); process.exit(1); }
fs.writeFileSync(f, s.replace(anchor, add + anchor));
console.log('OK: check-pipeline now surfaces vetoed setups');
