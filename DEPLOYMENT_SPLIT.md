# Split Deployment Guide
## Frontend (Cloudflare Pages) + Backend (Vercel)

This guide covers deploying your app with **split architecture**:
- **Cloudflare Pages**: Hosts the React frontend (static files)
- **Vercel**: Hosts the Express backend (API server)
- **Supabase**: PostgreSQL database (already configured)

---

## Architecture Overview

```
User Browser
    ↓
Cloudflare Pages (React SPA)
    ↓ API calls via VITE_API_URL
Vercel Serverless Functions (Express API)
    ↓
Supabase (PostgreSQL Database)
```

---

## Step 1: Deploy Backend to Vercel

### Prerequisites
- Vercel account
- Vercel CLI: `npm i -g vercel`

### Deploy Steps

1. **Login to Vercel**:
```bash
vercel login
```

2. **Set Environment Variables** (via Vercel Dashboard or CLI):
```bash
# Via CLI
vercel env add SUPABASE_URL production
# Paste: https://bgfucdqnncvanznvcste.supabase.co

vercel env add SUPABASE_SERVICE_ROLE_KEY production
# Paste your service role key

vercel env add DATABASE_URL production
# Paste your PostgreSQL connection string

vercel env add SESSION_SECRET production
# Paste a secure random string

vercel env add FOREX_API_KEY production
# Paste: 5ES11PSM60ESIMHH

vercel env add FOREX_API_PROVIDER production
# Type: alphavantage

vercel env add FOREX_API_BASE_URL production
# Type: https://www.alphavantage.co/query

vercel env add NODE_ENV production
# Type: production
```

3. **Deploy to Vercel**:
```bash
# From project root
vercel --prod
```

4. **Note your Vercel URL**:
   - You'll get a URL like: `https://forex-market-anz.vercel.app`
   - **Save this URL** - you'll need it for Cloudflare

5. **Test the Backend**:
```bash
curl https://YOUR_VERCEL_URL.vercel.app/api/auth/me
# Should return JSON (even if not authenticated)
```

---

## Step 2: Deploy Frontend to Cloudflare Pages

### Prerequisites
- Cloudflare account
- Wrangler CLI: `npm i -g wrangler`

### Deploy Steps

1. **Login to Cloudflare**:
```bash
wrangler login
```

2. **Set the Backend API URL**:

**Option A: Via Cloudflare Dashboard** (Recommended)
   1. Go to https://dash.cloudflare.com
   2. Pages → Your project → Settings → Environment variables
   3. Add variable:
      - Name: `VITE_API_URL`
      - Value: `https://YOUR_VERCEL_URL.vercel.app` (from Step 1)
      - Environment: Production

**Option B: Via wrangler.toml** (Less secure, commits to Git)
   - Edit `wrangler.toml`:
   ```toml
   [vars]
   VITE_API_URL = "https://YOUR_VERCEL_URL.vercel.app"
   ```

3. **Build the Frontend**:
```bash
npm run build
```

4. **Deploy to Cloudflare Pages**:
```bash
wrangler pages deploy dist/public --project-name=marketwatchpro-frontend
```

5. **Your Frontend URL**:
   - You'll get: `https://marketwatchpro-frontend.pages.dev`

---

## Step 3: Update CORS Settings

Your Vercel backend needs to accept requests from Cloudflare:

1. **Check `server/index.ts`** - ensure CORS is configured:
```typescript
app.use(cors({
  origin: [
    'http://localhost:5173', // Development
    'https://marketwatchpro-frontend.pages.dev', // Cloudflare Pages
    'https://YOUR_CUSTOM_DOMAIN.com' // If using custom domain
  ],
  credentials: true
}));
```

2. **Redeploy backend if you made changes**:
```bash
vercel --prod
```

---

## Step 4: Verify Deployment

### Test Checklist

1. **Frontend loads**:
   - Visit: `https://marketwatchpro-frontend.pages.dev`
   - Should see the app UI

2. **API calls work**:
   - Open browser DevTools → Network tab
   - Try to login/register
   - Check API calls go to your Vercel URL

