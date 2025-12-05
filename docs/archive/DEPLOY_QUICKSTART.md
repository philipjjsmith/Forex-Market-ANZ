# Quick Deployment Guide

## Prerequisites
- Production database (Neon, Supabase, or other PostgreSQL)
- API keys ready
- Git repository pushed to GitHub/GitLab

---

## Option 1: Vercel (Recommended for Full-Stack)

### Via CLI
```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Set environment variables
vercel env add FOREX_API_KEY
vercel env add DATABASE_URL
vercel env add SESSION_SECRET

# Deploy
vercel --prod
```

### Via Dashboard
1. Go to https://vercel.com/new
2. Import Git repository
3. Framework: **Vite**
4. Build Command: `npm run build`
5. Output Directory: `dist/public`
6. Add environment variables in Settings
7. Deploy

---

## Option 2: Cloudflare Pages

### Via CLI
```bash
# Install Wrangler
npm i -g wrangler

# Login
wrangler login

# Update wrangler.toml with your values
nano wrangler.toml

# Add sensitive secrets
wrangler secret put DATABASE_URL
wrangler secret put SESSION_SECRET

# Build and deploy
npm run build
wrangler pages deploy
```

### Via Dashboard
1. Go to https://dash.cloudflare.com
2. Workers & Pages → Create → Connect to Git
3. Select repository
4. Build Command: `npm run build`
5. Output Directory: `dist/public`
6. Add environment variables
7. Deploy

---

## Environment Variables

Copy these to your deployment platform:

```env
FOREX_API_KEY=5ES11PSM60ESIMHH
FOREX_API_PROVIDER=alphavantage
FOREX_API_BASE_URL=https://www.alphavantage.co/query
DATABASE_URL=postgresql://user:pass@host:5432/db
SESSION_SECRET=<generate with: openssl rand -base64 32>
NODE_ENV=production
```

---

## Database Setup

### Option 1: Neon (Free, Serverless PostgreSQL)
1. Sign up: https://neon.tech
2. Create project
3. Copy connection string
4. Add as `DATABASE_URL`

### Option 2: Supabase (Free tier available)
1. Sign up: https://supabase.com
2. Create project
3. Settings → Database → Connection string (Session mode)
4. Add as `DATABASE_URL`

### Run Migrations
```bash
# Connect to your database
psql $DATABASE_URL

# Or run migrations file
psql $DATABASE_URL < migrations/create_auto_trader_tables.sql
```

---

## Post-Deployment Checklist

- [ ] App loads successfully
- [ ] Login/register works
- [ ] Dashboard displays
- [ ] Auto-trader can be started
- [ ] Signals generate
- [ ] Database saves trades
- [ ] No console errors

---

## Need Help?

See full documentation: **DEPLOYMENT.md**

Common issues:
- **Database connection errors**: Check `DATABASE_URL` format
- **Session errors**: Ensure `SESSION_SECRET` is set
- **API errors**: Verify `FOREX_API_KEY` is valid
- **Build errors**: Run `npm run build` locally first
