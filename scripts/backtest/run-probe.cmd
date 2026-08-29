@echo off
REM Provenance probe runner (scheduled task).
REM Seeds signal_provenance from the real analysis path with NO side effects:
REM no Telegram, no cTrader execution. Stands down inside kill zones so it never
REM warms the cache out from under production's own signal generation.
cd /d "C:\Users\phili\Documents\Forex-Market-ANZ"
for /f "tokens=* usebackq" %%t in (`powershell -NoProfile -Command "(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')"`) do set NOW=%%t
echo. >> logs\provenance-probe.log
echo ===== %NOW% ===== >> logs\provenance-probe.log
call npx tsx scripts/backtest/provenance-probe.ts --avoid-kill-zones >> logs\provenance-probe.log 2>&1