3. **Database works**:
   - Register a new user
   - Check Supabase dashboard for new user

4. **Auto-trader works**:
   - Start auto-trader
   - Check trades are saved to Supabase

---

## Environment Variables Reference

### Vercel (Backend)
```env
SUPABASE_URL=https://bgfucdqnncvanznvcste.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
DATABASE_URL=postgresql://postgres:password@host:5432/postgres
SESSION_SECRET=<generate-secure-random-string>
FOREX_API_KEY=5ES11PSM60ESIMHH
FOREX_API_PROVIDER=alphavantage
FOREX_API_BASE_URL=https://www.alphavantage.co/query
NODE_ENV=production
```

### Cloudflare Pages (Frontend)
```env
VITE_API_URL=https://YOUR_VERCEL_URL.vercel.app
```

---

## Automatic Deployments via Git

### Vercel
1. Go to https://vercel.com/new
2. Import your Git repository
3. Framework: **Other**
4. Build Command: `npm run build`
5. Output Directory: `dist`
6. Root Directory: `./`
7. Add all environment variables
8. Deploy

Every push to `main` branch auto-deploys backend.

### Cloudflare Pages
1. Go to https://dash.cloudflare.com
2. Pages → Create project → Connect to Git
3. Select repository
4. Build Command: `npm run build`
5. Build output directory: `dist/public`
6. Environment variables: Add `VITE_API_URL`
7. Deploy

Every push to `main` branch auto-deploys frontend.

---

## Custom Domains

### Add Custom Domain to Cloudflare
1. Pages → Your project → Custom domains
2. Add domain (e.g., `app.yourdomain.com`)
3. Follow DNS setup instructions

### Update CORS
After adding custom domain, update `server/index.ts` CORS config to include it:
```typescript
origin: [
  'http://localhost:5173',
  'https://marketwatchpro-frontend.pages.dev',
  'https://app.yourdomain.com' // Your custom domain
],
```

---

## Troubleshooting

### Frontend can't reach backend
**Symptom**: Network errors, CORS errors in console

**Solutions**:
1. Check `VITE_API_URL` is set in Cloudflare Pages
2. Verify Vercel backend is running
3. Check CORS settings in `server/index.ts`
4. Ensure Cloudflare URL is in CORS `origin` array

### Backend errors
**Symptom**: 500 errors from API

**Solutions**:
1. Check Vercel logs: `vercel logs`
2. Verify all environment variables are set
3. Test Supabase connection
4. Check DATABASE_URL format

### Database connection fails
**Symptom**: "Connection refused" or timeout errors

**Solutions**:
1. Verify `DATABASE_URL` is correct
2. Check `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
3. Test connection from Vercel: Add test endpoint
4. Ensure Supabase allows connections from Vercel IPs

---

## Migration from Render

If you're currently on Render and want to switch to Vercel:

1. Deploy to Vercel (Step 1 above)
2. Update `VITE_API_URL` in Cloudflare to point to Vercel
3. Test thoroughly
4. Delete Render deployment

**No frontend changes needed** - the `VITE_API_URL` env var handles the switch!

---

## Quick Commands Reference

```bash
# Deploy backend to Vercel
vercel --prod

# Deploy frontend to Cloudflare
npm run build
wrangler pages deploy dist/public --project-name=marketwatchpro-frontend

# View Vercel logs
vercel logs

# View Cloudflare logs
wrangler pages deployment tail

# Test backend locally
npm run build
npm start

# Test frontend locally with production backend
VITE_API_URL=https://YOUR_VERCEL_URL.vercel.app npm run dev
```

---

## Cost Breakdown

- **Vercel Free Tier**: 100GB bandwidth, serverless functions included
- **Cloudflare Pages Free**: Unlimited bandwidth, unlimited requests
- **Supabase Free**: 500MB database, 2GB bandwidth

**Total**: $0/month for moderate usage

---

## Support

- **Vercel Docs**: https://vercel.com/docs
- **Cloudflare Pages**: https://developers.cloudflare.com/pages
- **Supabase**: https://supabase.com/docs
