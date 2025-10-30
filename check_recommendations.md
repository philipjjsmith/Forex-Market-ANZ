# Troubleshooting Steps - Why No Recommendations Showing

## Step 1: Has Backtesting Been Run?
The backtesting engine must be triggered to generate recommendations.
Recommendations don't exist until backtesting runs on symbols with 30+ signals.

## Step 2: Check API Response
In browser console on Admin page:
```javascript
fetch('https://forex-market-anz.onrender.com/api/ai/recommendations', {
  credentials: 'include',
  headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
})
.then(r => r.json())
.then(data => console.log('Recommendations:', data))
```

## Step 3: Check Database Directly
Query the database to see if recommendations exist:
```sql
SELECT * FROM strategy_adaptations WHERE status = 'pending';
```

## Step 4: Verify Symbols Have 30+ Signals
```javascript
fetch('https://forex-market-anz.onrender.com/api/ai/insights', {
  credentials: 'include',
  headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
})
.then(r => r.json())
.then(data => console.log('Symbol Insights:', data.symbolInsights))
```

## Step 5: Trigger Backtesting
If symbols have 30+ signals but no recommendations:
```javascript
fetch('https://forex-market-anz.onrender.com/api/ai/backtest', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
})
.then(r => r.json())
.then(data => console.log('Backtest triggered:', data))
```
