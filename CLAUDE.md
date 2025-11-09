# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ CRITICAL: Always Check Remote Repository First

**BEFORE analyzing ANY code or answering questions about the codebase:**

1. **Fetch latest from GitHub:**
   ```bash
   git fetch origin
   git log origin/main --oneline -10
   ```

2. **Check what's actually deployed:**
   - This project deploys directly from GitHub → Render (backend) + Cloudflare (frontend)
   - Local files may be OUTDATED
   - The source of truth is `origin/main` on GitHub

3. **Verify file contents from remote:**
   ```bash
   # Read files from GitHub, not local
   git show origin/main:path/to/file.ts

   # List files on remote
   git ls-tree origin/main path/to/directory/
   ```

4. **Check for local divergence:**
   ```bash
   git diff main origin/main --name-only
   ```

**Why this matters:**
- User deploys directly through Cloudflare/Render/GitHub
- Local workspace may be behind remote by many commits
- Always verify against `origin/main` before providing information

**Production Deployment URLs:**
- Frontend: https://forex-market-anz.pages.dev/
- Backend: https://forex-market-anz.onrender.com
- Database: Supabase PostgreSQL

## Project Overview

MarketWatchPro is a professional market analysis and trading platform for forex and financial markets. It provides real-time data visualization, technical analysis tools, trading signal generation, and portfolio management. The application is built as a full-stack TypeScript monorepo with React frontend and Express backend.

## Development Commands

### Running the Application
```bash
# Development mode with HMR
npm run dev

# Build for production
npm run build

# Run production server
npm start
```

### Type Checking & Database
```bash
# Type check without emitting files
npm run check

# Push database schema changes
npm run db:push
```

## Architecture

### Monorepo Structure
The codebase is organized into three main directories:

- **`client/`** - React frontend application
  - `client/src/components/` - React components (UI primitives in `ui/`, feature components at root)
    - `TradingChartWidget.tsx` - Interactive trading charts with lightweight-charts
    - `ProjectionTradingGame.tsx` - Educational trading simulator game
    - `TradingSimulator.tsx` - Practice trading with mock data
  - `client/src/lib/` - Core logic: technical indicators, trading strategies, utilities
  - `client/src/pages/` - Page-level components
    - `Dashboard.tsx` - Main dashboard with charts and signals
    - `Learn.tsx` - Educational content and trading tutorials
  - `client/src/hooks/` - Custom React hooks

- **`server/`** - Express backend
  - `server/index.ts` - Main server entry point with CORS and session management
  - `server/routes.ts` - API route definitions (all routes prefixed with `/api`)
  - `server/db.ts` - Drizzle ORM database connection (postgres-js)
  - `server/supabase.ts` - Supabase client for auth operations
  - `server/storage.ts` - Drizzle ORM storage implementation
  - `server/auth-middleware.ts` - JWT authentication middleware
  - `server/jwt.ts` - JWT token utilities
  - `server/vite.ts` - Vite dev server integration for HMR

- **`shared/`** - Shared types and schemas
  - `shared/schema.ts` - Drizzle ORM schemas and Zod validation types

### Path Aliases
TypeScript is configured with the following path aliases:
- `@/*` → `client/src/*`
- `@shared/*` → `shared/*`
- `@assets/*` → `attached_assets/*`

Always use these aliases for imports to maintain consistency.

### Build System
- **Frontend**: Vite builds React app to `dist/public/`
- **Backend**: esbuild bundles server code to `dist/`
- **Development**: Vite dev server with HMR integrated into Express server

## External APIs & Data Sources

### Frankfurter.app (Primary Forex Data)
**Location:** `server/services/exchangerate-api.ts` (note: file name is legacy, actually uses Frankfurter.app)
- **Purpose:** Real-time forex exchange rates
- **Base URL:** `https://api.frankfurter.app`
- **Authentication:** None required (free, unlimited)
- **Data Source:** European Central Bank official rates
- **Caching:** 15-minute TTL to reduce API calls
- **Pairs:** EUR/USD, GBP/USD, USD/JPY, AUD/USD, USD/CHF

**Why Frankfurter:**
- No API key required (unlimited, free forever)
- Official European Central Bank exchange rate data
- Reliable and accurate for forex trading signals
- Perfect for 96+ calls/day usage pattern (every 15 min × 5 pairs)

### Twelve Data API (Historical Candles)
**Location:** `server/services/twelve-data.ts`
- **Purpose:** Historical candle data for technical analysis
- **Base URL:** `https://api.twelvedata.com`
- **Authentication:** Requires `TWELVE_DATA_KEY` env variable
- **Free Tier:** 800 API calls per day
- **Usage:** 1440 x 5-minute candles per analysis
- **Rate Limiting:** 8 seconds between calls (8 calls/minute)

