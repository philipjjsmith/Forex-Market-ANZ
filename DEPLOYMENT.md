# Deployment Guide

This guide covers deploying MarketWatchPro to **Cloudflare Pages** and **Vercel**.

## Build Overview

The application uses a monorepo structure with separate build outputs:
- **Frontend**: Vite builds React app to `dist/public/`
- **Backend**: esbuild bundles Express server to `dist/index.js`

### Build Command
```bash
npm run build
```

This runs:
1. `vite build` → Outputs to `dist/public/`
2. `esbuild server/index.ts` → Outputs to `dist/index.js`

---

## Environment Variables

Both platforms require these environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `FOREX_API_KEY` | Alpha Vantage API key | `5ES11PSM60ESIMHH` |
| `FOREX_API_PROVIDER` | Forex data provider | `alphavantage` |
| `FOREX_API_BASE_URL` | API base URL | `https://www.alphavantage.co/query` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `SESSION_SECRET` | Session encryption secret | Generate with `openssl rand -base64 32` |
| `NODE_ENV` | Environment | `production` |
| `PORT` | Server port | `5000` (auto-set by platforms) |

---

## Cloudflare Pages Deployment

### Prerequisites
- Cloudflare account
- Wrangler CLI installed: `npm install -g wrangler`
- Logged in: `wrangler login`

### Configuration
The `wrangler.toml` file is already configured:
```toml
name = "marketwatchpro"
compatibility_date = "2025-10-10"

[assets]
directory = "./dist/public"

[vars]
FOREX_API_KEY = "your_api_key_here"
FOREX_API_PROVIDER = "alphavantage"
FOREX_API_BASE_URL = "https://www.alphavantage.co/query"
NODE_ENV = "production"
PORT = "5000"
SESSION_SECRET = "generate_secure_secret"
```

### Deploy Steps

1. **Update wrangler.toml with your values**:
   ```bash
   # Edit wrangler.toml and replace placeholder values
   nano wrangler.toml
   ```

2. **Add DATABASE_URL as a secret** (sensitive data):
   ```bash
   wrangler secret put DATABASE_URL
   # Enter your PostgreSQL connection string when prompted
   ```

3. **Build the application**:
   ```bash
   npm run build
   ```

4. **Deploy to Cloudflare**:
   ```bash
   wrangler pages deploy
   ```

5. **Access your site**:
   - Dashboard: https://dash.cloudflare.com
   - Your app: https://marketwatchpro.pages.dev

### Automatic Deployments (Optional)
Connect your Git repository in Cloudflare Dashboard:
1. Go to Workers & Pages → Create
2. Connect to Git
3. Select repository
4. Build settings:
   - Build command: `npm run build`
   - Output directory: `dist/public`

---

## Vercel Deployment

### Prerequisites
- Vercel account
- Vercel CLI installed: `npm install -g vercel`
- Logged in: `vercel login`

### Configuration
The `vercel.json` file is already configured:
```json
{
  "version": 2,
  "buildCommand": "npm run build",
  "outputDirectory": "dist/public",
  "functions": {
    "dist/index.js": {
      "runtime": "nodejs20.x"
    }
  },
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "/dist/index.js"
    },
    {
      "src": "/(.*)",
      "dest": "/dist/public/$1"
    }
  ]
}
```

### Deploy Steps

1. **Set environment variables**:
   ```bash
   # Set each environment variable as a Vercel secret
   vercel env add FOREX_API_KEY
   vercel env add DATABASE_URL
   vercel env add SESSION_SECRET
   ```

2. **Build locally first (optional but recommended)**:
   ```bash
   npm run build
   ```

3. **Deploy to Vercel**:
   ```bash
   # For production
   vercel --prod

   # Or for preview
   vercel
   ```

4. **Access your site**:
   - Dashboard: https://vercel.com/dashboard
   - Your app: https://your-project.vercel.app

### Automatic Deployments via Git
1. Go to Vercel Dashboard → Add New Project
2. Import your Git repository
3. Configure build settings:
   - Framework Preset: `Vite`
   - Build Command: `npm run build`
   - Output Directory: `dist/public`
   - Install Command: `npm install`
4. Add environment variables in Settings → Environment Variables
5. Deploy

---

## Database Setup

Both platforms require a PostgreSQL database. Recommended providers:

### Option 1: Neon (Recommended for Vercel)
1. Sign up at https://neon.tech
2. Create a new project
3. Copy connection string
4. Add to environment variables as `DATABASE_URL`

### Option 2: Supabase
1. Sign up at https://supabase.com
2. Create a new project
3. Go to Settings → Database → Connection string
4. Use "Session" mode connection string
5. Add to environment variables as `DATABASE_URL`

### Option 3: Cloudflare D1 (for Cloudflare Pages)
1. Create D1 database:
   ```bash
   wrangler d1 create marketwatchpro-db
   ```
2. Update wrangler.toml:
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "marketwatchpro-db"
   database_id = "<your-database-id>"
   ```

### Run Migrations
After deploying, run the SQL migrations:

```bash
# Connect to your database and run:
psql $DATABASE_URL < migrations/create_auto_trader_tables.sql
```

Or use Drizzle Kit:
```bash
npm run db:push
```

---

## Post-Deployment Checklist

- [ ] Build completes successfully (`npm run build`)
- [ ] All environment variables are set
- [ ] Database is provisioned and accessible
- [ ] Migrations have been run
- [ ] Application starts without errors
- [ ] Frontend loads correctly
- [ ] API endpoints respond (test `/api/health` or similar)
- [ ] Authentication works (login/register)
- [ ] Auto-trader can fetch forex data
- [ ] Database operations work (create user, save trades)

---

## Troubleshooting

### Build Fails
- **Issue**: TypeScript errors
- **Fix**: Run `npm run check` locally first to catch errors

### Database Connection Issues
- **Issue**: "Connection refused" or timeout
- **Fix**: Ensure `DATABASE_URL` is set and database accepts connections from your deployment platform's IPs

### Environment Variables Not Working
- **Cloudflare**: Check wrangler.toml `[vars]` section and secrets
- **Vercel**: Check dashboard → Settings → Environment Variables

### API Routes Return 404
- **Vercel**: Verify `vercel.json` routes configuration
- **Cloudflare**: Ensure server function is deployed alongside static assets

### Session Issues
- **Issue**: Users logged out constantly
- **Fix**: Ensure `SESSION_SECRET` is set and consistent across deployments

---

## Performance Optimization

### Code Splitting (Recommended)
The build warns about large chunks (>500KB). To optimize:

1. **Add manual chunking** in `vite.config.ts`:
```typescript
export default defineConfig({
  // ... existing config
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom'],
          'charts': ['recharts', 'lightweight-charts'],
          'ui': [/@radix-ui/],
        }
      }
    }
  }
});
```

2. **Use dynamic imports** for heavy components:
```typescript
// Instead of:
import { AutoTraderPanel } from './components/AutoTraderPanel';

// Use:
const AutoTraderPanel = lazy(() => import('./components/AutoTraderPanel'));
```

---

## Monitoring

### Cloudflare
- Analytics: Cloudflare Dashboard → Analytics
- Logs: `wrangler pages deployment tail`

### Vercel
- Analytics: Vercel Dashboard → Analytics
- Logs: Vercel Dashboard → Deployments → View logs

---

## Support

- **Cloudflare Docs**: https://developers.cloudflare.com/pages
- **Vercel Docs**: https://vercel.com/docs
- **Drizzle ORM**: https://orm.drizzle.team/docs/overview

For project-specific issues, check the console logs and database connection first.
