# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

## Working with Signals

Trading signals are the core feature. When working with signals:

1. Signals must have all required fields (entry, stop, targets, confidence, rationale)
2. Confidence scores are built incrementally by the strategy (30% base + additional factors)
3. Risk/reward is calculated as (target - entry) / (stop - entry)
4. Order types determine execution: MARKET for immediate, LIMIT for price improvement, STOP for breakouts
5. Rationale must explain technical reasoning (concatenated from condition checks)

Saved signals are stored in localStorage with key `saved-signals`. The `SavedSignalsPanel` component manages this persistence.

## Code Style

- TypeScript strict mode enabled
- ESNext module system with ES module imports
- Functional components with hooks (no class components)
- Utility-first CSS with Tailwind
- Prefer composition over inheritance
- Export types alongside implementations from shared modules