### Signal Generation Pipeline
**Location:** `server/services/signal-generator.ts`
1. Fetch real-time quotes from Frankfurter.app
2. Fetch historical candles from Twelve Data
3. Run technical analysis (MA, RSI, ATR, ADX, BB)
4. Generate signals with confidence scoring
5. AI analyzer adds confidence adjustments
6. Store in Supabase database
7. Outcome validator tracks performance

**Automation:**
- Cron endpoint: `/api/cron/generate-signals`
- Runs every 15 minutes (triggered by UptimeRobot)
- Currently generating ~930 signals

## Technical Analysis System

### Indicators (`client/src/lib/indicators.ts`)
The `Indicators` class provides static methods for technical analysis:
- `sma()`, `ema()` - Moving averages
- `rsi()` - Relative Strength Index
- `atr()` - Average True Range
- `adx()` - Average Directional Index
- `bollingerBands()` - Bollinger Bands

All indicators accept price/candle data arrays and period parameters, returning calculated values or `null` if insufficient data.

### Trading Strategy (`client/src/lib/strategy.ts`)
The `MACrossoverStrategy` class implements multi-timeframe MA crossover analysis:
- Requires minimum 200 candles for analysis
- Compares 20/50 EMA crossovers with higher timeframe trend confirmation
- Generates `Signal` objects with entry/exit levels, confidence scores, and detailed rationale
- Supports multiple order types (MARKET, LIMIT, STOP, STOP_LIMIT)
- Minimum 50% confidence threshold for signal generation

Signals include risk management parameters (stop loss, take profit targets) calculated using ATR-based position sizing.

## UI Component System

### shadcn/ui Pattern
The project uses shadcn/ui components built on Radix UI primitives. Components are located in `client/src/components/ui/` and are fully customizable. Do not modify these files directly - they are designed to be copied and adapted.

### Design System
Reference `design_guidelines.md` for the complete design system including:

**Colors**:
- Primary: `#1E3A8A` (deep blue)
- Market gains: `#059669` (green)
- Market losses: `#DC2626` (red)
- Accent: `#6366F1` (indigo)
- Background: `#F8FAFC` (light grey)

**Typography**:
- UI text: Inter
- Data/numbers: Roboto
- Prices/monospace: JetBrains Mono

**Financial Data Conventions**:
- Forex prices: 5 decimal places
- Green = positive/gains, Red = negative/losses (universal)
- Right-align numeric data in tables
- Use monospace fonts for price displays

**UI Terminology (Beginner-Friendly)**:
- **NEVER use:** "HIGH QUALITY", "MEDIUM QUALITY", "points", "paper trading"
- **ALWAYS use:** "LIVE TRADING", "PRACTICE SIGNAL", "% confidence", "demo account"
- **Rationale:** Terminology researched from forex industry standards (2025-10-26)
  - Modern forex platforms use "demo account" not "paper trading"
  - Beginners understand "%" better than abstract "points"
  - "LIVE TRADING" vs "PRACTICE" is clearer than quality tiers
- **Display format:** "{confidence}%" not "{confidence} points"
- **Tier badges:** Must show Signal Bars (cell phone signal-like icons) for accessibility

### Key Component Patterns
- **Charts**: Built with Recharts, minimum 600px height
- **Data Tables**: Sticky headers, sortable columns, alternating row backgrounds
- **Signal Cards**: Display entry/exit prices, confidence badges, collapsible rationale
- **Responsive Layout**: Mobile-first with `md:` (tablet) and `lg:` (desktop) breakpoints

## Database & ORM

### Supabase PostgreSQL Setup
The application uses **Supabase** for database and authentication with a dual-client approach:

1. **Drizzle ORM** (`server/db.ts`):
   - Schema definitions in `shared/schema.ts`
   - PostgreSQL via `postgres` (postgres-js driver)
   - Zod schemas auto-generated with `drizzle-zod`
   - Migration command: `npm run db:push`
   - Uses `DATABASE_URL` environment variable

2. **Supabase Client** (`server/supabase.ts`):
   - Direct Supabase SDK for auth and RLS features
   - Uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables
   - Enables server-side auth operations

### Current Schema
- `users` table: Full authentication (id, username, email, password, googleId, reset tokens)
- `savedSignals` table: User's saved trading signals with historical candle data
- Session storage: PostgreSQL-backed sessions via `connect-pg-simple`

### Environment Variables Required
- `DATABASE_URL` - PostgreSQL connection string (from Supabase)
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key for server operations
- `SESSION_SECRET` - Express session encryption key

### Storage Pattern
The `server/storage.ts` file implements Drizzle ORM database operations. All data operations go through this interface (e.g., `storage.getUserByUsername()`, `storage.saveSignal()`).

