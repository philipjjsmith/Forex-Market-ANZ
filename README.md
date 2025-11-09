# Forex Market ANZ - Market Analysis Platform

A professional forex market analysis platform with real-time data integration, technical indicators, and AI-powered trading signal generation.

## Features

- Real-time forex quotes from Frankfurter.app (European Central Bank data)
- Historical candle data from Twelve Data API
- Technical analysis with multiple indicators (RSI, ADX, Bollinger Bands, ATR, MACD, Moving Averages)
- AI-powered trading signal generation with entry/exit recommendations
- Automated signal generation every 15 minutes (24/7)
- Growth tracking and performance analytics
- Save and manage trading signals
- Professional UI with responsive design

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (version 18 or higher) - [Download here](https://nodejs.org/)
- **npm** (comes with Node.js)
- **Git** - [Download here](https://git-scm.com/)

## Installation & Setup

### Step 1: Clone the Repository

Open your terminal/command prompt and run:

```bash
git clone https://github.com/philipjjsmith/Forex-Market-ANZ.git
cd Forex-Market-ANZ
```

### Step 2: Install Dependencies

Install all required packages:

```bash
npm install
```

This will install all dependencies listed in `package.json`. It may take a few minutes.

### Step 3: Get Your Twelve Data API Key

1. Go to [Twelve Data](https://twelvedata.com/pricing)
2. Sign up for a free account (800 API calls/day)
3. Copy your API key from the dashboard

### Step 4: Set Up Supabase Database

1. Go to [Supabase](https://supabase.com) and create a new project
2. Get your database credentials from Settings → Database
3. Get your service role key from Settings → API

### Step 5: Configure Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Open the `.env` file and add your credentials:

```env
# Twelve Data API (historical candles)
TWELVE_DATA_KEY=your_twelve_data_api_key_here

# Supabase Database
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
SUPABASE_URL=https://[project-ref].supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key-here

# Server Configuration
NODE_ENV=development
PORT=5000
SESSION_SECRET=your-secret-key-change-this
```

**Important:** Replace all placeholder values with your actual credentials.

### Step 6: Start the Development Server

Run the application:

```bash
npm run dev
```

You should see output like:

```
serving on port 5000
```

### Step 7: Open in Your Browser

Open your web browser and navigate to:

```
http://localhost:5000
```

You should now see the Forex Signal Engine dashboard!

## How to Use the Application

### Automated Signal Generation
- Signals are automatically generated every 15 minutes for all currency pairs
- View real-time signals on the Dashboard
- Admin panel shows system health and signal performance

### Manual Analysis
1. **Click "Analyze Now"** on Dashboard - Generates signals on-demand
2. **View Signals** - Browse through generated signals with entry/exit prices
3. **Filter Signals** - Use confidence level and signal type filters
4. **Save Signals** - Click the star icon to save signals for later
5. **Growth Tracking** - Monitor performance in the Admin panel

**Note:** No daily quotas - system runs 24/7 automatically.

## Available Scripts

- `npm run dev` - Start development server with hot-reload
- `npm run build` - Build for production
- `npm start` - Run production server
- `npm run check` - Type-check the code

## Troubleshooting

### Port 5000 Already in Use

If you see an error about port 5000 being in use, you can change it in `.env`:

```env
PORT=3000
```

Then access the app at `http://localhost:3000`

### API Keys Not Working

Make sure:
- Your `.env` file is in the root directory (same folder as `package.json`)
- You copied the Twelve Data API key correctly (no extra spaces)
- Your Supabase credentials are correct
- Database connection string includes password and correct region

### Dependencies Won't Install

Try deleting `node_modules` and `package-lock.json`, then reinstall:

```bash
rm -rf node_modules package-lock.json
npm install
```

### Module Not Found Errors

Make sure you're in the correct directory:

```bash
pwd  # Should show /path/to/Forex-Market-ANZ
```

## Project Structure

```
Forex-Market-ANZ/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/    # UI components
│   │   ├── hooks/         # Custom React hooks
│   │   ├── lib/           # Technical indicators & strategies
│   │   └── pages/         # Page components
├── server/                # Express backend
│   ├── services/          # API services (Frankfurter, Twelve Data)
│   └── routes.ts          # API endpoints
├── shared/                # Shared types & schemas
├── .env                   # Environment variables (create this)
├── .env.example          # Example environment file
└── package.json          # Dependencies & scripts
```

## Technology Stack

- **Frontend:** React, TypeScript, Vite, TailwindCSS, shadcn/ui
- **Backend:** Node.js, Express, TypeScript
- **Database:** PostgreSQL (Supabase)
- **Data Sources:**
  - Frankfurter.app (forex quotes - unlimited, free)
  - Twelve Data API (historical candles)
- **Charts:** Recharts
- **State Management:** React Query
- **ORM:** Drizzle ORM

## API Information

- **Frankfurter.app:** Unlimited API calls, no authentication required, ECB data
- **Twelve Data Free Tier:** 800 API calls per day
- **Server Cache:** 15-minute cache to reduce API calls
- **Signal Generation:** Every 15 minutes (96 times/day)

## Support & Documentation

- **CLAUDE.md** - Detailed technical documentation for developers
- **design_guidelines.md** - UI/UX design system documentation
- **Issues:** [GitHub Issues](https://github.com/philipjjsmith/Forex-Market-ANZ/issues)

## License

This project is for educational and personal use.

---

**Built with Claude Code** - AI-powered development assistant

