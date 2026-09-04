import fs from 'fs';
const f = 'server/services/prop-firm-config.ts';
let s = fs.readFileSync(f, 'utf8');
const from = `        SELECT COUNT(*) as n
        FROM signal_history
        WHERE data_quality = 'production'
          AND DATE(created_at AT TIME ZONE 'UTC') = \${today}::date
          AND outcome IN ('PENDING', 'TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')`;
const to = `        SELECT COUNT(*) as n
        FROM signal_history
        WHERE data_quality = 'production'
          -- ONLY TIER THAT CAN CONSUME A SLOT. MEDIUM signals carry positionSizePercent = 0,
          -- are never sent to the broker, and never risk a cent -- yet they were counted, so a
          -- practice signal could exhaust the cap and block a live trade. The cap exists to
          -- limit RISK; a 0%-risk row is not risk.
          AND tier = 'HIGH'
          AND DATE(created_at AT TIME ZONE 'UTC') = \${today}::date
          AND outcome IN ('PENDING', 'TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')`;
const n = s.split(from).length - 1;
if (n !== 1) { console.error('ABORT: ' + n + ' matches'); process.exit(1); }
fs.writeFileSync(f, s.replace(from, to));
console.log('OK: daily cap now counts HIGH tier only');
