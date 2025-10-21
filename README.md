# Forex Market ANZ - Market Analysis Platform

A professional forex market analysis platform with real-time data integration, technical indicators, and AI-powered trading signal generation.

## Features

- Real-time forex data from Alpha Vantage API
- Technical analysis with multiple indicators (RSI, ADX, Bollinger Bands, ATR, Moving Averages)
- AI-powered trading signal generation with entry/exit recommendations
- Daily quota system (24 analyses per day)
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

### Step 3: Get Your Alpha Vantage API Key

1. Go to [Alpha Vantage](https://www.alphavantage.co/support/#api-key)
2. Enter your email and click "GET FREE API KEY"
3. Copy the API key you receive (it will look like: `ABC123XYZ456...`)

### Step 4: Configure Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Open the `.env` file in a text editor and add your Alpha Vantage API key:

```env
FOREX_API_KEY=your_actual_api_key_here
FOREX_API_PROVIDER=alphavantage
FOREX_API_BASE_URL=https://www.alphavantage.co/query
NODE_ENV=development
PORT=5000
SESSION_SECRET=your-secret-key-change-this
```

**Important:** Replace `your_actual_api_key_here` with the API key you got from Step 3.

### Step 5: Start the Development Server

Run the application:

```bash
npm run dev
```

You should see output like:

```
serving on port 5000
```

### Step 6: Open in Your Browser

Open your web browser and navigate to:

```
http://localhost:5000
```

You should now see the Forex Signal Engine dashboard!

## How to Use the Application

1. **Click "Analyze Now"** - This fetches real-time forex data and generates trading signals
2. **View Signals** - Browse through the generated trading signals with entry/exit prices
3. **Filter Signals** - Use the confidence level and signal type filters to narrow results
4. **Save Signals** - Click the star icon on any signal to save it for later
5. **View Indicators** - Check the right panel for real-time technical indicators

**Note:** You have 24 analyses per day. The quota resets at midnight UTC.

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

### API Key Not Working

Make sure:
- Your `.env` file is in the root directory (same folder as `package.json`)
- You copied the API key correctly (no extra spaces)
- The API key is from Alpha Vantage (not another provider)

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
│   ├── services/          # API services (Alpha Vantage)
│   └── routes.ts          # API endpoints
├── shared/                # Shared types & schemas
├── .env                   # Environment variables (create this)
├── .env.example          # Example environment file
└── package.json          # Dependencies & scripts
```

## Technology Stack

- **Frontend:** React, TypeScript, Vite, TailwindCSS, shadcn/ui
- **Backend:** Node.js, Express, TypeScript
- **Data Source:** Alpha Vantage API
- **Charts:** Recharts
- **State Management:** React Query

## API Rate Limits

- **Alpha Vantage Free Tier:** 25 API calls per day
- **App Quota System:** 24 analyses per day (saves 1 call as buffer)
- **Server Cache:** 5-minute cache to reduce API calls
- **Reset Time:** Midnight UTC

## Support & Documentation

- **CLAUDE.md** - Detailed technical documentation for developers
- **design_guidelines.md** - UI/UX design system documentation
- **Issues:** [GitHub Issues](https://github.com/philipjjsmith/Forex-Market-ANZ/issues)

## License

This project is for educational and personal use.

---

**Built with Claude Code** - AI-powered development assistant