### Credential Management
See `.claude/CREDENTIALS.md` for complete documentation on where credentials are stored and how to access service dashboards.

## State Management

- **Server State**: React Query (`@tanstack/react-query`) for API data fetching and caching
- **Local State**: React hooks (useState, useReducer)
- **Persistence**: LocalStorage for user preferences (e.g., saved signals)

Query client is configured in `client/src/lib/queryClient.ts`.

## Development Notes

### Replit Integration
This project includes Replit-specific plugins (cartographer, dev-banner, runtime-error-modal) that only load in Replit development environment. These are optional and do not affect local development.

### Session Management
Session infrastructure (express-session, passport, connect-pg-simple) is configured but authentication routes are not yet implemented. Add auth routes in `server/routes.ts` when implementing user authentication.

### Mock Data
The application includes comprehensive mock data generation for candles and market data, enabling frontend development without external API dependencies. Look for mock data generation in component files and consider extracting to shared utilities when scaling.

## Signal Generation System

### Tiered Confidence System
Signals are classified into two tiers based on confidence scoring:

**HIGH Tier (85-126 points):**
- **Display:** "LIVE TRADING" badge with 5 Signal Bars (blue/cyan gradient)
- **Trading Mode:** Approved for live trading with 1% account risk per trade
- **Auto-tracking:** Automatically saved to database when generated
- **Filter:** Visible when "Live Trading (85-100%)" filter is selected

**MEDIUM Tier (70-84 points):**
- **Display:** "PRACTICE SIGNAL" badge with 3 Signal Bars (slate gray)
- **Trading Mode:** Demo account only, 0% account risk (paper trading)
- **Auto-tracking:** Automatically saved to database when generated
- **Filter:** Visible when "Practice Signal (70-84%)" filter is selected

**Signals below 70 points are discarded and not saved.**

### Confidence Scoring Algorithm (Max: 126 points)

The signal generator (`server/services/signal-generator.ts`) uses an additive point system:

**Guaranteed Points (if conditions met):**
1. HTF trend aligned: **25 points** - Daily trend matches signal direction
2. Entry signal detected: **20 points** - MA crossover or pullback pattern
3. Candle close confirmation: **5 points** - 4H candle closed confirming signal
4. Clear of news: **3 points** - No major news events within 2-hour window

**Conditional Points (high-probability criteria):**
5. RSI in optimal range: **15 points** - RSI between 40-70 (LONG) or 30-60 (SHORT)
6. ADX > 25: **15 points** - Strong trend confirmation
7. HTF trend strength: **10 points** - Daily MA separation > 0.25% (realistic for forex)
8. BB position: **8 points** - Price in lower/upper BB region for optimal entry

**Bonus Points (rare but valuable):**
9. Support/Resistance confluence: **15 points** - Entry within 0.25% (25 pips) of key level
10. Breakout & Retest pattern: **10 points** - Specific price action setup detected

**Typical Scoring Examples:**
- **Strong signal:** 25+20+15+15+10+8+5+3 = **101 points** (HIGH tier)
- **Good signal:** 25+20+15+15+8+5+3 = **91 points** (HIGH tier)
- **Decent signal:** 25+20+15+8+5+3 = **76 points** (MEDIUM tier)

**Important Notes:**
- Scoring was adjusted on 2025-10-26 to make 85+ achievable with realistic market conditions
- Previous max was 120 points with stricter criteria (signals maxed at 82%)
- HTF trend strength threshold lowered from 0.5% to 0.25% for forex volatility
- S/R confluence tolerance increased from 20 pips to 25 pips
- RSI and ADX points increased from 12 to 15 each

### Signal Requirements

1. Signals must have all required fields (entry, stop, targets, confidence, rationale, tier, tradeLive, positionSizePercent)
2. Confidence is stored as raw points (70-126), displayed as percentage in UI
3. Risk/reward is calculated as (target - entry) / (stop - entry)
4. Order types determine execution: MARKET for immediate, LIMIT for price improvement, STOP for breakouts
5. Rationale must explain technical reasoning (concatenated from condition checks)

### Signal Tracking
- **Auto-tracking:** All signals ≥70% are automatically saved to `signal_history` table
- **Manual tracking:** Dashboard "Analyze Markets" button also saves to database
- **User-specific:** Signals are associated with user_id for privacy
- **Expiration:** Signals expire after 48 hours if not resolved
- **LocalStorage:** Legacy saved signals stored with key `saved-signals` (being phased out)

## Code Style

- TypeScript strict mode enabled
- ESNext module system with ES module imports
- Functional components with hooks (no class components)
- Utility-first CSS with Tailwind
- Prefer composition over inheritance
- Export types alongside implementations from shared modules
